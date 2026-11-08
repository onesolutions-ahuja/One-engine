import {AsyncLocalStorage} from 'node:async_hooks';
import type {PoolClient} from 'pg';
import type {RbacEngine} from '../../system-files/rbac-engine.js';
import type {FlowRuntime} from '../../system-files/flow-runtime.js';
import type {SqlPersistence} from '../../system-files/sql-persistence.js';
import type {RecordEngine} from '../../system-files/record-engine.js';
import {decodeMetadataValues,type MetadataValueRow} from '../../system-files/component-runtime.js';
import {evaluateFlowDecisionOutcome} from '../../system-files/flow-decision-runtime.js';
import {flowAppIsEntitled} from '../../system-files/flow-validation.js';
import {auditSystemFlowContext,flowExecutionMode,resolveFlowExecutionActor,
  type FlowExecutionActor} from '../../system-files/flow-execution-context.js';
import {resolveFlowScheduledPathAt} from '../../system-files/flow-wait-runtime.js';
import {orderTriggeredFlows,validateTriggerDependencies} from '../record-trigger-dependencies.js';

type TriggerOperation='created'|'updated'|'deleted';
type TriggerPhase='before-save'|'after-save';
type Snapshot=Record<string,unknown>;
type Candidate={id:string;api_name:string;version:number;app_api_name?:string|null;
 system_context_approved_by?:string|null};
type TriggerDocument={
 flowType?:string;triggerObject?:string;
 startConfig?:Record<string,unknown>;
 elements?:Array<{id:number;type:string;config:Record<string,unknown>}>;
 resources?:unknown[];
 connectors?:Array<{from?:unknown;to?:unknown;kind?:unknown;scheduledPath?:unknown}>;
};
type ScheduleResume=(client:PoolClient,tenantId:string,userId:string,flowApi:string,
 version:number,runId:string,scheduledAt:Date,step:number,appApiName?:string)=>Promise<void>;
const scalar=(value:unknown):value is string|number|boolean|null=>
 value===null||typeof value==='string'||typeof value==='boolean'
 ||typeof value==='number'&&Number.isFinite(value);
const asString=(value:unknown)=>typeof value==='string'?value:'';
const maxTriggerExecutions=50;
const maxScheduledPathInterviews=100;

function conditionValue(value:unknown,actual:unknown):unknown {
 if(typeof actual==='number'&&typeof value==='string'&&value.trim()){
  const parsed=Number(value);
  if(Number.isFinite(parsed))return parsed;
 }
 if(typeof actual==='boolean'&&(value==='true'||value==='false'))return value==='true';
 return value;
}

export class FlowRecordTriggers {
 private readonly flowExecution=new AsyncLocalStorage<boolean>();
 constructor(private readonly rbac:RbacEngine,private readonly flows:FlowRuntime,
  private readonly records?:RecordEngine,private readonly db?:SqlPersistence,
  private readonly scheduleResume?:ScheduleResume){}

 async executeScheduledFlow(tenantId:string,userId:string,flowApi:string,version:number){
  if(!this.db||!this.records)throw new Error('Scheduled Flow dispatcher is not configured');
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(flowApi)||!Number.isSafeInteger(version)||version<1)
   throw new Error('Invalid scheduled Flow identity');
  await this.rbac.require(tenantId,userId,'Flow:'+flowApi,'execute');
  const {rows}=await this.db.query<{id:string;version:number;app_api_name:string|null;
   system_context_approved_by:string|null}>(`
  SELECT f.id,f.version,f.system_context_approved_by,s.app_api_name FROM md_flow_definitions f
  JOIN md_flow_trigger_subscriptions s ON s.tenant_id=f.tenant_id AND s.flow_id=f.id
  WHERE f.tenant_id=$1 AND f.api_name=$2 AND f.flow_type='Schedule-Triggered Flow'
   AND s.flow_type=f.flow_type AND s.active=true
   AND f.version=$3 AND f.active=true AND f.archived=false
  `,[tenantId,flowApi,version]);
  const flow=rows[0];
  if(!flow)throw new Error('Active scheduled Flow version not found');
  const {rows:values}=await this.db.query<MetadataValueRow>(`
   SELECT property_path,value_kind,value_text FROM md_flow_editor_values
   WHERE tenant_id=$1 AND flow_id=$2`,[tenantId,flow.id]);
  const graph=decodeMetadataValues(values).builder as TriggerDocument|undefined;
  if(!await flowAppIsEntitled(this.db,tenantId,flow.app_api_name??null))
   throw new Error('Scheduled Flow app is no longer installed or entitled');
  if(!graph||!Array.isArray(graph.elements)||!Array.isArray(graph.connectors))
   throw new Error('Invalid scheduled Flow graph');
  const start=graph.elements.find(element=>element.type==='Start');
  if(!start||typeof start.config.object!=='string')
   throw new Error('Scheduled Flow has no valid Start configuration');
  const executionActor=await resolveFlowExecutionActor(this.db,this.rbac,tenantId,flowApi,
   userId,flowExecutionMode(start.config.executionContext),flow.system_context_approved_by);
  const objectApi=start.config.object;
  const conditions=Array.isArray(start.config.entryConditions)
   ?start.config.entryConditions as Array<Record<string,unknown>>:[];
  const fields=[...new Set(conditions.map(condition=>asString(condition.field)))];
  for(const field of fields){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
    throw new Error('Scheduled Flow entry condition has an invalid field');
   await this.rbac.require(tenantId,userId,objectApi+'.'+field,'read');
  }
  const matching:Snapshot[]=[];
  let total=0;
  for(let offset=0;;offset+=100){
   const page=await this.records.list(tenantId,userId,objectApi,100,offset);
   total=page.total;
   if(total>500)throw new Error('Scheduled Flow record limit exceeded (500)');
   for(const row of page.records){
    const match=conditions.length===0||evaluateFlowDecisionOutcome(conditions.map(condition=>{
     const field=asString(condition.field),actual=row[field];
     return {...condition,field:actual,value:conditionValue(condition.value,actual)};
    }),typeof start.config.conditionLogic==='string'?start.config.conditionLogic:undefined,
    value=>value,value=>value!==undefined);
    if(match)matching.push(row);
   }
   if(offset+page.records.length>=total||page.records.length===0)break;
  }
  if(matching.length>500)throw new Error('Scheduled Flow execution limit exceeded (500)');
  for(const record of matching){
   const id=record.Id;
   if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))
    throw new Error('Scheduled Flow received a record without a valid ID');
   const result=await this.db.transaction(async client=>{
    const created=await client.query<{id:string}>(`
     INSERT INTO md_flow_runs
      (tenant_id,flow_id,started_by,initiated_by,execution_context,status)
     VALUES($1,$2,$3,$4,$5,'pending') RETURNING id`,
    [tenantId,flow.id,executionActor.actorUserId,userId,executionActor.mode]);
    const runId=created.rows[0]?.id;
    if(!runId)throw new Error('Unable to create scheduled Flow run');
    if(executionActor.mode==='System')await auditSystemFlowContext(client,tenantId,flow.id,
     executionActor.actorUserId,userId,'system-context-run',runId);
    await client.query(`INSERT INTO md_flow_interview_state(tenant_id,run_id,current_element)
     VALUES($1,$2,$3)`,[tenantId,runId,start.id]);
    await this.persistRecord(client,tenantId,runId,'$Record',objectApi,record,id);
    return this.flows.advanceInterview(tenantId,executionActor.actorUserId,runId,{},client);
   });
   const status='status' in result?result.status:undefined;
   if(status!=='completed'&&status!=='waiting')
    throw new Error('Scheduled Flow interview returned an invalid state');
  }
  return {flowApi,version,records:matching.length};
 }

 async executePlatformEventDelivery(tenantId:string,userId:string,deliveryId:string,version:number){
  if(!this.db||!/^[0-9a-f-]{36}$/i.test(deliveryId)||!Number.isSafeInteger(version)||version<1)
   throw new Error('Invalid Platform Event delivery');
  const {rows}=await this.db.query<{
   event_id:string;event_api_name:string;flow_id:string;flow_api:string;app_api_name:string|null;
   system_context_approved_by:string|null
  }>(`
   SELECT d.event_id,e.event_api_name,f.id AS flow_id,f.api_name AS flow_api,
    f.system_context_approved_by,s.app_api_name
   FROM md_platform_event_deliveries d
   JOIN md_platform_event_messages e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
   JOIN md_flow_definitions f ON f.tenant_id=d.tenant_id AND f.id=d.flow_id
   JOIN md_flow_trigger_subscriptions s ON s.tenant_id=f.tenant_id AND s.flow_id=f.id
   JOIN md_tenant_automation_settings a ON a.tenant_id=d.tenant_id
    AND a.flow_service_user_id=d.actor_user_id
   WHERE d.tenant_id=$1 AND d.id=$2 AND d.actor_user_id=$3 AND d.flow_version=$4
    AND d.status='queued' AND e.status='queued' AND s.active=true
    AND s.flow_type='Platform Event-Triggered Flow' AND s.trigger_key=e.event_api_name
    AND f.flow_type=s.flow_type AND f.version=d.flow_version AND f.active=true AND f.archived=false
    AND EXISTS(SELECT 1 FROM md_system_definitions x WHERE x.tenant_id=d.tenant_id
     AND x.kind='platform-events' AND x.api_name=e.event_api_name AND x.enabled=true)
  `,[tenantId,deliveryId,userId,version]);
  const delivery=rows[0];
  if(!delivery)throw new Error('Platform Event delivery is no longer eligible');
  const finishDelivery=async(status:'completed'|'failed',errorCode:string|null)=>{
   await this.db!.query(`WITH finished AS (
    UPDATE md_platform_event_deliveries SET status=$3,error_code=$4,completed_at=now()
    WHERE tenant_id=$1 AND id=$2 AND status='queued' RETURNING tenant_id,event_id
   )
   UPDATE md_platform_event_messages e SET status='completed'
   FROM finished d WHERE e.tenant_id=d.tenant_id AND e.id=d.event_id
    AND NOT EXISTS(SELECT 1 FROM md_platform_event_deliveries x
     WHERE x.tenant_id=d.tenant_id AND x.event_id=d.event_id AND x.status='queued')`,
    [tenantId,deliveryId,status,errorCode]);
  };
  try{
  await this.rbac.require(tenantId,userId,'Flow:'+delivery.flow_api,'execute');
  if(!await flowAppIsEntitled(this.db,tenantId,delivery.app_api_name))
   throw new Error('Platform Event Flow app is no longer installed or entitled');
  const {rows:storedValues}=await this.db.query<{
   field_api:string;value_kind:string;value_text:string|null
  }>(`SELECT field_api,value_kind,value_text FROM md_platform_event_values
    WHERE tenant_id=$1 AND event_id=$2`,[tenantId,delivery.event_id]);
  const eventRecord:Snapshot={};
  for(const value of storedValues){
   const parsed=value.value_kind==='null'?null:value.value_kind==='boolean'
    ?value.value_text==='true':value.value_kind==='number'?Number(value.value_text):value.value_text;
   if(typeof parsed==='number'&&!Number.isFinite(parsed))
    throw new Error('Invalid stored Platform Event value');
   eventRecord[value.field_api]=parsed;
  }
  const {rows:metadata}=await this.db.query<MetadataValueRow>(`
   SELECT property_path,value_kind,value_text FROM md_flow_editor_values
   WHERE tenant_id=$1 AND flow_id=$2`,[tenantId,delivery.flow_id]);
  const graph=decodeMetadataValues(metadata).builder as TriggerDocument|undefined;
  if(!graph||!Array.isArray(graph.elements)||!Array.isArray(graph.connectors))
   throw new Error('Invalid Platform Event Flow graph');
  const start=graph.elements.find(element=>element.type==='Start');
  if(!start||start.config.object!==delivery.event_api_name)
   throw new Error('Platform Event Flow subscription is stale');
  const executionActor=await resolveFlowExecutionActor(this.db,this.rbac,tenantId,
   delivery.flow_api,userId,flowExecutionMode(start.config.executionContext),
   delivery.system_context_approved_by);
  const conditions=Array.isArray(start.config.entryConditions)
   ?start.config.entryConditions as Array<Record<string,unknown>>:[];
  for(const field of new Set(conditions.map(condition=>asString(condition.field)))){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
    throw new Error('Platform Event entry condition has an invalid field');
   await this.rbac.require(tenantId,userId,
    'PlatformEvent:'+delivery.event_api_name+'.'+field,'read');
  }
  const matches=conditions.length===0||evaluateFlowDecisionOutcome(conditions.map(condition=>{
   const field=asString(condition.field),actual=eventRecord[field];
   return {...condition,field:actual,value:conditionValue(condition.value,actual)};
  }),typeof start.config.conditionLogic==='string'?start.config.conditionLogic:undefined,
  value=>value,value=>value!==undefined);
  if(matches){
    await this.db.transaction(async client=>{
     const created=await client.query<{id:string}>(`
      INSERT INTO md_flow_runs
       (tenant_id,flow_id,started_by,initiated_by,execution_context,status)
      VALUES($1,$2,$3,$4,$5,'pending') RETURNING id`,
     [tenantId,delivery.flow_id,executionActor.actorUserId,userId,executionActor.mode]);
     const runId=created.rows[0]?.id;
     if(!runId)throw new Error('Unable to create Platform Event Flow run');
     if(executionActor.mode==='System')await auditSystemFlowContext(client,tenantId,
      delivery.flow_id,executionActor.actorUserId,userId,'system-context-run',runId);
     await client.query(`INSERT INTO md_flow_interview_state(tenant_id,run_id,current_element)
      VALUES($1,$2,$3)`,[tenantId,runId,start.id]);
     await this.persistRecord(client,tenantId,runId,'$Record',delivery.event_api_name,eventRecord,null);
     const result=await this.flows.advanceInterview(tenantId,executionActor.actorUserId,runId,{},client);
     const status='status' in result?result.status:undefined;
     if(status!=='completed'&&status!=='waiting')
      throw new Error('Platform Event Flow returned an invalid state');
     await client.query(`UPDATE md_platform_event_deliveries
      SET status='completed',completed_at=now()
      WHERE tenant_id=$1 AND id=$2 AND status='queued'`,[tenantId,deliveryId]);
     await client.query(`UPDATE md_platform_event_messages SET status='completed'
      WHERE tenant_id=$1 AND id=$2 AND NOT EXISTS(
       SELECT 1 FROM md_platform_event_deliveries
       WHERE tenant_id=$1 AND event_id=$2 AND status='queued')`,
      [tenantId,delivery.event_id]);
    });
  }else{
   await finishDelivery('completed',null);
  }
  return {deliveryId,flowApi:delivery.flow_api,matched:matches};
  }catch(error){
   await finishDelivery('failed','FLOW_EXECUTION_FAILED');
   throw error;
  }
 }

 async execute(client:PoolClient,tenantId:string,userId:string,objectApi:string,
   operation:TriggerOperation,record:Snapshot|null,prior:Snapshot|null,
   phase:TriggerPhase='after-save',isClone=false):Promise<Snapshot|void> {
  if(this.flowExecution.getStore())return;
  const {rows}=await client.query<Candidate>(`
  SELECT f.id,f.api_name,f.version,f.system_context_approved_by,s.app_api_name FROM md_flow_definitions f
  JOIN md_flow_trigger_subscriptions s ON s.tenant_id=f.tenant_id AND s.flow_id=f.id
  WHERE f.tenant_id=$1 AND f.active=true AND f.archived=false
   AND f.flow_type='Record-Triggered Flow' AND s.flow_type=f.flow_type AND s.active=true
  ORDER BY f.api_name
  `,[tenantId]);
  const ready:Array<{flow:Candidate;graph:TriggerDocument;
   start:NonNullable<TriggerDocument['elements']>[number];order:number;
   apiName:string;runAfterFlows:string[];execution:FlowExecutionActor}>=[];
  let current=record?{...record}:null;
  let scheduledPathCount=0;
  for(const flow of rows){
   const {rows:values}=await client.query<MetadataValueRow>(`
    SELECT property_path,value_kind,value_text FROM md_flow_editor_values
    WHERE tenant_id=$1 AND flow_id=$2
   `,[tenantId,flow.id]);
   const graph=decodeMetadataValues(values).builder as TriggerDocument|undefined;
   if(!graph||!Array.isArray(graph.elements))throw new Error('Invalid active Record-Triggered Flow graph');
   const start=graph.elements.find(element=>element.type==='Start');
   if(!start)throw new Error('Record-Triggered Flow has no Start element');
   const config=start.config;
   if(config.object!==objectApi||(config.runWhen??'after-save')!==phase)continue;
   if(phase==='before-save'&&operation==='deleted')continue;
   const trigger=String(config.trigger??'created-or-updated');
   if(!(trigger==='created-or-updated'
     ||operation==='created'&&trigger==='created'
     ||operation==='updated'&&trigger==='updated'
     ||operation==='deleted'&&trigger==='deleted'))continue;
   if(flow.app_api_name&&(!this.db||!await flowAppIsEntitled(this.db,tenantId,flow.app_api_name)))
    continue;
   const execution=await resolveFlowExecutionActor(this.db,this.rbac,tenantId,flow.api_name,
    userId,flowExecutionMode(config.executionContext),flow.system_context_approved_by??null);
   const order=Number(config.triggerOrder??1000);
   if(!Number.isSafeInteger(order)||order<1||order>2000)
    throw new Error('Invalid active Record-Triggered Flow order');
   const conditions=Array.isArray(config.entryConditions)
     ?config.entryConditions as Array<Record<string,unknown>>:[];
    for(const field of new Set(conditions.map(condition=>asString(condition.field)))){
     if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
      throw new Error('Record-Triggered Flow entry condition has an invalid field');
     await this.rbac.require(tenantId,execution.actorUserId,objectApi+'.'+field,'read');
    }
    const matches=(subject:Snapshot|null,previous:Snapshot|null)=>conditions.length===0
     ||Boolean(subject)&&evaluateFlowDecisionOutcome(conditions.map(condition=>{
       const field=asString(condition.field);
       const actual=subject?.[field];
       return {...condition,field:actual,
        value:conditionValue(condition.value,actual),
        priorValue:previous?.[field]};
      }),typeof config.conditionLogic==='string'?config.conditionLogic:undefined,
      value=>value,value=>value!==undefined);
   const currentMatches=matches(current??prior,prior);
   const transition=operation==='updated'&&config.updatedRecordBehavior==='transition'
     &&matches(prior,prior);
   if(phase==='after-save'&&(operation==='created'||operation==='updated')
     &&current?.Id&&typeof current.Id==='string')
    await this.cancelScheduledPaths(client,tenantId,flow.id,current.Id);
   if(!currentMatches||transition)continue;
   ready.push({flow,graph,start,order,apiName:flow.api_name,
    runAfterFlows:validateTriggerDependencies(config.runAfterFlows,flow.api_name),execution});
  }
  const ordered=orderTriggeredFlows(ready);
  if(ready.length>maxTriggerExecutions)
   throw new Error('Record-triggered Flow execution limit exceeded');
  for(const item of ordered){
   await this.rbac.require(tenantId,userId,'Flow:'+item.flow.api_name,'execute');
   const {rows:runRows}=await client.query<{id:string}>(`
    INSERT INTO md_flow_runs
     (tenant_id,flow_id,started_by,initiated_by,execution_context,status)
    VALUES($1,$2,$3,$4,$5,'pending') RETURNING id
   `,[tenantId,item.flow.id,item.execution.actorUserId,userId,item.execution.mode]);
   const runId=runRows[0]?.id;
   if(!runId)throw new Error('Unable to create Record-Triggered Flow run');
   if(item.execution.mode==='System')await auditSystemFlowContext(client,tenantId,item.flow.id,
    item.execution.actorUserId,userId,'system-context-run',runId);
   await client.query(`
    INSERT INTO md_flow_interview_state(tenant_id,run_id,current_element)
    VALUES($1,$2,$3)
   `,[tenantId,runId,item.start.id]);
   await client.query(`INSERT INTO md_flow_run_inputs
    (tenant_id,run_id,api_name,value_text,data_type)
    VALUES($1,$2,'$Record__IsClone',$3,'boolean')`,
   [tenantId,runId,String(isClone)]);
   const readableCurrent=await this.readableRecord(tenantId,item.execution.actorUserId,
    objectApi,current??prior);
   const readablePrior=await this.readableRecord(tenantId,item.execution.actorUserId,
    objectApi,prior);
   await this.persistRecord(client,tenantId,runId,'$Record',objectApi,readableCurrent,
    operation==='deleted'?null:(current??prior)?.Id);
   await this.persistRecord(client,tenantId,runId,'$Record__Prior',objectApi,readablePrior,
    operation==='deleted'?null:prior?.Id);
   const result=await this.flowExecution.run(true,
    ()=>this.flows.advanceInterview(tenantId,item.execution.actorUserId,runId,{},client));
   if(!('status' in result)||(result.status!=='completed'
     &&!(phase==='after-save'&&result.status==='waiting')))
    throw new Error('Record-Triggered Flow did not complete or pause durably');
   if(phase==='before-save'&&'record' in result&&result.record
     &&typeof result.record==='object'&&!Array.isArray(result.record))
    current={...current,...result.record as Snapshot};
   if(phase==='after-save'&&current)
    scheduledPathCount+=await this.schedulePaths(client,tenantId,item.execution.actorUserId,
     userId,item.execution,item.flow,
     item.graph,item.start,current,prior,operation,objectApi,
     maxScheduledPathInterviews-scheduledPathCount);
  }
  return phase==='before-save'?current??undefined:undefined;
 }

  private async readableRecord(tenantId:string,userId:string,objectApi:string,
   record:Snapshot|null):Promise<Snapshot|null>{
   if(!record)return null;
   const entries=Object.entries(record).filter(([field,value])=>
    field!=='Id'&&field!=='RecordTypeId'&&field!=='CreatedAt'&&field!=='LastModifiedDate'
     &&field!=='__isClone'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(field)&&scalar(value));
   const checks=entries.map(([field])=>({resource:objectApi+'.'+field,action:'read'}));
   const access=await this.rbac.allowedMany(tenantId,userId,checks);
   const result:Snapshot={};
   for(const field of ['Id','CreatedAt','LastModifiedDate'])
    if(Object.hasOwn(record,field))result[field]=record[field];
   for(const [index,[field,value]] of entries.entries())
    if(access[index])result[field]=value;
   const recordTypeId=record.RecordTypeId;
   if(typeof recordTypeId==='string'&&await this.rbac.allowed(
    tenantId,userId,'RecordType:'+objectApi+'.'+recordTypeId,'read'))
    result.RecordTypeId=recordTypeId;
   return result;
  }

 private async cancelScheduledPaths(client:PoolClient,tenantId:string,flowId:string,recordId:string) {
  await client.query(`
   WITH cancelled AS (
    UPDATE md_flow_runs r SET status='cancelled',finished_at=now(),wait_until=NULL
    WHERE r.tenant_id=$1 AND r.flow_id=$2 AND r.status='waiting'
     AND r.wait_kind='scheduled-path'
     AND EXISTS(SELECT 1 FROM md_flow_interview_records i
      WHERE i.tenant_id=r.tenant_id AND i.run_id=r.id
       AND i.api_name='$Record' AND i.record_id=$3)
    RETURNING r.id
   )
   UPDATE md_durable_jobs j SET status='cancelled',lease_owner=NULL,lease_until=NULL,
    updated_at=now()
   WHERE j.tenant_id=$1 AND j.job_type='flow.resume' AND j.status IN ('queued','leased')
    AND j.resource_id IN (SELECT id::text FROM cancelled)
  `,[tenantId,flowId,recordId]);
 }

 private async schedulePaths(client:PoolClient,tenantId:string,userId:string,
  initiatingUserId:string,execution:FlowExecutionActor,flow:Candidate,
  graph:TriggerDocument,start:NonNullable<TriggerDocument['elements']>[number],
  record:Snapshot,prior:Snapshot|null,operation:TriggerOperation,objectApi:string,
  remaining:number):Promise<number> {
  const paths=(graph.connectors??[]).filter(edge=>edge.from===start.id&&edge.kind==='scheduled');
  if(!paths.length||operation==='deleted')return 0;
  if(paths.length>remaining)throw new Error('Record-triggered Scheduled Path limit exceeded');
  if(!this.db||!this.scheduleResume)
   throw new Error('Scheduled Path durable scheduler is not configured');
  if(typeof record.Id!=='string'||!/^[0-9a-f-]{36}$/i.test(record.Id))
   throw new Error('Scheduled Path requires a saved record ID');
  let scheduled=0;
  for(const edge of paths){
   const target=Number(edge.to);
   if(!Number.isSafeInteger(target)||target<1)
    throw new Error('Scheduled Path has an invalid target element');
   const configuration=edge.scheduledPath;
   if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))
    throw new Error('Scheduled Path has no time configuration');
   const scheduledPath=configuration as Record<string,unknown>;
   const field=scheduledPath.timeSourceFieldApiName;
   if(typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
    throw new Error('Scheduled Path requires a valid time source field');
   await this.rbac.require(tenantId,userId,objectApi+'.'+field,'read');
   const scheduledAt=resolveFlowScheduledPathAt(record,{
    timeSourceFieldApiName:field,
    offsetAmount:scheduledPath.offsetAmount,offsetUnit:scheduledPath.offsetUnit
   });
   if(!scheduledAt)continue;
   const {rows}=await client.query<{id:string}>(`
    INSERT INTO md_flow_runs
     (tenant_id,flow_id,started_by,initiated_by,execution_context,status,wait_kind,wait_until)
    VALUES($1,$2,$3,$4,$5,'waiting','scheduled-path',$6) RETURNING id
   `,[tenantId,flow.id,userId,initiatingUserId,execution.mode,scheduledAt]);
   const runId=rows[0]?.id;
   if(!runId)throw new Error('Unable to create Scheduled Path interview');
   if(execution.mode==='System')await auditSystemFlowContext(client,tenantId,flow.id,
    userId,initiatingUserId,'system-context-run',runId);
   await client.query(`INSERT INTO md_flow_interview_state
    (tenant_id,run_id,current_element) VALUES($1,$2,$3)`,[tenantId,runId,target]);
   await this.persistRecord(client,tenantId,runId,'$Record',objectApi,record,record.Id);
   await this.persistRecord(client,tenantId,runId,'$Record__Prior',objectApi,prior,prior?.Id);
   await this.scheduleResume(client,tenantId,userId,flow.api_name,
    flow.version,runId,scheduledAt,0,
    flow.app_api_name??undefined);
   scheduled++;
  }
  return scheduled;
 }

 private async persistRecord(client:PoolClient,tenantId:string,runId:string,name:string,
   objectApi:string,record:Snapshot|null,recordId:unknown) {
  if(!record&&name!=='$Record__Prior')return;
  const id=typeof recordId==='string'&&/^[0-9a-f-]{36}$/i.test(recordId)?recordId:null;
  await client.query(`
   INSERT INTO md_flow_interview_records
    (tenant_id,run_id,api_name,object_api,sort_order,record_id,is_collection)
   VALUES($1,$2,$3,$4,0,$5,false)
  `,[tenantId,runId,name,objectApi,id]);
  const fields=Object.entries(record??{}).filter((entry):entry is [string,string|number|boolean|null]=>
   entry[0]!=='Id'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(entry[0])&&scalar(entry[1]));
  if(record&&typeof record.Id==='string'&&id===null&&scalar(record.Id))
   fields.push(['Id',record.Id]);
  for(const [field,value] of fields)
   await client.query(`
    INSERT INTO md_flow_interview_record_fields
     (tenant_id,run_id,api_name,sort_order,field_api,value_text,data_type)
    VALUES($1,$2,$3,0,$4,$5,$6)
   `,[tenantId,runId,name,field,value===null?null:String(value),
    value===null?'null':typeof value]);
 }
}
