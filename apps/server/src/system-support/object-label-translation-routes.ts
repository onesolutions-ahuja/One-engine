import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request&{actor?:Actor};
type Translation={object_api:string;field_api:string;language:string;value_text:string};
const name=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const language=/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/;
const route=(fn:(req:Req,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void fn(req as Req,res).catch(next);};

export function requestedLabelLanguage(accept:unknown):string{
 if(typeof accept!=='string')return 'en';
 for(const item of accept.split(',')){
  const code=item.split(';')[0]?.trim().toLowerCase();
  if(code&&language.test(code))return code;
 }
 return 'en';
}
export function applyObjectLabelTranslations<T extends {
 apiName:string;label:string;pluralLabel:string;
 fields:Array<{apiName:string;label:string}>
}>(objects:T[],rows:Translation[],lang:string):T[]{
 const grouped=new Map<string,Map<string,string>>();
 // Prefer locale-specific labels, then base-language fallback.
 for(const locale of [lang.split('-')[0],lang]){
  for(const row of rows){
   if(row.language!==locale)continue;
   const byField=grouped.get(row.object_api)??new Map<string,string>();
   byField.set(row.field_api,row.value_text);
   grouped.set(row.object_api,byField);
  }
 }
 return objects.map(object=>{
  const translated=grouped.get(object.apiName);
  return translated?{...object,
   label:translated.get('')??object.label,
   pluralLabel:translated.get('*')??object.pluralLabel,
   fields:object.fields.map(field=>({...field,
    label:translated.get(field.apiName)??field.label}))}:object;
 });
}
export function registerObjectLabelTranslationRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 const base='/api/metadata/objects/:objectApi/translations';
 const auth=async(req:Req,action:'read'|'manage')=>{
  if(!req.actor)throw new Error('Permission denied');
  if(!name.test(req.params.objectApi))throw new Error('Invalid Object API name');
  await rbac.require(req.actor.tenant_id,req.actor.user_id,'ObjectDefinition',action);
  await rbac.require(req.actor.tenant_id,req.actor.user_id,req.params.objectApi,
   action==='manage'?'edit':'read');
  return req.actor;
 };
 const validateLanguage=(input:unknown)=>{
  if(typeof input!=='string'||!language.test(input))throw new Error('Invalid translation language');
  return input;
 };
 app.get(base,route(async(req,res)=>{
  const actor=await auth(req,'read');
  const lang=validateLanguage(req.query.language??'en');
  const [values,revision]=await Promise.all([
   db.query<Translation>(`SELECT object_api,field_api,language,value_text
    FROM md_object_label_translations WHERE tenant_id=$1 AND object_api=$2 AND language=$3
    ORDER BY field_api`,[actor.tenant_id,req.params.objectApi,lang]),
   db.query<{revision:number}>(`SELECT revision FROM md_object_label_translation_revisions
    WHERE tenant_id=$1 AND object_api=$2 AND language=$3`,
    [actor.tenant_id,req.params.objectApi,lang])
  ]);
  const visible=await Promise.all(values.rows.map(async row=>
   row.field_api===''||row.field_api==='*'
    ||await rbac.allowed(actor.tenant_id,actor.user_id,
     req.params.objectApi+'.'+row.field_api,'read')));
  res.setHeader('Cache-Control','private, no-store');
  res.json({language:lang,revision:revision.rows[0]?.revision??0,
   values:Object.fromEntries(values.rows.filter((_row,index)=>visible[index])
    .map(row=>[row.field_api,row.value_text]))});
 }));
 app.put(base,route(async(req,res)=>{
  const actor=await auth(req,'manage');
  const lang=validateLanguage(req.body?.language);
  const revision=req.body?.revision;
  const input=req.body?.values;
  if(!Number.isSafeInteger(revision)||revision<0||!input||typeof input!=='object'
   ||Array.isArray(input)||Object.keys(input).length>200
   ||Object.entries(input).some(([field,value])=>
    !(field===''||field==='*'||name.test(field))
    ||typeof value!=='string'||value.trim().length===0||value.length>255))
   throw new Error('Invalid translation values');
  const values=input as Record<string,string>;
  const next=await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [actor.tenant_id+':label-translations:'+req.params.objectApi+':'+lang]);
   const existing=await client.query<{revision:number}>(`SELECT revision FROM md_object_label_translation_revisions
    WHERE tenant_id=$1 AND object_api=$2 AND language=$3 FOR UPDATE`,
    [actor.tenant_id,req.params.objectApi,lang]);
   const current=existing.rows[0]?.revision??0;
   if(current!==revision)throw new Error('Translation revision conflict');
   const fieldNames=Object.keys(values).filter(key=>key!==''&&key!=='*');
   if(fieldNames.length){
    const fields=await client.query<{api_name:string}>(`SELECT api_name FROM md_field_definitions
     WHERE tenant_id=$1 AND object_api=$2 AND api_name=ANY($3::text[]) AND deleted_at IS NULL`,
     [actor.tenant_id,req.params.objectApi,fieldNames]);
    if(fields.rows.length!==fieldNames.length)throw new Error('Unknown translation field');
   }
   for(const fieldName of fieldNames)
    await rbac.require(actor.tenant_id,actor.user_id,
     req.params.objectApi+'.'+fieldName,'read');
   const changed=await client.query<{revision:number}>(`INSERT INTO md_object_label_translation_revisions
    (tenant_id,object_api,language,revision) VALUES($1,$2,$3,1)
    ON CONFLICT(tenant_id,object_api,language) DO UPDATE SET
    revision=md_object_label_translation_revisions.revision+1,updated_at=now()
    RETURNING revision`,[actor.tenant_id,req.params.objectApi,lang]);
   await client.query(`DELETE FROM md_object_label_translations
    WHERE tenant_id=$1 AND object_api=$2 AND language=$3`,
    [actor.tenant_id,req.params.objectApi,lang]);
   for(const [field,text] of Object.entries(values))
    await client.query(`INSERT INTO md_object_label_translations
     (tenant_id,object_api,language,field_api,value_text) VALUES($1,$2,$3,$4,$5)`,
     [actor.tenant_id,req.params.objectApi,lang,field,text.trim()]);
   return changed.rows[0].revision;
  });
  res.json({saved:true,revision:next});
 }));
}
