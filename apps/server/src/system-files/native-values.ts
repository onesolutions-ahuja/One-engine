import type {PoolClient} from 'pg';
import type {RecordStoredValue} from './record-value-write.js';
import {nativeTableSql,type NativeFieldsMetadata} from './native-object-query.js';
import {objectNativeFields} from './object-save-setup.js';

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
 const meta=await objectNativeFields(client,tenantId,objectApi);
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

/**
 * The same native write for many records in as few statements as possible: records that
 * set the same fields share ONE UPDATE (rows passed as arrays). The stored result is the
 * same as calling writeNativeValues for each record. Records with values that are not
 * plain scalars (geolocation, address) or with multi-select values use writeNativeValues.
 */
export async function writeNativeValuesMany(client:PoolClient,tenantId:string,objectApi:string,
 rows:ReadonlyArray<{id:string;values:ReadonlyMap<string,RecordStoredValue>}>):Promise<void>{
 const meta=await objectNativeFields(client,tenantId,objectApi);
 const groups=new Map<string,Array<{id:string;raw:unknown[]}>>();
 const single:typeof rows[number][]=[];
 for(const row of rows){
  const entries=[...row.values].filter(([name])=>!name.startsWith('__'));
  if(!entries.length)continue;
  let plain=true;
  const raw=entries.map(([fieldApi,stored])=>{
   const field=meta.fields.get(fieldApi);
   if(!field)throw Error('Native field metadata unavailable: '+fieldApi);
   if(stored.multi_values!==undefined)plain=false;
   const value=storedNativeValue(field,stored);
   if(value!==null&&!['string','number','boolean'].includes(typeof value)&&!(value instanceof Date))plain=false;
   return value;
  });
  if(!plain){single.push(row);continue;}
  const signature=entries.map(([name])=>name).join(',');
  const group=groups.get(signature)??[];
  group.push({id:row.id,raw});groups.set(signature,group);
 }
 for(const [signature,group] of groups){
  const names=signature.split(',');
  const params:unknown[]=[tenantId,group.map(row=>row.id)];
  const bind=(value:unknown)=>{params.push(value);return '$'+params.length;};
  const columns:string[]=['id'],assignments:string[]=[],patches:string[]=[],slots:string[]=[];
  names.forEach((fieldApi,index)=>{
   const field=meta.fields.get(fieldApi)!;
   const slot='p'+index;
   columns.push(slot);
   slots.push(bind(group.map(row=>{
    const value=row.raw[index];
    return empty(value)?null:value instanceof Date?value.toISOString():String(value);
   }))+'::text[]');
   const typed='v.'+slot+'::'+field.sqlType;
   if(field.column)assignments.push('"'+field.column+'"='+typed);
   else patches.push('CASE WHEN v.'+slot+' IS NULL THEN \'{}\'::jsonb ELSE jsonb_build_object('+
    bind(fieldApi)+'::text,to_jsonb('+typed+')) END');
  });
  const unnest='unnest($2::uuid[],'+slots.join(',')+')';
  const changed=bind(names);
  // Fields with a value, per record, in field order (same as writeNativeValues).
  const present='ARRAY(SELECT n.field FROM unnest('+changed+'::text[]) WITH ORDINALITY AS n(field,i)'+
   ' WHERE (ARRAY['+names.map((_,index)=>'v.p'+index+' IS NOT NULL').join(',')+'])[n.i] ORDER BY n.i)';
  assignments.push("extras=(COALESCE(extras,'{}'::jsonb)-"+changed+'::text[])||('+
   (patches.length?patches.join(' || '):"'{}'::jsonb")+')');
  assignments.push('present_fields=(ARRAY(SELECT previous.field FROM '+
   'unnest(COALESCE(present_fields,ARRAY[]::text[])) AS previous(field) '+
   'WHERE NOT(previous.field=ANY('+changed+'::text[]))) || '+present+')');
  const result=await client.query('UPDATE '+nativeTableSql(meta)+' t SET '+assignments.join(', ')+
   ' FROM '+unnest+' AS v('+columns.join(',')+') WHERE t.tenant_id=$1 AND t.id=v.id',params);
  if(result.rowCount!==group.length)throw Error('Native record not found');
 }
 for(const row of single)await writeNativeValues(client,tenantId,objectApi,row.id,row.values);
}
