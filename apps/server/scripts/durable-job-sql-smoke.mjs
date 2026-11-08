import assert from 'node:assert/strict';
const support=new URL('../dist-system/system-support/',import.meta.url);
const files=new URL('../dist-system/system-files/',import.meta.url);
const [{SqlPersistence},{applySystemMigrations},{DurableJobService}]=await Promise.all([
 import(new URL('sql-persistence.js',files).href),
 import(new URL('system-migrations.js',support).href),
 import(new URL('durable-job-service.js',support).href)
]);
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url)throw new Error('METADRIVE_SQL_TEST_DATABASE_URL is required');
const db=new SqlPersistence(url);
try{
 await applySystemMigrations(db);
 await applySystemMigrations(db);
 const {rows:[providerReceipts]}=await db.query(
  "SELECT to_regclass('md_http_callout_receipts') IS NOT NULL AS exists");
 assert.equal(providerReceipts.exists,true);
 const {rows:requiredMigrations}=await db.query(
  "SELECT version FROM md_system_migrations WHERE version IN ('20261027-durable-job-history.sql','20261027-http-callout-receipts.sql')");
 assert.equal(requiredMigrations.length,2,'both recovery migrations must be applied');
 const tenants=[];
 for(const name of ['ci-durable-a','ci-durable-b']){
  const {rows}=await db.query('INSERT INTO md_tenants(slug,name) VALUES($1,$2) RETURNING id',
   [name,name]);
  tenants.push(rows[0].id);
 }
 const [a,b]=tenants;
 const {rows:[actor]}=await db.query(
  'INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',
  [a,'ci-durable-actor@example.invalid','ci-test-hash']);
 const jobs=new DurableJobService(db);
 const id=await jobs.enqueue(a,'test.generic',{actorUserId:actor.id,maxAttempts:3});
 const [c1,c2]=await Promise.all([jobs.claim('ci-worker-1',100,60),jobs.claim('ci-worker-2',100,60)]);
 const ours=[...c1,...c2].filter(j=>j.id===id);
 assert.equal(ours.length,1,'two workers must not claim the same job');
 const owner=c1.some(j=>j.id===id)?'ci-worker-1':'ci-worker-2';
 const {rows:[leased]}=await db.query('SELECT status,attempt FROM md_durable_jobs WHERE id=$1',[id]);
 assert.equal(leased.status,'leased');
 assert.equal(leased.attempt,1);
 await db.query("UPDATE md_durable_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
 await jobs.claim('ci-recovery-worker',100);
 const failed=await jobs.inspect(a,id);
 assert.equal(failed.status,'failed');
 assert.equal(failed.error_code,'JOB_RECONCILIATION_REQUIRED');
 await assert.rejects(()=>jobs.inspect(b,id),/Job not found/);
 await assert.rejects(()=>jobs.reconcileFailed(b,id,actor.id,'retry'),/Failed job not found/);
 await jobs.reconcileFailed(a,id,actor.id,'retry');
 assert.equal((await jobs.inspect(a,id)).status,'queued');
 const resumed=(await jobs.claim('ci-authorized-retry',100,60)).find(j=>j.id===id);
 assert.ok(resumed,'explicitly reconciled execution can be claimed');
 assert.equal(resumed.attempt,1);
 await jobs.fail(a,id,'ci-authorized-retry','UNKNOWN_PROVIDER_OUTCOME',0);
 assert.equal((await jobs.inspect(a,id)).status,'failed');
 await jobs.cancelFailed(a,id,actor.id);
 assert.equal((await jobs.inspect(a,id)).status,'cancelled');
 await jobs.claim('ci-after-cancel',100);
 assert.equal((await jobs.inspect(a,id)).status,'cancelled');
 const {rows:[history]}=await db.query(
  'SELECT count(*)::integer AS n FROM md_durable_job_history WHERE tenant_id=$1 AND job_id=$2',
  [a,id]);
 assert.ok(history.n>=6,'claims, recovery, retry, failure and cancellation are persisted');
 const {rows:[audit]}=await db.query(
  "SELECT count(*)::integer AS n FROM md_security_events WHERE tenant_id=$1 AND actor_user_id=$2 AND action IN ('durable_job.reconcile','durable_job.cancel')",
  [a,actor.id]);
 assert.equal(audit.n,2);
 const recurringId=await jobs.enqueue(a,'test.recurring',
  {actorUserId:actor.id,recurrenceSeconds:60});
 const recurrence=(await jobs.claim('ci-recurring-worker',100)).find(j=>j.id===recurringId);
 assert.ok(recurrence);
 await jobs.complete(a,recurringId,'ci-recurring-worker');
 const {rows:[next]}=await db.query(
  'SELECT status,attempt,scheduled_at>now() AS future FROM md_durable_jobs WHERE id=$1',[recurringId]);
 assert.equal(next.status,'queued');
 assert.equal(next.attempt,0);
 assert.equal(next.future,true);
 console.info('PostgreSQL durable recovery, tenant isolation, operator audit and recurrence: PASS');
}finally{await db.close();}
