// Fresh PostgreSQL acceptance check for the one-file SQL version.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {SqlPersistence} from '../apps/server/dist-system/system-files/sql-persistence.js';
import {applySystemMigrations} from '../apps/server/dist-system/system-support/system-migrations.js';
import {TenantProvisioning} from '../apps/server/dist-system/system-files/tenant-provisioning.js';

const connection=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!connection)throw Error('METADRIVE_SQL_TEST_DATABASE_URL is required');
const versions=readdirSync(new URL('../apps/server/src/system-support/migrations/',import.meta.url)).filter(s=>s.endsWith('.sql'));
assert.deepEqual(versions,['20261107-core-baseline.sql'],'Exactly one SQL version file');
const db=new SqlPersistence(connection);
try {
 await db.query(readFileSync(new URL('../apps/server/src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 await applySystemMigrations(db);
 const applied=await db.query("SELECT version FROM md_system_migrations WHERE version LIKE '%.sql' ORDER BY version");
 assert.deepEqual(applied.rows.map(r=>r.version),versions,'Baseline only runs once');
 await db.verifySchema();
 await new TenantProvisioning(db).provision({
  slug:'fresh-baseline-test',
  name:'Fresh baseline test',
  domain:'fresh-baseline-test.example.test',
  developerEmail:'administrator@example.test',
  developerPassword:'IntegrationPassphrase-2026-Strong!'
 });
 const result=await db.query("SELECT (SELECT COUNT(*)::integer FROM md_users u JOIN md_tenants t ON t.id=u.tenant_id WHERE t.slug='fresh-baseline-test' AND u.email IN ('administrator@example.test','developer@fresh-baseline-test.example.test')) AS users, (SELECT COUNT(*)::integer FROM md_object_definitions o JOIN md_tenants t ON t.id=o.tenant_id WHERE t.slug='fresh-baseline-test') AS objects, (SELECT COUNT(*)::integer FROM md_permission_sets p JOIN md_tenants t ON t.id=p.tenant_id WHERE t.slug='fresh-baseline-test' AND p.api_name='OneEngine') AS policies");
 assert.equal(result.rows[0].users,2,'InitialUser creates administrator and disabled developer (excluding service account)');
 assert.ok(result.rows[0].objects>0,'CoreObjects creates metadata');
 assert.equal(result.rows[0].policies,1,'OneEnginePolicy registers one policy');
 // Pre-existing Smart definitions are migrated from the old internal renderer key
 // to the Smart-only registry key without touching custom tenant library entries.
 const {migrateSmartRendererKeys}=await import(
  '../apps/server/dist-system/app-seeders/smart-components.js');
 const {rows:[beforeSmart]}=await db.query(
  "INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled) "+
  "SELECT id,'smart_text','one-bundled:smart_text',true FROM md_tenants "+
  "WHERE slug='fresh-baseline-test' "+
  "ON CONFLICT(tenant_id,api_name) DO UPDATE SET renderer_key='one-bundled:smart_text' "+
  "RETURNING api_name",[ ]);
 assert.equal(beforeSmart.api_name,'smart_text');
 await migrateSmartRendererKeys(db);
 const {rows:[afterSmart]}=await db.query(
  "SELECT renderer_key FROM md_component_definitions "+
  "WHERE tenant_id=(SELECT id FROM md_tenants WHERE slug='fresh-baseline-test') "+
  "AND api_name='smart_text'");
 assert.equal(afterSmart.renderer_key,'smart-bundled:smart_text');
 assert.equal(await migrateSmartRendererKeys(db),0,'Smart renderer migration is idempotent');
 // Real PostgreSQL retirement coverage: records, Objects, and Flows survive.
 const {deleteRetiredChatterMetadata,REMOVED_APP_APIS}=await import(
  '../apps/server/dist-system/app-seeders/retired-apps.js');
 const {rows:[seedTenant]}=await db.query(
  "SELECT id FROM md_tenants WHERE slug='fresh-baseline-test'");
 const tid=seedTenant.id;
 const appIds=new Map();
 for(const apiName of REMOVED_APP_APIS){
  const {rows:[app]}=await db.query(
   'INSERT INTO md_apps(api_name,label,enabled,tenant_owner_id) '+
   'VALUES($1,$1,true,NULL) RETURNING id',[apiName]);
  appIds.set(apiName,app.id);
  await db.query('INSERT INTO md_app_installations(tenant_id,app_id) VALUES($1,$2)',[tid,app.id]);
  await db.query('INSERT INTO md_app_entitlements(tenant_id,app_id,active) VALUES($1,$2,true)',[tid,app.id]);
  await db.query('INSERT INTO md_app_package_versions(app_id,version,published) VALUES($1,1,true)',[app.id]);
 }
 const pages=[['Acetill','AcetillRegister'],['UNEAceChatter','UNEAceChatterDesktop']];
 for(const [appApi,pageApi] of pages){
  const {rows:[page]}=await db.query(
   'INSERT INTO md_page_definitions(tenant_id,api_name,title,enabled) '+
   'VALUES($1,$2,$2,true) RETURNING id',[tid,pageApi]);
  await db.query('INSERT INTO md_app_home_pages(tenant_id,app_id,form_factor,page_id) '+
   "VALUES($1,$2,'desktop',$3)",[tid,appIds.get(appApi),page.id]);
  await db.query('INSERT INTO md_app_package_page_templates(app_id,version,api_name,title) '+
   'VALUES($1,1,$2,$2)',[appIds.get(appApi),pageApi]);
 }
 await db.query("INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled) "+
  "VALUES($1,'onechatter_conversation','one-bundled:onechatter_conversation',true)",[tid]);
 await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'AceChatterUser')",[tid]);
 await db.query("UPDATE md_users SET landing_app_api='AceChatter' "+
  "WHERE tenant_id=$1 AND email='administrator@example.test'",[tid]);
 // Communication is append-only: use the approved integration writer, never
 // fabricate or bypass a record through direct SQL insertion.
 for(const apiName of ['Contact','Customer'])await db.query(
  'INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system) '+
  'VALUES($1,$2,$2,false) ON CONFLICT(tenant_id,api_name) DO NOTHING',[tid,apiName]);
 const {seedCommunicationObjects}=await import(
  '../apps/server/dist-system/app-seeders/core-communication-objects.js');
 await db.transaction(client=>seedCommunicationObjects(client,tid));
 const {createIntegrationCommunicationWriter,IntegrationCommunicationOutbox}=await import(
  '../apps/server/dist-system/system-support/integration-api-log.js');
 const outbox=new IntegrationCommunicationOutbox(db,createIntegrationCommunicationWriter(db));
 await outbox.write({tenantId:tid,direction:'Inbound',transport:'Webhook',
  provider:'WhatsApp_Cloud_API',endpoint:'/api/inbound-webhooks/retirement-ci',
  method:'POST',statusCode:200,outcome:'success',
  communication:{channel:'WhatsApp',sender:'447700900111',recipient:'447700900222',
   body:'Protected communication record',externalMessageId:'retirement-ci-'+tid}});
 const {rows:[communication]}=await db.query(
  "SELECT r.id FROM md_records r JOIN md_record_values v "+
  "ON v.tenant_id=r.tenant_id AND v.record_id=r.id "+
  "AND v.field_api='ExternalMessageId' "+
  "WHERE r.tenant_id=$1 AND r.object_api='Communication' AND v.value_text=$2",
  [tid,'retirement-ci-'+tid]);
 assert.ok(communication?.id,'Approved integration writer must seed Communication record');
 const {rows:[flow]}=await db.query(
  "INSERT INTO md_flow_definitions(tenant_id,api_name,label,flow_type,version,active) "+
  "VALUES($1,'AceChatterSmokeFlow','Smoke test','Autolaunched Flow',1,true) RETURNING id",[tid]);
 const deleted=await deleteRetiredChatterMetadata(db);
 assert.equal(deleted.apps,6,'Remove all six retired app catalog entries');
 assert.equal(deleted.pages,2,'Remove two app-owned Page Definitions');
 assert.ok(deleted.components>=1,'Remove app-owned bundled component');
 assert.equal((await db.query('SELECT COUNT(*)::integer AS n FROM md_apps '+
  'WHERE api_name=ANY($1::text[])',[[...REMOVED_APP_APIS]])).rows[0].n,0);
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_page_definitions "+
  "WHERE tenant_id=$1 AND api_name IN ('AcetillRegister','UNEAceChatterDesktop')",[tid])).rows[0].n,0);
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_records "+
  "WHERE tenant_id=$1 AND object_api='Communication' AND id=$2",[tid,communication.id])).rows[0].n,1,
  'Communication record must survive retired app cleanup');
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_object_definitions "+
  "WHERE tenant_id=$1 AND api_name='Communication'",[tid])).rows[0].n,1,
  'Communication Object must survive retired app cleanup');
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_flow_definitions "+
  "WHERE tenant_id=$1 AND id=$2",[tid,flow.id])).rows[0].n,1,
  'Existing Flow must survive retired app cleanup');
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_permission_sets "+
  "WHERE tenant_id=$1 AND api_name='OneEngine'",[tid])).rows[0].n,1,
  'Core permissions survive');
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_users "+
  "WHERE tenant_id=$1 AND landing_app_api='AceChatter'",[tid])).rows[0].n,0);
 const replay=await deleteRetiredChatterMetadata(db);
 assert.equal(replay.apps,0,'Retired app cleanup must be idempotent');
 console.log('PASS: six retired app metadata rows purged; Object, Communication record, Flow preserved');
 // Reproduce a production database with original migration receipts.
 // Verify authentic SQL checksums and preserve receipts for API rollback.
 const snapshot=readFileSync(new URL('../apps/server/src/system-support/migrations/20261107-core-baseline.sql',import.meta.url),'utf8');
 const historical=[...snapshot.matchAll(/^-- BEGIN ORIGINAL MIGRATION ([0-9a-z-]+\.sql)\n([\s\S]*?)^-- END ORIGINAL MIGRATION \1$/gm)]
   .map(m=>({version:m[1],checksum:createHash('sha256').update(m[2]).digest('hex')}));
 assert.equal(historical.length,279);
 await db.query("DELETE FROM md_system_migrations WHERE version='20261107-core-baseline.sql'");
 await db.transaction(async client=>{
  for(const {version,checksum} of historical)
   await client.query('INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);
 });
 await applySystemMigrations(db);
 const adopted=await db.query("SELECT version FROM md_system_migrations WHERE version LIKE '%.sql' ORDER BY version");
 assert.deepEqual(adopted.rows.map(row=>row.version),
  [...historical.map(row=>row.version),'20261107-core-baseline.sql'].sort(),
  'Baseline is adopted without replaying DDL, retaining old receipts for API rollback');
 await applySystemMigrations(db);
 const replayReceipts=await db.query("SELECT version FROM md_system_migrations WHERE version LIKE '%.sql'");
 assert.equal(replayReceipts.rows.length,280,'Second boot must not replay or delete historical receipts');

 // A genuinely incomplete receipt set must reapply only the missing historic
 // SQL in PostgreSQL, retain both receipt types, and preserve business rows.
 await db.query("DELETE FROM md_system_migrations WHERE version IN ('20261107-core-baseline.sql','20271201-print-template-page-type.sql')");
 await applySystemMigrations(db);
 const recovered=await db.query("SELECT version FROM md_system_migrations WHERE version LIKE '%.sql'");
 assert.equal(recovered.rows.length,280,'Missing original migration and baseline receipts recovered atomically');
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_records WHERE tenant_id=$1 AND object_api='Communication' AND id=$2",[tid,communication.id])).rows[0].n,1,
  'Production-style migration catch-up preserves existing Communication records');

 // OCI had a separately applied ribbon normalization with a durable receipt
 // that is not among the 279 consolidated source files. It must not prevent
 // baseline adoption, delete the receipt, or replay any original migration.
 const externalVersion='20270123-normalize-builder-ribbon-properties.sql';
 const externalChecksum='a'.repeat(64);
 await db.query("INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)",
  [externalVersion,externalChecksum]);
 await db.query("DELETE FROM md_system_migrations WHERE version='20261107-core-baseline.sql'");
 await applySystemMigrations(db);
 const {rows:externalAdopted}=await db.query(
  "SELECT version,checksum FROM md_system_migrations WHERE version LIKE '%.sql'");
 assert.equal(externalAdopted.length,281,'279 originals, baseline and OCI extra receipt are preserved');
 assert.equal(externalAdopted.find(row=>row.version===externalVersion)?.checksum,
  externalChecksum,'Out-of-band receipt must retain its exact stored checksum');
 await applySystemMigrations(db);
 assert.equal((await db.query("SELECT COUNT(*)::integer AS n FROM md_records WHERE tenant_id=$1 AND object_api='Communication' AND id=$2",[tid,communication.id])).rows[0].n,1,
  'OCI receipt compatibility must preserve existing business data');


 // Post-baseline receipts can be from newer releases and must not crash
 // startup or be removed; the immutable baseline receipt is authoritative.
 await db.query("INSERT INTO md_system_migrations(version,checksum) VALUES ('20261018-legacy.sql','fixture')");
 await applySystemMigrations(db);
 const preserved=await db.query("SELECT COUNT(*)::integer AS n FROM md_system_migrations WHERE version='20261018-legacy.sql'");
 assert.equal(preserved.rows[0].n,1,'Post-baseline receipts remain untouched');
 // Before first baseline adoption, unknown legacy receipts still fail closed.
 await db.query("DELETE FROM md_system_migrations WHERE version='20261107-core-baseline.sql'");
 await assert.rejects(()=>applySystemMigrations(db),/Unknown legacy SQL migration receipt/,
  'Unrecognized receipts must block first baseline adoption');
 await db.query("DELETE FROM md_system_migrations WHERE version='20261018-legacy.sql'");
 await applySystemMigrations(db);
 console.log('PASS: single SQL version, idempotence, schema, CoreObjects, InitialUser and OneEnginePolicy');
}finally {await db.close();}
