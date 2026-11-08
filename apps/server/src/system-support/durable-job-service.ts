import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** SQL job lifecycle primitives; execution policy stays in the shared Flow/action runtime. */
export class DurableJobService {
 constructor(private readonly db:SqlPersistence) {}

 async enqueue(tenantId:string,kind:string,options:{
  actorUserId?:string;appApiName?:string;resourceId?:string;resourceVersion?:number;
  scheduledAt?:Date;idempotencyKey?:string;maxAttempts?:number;recurrenceSeconds?:number;
 }={},client?:PoolClient) {
  if(!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(kind))throw new Error('Invalid job type');
  if(options.resourceVersion!==undefined&&(!Number.isInteger(options.resourceVersion)||options.resourceVersion<1))
   throw new Error('Invalid resource version');
  if(options.maxAttempts!==undefined&&(!Number.isInteger(options.maxAttempts)||options.maxAttempts<1||options.maxAttempts>100))
   throw new Error('Invalid retry limit');
  if(options.recurrenceSeconds!==undefined&&(!Number.isInteger(options.recurrenceSeconds)||options.recurrenceSeconds<60||options.recurrenceSeconds>31536000))
   throw new Error('Invalid recurring interval');
  const {rows}=await (client??this.db).query<{id:string}>(`
   INSERT INTO md_durable_jobs
    (tenant_id,job_type,actor_user_id,app_api_name,resource_id,resource_version,scheduled_at,idempotency_key,max_attempts,recurrence_seconds)
   VALUES($1,$2,$3,$4,$5,$10,COALESCE($6,now()),$7,COALESCE($8,5),$9)
   ON CONFLICT(tenant_id,job_type,idempotency_key) WHERE idempotency_key IS NOT NULL
   DO UPDATE SET updated_at=md_durable_jobs.updated_at
   RETURNING id
  `,[tenantId,kind,options.actorUserId??null,options.appApiName??null,options.resourceId??null,
    options.scheduledAt??null,options.idempotencyKey??null,options.maxAttempts??null,options.recurrenceSeconds??null,options.resourceVersion??null]);
  return rows[0].id;
 }

 /** SKIP LOCKED allows many workers without duplicate successful leases. */
 async claim(workerId:string,limit=10,leaseSeconds=60) {
  if(!workerId||workerId.length>128)throw new Error('Invalid worker');
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid batch');
  if(!Number.isInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>3600)throw new Error('Invalid lease');
  return this.db.transaction(async (client:PoolClient)=>{
   const {rows}=await client.query<{id:string;tenant_id:string;job_type:string;actor_user_id:string|null;app_api_name:string|null;resource_id:string|null;resource_version:number|null;attempt:number}>(`
     WITH due AS (
      SELECT id FROM md_durable_jobs
      WHERE status='queued' AND scheduled_at<=now() AND attempt<max_attempts
      ORDER BY scheduled_at,id
      LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     UPDATE md_durable_jobs j
     SET status='leased',lease_owner=$2,lease_until=now()+($3::integer * interval '1 second'),
         attempt=j.attempt+1,updated_at=now()
     FROM due WHERE j.id=due.id AND j.attempt<j.max_attempts
     RETURNING j.id,j.tenant_id,j.job_type,j.actor_user_id,j.app_api_name,j.resource_id,j.resource_version,j.attempt
   `,[limit,workerId,leaseSeconds]);
   // Every abandoned lease is outcome-ambiguous. Fail closed for all registered
   // job types; only an authorised operator may approve a subsequent retry.
   await client.query(`UPDATE md_durable_jobs SET status='failed',lease_owner=NULL,
     lease_until=NULL,updated_at=now(),error_code='JOB_RECONCILIATION_REQUIRED'
     WHERE status='leased' AND lease_until<now()`);
   return rows;
  });
 }

 async complete(tenantId:string,id:string,workerId:string) {
  const {rowCount}=await this.db.query(`
   UPDATE md_durable_jobs SET
    status=CASE WHEN recurrence_seconds IS NULL THEN 'completed' ELSE 'queued' END,
    scheduled_at=CASE WHEN recurrence_seconds IS NULL THEN scheduled_at ELSE GREATEST(scheduled_at + recurrence_seconds * interval '1 second',now() + interval '1 second') END,
    attempt=CASE WHEN recurrence_seconds IS NULL THEN attempt ELSE 0 END,
    lease_owner=NULL,lease_until=NULL,updated_at=now()
   WHERE tenant_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3 AND lease_until>now()
  `,[tenantId,id,workerId]);
  if(!rowCount)throw new Error('Job lease missing or expired');
 }

 async fail(tenantId:string,id:string,workerId:string,errorCode:string,retryDelaySeconds=60) {
  if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(errorCode))throw new Error('Invalid error code');
  if(!Number.isInteger(retryDelaySeconds)||retryDelaySeconds<0||retryDelaySeconds>86400)
   throw new Error('Invalid retry delay');
  const {rowCount}=await this.db.query(`
   UPDATE md_durable_jobs SET
    status='failed',
    scheduled_at=now()+($5::integer * interval '1 second'),lease_owner=NULL,lease_until=NULL,
    error_code=$4,updated_at=now()
   WHERE tenant_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3 AND lease_until>now()
  `,[tenantId,id,workerId,errorCode,retryDelaySeconds]);
  if(!rowCount)throw new Error('Job lease missing or expired');
 }

 /** Inspect job outcome for operator reconciliation; never expose this without RBAC at the API. */
 async inspect(tenantId:string,id:string){
  const {rows}=await this.db.query<{id:string;status:string;attempt:number;error_code:string|null}>(
   'SELECT id,status,attempt,error_code FROM md_durable_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
  if(!rows[0])throw new Error('Job not found');
  return rows[0];
 }
 /** Explicit cancel of terminal failed work, preserving historical job state until reviewed. */
 async cancelFailed(tenantId:string,id:string,actorId?:string){
  const cancel=async(query:(sql:string,params:unknown[])=>Promise<{rowCount:number|null}>)=>{
   const {rowCount}=await query(`
    UPDATE md_durable_jobs SET status='cancelled',updated_at=now()
    WHERE tenant_id=$1 AND id=$2 AND status='failed'`,[tenantId,id]);
   if(!rowCount)throw new Error('Failed job not found');
   if(actorId)await query(
    'INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
    [tenantId,actorId,'durable_job.cancel',JSON.stringify({jobId:id})]);
  };
  if(actorId)await this.db.transaction(client=>cancel((sql,params)=>client.query(sql,params)));
  else await cancel((sql,params)=>this.db.query(sql,params));
 }

  /** Record an operator decision without silently replaying ambiguous side effects. */
 async reconcileFailed(tenantId:string,id:string,actorId:string,decision:'acknowledge'|'retry'){
  if(decision!=='acknowledge'&&decision!=='retry')throw new Error('Invalid job reconciliation');
  await this.db.transaction(async client=>{
   const {rowCount}=await client.query(`
    UPDATE md_durable_jobs SET
      status=CASE WHEN $4='retry' THEN 'queued' ELSE 'cancelled' END,
      attempt=CASE WHEN $4='retry' THEN 0 ELSE attempt END,
      scheduled_at=CASE WHEN $4='retry' THEN now() ELSE scheduled_at END,
      lease_owner=NULL,lease_until=NULL,
      error_code=CASE WHEN $4='retry' THEN NULL ELSE error_code END,
      updated_at=now()
    WHERE tenant_id=$1 AND id=$2 AND status='failed'
      AND EXISTS(SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$3 AND enabled=true)
   `,[tenantId,id,actorId,decision]);
   if(!rowCount)throw new Error('Failed job not found');
   await client.query(
    'INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
    [tenantId,actorId,'durable_job.reconcile',JSON.stringify({jobId:id,decision})]);
  });
 }

 async cancelApp(tenantId:string,appApiName:string) {
  return this.db.query(`
   UPDATE md_durable_jobs SET status='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=now()
   WHERE tenant_id=$1 AND app_api_name=$2 AND status IN ('queued','leased')
  `,[tenantId,appApiName]);
 }
}
