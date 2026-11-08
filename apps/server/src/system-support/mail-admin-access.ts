import {createHash,randomBytes} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';

type Actor={tenant_id:string;user_id:string};
type Row=Actor&{mailbox_email:string};
const key=()=>randomBytes(32).toString('base64url');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const tokenPattern=/^[a-zA-Z0-9_-]{43}$/;

// Neither mailbox passwords nor master-account credentials are persisted to SQL or sent to browsers.
export class MailAdminAccess {
 constructor(private readonly db:Pick<SqlPersistence,'query'>,private readonly rbac:Pick<RbacEngine,'require'>){}
 private master(){
  const username=process.env.METADRIVE_MAIL_ADMIN_MASTER_USERNAME;
  const password=process.env.METADRIVE_MAIL_ADMIN_MASTER_PASSWORD;
  if(!username||!password||!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)||password.length<24||/[\r\n\0]/.test(password))
   throw new Error('Admin mailbox access is not configured');
  return {username,password};
 }
 private async event(row:Row,action:string,operation?:string){
  await this.db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[
   row.tenant_id,row.user_id,action,JSON.stringify({provider:'docker-mailserver',email:row.mailbox_email,...(operation?{operation}:{})})
  ]);
 }
 async createTicket(actor:Actor,address:string){
  this.master();
  await this.rbac.require(actor.tenant_id,actor.user_id,'Mailbox','manage');
  const {rows}=await this.db.query<{email:string}>(
   "SELECT email FROM md_mail_accounts WHERE tenant_id=$1 AND email=$2 AND status='active'",
   [actor.tenant_id,address]);
  if(!rows[0])throw new Error('Mailbox not found');
  const ticket=key();
  await this.db.query(
   "INSERT INTO md_mail_admin_sessions(token_hash,tenant_id,actor_user_id,mailbox_email,kind,expires_at) VALUES($1,$2,$3,$4,'ticket',now()+interval '60 seconds')",
   [hash(ticket),actor.tenant_id,actor.user_id,address]);
  await this.event({...actor,mailbox_email:address},'mailbox_admin_ticket_created');
  return {ticket,expiresIn:60};
 }
 async redeem(ticket:unknown){
  this.master();
  if(typeof ticket!=='string'||!tokenPattern.test(ticket))return null;
  const session=key();
  // Atomic one-use exchange: concurrent redemption or replay cannot issue two sessions.
  const {rows}=await this.db.query<Row>(
   "UPDATE md_mail_admin_sessions SET token_hash=$2,kind='session',expires_at=now()+interval '15 minutes',redeemed_at=now() WHERE token_hash=$1 AND kind='ticket' AND expires_at>now() RETURNING tenant_id,actor_user_id AS user_id,mailbox_email",
   [hash(ticket),hash(session)]);
  const row=rows[0];
  if(!row)return null;
  await this.event(row,'mailbox_admin_session_started');
  return {token:session,email:row.mailbox_email,expiresIn:900};
 }
 async authorize(token:string,action:string){
  if(!['folders','messages','message'].includes(action))throw new Error('Admin mailbox access is read-only');
  if(!tokenPattern.test(token))throw new Error('Invalid admin session');
  const {rows}=await this.db.query<Row>(
   "SELECT s.tenant_id,s.actor_user_id AS user_id,s.mailbox_email FROM md_mail_admin_sessions s JOIN md_mail_accounts a ON a.tenant_id=s.tenant_id AND a.email=s.mailbox_email AND a.status='active' JOIN md_users u ON u.tenant_id=s.tenant_id AND u.id=s.actor_user_id AND u.enabled=true WHERE s.token_hash=$1 AND s.kind='session' AND s.expires_at>now()",
   [hash(token)]);
  const row=rows[0];
  if(!row)throw new Error('Invalid admin session');
  await this.rbac.require(row.tenant_id,row.user_id,'Mailbox','manage');
  const master=this.master();
  await this.event(row,'mailbox_admin_read',action);
  return {username:row.mailbox_email+'*'+master.username,password:master.password,email:row.mailbox_email};
 }
 async revoke(token:string){
  if(!tokenPattern.test(token))return;
  const {rows}=await this.db.query<Row>(
   "DELETE FROM md_mail_admin_sessions WHERE token_hash=$1 AND kind='session' RETURNING tenant_id,actor_user_id AS user_id,mailbox_email",
   [hash(token)]);
  if(rows[0])await this.event(rows[0],'mailbox_admin_session_ended');
 }
}
