/** SQL fragments only; callers retain object, field and md_record_access checks. */
export type NativeQueryField={api_name:string;data_type:string;native_table?:string|null;
 native_column?:string|null;native_type?:string|null};
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const types=new Set(['text','numeric','boolean','uuid','date','timestamptz','text[]','double precision[]']);
export function nativeFieldExpression(field:NativeQueryField,alias='nr',text=false):string|null{
 if(!field.native_table||!field.native_type||!types.has(field.native_type))return null;
 if(!/^[a-z]+$/.test(alias))throw Error('Invalid native query alias');
 if(field.native_column){
  if(!/^f_[a-f0-9]{32}$/.test(field.native_column))throw Error('Invalid native column');
  return alias+'.'+quote(field.native_column)+(text?'::text':'');
 }
 const expression=`(${alias}.extras->>${literal(field.api_name)})`;
 if(!text&&(field.native_type==='text[]'||field.native_type==='double precision[]')){
  const json=`(${alias}.extras->${literal(field.api_name)})`;
  return `CASE WHEN ${json} IS NULL OR jsonb_typeof(${json})='null' THEN NULL
   ELSE ARRAY(SELECT jsonb_array_elements_text(${json}))::${field.native_type} END`;
 }
 if(text)return expression;
 // A value kept in extras is text: a blank or badly written value reads as NULL instead of
 // failing the whole query (e.g. a date/time filter on a field one record stored as "").
 if(field.native_type==='date'||field.native_type==='timestamptz')
  return `(CASE WHEN ${expression} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN ${expression}::${field.native_type} END)`;
 if(field.native_type==='numeric')
  return `(CASE WHEN ${expression} ~ '^\\s*-?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?\\s*$' THEN ${expression}::numeric END)`;
 return `NULLIF(${expression},'')::${field.native_type}`;
}
export function nativeRecordJoin(fields:readonly NativeQueryField[],alias='nr'){
 const table=fields.find(f=>f.native_table)?.native_table;
 if(!table)return '';
 if(!/^md_object_[a-f0-9]{32}$/.test(table)||!/^[a-z]+$/.test(alias))throw Error('Invalid native table');
 return `JOIN ${quote(table)} ${alias} ON ${alias}.tenant_id=r.tenant_id AND ${alias}.id=r.id`;
}

/** Unpivot only the selected page (at most 100 rows), after indexed filtering.
 * This retains the existing field conversion/masking pipeline with no EAV reads.
 */
export function nativeValuesJoin(fields:readonly NativeQueryField[],recordAlias='r'):string|null{
 if(!/^[a-z]+$/.test(recordAlias))throw Error('Invalid native record alias');
 const table=fields.find(f=>f.native_table)?.native_table;
 if(!table)return null;
 if(!/^md_object_[a-f0-9]{32}$/.test(table))throw Error('Invalid native table');
 const native=fields.filter(f=>f.native_type);
 const typed=native.filter(f=>f.native_column).map(f=>
  `CASE WHEN ${literal(f.api_name)}=ANY(n.present_fields) THEN jsonb_build_object(${literal(f.api_name)},n.${quote(f.native_column!)}) ELSE '{}'::jsonb END`);
 const names=(type:string)=>`ARRAY[${native.filter(f=>f.native_type===type).map(f=>literal(f.api_name)).join(',')}]::text[]`;
 const cast=(type:string)=>`CASE WHEN d.key=ANY(${names(type)}) THEN (d.value#>>'{}')::${type} END`;
 const arrayItem=(type:string,index:number)=>`CASE WHEN d.key=ANY(${names(type)}) THEN d.value->>${index} END`;
 return `LEFT JOIN LATERAL (SELECT d.key AS field_api,d.value#>>'{}' AS value_text,
  ${cast('uuid')} AS reference_record_id,${cast('numeric')} AS value_number,
  ${cast('date')} AS value_date,${cast('timestamptz')} AS value_datetime,${cast('boolean')} AS value_boolean,
  (${arrayItem('double precision[]',0)})::double precision AS geo_latitude,
  (${arrayItem('double precision[]',1)})::double precision AS geo_longitude,
  ${arrayItem('text[]',0)} AS address_street,${arrayItem('text[]',1)} AS address_city,
  ${arrayItem('text[]',2)} AS address_state,${arrayItem('text[]',3)} AS address_postal_code,
  ${arrayItem('text[]',4)} AS address_country
  FROM ${quote(table)} n CROSS JOIN LATERAL jsonb_each(n.extras${typed.map(x=>' || '+x).join('')}) d
  WHERE n.tenant_id=$1 AND n.id=${recordAlias}.id AND d.key=ANY(ARRAY[${native.map(f=>literal(f.api_name)).join(',')}]::text[])
 ) v ON true`;
}

/** Validated native storage metadata. Table and typed-column identifiers come only from
 * md_native_objects/md_native_fields, never from a record payload.
 */
export type NativeFieldsMetadata={
 table:string;
 fields:Map<string,{column:string|null;sqlType:string;dataType:string}>;
};
type NativeFieldMetadataRow={
 table_name:string;field_api:string|null;column_name:string|null;
 sql_type:string|null;data_type:string|null;
};

/** Load native Object and all its fields in one round trip (including an Object with zero fields). */
export async function loadNativeFields(executor:{query:(
 sql:string,params:unknown[])=>Promise<{rows:unknown[]}>},
 tenantId:string,objectApi:string):Promise<NativeFieldsMetadata>{
 const result=await executor.query(
  `SELECT o.table_name,f.field_api,f.column_name,f.sql_type,f.data_type
   FROM md_native_objects o LEFT JOIN md_native_fields f
    ON f.tenant_id=o.tenant_id AND f.object_api=o.object_api
   WHERE o.tenant_id=$1 AND o.object_api=$2 ORDER BY f.field_api`,[tenantId,objectApi]);
 const rows=result.rows as NativeFieldMetadataRow[];
 if(!rows.length)throw Error('Object has no native table');
 const table=rows[0].table_name;
 nativeTableSql({table,fields:new Map()});
 const fields:NativeFieldsMetadata['fields']=new Map();
 for(const row of rows){
  if(row.table_name!==table)throw Error('Inconsistent native table metadata');
  if(row.field_api===null)continue;
  if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(row.field_api)
   ||!row.sql_type||!types.has(row.sql_type)||typeof row.data_type!=='string'
   ||(row.column_name!==null&&!/^f_[a-f0-9]{32}$/.test(row.column_name)))
   throw Error('Invalid native field metadata');
  if(fields.has(row.field_api))throw Error('Duplicate native field metadata');
  fields.set(row.field_api,{column:row.column_name,sqlType:row.sql_type,dataType:row.data_type});
 }
 return {table,fields};
}

function validateNativeField(fieldApi:string,field:NativeFieldsMetadata['fields'] extends Map<string,infer V>?V:never){
 if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(fieldApi)||!types.has(field.sqlType)
  ||(field.column!==null&&!/^f_[a-f0-9]{32}$/.test(field.column)))
  throw Error('Invalid native field metadata');
}

/** Native table names are exclusively generated and retrieved by storage metadata. */
export function nativeTableSql(meta:NativeFieldsMetadata):string{
 if(!/^md_object_[a-f0-9]{32}$/.test(meta.table))throw Error('Invalid native table');
 return quote(meta.table);
}

/** Resolve only a known field; the SQL fragment retains nativeFieldExpression validation. */
export function nativeValueSql(meta:NativeFieldsMetadata,fieldApi:string,alias='nr',asText=false):string{
 nativeTableSql(meta);
 const field=meta.fields.get(fieldApi);
 if(!field)throw Error('Native field metadata unavailable: '+fieldApi);
 validateNativeField(fieldApi,field);
 const sql=nativeFieldExpression({api_name:fieldApi,data_type:field.dataType,
  native_table:meta.table,native_column:field.column,native_type:field.sqlType},alias,asText);
 if(sql===null)throw Error('Invalid native field metadata');
 return sql;
}

/** EAV-shaped lateral rows for a caller's md_records alias (normally r). */
export function readNativeValueRows(meta:NativeFieldsMetadata,alias='r'):string{
 nativeTableSql(meta);
 for(const [fieldApi,field] of meta.fields)validateNativeField(fieldApi,field);
 const fields:NativeQueryField[]=[...meta.fields].map(([api_name,field])=>({
  api_name,data_type:field.dataType,native_table:meta.table,
  native_column:field.column,native_type:field.sqlType
 }));
 const sql=nativeValuesJoin(fields,alias);
 if(sql===null)throw Error('Object has no native table');
 return sql;
}
