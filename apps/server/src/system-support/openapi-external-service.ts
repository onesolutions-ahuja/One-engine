import type {Express,NextFunction,Request,Response} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';

type Actor={tenant_id:string;user_id:string};
type AuthenticatedRequest=Request&{actor?:Actor};
type Parameter={name:string;location:'path'|'query'|'body';required:boolean;valueType:'string'|'number'|'integer'|'boolean'};
type Operation={operationApi:string;label:string;method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';
 path:string;requestBodyRequired:boolean;parameters:Parameter[]};
const apiName=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const methods=new Set(['get','post','put','patch','delete']);
const parameterTypes=new Set(['string','number','integer','boolean']);
function hasReference(value:unknown):boolean{
 if(Array.isArray(value))return value.some(hasReference);
 if(value&&typeof value==='object')
  return Object.entries(value).some(([key,item])=>key==='$ref'||hasReference(item));
 return false;
}

function asObject(value:unknown):Record<string,unknown>|undefined{
 return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function validateSpec(raw:unknown){
 const spec=asObject(raw);
 const serialized=JSON.stringify(raw);
 if(!spec||typeof spec.openapi!=='string'||!/^3\.(?:0|1)\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(spec.openapi)
  ||typeof serialized!=='string'||Buffer.byteLength(serialized)>1_000_000)
  throw Error('Import a valid OpenAPI 3.0 or 3.1 JSON document up to 1 MB');
 if(hasReference(spec))throw Error('OpenAPI references are not supported; inline the required operation metadata');
 const rootServers=Array.isArray(spec.servers)?spec.servers:[];
 if(rootServers.length!==1)throw Error('OpenAPI import requires exactly one HTTPS server');
 const server=asObject(rootServers[0]);
 if(!server||typeof server.url!=='string')throw Error('OpenAPI server is invalid');
 let serverUrl:URL;
 try{serverUrl=new URL(server.url);}catch{throw Error('OpenAPI server URL is invalid');}
 if(serverUrl.protocol!=='https:'||serverUrl.username||serverUrl.password||serverUrl.search
  ||serverUrl.hash||serverUrl.hostname==='localhost'||serverUrl.hostname.endsWith('.local')
  ||serverUrl.hostname==='127.0.0.1'||serverUrl.hostname==='[::1]')
  throw Error('OpenAPI server must use a public HTTPS URL without credentials, query, or fragment');
 if(Object.hasOwn(spec,'webhooks')||Object.hasOwn(spec,'callbacks'))
  throw Error('OpenAPI webhooks and callbacks are not supported');
 const paths=asObject(spec.paths);
 if(!paths||Object.keys(paths).length>200)throw Error('OpenAPI spec must define at most 200 paths');
 const operations:Operation[]=[];
 const seen=new Set<string>();
 for(const [path,rawPath] of Object.entries(paths)){
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\')
   ||path.split('/').some(segment=>segment==='..'||segment==='.')
   ||path.length>512||path.includes('?')||path.includes('#'))
   throw Error('OpenAPI contains an unsafe path');
  const item=asObject(rawPath);
  if(!item)throw Error('OpenAPI path item is invalid');
  for(const [method,rawOperation] of Object.entries(item)){
   if(['parameters','summary','description','servers'].includes(method))continue;
   if(!methods.has(method))throw Error('OpenAPI operation method is unsupported: '+method);
   const op=asObject(rawOperation);
   if(!op||Object.hasOwn(op,'$ref'))throw Error('External and internal OpenAPI references are not supported');
   if(Array.isArray(op.servers))throw Error('Per-operation OpenAPI servers are not supported');
   const operationApi=op.operationId;
   if(typeof operationApi!=='string'||!apiName.test(operationApi)||seen.has(operationApi))
    throw Error('Every OpenAPI operation needs a unique API-safe operationId');
   seen.add(operationApi);
   const mergedParams=[...(Array.isArray(item.parameters)?item.parameters:[]),
    ...(Array.isArray(op.parameters)?op.parameters:[])];
   if(mergedParams.length>30)throw Error('OpenAPI operations support at most 30 parameters');
   const parameters:Parameter[]=[];
   const parameterKeys=new Set<string>();
   for(const rawParameter of mergedParams){
    const p=asObject(rawParameter);
    if(!p||Object.hasOwn(p,'$ref')||typeof p.name!=='string'
     ||!['path','query'].includes(String(p.in)))
     throw Error('Only inline path and query parameters are supported');
    const schema=asObject(p.schema);
    const valueType=String(schema?.type??'');
    if(!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(p.name)||!parameterTypes.has(valueType))
     throw Error('OpenAPI parameters must have a safe name and a primitive scalar schema');
    const location=p.in as 'path'|'query';
    if(parameterKeys.has(p.name))throw Error('OpenAPI parameter names must be unique within an operation');
    parameterKeys.add(p.name);
    parameters.push({name:p.name,location,required:location==='path'||p.required===true,
     valueType:valueType as Parameter['valueType']});
   }
   const pathParams=[...path.matchAll(/\{([^{}]+)\}/g)].map(match=>match[1]);
   if(path.includes('{')&&pathParams.length===0||path.replace(/\{[^{}]+\}/g,'').includes('}'))
    throw Error('OpenAPI path template is malformed');
   if(pathParams.some(name=>!parameters.some(p=>p.location==='path'&&p.name===name))
    ||parameters.some(p=>p.location==='path'&&!pathParams.includes(p.name)))
    throw Error('OpenAPI path template parameters must match declared path parameters');
   const rawBody=asObject(op.requestBody);
   let requestBodyRequired=false;
   let requestBodyType:string|undefined;
   if(rawBody){
    if(Object.hasOwn(rawBody,'$ref'))throw Error('OpenAPI request body references are not supported');
    const content=asObject(rawBody.content);
    const json=asObject(content?.['application/json']);
    if(!json)throw Error('Only application/json request bodies are supported');
    const schema=asObject(json.schema);
    if(schema&&Object.hasOwn(schema,'$ref'))throw Error('OpenAPI schema references are not supported');
    if(schema&&schema.type!=='object')throw Error('OpenAPI request bodies must be JSON objects');
    requestBodyRequired=rawBody.required===true;
    requestBodyType='application/json';
    parameters.push({name:'body',location:'body',required:requestBodyRequired,valueType:'string'});
   }
   const summary=typeof op.summary==='string'?op.summary:operationApi;
   if(summary.length>200)throw Error('OpenAPI operation summary is too long');
   operations.push({operationApi,label:summary,method:method.toUpperCase() as Operation['method'],
    path:path.slice(1),requestBodyRequired,parameters});
  }
 }
 if(!operations.length||operations.length>500)throw Error('OpenAPI spec must define 1 to 500 supported operations');
 return {serverOrigin:serverUrl.origin,serverPath:serverUrl.pathname.replace(/^\/+|\/+$/g,''),operations};
}

export class OpenApiExternalService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async import(tenant:string,user:string,input:unknown){
  await this.rbac.require(tenant,user,'FlowDefinition','manage');
  const data=asObject(input);
  if(!data||typeof data.apiName!=='string'||!apiName.test(data.apiName)
   ||typeof data.label!=='string'||!data.label.trim()||data.label.length>200)
   throw Error('External Service needs a valid API name and label');
  const apiNameValue=data.apiName;
  const label=data.label.trim();
  const spec=validateSpec(data.spec);
  await this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenant+':external-service:'+apiNameValue]);
   const duplicate=await client.query(`SELECT 1 FROM md_external_service_operations
    WHERE tenant_id=$1 AND operation_api=ANY($2::text[]) AND service_api<>$3`,
    [tenant,spec.operations.map(op=>op.operationApi),apiNameValue]);
   if(duplicate.rows.length)throw Error('Operation API names must be unique within a tenant');
   await client.query(`INSERT INTO md_external_services(tenant_id,api_name,label,server_origin,server_path,imported_by)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,api_name) DO UPDATE
    SET label=EXCLUDED.label,server_origin=EXCLUDED.server_origin,server_path=EXCLUDED.server_path,
     imported_by=EXCLUDED.imported_by,
     imported_at=now()`,[tenant,apiNameValue,label,spec.serverOrigin,spec.serverPath,user]);
   await client.query('DELETE FROM md_external_service_operations WHERE tenant_id=$1 AND service_api=$2',
    [tenant,apiNameValue]);
   for(const operation of spec.operations){
    await client.query(`INSERT INTO md_external_service_operations(tenant_id,service_api,operation_api,
      label,http_method,path_template,request_body_required,request_body_type)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenant,apiNameValue,operation.operationApi,operation.label,operation.method,operation.path,
     operation.requestBodyRequired,operation.requestBodyRequired||operation.parameters.some(p=>p.location==='body')
      ?'application/json':null]);
    for(const parameter of operation.parameters)
     await client.query(`INSERT INTO md_external_service_parameters(tenant_id,service_api,operation_api,
       parameter_name,parameter_location,required,value_type) VALUES($1,$2,$3,$4,$5,$6,$7)`,
     [tenant,apiNameValue,operation.operationApi,parameter.name,parameter.location,
      parameter.required,parameter.valueType]);
   }
  });
  return {apiName:apiNameValue,label,operationCount:spec.operations.length};
 }
 async list(tenant:string,user:string){
  await this.rbac.require(tenant,user,'FlowDefinition','read');
  const {rows}=await this.db.query<{api_name:string;label:string;operations:Operation[]|string}>(`
   SELECT s.api_name,s.label,COALESCE(json_agg(json_build_object(
    'operationApi',o.operation_api,'label',o.label,'method',o.http_method,'path',o.path_template,
    'requestBodyRequired',o.request_body_required,'parameters',COALESCE((
      SELECT json_agg(json_build_object('name',p.parameter_name,'location',p.parameter_location,
       'required',p.required,'valueType',p.value_type) ORDER BY p.parameter_location,p.parameter_name)
      FROM md_external_service_parameters p WHERE p.tenant_id=o.tenant_id
       AND p.service_api=o.service_api AND p.operation_api=o.operation_api),'[]'::json)
   ) ORDER BY o.operation_api) FILTER(WHERE o.operation_api IS NOT NULL),'[]'::json) AS operations
   FROM md_external_services s LEFT JOIN md_external_service_operations o
    ON o.tenant_id=s.tenant_id AND o.service_api=s.api_name
   WHERE s.tenant_id=$1 GROUP BY s.api_name,s.label ORDER BY s.label,s.api_name`,[tenant]);
  return rows.map(row=>({...row,operations:typeof row.operations==='string'
   ?JSON.parse(row.operations) as Operation[]:row.operations}));
 }
}

const handler=(fn:(req:AuthenticatedRequest,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{
  void fn(req as AuthenticatedRequest,res).catch(next);
 };
export function registerOpenApiExternalServiceRoutes(app:Express,service:OpenApiExternalService){
 app.post('/api/metadata/external-services/import',handler(async(req,res)=>{
  const actor=req.actor!;
  res.status(201).json({service:await service.import(actor.tenant_id,actor.user_id,req.body)});
 }));
 app.get('/api/metadata/external-services',handler(async(req,res)=>{
  const actor=req.actor!;
  res.setHeader('Cache-Control','private, no-store');
  res.json({services:await service.list(actor.tenant_id,actor.user_id)});
 }));
}
