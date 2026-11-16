import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {FlowRecordQuery} from '../system-files/flow-record-query.js';

/**
 * CALLOUT('Connector.Operation', 'Field', Value, ..., AS(result)).
 * The connector app already stores the Named Credential (base URL, keys) and each operation's
 * method, path, JSON body template and friendly reply names. The formula only fills blanks.
 * No URL, header, secret or JSON is ever written in a formula.
 */
type Callout=(tenantId:string,userId:string,config:Record<string,unknown>,
 variables:Record<string,string|number|boolean|null>,idempotencyKey:string)=>Promise<{status:number;body:string}>;
type Operation={method:string;path:string;headers?:string;body?:string;outputs?:Record<string,string>};
type Scalar=string|number|boolean|null;
const name=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const reference=/^([A-Za-z][A-Za-z0-9_]{0,79})\.([A-Za-z][A-Za-z0-9_]{0,79})$/;
const blank=/\{!([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Pull the scalar at a friendly output path such as data.items[0].id. */
export function readCalloutPath(payload:unknown,path:string):Scalar{
 let current:unknown=payload;
 for(const token of path.match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g)??[]){
  if(!current||typeof current!=='object'||!Object.hasOwn(current,token))return null;
  current=(current as Record<string,unknown>)[token];
 }
 if(current===null||current===undefined)return null;
 if(typeof current==='string')return current.slice(0,4096);
 if(typeof current==='number'||typeof current==='boolean')return current;
 return JSON.stringify(current).slice(0,4096);
}

/** Builder values plus helpers: <Name>Minor (pence) and <Name>Decimal ("12.50") for numbers,
 * CalloutKey (one idempotency key per call). Only scalar values are accepted. */
export function calloutVariables(values:unknown,key:string):Record<string,Scalar>{
 if(values===undefined||values===null)values={};
 if(typeof values!=='object'||Array.isArray(values))throw Error('CALLOUT values must be field and value pairs');
 const entries=Object.entries(values as Record<string,unknown>);
 if(entries.length>40)throw Error('CALLOUT accepts up to 40 fields');
 const variables:Record<string,Scalar>=Object.create(null);
 for(const [field,raw] of entries){
  if(!name.test(field)||field.startsWith('public_')||field==='CalloutKey')throw Error('Invalid CALLOUT field '+field);
  let value:Scalar;
  if(raw===undefined||raw===null)value=null;
  else if(typeof raw==='string')value=raw.slice(0,4096);
  else if(typeof raw==='boolean')value=raw;
  else if(typeof raw==='number'&&Number.isFinite(raw))value=raw;
  else throw Error('CALLOUT value for '+field+' must be text, a number or TRUE/FALSE');
  variables[field]=value;
  if(typeof value==='number'){
   if(!Object.hasOwn(values as object,field+'Minor'))variables[field+'Minor']=Math.round(value*100);
   if(!Object.hasOwn(values as object,field+'Decimal'))variables[field+'Decimal']=value.toFixed(2);
  }
 }
 variables.CalloutKey=key;
 return variables;
}

const needs=(operation:Operation)=>{
 const found=new Set<string>();
 for(const text of [operation.path,operation.body??'',operation.headers??''])
  for(const hit of text.matchAll(blank))found.add(hit[1]);
 return found;
};

export async function runActionCallout(
 deps:{db:SqlPersistence;rbac:RbacEngine;query:FlowRecordQuery;callout:Callout},
 tenantId:string,userId:string,operationRef:unknown,values:unknown,key:string
):Promise<Record<string,Scalar>>{
 if(typeof operationRef!=='string'||!reference.test(operationRef))
  throw Error("CALLOUT needs 'Connector.Operation', for example 'SumUp.StartPayment'");
 const [,connector,operationName]=reference.exec(operationRef)!;
 await deps.rbac.require(tenantId,userId,'HTTPCallout','execute');
 const {rows}=await deps.db.query<{api_name:string;properties:{operations?:Record<string,Operation>;credentialName?:string}}>(`
  SELECT api_name,properties FROM md_system_definitions
  WHERE tenant_id=$1 AND kind='connector-providers' AND enabled=true
    AND lower(api_name)=ANY($2::text[])
  ORDER BY length(api_name) LIMIT 1`,
  [tenantId,[connector.toLowerCase(),(connector+'Connector').toLowerCase()]]);
 const provider=rows[0];
 if(!provider)throw Error('Connector '+connector+' is not installed. Install it from AppExchange.');
 const operation=provider.properties?.operations?.[operationName];
 if(!operation||typeof operation.path!=='string')
  throw Error('Connector '+connector+' has no operation '+operationName);
 const credentialName=provider.properties.credentialName;
 const {rows:credentials}=await deps.db.query<{id:string}>(`
  SELECT id FROM md_named_credentials WHERE tenant_id=$1 AND name=$2 AND enabled=true`,
  [tenantId,credentialName]);
 if(!credentials[0])throw Error('The '+connector+' Named Credential is missing or switched off');
 const variables=calloutVariables(values,key);
 const required=needs(operation);
 // The card reader / terminal comes from Named Devices when the formula does not name one:
 // the default Active device for this connector, or the only Active one.
 if(required.has('DeviceId')&&(variables.DeviceId===undefined||variables.DeviceId===null||variables.DeviceId==='')){
  const devices=await deps.query.find(tenantId,userId,'NamedDevice',[
   {field:'Connector',operator:'Equals',value:provider.api_name},
   {field:'Active',operator:'Equals',value:true}],undefined,{limit:20}) as Record<string,unknown>[];
  const chosen=devices.find(device=>device.IsDefault===true)??(devices.length===1?devices[0]:undefined);
  if(!chosen||typeof chosen.DeviceId!=='string'||!chosen.DeviceId)
   throw Error('Set a default '+connector+' device in Setup → Named Devices');
  variables.DeviceId=chosen.DeviceId;
 }
 for(const blankName of required){
  if(blankName.startsWith('public_'))continue;
  if(!Object.hasOwn(variables,blankName))throw Error('CALLOUT '+operationRef+' needs the field '+blankName);
 }
 const result=await deps.callout(tenantId,userId,{
  namedCredentialId:credentials[0].id,method:operation.method,path:operation.path,
  headers:operation.headers??'',
  ...(operation.body?{body:operation.body}:{})
 },variables,key);
 let payload:unknown=null;
 try{payload=result.body?JSON.parse(result.body):null;}catch{payload=null;}
 const output:Record<string,Scalar>=Object.create(null);
 output.HttpStatus=result.status;
 for(const [label,path] of Object.entries(operation.outputs??{}))output[label]=readCalloutPath(payload,path);
 return output;
}

/** Formula editor list: every installed connector operation as 'Connector.Operation',
 * with the blanks the builder fills and the reply names it can read. No secrets or URLs. */
export async function listActionCallouts(db:SqlPersistence,rbac:RbacEngine,tenantId:string,userId:string){
 await rbac.require(tenantId,userId,'HTTPCallout','execute');
 const {rows}=await db.query<{api_name:string;label:string;properties:{operations?:Record<string,Operation&{label?:string}>}}>(`
  SELECT api_name,label,properties FROM md_system_definitions
  WHERE tenant_id=$1 AND kind='connector-providers' AND enabled=true ORDER BY api_name`,[tenantId]);
 const helper=/^(.*)(Minor|Decimal)$/;
 return rows.flatMap(row=>{
  const connector=row.api_name.replace(/Connector$/,'');
  return Object.entries(row.properties?.operations??{}).map(([operation,definition])=>{
   const fields=new Set<string>();
   for(const blankName of needs(definition)){
    if(blankName.startsWith('public_')||blankName==='CalloutKey')continue;
    const base=helper.exec(blankName)?.[1];
    fields.add(base||blankName);
   }
   return {apiName:connector+'.'+operation,label:row.label+': '+(definition.label??operation),
    fields:[...fields],outputs:Object.keys(definition.outputs??{})};
  });
 });
}
