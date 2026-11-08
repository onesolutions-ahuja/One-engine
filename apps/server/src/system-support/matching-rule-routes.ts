import {requireAvailableMetadataName} from './metadata-name-guard.js';
import {filterReadableDuplicateEvidence} from '../business-rule-engine/DuplicateEvidenceAccess.js';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
type Actor={tenant_id:string;user_id:string};
type Req=Request&{actor?:Actor};
const ident=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const route=(fn:(req:Req,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void fn(req as Req,res).catch(next);};
export function registerMatchingRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 const base='/api/metadata/objects/:objectApi/matching-rules';
 const auth=async(req:Req,action:'read'|'manage')=>{
  if(!req.actor)throw new Error('Permission denied');
  if(!ident.test(req.params.objectApi))throw new Error('Invalid object API name');
  await rbac.require(req.actor.tenant_id,req.actor.user_id,'ObjectDefinition',action);
  return req.actor;
 };
 app.get(base,route(async(req,res)=>{
  const actor=await auth(req,'read');
  const [rules,fields]=await Promise.all([
   db.query(`SELECT api_name AS "apiName",label,active,match_mode AS "matchMode",
    action,target_object_api AS "targetObjectApi" FROM md_matching_rules WHERE tenant_id=$1 AND object_api=$2 ORDER BY api_name`,
    [actor.tenant_id,req.params.objectApi]),
   db.query(`SELECT rule_api AS "ruleApi",field_api AS "fieldApi",case_sensitive AS "caseSensitive",match_type AS "matchType",max_distance AS "maxDistance",target_field_api AS "targetFieldApi"
    FROM md_matching_rule_fields WHERE tenant_id=$1 AND object_api=$2 ORDER BY field_api`,
    [actor.tenant_id,req.params.objectApi])]);
  res.json({rules:rules.rows.map((r:any)=>({...r,fields:fields.rows.filter((f:any)=>f.ruleApi===r.apiName)
   .map((f:any)=>({fieldApi:f.fieldApi,caseSensitive:f.caseSensitive,matchType:f.matchType,maxDistance:f.maxDistance,targetFieldApi:f.targetFieldApi}))}))});
 }));
 app.put(base+'/:ruleApi',route(async(req,res)=>{
  const actor=await auth(req,'manage'),data=req.body;
  if(!ident.test(req.params.ruleApi)||!data||typeof data!=='object'||Array.isArray(data)
   ||typeof data.label!=='string'||!data.label.trim()||data.label.length>160
   ||!['All','Any'].includes(data.matchMode)||!['Alert','Block'].includes(data.action)
   ||typeof data.active!=='boolean'||!Array.isArray(data.fields)
   ||data.fields.length<1||data.fields.length>10
   ||data.fields.some((f:unknown)=>!f||typeof f!=='object'||Array.isArray(f)
    ||!ident.test((f as any).fieldApi)||typeof (f as any).caseSensitive!=='boolean'
    ||!['Exact','Normalized','Fuzzy'].includes((f as any).matchType??'Exact')
    ||((f as any).maxDistance!==undefined&&![1,2].includes((f as any).maxDistance))
    ||(['Normalized','Fuzzy'].includes((f as any).matchType)&&(f as any).caseSensitive))
   ||new Set(data.fields.map((f:any)=>f.fieldApi)).size!==data.fields.length
   ||(data.targetObjectApi!==undefined&&data.targetObjectApi!==null&&!ident.test(data.targetObjectApi))
   ||data.fields.some((f:any)=>f.targetFieldApi!==undefined&&f.targetFieldApi!==null&&!ident.test(f.targetFieldApi)))
   throw new Error('Invalid matching rule');
  const targetObject=typeof data.targetObjectApi==='string'&&data.targetObjectApi!==req.params.objectApi
   ?data.targetObjectApi:null;
  if(targetObject)await rbac.require(actor.tenant_id,actor.user_id,targetObject,'read');
  await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [actor.tenant_id+':'+req.params.objectApi]);
   const keys=data.fields.map((f:any)=>f.fieldApi);
   const found=await client.query<{api_name:string}>(`SELECT api_name FROM md_field_definitions
    WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL
    AND data_type IN ('text','email','phone','url','picklist')
    AND api_name=ANY($3::text[])`,[actor.tenant_id,req.params.objectApi,keys]);
   if(found.rows.length!==keys.length)throw new Error('Invalid matching field selection');
   if(targetObject){
    const targetFields=data.fields.map((field:any)=>field.targetFieldApi??field.fieldApi);
    if(new Set(targetFields).size!==targetFields.length)
      throw new Error('Duplicate target fields are not supported');
    const target=await client.query<{api_name:string}>(`SELECT api_name FROM md_field_definitions
     WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL
      AND data_type IN ('text','email','phone','url','picklist')
      AND api_name=ANY($3::text[])`,[actor.tenant_id,targetObject,targetFields]);
    if(target.rows.length!==targetFields.length)
      throw new Error('Invalid cross-object target field');
    for(const field of targetFields)
      await rbac.require(actor.tenant_id,actor.user_id,targetObject+'.'+field,'read');
   }
   const existingRule=await client.query('SELECT 1 FROM md_matching_rules WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3',[actor.tenant_id,req.params.objectApi,req.params.ruleApi]);
   if(!existingRule.rowCount)await requireAvailableMetadataName(client,actor.tenant_id,'matchingRule',req.params.ruleApi,{objectApi:req.params.objectApi});
   await client.query(`INSERT INTO md_matching_rules
    (tenant_id,object_api,api_name,label,active,match_mode,action,target_object_api)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(tenant_id,object_api,api_name)
    DO UPDATE SET label=EXCLUDED.label,active=EXCLUDED.active,
    match_mode=EXCLUDED.match_mode,action=EXCLUDED.action,
    target_object_api=EXCLUDED.target_object_api,updated_at=now()`,
    [actor.tenant_id,req.params.objectApi,req.params.ruleApi,data.label.trim(),
    data.active,data.matchMode,data.action,targetObject]);
   await client.query('DELETE FROM md_matching_rule_fields WHERE tenant_id=$1 AND object_api=$2 AND rule_api=$3',
    [actor.tenant_id,req.params.objectApi,req.params.ruleApi]);
   for(const field of data.fields)await client.query(`INSERT INTO md_matching_rule_fields
    (tenant_id,object_api,rule_api,field_api,case_sensitive,match_type,max_distance,target_field_api) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.tenant_id,req.params.objectApi,req.params.ruleApi,field.fieldApi,field.caseSensitive,
     field.matchType??'Exact',field.matchType==='Fuzzy'?(field.maxDistance??1):1,
     targetObject?(field.targetFieldApi??field.fieldApi):null]);
  });res.json({saved:true});
 }));
 app.delete(base+'/:ruleApi',route(async(req,res)=>{
  const actor=await auth(req,'manage');
  if(!ident.test(req.params.ruleApi))throw new Error('Invalid matching rule');
  await db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [actor.tenant_id+':'+req.params.objectApi]);
   await client.query('DELETE FROM md_matching_rules WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3',
    [actor.tenant_id,req.params.objectApi,req.params.ruleApi]);
  });
  res.status(204).end();
 }));
 app.get('/api/records/:objectApi/:id/duplicates',route(async(req,res)=>{
  if(!req.actor)throw new Error('Permission denied');
  if(!ident.test(req.params.objectApi)||!/^[0-9a-f-]{36}$/i.test(req.params.id))
   throw new Error('Invalid record');
  await rbac.require(req.actor.tenant_id,req.actor.user_id,req.params.objectApi,'read');
  await rbac.requireRecord(req.actor.tenant_id,req.actor.user_id,req.params.objectApi,req.params.id,'read');
  const {rows}=await db.query<{ruleApi:string;recordId:string;matchedObjectApi:string}>(`SELECT d."ruleApi",d."recordId",d."matchedObjectApi" FROM (
    SELECT ds.rule_api AS "ruleApi",ds.matched_record_id AS "recordId",
     ds.object_api AS "matchedObjectApi",ds.created_at AS created_at
    FROM md_duplicate_record_sets ds JOIN md_records r
      ON r.tenant_id=ds.tenant_id AND r.object_api=ds.object_api
      AND r.id=ds.matched_record_id AND r.is_deleted=false
    JOIN md_matching_rules m ON m.tenant_id=ds.tenant_id AND m.object_api=ds.object_api
      AND m.api_name=ds.rule_api AND m.active=true
    WHERE ds.tenant_id=$1 AND ds.object_api=$2 AND ds.record_id=$3
      AND md_record_access($1,$4,ds.matched_record_id,'read')
    UNION ALL
    SELECT cs.rule_api AS "ruleApi",cs.matched_record_id AS "recordId",
      cs.matched_object_api AS "matchedObjectApi",cs.created_at
    FROM md_cross_object_duplicate_sets cs JOIN md_records r
      ON r.tenant_id=cs.tenant_id AND r.object_api=cs.matched_object_api
      AND r.id=cs.matched_record_id AND r.is_deleted=false
    JOIN md_matching_rules m ON m.tenant_id=cs.tenant_id AND m.object_api=cs.object_api
      AND m.api_name=cs.rule_api AND m.active=true
    WHERE cs.tenant_id=$1 AND cs.object_api=$2 AND cs.record_id=$3
      AND md_record_access($1,$4,cs.matched_record_id,'read')
  ) d ORDER BY d.created_at DESC LIMIT 100`,
   [req.actor.tenant_id,req.params.objectApi,req.params.id,req.actor.user_id]);
  if(!rows.length){res.json({duplicates:[]});return;}
  // Record-level SQL access alone does not imply target Object or Field access.
  // Recheck the live matching rule's source/target Field grants at read time.
  const ruleApis=[...new Set(rows.map(row=>row.ruleApi))];
  const {rows:ruleFields}=await db.query<{ruleApi:string;fieldApi:string;targetFieldApi:string|null}>(`
    SELECT rule_api AS "ruleApi",field_api AS "fieldApi",target_field_api AS "targetFieldApi"
    FROM md_matching_rule_fields WHERE tenant_id=$1 AND object_api=$2
      AND rule_api=ANY($3::text[])`,
    [req.actor.tenant_id,req.params.objectApi,ruleApis]);
  const duplicates=await filterReadableDuplicateEvidence(rows,ruleFields,req.params.objectApi,
    resource=>rbac.require(req.actor!.tenant_id,req.actor!.user_id,resource,'read'));
  res.json({duplicates});
 }));
}
