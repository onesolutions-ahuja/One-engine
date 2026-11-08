import {randomBytes} from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import type {AuthenticationService} from '../system-files/authentication.js';
import type {MfaService} from './mfa-service.js';
import type {MfaBackupService} from './mfa-backup-service.js';
import type {WebAuthnService} from './webauthn-service.js';
import type {FederationService} from './federation-service.js';
import type {SessionPolicyService} from './session-policy-service.js';
type Actor={tenant_id:string;user_id:string};
type Req=Request&{actor?:Actor};
const route=(fn:(req:Req,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
const cookie=(req:Request,name:string)=>(req.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
export function registerFederationCallback(app:Express,federation:FederationService){
 const callback=route(async(req,res)=>{
  const state=req.method==='POST'?req.body?.RelayState:req.query.state;
  const result=await federation.callback(state,cookie(req,'md_sso_browser'),
   req.query.code,req.body?.SAMLResponse,req.method==='POST'?'POST':'GET');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Set-Cookie',[`md_fed_result=${result.ticket}; HttpOnly; Secure; SameSite=None; Path=/api/auth; Max-Age=60`,
   'md_sso_browser=; HttpOnly; Secure; SameSite=None; Path=/api/auth/federation; Max-Age=0']);
  res.redirect(303,result.origin+'/');
 });
 app.get('/api/auth/federation/callback',callback);
 app.post('/api/auth/federation/callback',callback);
}
export function registerIdentityPublicRoutes(app:Express,deps:{federation:FederationService;auth:AuthenticationService;mfa:MfaService;passkeys:WebAuthnService;
 resolveTenant:(req:Request)=>Promise<string|undefined>;setSession:(req:Request,res:Response,s:{accessToken:string;refreshToken:string;expiresIn:number})=>void}){
 const {federation,auth,mfa,passkeys,resolveTenant,setSession}=deps;
 app.get('/api/auth/federation/providers',route(async(req,res)=>{
  const tenant=await resolveTenant(req);res.json({providers:tenant?await federation.list(tenant):[]});
 }));
 app.post('/api/auth/federation/start',route(async(req,res)=>{
  const tenant=await resolveTenant(req);if(!tenant||typeof req.body?.providerId!=='string')throw Error('Invalid identity provider');
  const browser=randomBytes(32).toString('base64url');
  const result=await federation.start(tenant,req.body.providerId,req.get('origin')??'',browser);
  res.setHeader('Set-Cookie',`md_sso_browser=${browser}; HttpOnly; Secure; SameSite=None; Path=/api/auth/federation; Max-Age=300`);
  res.json({url:result.url});
 }));
 app.post('/api/auth/federation/complete',route(async(req,res)=>{
  const ticket=cookie(req,'md_fed_result');if(!ticket){res.status(204).end();return;}
  const tenant=await resolveTenant(req);if(!tenant)throw Error('Invalid federation domain');
  const user=await federation.complete(ticket,tenant);
  res.setHeader('Set-Cookie','md_fed_result=; HttpOnly; Secure; SameSite=None; Path=/api/auth; Max-Age=0');
  const challenge=await mfa.createChallenge(tenant,user,{ip:req.ip});
  if(challenge){res.json(challenge);return;}
  setSession(req,res,await auth.issuePasswordSession(tenant,user,{ip:req.ip}));
 }));
 app.post('/api/auth/passkeys/options',route(async(req,res)=>res.json(await passkeys.authenticationOptions(req.body?.challenge_token,req.get('origin')))));
 app.post('/api/auth/passkeys/verify',route(async(req,res)=>setSession(req,res,await passkeys.authenticate(req.body?.token,req.body?.response,{ip:req.ip}))));
}
export function registerIdentityAdminRoutes(app:Express,deps:{sessions:SessionPolicyService;federation:FederationService;passkeys:WebAuthnService;backups:MfaBackupService}){
 const {sessions,federation,passkeys,backups}=deps;
 app.get('/api/auth/session-policy',route(async(req,res)=>{const a=req.actor!;res.json(await sessions.read(a.tenant_id,a.user_id));}));
 app.put('/api/auth/session-policy',route(async(req,res)=>{const a=req.actor!;res.json(await sessions.save(a.tenant_id,a.user_id,req.body));}));
 app.post('/api/auth/mfa/backup-codes',route(async(req,res)=>{const a=req.actor!;res.setHeader('Cache-Control','no-store');res.json(await backups.regenerate(a.tenant_id,a.user_id,req.body?.password,req.body?.code));}));
 app.post('/api/auth/mfa/admin-reset',route(async(req,res)=>{const a=req.actor!;res.json(await backups.reset(a.tenant_id,a.user_id,req.body?.userId,req.body?.password,req.body?.code));}));
 app.get('/api/auth/passkeys',route(async(req,res)=>{const a=req.actor!;res.json({credentials:await passkeys.list(a.tenant_id,a.user_id)});}));
 app.post('/api/auth/passkeys/register/options',route(async(req,res)=>{const a=req.actor!;res.json(await passkeys.registrationOptions(a.tenant_id,a.user_id,req.get('origin'),req.body?.password));}));
 app.post('/api/auth/passkeys/register',route(async(req,res)=>{const a=req.actor!;res.json(await passkeys.register(a.tenant_id,a.user_id,req.body?.token,req.body?.response,req.body?.label));}));
 app.post('/api/auth/passkeys/remove',route(async(req,res)=>{const a=req.actor!;res.json(await passkeys.remove(a.tenant_id,a.user_id,req.body?.id,req.body?.password));}));
 app.get('/api/auth/identity-providers',route(async(req,res)=>{const a=req.actor!;res.json({providers:await federation.list(a.tenant_id,a.user_id),deployment:federation.configuration()});}));
 app.put('/api/auth/identity-providers',route(async(req,res)=>{const a=req.actor!;res.json({providers:await federation.save(a.tenant_id,a.user_id,req.body)});}));
 app.get('/api/auth/federated-identities',route(async(req,res)=>{const a=req.actor!;res.json({identities:await federation.links(a.tenant_id,a.user_id)});}));
 app.put('/api/auth/federated-identities',route(async(req,res)=>{const a=req.actor!;res.json(await federation.link(a.tenant_id,a.user_id,req.body));}));
}
