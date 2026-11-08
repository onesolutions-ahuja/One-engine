/**
 * Final CartSession retirement gate. Does not silently destroy historical data.
 * Requires CartLine parent-copy, active Flow upgrades and published page edits.
 * --apply soft-deletes legacy Object/field metadata (recycle-bin safe).
 */
import assert from 'node:assert/strict';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';
import {hasActiveLegacyCartReference} from './cart-legacy-references.mjs';
import {canDeferOrderCartSessionRetirement} from './order-cart-session-retirement-guard.mjs';

const conn=process.env.DATABASE_URL??process.env.METADRIVE_DATABASE_URL;
if(!conn)throw Error('DATABASE_URL is required');
const apply=process.argv.includes('--apply');
const deferOrderLookup=process.argv.includes('--defer-order-cart-session-lookup');
const db=new SqlPersistence(conn),runtime=new PageRuntime(db);
const variants=['Desktop','Tablet','Mobile','Custom'];
try{
 const tenants=await db.query(`
  SELECT tenant_id FROM md_object_definitions
  WHERE api_name='CartSession' AND deleted_at IS NULL ORDER BY tenant_id`);
 const reports=[];
 for(const {tenant_id:tenant} of tenants.rows){
  const checks=[];
  const exists=await db.query("SELECT to_regclass('md_cart_session_migration_map') AS name");
  if(!exists.rows[0]?.name){
   const remaining=await db.query(`
    SELECT COUNT(*)::int AS total FROM md_records
    WHERE tenant_id=$1 AND object_api='CartSession' AND is_deleted=false`,[tenant]);
   if(remaining.rows[0].total)checks.push('CartSession copy has not run');
  }
  if(exists.rows[0]?.name){
   const missing=await db.query(`
    SELECT COUNT(*)::int AS total FROM md_records r LEFT JOIN md_cart_session_migration_map m
     ON m.tenant_id=r.tenant_id AND m.legacy_session_id=r.id
    WHERE r.tenant_id=$1 AND r.object_api='CartSession' AND m.cart_id IS NULL`,[tenant]);
   if(missing.rows[0].total)checks.push(missing.rows[0].total+' sessions have no Cart copy');
   const badLines=await db.query(`
    SELECT COUNT(*)::int AS total FROM md_record_values old
    JOIN md_cart_session_migration_map m ON m.tenant_id=old.tenant_id
     AND m.legacy_session_id=old.reference_record_id
    LEFT JOIN md_record_values newer ON newer.tenant_id=old.tenant_id
     AND newer.record_id=old.record_id AND newer.object_api='CartLine' AND newer.field_api='Cart'
    WHERE old.tenant_id=$1 AND old.object_api='CartLine'
     AND old.field_api='CartSession'
     AND newer.reference_record_id IS DISTINCT FROM m.cart_id`,[tenant]);
   if(badLines.rows[0].total)checks.push(badLines.rows[0].total+' CartLines not migrated');
   // Never strand old open/held carts in the user-filtered Card Grid.
   const unowned=await db.query(`
    SELECT COUNT(*)::int AS total FROM md_cart_session_migration_map m
    JOIN md_records r ON r.tenant_id=m.tenant_id AND r.id=m.legacy_session_id
    JOIN md_record_values status ON status.tenant_id=m.tenant_id
      AND status.record_id=r.id AND status.object_api='CartSession' AND status.field_api='Status'
    LEFT JOIN md_record_values owner ON owner.tenant_id=m.tenant_id
      AND owner.record_id=m.cart_id AND owner.object_api='Cart' AND owner.field_api='UserId'
    WHERE m.tenant_id=$1 AND status.value_text IN ('Open','Held')
      AND NULLIF(owner.value_text,'') IS NULL`,[tenant]);
   if(unowned.rows[0].total)checks.push(unowned.rows[0].total+' open/held Carts have no UserId');

  }
  // Detect literal legacy record IDs in live metadata, not just the old API name.
  if(exists.rows[0]?.name){
   const oldPointers=await db.query(`
    SELECT 1 FROM md_cart_session_migration_map m
    WHERE m.tenant_id=$1 AND (
     EXISTS(SELECT 1 FROM md_flow_editor_values v JOIN md_flow_definitions f
       ON f.tenant_id=v.tenant_id AND f.id=v.flow_id
       WHERE f.tenant_id=m.tenant_id AND f.active=true AND f.archived=false
         AND strpos(COALESCE(v.value_text,''),m.legacy_session_id::text)>0)
     OR EXISTS(SELECT 1 FROM md_field_definitions d WHERE d.tenant_id=m.tenant_id
       AND d.deleted_at IS NULL
       AND strpos(COALESCE(d.formula_expression,''),m.legacy_session_id::text)>0)
     OR EXISTS(SELECT 1 FROM md_field_default_formulas d WHERE d.tenant_id=m.tenant_id
       AND strpos(d.expression,m.legacy_session_id::text)>0)
     OR EXISTS(SELECT 1 FROM md_validation_rules d WHERE d.tenant_id=m.tenant_id
       AND strpos(d.expression,m.legacy_session_id::text)>0)
     OR EXISTS(SELECT 1 FROM md_page_layout_heads h
       JOIN md_page_layout_version_properties p ON p.tenant_id=h.tenant_id
        AND p.page_id=h.page_id AND p.variant=h.variant AND p.version=h.published_version
       WHERE h.tenant_id=m.tenant_id
        AND strpos(COALESCE(p.value_text,''),m.legacy_session_id::text)>0)
    ) LIMIT 1`,[tenant]);
   if(oldPointers.rows.length)checks.push('active metadata still references a legacy CartSession record ID');
  }
  const otherLinks=await db.query(`
   SELECT object_api,api_name FROM md_field_definitions
   WHERE tenant_id=$1 AND related_object='CartSession' AND deleted_at IS NULL
     AND NOT (object_api='CartLine' AND api_name='CartSession')`,[tenant]);
  if(otherLinks.rows.length)checks.push('other active CartSession relationship fields: '+
    otherLinks.rows.map(r=>r.object_api+'.'+r.api_name).join(','));
  const activeFlows=await db.query(`
   SELECT DISTINCT f.api_name FROM md_flow_definitions f JOIN md_flow_editor_values v
    ON v.tenant_id=f.tenant_id AND v.flow_id=f.id
   WHERE f.tenant_id=$1 AND f.active=true AND f.archived=false
    AND v.property_path<>'/builder/apiName'
    AND v.property_path NOT LIKE '%/flowApiName'
    AND v.property_path NOT LIKE '%/subflowApiName'
    AND (v.value_text LIKE '%CartSession%' OR v.value_text LIKE '%cartSessionId%')`,[tenant]);
  if(activeFlows.rows.length)checks.push('active legacy Flows: '+
    activeFlows.rows.map(f=>f.api_name).join(','));
  // Metadata formulas can refer to CartSession even without a Flow or page action.
  const formulaReferences=await db.query(
   "SELECT 'field' AS source,object_api AS object,api_name AS name FROM md_field_definitions WHERE tenant_id=$1 AND deleted_at IS NULL AND formula_expression LIKE '%CartSession%'"+
   " UNION ALL SELECT 'default',object_api,field_api FROM md_field_default_formulas WHERE tenant_id=$1 AND expression LIKE '%CartSession%'"+
   " UNION ALL SELECT 'validation',object_api,api_name FROM md_validation_rules WHERE tenant_id=$1 AND expression LIKE '%CartSession%'",[tenant]);
  if(formulaReferences.rows.length)checks.push('legacy Formula references: '+
   formulaReferences.rows.map(x=>x.source+':'+x.object+'.'+x.name).join(','));
  const stateReferences=await db.query(
   "SELECT 'field' AS source,object_api AS object,api_name AS name FROM md_field_definitions WHERE tenant_id=$1 AND deleted_at IS NULL AND formula_expression LIKE '%cartSessionId%'"+
   " UNION ALL SELECT 'default',object_api,field_api FROM md_field_default_formulas WHERE tenant_id=$1 AND expression LIKE '%cartSessionId%'"+
   " UNION ALL SELECT 'validation',object_api,api_name FROM md_validation_rules WHERE tenant_id=$1 AND expression LIKE '%cartSessionId%'",[tenant]);
  if(stateReferences.rows.length)checks.push('legacy Formula state references: '+
   stateReferences.rows.map(x=>x.source+':'+x.object+'.'+x.name).join(','));
  const pages=await db.query(`
   SELECT DISTINCT p.api_name FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
   WHERE p.tenant_id=$1 AND p.enabled=true`,[tenant]);
  for(const {api_name:pageName} of pages.rows){
   for(const variant of variants){
    let loaded;
    try{loaded=await runtime.load(tenant,pageName,variant);}catch(error){
     if(error instanceof Error&&/not found|not configured/i.test(error.message))continue;
     throw error;
    }
    const page=loaded?.page;
    if(!page||!Array.isArray(page.components))continue;
    const offenders=page.components.filter(c=>hasActiveLegacyCartReference(c.properties??{}));
    if(offenders.length)checks.push(pageName+' '+variant+': '+offenders.length+' published legacy components');
   }
  }
  reports.push({tenant,ready:checks.length===0,checks});
 }
 // All-or-none preflight: never remove metadata while a dependent lookup exists.
 // The known Order.CartSession lookup has no migrated Order.Cart replacement yet.
 // Only the Oracle deploy may explicitly defer its final destructive retirement.
 const blocked=reports.some(r=>!r.ready);
 const deferred=apply&&blocked&&deferOrderLookup&&canDeferOrderCartSessionRetirement(reports);
 if(apply&&blocked&&!deferred)
  throw Error('CartSession retirement blocked. '+JSON.stringify(reports));
 if(deferred)console.warn('CartSession retirement DEFERRED: Order.CartSession is still active; no legacy metadata deleted.');
 if(apply&&!deferred)for(const {tenant} of reports){
  await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cart-session-retirement:'+tenant]);
   await client.query(`
    UPDATE md_field_definitions SET deleted_at=now()
    WHERE tenant_id=$1 AND object_api='CartLine' AND api_name='CartSession'
      AND deleted_at IS NULL`,[tenant]);
   await client.query(`
    UPDATE md_object_definitions SET deleted_at=now()
    WHERE tenant_id=$1 AND api_name='CartSession' AND deleted_at IS NULL`,[tenant]);
  });
 }
 console.log(JSON.stringify({mode:apply?(deferred?'deferred':'retired'):'preflight',reports},null,2));
}finally{await db.close();}
