import {saveDuplicateMatches} from './DuplicateDetectionEngine.js';
import type {PoolClient} from 'pg';
import type {RbacEngine} from '../system-files/rbac-engine.js';
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
  const result=await client.query<Rule>(
   'SELECT api_name,match_mode,action,target_object_api FROM md_matching_rules WHERE tenant_id=$1 AND object_api=$2 AND active=true ORDER BY api_name',
   [tenantId,objectApi]);
  if(!result.rows.length)return null;
  const current=typeof values==='function'?await values():values;
  const columns=await client.query<RuleField>(`SELECT rule_api,field_api,target_field_api,case_sensitive,match_type,max_distance
    FROM md_matching_rule_fields WHERE tenant_id=$1 AND object_api=$2 ORDER BY rule_api,field_api`,
   [tenantId,objectApi]);
  // One metadata lookup for all target Objects. Index enrollment is optional;
  // unconfigured fields retain the original shared Record Engine comparison.
  const targetObjects=[...new Set(result.rows.map(rule=>rule.target_object_api??objectApi))];
  const enrolled=await client.query<{object_api:string;field_api:string}>(`
   SELECT object_api,field_api FROM md_field_exact_indexes
   WHERE tenant_id=$1 AND object_api=ANY($2::text[]) AND enabled`,
   [tenantId,targetObjects]);
  const indexedFields=new Set(enrolled.rows.map(row=>row.object_api+'.'+row.field_api));
  const matches:Array<{ruleApi:string;recordId:string;matchedObjectApi?:string}>=[];
  for(const rule of result.rows){
   const fields=columns.rows.filter(x=>x.rule_api===rule.api_name);
   if(!fields.length)continue;
   const targetObject=rule.target_object_api??objectApi;
   const crossObject=targetObject!==objectApi;
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
    params.push(matchedField,normalized??value.trim());
    const col=params.length-1, val=params.length;
    const comparison=field.match_type==='Fuzzy'
      ?`md_fuzzy_unicode_match(v.value_text,$${val},${field.max_distance===2?2:1})`
      :normalized!==null
      ?`regexp_replace(lower(normalize(v.value_text, NFC)), '[^[:alnum:]]', '', 'g')=$${val}`
      :field.case_sensitive?'v.value_text=$'+val:'lower(v.value_text)=lower($'+val+')';
    // The physical index stores only hashes (bounded even for long values).
    // Recheck the actual Record value to rule out a hash collision. Record RBAC
    // remains enforced by md_record_access on the final candidate query.
    const indexed=normalized===null&&indexedFields.has(targetObject+'.'+matchedField)
      ?` AND EXISTS(SELECT 1 FROM md_field_exact_index_entries ix
        WHERE ix.tenant_id=r.tenant_id AND ix.object_api=r.object_api
        AND ix.field_api=$${col} AND ix.record_id=r.id
        AND ix.${field.case_sensitive?'value_hash':'folded_hash'}=
        md5(${field.case_sensitive?'$'+val:'lower($'+val+')'}))`:'';
    clauses.push(`EXISTS(SELECT 1 FROM md_record_values v WHERE v.tenant_id=r.tenant_id
     AND v.object_api=r.object_api AND v.record_id=r.id AND v.field_api=$${col}
     AND ${comparison}${indexed})`);
   }
   if(!clauses.length)continue;
   const filter=rule.match_mode==='All'?clauses.join(' AND '):'('+clauses.join(' OR ')+')';
   // Every candidate, including records of the source Object, must pass the
   // actor's tenant-scoped Record access policy. A Block rule cannot disclose
   // an inaccessible record by rejecting a save either.
   const recordAccess=' AND md_record_access($1,$'+String(params.length+1)+",r.id,'read')";
   params.push(userId);
   const records=await client.query<{id:string}>(`SELECT r.id FROM md_records r WHERE
     r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
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
