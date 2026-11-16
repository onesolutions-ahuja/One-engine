import {compileRecordFilters,type QueryField,type RecordFilter} from './QueryBuilder.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {loadNativeFields,nativeTableSql,nativeValueSql} from '../system-files/native-object-query.js';

type Field=QueryField & {related_object?:string|null};
type Stats={eligible:true;total:number;numericCount:number;sum:number;min:number;max:number};
type NotEligible={eligible:false};

/** SQL aggregation uses exactly the Record API list predicate compiler and
 * reapplies md_record_access on each matched row and related lookup row.
 * Formula/text/encrypted output fields continue through the legacy protected
 * row pipeline, preserving their computed or masked semantics.
 */
export async function computeFilteredNumericAggregate(
 db:Pick<SqlPersistence,'query'>,rbac:Pick<RbacEngine,'require'|'allowed'>,
 fieldsFor:(object:string)=>Promise<readonly Field[]>,
 tenantId:string,userId:string,objectApi:string,fieldApi:string,
 filters:readonly RecordFilter[],filterLogic?:string
):Promise<Stats|NotEligible>{
 await rbac.require(tenantId,userId,objectApi,'read');
 const fields=await fieldsFor(objectApi);
 const byApi=new Map(fields.map(field=>[field.api_name,field]));
 const target=byApi.get(fieldApi);
 if(!target)throw Error('Invalid aggregate field');
 // Never reveal data to actors without the same field-level read right as list.
 if(!await rbac.allowed(tenantId,userId,objectApi+'.'+fieldApi,'read'))
  return {eligible:false};
 const sourceType=target.data_type==='rollup'?target.rollup_source_data_type:target.data_type;
 if(!['number','currency','percent'].includes(String(sourceType)))
  return {eligible:false};
 const native=await loadNativeFields(db,tenantId,objectApi);
 const table=nativeTableSql(native);
 const allowedFields=new Map<string,QueryField>(fields.map(field=>[
  field.api_name,{...field,...(native.fields.has(field.api_name)
    ?{nativeValue:nativeValueSql(native,field.api_name,'nr'),
      nativeText:nativeValueSql(native,field.api_name,'nr',true)}:{})}
 ]));
 for(const filter of filters){
  const path=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(filter.field);
  if(!path){
   if(!byApi.has(filter.field))throw Error('Invalid list field');
   if(!await rbac.allowed(tenantId,userId,objectApi+'.'+filter.field,'read'))
    throw Error('Field is not readable');
   continue;
  }
  const lookup=byApi.get(path[1]);
  if(!lookup||lookup.data_type!=='reference'||!lookup.related_object)
   throw Error('Invalid list field');
  if(!await rbac.allowed(tenantId,userId,objectApi+'.'+lookup.api_name,'read'))
   throw Error('Field is not readable');
  await rbac.require(tenantId,userId,lookup.related_object,'read');
  if(!await rbac.allowed(tenantId,userId,lookup.related_object+'.'+path[2],'read'))
   throw Error('Field is not readable');
  const related=(await fieldsFor(lookup.related_object)).find(field=>field.api_name===path[2]);
  if(!related)throw Error('Invalid list field');
  const relatedNative=await loadNativeFields(db,tenantId,lookup.related_object);
  const relatedField=relatedNative.fields.get(related.api_name);
  if(!relatedField)throw Error('Invalid list field');
  allowedFields.set(filter.field,{...related,
   native_table:relatedNative.table,native_column:relatedField.column,
   native_type:relatedField.sqlType,
   via:{lookupField:lookup.api_name,access:"md_record_access($1,$3,rel.id,'read')"}});
 }
 const compiled=compileRecordFilters(filters,filterLogic,allowedFields,4);
 const predicate=compiled.predicate?' AND ('+compiled.predicate+')':'';
 const numeric=nativeValueSql(native,fieldApi,'n');
 // Filter and aggregate the same authorized rows, without an EAV value join.
 const sql=`WITH authorized AS MATERIALIZED (
   SELECT r.id FROM md_records r JOIN ${table} nr
     ON nr.tenant_id=r.tenant_id AND nr.id=r.id
   WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
     AND nr.is_deleted=false AND md_record_access($1,$3,r.id,'read')${predicate}
 ), numeric_rows AS (
   SELECT a.id,${numeric} AS number_value FROM authorized a
   JOIN ${table} n ON n.tenant_id=$1 AND n.id=a.id
 )
 SELECT count(*)::text AS total,count(number_value)::text AS numeric_count,
   sum(number_value)::text AS numeric_sum,min(number_value)::text AS numeric_min,
   max(number_value)::text AS numeric_max
 FROM numeric_rows`;
 const {rows}=await db.query<{
  total:string;numeric_count:string;numeric_sum:string|null;
  numeric_min:string|null;numeric_max:string|null
 }>(sql,[tenantId,objectApi,userId,...compiled.parameters]);
 const row=rows[0];
 const stats:Stats={eligible:true,total:Number(row?.total??0),
  numericCount:Number(row?.numeric_count??0),
  sum:Number(row?.numeric_sum??0),min:Number(row?.numeric_min??0),max:Number(row?.numeric_max??0)};
 // An enormous numeric value beyond JS finite range would not participate in
 // the legacy Formula numerical result, so fall back instead of changing it.
 if(Object.values(stats).some(value=>typeof value==='number'&&!Number.isFinite(value)))
  return {eligible:false};
 return stats;
}
