import {uuid,template,type ActionContext} from './ActionNodeShared.js';
/** Securely invoke a registered, tenant-scoped external-service action. */
export async function executeCustomActionBridgeNode(context:ActionContext){
 const serviceApi=context.config.externalServiceApiName;
 const operationApi=context.config.externalOperationApiName;
 const credentialId=context.config.namedCredentialId;
 if(typeof serviceApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(serviceApi)
  ||typeof operationApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(operationApi)
  ||typeof credentialId!=='string'||!uuid.test(credentialId))
  throw new Error('External Service Action configuration is invalid');
 const {rows}=await context.client.query<{
  http_method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';path_template:string;
  parameter_name:string;parameter_location:'path'|'query'|'body';required:boolean
  ;server_origin:string;server_path:string;base_url:string|null
 }>(`SELECT o.http_method,o.path_template,p.parameter_name,p.parameter_location,p.required
    ,s.server_origin,s.server_path,c.base_url
    FROM md_external_service_operations o
    JOIN md_external_services s ON s.tenant_id=o.tenant_id AND s.api_name=o.service_api
    LEFT JOIN md_named_credentials c ON c.tenant_id=o.tenant_id AND c.id=$4
     AND c.protocol='HTTPS' AND c.enabled=true
    LEFT JOIN md_external_service_parameters p ON p.tenant_id=o.tenant_id
     AND p.service_api=o.service_api AND p.operation_api=o.operation_api
    WHERE o.tenant_id=$1 AND o.service_api=$2 AND o.operation_api=$3
    ORDER BY p.parameter_location,p.parameter_name`,
  [context.tenantId,serviceApi,operationApi,credentialId]);
 if(!rows.length)throw new Error('External Service operation is unavailable');
 const operation=rows[0];
 if(!operation.base_url)throw new Error('External Service HTTPS Named Credential is unavailable');
 let credentialUrl:URL;
 try{credentialUrl=new URL(operation.base_url);}catch{throw new Error('External Service Named Credential URL is invalid');}
 if(credentialUrl.protocol!=='https:'||credentialUrl.origin!==operation.server_origin
  ||credentialUrl.pathname!=='/'||credentialUrl.search||credentialUrl.hash
  ||credentialUrl.username||credentialUrl.password)
  throw new Error('External Service Named Credential origin does not match the imported API');
 const inputs=context.config.externalInputs;
 if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))
  throw new Error('External Service input mappings are invalid');
 const inputMap=inputs as Record<string,unknown>;
 const resolveInput=(name:string,required:boolean):unknown=>{
  const value=inputMap[name];
  if(value===undefined||value===null||value===''){
   if(required)throw new Error('External Service input is required: '+name);
   return undefined;
  }
  if(typeof value!=='string')throw new Error('External Service inputs must be text or Flow references');
  return context.resolve(value);
 };
 let path=[operation.server_path,operation.path_template].filter(Boolean).join('/');
 const query=new URLSearchParams();
 let body='';
 for(const parameter of rows){
  if(!parameter.parameter_name)continue;
  const value=resolveInput(parameter.parameter_name,parameter.required);
  if(parameter.parameter_location==='path'){
   if(value===undefined)throw new Error('External Service path input is required');
   path=path.replace('{'+parameter.parameter_name+'}',encodeURIComponent(String(value)));
  }else if(parameter.parameter_location==='query'&&value!==undefined){
   query.append(parameter.parameter_name,String(value));
  }else if(parameter.parameter_location==='body'&&value!==undefined){
   if(typeof value!=='string')throw new Error('External Service JSON body must be configured as JSON text');
   let parsed:unknown;
   try{parsed=JSON.parse(value);}catch{throw new Error('External Service request body must be valid JSON');}
   const resolveBody=(item:unknown):unknown=>{
    if(Array.isArray(item))return item.map(resolveBody);
    if(item&&typeof item==='object'){
     return Object.fromEntries(Object.entries(item).map(([key,nested])=>[key,resolveBody(nested)]));
    }
    if(typeof item==='string'&&(/^\{![A-Za-z_$][A-Za-z0-9_$.]*\}$/.test(item)
      ||/^@[A-Za-z_$][A-Za-z0-9_$.]*$/.test(item)))return context.resolve(item);
    return item;
   };
   const resolved=resolveBody(parsed);
   if(!resolved||typeof resolved!=='object'||Array.isArray(resolved))
    throw new Error('External Service request body must be a JSON object');
   body=JSON.stringify(resolved);
  }
 }
 if(path.includes('{')||path.includes('}')||path.startsWith('/')||path.includes('\\')
  ||path.split('/').some(segment=>segment==='..'||segment==='.')
  ||path.length>1800)throw new Error('External Service path parameters are incomplete or unsafe');
 if(query.size)path+='?'+query.toString();
 if(path.length>2048||Buffer.byteLength(body)>32768)
  throw new Error('External Service request exceeds the callout size limit');
 if(!context.httpCallout)throw new Error('External Service callout transport is unavailable');
 const variables=Object.fromEntries(Object.entries(context.variables).filter(
  (entry):entry is [string,string|number|boolean|null]=>
   entry[1]===null||typeof entry[1]==='string'||typeof entry[1]==='boolean'
    ||typeof entry[1]==='number'&&Number.isFinite(entry[1])));
 await context.httpCallout(context.tenantId,context.userId,{
  namedCredentialId:credentialId,method:operation.http_method,path,
  headers:body?'Content-Type: application/json':'',
  ...(body?{body}:{}),maxAttempts:5,idempotencyKey:context.runId+'-'+context.elementId
 },variables,context.runId+'-'+context.elementId,{
  client:context.client,runId:context.runId,nodeId:context.elementId
 });
}

/** SQL-backed actions join the Flow transaction and can be rolled back on fault. */
