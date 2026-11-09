// Active backend migration regressions. These execute in the canonical
// npm run test:backend entrypoint instead of a silently skipped archive.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {planLegacyMigrationTransition} from '../../src/system-support/system-migrations.ts';
import {tenantDeveloperDomain} from '../../src/system-support/tenant-developer-domain.ts';

// The legacy backend archive has no entries; these tests run directly.
// Keep its empty index for the existing repository reference verifier.
const SOURCES=[];

const source=readFileSync(new URL('../../src/system-support/migrations/20261107-core-baseline.sql',import.meta.url),'utf8');
const originals=[...source.matchAll(/^-- BEGIN ORIGINAL MIGRATION ([0-9a-z-]+\.sql)\n([\s\S]*?)^-- END ORIGINAL MIGRATION \1$/gm)]
 .map(match=>({version:match[1],sql:match[2]}));
const receipts=originals.map(m=>({
 version:m.version,checksum:createHash('sha256').update(m.sql).digest('hex')
}));
const external={
 version:'20270123-normalize-builder-ribbon-properties.sql',
 checksum:'a'.repeat(64)
};

test('canonical backend suite retains all 279 original SQL migrations',()=>{
 assert.equal(originals.length,279);
 assert.equal(new Set(originals.map(m=>m.version)).size,279);
});

test('OCI ribbon normalization receipt is preserved without replay',()=>{
 assert.deepEqual(planLegacyMigrationTransition(source,[...receipts,external]),[]);
 assert.deepEqual(planLegacyMigrationTransition(source,[...receipts.slice(0,-1),external])
  .map(m=>m.name),[originals.at(-1).version],
  'A known out-of-band receipt must not suppress missing core migrations');
});

test('unknown or corrupt SQL receipts still fail closed',()=>{
 assert.throws(()=>planLegacyMigrationTransition(source,[...receipts,{
  version:'20270124-unverified-production.sql',checksum:'a'.repeat(64)
 }]),/Unknown legacy SQL migration receipt/);
 assert.throws(()=>planLegacyMigrationTransition(source,[...receipts,{...external,checksum:'invalid'}]),
  /Unknown legacy SQL migration receipt/);
 assert.throws(()=>planLegacyMigrationTransition(source,[...receipts,external,external]),
  /Duplicate legacy SQL migration receipt/);
 assert.throws(()=>planLegacyMigrationTransition(source,[{...receipts[0],checksum:'b'.repeat(64)}]),
  /SQL system migration changed after application/);
});

test('OCI live telemetry reports collector health and stages without GitHub queries',async()=>{
 const {readOciDeploymentTelemetry}=await import('../../src/system-support/platform-deployment-routes.ts');
 const enabled=process.env.METADRIVE_MCP_OPERATIONS;
 const socket=process.env.METADRIVE_MCP_BROKER_SOCKET;
 process.env.METADRIVE_MCP_OPERATIONS='enabled';
 process.env.METADRIVE_MCP_BROKER_SOCKET='/testing/oci-socket';
 try {
  const status=await readOciDeploymentTelemetry(async()=>({output:[
   'state=running','sha='+'a'.repeat(40),'stage=building',
   'updated_at=2026-11-08T09:51:00Z','log_collector=v2',
   'build_log_state=available','trail_begin',
   '2026-11-08T09:51:00Z building — npm run build','trail_end',
   'build_log_begin','| 2026-11-08T09:51:01Z $ npm run build',
   'build_log_end','journal_begin','journal_end',''
  ].join('\n')}));
  assert.equal(status.active,true);
  assert.equal(status.configured,true);
  assert.equal(status.oci?.logCollector,'ready');
  assert.equal(status.oci?.buildLogState,'available');
  assert.deepEqual(status.oci?.buildLog,['2026-11-08T09:51:01Z $ npm run build']);
  assert.deepEqual(status.oci?.trail,['2026-11-08T09:51:00Z building — npm run build']);
  assert.ok(Number.isFinite(Date.parse(status.checkedAt)));
  const old=await readOciDeploymentTelemetry(async()=>({output:'state=running\nstage=building\n'}));
  assert.equal(old.oci?.logCollector,'outdated','older OCI installations must be diagnosed');
  assert.equal(old.oci?.buildLogState,'unknown');
  const down=await readOciDeploymentTelemetry(async()=>{throw Error('socket closed');});
  assert.equal(down.configured,false);
  assert.match(down.error,/helper is unreachable/);
 } finally {
  if(enabled===undefined)delete process.env.METADRIVE_MCP_OPERATIONS;
  else process.env.METADRIVE_MCP_OPERATIONS=enabled;
  if(socket===undefined)delete process.env.METADRIVE_MCP_BROKER_SOCKET;
  else process.env.METADRIVE_MCP_BROKER_SOCKET=socket;
 }
});


test('tenant developer login host uses a configured or default platform-owned base domain',()=>{
 assert.equal(tenantDeveloperDomain('kingstonexterior','tenants.unesolutions.co.uk'),
   'kingstonexterior.tenants.unesolutions.co.uk');
 assert.equal(tenantDeveloperDomain('New-Tenant',' TENANTS.EXAMPLE.COM '),
   'new-tenant.tenants.example.com');
 assert.equal(tenantDeveloperDomain('mytenant',''),'mytenant.tenants.unesolutions.co.uk');
 assert.equal(tenantDeveloperDomain('mytenant','  '),'mytenant.tenants.unesolutions.co.uk');
 assert.throws(()=>tenantDeveloperDomain('mytenant','https://example.com/'),/base domain is not configured/);
 assert.throws(()=>tenantDeveloperDomain('tenant.name','tenants.example.com'),/Invalid tenant identifier/);
 assert.throws(()=>tenantDeveloperDomain('x'.repeat(55),'tenants.example.com'),/Invalid tenant identifier/);
});

test('mailbox availability endpoint is registered before the dynamic tenant slug route',()=>{
 const routes=readFileSync(new URL('../../src/system-support/server.ts',import.meta.url),'utf8');
 const exact=routes.indexOf("app.get('/api/platform/tenants/developer-email-availability'");
 const dynamic=routes.indexOf("app.get('/api/platform/tenants/:slug'");
 assert.ok(exact>=0&&dynamic>=0&&exact<dynamic,'specific availability route must not be shadowed');
});

test('tenant form uses verified domain, retains mailbox failures, and blocks duplicate identities',()=>{
 const ui=readFileSync(new URL('../../../web/src/core/platform/TenantManagement/TenantManagement.tsx',import.meta.url),'utf8');
 const fields=readFileSync(new URL('../../../web/src/core/platform/TenantManagement/adminTenantFieldMetadata.ts',import.meta.url),'utf8');
 assert.match(ui,/body: JSON\.stringify\(create\)/);
 assert.doesNotMatch(ui,/readOnly=\{field\.key==='developerDomain'\}/);
 assert.doesNotMatch(fields,/key:'developerDomain'/);
 assert.match(ui,/emailCheck\?\.developerDomain/);
 assert.match(ui,/setEmailCheckError\(cause instanceof Error/);
 assert.match(ui,/administratorEmailMatchesDeveloper/);
 assert.match(ui,/disabled=\{!canCreateTenant\}/);
 assert.match(fields,/key:'tenantId'[^\n]*maxLength:54/);
 const service=readFileSync(new URL('../../src/system-files/platform-tenant-service.ts',import.meta.url),'utf8');
 const inspection=readFileSync(new URL('../../src/system-support/tenant-inspection-routes.ts',import.meta.url),'utf8');
 assert.match(service,/domain:expectedDomain/);
 assert.match(service,/x\.developerDomain!==undefined/);
 assert.match(inspection,/domain===tenantDeveloperDomain\(name\)/);
});

test('publishing standalone Page Builder templates does not demand navigation assignments',async()=>{
 const {pageRequiresActivationAssignment}=await import('../../src/system-files/page-layout-version-runtime.ts');
 for(const type of ['Home Page','Record Page'])
  assert.equal(pageRequiresActivationAssignment(type),true,type);
 for(const type of ['App Page','In-Screen Page','Print Template'])
  assert.equal(pageRequiresActivationAssignment(type),false,type);
});
