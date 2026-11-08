import {createHash,createHmac,randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import {checkPasswordHistory,retainPasswordHistory} from './password-policy-service.js';
import {isPlatformRecoveryMailConfigured} from './platform-recovery-mailer.js';
import {readRecoveryFlow,renderRecoveryText,recoveryActionReady,
 type RecoveryChannel} from './password-recovery-flow-config.js';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const emailPattern=/^[^\s@]{1,64}@[^\s@]{1,189}$/;
const acknowledgement='If this account exists, recovery instructions have been sent.';
const invalidOtp='Incorrect or expired verification code.';
type Sender=(tenantId:string,credentialId:string,from:string,to:string,subject:string,body:string)=>Promise<void>;
type Callout=(tenantId:string,userId:string,config:Record<string,unknown>,
 variables:Record<string,string|number|boolean|null>,key:string)=>Promise<{status:number;body:string}>;
function secret():string{
 const key=process.env.METADRIVE_PASSWORD_RESET_OTP_SECRET;
 if(!key||Buffer.byteLength(key)<32)throw new Error('Password recovery OTP signing secret is not configured');
 return key;
}
function otpDigest(tenant:string,user:string,challenge:string,code:string):string{
 return createHmac('sha256',secret()).update(tenant+':'+user+':'+challenge+':'+code).digest('hex');
}
const numericCode=(length:4|6)=>randomInt(0,10**length).toString().padStart(length,'0');
function validEmail(email:unknown):email is string{
 return typeof email==='string'&&email.length<=254&&emailPattern.test(email);
}
/** Public tenant-scoped account recovery. Only verified destinations receive OTPs.
 * The configured Flow steps are restricted to server-owned verification and RBAC-
 * checked outbound HTTP Callouts; anonymous callers never execute arbitrary Flows. */
export class PasswordResetService {
 constructor(private readonly db:SqlPersistence,private readonly auth:AuthenticationService,
  private readonly send:Sender,private readonly httpCallout?:Callout){}
 async options(tenantId:string){
  const flow=await readRecoveryFlow(this.db,tenantId);
  const mailReady=isPlatformRecoveryMailConfigured()
   &&(flow.method==='LINK'||!!process.env.METADRIVE_PASSWORD_RESET_OTP_SECRET
     &&Buffer.byteLength(process.env.METADRIVE_PASSWORD_RESET_OTP_SECRET)>=32);
  return {otpLength:flow.otpLength,method:flow.method,
   channels:{email:mailReady,
    sms:flow.method==='OTP'&&recoveryActionReady(flow.channels.sms)&&!!this.httpCallout,
    whatsapp:flow.method==='OTP'&&recoveryActionReady(flow.channels.whatsapp)&&!!this.httpCallout}};
 }
 async request(tenantId:string,email:unknown,requestedChannel:unknown='email'){
  if(!validEmail(email)||!['email','sms','whatsapp'].includes(String(requestedChannel)))
   throw new Error('Invalid recovery request');
  const channel=requestedChannel as RecoveryChannel;
  const flow=await readRecoveryFlow(this.db,tenantId);
  if(flow.method==='LINK'&&channel!=='email')return {message:acknowledgement};
  // A missing deployment signing key must not disclose which accounts exist.
  if(flow.method==='OTP'&&(!process.env.METADRIVE_PASSWORD_RESET_OTP_SECRET
    ||Buffer.byteLength(process.env.METADRIVE_PASSWORD_RESET_OTP_SECRET)<32))
   return {message:acknowledgement};
  const action=channel==='email'?null:flow.channels[channel];
  if(action&&!recoveryActionReady(action))return {message:acknowledgement};
  const {rows:users}=await this.db.query<{id:string;name:string;phone_e164:string|null}>(`
   SELECT u.id,t.name,p.phone_e164 FROM md_users u
   JOIN md_tenants t ON t.id=u.tenant_id
   LEFT JOIN md_user_recovery_phones p ON p.tenant_id=u.tenant_id AND p.user_id=u.id
   WHERE u.tenant_id=$1 AND lower(u.email)=lower($2) AND u.enabled=true`,[tenantId,email]);
  const user=users[0];
  if(!user||channel!=='email'&&!user.phone_e164)return {message:acknowledgement};
  const isLink=flow.method==='LINK';
  const token=randomBytes(32).toString('base64url'),challengeId=randomUUID();
  const code=isLink?token:numericCode(flow.otpLength);
  const hash=isLink?null:otpDigest(tenantId,user.id,challengeId,code);
  const expires=isLink?15:flow.expiryMinutes;
  const issued=await this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenantId+':reset:'+user.id]);
   const {rows}=await client.query<{requests:string}>(`
    SELECT count(*)::text AS requests FROM md_password_reset_challenges
    WHERE tenant_id=$1 AND user_id=$2 AND created_at>now()-interval '1 hour'`,[tenantId,user.id]);
   if(Number(rows[0]?.requests??0)>=4)return false;
   await client.query(`UPDATE md_password_reset_challenges SET consumed_at=now()
    WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL`,[tenantId,user.id]);
   await client.query(`INSERT INTO md_password_reset_challenges
    (id,tenant_id,user_id,token_hash,expires_at,otp_hash,otp_length,max_attempts,delivery_channel)
    VALUES($1,$2,$3,$4,now()+($5 * interval '1 minute'),$6,$7,$8,$9)`,
    [challengeId,tenantId,user.id,digest(token),expires,hash,isLink?null:flow.otpLength,
     flow.otpLength===4?3:flow.maxAttempts,channel]);
   return true;
  });
  if(!issued)return {message:acknowledgement};
  try{
   if(channel==='email'){
    let verification=code;
    if(isLink){
     const origin=process.env.METADRIVE_PASSWORD_RESET_ORIGIN;
     if(!origin)throw new Error('Password recovery link origin is not configured');
     const url=new URL(origin);
     if(url.protocol!=='https:'||url.username||url.password||url.hash)
      throw new Error('Invalid password recovery link origin');
     url.searchParams.set('resetEmail',email);url.searchParams.set('resetToken',token);
     verification=url.toString();
    }
    const subject=renderRecoveryText(flow.emailSubject,verification,expires,user.name);
    const text=flow.emailTemplate.includes('{!Verification.Value}')
     ?flow.emailTemplate:flow.emailTemplate+'\n{!Verification.Value}';
    await this.send(tenantId,'','',email,subject,
     renderRecoveryText(text,verification,expires,user.name));
   }else{
    if(!this.httpCallout||!action?.flowServiceUserId||!action.credentialId)
     throw new Error('Recovery HTTP Callout unavailable');
    const message=renderRecoveryText(action.messageTemplate,code,expires,user.name);
    await this.httpCallout(tenantId,action.flowServiceUserId,{
     namedCredentialId:action.credentialId,method:'POST',path:action.calloutPath,
     body:action.calloutBody
    },{'Recovery.Phone':user.phone_e164,'Recovery.Code':code,
     'Recovery.Message':message},challengeId);
   }
  }catch{
   // Do not leave an unsent code usable; never log the code, recipient or provider response.
   await this.db.query('UPDATE md_password_reset_challenges SET consumed_at=now() WHERE tenant_id=$1 AND id=$2',
    [tenantId,challengeId]);
   console.error('Password recovery delivery failed for tenant',tenantId);
  }
  return {message:acknowledgement};
 }
 async verify(tenantId:string,email:unknown,submitted:unknown){
  if(!validEmail(email)||typeof submitted!=='string'||!/^(?:[0-9]{4}|[0-9]{6})$/.test(submitted))
   throw new Error(invalidOtp);
  const result=await this.db.transaction(async client=>{
   const {rows}=await client.query<{id:string;user_id:string;otp_hash:string;
    otp_length:number;attempt_count:number;max_attempts:number}>(`
    SELECT c.id,c.user_id,c.otp_hash,c.otp_length,c.attempt_count,c.max_attempts
    FROM md_password_reset_challenges c
    JOIN md_users u ON u.id=c.user_id AND u.tenant_id=c.tenant_id
    WHERE c.tenant_id=$1 AND lower(u.email)=lower($2)
      AND c.otp_hash IS NOT NULL AND c.verified_at IS NULL
      AND c.consumed_at IS NULL AND c.expires_at>now() AND u.enabled=true
    ORDER BY c.created_at DESC,c.id DESC LIMIT 1 FOR UPDATE OF c`,[tenantId,email]);
   const challenge=rows[0];
   if(!challenge||challenge.attempt_count>=challenge.max_attempts
     ||submitted.length!==challenge.otp_length)return null;
   const expected=Buffer.from(challenge.otp_hash,'hex');
   const actual=Buffer.from(otpDigest(tenantId,challenge.user_id,challenge.id,submitted),'hex');
   await client.query(`UPDATE md_password_reset_challenges
     SET attempt_count=attempt_count+1 WHERE tenant_id=$1 AND id=$2`,[tenantId,challenge.id]);
   if(!timingSafeEqual(expected,actual))return null;
   const resetToken=randomBytes(32).toString('base64url');
   await client.query(`UPDATE md_password_reset_challenges
     SET token_hash=$3,verified_at=now(),otp_hash=NULL
     WHERE tenant_id=$1 AND id=$2 AND attempt_count<=max_attempts`,
    [tenantId,challenge.id,digest(resetToken)]);
   return {resetToken};
  });
  if(!result)throw new Error(invalidOtp);
  return result;
 }
 async confirm(tenantId:string,email:unknown,token:unknown,password:unknown){
  if(!validEmail(email)||typeof token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(token)
   ||typeof password!=='string'||password.length<12||password.length>1024)
   throw new Error('Invalid or expired recovery token');
  const hash=await this.auth.hashPassword(password,tenantId);
  await this.db.transaction(async client=>{
   // Match password-change lock order before consuming any of this user's challenges.
   await client.query('SELECT id FROM md_users WHERE tenant_id=$1 AND lower(email)=lower($2) AND enabled=true FOR UPDATE',[tenantId,email]);
   const {rows}=await client.query<{id:string;user_id:string;password_hash:string}>(`
    SELECT c.id,c.user_id,u.password_hash FROM md_password_reset_challenges c
    JOIN md_users u ON u.tenant_id=c.tenant_id AND u.id=c.user_id
    WHERE c.tenant_id=$1 AND c.token_hash=$2 AND lower(u.email)=lower($3)
      AND c.consumed_at IS NULL AND c.expires_at>now() AND u.enabled=true
      AND (c.otp_length IS NULL OR c.verified_at IS NOT NULL)
    FOR UPDATE OF c,u`,[tenantId,digest(token),email]);
   const challenge=rows[0];
   if(!challenge)throw new Error('Invalid or expired recovery token');
   const policy=await checkPasswordHistory(client,tenantId,challenge.user_id,password,
    challenge.password_hash,this.auth.verifyPassword.bind(this.auth));
   await retainPasswordHistory(client,tenantId,challenge.user_id,challenge.password_hash,policy.history_count);
   await client.query(`UPDATE md_users SET password_hash=$3,password_changed_at=now(),
    failed_login_attempts=0 WHERE tenant_id=$1 AND id=$2`,[tenantId,challenge.user_id,hash]);
   for(const table of ['md_sessions','md_refresh_sessions'])
    await client.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
     [tenantId,challenge.user_id]);
   await client.query('UPDATE md_password_reset_challenges SET consumed_at=now() WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL',
    [tenantId,challenge.user_id]);
   await client.query('UPDATE md_mfa_login_challenges SET consumed_at=now() WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL',
    [tenantId,challenge.user_id]);
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action)
    VALUES($1,$2,$2,$3)`,[tenantId,challenge.user_id,'PasswordResetCompleted']);
  });
  return {message:'Password changed. Sign in again.'};
 }
}
