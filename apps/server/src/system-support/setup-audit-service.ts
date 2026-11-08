import {PlatformTenantService} from '../system-files/platform-tenant-service.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
export class SetupAuditService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async catalogue(tenant:string,user:string){
  await this.rbac.require(tenant,user,'Security','read');
  return (await this.db.query('SELECT permission_key,label,description,resource,action FROM md_system_permission_catalogue ORDER BY label')).rows;
 }
 async list(tenant:string,user:string,options:{before?:unknown;limit?:unknown;table?:unknown;actor?:unknown;from?:unknown;to?:unknown;global?:boolean;export?:boolean}={}){
  await this.rbac.require(tenant,user,'SetupAudit',options.export?'export':'read');
  if(options.global){await new PlatformTenantService(this.db,this.rbac).requirePlatform(tenant,user);await this.rbac.require(tenant,user,'PlatformTenant','manage');}
  const limit=Number(options.limit??100);if(!Number.isSafeInteger(limit)||limit<1||limit>(options.export?5000:200))throw Error('Invalid audit page size');
  const before=options.before??null;if(before!==null&&(typeof before!=='string'||!/^\d{1,19}$/.test(before)))throw Error('Invalid audit cursor');
  const table=options.table??null;if(table!==null&&(typeof table!=='string'||!/^md_[a-z0-9_]{1,100}$/.test(table)))throw Error('Invalid audit table');
  const actor=options.actor===undefined||options.actor===null||options.actor===''?null:options.actor;
  if(actor!==null&&(typeof actor!=='string'||!/^[0-9a-f-]{2,36}$/i.test(actor)))throw Error('Invalid audit actor filter');
  const from=options.from===undefined||options.from===null||options.from===''?null:options.from;
  const to=options.to===undefined||options.to===null||options.to===''?null:options.to;
  for(const value of [from,to]){
   if(value!==null&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))))throw Error('Invalid audit date filter');
  }
  if(from&&to&&from>to)throw Error('Audit From date must be on or before To date');
  const {rows}=await this.db.query(`SELECT id::text,tenant_id,actor_tenant_id,actor_user_id,correlation_id,table_name,operation,row_identifier,changed_fields,created_at
   FROM md_setup_audit_events WHERE ${options.global?'tenant_id IS NULL AND $1::uuid IS NOT NULL':'tenant_id=$1'} AND ($2::bigint IS NULL OR id<$2)
   AND ($3::text IS NULL OR table_name=$3)
   AND ($5::text IS NULL OR actor_user_id::text ILIKE '%'||$5||'%')
   AND ($6::date IS NULL OR created_at >= $6::date)
   AND ($7::date IS NULL OR created_at < ($7::date + INTERVAL '1 day'))
   ORDER BY id DESC LIMIT $4`,[tenant,before,table,limit,actor,from,to]);
  return {events:rows,nextCursor:rows.length===limit?String(rows.at(-1)?.id):null};
 }
 async coverage(tenant:string,user:string){
  await this.rbac.require(tenant,user,'SetupAudit','read');
  return (await this.db.query('SELECT table_name FROM md_setup_audit_tables ORDER BY table_name')).rows;
 }
}
export function auditCsv(events:Record<string,unknown>[]){
 const keys=['id','tenant_id','actor_user_id','correlation_id','table_name','operation','row_identifier','changed_fields','created_at'];
 const cell=(v:unknown)=>{let s=Array.isArray(v)?v.join(';'):v instanceof Date?v.toISOString():String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return [keys.join(','),...events.map(e=>keys.map(k=>cell(e[k])).join(','))].join('\r\n');
}
