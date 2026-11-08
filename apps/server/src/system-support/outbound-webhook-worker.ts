import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {DurableJobService} from './durable-job-service.js';
import type {DurableJobWorker,ClaimedJob} from './durable-job-worker.js';
import type {NamedCredentialService} from './named-credential-service.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OutboundWebhookDispatcher {
 private readonly jobs:DurableJobService;
 constructor(private readonly db:SqlPersistence){
  this.jobs=new DurableJobService(db);
 }

 async enqueuePending(limit=100){
  if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Invalid webhook dispatch batch size');
  return this.db.transaction(async client=>{
   const {rows}=await client.query<{
    tenant_id:string;subscription_id:string;event_id:string;delivery_id:string;
    actor_user_id:string;api_name:string
   }>(`
    SELECT s.tenant_id,s.id AS subscription_id,e.id AS event_id,
     s.created_by AS actor_user_id,s.api_name,
     gen_random_uuid() AS delivery_id
    FROM md_webhook_subscriptions s
    JOIN md_platform_event_messages e ON e.tenant_id=s.tenant_id
     AND e.event_api_name=s.event_api_name AND e.replay_id>=s.start_replay_id
    JOIN md_system_definitions d ON d.tenant_id=s.tenant_id
     AND d.kind='platform-events' AND d.api_name=e.event_api_name AND d.enabled=true
    WHERE s.enabled=true
     AND NOT EXISTS(SELECT 1 FROM md_webhook_deliveries x
      WHERE x.tenant_id=s.tenant_id AND x.subscription_id=s.id AND x.event_id=e.id)
    ORDER BY e.replay_id,s.api_name LIMIT $1 FOR UPDATE OF s,e SKIP LOCKED`,
    [limit]);
   let queued=0;
   for(const item of rows){
    const {rows:delivery}=await client.query<{id:string}>(`
     INSERT INTO md_webhook_deliveries(tenant_id,id,subscription_id,event_id)
     VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,subscription_id,event_id) DO NOTHING
     RETURNING id`,[item.tenant_id,item.delivery_id,item.subscription_id,item.event_id]);
    if(!delivery[0])continue;
    await this.jobs.enqueue(item.tenant_id,'webhook.deliver',{
     actorUserId:item.actor_user_id,resourceId:delivery[0].id,maxAttempts:1,
     idempotencyKey:'webhook-delivery:'+delivery[0].id
    },client);
    queued++;
   }
   return {deliveries:rows.length,queued};
  });
 }
}

async function webhookDetails(db:SqlPersistence,job:ClaimedJob){
 if(!job.resource_id||!uuid.test(job.resource_id)||!job.actor_user_id)return null;
 const {rows}=await db.query<{
  api_name:string;event_api_name:string;credential_id:string;relative_path:string;
  event_id:string;published_at:Date;replay_id:string
 }>(`
  SELECT s.api_name,s.event_api_name,s.credential_id,s.relative_path,e.id AS event_id,
   e.published_at,e.replay_id::text
  FROM md_webhook_deliveries x
  JOIN md_webhook_subscriptions s ON s.tenant_id=x.tenant_id AND s.id=x.subscription_id
  JOIN md_platform_event_messages e ON e.tenant_id=x.tenant_id AND e.id=x.event_id
  JOIN md_system_definitions d ON d.tenant_id=e.tenant_id
   AND d.kind='platform-events' AND d.api_name=e.event_api_name AND d.enabled=true
  JOIN md_named_credentials c ON c.tenant_id=s.tenant_id AND c.id=s.credential_id
   AND c.protocol='HTTPS' AND c.enabled=true
  WHERE x.tenant_id=$1 AND x.id=$2 AND x.status='queued' AND s.enabled=true
   AND s.created_by=$3 AND s.event_api_name=e.event_api_name`,
  [job.tenant_id,job.resource_id,job.actor_user_id]);
 return rows[0]??null;
}

async function failDelivery(db:SqlPersistence,tenantId:string,id:string,code:string){
 await db.query(`UPDATE md_webhook_deliveries SET status='failed',error_code=$3,
  completed_at=now() WHERE tenant_id=$1 AND id=$2 AND status='queued'`,
  [tenantId,id,code]);
}

export function registerOutboundWebhookJobHandler(worker:DurableJobWorker,db:SqlPersistence,
 rbac:RbacEngine,credentials:NamedCredentialService){
 worker.register('webhook.deliver',async job=>{
  const details=await webhookDetails(db,job);
  if(!details||!job.actor_user_id||!job.resource_id)
   throw new Error('Webhook delivery is unavailable');
  const {rows:values}=await db.query<{
   field_api:string;value_kind:string;value_text:string|null
  }>(`SELECT field_api,value_kind,value_text FROM md_platform_event_values
   WHERE tenant_id=$1 AND event_id=$2 ORDER BY field_api`,
   [job.tenant_id,details.event_id]);
  const payload:Record<string,unknown>={};
  for(const value of values){
   payload[value.field_api]=value.value_kind==='null'?null:
    value.value_kind==='number'?Number(value.value_text):
    value.value_kind==='boolean'?value.value_text==='true':value.value_text;
  }
  try{
   const result=await credentials.callout(job.tenant_id,job.actor_user_id,{
    namedCredentialId:details.credential_id,method:'POST',path:details.relative_path,
    body:JSON.stringify({eventApiName:details.event_api_name,eventId:details.event_id,
     replayId:details.replay_id,createdDate:new Date(details.published_at).toISOString(),
     payload}),timeoutMs:15000
   },{},'webhook:'+job.resource_id);
   const {rowCount}=await db.query(`UPDATE md_webhook_deliveries SET status='delivered',
    response_status=$3,completed_at=now()
    WHERE tenant_id=$1 AND id=$2 AND status='queued'`,
    [job.tenant_id,job.resource_id,result.status]);
   if(!rowCount)throw new Error('Webhook delivery state changed before completion');
  }catch(error){
   await failDelivery(db,job.tenant_id,job.resource_id,'DELIVERY_FAILED');
   throw error;
  }
 });
 return async(job:ClaimedJob)=>{
  if(job.job_type!=='webhook.deliver'||!job.actor_user_id||!job.resource_id
   ||!uuid.test(job.resource_id))return false;
   const {rows:actors}=await db.query(`SELECT 1 FROM md_users u
    JOIN md_tenants t ON t.id=u.tenant_id AND t.status='ACTIVE'
    WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true`,
    [job.tenant_id,job.actor_user_id]);
   if(!actors.length){
    await failDelivery(db,job.tenant_id,job.resource_id,'AUTHORIZATION_CHANGED');
    return false;
   }
   const details=await webhookDetails(db,job);
   let authorized=false;
   if(details){
    authorized=await rbac.allowed(job.tenant_id,job.actor_user_id,'WebhookSubscription','execute')
     &&await rbac.allowed(job.tenant_id,job.actor_user_id,
      'PlatformEvent:'+details.event_api_name,'subscribe')
     &&await rbac.allowed(job.tenant_id,job.actor_user_id,'NamedCredential','read')
     &&await rbac.allowed(job.tenant_id,job.actor_user_id,'HTTPCallout','execute');
   }
  if(!authorized)await failDelivery(db,job.tenant_id,job.resource_id,'AUTHORIZATION_CHANGED');
  return authorized;
 };
}
