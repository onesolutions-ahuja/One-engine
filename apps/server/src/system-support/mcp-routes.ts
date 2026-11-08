import {createHash} from 'node:crypto';
import type {Express,Request,Response,NextFunction,RequestHandler} from 'express';
import {mcpOrigin} from './mcp-resource.js';
import {callMcpTool,mcpTools,mcpToolScopes,mcpToolAllowed,type McpServices,type McpActor} from './mcp-tools.js';
import {auditContext} from './audit-context.js';
const versions=['2025-06-18','2025-03-26','2024-11-05'];
type Req=Request&{actor?:McpActor};
export function registerMcpRoutes(app:Express,s:McpServices,authorize:RequestHandler){
 const origin=mcpOrigin();
 if(!origin)return; // Explicit installation: no listener or discovery until configured.
 const resource=origin+'/api/mcp';
 const supportedScopes=async()=>(
  await s.db.query<{scope:string}>(
   'SELECT scope FROM md_oauth_scope_catalogue WHERE assignable=true ORDER BY group_order,sort_order')
 ).rows.map(row=>row.scope);
 app.get(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/api/mcp'],
  (_req,res,next)=>{void supportedScopes().then(scopes=>res.json({resource,authorization_servers:[origin],
   scopes_supported:scopes,bearer_methods_supported:['header']})).catch(next);});
 app.get('/.well-known/oauth-authorization-server',
  (_req,res,next)=>{void supportedScopes().then(scopes=>res.json({issuer:origin,
   authorization_endpoint:origin+'/api/oauth/authorize',token_endpoint:origin+'/api/oauth/token',
   revocation_endpoint:origin+'/api/oauth/revoke',response_types_supported:['code'],
   grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
   token_endpoint_auth_methods_supported:['none','client_secret_post'],scopes_supported:scopes})).catch(next);});
 app.all('/api/mcp',(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`);
  const version=req.get('MCP-Protocol-Version');
  if(version&&!versions.includes(version)){res.status(400).json({error:'Unsupported MCP protocol version'});return;}
  next();
 },authorize,(req:Req,res:Response,next:NextFunction)=>{void (async()=>{
  const token=(req.get('authorization')??'').slice(7),a=req.actor!;
  // A browser session or another resource's OAuth token is never an MCP credential.
  const {rows}=await s.db.query<{scope:string}>(`SELECT s.scope FROM md_oauth_tokens b
   JOIN md_oauth_consents c ON c.tenant_id=b.tenant_id AND c.id=b.consent_id AND c.revoked_at IS NULL
   JOIN md_oauth_consent_scopes s ON s.tenant_id=c.tenant_id AND s.consent_id=c.id
   JOIN md_oauth_client_scopes allowed ON allowed.tenant_id=c.tenant_id AND allowed.client_id=c.client_id AND allowed.scope=s.scope
   WHERE b.token_hash=$1 AND b.kind='access' AND b.tenant_id=$2 AND c.user_id=$3 AND c.resource=$4`,[createHash('sha256').update(token).digest('hex'),a.tenant_id,a.user_id,resource]);
  const scopes=new Set(rows.map(r=>r.scope));
  if(!scopes.has('mcp:access')){res.status(401).json({error:'A resource-bound MCP OAuth grant is required'});return;}
  if(req.method!=='POST'){res.setHeader('Allow','POST');res.status(405).end();return;}
  if(!req.is('application/json')){res.status(415).end();return;}
  const b=req.body;
  const error=(code:number,message:string)=>res.json({jsonrpc:'2.0',id:b?.id??null,error:{code,message}});
  if(!b||Array.isArray(b)||b.jsonrpc!=='2.0'||typeof b.method!=='string'||(b.id!==undefined&&typeof b.id!=='string'&&typeof b.id!=='number')){error(-32600,'Invalid request');return;}
  if(b.id===undefined){
   if(['notifications/initialized','notifications/cancelled'].includes(b.method))res.status(202).end();else res.status(400).end();return;
  }
  const result=(value:unknown)=>res.json({jsonrpc:'2.0',id:b.id,result:value});
  if(b.method==='initialize'){
   if(typeof b.params?.protocolVersion!=='string'||!b.params?.clientInfo||!b.params?.capabilities){error(-32602,'Invalid initialize parameters');return;}
   result({protocolVersion:versions.includes(b.params.protocolVersion)?b.params.protocolVersion:versions[0],capabilities:{tools:{}},serverInfo:{name:'metadrive',version:'1.0.0'}});return;
  }
  if(b.method==='ping'){result({});return;}
  if(b.method==='tools/list'){result({tools:mcpTools.filter(t=>mcpToolScopes(t.name).some(scope=>scopes.has(scope)))});return;}
  if(b.method!=='tools/call'){error(-32601,'Method not found');return;}
  const name=b.params?.name;
  if(typeof name!=='string'||!mcpTools.some(t=>t.name===name)){error(-32602,'Unknown tool');return;}
  if(!mcpToolAllowed(name,scopes,b.params?.arguments)){result({isError:true,content:[{type:'text',text:'OAuth scope does not permit this tool or operation'}]});return;}
  const audit=async(action:string)=>s.db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[a.tenant_id,a.user_id,action,JSON.stringify({tool:name,correlationId:auditContext()?.correlationId})]);
  await audit('McpToolRequested');
  try{
   const data=await callMcpTool(s,a,name,b.params?.arguments??{});
   await audit('McpToolSucceeded');
   result({content:[{type:'text',text:JSON.stringify(data??null)}]});
  }catch(e){
   await audit('McpToolFailed');
   const message=e instanceof Error&&e.name==='ZodError'?'Invalid tool arguments':'Tool failed or access was denied. Check the audit trail before retrying a write.';
   result({isError:true,content:[{type:'text',text:message}]});
  }
 })().catch(next);});
}
