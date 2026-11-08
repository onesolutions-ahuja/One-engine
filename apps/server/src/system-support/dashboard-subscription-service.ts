import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SystemDefinitionService} from '../system-files/system-definition-service.js';
import type {NamedCredentialService} from './named-credential-service.js';
import type {DashboardSnapshotService} from './dashboard-snapshot-service.js';

type Actor={tenant_id:string;user_id:string};
type Input={label:string;frequency:'Daily'|'Weekly';localTime:string;timeZone:string;
 dayOfWeek:number|null;recipientUserIds:string[];namedCredentialId:string;fromEmail:string;
 active:boolean;saveSnapshots:boolean};
type Row={id:string;dashboard_api:string;owner_user_id:string;label:string;
 frequency:'Daily'|'Weekly';local_time:string;time_zone:string;day_of_week:number|null;
 recipient_user_ids:string[];credential_id:string;from_email:string;active:boolean;
 save_snapshots:boolean;next_run_at:Date;last_run_at:Date|null;
 last_run_status:string;last_run_error:string|null;created_at:Date;updated_at:Date};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const name=/^[A-Za-z][A-Za-z0-9_]*$/;
const fields=['year','month','day','hour','minute','weekday'] as const;
const parts=(date:Date,zone:string):Record<string,string>=>{
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short'});
 return Object.fromEntries(fmt.formatToParts(date).filter(p=>fields.includes(p.type as typeof fields[number]))
   .map(p=>[p.type,p.value]));
};
export function nextDashboardDeliveryAt(now:Date,zone:string,time:string,frequency:'Daily'|'Weekly',
 dayOfWeek:number|null):Date{
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Invalid delivery time');
 let check:Record<string,string>;
 try {check=parts(now,zone);}catch{throw Error('Invalid delivery timezone');}
 const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const first=Date.UTC(Number(check.year),Number(check.month)-1,Number(check.day));
 const [hour,minute]=time.split(':').map(Number);
 for(let d=0;d<=8;d++){
  const local=new Date(first+d*86400000);
  if(frequency==='Weekly'&&local.getUTCDay()!==dayOfWeek)continue;
  const localTarget=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hour,minute);
  let candidate=localTarget;
  // Convert wall time to UTC with an offset derived at the candidate instant.
  for(let iteration=0;iteration<3;iteration++){
   const displayed=parts(new Date(candidate),zone);
   const projected=Date.UTC(Number(displayed.year),Number(displayed.month)-1,
      Number(displayed.day),Number(displayed.hour),Number(displayed.minute));
   candidate+=localTarget-projected;
  }
  const actual=parts(new Date(candidate),zone);
  if(Number(actual.year)!==local.getUTCFullYear()||Number(actual.month)!==local.getUTCMonth()+1||
    Number(actual.day)!==local.getUTCDate()||Number(actual.hour)!==hour||
    Number(actual.minute)!==minute)continue; // nonexistent DST wall time: next occurrence
  if(candidate>now.getTime())return new Date(candidate);
 }
 throw Error('Cannot schedule dashboard delivery');
}
export class DashboardSubscriptionService {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly definitions:SystemDefinitionService,private readonly credentials:NamedCredentialService,
  private readonly snapshots:DashboardSnapshotService){}
 private async dashboard(actor:Actor,api:string){
  if(!name.test(api))throw Error('Invalid dashboard');
  const available=await this.definitions.list(actor.tenant_id,actor.user_id,'dashboards');
  const raw=available.find(x=>x.apiName===api);
  // SystemDefinition properties are validated JSON metadata. Narrow optional
  // dashboard-sharing properties before enforcing access; fail closed if absent.
  const dashboard=raw as (typeof raw & {status?:unknown;ownerUserId?:unknown;
   visibility?:unknown;sharedUserIds?:unknown})|undefined;
  if(!dashboard||dashboard.status!=='Deployed')throw Error('Dashboard unavailable');
  const ownerUserId=typeof dashboard.ownerUserId==='string'?dashboard.ownerUserId:'';
  const visibility=dashboard.visibility==='All Users'?'All Users':'Private';
  const sharedUserIds=Array.isArray(dashboard.sharedUserIds)
   ?dashboard.sharedUserIds.filter((id:unknown):id is string=>typeof id==='string'):[];
  if(ownerUserId!==actor.user_id&&visibility!=='All Users'&&
   !sharedUserIds.includes(actor.user_id))throw Error('Permission denied');
  return {ownerUserId,visibility,sharedUserIds};
 }
 private validate(value:unknown):Input{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid dashboard subscription');
  const p=value as Record<string,unknown>;
  if(typeof p.label!=='string'||!p.label.trim()||p.label.length>200||
   !['Daily','Weekly'].includes(String(p.frequency))||
   typeof p.localTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.localTime)||
   typeof p.timeZone!=='string'||p.timeZone.length>100||
   (p.frequency==='Weekly'&&(!Number.isInteger(p.dayOfWeek)||Number(p.dayOfWeek)<0||Number(p.dayOfWeek)>6))||
   !Array.isArray(p.recipientUserIds)||p.recipientUserIds.length<1||p.recipientUserIds.length>100||
   p.recipientUserIds.some(id=>typeof id!=='string'||!uuid.test(id))||
   new Set(p.recipientUserIds).size!==p.recipientUserIds.length||
   typeof p.namedCredentialId!=='string'||!uuid.test(p.namedCredentialId)||
   typeof p.fromEmail!=='string'||p.fromEmail.length>254||
   !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p.fromEmail)||
   typeof p.active!=='boolean'||typeof p.saveSnapshots!=='boolean')
    throw Error('Invalid dashboard subscription');
  nextDashboardDeliveryAt(new Date(),p.timeZone,p.localTime,p.frequency as 'Daily'|'Weekly',
   p.dayOfWeek as number|null);
  return p as unknown as Input;
 }
 private view(row:Row){
  return {id:row.id,dashboardApiName:row.dashboard_api,label:row.label,
   frequency:row.frequency,localTime:row.local_time.slice(0,5),timeZone:row.time_zone,
   dayOfWeek:row.day_of_week,recipientUserIds:row.recipient_user_ids,
   namedCredentialId:row.credential_id,fromEmail:row.from_email,
   active:row.active,saveSnapshots:row.save_snapshots,
   nextRunAt:new Date(row.next_run_at).toISOString(),
   lastRunAt:row.last_run_at?new Date(row.last_run_at).toISOString():null,
   lastRunStatus:row.last_run_status,lastRunError:row.last_run_error,
   createdBy:row.owner_user_id,createdAt:new Date(row.created_at).toISOString(),
   updatedAt:new Date(row.updated_at).toISOString()};
 }
 private async verifyRecipients(actor:Actor,api:string,p:Input){
  const {rows}=await this.db.query<{id:string}>(`
   SELECT id FROM md_users WHERE tenant_id=$1 AND enabled=true AND id=ANY($2::uuid[])`,
   [actor.tenant_id,p.recipientUserIds]);
  if(rows.length!==p.recipientUserIds.length)throw Error('Invalid dashboard recipients');
  const dashboard=await this.dashboard(actor,api);
  const shared=Array.isArray(dashboard.sharedUserIds)?dashboard.sharedUserIds:[];
  if(dashboard.visibility!=='All Users'&&p.recipientUserIds.some(id=>
    id!==dashboard.ownerUserId&&!shared.includes(id)))throw Error('Recipient lacks dashboard access');
  const {rows:credentials}=await this.db.query<{id:string}>(`
   SELECT id FROM md_named_credentials
   WHERE tenant_id=$1 AND id=$2 AND protocol='SMTP' AND enabled=true`,
   [actor.tenant_id,p.namedCredentialId]);
  if(!credentials[0])throw Error('SMTP Named Credential unavailable');
 }
 async list(actor:Actor,api:string){
  await this.dashboard(actor,api);
  const {rows}=await this.db.query<Row>(`
   SELECT * FROM md_dashboard_subscriptions
   WHERE tenant_id=$1 AND dashboard_api=$2 AND owner_user_id=$3
   ORDER BY created_at DESC LIMIT 100`,[actor.tenant_id,api,actor.user_id]);
  return rows.map(row=>this.view(row));
 }
 async save(actor:Actor,api:string,value:unknown,id?:string){
  await this.dashboard(actor,api);
  await this.rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:dashboards','manage');
  const p=this.validate(value);
  await this.verifyRecipients(actor,api,p);
  if(id!==undefined&&!uuid.test(id))throw Error('Invalid subscription ID');
  const next=nextDashboardDeliveryAt(new Date(),p.timeZone,p.localTime,p.frequency,p.dayOfWeek);
  const args=[actor.tenant_id,api,actor.user_id,p.label,p.frequency,p.localTime,p.timeZone,
   p.dayOfWeek,p.recipientUserIds,p.namedCredentialId,p.fromEmail,p.active,p.saveSnapshots,next];
  const sql=id?`UPDATE md_dashboard_subscriptions SET label=$4,frequency=$5,local_time=$6,
    time_zone=$7,day_of_week=$8,recipient_user_ids=$9,credential_id=$10,from_email=$11,
    active=$12,save_snapshots=$13,next_run_at=$14,updated_at=now()
    WHERE tenant_id=$1 AND dashboard_api=$2 AND owner_user_id=$3 AND id=$15 RETURNING *`:
   `INSERT INTO md_dashboard_subscriptions(tenant_id,dashboard_api,owner_user_id,
    label,frequency,local_time,time_zone,day_of_week,recipient_user_ids,credential_id,from_email,
    active,save_snapshots,next_run_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`;
  const {rows}=await this.db.query<Row>(sql,id?[...args,id]:args);
  if(!rows[0])throw Error('Subscription not found');
  return this.view(rows[0]);
 }
 async remove(actor:Actor,api:string,id:string){
  await this.dashboard(actor,api);
  await this.rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:dashboards','manage');
  if(!uuid.test(id))throw Error('Invalid subscription ID');
  const {rowCount}=await this.db.query(`
   DELETE FROM md_dashboard_subscriptions WHERE tenant_id=$1 AND dashboard_api=$2
   AND owner_user_id=$3 AND id=$4`,[actor.tenant_id,api,actor.user_id,id]);
  if(!rowCount)throw Error('Subscription not found');
 }
 async run(actor:Actor,api:string,id:string){
  await this.dashboard(actor,api);
  await this.rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:dashboards','manage');
  await this.rbac.require(actor.tenant_id,actor.user_id,'Communication','send');
  await this.rbac.require(actor.tenant_id,actor.user_id,'NamedCredential','read');
  if(!uuid.test(id))throw Error('Invalid subscription ID');
  const now=new Date();
  const {rows}=await this.db.query<Row>(`
   UPDATE md_dashboard_subscriptions SET last_run_status='Pending',
     last_run_at=now(),last_run_error=NULL,updated_at=now()
   WHERE tenant_id=$1 AND dashboard_api=$2 AND owner_user_id=$3 AND id=$4
    AND (last_run_at IS NULL OR last_run_at < now()-interval '30 seconds')
   RETURNING *`,[actor.tenant_id,api,actor.user_id,id]);
  const row=rows[0];if(!row)throw Error('Subscription unavailable or already running');
  try{
   const input:Input={label:row.label,frequency:row.frequency,
    localTime:row.local_time.slice(0,5),timeZone:row.time_zone,
    dayOfWeek:row.day_of_week,recipientUserIds:row.recipient_user_ids,
    namedCredentialId:row.credential_id,fromEmail:row.from_email,
    active:row.active,saveSnapshots:row.save_snapshots};
   await this.verifyRecipients(actor,api,input);
   if(input.saveSnapshots)await this.snapshots.create(actor,api,{label:input.label,
      filters:[],crossFilters:[],customComponents:[]});
   const {rows:users}=await this.db.query<{id:string;email:string}>(`
     SELECT id,email FROM md_users WHERE tenant_id=$1 AND enabled=true AND id=ANY($2::uuid[])
     ORDER BY id`,[actor.tenant_id,input.recipientUserIds]);
   if(users.length!==input.recipientUserIds.length)throw Error('Invalid subscription recipients');
   for(const user of users)await this.credentials.sendTenantEmail(actor.tenant_id,
     input.namedCredentialId,input.fromEmail,user.email,
     'MetaDrive dashboard update: '+input.label,
     'An updated dashboard is available in MetaDrive. Sign in to view it using your current permissions.',
     actor.user_id);
   const next=nextDashboardDeliveryAt(new Date(),row.time_zone,row.local_time.slice(0,5),
     row.frequency,row.day_of_week);
   await this.db.query(`UPDATE md_dashboard_subscriptions
     SET last_run_status='Success',last_run_error=NULL,next_run_at=$4,updated_at=now()
     WHERE tenant_id=$1 AND id=$2 AND owner_user_id=$3`,
     [actor.tenant_id,id,actor.user_id,next]);
  }catch(error){
   const message=error instanceof Error?error.message:'Delivery failed';
   await this.db.query(`UPDATE md_dashboard_subscriptions
     SET last_run_status='Failed',last_run_error=$4,updated_at=now()
     WHERE tenant_id=$1 AND id=$2 AND owner_user_id=$3`,
     [actor.tenant_id,id,actor.user_id,message.slice(0,500)]);
   throw error;
  }
  const {rows:latest}=await this.db.query<Row>(`
   SELECT * FROM md_dashboard_subscriptions WHERE tenant_id=$1 AND id=$2
   AND owner_user_id=$3`,[actor.tenant_id,id,actor.user_id]);
  return this.view(latest[0]);
 }
}
