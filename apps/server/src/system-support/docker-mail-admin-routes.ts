import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {MailAdminAccess} from './mail-admin-access.js';
import {createConnection} from 'node:net';
import {randomBytes} from 'node:crypto';
import {resolveTxt} from 'node:dns/promises';

type Actor={tenant_id:string;user_id:string};
type MailRequest=Request<Record<string,string>>&{actor?:Actor};
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
 const status=message==='Permission denied'?403:pg==='23505'||message==='Mailbox already registered'?409:
  /Invalid|must be|not available|not verified|not found|not supported|requires security approval/.test(message)?400:503;
 res.status(status).json({error:status===503?'Mail administration unavailable':message});
}
export function registerDockerMailAdminRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine,adminAccess?:MailAdminAccess){
 async function permission(req:MailRequest,access:'read'|'manage'){
  const actor=req.actor;
  if(!actor?.tenant_id||!actor.user_id)throw new Error('Permission denied');
  await rbac.require(actor.tenant_id,actor.user_id,'Mailbox',access);
  return actor;
 }
 async function audit(actor:Actor,action:string,address:string){
  await db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[
   actor.tenant_id,actor.user_id,action,JSON.stringify({provider:'docker-mailserver',email:address})
  ]);
 }
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
 app.get('/api/mail/domains',handler(async(req,res)=>{
  try{const actor=await permission(req,'read');const {rows}=await db.query(
   'SELECT id,domain AS name,verified_at IS NOT NULL AS "isEnabled",verification_token AS "verificationToken" FROM md_mail_domains WHERE tenant_id=$1 ORDER BY domain',[actor.tenant_id]);
   res.setHeader('Cache-Control','private, no-store');res.json({domains:rows});}catch(e){problem(res,e);}
 }));
 app.post('/api/mail/domains',handler(async(req,res)=>{
  try{const actor=await permission(req,'manage'),domain=String(req.body?.domain??'').toLowerCase().trim();
   if(process.env.METADRIVE_ENABLE_TENANT_MAIL!=='true')throw new Error('Tenant mail onboarding requires security approval');
   if(!domainPattern.test(domain)||domain.endsWith('.local'))throw new Error('Invalid mail domain');
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
   let entries:string[][]=[];
   try{entries=await resolveTxt('_metadrive-mail.'+domain.domain);}catch{}
   if(!entries.some(entry=>entry.join('')==='metadrive='+domain.verification_token)){
    res.status(409).json({error:'Domain TXT ownership verification has not succeeded'});return;
   }
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
   if(domain.domain!=='unesolutions.co.uk'&&process.env.METADRIVE_ENABLE_TENANT_MAIL!=='true')
    throw new Error('Tenant mail onboarding requires security approval');
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
