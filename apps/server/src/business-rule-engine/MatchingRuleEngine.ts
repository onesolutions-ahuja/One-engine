import {scopedMetadata} from '../system-support/record-read-scope.js';
import {saveDuplicateMatches} from './DuplicateDetectionEngine.js';
import type {PoolClient} from 'pg';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {loadNativeFields,nativeTableSql,nativeValueSql} from '../system-files/native-object-query.js';
type Values=Record<string,unknown>;
type Rule={api_name:string;match_mode:'All'|'Any';action:'Alert'|'Block';target_object_api?:string|null};
type RuleField={rule_api:string;field_api:string;target_field_api?:string|null;case_sensitive:boolean;match_type:'Exact'|'Normalized'|'Fuzzy';max_distance:number};
export class DuplicateMatchError extends Error {
 constructor(readonly ruleApi:string){super('Potential duplicate record matches rule: '+ruleApi);this.name='DuplicateMatchError';}
}
/** One SQL matching engine. Enforces matches against all tenant records, without exposing inaccessible IDs. */
export class RecordMatching {
 constructor(private readonly rbac:RbacEngine){}
 async check(client:PoolClient,tenantId:string,userId:string,objectApi:string,values:Values|(()=>Promise<Values>),
    excludeId?:string):Promise<Array<{ruleApi:string;recordId:string;matchedObjectApi?:string}>|null>{
  const result=await scopedMetadata('matching-rules\u0000'+tenantId+'\u0000'+objectApi,()=>client.query<Rule>(
   'SELECT api_name,match_mode,action,target_object_api FROM md_matching_rules WHERE tenant_id=$1 AND object_api=$2 AND active=true ORDER BY api_name',
   [tenantId,objectApi]));
  if(!result.rows.length)return null;
  const current=typeof values==='function'?await values():values;
  const columns=await client.query<RuleField>(`SELECT rule_api,field_api,target_field_api,case_sensitive,match_type,max_distance
    FROM md_matching_rule_fields WHERE tenant_id=$1 AND object_api=$2 ORDER BY rule_api,field_api`,
   [tenantId,objectApi]);
  const matches:Array<{ruleApi:string;recordId:string;matchedObjectApi?:string}>=[];
  for(const rule of result.rows){
   const fields=columns.rows.filter(x=>x.rule_api===rule.api_name);
   if(!fields.length)continue;
   const targetObject=rule.target_object_api??objectApi;
   const crossObject=targetObject!==objectApi;
   const native=await loadNativeFields(client,tenantId,targetObject);
   if(crossObject)await this.rbac.require(tenantId,userId,targetObject,'read');
   const clauses:string[]=[];
   const params:unknown[]=[tenantId,targetObject,crossObject?null:excludeId??null];
   for(const field of fields){
    const value=current[field.field_api];
    if(value===null||value===undefined||typeof value!=='string'||!value.trim()){
      if(rule.match_mode==='All'){clauses.length=0;break;}
      continue;
    }
    const normalized=(field.match_type==='Normalized'||field.match_type==='Fuzzy')
      ?value.trim().normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''):null;
    // Never run format-insensitive comparisons with less than three characters.
    if((normalized!==null&&normalized.length<(field.match_type==='Fuzzy'?4:3))
      ||(field.match_type==='Fuzzy'&&normalized!==null&&normalized.length>64)){
      if(rule.match_mode==='All'){clauses.length=0;break;}
      continue;
    }
    await this.rbac.require(tenantId,userId,objectApi+'.'+field.field_api,'read');
    const matchedField=crossObject?field.target_field_api:field.field_api;
    if(crossObject&&(!matchedField||!/^[A-Za-z][A-Za-z0-9_]*$/.test(matchedField)))
      throw new Error('Invalid cross-object matching field');
    if(crossObject)await this.rbac.require(tenantId,userId,targetObject+'.'+matchedField,'read');
    const column=nativeValueSql(native,matchedField,'nr',true);
    params.push(normalized??value.trim());
    const val=params.length;
    const comparison=field.match_type==='Fuzzy'
      ?`md_fuzzy_unicode_match(${column},$${val},${field.max_distance===2?2:1})`
      :normalized!==null
      ?`regexp_replace(lower(normalize(${column}, NFC)), '[^[:alnum:]]', '', 'g')=$${val}`
      :field.case_sensitive?`${column}=$${val}`:`lower(${column})=lower($${val})`;
    // Hash indexes populated by legacy writes may lag direct native writes.
    clauses.push(`(${column} IS NOT NULL AND ${comparison})`);
   }
   if(!clauses.length)continue;
   const filter=rule.match_mode==='All'?clauses.join(' AND '):'('+clauses.join(' OR ')+')';
   // Every candidate, including records of the source Object, must pass the
   // actor's tenant-scoped Record access policy. A Block rule cannot disclose
   // an inaccessible record by rejecting a save either.
   const recordAccess=' AND md_record_access($1,$'+String(params.length+1)+",r.id,'read')";
   params.push(userId);
   const records=await client.query<{id:string}>(`SELECT r.id FROM md_records r
     JOIN ${nativeTableSql(native)} nr ON nr.tenant_id=r.tenant_id AND nr.id=r.id
     WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false AND nr.is_deleted=false
     AND ($3::uuid IS NULL OR r.id<>$3::uuid)
     AND (${filter})${recordAccess} ORDER BY r.id LIMIT 20`,params);
   if(!records.rows.length)continue;
   if(rule.action==='Block')throw new DuplicateMatchError(rule.api_name);
   for(const record of records.rows)matches.push({ruleApi:rule.api_name,recordId:record.id,
    ...(crossObject?{matchedObjectApi:targetObject}:{})});
  }
  return matches;
 }
 async save(client:PoolClient,tenantId:string,objectApi:string,recordId:string,
   matches:Array<{ruleApi:string;recordId:string;matchedObjectApi?:string}>|null){
  return saveDuplicateMatches(client,tenantId,objectApi,recordId,matches);
 }

}
