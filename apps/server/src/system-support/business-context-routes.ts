import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
type Actor={tenant_id:string;user_id:string};
type AuthRequest=Request&{actor?:Actor};
const name=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const route=(fn:(req:AuthRequest,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void fn(req as AuthRequest,res).catch(next);};
const actorOf=(req:AuthRequest):Actor=>{
 if(!req.actor?.tenant_id||!req.actor?.user_id)throw Error('Authenticated tenant required');
 return req.actor;
};
/** Metadata definitions, and each actor's own Context selection. No cross-user access. */
export function registerBusinessContextRoutes(app:Express,db:SqlPersistence,
 rbac:RbacEngine,records:RecordEngine){
 app.get('/api/contexts/definitions',route(async(req,res)=>{
  const actor=actorOf(req);
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
  const {rows}=await db.query<{api_name:string;label:string;object_api:string}>(
   'SELECT api_name,label,object_api FROM md_context_definitions WHERE tenant_id=$1 ORDER BY label,api_name',
   [actor.tenant_id]);
  const rights=await rbac.allowedMany(actor.tenant_id,actor.user_id,
   rows.map(row=>({resource:row.object_api,action:'read'})));
  res.json({contexts:rows.filter((_,index)=>rights[index]).map(row=>({
   apiName:row.api_name,label:row.label,objectApiName:row.object_api
  }))});
 }));
 app.post('/api/contexts/definitions',route(async(req,res)=>{
  const actor=actorOf(req);
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','create');
  const {apiName,label,objectApiName}=req.body??{};
  if(typeof apiName!=='string'||!name.test(apiName)
   ||typeof label!=='string'||!label.trim()||label.length>200
   ||typeof objectApiName!=='string'||!name.test(objectApiName))
   throw Error('Invalid Context definition');
  await db.transaction(async client=>{
   const found=await client.query(
    'SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',
    [actor.tenant_id,objectApiName]);
   if(!found.rows.length)throw Error('Unknown Context Object');
   await client.query(
    'INSERT INTO md_context_definitions(tenant_id,api_name,label,object_api) VALUES($1,$2,$3,$4)',
    [actor.tenant_id,apiName,label.trim(),objectApiName]);
   await client.query(
    "INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,'context.definition.created',jsonb_build_object('context',$3::text,'object',$4::text))",
    [actor.tenant_id,actor.user_id,apiName,objectApiName]);
  });
  res.status(201).json({apiName,label:label.trim(),objectApiName});
 }));
 const resolve=async(req:AuthRequest)=>{
  const actor=actorOf(req),apiName=req.params.apiName;
  if(!name.test(apiName))throw Error('Invalid Context name');
  const {rows}=await db.query<{object_api:string}>(
   'SELECT object_api FROM md_context_definitions WHERE tenant_id=$1 AND api_name=$2',
   [actor.tenant_id,apiName]);
  if(!rows[0])throw Error('Unknown Context');
  await rbac.require(actor.tenant_id,actor.user_id,rows[0].object_api,'read');
  return {actor,apiName,objectApi:rows[0].object_api};
 };
 app.get('/api/contexts/current/:apiName',route(async(req,res)=>{
  const {actor,apiName,objectApi}=await resolve(req);
  const {rows}=await db.query<{record_id:string}>(
   'SELECT record_id FROM md_user_context_selections WHERE tenant_id=$1 AND user_id=$2 AND context_api=$3',
   [actor.tenant_id,actor.user_id,apiName]);
  if(!rows[0]){res.json({contextApiName:apiName,objectApiName:objectApi,record:null});return;}
  const record=await records.get(actor.tenant_id,actor.user_id,objectApi,rows[0].record_id);
  res.json({contextApiName:apiName,objectApiName:objectApi,record});
 }));
 app.put('/api/contexts/current/:apiName',route(async(req,res)=>{
  const {actor,apiName,objectApi}=await resolve(req),recordId=req.body?.recordId;
  if(recordId!==null&&(typeof recordId!=='string'||!uuid.test(recordId)))
   throw Error('Invalid Context record ID');
  await db.transaction(async client=>{
   if(recordId===null)await client.query(
    'DELETE FROM md_user_context_selections WHERE tenant_id=$1 AND user_id=$2 AND context_api=$3',
    [actor.tenant_id,actor.user_id,apiName]);
   else{
    await records.get(actor.tenant_id,actor.user_id,objectApi,recordId,client);
    await client.query(
     'INSERT INTO md_user_context_selections(tenant_id,user_id,context_api,record_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,user_id,context_api) DO UPDATE SET record_id=EXCLUDED.record_id,updated_at=now()',
     [actor.tenant_id,actor.user_id,apiName,recordId]);
   }
   await client.query(
    "INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,'context.selection.changed',jsonb_build_object('context',$3::text,'operation',$4::text))",
    [actor.tenant_id,actor.user_id,apiName,recordId===null?'clear':'set']);
  });
  res.json({contextApiName:apiName,recordId});
 }));
}
