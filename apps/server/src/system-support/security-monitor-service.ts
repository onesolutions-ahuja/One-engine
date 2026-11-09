import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {RbacEngine} from '../system-files/rbac-engine.js';
import {DurableJobService} from './durable-job-service.js';
import {decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';
type Actor={tenant_id:string;user_id:string};
export type MonitorRequest={actor:Actor;correlationId:string;eventType:'api'|'metadata'|'login';path:string;method:string;ip:string|null};
const rule=z.object({id:z.string().uuid().optional(),label:z.string().trim().min(1).max(100),enabled:z.boolean(),event_type:z.enum(['api','metadata','login']),
 method:z.enum(['*','GET','POST','PUT','PATCH','DELETE']),path_prefix:z.string().regex(/^\/(api|services)(\/[A-Za-z0-9_:/.-]*)?$/).max(200),
 threshold:z.number().int().min(1).max(100000),window_seconds:z.number().int().min(1).max(86400),response:z.enum(['Block','RevokeSessions','Flow']),
 flow_api:z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).nullable().default(null),service_user_id:z.string().uuid().nullable().default(null)}).strict();
export function monitorPath(raw:string){return raw.split('?')[0].split('/').map(s=>/^[0-9a-f-]{36}$/i.test(s)?':id':/^\d+$/.test(s)?':number':/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(s)?s:s===''?'':':value').join('/').slice(0,300);}
export class SecurityMonitorService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async enforce(input:MonitorRequest){
  const id=randomUUID();
  // Common case: the tenant has no rule for this request. Log the event and check for rules in ONE
  // round trip instead of a 5-statement transaction on every API request. When a rule does apply,
  // the original transactional path below enforces it (the event is already logged).
  // Every value has its own parameter so Postgres infers each type from its single use, exactly as
  // the separate statements did (no cross-statement type conflicts on enum or domain columns).
  const quick=await this.db.query<{rule_count:number}>(`WITH settings AS (
     SELECT enabled FROM md_monitor_settings WHERE tenant_id=$1
    ), logged AS (
     INSERT INTO md_monitor_events(id,tenant_id,actor_user_id,correlation_id,event_type,resource,method,status_code,elapsed_ms,source_ip)
     SELECT $2,$3,$4,$5,$6,$7,$8,0,0,$9::inet WHERE COALESCE((SELECT enabled FROM settings),true)<>false
     RETURNING id
    ) SELECT (SELECT count(*) FROM md_transaction_security_rules
      WHERE tenant_id=$10 AND enabled=true AND event_type=$11 AND (method='*' OR method=$12)
      AND starts_with($13,path_prefix))::integer AS rule_count`,
   [input.actor.tenant_id,id,input.actor.tenant_id,input.actor.user_id,input.correlationId,input.eventType,
    monitorPath(input.path),input.method,input.ip,input.actor.tenant_id,input.eventType,input.method,input.path]);
  if(Number(quick.rows[0]?.rule_count??0)===0)return {id,blocked:false};
  const blocked=await this.db.transaction(async c=>{
   const {rows}=await c.query<z.infer<typeof rule>>(`SELECT id,label,enabled,event_type,method,path_prefix,threshold,window_seconds,response,flow_api,service_user_id
    FROM md_transaction_security_rules WHERE tenant_id=$1 AND enabled=true AND event_type=$2 AND (method='*' OR method=$3)
    AND starts_with($4,path_prefix) ORDER BY id FOR SHARE`,[input.actor.tenant_id,input.eventType,input.method,input.path]);
   let deny=false;
   for(const r of rows){
    const counter=await c.query<{count:number;window_start:Date}>(`INSERT INTO md_security_rule_windows(tenant_id,rule_id,user_id,window_start,count)
     VALUES($1,$2,$3,now(),1) ON CONFLICT(tenant_id,rule_id,user_id) DO UPDATE SET
      count=CASE WHEN md_security_rule_windows.window_start<=now()-($4::integer*interval '1 second') THEN 1 ELSE md_security_rule_windows.count+1 END,
      window_start=CASE WHEN md_security_rule_windows.window_start<=now()-($4::integer*interval '1 second') THEN now() ELSE md_security_rule_windows.window_start END
     RETURNING count,window_start`,[input.actor.tenant_id,r.id,input.actor.user_id,r.window_seconds]);
    const window=counter.rows[0];if(!window||window.count<r.threshold)continue;
    if(r.response==='Block'||r.response==='RevokeSessions')deny=true;
    if(r.response==='RevokeSessions')for(const table of ['md_sessions','md_refresh_sessions'])await c.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[input.actor.tenant_id,input.actor.user_id]);
    if(window.count===r.threshold){
     await c.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'TransactionSecurityTriggered')",[input.actor.tenant_id,input.actor.user_id]);
     if(r.response==='Flow'&&r.flow_api&&r.service_user_id){
      const flow=await c.query<{id:string;version:number}>('SELECT id,version FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 AND active=true AND archived=false ORDER BY version DESC LIMIT 1',[input.actor.tenant_id,r.flow_api]);
      if(!flow.rows[0])throw Error('Transaction security Flow is unavailable');
      const properties=await c.query<MetadataValueRow>('SELECT property_path,value_kind,value_text FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',[input.actor.tenant_id,flow.rows[0].id]);
      const graph=decodeMetadataValues(properties.rows).builder as Record<string,unknown>|undefined;
      await new DurableJobService(this.db).enqueue(input.actor.tenant_id,'flow.execute',{actorUserId:r.service_user_id,resourceId:r.flow_api,resourceVersion:flow.rows[0].version,
       appApiName:typeof graph?.appApiName==='string'?graph.appApiName:undefined,idempotencyKey:`security:${r.id}:${input.actor.user_id}:${new Date(window.window_start).toISOString()}`},c);
     }
    }
   }return deny;
  });return {id,blocked};
 }
 // Request results are written in one statement every 0.5 s, not one UPDATE per request.
 private readonly completed:Array<{tenant:string;id:string;status:number;elapsed:number;done:()=>void;fail:(e:unknown)=>void}>=[];
 private completeTimer:ReturnType<typeof setTimeout>|null=null;
 async complete(tenant:string,id:string,status:number,elapsed:number){
  return new Promise<void>((done,fail)=>{
   this.completed.push({tenant,id,status,elapsed:Math.min(2147483647,Math.max(0,Math.floor(elapsed))),done,fail});
   if(this.completed.length>=500){void this.flushCompleted();return;}
   if(!this.completeTimer){
    this.completeTimer=setTimeout(()=>{void this.flushCompleted();},500);
    this.completeTimer.unref?.();
   }
  });
 }
 private async flushCompleted(){
  if(this.completeTimer){clearTimeout(this.completeTimer);this.completeTimer=null;}
  const batch=this.completed.splice(0,this.completed.length);
  if(!batch.length)return;
  try{
   await this.db.query(`UPDATE md_monitor_events e SET status_code=v.status_code,elapsed_ms=v.elapsed_ms
    FROM unnest($1::uuid[],$2::uuid[],$3::integer[],$4::integer[]) AS v(tenant_id,id,status_code,elapsed_ms)
    WHERE e.tenant_id=v.tenant_id AND e.id=v.id`,
    [batch.map(item=>item.tenant),batch.map(item=>item.id),batch.map(item=>item.status),batch.map(item=>item.elapsed)]);
   batch.forEach(item=>item.done());
  }catch(error){batch.forEach(item=>item.fail(error));}
 }
 async describe(tenant:string,user:string,before?:unknown,requestedLimit?:unknown){
  await this.rbac.require(tenant,user,'SecurityMonitoring','read');
  const limit=Number(requestedLimit??100);
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('Invalid monitoring page size');
  const parts=typeof before==='string'?before.split('|'):[];
  if(before!==undefined&&(parts.length!==2||!Number.isFinite(Date.parse(parts[0]))||!z.string().uuid().safeParse(parts[1]).success))throw Error('Invalid monitoring cursor');
  const [events,rules,settings,totals]=await Promise.all([
   this.db.query('SELECT id,actor_user_id,correlation_id,event_type,resource,method,status_code,elapsed_ms,source_ip,created_at,created_at::text AS cursor_time FROM md_monitor_events WHERE tenant_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4',[tenant,parts[0]??null,parts[1]??null,limit+1]),
   this.db.query('SELECT id,label,enabled,event_type,method,path_prefix,threshold,window_seconds,response,flow_api,service_user_id FROM md_transaction_security_rules WHERE tenant_id=$1 ORDER BY label',[tenant]),
   this.db.query('SELECT enabled,retention_days FROM md_monitor_settings WHERE tenant_id=$1',[tenant]),
   this.db.query("SELECT count(*)::integer AS requests,count(*) FILTER(WHERE status_code>=400)::integer AS errors,COALESCE(avg(elapsed_ms),0)::integer AS average_ms FROM md_monitor_events WHERE tenant_id=$1 AND created_at>now()-interval '24 hours'",[tenant])]);
  const page=events.rows.slice(0,limit);
  return {events:page,rules:rules.rows,settings:settings.rows[0]??{enabled:true,retention_days:365},summary:totals.rows[0],nextCursor:events.rows.length>limit?String(page.at(-1)?.cursor_time)+'|'+String(page.at(-1)?.id):null};
 }
 async saveRule(tenant:string,user:string,input:unknown){
  await this.rbac.require(tenant,user,'SecurityMonitoring','manage');
  const parsed=rule.safeParse(input);if(!parsed.success)throw Error('Invalid transaction security rule');const r=parsed.data;
  if(r.response==='Flow'){
   if(!r.flow_api||!r.service_user_id)throw Error('Invalid security Flow identity');
   await this.rbac.require(tenant,user,'FlowDefinition','system-context');
   await this.rbac.require(tenant,user,'Flow:'+r.flow_api,'execute');
   await this.rbac.require(tenant,r.service_user_id,'Flow:'+r.flow_api,'execute');
   const flow=await this.db.query("SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 AND active=true AND archived=false AND flow_type='Autolaunched Flow'",[tenant,r.flow_api]);
   if(!flow.rows[0])throw Error('Invalid security Flow: publish an Autolaunched Flow first');
  }
  await this.db.transaction(async c=>{
  await c.query(`INSERT INTO md_transaction_security_rules(tenant_id,id,label,enabled,event_type,method,path_prefix,threshold,window_seconds,response,flow_api,service_user_id)
   VALUES($1,COALESCE($2::uuid,gen_random_uuid()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
   ON CONFLICT(tenant_id,id) DO UPDATE SET label=$3,enabled=$4,event_type=$5,method=$6,path_prefix=$7,threshold=$8,window_seconds=$9,response=$10,flow_api=$11,service_user_id=$12`,
   [tenant,r.id??null,r.label,r.enabled,r.event_type,r.method,r.path_prefix,r.threshold,r.window_seconds,r.response,r.flow_api,r.service_user_id]);
  if(r.id){
   await c.query('DELETE FROM md_security_rule_windows WHERE tenant_id=$1 AND rule_id=$2',[tenant,r.id]);
   await c.query("UPDATE md_durable_jobs SET status='cancelled',updated_at=now() WHERE tenant_id=$1 AND job_type='flow.execute' AND status='queued' AND starts_with(idempotency_key,$2)",[tenant,'security:'+r.id+':']);
  }
  });return {saved:true};
 }
 async configure(tenant:string,user:string,input:unknown){
  await this.rbac.require(tenant,user,'SecurityMonitoring','manage');const p=z.object({enabled:z.boolean(),retention_days:z.number().int().min(90).max(3650)}).strict().safeParse(input);
  if(!p.success)throw Error('Invalid monitoring settings');
  await this.db.query('INSERT INTO md_monitor_settings VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET enabled=$2,retention_days=$3',[tenant,p.data.enabled,p.data.retention_days]);return {saved:true};
 }
 async prunePreview(tenant:string,user:string){
  await this.rbac.require(tenant,user,'SecurityMonitoring','manage');
  const result=await this.db.query<{eligible:string;retention_days:number}>(`
    SELECT count(e.id)::text AS eligible,
      COALESCE((SELECT retention_days FROM md_monitor_settings WHERE tenant_id=$1),365)::integer AS retention_days
    FROM md_monitor_events e
    WHERE e.tenant_id=$1
      AND e.created_at<now()-(COALESCE((SELECT retention_days FROM md_monitor_settings WHERE tenant_id=$1),365)*interval '1 day')`,[tenant]);
  return {eligible:Number(result.rows[0]?.eligible??0),retentionDays:Number(result.rows[0]?.retention_days??365)};
 }
 async prune(tenant:string,user:string,confirmation?:unknown,expectedRetentionDays?:unknown){
  await this.rbac.require(tenant,user,'SecurityMonitoring','manage');
  if(confirmation!=='PRUNE'||typeof expectedRetentionDays!=='number'||!Number.isSafeInteger(expectedRetentionDays)
   ||expectedRetentionDays<90||expectedRetentionDays>3650)
   throw new Error('Explicit retention cleanup confirmation is required');
  return this.db.transaction(async c=>{
   const policy=await c.query<{retention_days:number}>('SELECT retention_days FROM md_monitor_settings WHERE tenant_id=$1 FOR SHARE',[tenant]);
   const days=Number(policy.rows[0]?.retention_days??365);
   if(days!==expectedRetentionDays)throw new Error('Retention policy changed; review the cleanup preview again');
   const result=await c.query(`DELETE FROM md_monitor_events
     WHERE tenant_id=$1 AND created_at<now()-($2*interval '1 day')`,[tenant,days]);
   return {removed:result.rowCount??0};
  });
 }
}
