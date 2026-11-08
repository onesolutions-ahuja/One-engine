// Active backend migration regressions. These execute in the canonical
// npm run test:backend entrypoint instead of a silently skipped archive.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {planLegacyMigrationTransition} from '../../src/system-support/system-migrations.ts';

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
