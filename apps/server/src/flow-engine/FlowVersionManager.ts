import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

type SubscriptionFlow={
 active:boolean;flowType:string;elements:unknown[];appApiName?:unknown;
};

export async function syncFlowTriggerSubscription(client:PoolClient,tenantId:string,
 apiName:string,flowId:string,flow:SubscriptionFlow) {
 await client.query(`
  UPDATE md_flow_trigger_subscriptions SET active=false,updated_at=now()
  WHERE tenant_id=$1 AND flow_id IN (
   SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2
  )`,[tenantId,apiName]);
 if(!flow.active||!['Record-Triggered Flow','Schedule-Triggered Flow',
   'Platform Event-Triggered Flow'].includes(flow.flowType))return;
 const start=flow.elements.find(item=>item&&typeof item==='object'&&!Array.isArray(item)
  &&(item as Record<string,unknown>).type==='Start') as
   {config?:Record<string,unknown>}|undefined;
 const config=start?.config;
 const key=flow.flowType==='Platform Event-Triggered Flow'
  ?config?.eventName??config?.object:config?.object;
 if(typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))
  throw new Error('Active Flow trigger subscription has no valid trigger key');
 const appApiName=typeof flow.appApiName==='string'?flow.appApiName:null;
 await client.query(`
  INSERT INTO md_flow_trigger_subscriptions
   (tenant_id,flow_id,flow_type,trigger_key,app_api_name,active)
  VALUES($1,$2,$3,$4,$5,true)
  ON CONFLICT(tenant_id,flow_id) DO UPDATE SET flow_type=EXCLUDED.flow_type,
   trigger_key=EXCLUDED.trigger_key,app_api_name=EXCLUDED.app_api_name,
   active=true,updated_at=now()
 `,[tenantId,flowId,flow.flowType,key,appApiName]);
}

export async function disableFlowTriggerSubscriptions(client:PoolClient,
 tenantId:string,apiName:string) {
 await client.query(`
  UPDATE md_flow_trigger_subscriptions SET active=false,updated_at=now()
  WHERE tenant_id=$1 AND flow_id IN (
   SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2
  )`,[tenantId,apiName]);
}

export async function cancelScheduledPathInterviews(client:PoolClient,
  tenantId:string,apiName:string,exceptFlowId?:string) {
  await client.query(`
   WITH cancelled AS (
    UPDATE md_flow_runs r SET status='cancelled',finished_at=now(),wait_until=NULL
    WHERE r.tenant_id=$1 AND r.status='waiting' AND r.wait_kind='scheduled-path'
     AND r.flow_id IN (SELECT f.id FROM md_flow_definitions f
      WHERE f.tenant_id=$1 AND f.api_name=$2 AND ($3::uuid IS NULL OR f.id<>$3::uuid))
    RETURNING r.id
   )
   UPDATE md_durable_jobs j SET status='cancelled',lease_owner=NULL,lease_until=NULL,
    updated_at=now()
   WHERE j.tenant_id=$1 AND j.job_type='flow.resume' AND j.status IN ('queued','leased')
    AND j.resource_id IN (SELECT id::text FROM cancelled)
  `,[tenantId,apiName,exceptFlowId??null]);
}

export async function deactivateFlowDefinition(db:SqlPersistence,tenantId:string,
   apiName:string,archive=false) {
  return db.transaction(async client=>{
   const {rowCount}=await client.query(archive
    ?`UPDATE md_flow_definitions SET active=false,archived=true
      WHERE tenant_id=$1 AND api_name=$2 AND archived=false`
    :`UPDATE md_flow_definitions SET active=false
      WHERE tenant_id=$1 AND api_name=$2 AND active=true`,[tenantId,apiName]);
   if(rowCount){
    await disableFlowTriggerSubscriptions(client,tenantId,apiName);
    await cancelScheduledPathInterviews(client,tenantId,apiName);
   }
   return rowCount;
  });
}
