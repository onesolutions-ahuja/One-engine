import {SqlPersistence} from '../dist-system/system-files/sql-persistence.js';
import {applySystemMigrations} from '../dist-system/system-support/system-migrations.js';

// Explicit operator-only, single-tenant test data conversion. Never runs on
// startup, application installation, tenant seeding, or an HTTP request.
const url=process.env.DATABASE_URL;
if(!url)throw new Error('DATABASE_URL is required');
const execute=process.argv.includes('--execute');
const tenantArg=process.argv.find(argument=>argument.startsWith('--tenant='));
const tenantInput=tenantArg?.slice('--tenant='.length);
if(tenantInput&&!/^[a-f0-9-]{36}$/i.test(tenantInput))
 throw new Error('Invalid --tenant UUID');
const db=new SqlPersistence(url);
try {
 await applySystemMigrations(db);
 const {rows:tenants}=await db.query('SELECT id,slug FROM md_tenants ORDER BY slug');
 const tenant=tenantInput
   ?tenants.find(row=>row.id===tenantInput)
   :tenants.length===1?tenants[0]:null;
 if(!tenant)throw new Error('Specify --tenant=<UUID> when SQL contains multiple tenants');
 const {rows:pending}=await db.query(`
   SELECT 'objects' AS kind,count(*)::integer AS count FROM md_object_definitions
    WHERE tenant_id=$1 AND api_name<>lower(api_name)
   UNION ALL SELECT 'fields',count(*)::integer FROM md_field_definitions
    WHERE tenant_id=$1 AND (api_name<>lower(api_name) OR object_api<>lower(object_api))
   UNION ALL SELECT 'pages',count(*)::integer FROM md_page_definitions
    WHERE tenant_id=$1 AND api_name<>lower(api_name)
   UNION ALL SELECT 'flows',count(*)::integer FROM md_flow_definitions
    WHERE tenant_id=$1 AND api_name<>lower(api_name)
   UNION ALL SELECT 'components',count(*)::integer FROM md_component_definitions
    WHERE tenant_id=$1 AND api_name<>lower(api_name)
   UNION ALL SELECT 'apps',count(*)::integer FROM md_tenant_app_metadata
    WHERE tenant_id=$1 AND api_name<>lower(api_name)
   `,[tenant.id]);
 console.info(JSON.stringify({tenant:tenant.slug,tenantId:tenant.id,
   mode:execute?'execute':'preview',pending},null,2));
 if(!execute){
  console.info('Preview only. Add --execute to apply this tenant\'s transactional conversion.');
 } else {
  const {rows}=await db.query('SELECT md_casefold_tenant_api_names($1) AS changed',
   [tenant.id]);
  const {rows:map}=await db.query(`
   SELECT old_name,new_name FROM md_api_casefold_changes
   WHERE tenant_id=$1 ORDER BY old_name LIMIT 100`,[tenant.id]);
  console.info(JSON.stringify({status:'committed',changed:rows[0]?.changed??0,
   auditMappings:map},null,2));
 }
}finally{await db.close();}
