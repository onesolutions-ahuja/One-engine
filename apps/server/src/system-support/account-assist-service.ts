import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import {hasPlatformOneEngine,PLATFORM_TENANT_DOMAIN} from '../system-files/platform-tenant-service.js';

const phonePattern=/^\+[1-9][0-9]{7,14}$/;
const emailPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const LINK_MINUTES=30;
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const mask=(phone:string)=>phone.slice(0,3)+'•'.repeat(Math.max(0,phone.length-6))+phone.slice(-3);

type Actor={tenant_id:string;user_id:string};
type AssistInput={reason:string;requestedByUser:boolean};

function parsePhone(raw:unknown):string{
 const phone=typeof raw==='string'?raw.replace(/[\s()-]/g,''):'';
 if(!phonePattern.test(phone))throw new Error('Enter the mobile number in international format, e.g. +447700900123');
 return phone;
}
function parseAssist(body:unknown):AssistInput{
 const x=(body&&typeof body==='object'&&!Array.isArray(body)?body:{}) as Record<string,unknown>;
 const reason=typeof x.reason==='string'?x.reason.trim():'';
 if(reason.length<10||reason.length>500)throw new Error('Give a reason of 10–500 characters; it is recorded in the audit trail');
 if(typeof x.requestedByUser!=='boolean')throw new Error('State whether the user requested this');
 return {reason,requestedByUser:x.requestedByUser};
}
function resetOrigin(){
 const url=new URL(process.env.METADRIVE_PASSWORD_RESET_ORIGIN
  ??'https://'+(process.env.METADRIVE_PLATFORM_WEB_HOST??PLATFORM_TENANT_DOMAIN)+'/login');
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Invalid password reset origin');
 return url;
}

/** Recovery phones and audited, admin-assisted password resets.
 * Every change is written to the target tenant's md_security_events (its Audit Trail)
 * with who did it, why, and whether the user asked for it. */
export class AccountAssistService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly auth:AuthenticationService,
  private readonly requireUserScope:(tenantId:string,actorId:string,target:string)=>Promise<void>){}

 async readOwnPhone(actor:Actor){
  const {rows}=await this.db.query<{phone_e164:string;verified_at:Date}>(
   'SELECT phone_e164,verified_at FROM md_user_recovery_phones WHERE tenant_id=$1 AND user_id=$2',
   [actor.tenant_id,actor.user_id]);
  return {phone:rows[0]?mask(rows[0].phone_e164):null,updatedAt:rows[0]?.verified_at??null};
 }
 /** Self-service: the signed-in user re-enters their password to set their recovery mobile. */
 async setOwnPhone(actor:Actor,body:unknown){
  const x=(body??{}) as Record<string,unknown>;
  if(typeof x.currentPassword!=='string')throw new Error('Enter your current password');
  await this.auth.verifyCurrentPassword(actor.tenant_id,actor.user_id,x.currentPassword);
  const phone=x.phone===null?null:parsePhone(x.phone);
  await this.writePhone(actor.tenant_id,actor.user_id,actor.user_id,phone,{source:'self-service'});
  return this.readOwnPhone(actor);
 }
 /** Admin: requires User edit + Security manage and reporting scope over the target. */
 async setUserPhone(actor:Actor,targetUserId:string,body:unknown){
  await this.rbac.require(actor.tenant_id,actor.user_id,'User','edit');
  await this.rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
  await this.requireUserScope(actor.tenant_id,actor.user_id,targetUserId);
  const x=(body??{}) as Record<string,unknown>;
  const assist=parseAssist(body);
  const phone=x.phone===null?null:parsePhone(x.phone);
  await this.writePhone(actor.tenant_id,actor.user_id,targetUserId,phone,{source:'admin',...assist});
  return {updated:true,phone:phone?mask(phone):null};
 }
 private async writePhone(tenantId:string,actorId:string|null,userId:string,phone:string|null,
  details:Record<string,unknown>){
  await this.db.transaction(async client=>{
   const {rows}=await client.query('SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true',[tenantId,userId]);
   if(!rows[0])throw new Error('User not found');
   if(phone)await client.query(`INSERT INTO md_user_recovery_phones(tenant_id,user_id,phone_e164,verified_at)
     VALUES($1,$2,$3,now()) ON CONFLICT(tenant_id,user_id) DO UPDATE SET phone_e164=EXCLUDED.phone_e164,verified_at=now()`,
     [tenantId,userId,phone]);
   else await client.query('DELETE FROM md_user_recovery_phones WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action,details)
     VALUES($1,$2,$3,$4,$5::jsonb)`,[tenantId,actorId,userId,phone?'RecoveryPhoneSet':'RecoveryPhoneRemoved',
     JSON.stringify({...details,phone:phone?mask(phone):null})]);
  });
 }

 /** Tenant admin issues a one-time set-password link for one of their users. */
 async adminResetLink(actor:Actor,targetUserId:string,body:unknown){
  await this.rbac.require(actor.tenant_id,actor.user_id,'User','edit');
  await this.rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
  await this.requireUserScope(actor.tenant_id,actor.user_id,targetUserId);
  if(targetUserId===actor.user_id)throw new Error('Use Change Password or Forgot password for your own account');
  const assist=parseAssist(body);
  const {rows:actors}=await this.db.query<{email:string}>('SELECT email FROM md_users WHERE tenant_id=$1 AND id=$2',
   [actor.tenant_id,actor.user_id]);
  return this.issueLink(actor.tenant_id,{userId:targetUserId},actor.user_id,
   {issuedBy:'tenant-admin',actorEmail:actors[0]?.email??null,...assist});
 }
 /** Platform support (OneEngine on the platform tenant) issues a link for any tenant's user.
  * Recorded in BOTH the target tenant's and the platform tenant's audit trail. */
 async platformResetLink(actor:Actor,tenantSlug:string,body:unknown){
  if(!await hasPlatformOneEngine(this.db,actor.tenant_id,actor.user_id))
   throw new Error('Platform OneEngine access is required');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug))throw new Error('Invalid tenant');
  const {rows:tenants}=await this.db.query<{id:string}>("SELECT id FROM md_tenants WHERE slug=$1 AND status='ACTIVE'",[tenantSlug]);
  const targetTenantId=tenants[0]?.id;
  if(!targetTenantId)throw new Error('Tenant not found or not active');
  const x=(body??{}) as Record<string,unknown>;
  const email=typeof x.email==='string'?x.email.trim().toLowerCase():'';
  if(!emailPattern.test(email)||email.length>254)throw new Error('Enter the user\'s email');
  const assist=parseAssist(body);
  const {rows:actors}=await this.db.query<{email:string}>('SELECT email FROM md_users WHERE tenant_id=$1 AND id=$2',
   [actor.tenant_id,actor.user_id]);
  const result=await this.issueLink(targetTenantId,{email},null,
   {issuedBy:'platform-support',actorEmail:actors[0]?.email??null,actorTenantId:actor.tenant_id,...assist});
  await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
   VALUES($1,$2,'PlatformPasswordResetLinkIssued',$3::jsonb)`,[actor.tenant_id,actor.user_id,
   JSON.stringify({targetTenant:tenantSlug,targetEmail:email,...assist,expiresAt:result.expiresAt})]);
  return result;
 }
 private async issueLink(tenantId:string,target:{userId?:string;email?:string},actorId:string|null,
  details:Record<string,unknown>){
  const token=randomBytes(32).toString('base64url'),id=randomUUID();
  return this.db.transaction(async client=>{
   const {rows}=await client.query<{id:string;email:string}>(`SELECT u.id,u.email FROM md_users u
     JOIN md_tenants t ON t.id=u.tenant_id
     WHERE u.tenant_id=$1 AND u.enabled=true AND u.user_type='internal' AND t.status='ACTIVE'
       AND ($2::uuid IS NULL OR u.id=$2::uuid) AND ($3::text IS NULL OR lower(u.email)=$3::text)
     FOR UPDATE OF u`,[tenantId,target.userId??null,target.email??null]);
   const user=rows[0];
   if(!user||rows.length!==1)throw new Error('No active user with that email in this tenant');
   await client.query(`UPDATE md_password_reset_challenges SET consumed_at=now()
     WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL`,[tenantId,user.id]);
   const {rows:expiry}=await client.query<{expires_at:Date}>(`INSERT INTO md_password_reset_challenges
     (id,tenant_id,user_id,token_hash,expires_at,delivery_channel)
     VALUES($1,$2,$3,$4,now()+make_interval(mins=>$5::int),'admin') RETURNING expires_at`,
     [id,tenantId,user.id,digest(token),LINK_MINUTES]);
   // Unlock so the new password can be used straight away; the reset itself still revokes sessions.
   await client.query('UPDATE md_users SET failed_login_attempts=0,locked_until=NULL WHERE tenant_id=$1 AND id=$2',
    [tenantId,user.id]);
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action,details)
     VALUES($1,$2,$3,'PasswordResetLinkIssued',$4::jsonb)`,[tenantId,actorId,user.id,
     JSON.stringify({...details,expiresAt:expiry[0].expires_at,challengeId:id})]);
   const url=resetOrigin();
   url.searchParams.set('resetEmail',user.email);url.searchParams.set('resetToken',token);
   // The link is returned once, to the issuing admin, for out-of-band hand-over. It is never stored.
   return {resetUrl:url.toString(),email:user.email,expiresAt:expiry[0].expires_at,validMinutes:LINK_MINUTES};
  });
 }
}
