import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {NamedCredentialService} from './named-credential-service.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import type {DurableJobWorker,ClaimedJob} from './durable-job-worker.js';
import {DurableJobService} from './durable-job-service.js';
import {compileActionPlan,usesRecordCount,type ActionStep} from '../expression-engine/ActionFormulas.js';
import {formulaTruth,type Expression} from '../expression-engine/FormulaParser.js';
import {evaluateFlowFormula} from '../system-files/flow-formula-runtime.js';
import {sendActionCommunication} from './action-formula-communication-service.js';
import {BackendPrintTemplatePdfService} from './backend-print-template-pdf-service.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reserved=/(?:password|secret|token|cookie|authorization|credentialkey)/i;
const own=(value:unknown):value is Record<string,unknown>=>
 !!value&&typeof value==='object'&&!Array.isArray(value);
function bounded(value:unknown,depth=0):unknown {
 if(depth>3)throw Error('Action snapshot nesting limit exceeded');
 if(value===null||typeof value==='boolean')return value;
 if(value instanceof Date)return value.toISOString();
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'&&value.length<=4096)return value;
 if(Array.isArray(value)&&value.length<=100)return value.map(item=>bounded(item,depth+1));
 if(own(value)&&Object.keys(value).length<=100){
  const output:Record<string,unknown>=Object.create(null);
  for(const [key,item] of Object.entries(value)){
   if(item===undefined||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)||reserved.test(key))continue;
   output[key]=bounded(item,depth+1);
  }
  return output;
 }
 throw Error('Invalid action snapshot');
}
function safeSnapshot(value:unknown):Record<string,unknown>{
 if(!own(value))throw Error('Expected action scope');
 const safe=bounded(value);
 if(!own(safe)||JSON.stringify(safe).length>16384)throw Error('Action snapshot too large');
 return safe;
}
function expressionSource(node:Expression):string{
 switch(node.kind){
  case 'literal':return JSON.stringify(node.value);
  case 'reference':return '{!'+node.value+'}';
  case 'unary':return '('+node.operator+' '+expressionSource(node.value)+')';
  case 'binary':return '('+expressionSource(node.left)+' '+node.operator+' '+expressionSource(node.right)+')';
  case 'call':return node.name+'('+node.args.map(expressionSource).join(',')+')';
 }
}
function lookup(source:Record<string,unknown>,reference:string):unknown{
 const normalized=reference.replace(/^\$state\./,'state.')
  .replace(/^\$event\./,'event.')
  .replace(/^\$session$/,'sessionId');
 const segments=normalized.replace(/^@/,'').split('.');
 let value:unknown=source;
 for(const key of segments){
  if(!own(value)||!Object.prototype.hasOwnProperty.call(value,key))return null;
  value=value[key];
 }
 return value;
}
function evaluate(node:Expression,scope:Record<string,unknown>):unknown{
 return evaluateFlowFormula(expressionSource(node),name=>lookup(scope,name));
}
function textValue(value:unknown,label:string):string{
 if(typeof value!=='string'||!value.trim()||value.length>32768)
  throw Error('Invalid '+label);
 return value;
}
function savedId(value:unknown):string{
 if(typeof value!=='string'||!uuid.test(value))throw Error('Invalid record ID');
 return value;
}
type ScheduledActionRow={
 id:string;tenant_id:string;job_id:string;scheduled_by:string;origin_session_id:string|null;
 action_formula:string;next_step:number;input_snapshot:Record<string,unknown>;
 result_snapshot:Record<string,unknown>;status:string;execute_at:Date;
};
export class ScheduledActionService {
 private readonly jobs:DurableJobService;
 constructor(private readonly db:SqlPersistence){this.jobs=new DurableJobService(db);}
 async schedule(tenantId:string,userId:string,options:{
  formula:string;nextStep:number;seconds:number;scope:unknown;variables:unknown;sessionId?:unknown
 }){
  const steps=compileActionPlan(options.formula);
  if(!Number.isInteger(options.nextStep)||options.nextStep<1||options.nextStep>=steps.length
    ||steps[options.nextStep-1].name!=='WAIT')throw Error('Invalid WAIT continuation');
  if(!Number.isInteger(options.seconds)||options.seconds<1||options.seconds>31536000)
   throw Error('WAIT duration is outside the supported range');
  // Browser actions cannot execute after the initiating user closes their tab.
  // Reject at scheduling time rather than silently failing many hours later.
  const interactive=steps.slice(options.nextStep).find(step=>
   ['SCREEN','PRINT','STATE','GETRECORD','FOREACH','CLOSESCREEN'].includes(step.name));
  if(interactive)throw Error(interactive.name+
   ' must run before WAIT; delayed actions require server execution');
  const counted=steps.slice(options.nextStep).find(step=>
   [...(step.guards??[]).map(guard=>guard.condition),...(step.id?[step.id]:[]),
    ...step.fields.values(),...(step.values??[])].some(usesRecordCount));
  if(counted)throw Error('Record aggregates and VERIFYPIN must run before WAIT; delayed actions require server execution');
  const scope=safeSnapshot(options.scope),variables=safeSnapshot(options.variables);
  const wait=steps[options.nextStep-1];
  const values={...scope,...variables};
  if(wait.guards?.some(guard=>formulaTruth(evaluate(guard.condition,values))!==guard.expected))
   throw Error('WAIT action is not selected');
  const [minutes,seconds]=(wait.values??[]).map(node=>evaluate(node,values));
  if(typeof minutes!=='number'||typeof seconds!=='number'||!Number.isInteger(minutes)||
    !Number.isInteger(seconds)||minutes<0||seconds<0||seconds>=60||
    minutes*60+seconds!==options.seconds)
   throw Error('WAIT duration does not match the formula');
  const sessionId=typeof options.sessionId==='string'&&options.sessionId.length<=128
   ?options.sessionId:null;
  return this.db.transaction(async client=>{
   const {rows:actors}=await client.query(
    "SELECT 1 FROM md_users u JOIN md_tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true AND t.status='ACTIVE'",
    [tenantId,userId]);
   if(!actors.length)throw Error('Scheduling user is no longer active');
   const scheduledAt=new Date(Date.now()+options.seconds*1000);
   const id=await this.jobs.enqueue(tenantId,'scheduled.action',{
    actorUserId:userId,scheduledAt,maxAttempts:1
   },client);
   const {rows}=await client.query<{id:string}>(`
    INSERT INTO md_scheduled_actions(tenant_id,job_id,scheduled_by,origin_session_id,
      action_formula,next_step,input_snapshot,result_snapshot,execute_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) RETURNING id
   `,[tenantId,id,userId,sessionId,options.formula,options.nextStep,
    JSON.stringify(scope),JSON.stringify(variables),scheduledAt]);
   await client.query(`INSERT INTO md_scheduled_action_history
      (tenant_id,scheduled_action_id,event_type,actor_user_id,detail_code)
      VALUES($1,$2,'scheduled',$3,'WAIT')`,[tenantId,rows[0].id,userId]);
   return {id:rows[0].id,executeAt:scheduledAt.toISOString(),status:'Pending'};
  });
 }
 async list(tenantId:string,userId:string,canManage:boolean){
  const {rows}=await this.db.query(`SELECT id,scheduled_by,origin_session_id,status,
    execute_at,next_step,created_at,finished_at,error_code
    FROM md_scheduled_actions WHERE tenant_id=$1 AND ($3 OR scheduled_by=$2)
    ORDER BY created_at DESC LIMIT 200`,[tenantId,userId,canManage]);
  return rows;
 }
 async history(tenantId:string,userId:string,id:string,canManage:boolean){
  if(!uuid.test(id))throw Error('Invalid ScheduledAction ID');
  const {rows:check}=await this.db.query(`SELECT id FROM md_scheduled_actions
    WHERE tenant_id=$1 AND id=$2 AND ($4 OR scheduled_by=$3)`,
    [tenantId,id,userId,canManage]);
  if(!check.length)throw Error('ScheduledAction unavailable');
  const {rows}=await this.db.query(`SELECT step_number,action_name,event_type,
    actor_user_id,detail_code,occurred_at FROM md_scheduled_action_history
    WHERE tenant_id=$1 AND scheduled_action_id=$2 ORDER BY id`,[tenantId,id]);
  return rows;
 }
 async close(tenantId:string,userId:string,id:string,decision:'Cancelled'|'ManuallyCompleted',canManage:boolean){
  if(!uuid.test(id)||!['Cancelled','ManuallyCompleted'].includes(decision))
   throw Error('Invalid ScheduledAction operation');
  return this.db.transaction(async client=>{
   const {rows}=await client.query<{job_id:string}>(`
    UPDATE md_scheduled_actions SET status=$4,finished_at=now(),updated_at=now()
    WHERE tenant_id=$1 AND id=$2 AND ($5 OR scheduled_by=$3)
      AND status='Pending' RETURNING job_id
   `,[tenantId,id,userId,decision,canManage]);
   if(!rows[0])throw Error('Only pending ScheduledActions can be closed');
   await client.query(`UPDATE md_durable_jobs SET status='cancelled',updated_at=now()
     WHERE tenant_id=$1 AND id=$2 AND status='queued'`,[tenantId,rows[0].job_id]);
   await client.query(`INSERT INTO md_scheduled_action_history
     (tenant_id,scheduled_action_id,event_type,actor_user_id,detail_code)
     VALUES($1,$2,$3,$4,'OPERATOR')`,[tenantId,id,
      decision==='Cancelled'?'cancelled':'manually_completed',userId]);
   return {id,status:decision};
  });
 }
 async load(job:ClaimedJob):Promise<ScheduledActionRow|null>{
  const {rows}=await this.db.query<ScheduledActionRow>(`
    SELECT * FROM md_scheduled_actions WHERE tenant_id=$1 AND job_id=$2
     AND scheduled_by=$3 AND status='Pending' AND execute_at<=now()
   `,[job.tenant_id,job.id,job.actor_user_id]);
  return rows[0]??null;
 }
 async start(row:ScheduledActionRow){
  const {rowCount}=await this.db.query(`UPDATE md_scheduled_actions
    SET status='Running',updated_at=now() WHERE tenant_id=$1 AND id=$2
    AND status='Pending' AND execute_at<=now()`,[row.tenant_id,row.id]);
  if(!rowCount)throw Error('ScheduledAction no longer pending');
  await this.event(row,'started',null,null);
 }
 async event(row:ScheduledActionRow,eventType:string,step:number|null,detail:string|null,action?:string){
  await this.db.query(`INSERT INTO md_scheduled_action_history
    (tenant_id,scheduled_action_id,step_number,action_name,event_type,actor_user_id,detail_code)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[row.tenant_id,row.id,step,action??null,eventType,
     row.scheduled_by,detail]);
 }
 async progress(row:ScheduledActionRow,index:number,variables:Record<string,unknown>,name:string){
  const output=safeSnapshot(variables);
  await this.db.transaction(async client=>{
   await client.query(`UPDATE md_scheduled_actions SET next_step=$3,
      result_snapshot=$4::jsonb,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND status='Running'`,
     [row.tenant_id,row.id,index,JSON.stringify(output)]);
   await client.query(`INSERT INTO md_scheduled_action_history
      (tenant_id,scheduled_action_id,step_number,action_name,event_type,actor_user_id)
      VALUES($1,$2,$3,$4,'step_completed',$5)`,[row.tenant_id,row.id,index-1,name,row.scheduled_by]);
  });
 }
 async terminal(row:ScheduledActionRow,status:'Completed'|'Failed',code?:string){
  await this.db.transaction(async client=>{
   await client.query(`UPDATE md_scheduled_actions SET status=$3,finished_at=now(),
     error_code=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='Running'`,
     [row.tenant_id,row.id,status,code??null]);
   await client.query(`INSERT INTO md_scheduled_action_history
     (tenant_id,scheduled_action_id,event_type,actor_user_id,detail_code)
     VALUES($1,$2,$3,$4,$5)`,[row.tenant_id,row.id,
       status==='Completed'?'completed':'failed',row.scheduled_by,code??null]);
  });
 }
}
export function registerScheduledActionWorker(worker:DurableJobWorker,db:SqlPersistence,
 rbac:RbacEngine,records:RecordEngine,credentials:NamedCredentialService,flows:FlowRuntime){
 const service=new ScheduledActionService(db);
 const pdfService=new BackendPrintTemplatePdfService(db,rbac,records);
 const authorize=async(job:ClaimedJob)=>{
  if(job.job_type!=='scheduled.action'||!job.actor_user_id)return false;
  const {rows}=await db.query(`SELECT 1 FROM md_users u
   JOIN md_tenants t ON t.id=u.tenant_id AND t.status='ACTIVE'
   WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true`,
   [job.tenant_id,job.actor_user_id]);
  if(!rows.length)return false;
  return !!await service.load(job);
 };
 worker.register('scheduled.action',async job=>{
  const row=await service.load(job);
  if(!row)throw Error('ScheduledAction unavailable');
  await service.start(row);
  const scope=safeSnapshot(row.input_snapshot),variables=safeSnapshot(row.result_snapshot);
  const steps=compileActionPlan(row.action_formula);
  try{
   for(let i=row.next_step;i<steps.length;i++){
    const step=steps[i];
    const values={...scope,...variables};
    const evalNode=(node:Expression)=>evaluate(node,values);
    if(step.guards?.some(guard=>formulaTruth(evalNode(guard.condition))!==guard.expected)){
     await service.progress(row,i+1,variables,step.name+' (skipped)');
     continue;
    }
    if(step.name==='WAIT'){
     const [minutes,seconds]=(step.values??[]).map(evalNode);
     if(typeof minutes!=='number'||typeof seconds!=='number'||
       !Number.isInteger(minutes)||!Number.isInteger(seconds)||
       minutes<0||seconds<0||seconds>=60||minutes*60+seconds<1)
      throw Error('Invalid scheduled WAIT duration');
     if(i+1<steps.length)await service.schedule(row.tenant_id,row.scheduled_by,{
      formula:row.action_formula,nextStep:i+1,seconds:minutes*60+seconds,
      scope,variables,sessionId:row.origin_session_id
     });
     await service.progress(row,i+1,variables,step.name);
     break;
    }
    if(['SCREEN','PRINT','STATE','GETRECORD','FOREACH','CLOSESCREEN'].includes(step.name))
     throw Error('Interactive navigation, printing, Page State and record lookups are unavailable after WAIT');
    if(step.name==='CREATEPDF'){
     const recordId=savedId(evalNode(step.id!));
     const pdf=await pdfService.create(row.tenant_id,row.scheduled_by,step.object,recordId);
     if(step.alias)variables[step.alias]=pdf;
     await service.progress(row,i+1,variables,step.name);
     continue;
    }
    if(step.name==='FLOW'){
     const {rows:active}=await db.query<{flow_type:string}>(`
      SELECT flow_type FROM md_flow_definitions
      WHERE tenant_id=$1 AND api_name=$2 AND active=true AND archived=false
      ORDER BY version DESC LIMIT 1`,[row.tenant_id,step.object]);
     if(active[0]?.flow_type!=='Autolaunched Flow')throw Error('Only Autolaunched Flows can resume in background');
     await flows.execute(row.tenant_id,step.object,row.scheduled_by,{});
     await service.progress(row,i+1,variables,step.name);
     continue;
    }
    if(['EMAIL','WHATSAPP','SMS'].includes(step.name))
     await sendActionCommunication(db,rbac,credentials,
       row.tenant_id,row.scheduled_by,step.name as 'EMAIL'|'WHATSAPP'|'SMS',
       step.object,(step.values??[]).map(evalNode),
       'scheduled-action:'+row.id+':'+i);
    else {
     const id=step.id?savedId(evalNode(step.id)):undefined;
     const data=Object.fromEntries([...step.fields].map(([name,node])=>[name,evalNode(node)]));
     if(step.name==='CREATERECORD'){
      const created=await records.create(row.tenant_id,row.scheduled_by,step.object,data);
      if(step.alias)variables[step.alias]=await records.get(row.tenant_id,row.scheduled_by,step.object,created);
     }else if(step.name==='UPDATERECORD'){
      await records.update(row.tenant_id,row.scheduled_by,step.object,id!,data);
      if(step.alias)variables[step.alias]=await records.get(row.tenant_id,row.scheduled_by,step.object,id!);
     }else if(step.name==='DELETERECORD')
      await records.remove(row.tenant_id,row.scheduled_by,step.object,id!);
     else throw Error('Unknown scheduled action type');
    }
    await service.progress(row,i+1,variables,step.name);
   }
   await service.terminal(row,'Completed');
  }catch{
   await service.terminal(row,'Failed','ACTION_EXECUTION_FAILED');
   throw Error('ScheduledAction execution failed');
  }
 });
 return authorize;
}
