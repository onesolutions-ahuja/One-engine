import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {MailAdminAccess} from './mail-admin-access.js';
import type {PlatformTenantService} from '../system-files/platform-tenant-service.js';
import {createConnection} from 'node:net';
import {randomBytes} from 'node:crypto';
import {checkDnsTxtProof,dnsProofFailureMessage} from './dns-txt-proof.js';

type Actor={tenant_id:string;user_id:string};
type MailRequest=Request<Record<string,string>>&{actor?:Actor};
/** Target tenant of a mail request. tenant_id is the TARGET; actor_tenant_id is where the user signed in. */
type Scope=Actor&{actor_tenant_id:string;slug:string;crossTenant:boolean};
const tenantSlug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SYSTEM_MAIL_DOMAIN='unesolutions.co.uk';
const GATE_MESSAGE='Tenant mail onboarding requires security approval: a platform administrator must turn on tenant mail in Mail admin';
const localPart=/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;
const socketPath=process.env.METADRIVE_MCP_BROKER_SOCKET??'/run/metadrive-mcp-broker.sock';
const domainPattern=/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
type Operation='mailbox_add'|'mailbox_reset'|'mailbox_delete'|'mailbox_list'|'sender_approve';
export function broker(action:Operation,address?:string,password?:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const conn=createConnection(socketPath);let data='',settled=false;
  const fail=(error:Error)=>{if(!settled){settled=true;conn.destroy();reject(error);}};
  conn.setTimeout(action==='sender_approve'?65000:21000,()=>fail(new Error('Mailbox administration timed out')));
  conn.on('error',fail);
  conn.setEncoding('utf8');
  conn.on('data',(part:string)=>{
   data+=part;
   if(data.length>110000){fail(new Error('Mailbox response exceeded limit'));return;}
   if(!data.includes('\n'))return;
   try{
    const result=JSON.parse(data.split('\n')[0]) as {error?:string;output?:string};
    if(result.error){fail(new Error('Mail server administration unavailable'));return;}
    settled=true;conn.end();resolve(result.output??'');
   }catch{fail(new Error('Invalid mail administration response'));}
  });
  conn.on('connect',()=>conn.end(JSON.stringify({action,service:'api',...(address?{address}:{}),...(password?{password}:{})})+'\n'));
 });
}
const handler=(fn:(req:MailRequest,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{
 void fn(req as MailRequest,res).catch(next);
};
function problem(res:Response,error:unknown){
 const message=error instanceof Error?error.message:'Mail administration failed';
 const pg=error&&typeof error==='object'&&'code' in error?(error as {code?:string}).code:'';
 const status=message==='Permission denied'?403:pg==='23505'||/already registered/.test(message)?409:
  message.startsWith('DNS ')?422:
  /Invalid|must be|not available|not verified|not found|not supported|requires security approval/.test(message)?400:503;
 if(status===503)console.error('Mail administration failed',error);
 const shown=status===503?'Mail administration unavailable':
  pg==='23505'?'Mail domain or mailbox already registered':message;
 res.status(status).json({error:shown});
}
export function registerDockerMailAdminRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine,
  adminAccess?:MailAdminAccess,platform?:Pick<PlatformTenantService,'isPlatformAdministrator'>){
 const isPlatformAdmin=async(actor:Actor)=>
  platform?platform.isPlatformAdministrator(actor.tenant_id,actor.user_id):false;
 /**
  * Own tenant: central RBAC Mailbox read/manage, as before.
  * Another tenant (?tenant=<slug>): platform OneEngine in the platform tenant only.
  */
 async function permission(req:MailRequest,access:'read'|'manage'):Promise<Scope>{
  const actor=req.actor;
  if(!actor?.tenant_id||!actor.user_id)throw new Error('Permission denied');
  const own=await db.query<{slug:string}>('SELECT slug FROM md_tenants WHERE id=$1',[actor.tenant_id]);
  const ownSlug=own.rows[0]?.slug??'';
  const requested=typeof req.query.tenant==='string'?req.query.tenant.trim().toLowerCase():'';
  if(!requested||requested===ownSlug){
   await rbac.require(actor.tenant_id,actor.user_id,'Mailbox',access);
   return {...actor,actor_tenant_id:actor.tenant_id,slug:ownSlug,crossTenant:false};
  }
  if(!tenantSlug.test(requested))throw new Error('Invalid tenant');
  if(!(await isPlatformAdmin(actor)))throw new Error('Permission denied');
  const {rows}=await db.query<{id:string;status:string}>('SELECT id,status FROM md_tenants WHERE slug=$1',[requested]);
  if(!rows[0])throw new Error('Tenant not found');
  if(access==='manage'&&rows[0].status==='ARCHIVED')throw new Error('Invalid tenant: archived tenants cannot be changed');
  return {tenant_id:rows[0].id,user_id:actor.user_id,actor_tenant_id:actor.tenant_id,slug:requested,crossTenant:true};
 }
 async function audit(scope:Scope,action:string,address:string){
  await db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[
   scope.actor_tenant_id,scope.user_id,action,JSON.stringify({provider:'docker-mailserver',email:address,
    ...(scope.crossTenant?{targetTenantId:scope.tenant_id,targetTenant:scope.slug}:{})})
  ]);
 }
 /** Server env forces it on; otherwise the audited SQL platform switch decides. */
 async function tenantMailEnabled(){
  if(process.env.METADRIVE_ENABLE_TENANT_MAIL==='true')return true;
  const {rows}=await db.query<{enabled:boolean}>(
   "SELECT enabled FROM md_platform_feature_flags WHERE flag='tenant_mail'");
  return rows[0]?.enabled===true;
 }
 app.get('/api/mail/settings',handler(async(req,res)=>{
  try{
   const scope=await permission(req,'read');
   res.setHeader('Cache-Control','private, no-store');
   res.json({tenantMailEnabled:await tenantMailEnabled(),
    forcedByServer:process.env.METADRIVE_ENABLE_TENANT_MAIL==='true',
    canManageAllTenants:await isPlatformAdmin(req.actor!),currentTenant:scope.slug});
  }catch(e){problem(res,e);}
 }));
 app.put('/api/mail/settings',handler(async(req,res)=>{
  try{
   const actor=req.actor;
   if(!actor?.tenant_id||!actor.user_id||!(await isPlatformAdmin(actor)))throw new Error('Permission denied');
   const enabled=req.body?.tenantMailEnabled;
   if(typeof enabled!=='boolean')throw new Error('Invalid mail settings');
   await db.transaction(async client=>{
    await client.query(`INSERT INTO md_platform_feature_flags(flag,enabled,updated_by_tenant_id,updated_by_user_id,updated_at)
     VALUES('tenant_mail',$1,$2,$3,now()) ON CONFLICT(flag) DO UPDATE SET enabled=EXCLUDED.enabled,
     updated_by_tenant_id=EXCLUDED.updated_by_tenant_id,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()`,
     [enabled,actor.tenant_id,actor.user_id]);
    await client.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
     [actor.tenant_id,actor.user_id,'platform_tenant_mail_'+(enabled?'enabled':'disabled'),JSON.stringify({flag:'tenant_mail',enabled})]);
   });
   res.json({tenantMailEnabled:await tenantMailEnabled(),
    forcedByServer:process.env.METADRIVE_ENABLE_TENANT_MAIL==='true'});
  }catch(e){problem(res,e);}
 }));
 const scopedDomain=async(actor:Actor,id:string)=>{
  const {rows}=await db.query<{id:string;domain:string}>(
   'SELECT id,domain FROM md_mail_domains WHERE tenant_id=$1 AND id::text=$2 AND verified_at IS NOT NULL',
   [actor.tenant_id,id]);
  if(!rows[0])throw new Error('Mail domain not found or not verified');
  return rows[0];
 };
 const account=async(actor:Actor,address:string)=>{
  const {rows}=await db.query<{email:string;status:string}>(
   'SELECT email,status FROM md_mail_accounts WHERE tenant_id=$1 AND email=$2',[actor.tenant_id,address]);
  if(!rows[0]||rows[0].status!=='active')throw new Error('Mailbox not found');
  return rows[0];
 };
 // Platform administrators: every tenant's verified mail domains, so a mailbox can be
 // created for any tenant without switching the tenant picker first.
 app.get('/api/mail/platform-domains',handler(async(req,res)=>{
  try{
   const actor=req.actor;
   if(!actor?.tenant_id||!actor.user_id||!(await isPlatformAdmin(actor)))throw new Error('Permission denied');
   const {rows}=await db.query(`SELECT d.id,d.domain AS name,t.slug AS tenant,t.name AS "tenantName"
     FROM md_mail_domains d JOIN md_tenants t ON t.id=d.tenant_id
     WHERE d.verified_at IS NOT NULL AND t.status<>'ARCHIVED' ORDER BY t.name,d.domain`);
   res.setHeader('Cache-Control','private, no-store');
   res.json({domains:rows});
  }catch(e){problem(res,e);}
 }));
 app.get('/api/mail/domains',handler(async(req,res)=>{
  try{const actor=await permission(req,'read');const {rows}=await db.query(
   'SELECT id,domain AS name,verified_at IS NOT NULL AS "isEnabled",verification_token AS "verificationToken" FROM md_mail_domains WHERE tenant_id=$1 ORDER BY domain',[actor.tenant_id]);
   res.setHeader('Cache-Control','private, no-store');
   // Lets the UI explain the security gate before the user fills in a domain.
   res.json({domains:rows,tenantMailEnabled:await tenantMailEnabled()});}catch(e){problem(res,e);}
 }));
 app.post('/api/mail/domains',handler(async(req,res)=>{
  try{const actor=await permission(req,'manage'),domain=String(req.body?.domain??'').toLowerCase().trim();
   if(domain!==SYSTEM_MAIL_DOMAIN&&!(await tenantMailEnabled()))throw new Error(GATE_MESSAGE);
   if(!domainPattern.test(domain)||domain.endsWith('.local'))throw new Error('Invalid mail domain');
   const existing=await db.query<{tenant_id:string}>('SELECT tenant_id FROM md_mail_domains WHERE domain=$1',[domain]);
   if(existing.rows[0])throw new Error(existing.rows[0].tenant_id===actor.tenant_id
    ?'Mail domain already registered for this tenant':'Mail domain already registered to another tenant');
   const token=randomBytes(24).toString('hex');
   const {rows}=await db.query(
    `INSERT INTO md_mail_domains(tenant_id,domain,verification_token)
     VALUES($1,$2,$3) RETURNING id,domain AS name,verification_token AS "verificationToken"`,
    [actor.tenant_id,domain,token]);
   res.status(201).json({domain:{...rows[0],isEnabled:false,txtRecord:'_metadrive-mail.'+domain,txtValue:'metadrive='+token}});
  }catch(e){problem(res,e);}
 }));
 app.post('/api/mail/domains/:id/verify',handler(async(req,res)=>{
  try{const actor=await permission(req,'manage');
   const {rows}=await db.query<{id:string;domain:string;verification_token:string|null}>(
    'SELECT id,domain,verification_token FROM md_mail_domains WHERE tenant_id=$1 AND id::text=$2',
    [actor.tenant_id,req.params.id]);
   const domain=rows[0];if(!domain)throw new Error('Mail domain not found');
   if(!domain.verification_token){res.json({verified:true});return;}
   const recordName='_metadrive-mail.'+domain.domain;
   const proof=await checkDnsTxtProof(recordName,'metadrive='+domain.verification_token);
   if(proof.status!=='match')throw new Error(dnsProofFailureMessage(proof,recordName,domain.domain));
   await db.query('UPDATE md_mail_domains SET verified_at=now(),verification_token=NULL WHERE tenant_id=$1 AND id=$2',
    [actor.tenant_id,domain.id]);
   await audit(actor,'mail_domain_verified',domain.domain);
   res.json({verified:true});
  }catch(e){problem(res,e);}
 }));
 app.post('/api/mail/domains/:id/approve-sender',handler(async(req,res)=>{
  try{
   const actor=await permission(req,'manage');
   const domain=await scopedDomain(actor,req.params.id);
   const email=req.body?.email;
   if(typeof email!=='string'||email!==email.toLowerCase()||!email.endsWith('@'+domain.domain)
    ||!localPart.test(email.slice(0,-domain.domain.length-1)))
    throw new Error('Invalid sender address for this tenant domain');
   await broker('sender_approve',email);
   await audit(actor,'mail_sender_approved',email);
   res.json({sender:{email,status:'approved'}});
  }catch(e){problem(res,e);}
 }));
 app.get('/api/mail/mailboxes',handler(async(req,res)=>{
  try{const actor=await permission(req,'read');const {rows}=await db.query<{
   email:string;domain:string;description:string;created_at:Date;domain_id:string
  }>(`SELECT a.email,a.domain,a.description,a.created_at,d.id AS domain_id
     FROM md_mail_accounts a JOIN md_mail_domains d ON d.domain=a.domain AND d.tenant_id=a.tenant_id
     WHERE a.tenant_id=$1 AND a.status='active' ORDER BY a.email`,[actor.tenant_id]);
   res.setHeader('Cache-Control','private, no-store');res.json({mailboxes:rows.map(row=>({
    id:row.email,emailAddress:row.email,name:row.email.split('@')[0],domainId:row.domain_id,
    description:row.description,usedDiskQuota:0,quotas:{},createdAt:row.created_at
   }))});}catch(e){problem(res,e);}
 }));
 app.post('/api/mail/mailboxes',handler(async(req,res)=>{
  try{
   const actor=await permission(req,'manage'),body=req.body??{};
   const name=body.name,domainId=body.domainId,password=body.password,description=body.description??'';
   if(typeof name!=='string'||!localPart.test(name.toLowerCase())||name!==name.toLowerCase())throw new Error('Invalid mailbox name');
   if(typeof domainId!=='string'||!domainId||typeof password!=='string'||password.length<12||password.length>256
    ||/[\r\n\0]/.test(password)||typeof description!=='string'||description.length>500)throw new Error('Invalid mailbox request');
   const domain=await scopedDomain(actor,domainId),address=name+'@'+domain.domain;
   if(domain.domain!==SYSTEM_MAIL_DOMAIN&&!(await tenantMailEnabled()))throw new Error(GATE_MESSAGE);
   // Approve first: an OCI outage must not reserve a mailbox in an unretryable error state.
   await broker('sender_approve',address);
   const {rows}=await db.query<{email:string}>(
    `INSERT INTO md_mail_accounts(email,tenant_id,domain,description,status)
     VALUES($1,$2,$3,$4,'pending') RETURNING email`,[address,actor.tenant_id,domain.domain,description]);
   if(!rows[0])throw new Error('Mailbox already registered');
   try{
    await broker('mailbox_add',address,password);
    await db.query(`UPDATE md_mail_accounts SET status='active',updated_at=now()
      WHERE tenant_id=$1 AND email=$2`,[actor.tenant_id,address]);
   }catch(error){
    await db.query(`UPDATE md_mail_accounts SET status='error',updated_at=now()
      WHERE tenant_id=$1 AND email=$2`,[actor.tenant_id,address]).catch(()=>{});
    throw error;
   }
   await audit(actor,'mailbox_created',address);
   res.status(201).json({mailbox:{id:address,emailAddress:address}});
  }catch(e){problem(res,e);}
 }));
 app.post('/api/mail/mailboxes/:id/open',handler(async(req,res)=>{
  try{
   if(!adminAccess){res.status(503).json({error:'Admin mailbox access unavailable'});return;}
   const actor=await permission(req,'manage'),address=req.params.id;
   // Reading another tenant's mail is tenant business data: never via platform scope.
   if(actor.crossTenant)throw new Error('Permission denied');
   await account(actor,address);
   const ticket=await adminAccess.createTicket(actor,address);
   res.setHeader('Cache-Control','no-store');
   res.json(ticket);
  }catch(e){problem(res,e);}
 }));
 app.post('/api/mail/mailboxes/:id/reset-password',handler(async(req,res)=>{
  try{const actor=await permission(req,'manage'),address=req.params.id;
   const password=req.body?.password;
   if(typeof password!=='string'||password.length<12||password.length>256||/[\r\n\0]/.test(password))throw new Error('Invalid mailbox password');
   await account(actor,address);await broker('mailbox_reset',address,password);
   await audit(actor,'mailbox_password_reset',address);res.status(204).end();
  }catch(e){problem(res,e);}
 }));
 app.patch('/api/mail/mailboxes/:id',handler(async(req,res)=>{
  try{const actor=await permission(req,'manage'),address=req.params.id;
   await account(actor,address);
   const description=req.body?.description;
   if(typeof description!=='string'||description.length>500)throw new Error('Invalid description');
   if(req.body?.quotas&&Object.keys(req.body.quotas).length)throw new Error('Mailbox quota editing is not supported yet');
   await db.query(`UPDATE md_mail_accounts SET description=$3,updated_at=now()
    WHERE tenant_id=$1 AND email=$2`,[actor.tenant_id,address,description]);
   await audit(actor,'mailbox_updated',address);res.json({mailbox:{id:address,emailAddress:address,description}});
  }catch(e){problem(res,e);}
 }));
 app.delete('/api/mail/mailboxes/:id',handler(async(req,res)=>{
  try{const actor=await permission(req,'manage'),address=req.params.id;
   await account(actor,address);await broker('mailbox_delete',address);
   await db.query('DELETE FROM md_mail_accounts WHERE tenant_id=$1 AND email=$2',[actor.tenant_id,address]);
   await audit(actor,'mailbox_deleted',address);res.status(204).end();
  }catch(e){problem(res,e);}
 }));
}
