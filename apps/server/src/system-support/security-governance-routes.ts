import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import {SetupAuditService,auditCsv} from './setup-audit-service.js';
import {LicenseService} from './license-service.js';
import type {ConnectedAppService} from './connected-app-service.js';
import type {SecurityMonitorService} from './security-monitor-service.js';
type Req=Request&{actor?:{tenant_id:string;user_id:string}};
const route=(f:(req:Req,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void f(req,res).catch(next);};
export function registerConnectedPublicRoutes(app:Express,connected:ConnectedAppService){
 app.get('/api/oauth/authorize',route(async(req,res)=>{
  const origin=await connected.loginOrigin(req.query.client_id);
  const query=new URLSearchParams();for(const [k,v] of Object.entries(req.query)){if(typeof v!=='string')throw Error('Invalid OAuth authorization request');query.set(k,v);}
  res.setHeader('Cache-Control','no-store');res.redirect(303,origin+'/oauth/authorize?'+query.toString());
 }));
 app.post('/api/oauth/token',route(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');
  try{res.json(req.body?.grant_type==='refresh_token'?await connected.refresh(req.body,{ip:req.ip}):await connected.exchange(req.body,{ip:req.ip}));}
  catch(error){if(error instanceof Error&&/^(Invalid|Forbidden|MFA|Login)/.test(error.message))res.status(400).json({error:'invalid_grant'});else throw error;}
 }));
 app.post('/api/oauth/revoke',route(async(req,res)=>{res.setHeader('Cache-Control','no-store');await connected.revoke(req.body);res.json({});}));
}
export function registerGovernanceRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine,_auth:AuthenticationService,connected:ConnectedAppService,monitor:SecurityMonitorService){
 const audit=new SetupAuditService(db,rbac),licenses=new LicenseService(db,rbac);
 app.get('/api/security/permissions',route(async(req,res)=>{const a=req.actor!;res.json({permissions:await audit.catalogue(a.tenant_id,a.user_id)});}));
 app.get('/api/security/audit',route(async(req,res)=>{const a=req.actor!;res.json(await audit.list(a.tenant_id,a.user_id,{before:req.query.before,table:req.query.table,actor:req.query.actor,from:req.query.from,to:req.query.to,limit:req.query.limit,global:req.query.global==='true'}));}));
 app.get('/api/security/audit/coverage',route(async(req,res)=>{const a=req.actor!;res.json({tables:await audit.coverage(a.tenant_id,a.user_id)});}));
 app.get('/api/security/audit/export',route(async(req,res)=>{
  const a=req.actor!,page=await audit.list(a.tenant_id,a.user_id,{before:req.query.before,table:req.query.table,actor:req.query.actor,from:req.query.from,to:req.query.to,global:req.query.global==='true',export:true,limit:5000});
  // JSON envelope keeps the next cursor available to the authenticated downloader.
  res.setHeader('Cache-Control','no-store');res.json({csv:auditCsv(page.events),nextCursor:page.nextCursor});
 }));
 app.get('/api/security/licenses',route(async(req,res)=>{const a=req.actor!;res.json(await licenses.describe(a.tenant_id,a.user_id));}));
 app.get('/api/security/licenses/tenants',route(async(req,res)=>{const a=req.actor!;res.json(await licenses.platformPools(a.tenant_id,a.user_id,req.query.tenant));}));
 app.put('/api/security/licenses/assignment',route(async(req,res)=>{const a=req.actor!;res.json(await licenses.assign(a.tenant_id,a.user_id,req.body));}));
 app.put('/api/security/licenses/requirement',route(async(req,res)=>{const a=req.actor!;res.json(await licenses.requirement(a.tenant_id,a.user_id,req.body));}));
 app.post('/api/security/licenses/issue',route(async(req,res)=>{const a=req.actor!;res.json(await licenses.issue(a.tenant_id,a.user_id,req.body));}));
 app.get('/api/security/monitoring',route(async(req,res)=>{const a=req.actor!;res.json(await monitor.describe(a.tenant_id,a.user_id,req.query.before,req.query.limit));}));
 app.put('/api/security/monitoring',route(async(req,res)=>{const a=req.actor!;res.json(await monitor.configure(a.tenant_id,a.user_id,req.body));}));
 app.put('/api/security/monitoring/rules',route(async(req,res)=>{const a=req.actor!;res.json(await monitor.saveRule(a.tenant_id,a.user_id,req.body));}));
 app.get('/api/security/monitoring/prune-preview',route(async(req,res)=>{const a=req.actor!;res.setHeader('Cache-Control','private, no-store');res.json(await monitor.prunePreview(a.tenant_id,a.user_id));}));
 app.post('/api/security/monitoring/prune',route(async(req,res)=>{const a=req.actor!;res.json(await monitor.prune(a.tenant_id,a.user_id,req.body?.confirmation,req.body?.expectedRetentionDays));}));
 app.get('/api/security/connected-apps',route(async(req,res)=>{const a=req.actor!;res.json(await connected.describe(a.tenant_id,a.user_id));}));
 app.put('/api/security/connected-apps',route(async(req,res)=>{const a=req.actor!;res.setHeader('Cache-Control','no-store');res.json(await connected.save(a.tenant_id,a.user_id,req.body));}));
 app.post('/api/security/connected-apps/rotate-secret',route(async(req,res)=>{const a=req.actor!;res.setHeader('Cache-Control','no-store');res.json(await connected.rotateSecret(a.tenant_id,a.user_id,req.body?.id));}));
 app.post('/api/oauth/consent/preview',route(async(req,res)=>{const a=req.actor!;res.json(await connected.consent(a.tenant_id,a.user_id,req.body));}));
 app.post('/api/oauth/consent',route(async(req,res)=>{const a=req.actor!;res.setHeader('Cache-Control','no-store');res.json(await connected.grant(a.tenant_id,a.user_id,(req.get('authorization')??'').slice(7),req.body?.request,req.body?.approved));}));
}
