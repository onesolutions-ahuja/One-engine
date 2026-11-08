/**
 * One-time, idempotent migration of legacy CartSession records to Cart.
 * Run after deploying Cart.UserId + CartLine.Cart metadata, BEFORE retiring
 * the legacy Object or its lookup. No tenant identifiers are hardcoded.
 *
 * node scripts/cart/migrate-cart-session-to-cart.mjs          # read-only preflight
 * node scripts/cart/migrate-cart-session-to-cart.mjs --apply  # transactional copy
 *
 * This intentionally does NOT remove CartSession while published Flows/pages
 * could still use it. See retire-cart-session.mjs for guarded retirement.
 */
import assert from 'node:assert/strict';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';

const connectionString=process.env.DATABASE_URL??process.env.METADRIVE_DATABASE_URL;
if(!connectionString)throw Error('DATABASE_URL is required');
const db=new SqlPersistence(connectionString);
const apply=process.argv.includes('--apply');
const eligible=['Name','SessionKey','Status','ServiceMode','ExpiresAt'];
try{
 const tenants=await db.query(`
  SELECT DISTINCT tenant_id FROM md_records
  WHERE object_api IN ('CartSession','Cart') ORDER BY tenant_id`);
 const summary=[];
 for(const {tenant_id:tenant} of tenants.rows){
  const records=await db.query(`
   SELECT r.id,r.owner_id,r.created_at FROM md_records r
   WHERE r.tenant_id=$1 AND r.object_api='CartSession' ORDER BY r.id`,[tenant]);
  const lines=await db.query(`
   SELECT COUNT(*)::int AS total FROM md_record_values v
   JOIN md_records r ON r.tenant_id=v.tenant_id AND r.id=v.record_id
   WHERE v.tenant_id=$1 AND r.object_api='CartLine'
    AND v.object_api='CartLine' AND v.field_api='CartSession'
    AND v.reference_record_id IS NOT NULL`,[tenant]);
  const withoutOwner=records.rows.filter(r=>!r.owner_id).length;
  summary.push({tenant,legacyCarts:records.rows.length,legacyLines:lines.rows[0].total,missingOwner:withoutOwner});
  if(!apply)continue;
  await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cart-session-retirement:'+tenant]);
   const fields=await client.query(`
    SELECT object_api,api_name FROM md_field_definitions WHERE tenant_id=$1
    AND deleted_at IS NULL AND ((object_api='Cart' AND api_name=ANY($2::text[]))
      OR (object_api='CartLine' AND api_name='Cart'))`,[tenant,[...eligible,'UserId']]);
   const available=new Set(fields.rows.map(r=>r.object_api+'.'+r.api_name));
   for(const required of ['Cart.Name','Cart.SessionKey','Cart.Status','Cart.UserId','CartLine.Cart'])
    assert(available.has(required),'Missing field '+required+' for tenant '+tenant);
   await client.query(`
    CREATE TABLE IF NOT EXISTS md_cart_session_migration_map(
     tenant_id uuid NOT NULL,legacy_session_id uuid NOT NULL,
     cart_id uuid NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY(tenant_id,legacy_session_id),
     FOREIGN KEY(tenant_id,legacy_session_id) REFERENCES md_records(tenant_id,id),
     FOREIGN KEY(tenant_id,cart_id) REFERENCES md_records(tenant_id,id)
    )`);
   // Existing Cart records may predate the UserId field; attach their real owner.
   await client.query(`
    INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,value_text)
    SELECT r.tenant_id,r.id,'Cart','UserId',r.owner_id::text FROM md_records r
    WHERE r.tenant_id=$1 AND r.object_api='Cart' AND r.owner_id IS NOT NULL
    ON CONFLICT(tenant_id,record_id,field_api) DO NOTHING`,[tenant]);
   const before=await client.query(`
    SELECT r.id,r.owner_id,r.created_at FROM md_records r
    WHERE r.tenant_id=$1 AND r.object_api='CartSession' ORDER BY r.id FOR UPDATE`,[tenant]);
   for(const row of before.rows){
    const mapped=await client.query(`
     SELECT cart_id FROM md_cart_session_migration_map
     WHERE tenant_id=$1 AND legacy_session_id=$2`,[tenant,row.id]);
    let cartId=mapped.rows[0]?.cart_id;
    if(!cartId){
     const created=await client.query(`
      INSERT INTO md_records(tenant_id,object_api,owner_id,created_at)
      VALUES($1,'Cart',$2,$3) RETURNING id`,[tenant,row.owner_id,row.created_at]);
     cartId=created.rows[0].id;
     await client.query(`
      INSERT INTO md_cart_session_migration_map(tenant_id,legacy_session_id,cart_id)
      VALUES($1,$2,$3)`,[tenant,row.id,cartId]);
    }
    await client.query(`
     INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,
       value_text,value_datetime,value_date,reference_record_id)
     SELECT v.tenant_id,$3,'Cart',v.field_api,
       v.value_text,v.value_datetime,v.value_date,v.reference_record_id
     FROM md_record_values v
     JOIN md_field_definitions f ON f.tenant_id=v.tenant_id
       AND f.object_api='Cart' AND f.api_name=v.field_api AND f.deleted_at IS NULL
     WHERE v.tenant_id=$1 AND v.record_id=$2 AND v.object_api='CartSession'
       AND v.field_api=ANY($4::text[])
     ON CONFLICT(tenant_id,record_id,field_api) DO NOTHING`,
     [tenant,row.id,cartId,eligible]);
    if(row.owner_id)await client.query(`
     INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,value_text)
     VALUES($1,$2,'Cart','UserId',$3)
     ON CONFLICT(tenant_id,record_id,field_api) DO NOTHING`,[tenant,cartId,row.owner_id]);
   }
   const invalid=await client.query(`
    SELECT COUNT(*)::int AS total FROM md_record_values v
    LEFT JOIN md_cart_session_migration_map m
     ON m.tenant_id=v.tenant_id AND m.legacy_session_id=v.reference_record_id
    WHERE v.tenant_id=$1 AND v.object_api='CartLine'
     AND v.field_api='CartSession' AND v.reference_record_id IS NOT NULL
     AND m.cart_id IS NULL`,[tenant]);
   assert.equal(invalid.rows[0].total,0,'Unmapped CartSession child exists: abort');
   const conflicts=await client.query(`
    SELECT COUNT(*)::int AS total FROM md_record_values old
    JOIN md_cart_session_migration_map m ON m.tenant_id=old.tenant_id
     AND m.legacy_session_id=old.reference_record_id
    JOIN md_record_values current ON current.tenant_id=old.tenant_id
     AND current.record_id=old.record_id AND current.field_api='Cart'
    WHERE old.tenant_id=$1 AND old.object_api='CartLine'
     AND old.field_api='CartSession'
     AND current.reference_record_id IS DISTINCT FROM m.cart_id`,[tenant]);
   assert.equal(conflicts.rows[0].total,0,'Conflicting parent Cart: abort');
   await client.query(`
    INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,reference_record_id)
    SELECT old.tenant_id,old.record_id,'CartLine','Cart',m.cart_id
    FROM md_record_values old JOIN md_cart_session_migration_map m
     ON m.tenant_id=old.tenant_id AND m.legacy_session_id=old.reference_record_id
    WHERE old.tenant_id=$1 AND old.object_api='CartLine'
     AND old.field_api='CartSession'
    ON CONFLICT(tenant_id,record_id,field_api) DO NOTHING`,[tenant]);
   const incomplete=await client.query(`
    SELECT COUNT(*)::int AS total FROM md_record_values old
    JOIN md_cart_session_migration_map m ON m.tenant_id=old.tenant_id
     AND m.legacy_session_id=old.reference_record_id
    LEFT JOIN md_record_values current ON current.tenant_id=old.tenant_id
     AND current.record_id=old.record_id AND current.field_api='Cart'
    WHERE old.tenant_id=$1 AND old.object_api='CartLine'
     AND old.field_api='CartSession'
     AND current.reference_record_id IS DISTINCT FROM m.cart_id`,[tenant]);
   assert.equal(incomplete.rows[0].total,0,'CartLine data migration incomplete');
  });
 }
 console.log(JSON.stringify({mode:apply?'migrated':'preflight',summary},null,2));
}finally{await db.close();}
