import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {copyNativeObject,nativeColumnName,nativeTableName} from '../src/system-files/native-object-copy.ts';

// A dedicated, disposable PostgreSQL database only. No production schema/reset.
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')
  throw Error('Requires disposable metadrive_native_copy_test database');
const pool=new Pool({connectionString:url});
const db={async transaction(run){const client=await pool.connect();try{
  await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result;
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const app='33333333-3333-4333-8333-333333333333';
const nameCol=nativeColumnName({api_name:'Name',data_type:'text',standard:true});
const amountCol=nativeColumnName({api_name:'Amount',data_type:'currency',standard:true});
const table=nativeTableName('Product');
try {
  await pool.query(`CREATE TABLE md_tenants(id uuid PRIMARY KEY);
    CREATE TABLE md_object_definitions(tenant_id uuid,api_name text,PRIMARY KEY(tenant_id,api_name));
    CREATE TABLE md_field_definitions(tenant_id uuid,object_api text,api_name text,data_type text,
      rollup_operation text,rollup_child_object text,rollup_source_field text,PRIMARY KEY(tenant_id,object_api,api_name));
    CREATE TABLE md_app_package_resources(app_id uuid,version int,resource_type text,parent_api text,api_name text);
    CREATE TABLE md_tenant_app_installed_versions(tenant_id uuid,app_id uuid,version int);
    CREATE TABLE md_records(tenant_id uuid,id uuid DEFAULT gen_random_uuid(),object_api text,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      owner_id uuid,owner_queue_id uuid,record_type_id text,is_clone boolean NOT NULL DEFAULT false,
      is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by uuid,
      deletion_group_id uuid,deletion_root_id uuid,PRIMARY KEY(tenant_id,id));
    CREATE TABLE md_record_values(tenant_id uuid,record_id uuid,object_api text,field_api text,
      value_text text,reference_record_id uuid,value_number numeric,value_date date,
      value_datetime timestamptz,value_boolean boolean,geo_latitude double precision,geo_longitude double precision,
      address_street text,address_city text,address_state text,address_postal_code text,address_country text,
      PRIMARY KEY(tenant_id,record_id,field_api));`);
  await pool.query('INSERT INTO md_tenants VALUES($1),($2)',[a,b]);
  await pool.query("INSERT INTO md_object_definitions VALUES($1,'Product'),($2,'Product'),($1,'Empty')",[a,b]);
  const specs=[['Name','text'],['Barcode','text'],['Amount','currency'],['Enabled','boolean'],
    ['Expires','date'],['At','datetime'],['Parent','reference'],['Point','geolocation'],['Address','address'],
    ['Secret','encryptedtext'],['Tags','multipicklist'],['CustomNumber','number'],['Nullable','text'],['Missing','text']];
  for(const tenant of [a,b])for(const [field,type] of specs)
    await pool.query('INSERT INTO md_field_definitions(tenant_id,object_api,api_name,data_type) VALUES($1,\'Product\',$2,$3)',[tenant,field,type]);
  await pool.query('INSERT INTO md_tenant_app_installed_versions VALUES($1,$3,1),($2,$3,1)',[a,b,app]);
  for(const field of specs.map(x=>x[0]).filter(x=>!['CustomNumber','Nullable','Missing'].includes(x)))
    await pool.query("INSERT INTO md_app_package_resources VALUES($1,1,'Field','Product',$2)",[app,field]);
  await pool.query("INSERT INTO md_records(tenant_id,object_api) SELECT $1,'Product' FROM generate_series(1,10000)",[a]);
  await pool.query("INSERT INTO md_records(tenant_id,object_api) VALUES($1,'Product')",[b]);
  await pool.query(`INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,value_text)
    SELECT tenant_id,id,object_api,'Name','Product '||row_number() OVER(ORDER BY id) FROM md_records`);
  const id=(await pool.query('SELECT id FROM md_records WHERE tenant_id=$1 ORDER BY id LIMIT 1',[a])).rows[0].id;
  const values={Barcode:'123456789',Amount:'12345678901234567890.123456789',Enabled:'false',Expires:'2026-11-15',
    At:'2026-11-15T23:59:01.123Z',Parent:id,Secret:'opaque-encrypted-ciphertext',Tags:'A;B',CustomNumber:'9.99',Nullable:null};
  for(const [field,value] of Object.entries(values))await pool.query(`INSERT INTO md_record_values
    (tenant_id,record_id,object_api,field_api,value_text) VALUES($1,$2,'Product',$3,$4)`,[a,id,field,value]);
  await pool.query(`INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,geo_latitude,geo_longitude)
    VALUES($1,$2,'Product','Point',51.5,-0.12)`,[a,id]);
  await pool.query(`INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,address_street,address_city)
    VALUES($1,$2,'Product','Address','One Street','London')`,[a,id]);
  await pool.query('UPDATE md_records SET is_deleted=true,deleted_at=now(),deleted_by=$1,deletion_group_id=$2 WHERE tenant_id=$1 AND id=$2',[a,id]);
  assert.equal((await copyNativeObject(db,a,'Empty')).source_count,'0');
  const before=performance.now();
  assert.equal((await copyNativeObject(db,a,'Product')).source_count,'10000');
  console.info('10k-row verified offline copy ms:',Math.round(performance.now()-before));
  assert.equal((await copyNativeObject(db,b,'Product')).source_count,'1');
  const row=(await pool.query(`SELECT *,${amountCol}::text AS exact_amount FROM ${table} WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0];
  assert.equal(row.exact_amount,values.Amount,'numeric precision must not pass through JS Number');
  assert.equal(row.is_deleted,true);assert.equal(row.extras.CustomNumber,9.99);
  assert.equal(row.extras.Nullable,null);assert(!Object.hasOwn(row.extras,'Missing'));
  assert(row.present_fields.includes('Nullable'));assert(!row.present_fields.includes('Missing'));
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,[a])).rows[0].n,10000);
  // Schema evolution and refresh preserve the other tenant; a copy is never active.
  await pool.query("INSERT INTO md_field_definitions(tenant_id,object_api,api_name,data_type) VALUES($1,'Product','NewCustom','text')",[a]);
  await pool.query("UPDATE md_record_values SET value_text='Changed' WHERE tenant_id=$1 AND record_id=$2 AND field_api='Name'",[a,id]);
  await copyNativeObject(db,a,'Product');
  assert.equal((await pool.query(`SELECT ${nameCol} AS name FROM ${table} WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0].name,'Changed');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,[b])).rows[0].n,1);
  assert((await pool.query('SELECT status FROM md_native_object_copies')).rows.every(x=>x.status==='snapshot-only'));
  // Source mutation does not claim to update a snapshot or authorise cutover.
  await pool.query("UPDATE md_record_values SET value_text='Not yet copied' WHERE tenant_id=$1 AND record_id=$2 AND field_api='Name'",[a,id]);
  await pool.query("UPDATE md_field_definitions SET data_type='future' WHERE tenant_id=$1 AND object_api='Product' AND api_name='Name'",[a]);
  await assert.rejects(copyNativeObject(db,a,'Product'),/does not support/);
  assert.equal((await pool.query(`SELECT ${nameCol} AS name FROM ${table} WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0].name,'Changed');
  await pool.query("UPDATE md_field_definitions SET data_type='text' WHERE tenant_id=$1 AND object_api='Product' AND api_name='Name'",[a]);
  // Deliberately corrupt the destination via a trigger: full value verification
  // must detect it even when row counts match, and restore the previous snapshot.
  await pool.query(`CREATE FUNCTION corrupt_native_copy() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.${nameCol}:='corrupted';RETURN NEW;END $$;
    CREATE TRIGGER corrupt_native_copy BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION corrupt_native_copy()`);
  await assert.rejects(copyNativeObject(db,a,'Product'),/verification failed/);
  assert.equal((await pool.query(`SELECT ${nameCol} AS name FROM ${table} WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0].name,'Changed');
  await pool.query(`DROP TRIGGER corrupt_native_copy ON ${table}`);
  // Rollback also preserves previous copies on invalid typed legacy data.
  await pool.query("UPDATE md_record_values SET value_text='bad-number' WHERE tenant_id=$1 AND record_id=$2 AND field_api='Amount'",[a,id]);
  await assert.rejects(copyNativeObject(db,a,'Product'),/invalid input syntax/);
  assert.equal((await pool.query(`SELECT ${nameCol} AS name FROM ${table} WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0].name,'Changed');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM md_records')).rows[0].n,10001);
  console.info('Native object copy: tenant isolation, exact typed values, null/absence, 10k rows, schema refresh, rollback and source preservation passed');
} finally {await pool.end();}
