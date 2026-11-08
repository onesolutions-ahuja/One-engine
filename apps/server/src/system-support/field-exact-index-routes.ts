import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request&{actor?:Actor};
const apiPattern=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const route=(fn:(req:Req,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void fn(req as Req,res).catch(next);};
const supported=['text','email','phone','url','picklist'] as const;
export function registerFieldExactIndexRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 const base='/api/metadata/objects/:objectApi/field-indexes';
 const auth=async(req:Req,mode:'read'|'edit')=>{
  if(!req.actor)throw Error('Permission denied');
  if(!apiPattern.test(req.params.objectApi))throw Error('Invalid Object API name');
  const {tenant_id:tenant,user_id:actor}=req.actor;
  await rbac.require(tenant,actor,'ObjectDefinition',mode==='edit'?'manage':'read');
  await rbac.require(tenant,actor,req.params.objectApi,mode==='edit'?'edit':'read');
  if(mode==='edit')await rbac.require(tenant,actor,'FieldDefinition','manage');
  return req.actor;
 };
 app.get(base,route(async(req,res)=>{
  const actor=await auth(req,'read');
  const {rows}=await db.query<{field_api:string;label:string;enabled:boolean;revision:number}>(`
   SELECT f.api_name AS field_api,COALESCE(f.label,f.api_name) AS label,
    COALESCE(i.enabled,false) AS enabled,COALESCE(i.revision,0)::integer AS revision
   FROM md_field_definitions f LEFT JOIN md_field_exact_indexes i
    ON i.tenant_id=f.tenant_id AND i.object_api=f.object_api AND i.field_api=f.api_name
   WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.deleted_at IS NULL
    AND f.data_type=ANY($3::text[])
   ORDER BY f.api_name`,[actor.tenant_id,req.params.objectApi,supported]);
  const accessible=await Promise.all(rows.map(async item=>await rbac.allowed(
   actor.tenant_id,actor.user_id,req.params.objectApi+'.'+item.field_api,'read')));
  res.setHeader('Cache-Control','private, no-store');
  res.json({indexes:rows.filter((_row,i)=>accessible[i]).map(row=>({
   fieldApi:row.field_api,label:row.label,enabled:row.enabled,revision:row.revision
  }))});
 }));
 app.put(base+'/:fieldApi',route(async(req,res)=>{
  const actor=await auth(req,'edit');
  if(!apiPattern.test(req.params.fieldApi)
   ||typeof req.body?.enabled!=='boolean'
   ||!Number.isSafeInteger(req.body?.revision)||req.body.revision<0)
   throw Error('Invalid index preference');
  await rbac.require(actor.tenant_id,actor.user_id,
   req.params.objectApi+'.'+req.params.fieldApi,'read');
  const {tenant_id:tenant,user_id:user}=actor;
  const obj=req.params.objectApi,field=req.params.fieldApi;
  const enabled=req.body.enabled as boolean,expected=req.body.revision as number;
  const revision=await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [tenant+':field-index:'+obj]);
   const definition=await client.query(`SELECT 1 FROM md_field_definitions
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL
    AND data_type=ANY($4::text[])`,[tenant,obj,field,supported]);
   if(!definition.rowCount)throw Error('Only active scalar Text/Email/Phone/URL/Picklist fields can be indexed');
   const current=await client.query<{revision:number;enabled:boolean}>(`
    SELECT revision,enabled FROM md_field_exact_indexes
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 FOR UPDATE`,[tenant,obj,field]);
   const existing=current.rows[0];
   const version=existing?.revision??0;
   if(version!==expected)throw Error('Field index revision conflict');
   if(existing?.enabled===enabled)return version;
   if(enabled){
    const count=await client.query<{total:number}>(`SELECT count(*)::integer AS total
     FROM md_field_exact_indexes WHERE tenant_id=$1 AND object_api=$2 AND enabled
     AND field_api<>$3`,[tenant,obj,field]);
    if(count.rows[0].total>=24)throw Error('At most 24 exact indexes per Object');
   }
   const written=await client.query<{revision:number}>(`INSERT INTO md_field_exact_indexes
    (tenant_id,object_api,field_api,enabled,revision) VALUES($1,$2,$3,$4,1)
    ON CONFLICT(tenant_id,object_api,field_api) DO UPDATE
     SET enabled=EXCLUDED.enabled,revision=md_field_exact_indexes.revision+1,
      updated_at=now() RETURNING revision`,[tenant,obj,field,enabled]);
   const next=written.rows[0]?.revision;
   if(!next)throw Error('Could not configure field index');
   await client.query(`INSERT INTO md_field_exact_index_history
    (tenant_id,object_api,field_api,revision,enabled,actor_user_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[tenant,obj,field,next,enabled,user]);
   return next;
  });
  res.setHeader('Cache-Control','private, no-store');
  res.json({saved:true,fieldApi:field,enabled,revision});
 }));
}
