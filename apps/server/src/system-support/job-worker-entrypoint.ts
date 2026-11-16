import {randomUUID} from 'node:crypto';
import {SqlPersistence} from '../system-files/sql-persistence.js';
import {RbacEngine} from '../system-files/rbac-engine.js';
import {RecordEngine} from '../system-files/record-engine.js';
import {FlowRuntime} from '../system-files/flow-runtime.js';
import {NamedCredentialService} from './named-credential-service.js';
import {DurableJobService} from './durable-job-service.js';
import {DurableJobWorker,type ClaimedJob} from './durable-job-worker.js';
import {registerScheduledActionWorker} from './scheduled-action-service.js';
import {registerFlowJobHandler} from './flow-job-handler.js';
import {FlowRecordTriggers} from '../system-files/flow-record-triggers.js';
import {ScheduledFlowDispatcher} from './scheduled-flow-dispatcher.js';
import {PlatformEventDispatcher} from './platform-event-dispatcher.js';
import {OutboundWebhookDispatcher,registerOutboundWebhookJobHandler}
 from './outbound-webhook-worker.js';
import {decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';
import {applySystemMigrations} from './system-migrations.js';

export async function startDurableJobWorker(env:NodeJS.ProcessEnv=process.env) {
 const db=new SqlPersistence(env.DATABASE_URL??'');
 try {
  await applySystemMigrations(db);
  const rbac=new RbacEngine(db);
  const records=new RecordEngine(db,rbac);
  const credentials=new NamedCredentialService(db,rbac);
  const service=new DurableJobService(db);
  const flows=new FlowRuntime(db,rbac,records,
   (tenant,user,config,vars,key)=>credentials.callout(tenant,user,config,vars,key),
   async (client,tenant,user,flowApi,version,runId,scheduledAt,step,providedAppApiName)=>{
    const {rows}=await client.query<MetadataValueRow>(`
     SELECT v.property_path,v.value_kind,v.value_text FROM md_flow_editor_values v
     JOIN md_flow_definitions f ON f.tenant_id=v.tenant_id AND f.id=v.flow_id
     WHERE f.tenant_id=$1 AND f.api_name=$2 AND f.version=$3 AND f.active=true
      AND f.archived=false`,[tenant,flowApi,version]);
    const graph=decodeMetadataValues(rows).builder as Record<string,unknown>|undefined;
    const appApiName=providedAppApiName??(typeof graph?.appApiName==='string'&&graph.appApiName
     ?graph.appApiName:undefined);
    await service.enqueue(tenant,'flow.resume',{actorUserId:user,resourceId:runId,
     resourceVersion:version,appApiName,scheduledAt,idempotencyKey:runId+':'+step},client);
   },
   async(client,tenant,user,flowId,version,runId,nodeId,step,message)=>{
    await credentials.enqueueFlowEmail(client,tenant,user,flowId,version,runId,nodeId,step,
     message.credentialId,message.from,message.recipients,message.subject,message.body);
   });
  const flowTriggers=new FlowRecordTriggers(rbac,flows,records,db,
   async(client,tenant,user,flowApi,version,runId,scheduledAt,step,appApiName)=>{
    await service.enqueue(tenant,'flow.resume',{actorUserId:user,resourceId:runId,
     resourceVersion:version,...(appApiName?{appApiName}:{}),scheduledAt,
     idempotencyKey:runId+':'+step},client);
   });
  const scheduledFlows=new ScheduledFlowDispatcher(db);
  const platformEvents=new PlatformEventDispatcher(db);
  const outboundWebhooks=new OutboundWebhookDispatcher(db);
  let authorize:((job:ClaimedJob)=>Promise<boolean>)|undefined;
  const worker=new DurableJobWorker(service,job=>authorize?.(job)??Promise.resolve(false),
   'metadrive-'+randomUUID());
  const authorizeFlow=registerFlowJobHandler(worker,db,rbac,flows,flowTriggers);
  const authorizeWebhook=registerOutboundWebhookJobHandler(worker,db,rbac,credentials);
  const authorizeScheduled=registerScheduledActionWorker(worker,db,rbac,records,credentials,flows);
  authorize=job=>job.job_type==='webhook.deliver'?authorizeWebhook(job):
   job.job_type==='scheduled.action'?authorizeScheduled(job):authorizeFlow(job);
  const interval=Number(env.METADRIVE_WORKER_POLL_MS??'5000');
  if(!Number.isInteger(interval)||interval<1000||interval>60000)throw new Error('Invalid worker poll interval');
  let running=true;
  const terminate=()=>{running=false;};
  process.once('SIGTERM',terminate);
  process.once('SIGINT',terminate);
  try {
   while(running){
    try { await scheduledFlows.enqueueDue(); }
    catch(error){console.error('Scheduled Flow dispatch failed',error);}
    try { await platformEvents.enqueuePending(); }
    catch(error){console.error('Platform Event dispatch failed',error);}
    try { await outboundWebhooks.enqueuePending(); }
    catch(error){console.error('Outbound webhook dispatch failed',error);}
    try { await credentials.dispatchOneFlowEmail(); }
    catch(error){console.error('Flow email dispatch failed',error);}
    try { await worker.runOnce(10); }
    catch(error){console.error('Durable job poll failed',error);}
    // The independent worker also runs shared encrypted HTTP Callout delivery.
    // Claims use tenant-scoped SQL row locks; uncertain outcomes stay quarantined.
    try { await credentials.dispatchOne(); }
    catch(error){console.error('Durable HTTP Callout poll failed',error);}
    if(running)await new Promise<void>(resolve=>setTimeout(resolve,interval));
   }
  } finally {
   process.removeListener('SIGTERM',terminate);
   process.removeListener('SIGINT',terminate);
  }
 } finally {await db.close();}
}
startDurableJobWorker().catch(error=>{console.error('Durable worker startup failed',error);process.exitCode=1;});
