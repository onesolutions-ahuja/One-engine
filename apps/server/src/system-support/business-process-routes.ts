import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {snapshotBusinessProcessRevision,restoreBusinessProcessRevision} from './business-process-history.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request&{actor?:Actor};
const ident=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const route=(handler:(req:Req,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void handler(req as Req,res).catch(next);};

/** Object business processes reuse the central Record Type picklist runtime. */
export function registerBusinessProcessRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 const base='/api/metadata/objects/:objectApi/business-processes';
 const authorize=async(req:Req,mode:'read'|'manage')=>{
  if(!req.actor||!ident.test(req.params.objectApi))throw new Error('Permission denied');
  await rbac.require(req.actor.tenant_id,req.actor.user_id,'ObjectDefinition',mode);
  return req.actor;
 };
 app.get(base,route(async(req,res)=>{
  const actor=await authorize(req,'read');
  const [processes,values]=await Promise.all([
   db.query<{api_name:string;label:string;status_field:string;active:boolean;revision:number}>(`
    SELECT api_name,label,status_field,active,revision
    FROM md_object_business_processes WHERE tenant_id=$1 AND object_api=$2 ORDER BY label,api_name`,
    [actor.tenant_id,req.params.objectApi]),
   db.query<{process_api:string;value_text:string}>(`
    SELECT process_api,value_text FROM md_object_business_process_values
    WHERE tenant_id=$1 AND object_api=$2 ORDER BY process_api,sort_order`,
    [actor.tenant_id,req.params.objectApi])
  ]);
  res.json({processes:processes.rows.map(process=>({
   apiName:process.api_name,label:process.label,statusField:process.status_field,
   active:process.active,revision:process.revision,
   values:values.rows.filter(value=>value.process_api===process.api_name)
    .map(value=>value.value_text)
  }))});
 }));
 app.get(base+'/:processApi/history',route(async(req,res)=>{
  const actor=await authorize(req,'read');
  if(!ident.test(req.params.processApi))throw new Error('Invalid business process');
  const ids=[actor.tenant_id,req.params.objectApi,req.params.processApi];
  const [entries,values]=await Promise.all([
   db.query<{revision:number;label:string;status_field:string;active:boolean;created_at:Date}>(`
    SELECT revision,label,status_field,active,created_at
    FROM md_object_business_process_history
    WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3
    ORDER BY revision DESC LIMIT 100`,ids),
   db.query<{revision:number;value_text:string}>(`
    SELECT revision,value_text FROM md_object_business_process_history_values
    WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3
      AND revision IN(SELECT revision FROM md_object_business_process_history
       WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3
       ORDER BY revision DESC LIMIT 100)
    ORDER BY revision DESC,sort_order`,ids)
  ]);
  res.json({history:entries.rows.map(entry=>({
   version:entry.revision,label:entry.label,statusField:entry.status_field,
   active:entry.active,createdAt:entry.created_at,
   values:values.rows.filter(value=>value.revision===entry.revision)
    .map(value=>value.value_text)
  }))});
 }));
 app.put(base+'/:processApi',route(async(req,res)=>{
  const actor=await authorize(req,'manage');
  const body=req.body;
  if(!ident.test(req.params.processApi)||!body||typeof body!=='object'||Array.isArray(body)
   ||typeof body.label!=='string'||!body.label.trim()||body.label.length>160
   ||!ident.test(body.statusField)||typeof body.active!=='boolean'
   ||!Number.isSafeInteger(body.revision)||body.revision<0
   ||!Array.isArray(body.values)||!body.values.length||body.values.length>200
   ||body.values.some((x:unknown)=>typeof x!=='string'||!x.trim()||x.length>255)
   ||new Set(body.values).size!==body.values.length)
   throw new Error('Invalid business process');
  const revision=await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [actor.tenant_id+':business-process:'+req.params.objectApi+':'+req.params.processApi]);
   const field=await client.query<{data_type:string}>(`
    SELECT data_type FROM md_field_definitions
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
    [actor.tenant_id,req.params.objectApi,body.statusField]);
   if(field.rows[0]?.data_type!=='picklist')throw new Error('A business process requires a Picklist status field');
   const available=await client.query<{value:string}>(`
    SELECT value FROM md_field_picklist_values
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
    [actor.tenant_id,req.params.objectApi,body.statusField]);
   const allowed=new Set(available.rows.map(row=>row.value));
   if(body.values.some((x:string)=>!allowed.has(x)))throw new Error('Invalid business process value');
   const values=[actor.tenant_id,req.params.objectApi,req.params.processApi,
    body.label.trim(),body.statusField,body.active];
   const saved=body.revision===0
    ?await client.query<{revision:number}>(`
     INSERT INTO md_object_business_processes
      (tenant_id,object_api,api_name,label,status_field,active,revision)
     VALUES($1,$2,$3,$4,$5,$6,1)
     ON CONFLICT DO NOTHING RETURNING revision`,values)
    :await client.query<{revision:number}>(`
     UPDATE md_object_business_processes SET label=$4,status_field=$5,
      active=$6,revision=revision+1,updated_at=now()
     WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND revision=$7
     RETURNING revision`,[...values,body.revision]);
   if(!saved.rows[0])throw new Error('Business process revision conflict');
   await client.query(`DELETE FROM md_object_business_process_values
    WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3`,
    [actor.tenant_id,req.params.objectApi,req.params.processApi]);
   for(const [order,value] of (body.values as string[]).entries())
    await client.query(`INSERT INTO md_object_business_process_values
     (tenant_id,object_api,process_api,value_text,sort_order) VALUES($1,$2,$3,$4,$5)`,
     [actor.tenant_id,req.params.objectApi,req.params.processApi,value,order]);
   await snapshotBusinessProcessRevision(client,{tenantId:actor.tenant_id,objectApi:req.params.objectApi,
    processApi:req.params.processApi,actorId:actor.user_id});
   return saved.rows[0].revision;
  });
  res.json({saved:true,revision});
 }));
 app.post(base+'/:processApi/restore',route(async(req,res)=>{
  const actor=await authorize(req,'manage');
  if(!ident.test(req.params.processApi))throw new Error('Invalid business process');
  const version=req.body?.version,expectedRevision=req.body?.expectedRevision;
  if(!Number.isSafeInteger(version)||version<1
     ||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
   throw new Error('Invalid business process restore');
  const revision=await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [actor.tenant_id+':business-process:'+req.params.objectApi+':'+req.params.processApi]);
   return restoreBusinessProcessRevision(client,{
    tenantId:actor.tenant_id,objectApi:req.params.objectApi,
    processApi:req.params.processApi,actorId:actor.user_id
   },version,expectedRevision);
  });
  res.json({restored:true,revision});
 }));
 app.delete(base+'/:processApi',route(async(req,res)=>{
  const actor=await authorize(req,'manage');
  if(!ident.test(req.params.processApi))throw new Error('Invalid business process');
  await db.transaction(async client=>{
   const referenced=await client.query(`SELECT 1 FROM md_object_record_types
    WHERE tenant_id=$1 AND object_api=$2 AND business_process_api_name=$3 LIMIT 1`,
    [actor.tenant_id,req.params.objectApi,req.params.processApi]);
   if(referenced.rows.length)throw new Error('Business process is assigned to a record type');
   await client.query(`DELETE FROM md_object_business_processes
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3`,
    [actor.tenant_id,req.params.objectApi,req.params.processApi]);
  });
  res.status(204).end();
 }));
}
