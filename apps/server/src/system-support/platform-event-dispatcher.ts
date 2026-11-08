import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {flowAppIsEntitled} from '../system-files/flow-validation.js';
import {DurableJobService} from './durable-job-service.js';

const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;

export class PlatformEventDispatcher {
 private readonly jobs:DurableJobService;
 constructor(private readonly db:SqlPersistence) {this.jobs=new DurableJobService(db);}

 async enqueuePending(limit=50) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid Platform Event batch size');
  return this.db.transaction(async(client:PoolClient)=>{
   const {rows:events}=await client.query<{
    id:string;tenant_id:string;event_api_name:string;status:string
   }>(`
    SELECT id,tenant_id,event_api_name,status FROM md_platform_event_messages
    WHERE status='pending' ORDER BY published_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
   `,[limit]);
   let queued=0;
   for(const event of events){
    if(!identifier.test(event.event_api_name))throw new Error('Invalid stored Platform Event name');
    const {rows:definition}=await client.query(`
     SELECT 1 FROM md_system_definitions
     WHERE tenant_id=$1 AND kind='platform-events' AND api_name=$2 AND enabled=true`,
     [event.tenant_id,event.event_api_name]);
    if(!definition.length){
     await client.query(`UPDATE md_platform_event_messages SET status='failed',error_code='EVENT_DISABLED'
      WHERE tenant_id=$1 AND id=$2 AND status='pending'`,[event.tenant_id,event.id]);
     continue;
    }
    const {rows:actors}=await client.query<{flow_service_user_id:string}>(`
     SELECT s.flow_service_user_id FROM md_tenant_automation_settings s
     JOIN md_users u ON u.tenant_id=s.tenant_id AND u.id=s.flow_service_user_id AND u.enabled=true
     WHERE s.tenant_id=$1 AND s.flow_service_user_id IS NOT NULL`,
     [event.tenant_id]);
    if(!actors[0])continue;
    const {rows:subscriptions}=await client.query<{
     id:string;api_name:string;version:number;app_api_name:string|null
    }>(`
     SELECT f.id,f.api_name,f.version,s.app_api_name
     FROM md_flow_trigger_subscriptions s
     JOIN md_flow_definitions f ON f.tenant_id=s.tenant_id AND f.id=s.flow_id
     WHERE s.tenant_id=$1 AND s.flow_type='Platform Event-Triggered Flow'
      AND s.trigger_key=$2 AND s.active=true AND f.active=true AND f.archived=false
     ORDER BY f.api_name LIMIT 501
    `,[event.tenant_id,event.event_api_name]);
    if(subscriptions.length>500)throw new Error('Platform Event subscriber limit exceeded (500)');
    for(const subscription of subscriptions){
     const {rows:inserted}=await client.query<{id:string;status:string}>(`
      INSERT INTO md_platform_event_deliveries
       (tenant_id,event_id,flow_id,flow_version,actor_user_id)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,event_id,flow_id) DO UPDATE
       SET flow_version=EXCLUDED.flow_version,actor_user_id=EXCLUDED.actor_user_id
       WHERE md_platform_event_deliveries.status='queued'
      RETURNING id,status`,
      [event.tenant_id,event.id,subscription.id,subscription.version,
       actors[0].flow_service_user_id]);
     const delivery=inserted[0];
     if(!delivery)continue;
     if(!await flowAppIsEntitled(this.db,event.tenant_id,subscription.app_api_name)){
      await client.query(`UPDATE md_platform_event_deliveries
       SET status='failed',error_code='APP_NOT_ENTITLED',completed_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='queued'`,[event.tenant_id,delivery.id]);
      continue;
     }
     await this.jobs.enqueue(event.tenant_id,'flow.platform-event',{
      actorUserId:actors[0].flow_service_user_id,appApiName:subscription.app_api_name??undefined,
      resourceId:delivery.id,resourceVersion:subscription.version,maxAttempts:1,
      idempotencyKey:'platform-event-delivery:'+delivery.id
     },client);
     queued++;
    }
    const remaining=await client.query(`
     SELECT 1 FROM md_platform_event_deliveries
     WHERE tenant_id=$1 AND event_id=$2 AND status='queued' LIMIT 1`,
     [event.tenant_id,event.id]);
    await client.query(`UPDATE md_platform_event_messages SET status=$3
     WHERE tenant_id=$1 AND id=$2 AND status='pending'`,
     [event.tenant_id,event.id,remaining.rows.length?'queued':'completed']);
   }
   return {events:events.length,queued};
  });
 }
}
