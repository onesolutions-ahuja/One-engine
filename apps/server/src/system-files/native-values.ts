import type {PoolClient} from 'pg';
import type {RecordStoredValue} from './record-value-write.js';
import {loadNativeFields,nativeTableSql,type NativeFieldsMetadata} from './native-object-query.js';

type Field=NativeFieldsMetadata['fields'] extends Map<string,infer V>?V:never;
const empty=(value:unknown)=>value===null||value===undefined||value==='';

/** Match the typed values selected by md_native_write_value. Keep numeric strings
 * unrounded: PostgreSQL performs its own numeric conversion on bound parameters.
 */
function storedNativeValue(field:Field,value:RecordStoredValue):unknown{
 switch(field.sqlType){
  case 'numeric':{
   const v=value.value_number??value.value_text;
   return empty(v)?null:v;
  }
  case 'boolean':{
   const v=value.value_boolean??value.value_text;
   return empty(v)?null:v;
  }
  case 'date':{
   const v=value.value_date??value.value_text;
   return empty(v)?null:v;
  }
  case 'timestamptz':{
   const v=value.value_datetime??value.value_text;
   return empty(v)?null:v;
  }
  case 'uuid':{
   const v=value.reference_record_id??value.value_text;
   return empty(v)?null:v;
  }
  case 'double precision[]':{
   const coordinates=[value.geo_latitude??null,value.geo_longitude??null];
   return coordinates.every(empty)?null:coordinates;
  }
  case 'text[]':{
   const address=[value.address_street??null,value.address_city??null,value.address_state??null,
    value.address_postal_code??null,value.address_country??null];
   return address.every(empty)?null:address;
  }
  case 'text':{
   const v=value.reference_record_id??value.value_text;
   return empty(v)?null:v;
  }
  default:throw Error('Unsupported native storage field type');
 }
}

/** One atomic native-table UPDATE for all scalar fields. The caller retains the
 * existing record and field permission checks; identifiers come only from the
 * validated tenant/object metadata, and payloads are bound parameters.
 */
export async function writeNativeValues(client:PoolClient,tenantId:string,objectApi:string,
 recordId:string,values:ReadonlyMap<string,RecordStoredValue>):Promise<void>{
 const entries=[...values].filter(([name])=>!name.startsWith('__'));
 if(!entries.length)return;
 const meta=await loadNativeFields(client,tenantId,objectApi);
 const params:unknown[]=[tenantId,recordId];
 const bind=(v:unknown)=>{params.push(v);return '$'+params.length;};
 const assignments:string[]=[];
 const extraPatches:string[]=[];
 const present:string[]=[];
 for(const [fieldApi,stored] of entries){
  const field=meta.fields.get(fieldApi);
  if(!field)throw Error('Native field metadata unavailable: '+fieldApi);
  const raw=storedNativeValue(field,stored);
  const hasValue=!empty(raw);
  if(hasValue)present.push(fieldApi);
  const parameter=hasValue?bind(raw):null;
  if(field.column){
   // loadNativeFields validated the generated f_<hex> identifier and SQL type.
   assignments.push('"'+field.column+'"='+(parameter?parameter+'::'+field.sqlType:'NULL'));
  }else if(parameter){
   // to_jsonb of a PostgreSQL typed parameter preserves numeric precision and
   // produces real JSON arrays/numbers/booleans, not stringified equivalents.
   extraPatches.push('jsonb_build_object('+bind(fieldApi)+'::text,to_jsonb('+
    parameter+'::'+field.sqlType+'))');
  }
 }
 const changedParameter=bind(entries.map(([name])=>name));
 const presentParameter=bind(present);
 const patch=extraPatches.length?extraPatches.join(' || '):"'{}'::jsonb";
 assignments.push("extras=(COALESCE(extras,'{}'::jsonb)-"+changedParameter+
  '::text[])||('+patch+')');
 assignments.push('present_fields=(ARRAY(SELECT previous.field FROM '+
  'unnest(COALESCE(present_fields,ARRAY[]::text[])) AS previous(field) '+
  'WHERE NOT(previous.field=ANY('+changedParameter+'::text[]))) || '+
  presentParameter+'::text[])');
 const result=await client.query('UPDATE '+nativeTableSql(meta)+' SET '+
  assignments.join(', ')+' WHERE tenant_id=$1 AND id=$2 RETURNING id',params);
 if(!result.rowCount)throw Error('Native record not found');

 // Preserve the existing multi-select rows and ordering. An update with a new
 // selection replaces old selections; creation has nothing to delete.
 const multiple=entries.filter(([,value])=>value.multi_values!==undefined);
 if(multiple.length)await client.query(`DELETE FROM md_record_multi_values
  WHERE tenant_id=$1 AND record_id=$2 AND field_api=ANY($3::text[])`,
  [tenantId,recordId,multiple.map(([name])=>name)]);
 const selections=multiple.flatMap(([field_api,value])=>
  value.multi_values!.map((selection,sort_order)=>({field_api,value:selection,sort_order})));
 if(selections.length)await client.query(`INSERT INTO md_record_multi_values
  (tenant_id,record_id,object_api,field_api,value,sort_order)
  SELECT $1,$2,$3,v.field_api,v.value,v.sort_order
  FROM jsonb_to_recordset($4::jsonb) AS v(field_api text,value text,sort_order integer)`,
  [tenantId,recordId,objectApi,JSON.stringify(selections)]);
}
