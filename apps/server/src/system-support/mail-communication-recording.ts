import {createHash,randomUUID} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {IntegrationActivityWriter,IntegrationActivityInput} from './integration-api-log.js';

type Db=Pick<SqlPersistence,'query'>;
type MailResponse=Record<string,unknown>;
type MailRequest={to?:unknown;subject?:unknown;body?:unknown;folder?:unknown;uid?:unknown};

let defaultLogger:{db:Db;writer:IntegrationActivityWriter}|undefined;
/** The API initializes its central durable outbox after the public mail route is registered. */
export function configureMailCommunicationRecording(db:Db,writer:IntegrationActivityWriter):void{
 defaultLogger={db,writer};
}
export function defaultMailCommunicationRecording(){
 return defaultLogger;
}

const text=(value:unknown,max=500):string=>
 typeof value==='string'?value.replace(/[\r\n\0]/g,' ').trim().slice(0,max):'';
const hash=(parts:string[]):string=>createHash('sha256').update(parts.join('\0')).digest('hex');
/** Same stable identity for browser IMAP reads and independent Maildir scans. */
export function incomingMailIdentity(mailbox:string,messageId:string,fallback:string):string{
 const normalized=messageId.trim();
 return normalized
  ?'mail-mid-'+hash([mailbox.toLowerCase(),normalized])
  :'mail-in-'+hash([mailbox.toLowerCase(),fallback]);
}
const obj=(value:unknown):Record<string,unknown>|null=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/**
 * Record authenticated Docker Mailserver events using the existing, durable,
 * append-only Integration Communication outbox. The Basic password never reaches
 * this function or the SQL database. A mailbox MUST be mapped to one active
 * tenant account; request-supplied tenant IDs are deliberately ignored.
 */
export async function recordMailboxCommunication(db:Db,writer:IntegrationActivityWriter,
 username:string,action:unknown,request:MailRequest,response:MailResponse):Promise<void>{
 const successful=response.ok===true;
 if(action!=='login'&&action!=='send'&&action!=='messages'&&action!=='message')return;
 if(!successful&&!(action==='send'&&response.mailAuthenticated===true))return;
 const email=text(username.toLowerCase(),254);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return;
 // Account ownership is established server-side, AFTER mailbox authentication.
 const {rows}=await db.query<{tenant_id:string}>(
  "SELECT tenant_id FROM md_mail_accounts WHERE email=$1 AND status='active'",[email]);
 let tenantId=rows[0]?.tenant_id;
 // A directly provisioned existing mailbox is linked only after authenticating
 // with IMAP, and only to the unique tenant with a verified mail domain.
 if(!tenantId&&successful){
  const domain=email.split('@')[1];
  const {rows:domains}=await db.query<{tenant_id:string}>(`
   SELECT tenant_id FROM md_mail_domains
   WHERE domain=$1 AND verified_at IS NOT NULL LIMIT 2`,[domain]);
  if(domains.length===1){
   const owner=domains[0].tenant_id;
   const {rows:imported}=await db.query<{email:string}>(`INSERT INTO md_mail_accounts
     (email,tenant_id,domain,description,status)
     VALUES($1,$2,$3,'Authenticated legacy mailbox','active')
     ON CONFLICT(email) DO NOTHING RETURNING email`,[email,owner,domain]);
   if(imported.length)await db.query(`INSERT INTO md_security_events
    (tenant_id,action,details) VALUES($1,'mailbox.authenticated_legacy_link',
    jsonb_build_object('email',$2::text))`,[owner,email]);
   const {rows:linked}=await db.query<{tenant_id:string}>(
    "SELECT tenant_id FROM md_mail_accounts WHERE email=$1 AND status='active'",[email]);
   if(linked[0]?.tenant_id===owner)tenantId=owner;
  }
 }
 if(!tenantId)return;
 if(action==='login')return; // Authenticate/link only; no message activity yet.

 if(action==='send'){
  const details=obj(response.result);
  const providerMessageId=text(details?.messageId,500);
  const sentAt=new Date().toISOString();
  const sender=text(email,254),recipient=text(request.to,500);
  const subject=text(request.subject,500);
  const body=typeof request.body==='string'?request.body.slice(0,10000):'';
  const good=successful&&details?.ok===true;
  const event:IntegrationActivityInput={
   tenantId,direction:'Outbound',transport:'SMTP',provider:'Docker Mailserver',
   endpoint:'smtp://mail.unesolutions.co.uk:587',method:'SMTP',
   outcome:good?'success':'network_error',
   errorCode:good?null:'SMTP_DELIVERY_FAILED',
   requestBytes:Buffer.byteLength(body,'utf8'),
   communication:{channel:'Email',name:'Email outbound',sender,recipient,subject,body,
    provider:'Docker Mailserver',relatedObject:'Mailbox',
    externalMessageId:good&&providerMessageId
     ?'mail-out-'+hash([email,providerMessageId])
     :'mail-attempt-'+randomUUID(),
    conversationId:providerMessageId||undefined,
    sentAt:good?sentAt:undefined}
  };
  await writer(event);
  return;
 }

 if(!successful)return;
 const result=obj(response.result);
 if(!result)return;
 const folder=text(request.folder||'INBOX',200);
 // Sent/Drafts/Trash already have their own logical events; only the Inbox
 // is proof of an inbound delivery to this authenticated mailbox.
 if(folder.toUpperCase()!=='INBOX')return;
 const validity=text(result.uidValidity,30);
 if(!/^\d{1,20}$/.test(validity))return;
 const messages=action==='messages'?result.messages:[result];
 if(!Array.isArray(messages))return;
 for(const raw of messages.slice(0,50)){
  const message=obj(raw);
  if(!message)continue;
  const uid=text(message.id,20);
  if(!/^\d{1,19}$/.test(uid))continue;
  const sender=text(message.from,500),recipient=text(message.to,500)||email;
  const messageId=text(message.messageId,500);
  const externalMessageId=incomingMailIdentity(email,messageId,
   ['INBOX',validity,uid].join(':'));
  const subject=text(message.subject,500);
  // Full text is provided for newly fetched inbox entries by the authenticated
  // IMAP adapter. The background worker uses the same message identity.
  const body=typeof message.body==='string'?message.body.slice(0,10000):undefined;
  // Never persist a headers-only placeholder under the final provider ID:
  // it would prevent a later full Maildir/IMAP body from being recorded.
  if(body===undefined)return;
  await writer({
   tenantId,direction:'Inbound',transport:'SMTP',provider:'Docker Mailserver',
   endpoint:'imap://mail.unesolutions.co.uk:993/INBOX',method:'GET',
   outcome:'success',
   communication:{channel:'Email',name:'Email inbound',sender,recipient,
    subject,body,provider:'Docker Mailserver',relatedObject:'Mailbox',
    externalMessageId,conversationId:messageId||undefined}
  });
 }
}
