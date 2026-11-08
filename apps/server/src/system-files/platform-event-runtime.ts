import type {PoolClient} from 'pg';
import type {RbacEngine} from './rbac-engine.js';

type EventField={apiName:string;dataType:string;required?:boolean;
 picklistRestricted?:boolean;picklistValues?:string[]};
type StoredValue={apiName:string;kind:'string'|'number'|'boolean'|'null';text:string|null};
const api=/^[A-Za-z][A-Za-z0-9_]*$/;

function normalizeValue(field:EventField,value:unknown):StoredValue {
 const type=field.dataType.toLowerCase();
 if(value===null)return {apiName:field.apiName,kind:'null',text:null};
 if(type.startsWith('text')||type==='long text area'){
  if(typeof value!=='string'||value.length>(type==='long text area'?32768:255))
   throw new Error('Invalid Platform Event text field: '+field.apiName);
  return {apiName:field.apiName,kind:'string',text:value};
 }
 if(['number','currency','percent'].includes(type)){
  const number=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
  if(!Number.isFinite(number))throw new Error('Invalid Platform Event numeric field: '+field.apiName);
  return {apiName:field.apiName,kind:'number',text:String(number)};
 }
 if(type==='checkbox'){
  const boolean=value===true||value==='true'?true:value===false||value==='false'?false:null;
  if(boolean===null)throw new Error('Invalid Platform Event checkbox field: '+field.apiName);
  return {apiName:field.apiName,kind:'boolean',text:String(boolean)};
 }
 if(type==='date'){
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(value)
    ||!Number.isFinite(Date.parse(value+'T00:00:00Z'))
    ||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
   throw new Error('Invalid Platform Event date field: '+field.apiName);
  return {apiName:field.apiName,kind:'string',text:value};
 }
 if(type==='datetime'){
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
    ||!Number.isFinite(Date.parse(value))
    ||!Number.isFinite(Date.parse(value.slice(0,10)+'T00:00:00Z'))
    ||new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))
   throw new Error('Invalid Platform Event datetime field: '+field.apiName);
  return {apiName:field.apiName,kind:'string',text:new Date(value).toISOString()};
 }
 if(type==='picklist'){
  const allowed=Array.isArray(field.picklistValues)?field.picklistValues:[];
  if(typeof value!=='string'||field.picklistRestricted===true&&!allowed.includes(value))
   throw new Error('Invalid Platform Event picklist field: '+field.apiName);
  return {apiName:field.apiName,kind:'string',text:value};
 }
 throw new Error('Unsupported Platform Event field type: '+field.dataType);
}

async function loadFields(client:PoolClient,tenantId:string,eventApiName:string):Promise<EventField[]> {
 const {rows}=await client.query<{field_api:string;data_type:string;required:boolean;
  picklist_restricted:boolean}>(`
  SELECT field_api,data_type,required,picklist_restricted
  FROM md_platform_event_fields
  WHERE tenant_id=$1 AND event_api_name=$2
  ORDER BY sort_order,field_api`,[tenantId,eventApiName]);
 if(rows.length<1||rows.length>100)throw new Error('Invalid Platform Event definition fields');
 const {rows:values}=await client.query<{field_api:string;value_text:string}>(
  `SELECT field_api,value_text FROM md_platform_event_picklist_values
   WHERE tenant_id=$1 AND event_api_name=$2 ORDER BY field_api,sort_order`,
  [tenantId,eventApiName]);
 const valuesByField=new Map<string,string[]>();
 for(const row of values)
  valuesByField.set(row.field_api,[...(valuesByField.get(row.field_api)??[]),row.value_text]);
 return rows.map(row=>{
  if(!api.test(row.field_api))throw new Error('Invalid Platform Event field');
  return {apiName:row.field_api,dataType:row.data_type,required:row.required,
   picklistRestricted:row.picklist_restricted,
   picklistValues:valuesByField.get(row.field_api)??[]};
 });
}

export async function persistPlatformEvent(client:PoolClient,rbac:RbacEngine,tenantId:string,
 userId:string,eventApiName:string,payload:unknown,idempotencyKey?:string) {
 if(!api.test(eventApiName)||!payload||typeof payload!=='object'||Array.isArray(payload))
  throw new Error('Invalid Platform Event request');
 await rbac.require(tenantId,userId,'PlatformEvent:'+eventApiName,'publish');
 const {rows}=await client.query<{api_name:string}>(`
  SELECT api_name FROM md_system_definitions
  WHERE tenant_id=$1 AND kind='platform-events' AND api_name=$2 AND enabled=true`,
  [tenantId,eventApiName]);
 if(!rows[0])throw new Error('Platform Event is not enabled');
 const fields=await loadFields(client,tenantId,eventApiName);
 const byApi=new Map(fields.map(field=>[field.apiName,field]));
 const entries=Object.entries(payload as Record<string,unknown>);
 if(entries.length>fields.length||entries.some(([name])=>!byApi.has(name)))
  throw new Error('Platform Event contains an unknown field');
 const values=entries.map(([name,value])=>{
  const field=byApi.get(name);
  if(!field)throw new Error('Platform Event contains an unknown field');
  return normalizeValue(field,value);
 });
 for(const field of fields)
  if(field.required&&!values.some(value=>value.apiName===field.apiName&&value.kind!=='null'))
   throw new Error('Required Platform Event field is missing: '+field.apiName);
 const inserted=await client.query<{id:string}>(`
  INSERT INTO md_platform_event_messages(tenant_id,event_api_name,published_by,idempotency_key)
  VALUES($1,$2,$3,$4)
  ON CONFLICT(tenant_id,event_api_name,idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING RETURNING id`,[tenantId,eventApiName,userId,idempotencyKey??null]);
 let eventId=inserted.rows[0]?.id;
 if(!eventId&&idempotencyKey){
  const existing=await client.query<{id:string}>(`
   SELECT id FROM md_platform_event_messages
   WHERE tenant_id=$1 AND event_api_name=$2 AND idempotency_key=$3`,
   [tenantId,eventApiName,idempotencyKey]);
  eventId=existing.rows[0]?.id;
 }
 if(!eventId)throw new Error('Unable to persist Platform Event');
 if(inserted.rows[0]){
  for(const value of values)await client.query(`
   INSERT INTO md_platform_event_values(tenant_id,event_id,field_api,value_kind,value_text)
   VALUES($1,$2,$3,$4,$5)`,[tenantId,eventId,value.apiName,value.kind,value.text]);
 }
 await client.query(`
  INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
  VALUES($1,$2,'platform-event.publish',jsonb_build_object('eventApiName',$3))`,
  [tenantId,userId,eventApiName]);
 return eventId;
}
