import {executeResumeEventNode} from '../system-files/nodes/ResumeEventNode.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {FlowRecordTriggers} from '../system-files/flow-record-triggers.js';
import {decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';
import {flowAppIsEntitled} from '../system-files/flow-validation.js';
import type {ClaimedJob,DurableJobWorker} from './durable-job-worker.js';

async function configuredFlowApp(db:SqlPersistence,tenantId:string,flowId:string) {
 const {rows}=await db.query<MetadataValueRow>(`
  SELECT property_path,value_kind,value_text FROM md_flow_editor_values
  WHERE tenant_id=$1 AND flow_id=$2`,[tenantId,flowId]);
 const graph=decodeMetadataValues(rows).builder as Record<string,unknown>|undefined;
 return typeof graph?.appApiName==='string'&&graph.appApiName?graph.appApiName:null;
}
async function failPlatformEventDelivery(db:SqlPersistence,tenantId:string,deliveryId:string) {
 const {rows}=await db.query<{event_id:string}>(`
  WITH failed AS (
   UPDATE md_platform_event_deliveries SET status='failed',
    error_code='AUTHORIZATION_CHANGED',completed_at=now()
   WHERE tenant_id=$1 AND id=$2 AND status='queued' RETURNING tenant_id,event_id
  )
  UPDATE md_platform_event_messages e SET status='completed'
  FROM failed d WHERE e.tenant_id=d.tenant_id AND e.id=d.event_id
   AND NOT EXISTS(SELECT 1 FROM md_platform_event_deliveries x
    WHERE x.tenant_id=d.tenant_id AND x.event_id=d.event_id AND x.status='queued')
  RETURNING e.id AS event_id`,[tenantId,deliveryId]);
 return rows.length>0;
}

/** Authorize every delivery; queued jobs never acquire implicit system rights. */
export function registerFlowJobHandler(worker:DurableJobWorker,db:SqlPersistence,
  rbac:RbacEngine,flows:FlowRuntime,triggers?:FlowRecordTriggers){
 const authorize=async(job:ClaimedJob)=>{
  if(!['flow.execute','flow.resume','flow.scheduled','flow.platform-event'].includes(job.job_type)||!job.actor_user_id
    ||!job.resource_id||!job.resource_version)return false;
  const {rows:actors}=await db.query(
   `SELECT 1 FROM md_users u
     JOIN md_tenants t ON t.id=u.tenant_id AND t.status='ACTIVE'
     WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true`,
   [job.tenant_id,job.actor_user_id]);
  if(!actors.length){
   if(job.job_type==='flow.platform-event'&&/^[0-9a-f-]{36}$/i.test(job.resource_id))
    await failPlatformEventDelivery(db,job.tenant_id,job.resource_id);
   return false;
  }
  let flowApi:string;
  if(job.job_type==='flow.execute'){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(job.resource_id))return false;
   flowApi=job.resource_id;
   const {rows:published}=await db.query<{id:string;flow_type:string}>(`
    SELECT id,flow_type FROM md_flow_definitions
    WHERE tenant_id=$1 AND api_name=$2 AND version=$3 AND active=true AND archived=false LIMIT 1`,
    [job.tenant_id,flowApi,job.resource_version]);
   if(!published.length||['Record-Triggered Flow','Schedule-Triggered Flow',
      'Platform Event-Triggered Flow'].includes(published[0].flow_type))return false;
   if(await configuredFlowApp(db,job.tenant_id,published[0].id)!==(job.app_api_name??null))
    return false;
  }else if(job.job_type==='flow.resume'){
   if(!/^[0-9a-f-]{36}$/i.test(job.resource_id))return false;
   const {rows:waiting}=await db.query<{api_name:string;flow_id:string}>(`
    SELECT f.api_name,f.id AS flow_id FROM md_flow_runs r
    JOIN md_flow_definitions f ON f.tenant_id=r.tenant_id AND f.id=r.flow_id
    WHERE r.tenant_id=$1 AND r.id=$2 AND r.started_by=$3 AND r.status='waiting'
      AND r.wait_until<=now() AND f.version=$4 AND f.active=true AND f.archived=false`,
    [job.tenant_id,job.resource_id,job.actor_user_id,job.resource_version]);
   if(!waiting[0])return false;
   flowApi=waiting[0].api_name;
   if(await configuredFlowApp(db,job.tenant_id,waiting[0].flow_id)!==(job.app_api_name??null))
    return false;
  }else if(job.job_type==='flow.scheduled'){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(job.resource_id))return false;
   flowApi=job.resource_id;
   const {rows:published}=await db.query(`
    SELECT 1 FROM md_flow_definitions f
    JOIN md_flow_trigger_subscriptions s ON s.tenant_id=f.tenant_id AND s.flow_id=f.id
    WHERE f.tenant_id=$1 AND f.api_name=$2 AND f.version=$3
      AND f.flow_type='Schedule-Triggered Flow' AND s.flow_type=f.flow_type AND s.active=true
      AND f.active=true AND f.archived=false LIMIT 1`,
    [job.tenant_id,flowApi,job.resource_version]);
   if(!published.length)return false;
   const {rows:active}=await db.query<{id:string}>(`
    SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 AND version=$3
     AND active=true AND archived=false`,[job.tenant_id,flowApi,job.resource_version]);
   if(!active[0])return false;
   const configuredApp=await configuredFlowApp(db,job.tenant_id,active[0].id);
   if(configuredApp!==(job.app_api_name??null))return false;
  }else{
   if(!/^[0-9a-f-]{36}$/i.test(job.resource_id))return false;
   const {rows:deliveries}=await db.query<{api_name:string;app_api_name:string|null}>(`
    SELECT f.api_name,s.app_api_name
    FROM md_platform_event_deliveries d
    JOIN md_platform_event_messages e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
    JOIN md_flow_definitions f ON f.tenant_id=d.tenant_id AND f.id=d.flow_id
    JOIN md_flow_trigger_subscriptions s ON s.tenant_id=f.tenant_id AND s.flow_id=f.id
    JOIN md_tenant_automation_settings a ON a.tenant_id=d.tenant_id
     AND a.flow_service_user_id=d.actor_user_id
    WHERE d.tenant_id=$1 AND d.id=$2 AND d.actor_user_id=$3 AND d.flow_version=$4
     AND d.status='queued' AND e.status='queued' AND f.version=d.flow_version
     AND f.flow_type='Platform Event-Triggered Flow' AND f.active=true AND f.archived=false
     AND s.active=true AND s.flow_type=f.flow_type AND s.trigger_key=e.event_api_name
     AND EXISTS(SELECT 1 FROM md_system_definitions x WHERE x.tenant_id=d.tenant_id
      AND x.kind='platform-events' AND x.api_name=e.event_api_name AND x.enabled=true)`,
    [job.tenant_id,job.resource_id,job.actor_user_id,job.resource_version]);
   if(!deliveries[0]||deliveries[0].app_api_name!==(job.app_api_name??null)){
    await failPlatformEventDelivery(db,job.tenant_id,job.resource_id);
    return false;
   }
   flowApi=deliveries[0].api_name;
  }
  const authorized=await flowAppIsEntitled(db,job.tenant_id,job.app_api_name)
   &&await rbac.allowed(job.tenant_id,job.actor_user_id,'Flow:'+flowApi,'execute');
  if(!authorized&&job.job_type==='flow.platform-event')
   await failPlatformEventDelivery(db,job.tenant_id,job.resource_id);
  return authorized;
 };
 worker.register('flow.execute',async job=>{
  // An expired lease may mean a prior attempt already sent external effects.
  // Fail closed instead of replaying a potentially non-idempotent Flow.
  if(job.attempt>1)throw new Error('Flow replay requires explicit reconciliation');
  if(!await authorize(job))throw new Error('Job authorization changed');
  const current=await flows.loadActive(job.tenant_id,job.resource_id!);
  if(current.version!==job.resource_version)throw new Error('Published Flow version changed');
  await flows.execute(job.tenant_id,job.resource_id!,job.actor_user_id!,{});
 });
 worker.register('flow.resume',async job=>{
  await executeResumeEventNode({
   attempt:job.attempt,tenantId:job.tenant_id,userId:job.actor_user_id!,
   runId:job.resource_id!,version:job.resource_version!,flows,
   authorize:()=>authorize(job)
  });
 });
 worker.register('flow.scheduled',async job=>{
  if(job.attempt>1)throw new Error('Flow replay requires explicit reconciliation');
  if(!triggers)throw new Error('Scheduled Flow dispatcher is not configured');
  if(!await authorize(job))throw new Error('Job authorization changed');
  await triggers.executeScheduledFlow(job.tenant_id,job.actor_user_id!,
   job.resource_id!,job.resource_version!);
 });
 worker.register('flow.platform-event',async job=>{
  if(job.attempt>1)throw new Error('Platform Event Flow replay requires explicit reconciliation');
  if(!triggers)throw new Error('Platform Event dispatcher is not configured');
  if(!await authorize(job))throw new Error('Job authorization changed');
  await triggers.executePlatformEventDelivery(job.tenant_id,job.actor_user_id!,
   job.resource_id!,job.resource_version!);
 });
 return authorize;
}
