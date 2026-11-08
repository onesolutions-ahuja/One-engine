import {randomBytes} from 'node:crypto';
import type {RegistrationResponseJSON,AuthenticationResponseJSON} from '@simplewebauthn/server';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import {hashMfaValue} from './mfa-backup-service.js';
import type {LoginContext} from './session-policy-service.js';
/** Passkeys are a second factor on the same password/federation challenge, never a parallel session engine. */
export class WebAuthnService{
 constructor(private readonly db:SqlPersistence,private readonly auth:AuthenticationService){}
 private async origin(tenant:string,raw:unknown){
  if(typeof raw!=='string')throw Error('Invalid WebAuthn origin');
  const url=new URL(raw);
  if(url.origin!==raw||url.protocol!=='https:')throw Error('Invalid WebAuthn origin');
  const found=await this.db.query('SELECT tenant_id FROM md_tenant_domains WHERE tenant_id=$1 AND domain=$2',[tenant,url.hostname]);
  if(!found.rows[0])throw Error('Invalid WebAuthn origin');
  return {origin:raw,rpID:url.hostname};
 }
 private async challenge(tenant:string,user:string,purpose:string,challenge:string,origin:string,rp:string,mfa?:string){
  const token=randomBytes(32).toString('base64url');
  await this.db.query(`INSERT INTO md_webauthn_challenges(token_hash,tenant_id,user_id,purpose,challenge,origin,rp_id,mfa_challenge_hash)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[hashMfaValue(token),tenant,user,purpose,challenge,origin,rp,mfa??null]);
  return token;
 }
 async registrationOptions(tenant:string,user:string,rawOrigin:unknown,password:unknown){
  if(typeof password!=='string')throw Error('Invalid credentials');
  await this.auth.verifyCurrentPassword(tenant,user,password);
  const {origin,rpID}=await this.origin(tenant,rawOrigin);
  const credentials=await this.db.query<{credential_id:string}>('SELECT credential_id FROM md_webauthn_credentials WHERE tenant_id=$1 AND user_id=$2',[tenant,user]);
  const {generateRegistrationOptions}=await import('@simplewebauthn/server');
  const options=await generateRegistrationOptions({rpName:'MetaDrive',rpID,userID:new TextEncoder().encode(user),userName:user,
   attestationType:'none',authenticatorSelection:{residentKey:'preferred',userVerification:'required'},
   excludeCredentials:credentials.rows.map(c=>({id:c.credential_id}))});
  return {options,token:await this.challenge(tenant,user,'register',options.challenge,origin,rpID)};
 }
 async register(tenant:string,user:string,token:unknown,response:RegistrationResponseJSON,label:unknown){
  if(typeof token!=='string'||typeof label!=='string'||!label.trim()||label.length>100)throw Error('Invalid passkey registration');
  await this.db.transaction(async c=>{
   const challenge=await c.query<{challenge:string;origin:string;rp_id:string}>(`UPDATE md_webauthn_challenges SET consumed_at=now()
    WHERE token_hash=$1 AND tenant_id=$2 AND user_id=$3 AND purpose='register' AND consumed_at IS NULL AND expires_at>now() RETURNING challenge,origin,rp_id`,[hashMfaValue(token),tenant,user]);
   const value=challenge.rows[0];if(!value)throw Error('Invalid passkey challenge');
   const {verifyRegistrationResponse}=await import('@simplewebauthn/server');
   const verified=await verifyRegistrationResponse({response,expectedChallenge:value.challenge,expectedOrigin:value.origin,expectedRPID:value.rp_id,requireUserVerification:true})
    .catch(()=>{throw Error('Invalid passkey response: origin, challenge or signature rejected');});
   if(!verified.verified||!verified.registrationInfo)throw Error('Invalid passkey response');
   const credential=verified.registrationInfo.credential;
   await c.query(`INSERT INTO md_webauthn_credentials(tenant_id,user_id,credential_id,public_key,counter,label)
    VALUES($1,$2,$3,$4,$5,$6)`,[tenant,user,credential.id,Buffer.from(credential.publicKey),credential.counter,label.trim()]);
   await c.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'PasskeyRegistered')",[tenant,user]);
  });return {registered:true};
 }
 async authenticationOptions(mfaToken:unknown,rawOrigin:unknown){
  if(typeof mfaToken!=='string')throw Error('Invalid MFA challenge');
  const {rows}=await this.db.query<{tenant_id:string;user_id:string}>(`SELECT tenant_id,user_id FROM md_mfa_login_challenges
   WHERE challenge_hash=$1 AND consumed_at IS NULL AND expires_at>now() AND failed_attempts<5`,[hashMfaValue(mfaToken)]);
  const identity=rows[0];if(!identity)throw Error('Invalid MFA challenge');
  const {origin,rpID}=await this.origin(identity.tenant_id,rawOrigin);
  const credentials=await this.db.query<{credential_id:string}>('SELECT credential_id FROM md_webauthn_credentials WHERE tenant_id=$1 AND user_id=$2',[identity.tenant_id,identity.user_id]);
  if(!credentials.rows.length)throw Error('Invalid passkey: no registered credentials');
  const {generateAuthenticationOptions}=await import('@simplewebauthn/server');
  const options=await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:credentials.rows.map(c=>({id:c.credential_id}))});
  return {options,token:await this.challenge(identity.tenant_id,identity.user_id,'authenticate',options.challenge,origin,rpID,hashMfaValue(mfaToken))};
 }
 async authenticate(token:unknown,response:AuthenticationResponseJSON,context:LoginContext={}){
  if(typeof token!=='string'||!response||typeof response.id!=='string')throw Error('Invalid passkey response');
  const identity=await this.db.transaction(async c=>{
   const {rows}=await c.query<{tenant_id:string;user_id:string;challenge:string;origin:string;rp_id:string;mfa_challenge_hash:string}>(`SELECT tenant_id,user_id,challenge,origin,rp_id,mfa_challenge_hash
    FROM md_webauthn_challenges WHERE token_hash=$1 AND purpose='authenticate' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,[hashMfaValue(token)]);
   const v=rows[0];if(!v)throw Error('Invalid passkey challenge');
   // Consume the parent challenge atomically too: sibling TOTP/backup/passkey submissions cannot both succeed.
   const parent=await c.query(`UPDATE md_mfa_login_challenges SET consumed_at=now() WHERE challenge_hash=$1
    AND consumed_at IS NULL AND expires_at>now() AND failed_attempts<5 RETURNING id`,[v.mfa_challenge_hash]);
   if(!parent.rows[0])throw Error('Invalid MFA challenge');
   const credential=await c.query<{public_key:Buffer;counter:string}>(`SELECT public_key,counter FROM md_webauthn_credentials
    WHERE tenant_id=$1 AND user_id=$2 AND credential_id=$3 FOR UPDATE`,[v.tenant_id,v.user_id,response.id]);
   const stored=credential.rows[0];if(!stored)throw Error('Invalid passkey credential');
   const {verifyAuthenticationResponse}=await import('@simplewebauthn/server');
   const result=await verifyAuthenticationResponse({response,expectedChallenge:v.challenge,expectedOrigin:v.origin,expectedRPID:v.rp_id,
    credential:{id:response.id,publicKey:new Uint8Array(stored.public_key),counter:Number(stored.counter)},requireUserVerification:true})
    .catch(()=>{throw Error('Invalid passkey response: origin, challenge or signature rejected');});
   if(!result.verified)throw Error('Invalid passkey response');
   await c.query('UPDATE md_webauthn_credentials SET counter=$4 WHERE tenant_id=$1 AND user_id=$2 AND credential_id=$3',[v.tenant_id,v.user_id,response.id,result.authenticationInfo.newCounter]);
   await c.query('UPDATE md_webauthn_challenges SET consumed_at=now() WHERE token_hash=$1',[hashMfaValue(token)]);
   return v;
  });return this.auth.issueMfaSession(identity.tenant_id,identity.user_id,context);
 }
 async list(tenant:string,user:string){return (await this.db.query('SELECT credential_id,label,created_at FROM md_webauthn_credentials WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at',[tenant,user])).rows;}
 async remove(tenant:string,user:string,id:string,password:unknown){
  if(typeof password!=='string')throw Error('Invalid credentials');await this.auth.verifyCurrentPassword(tenant,user,password);
  await this.db.transaction(async c=>{
   await c.query('DELETE FROM md_webauthn_credentials WHERE tenant_id=$1 AND user_id=$2 AND credential_id=$3',[tenant,user,id]);
   for(const table of ['md_sessions','md_refresh_sessions'])await c.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[tenant,user]);
   await c.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'PasskeyRemoved')",[tenant,user]);
  });return {removed:true};
 }
}
