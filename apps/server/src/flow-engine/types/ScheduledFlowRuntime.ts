import {createHash} from 'node:crypto';
import {decodeMetadataValues,type MetadataValueRow} from '../../system-files/component-runtime.js';
import {resolveFlowLocalDateTime} from '../../system-files/flow-wait-runtime.js';
import {flowAppIsEntitled} from '../../system-files/flow-validation.js';
import type {SqlPersistence} from '../../system-files/sql-persistence.js';
import {DurableJobService} from '../../system-support/durable-job-service.js';

type Schedule={
 apiName:string;startDate:string;startTime:string;timeZone:string;frequency:string;
 object:string;
};
const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;

function localDate(now:Date,timeZone:string) {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(now);
 const values=Object.fromEntries(parts.filter(part=>part.type!=='literal')
  .map(part=>[part.type,part.value]));
 return `${values.year}-${values.month}-${values.day}`;
}
function addCalendarDays(date:string,days:number) {
 const [year,month,day]=date.split('-').map(Number);
 return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);
}
function daysBetween(from:string,to:string) {
 const [fy,fm,fd]=from.split('-').map(Number),[ty,tm,td]=to.split('-').map(Number);
 return Math.round((Date.UTC(ty,tm-1,td)-Date.UTC(fy,fm-1,fd))/86400000);
}
export function latestOccurrence(schedule:Schedule,now:Date):Date|null {
 if(!identifier.test(schedule.object)||! /^\d{4}-\d{2}-\d{2}$/.test(schedule.startDate)
   ||! /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.startTime)
   ||!['Once','Daily','Weekly','Monthly'].includes(schedule.frequency))
  throw new Error('Invalid active Schedule-Triggered Flow configuration: '+schedule.apiName);
 const localToday=localDate(now,schedule.timeZone);
 const candidates=schedule.frequency==='Once'?[schedule.startDate]:
  schedule.frequency==='Monthly'
   ?Array.from({length:3},(_,index)=>{
     // Anchor on the configured calendar day; clamp short months, never drift.
     const [year,month]=localToday.split('-').map(Number);
     const monthStart=new Date(Date.UTC(year,month-1-index,1));
     const y=monthStart.getUTCFullYear(),m=monthStart.getUTCMonth();
     const anchorDay=Number(schedule.startDate.slice(8,10));
     const lastDay=new Date(Date.UTC(y,m+1,0)).getUTCDate();
     return new Date(Date.UTC(y,m,Math.min(anchorDay,lastDay))).toISOString().slice(0,10);
    })
   :Array.from({length:schedule.frequency==='Daily'?2:8},(_,index)=>addCalendarDays(
      localToday,-index));
 for(const date of candidates){
  if(date<schedule.startDate)continue;
  if(schedule.frequency==='Weekly'&&daysBetween(schedule.startDate,date)%7!==0)continue;
  let occurrence:Date;
  try{occurrence=resolveFlowLocalDateTime(date,schedule.startTime,schedule.timeZone);}
  catch(error){
   if(schedule.frequency!=='Once'&&error instanceof Error
     &&error.message.includes('local time does not exist'))continue;
   throw error;
  }
  const age=now.getTime()-occurrence.getTime();
  const maxAge=schedule.frequency==='Once'?36*60*60*1000:
   (schedule.frequency==='Daily'?36:schedule.frequency==='Weekly'?8*24:35*24)*60*60*1000;
  if(age>=0&&age<=maxAge)return occurrence;
 }
 return null;
}

export class ScheduledFlowDispatcher {
 private readonly jobs:DurableJobService;
 constructor(private readonly db:SqlPersistence) {
  this.jobs=new DurableJobService(db);
 }

 async enqueueDue(now=new Date()) {
  let scanned=0;
  let cursor:{tenantId:string;apiName:string;version:number;id:string}|null=null;
  // Stable keyset paging: tenants with >500 active schedules are not blocked.
  // Cap each poll at 20,000 rows to bound memory and worker latency.
  for(let batch=0;batch<100;batch++){
   const last=cursor as {tenantId:string;apiName:string;version:number;id:string}|null;
   const {rows}=await this.db.query<{
    id:string;tenant_id:string;api_name:string;version:number;flow_service_user_id:string;
    app_api_name:string|null
   }>(`
    SELECT f.id,f.tenant_id,f.api_name,f.version,s.flow_service_user_id,t.app_api_name
    FROM md_flow_definitions f
    JOIN md_flow_trigger_subscriptions t ON t.tenant_id=f.tenant_id AND t.flow_id=f.id
     AND t.flow_type='Schedule-Triggered Flow' AND t.active=true
    JOIN md_tenant_automation_settings s ON s.tenant_id=f.tenant_id
    JOIN md_users u ON u.tenant_id=s.tenant_id AND u.id=s.flow_service_user_id AND u.enabled=true
    WHERE f.flow_type='Schedule-Triggered Flow' AND f.active=true AND f.archived=false
      AND ($1::uuid IS NULL OR (f.tenant_id,f.api_name,f.version,f.id)>
        ($1::uuid,$2::text,$3::integer,$4::uuid))
    ORDER BY f.tenant_id,f.api_name,f.version,f.id LIMIT 200
   `,[last?.tenantId??null,last?.apiName??null,last?.version??null,last?.id??null]);
   if(!rows.length)return scanned;
  for(const row of rows){
   const {rows:metadata}=await this.db.query<MetadataValueRow>(`
    SELECT property_path,value_kind,value_text FROM md_flow_editor_values
    WHERE tenant_id=$1 AND flow_id=$2`,[row.tenant_id,row.id]);
   const graph=decodeMetadataValues(metadata).builder as Record<string,unknown>|undefined;
   const start=Array.isArray(graph?.elements)?graph.elements.find(item=>item&&typeof item==='object'
    &&!Array.isArray(item)&&(item as Record<string,unknown>).type==='Start') as
     {config?:Record<string,unknown>}|undefined:undefined;
   const config=start?.config;
   if(!config)throw new Error('Active scheduled Flow has no Start configuration: '+row.api_name);
   const appApiName=row.app_api_name;
   const configuredApp=typeof graph?.appApiName==='string'&&graph.appApiName
    ?graph.appApiName:null;
   if(configuredApp!==appApiName)
    throw new Error('Scheduled Flow trigger subscription is stale: '+row.api_name);
   if(appApiName&&!identifier.test(appApiName))
    throw new Error('Scheduled Flow app identity is invalid: '+row.api_name);
   if(!await flowAppIsEntitled(this.db,row.tenant_id,appApiName))continue;
   const schedule:Schedule={
    apiName:row.api_name,object:String(config.object??''),startDate:String(config.startDate??''),
    startTime:String(config.startTime??''),timeZone:String(config.timeZone??'UTC'),
    frequency:String(config.frequency??'')
   };
   const scheduledAt=latestOccurrence(schedule,now);
   if(!scheduledAt)continue;
   const key='flow-scheduled:'+createHash('sha256').update(
    `${row.api_name}:${row.version}:${scheduledAt.toISOString()}`).digest('hex');
   await this.jobs.enqueue(row.tenant_id,'flow.scheduled',{
    actorUserId:row.flow_service_user_id,resourceId:row.api_name,
    resourceVersion:row.version,appApiName:appApiName??undefined,
    scheduledAt,idempotencyKey:key
   });
  }
   scanned+=rows.length;
   const final=rows[rows.length-1];
   cursor={tenantId:final.tenant_id,apiName:final.api_name,version:final.version,id:final.id};
   if(rows.length<200)return scanned;
  }
  throw new Error('Scheduled Flow dispatcher scan limit exceeded (20,000)');

 }
}
