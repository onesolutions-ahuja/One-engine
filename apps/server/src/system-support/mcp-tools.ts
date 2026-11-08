import {z} from 'zod';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import type {PageRuntime} from '../system-files/page-runtime.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {PlatformTenantService} from '../system-files/platform-tenant-service.js';
import {execFile} from 'node:child_process';
import {createConnection} from 'node:net';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export async function brokerOperation(request:{action:string;service:string;release?:string}):Promise<{output:string}>{
 const socketPath=process.env.METADRIVE_MCP_BROKER_SOCKET;
 if(!socketPath)throw Error('Operations broker is not configured');
 return await new Promise((resolve,reject)=>{
  let finished=false,buffer='';
  const sock=createConnection({path:socketPath});
  const fail=()=>{if(!finished){finished=true;sock.destroy();reject(Error('Operations broker unavailable'));}};
  sock.setTimeout(15000,fail);
  sock.on('error',fail);
  sock.on('connect',()=>sock.write(JSON.stringify(request)+'\n'));
  sock.on('data',(chunk:Buffer)=>{
   buffer+=chunk.toString('utf8');
   if(buffer.length>256*1024){fail();return;}
   const index=buffer.indexOf('\n');
   if(index<0)return;
   try{
    const answer=JSON.parse(buffer.slice(0,index));
    if(typeof answer.output!=='string')throw Error('Invalid broker response');
    if(!finished){finished=true;sock.end();resolve({output:answer.output});}
   }catch{fail();}
  });
  sock.on('close',fail);
 });
}
export type McpActor={tenant_id:string;user_id:string};
export type McpServices={records:RecordEngine;flows:FlowRuntime;pages:PageRuntime;rbac:RbacEngine;definitions:ObjectDefinitionService;db:SqlPersistence;platform:PlatformTenantService};
const identifier=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,199}$/);
const values=z.record(z.unknown());
const layout=z.enum(['Mobile','Desktop','Tablet','Custom']);
const schemas={
 list_records:z.object({object:identifier,limit:z.number().int().min(1).max(100).default(50),offset:z.number().int().min(0).max(1000000).default(0),search:z.string().max(256).optional()}).strict(),
 get_record:z.object({object:identifier,id:z.string().uuid()}).strict(),
 create_record:z.object({object:identifier,values}).strict(),
 update_record:z.object({object:identifier,id:z.string().uuid(),values}).strict(),
 delete_record:z.object({object:identifier,id:z.string().uuid()}).strict(),
 list_objects:z.object({}).strict(),
 describe_object:z.object({object:identifier}).strict(),
 run_flow:z.object({flow:identifier,inputs:values.default({})}).strict(),
 create_page:z.object({page:identifier,definition:values}).strict(),
 get_page_layout:z.object({page:identifier,variant:layout.default('Desktop'),view:z.enum(['draft','published']).default('draft')}).strict(),
 get_flow_definition:z.object({flow:identifier}).strict(),
 create_flow_draft:z.object({flow:identifier,definition:values}).strict(),
 save_page_draft:z.object({page:identifier,variant:layout.default('Desktop'),definition:values}).strict(),
 publish_page_draft:z.object({page:identifier,variant:layout.default('Desktop'),expectedRevision:z.number().int().min(1)}).strict(),
 server_operation:z.object({action:z.enum(['status','logs','restart','activate_release','mail_diagnostic']),service:z.enum(['api','worker']).default('api'),release:z.string().regex(/^[a-f0-9]{40}$/).optional()}).strict()
};
const descriptions:Record<keyof typeof schemas,string>={
 list_records:'Read database records through tenant, record and field permissions. Paginate with offset.',
 get_record:'Read one database record through the shared record engine.',
 create_record:'Create a database record with validation and normal triggers.',
 update_record:'Edit a database record with validation and normal triggers.',
 delete_record:'Delete a database record using normal permissions and recovery behavior.',
 describe_object:'Describe readable fields on a database object before querying or editing records.',
 list_objects:'List objects the signed-in user can read.',
 run_flow:'Execute a published MetaDrive flow with the signed-in user permissions.',
 create_page:'Create a new tenant Page Builder page as a draft through the shared SQL Page Runtime. Never overwrite an existing page.',
 get_page_layout:'Read a tenant Page Builder draft or published layout through the shared SQL runtime and Page permissions.',
 get_flow_definition:'Read a tenant Flow graph through the existing versioned SQL Flow Editor and central RBAC.',
 create_flow_draft:'Create a missing Flow as a draft through the existing SQL Flow Editor; reject existing names and never activate implicitly.',
 save_page_draft:'Save a versioned tenant Page Builder draft using its existing revision, validating component contracts and preserving the published page.',
 publish_page_draft:'Publish the named Page Builder draft only if its revision still matches. Requires Page manage permission.',
 server_operation:'Platform administrators: inspect service status or logs, restart API/worker, or activate an already built immutable API release. Requires the installed operations helper. Does not build or fetch code.'
};
// JSON schemas are derived from the same Zod validators used for execution.
import {zodToJsonSchema} from 'zod-to-json-schema';
export const mcpTools=Object.entries(schemas).map(([name,schema])=>({name,description:descriptions[name as keyof typeof schemas],inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:['list_records','get_record','list_objects','describe_object','get_page_layout','get_flow_definition'].includes(name),destructiveHint:!['list_records','get_record','list_objects','describe_object','get_page_layout','get_flow_definition','create_record','create_page','save_page_draft','create_flow_draft'].includes(name),openWorldHint:name==='run_flow'}}));
/** Scope choices are permission alternatives, not implicit RBAC grants.
 * All tools still run under the caller's tenant, user and OneEngine rules. */
export function mcpToolScopes(name:string):readonly string[]{
 if(['list_records','get_record'].includes(name))return ['records:read'];
 if(['create_record','update_record','delete_record'].includes(name))return ['records:write'];
 if(['list_objects','describe_object'].includes(name))return ['metadata:read','objects:read','fields:read'];
 if(name==='get_page_layout')return ['metadata:read','pages:read'];
 if(name==='get_flow_definition')return ['metadata:read','flows:read'];
 if(name==='create_page'||name==='save_page_draft'||name==='publish_page_draft')return ['metadata:write','pages:manage'];
 if(name==='create_flow_draft')return ['metadata:write','flows:manage'];
 if(name==='run_flow')return ['flows:execute'];
 if(name==='server_operation')return ['operations:manage','operations:read'];
 throw Error('Unknown MCP tool');
}
/** Retain the legacy mapping contract for callers relying on the original scope. */
export function mcpToolScope(name:string):string{return mcpToolScopes(name)[0];}
export function mcpToolAllowed(name:string,scopes:ReadonlySet<string>,input?:unknown):boolean{
 if(!mcpToolScopes(name).some(scope=>scopes.has(scope)))return false;
 if(name==='server_operation'&&!scopes.has('operations:manage')){
  const action=input&&typeof input==='object'&&!Array.isArray(input)
   ?(input as Record<string,unknown>).action:undefined;
  return ['status','logs','mail_diagnostic'].includes(String(action));
 }
 return true;
}

export async function callMcpTool(s:McpServices,a:McpActor,name:string,input:unknown){
 const t=a.tenant_id,u=a.user_id;
 if(name==='list_records'){const p=schemas.list_records.parse(input);return s.records.list(t,u,p.object,p.limit,p.offset,{search:p.search});}
 if(name==='get_record'){const p=schemas.get_record.parse(input);return s.records.get(t,u,p.object,p.id);}
 if(name==='create_record'){const p=schemas.create_record.parse(input);return {id:await s.records.create(t,u,p.object,p.values)};}
 if(name==='update_record'){const p=schemas.update_record.parse(input);await s.records.update(t,u,p.object,p.id,p.values);return {updated:true};}
 if(name==='delete_record'){const p=schemas.delete_record.parse(input);await s.records.remove(t,u,p.object,p.id);return {deleted:true};}
 if(name==='list_objects'){
  schemas.list_objects.parse(input);await s.rbac.require(t,u,'ObjectDefinition','read');
  const result=[];for(const object of await s.definitions.list(t))if(await s.rbac.allowed(t,u,object.apiName,'read'))result.push({apiName:object.apiName,label:object.label});return result;
 }
 if(name==='describe_object'){
  const p=schemas.describe_object.parse(input);
  await s.rbac.require(t,u,'ObjectDefinition','read');await s.rbac.require(t,u,p.object,'read');
  const object=await s.definitions.get(t,p.object);const fields=[];
  for(const f of object.fields)if(await s.rbac.allowed(t,u,p.object+'.'+f.apiName,'read'))fields.push({apiName:f.apiName,label:f.label,dataType:f.dataType,required:f.required});
  return {apiName:object.apiName,label:object.label,fields};
 }
 if(name==='run_flow'){const p=schemas.run_flow.parse(input);return s.flows.execute(t,p.flow,u,p.inputs);}
 if(name==='get_flow_definition'){
  const p=schemas.get_flow_definition.parse(input);
  await s.rbac.require(t,u,'FlowDefinition','read');
  return s.flows.loadEditor(t,p.flow);
 }
 if(name==='create_flow_draft'){
  const p=schemas.create_flow_draft.parse(input);
  await s.rbac.require(t,u,'FlowDefinition','manage');
  if(p.definition.apiName!==p.flow||p.definition.status!=='Draft')
   throw Error('New Flows must be named draft definitions');
  return s.flows.saveEditor(t,u,p.flow,p.definition,true);
 }
 if(name==='create_page'){
  const p=schemas.create_page.parse(input);
  await s.rbac.require(t,u,'PageDefinition','manage');
  // A new Page must always begin as a draft, with no existing name overwritten.
  if(p.definition.apiName!==p.page||p.definition.status!=='Draft')
   throw Error('New Pages must be named draft definitions');
  return s.pages.save(t,p.page,p.definition,true);
 }
 if(name==='get_page_layout'){
  const p=schemas.get_page_layout.parse(input);
  await s.rbac.require(t,u,'PageDefinition','read');
  return p.view==='draft'?s.pages.editor(t,p.page,p.variant):s.pages.metadata(t,p.page,p.variant);
 }
 if(name==='save_page_draft'){
  const p=schemas.save_page_draft.parse(input);
  await s.rbac.require(t,u,'PageDefinition','manage');
  // Never accept an unversioned blind overwrite of tenant-authored content.
  if(typeof p.definition.draftRevision!=='number'||!Number.isInteger(p.definition.draftRevision)||p.definition.draftRevision<0)
   throw Error('A current draftRevision is required');
  return s.pages.saveLayoutDraft(t,p.page,p.variant,p.definition,u);
 }
 if(name==='publish_page_draft'){
  const p=schemas.publish_page_draft.parse(input);
  await s.rbac.require(t,u,'PageDefinition','manage');
  return s.pages.publishLayout(t,p.page,p.variant,p.expectedRevision,u);
 }
 if(name==='server_operation'){
  const p=schemas.server_operation.parse(input);
  if((p.action==='activate_release')!==!!p.release)throw Error('Release SHA is required only for activate_release');
  if(p.action==='activate_release'&&p.service!=='api')throw Error('Release activation supports the API service only');
  await s.platform.requirePlatform(t,u);
  await s.rbac.require(t,u,'PlatformOperations',p.action==='status'||p.action==='logs'||p.action==='mail_diagnostic'?'read':'manage');
  if(process.env.METADRIVE_MCP_OPERATIONS!=='enabled')throw Error('Server operations are not installed/enabled');
  // Record the attempt before starting a privileged operation; fail closed if auditing fails.
  await s.db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[t,u,'McpServerOperationRequested',JSON.stringify(p)]);
  try{
   const result=process.env.METADRIVE_MCP_BROKER_SOCKET
    ? await brokerOperation(p)
    : {output:(await execute('/usr/bin/sudo',['-n','/usr/local/sbin/metadrive-mcp-operations',p.action,p.service,...(p.release?[p.release]:[])],{timeout:15000,maxBuffer:256*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8'}})).stdout};
   await s.db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[t,u,'McpServerOperationAccepted',JSON.stringify(p)]);
   return {output:result.output};
  }catch{
   await s.db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[t,u,'McpServerOperationFailed',JSON.stringify(p)]);
   throw Error('Server operation failed; inspect the system journal on the VM');
  }
 }
 throw Error('Unknown MCP tool');
}
