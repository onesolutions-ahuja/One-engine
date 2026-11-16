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
 return text?expression:`${expression}::${field.native_type}`;
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
export function nativeValuesJoin(fields:readonly NativeQueryField[]):string|null{
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
  WHERE n.tenant_id=$1 AND n.id=r.id AND d.key=ANY(ARRAY[${native.map(f=>literal(f.api_name)).join(',')}]::text[])
 ) v ON true`;
}
