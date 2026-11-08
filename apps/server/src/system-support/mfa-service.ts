import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import type {NamedCredentialService} from './named-credential-service.js';
import {consumeBackupCode} from './mfa-backup-service.js';
import {enforceLoginBoundary,readSessionPolicy,type LoginContext} from './session-policy-service.js';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes:Buffer):string{
 let value=0,bits=0,out='';
 for(const byte of bytes){
  value=(value<<8)|byte;bits+=8;
  while(bits>=5){out+=alphabet[(value>>>(bits-=5))&31];}
 }
 if(bits>0)out+=alphabet[(value<<(5-bits))&31];
 return out;
}
export function totpAt(secret:string,counter:number):string{
 if(!Number.isSafeInteger(counter)||counter<0)throw new Error('Invalid TOTP counter');
 let value=0,bits=0;const decoded:number[]=[];
 for(const character of secret.replace(/=+$/,'')){
  const n=alphabet.indexOf(character.toUpperCase());if(n<0)throw new Error('Invalid authenticator secret');
  value=(value<<5)|n;bits+=5;
  if(bits>=8){decoded.push((value>>>(bits-=8))&255);}
 }
 const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(counter));
 const hmac=createHmac('sha1',Buffer.from(decoded)).update(msg).digest();
 const offset=hmac[hmac.length-1]&15;
 const code=(hmac.readUInt32BE(offset)&0x7fffffff)%1000000;
 return String(code).padStart(6,'0');
}
function acceptableCounter(secret:string,code:unknown,last=-1,now=Date.now()):number|null{
 if(typeof code!=='string'||!/^[0-9]{6}$/.test(code))return null;
 const current=Math.floor(now/30000);
 for(const counter of [current,current-1,current+1]){
  if(counter>last&&counter>=0&&totpAt(secret,counter)===code)return counter;
 }
 return null;
}

/** Tenant-scoped authenticator enforcement and single-use login challenges. */
export class MfaService {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly auth:AuthenticationService,private readonly vault:NamedCredentialService){}
 private async mode(tenantId:string){
  const {rows}=await this.db.query<{mode:'Off'|'Optional'|'Required'}>(
   'SELECT mode FROM md_tenant_mfa_policies WHERE tenant_id=$1',[tenantId]);
  return rows[0]?.mode??'Off';
 }
 async status(tenantId:string,userId:string){
  const {rows}=await this.db.query<{enrolled:boolean}>(`
    SELECT EXISTS(SELECT 1 FROM md_user_mfa_secrets
      WHERE tenant_id=$1 AND user_id=$2) OR EXISTS(SELECT 1 FROM md_webauthn_credentials WHERE tenant_id=$1 AND user_id=$2) AS enrolled`,[tenantId,userId]);
  return {mode:await this.mode(tenantId),enrolled:rows[0]?.enrolled===true};
 }
 async policy(tenantId:string,userId:string){
  await this.rbac.require(tenantId,userId,'Security','manage');
  return {mode:await this.mode(tenantId)};
 }
 async setPolicy(tenantId:string,userId:string,mode:unknown){
  await this.rbac.require(tenantId,userId,'Security','manage');
  if(!['Off','Optional','Required'].includes(String(mode)))throw new Error('Invalid MFA policy');
  if(mode==='Required')this.vault.encryptOpaque('mfa-ready');
  await this.db.transaction(async client=>{
   await client.query(`INSERT INTO md_tenant_mfa_policies(tenant_id,mode)
     VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET mode=$2,updated_at=now()`,
     [tenantId,mode]);
   await client.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,$3)',
     [tenantId,userId,'MfaPolicyUpdated']);
  });
  return {mode};
 }
 async enroll(tenantId:string,userId:string,password:unknown){
  if(typeof password!=='string')throw new Error('Invalid credentials');
  await this.auth.verifyCurrentPassword(tenantId,userId,password);
  const secret=base32(randomBytes(20)),token=randomBytes(32).toString('base64url');
  const cipher=this.vault.encryptOpaque(secret);
  await this.db.query(`INSERT INTO md_mfa_enrollment_tokens
    (tenant_id,user_id,token_hash,secret_ciphertext,key_id,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')
    ON CONFLICT(tenant_id,user_id) DO UPDATE
    SET token_hash=$3,secret_ciphertext=$4,key_id=$5,failed_attempts=0,expires_at=now()+interval '10 minutes',created_at=now()`,
    [tenantId,userId,digest(token),cipher.ciphertext,cipher.keyId]);
  return {enrollment_token:token,setup_secret:secret};
 }
 async confirmEnrollment(tenantId:string,userId:string,token:unknown,code:unknown){
  if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(token))
   throw new Error('Invalid MFA enrollment');
  const valid=await this.db.transaction(async client=>{
   const {rows}=await client.query<{secret_ciphertext:Buffer;key_id:string}>(
    `SELECT secret_ciphertext,key_id FROM md_mfa_enrollment_tokens
     WHERE tenant_id=$1 AND user_id=$2 AND token_hash=$3 AND expires_at>now() AND failed_attempts<5 FOR UPDATE`,
    [tenantId,userId,digest(token)]);
   if(!rows[0])throw new Error('Invalid MFA enrollment');
   const secret=this.vault.decryptOpaque(rows[0].secret_ciphertext,rows[0].key_id);
   const counter=acceptableCounter(secret,code);
   if(counter===null){
    await client.query('UPDATE md_mfa_enrollment_tokens SET failed_attempts=failed_attempts+1 WHERE tenant_id=$1 AND user_id=$2',
      [tenantId,userId]);
    return false;
   }
   await client.query(`INSERT INTO md_user_mfa_secrets(tenant_id,user_id,secret_ciphertext,key_id,last_counter)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,user_id)
    DO UPDATE SET secret_ciphertext=$3,key_id=$4,last_counter=$5,enrolled_at=now()`,
    [tenantId,userId,rows[0].secret_ciphertext,rows[0].key_id,counter]);
   await client.query('DELETE FROM md_mfa_enrollment_tokens WHERE tenant_id=$1 AND user_id=$2',
    [tenantId,userId]);
   await client.query('DELETE FROM md_mfa_backup_codes WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
   for(const table of ['md_sessions','md_refresh_sessions'])await client.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
   await client.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,$3)',
    [tenantId,userId,'MfaEnrolled']);
   return true;
  });
  if(!valid)throw new Error('Invalid authenticator code');
  return {enrolled:true};
 }
 /** Replay-resistant authenticator verification for privileged tenant actions. */
 async verifyFresh(tenantId:string,userId:string,code:unknown):Promise<void>{
  await this.db.transaction(async client=>{
   const {rows}=await client.query<{
    secret_ciphertext:Buffer;key_id:string;last_counter:number
   }>('SELECT secret_ciphertext,key_id,last_counter FROM md_user_mfa_secrets WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',
    [tenantId,userId]);
   const stored=rows[0];
   if(!stored)throw new Error('MFA enrollment required for privileged operation');
   const secret=this.vault.decryptOpaque(stored.secret_ciphertext,stored.key_id);
   const counter=acceptableCounter(secret,code,Number(stored.last_counter));
   if(counter===null)throw new Error('Invalid or previously used authenticator code');
   await client.query('UPDATE md_user_mfa_secrets SET last_counter=$3 WHERE tenant_id=$1 AND user_id=$2',
    [tenantId,userId,counter]);
  });
 }
 async disable(tenantId:string,userId:string,password:unknown,code:unknown){
  if(await this.mode(tenantId)==='Required'||(await readSessionPolicy(this.db,tenantId)).require_mfa)throw new Error('MFA required by tenant policy');
  if(typeof password!=='string')throw new Error('Invalid credentials');
  await this.auth.verifyCurrentPassword(tenantId,userId,password);
  await this.db.transaction(async client=>{
   const {rows}=await client.query<{secret_ciphertext:Buffer;key_id:string;last_counter:number}>(
    'SELECT secret_ciphertext,key_id,last_counter FROM md_user_mfa_secrets WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',
    [tenantId,userId]);
   if(!rows[0])throw new Error('MFA is not enrolled');
   const secret=this.vault.decryptOpaque(rows[0].secret_ciphertext,rows[0].key_id);
   if(acceptableCounter(secret,code,Number(rows[0].last_counter))===null)
    throw new Error('Invalid authenticator code');
   await client.query('DELETE FROM md_user_mfa_secrets WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
   await client.query('DELETE FROM md_mfa_backup_codes WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
   for(const table of ['md_sessions','md_refresh_sessions'])await client.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
   await client.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,$3)',
    [tenantId,userId,'MfaDisabled']);
  });
  return {enrolled:false};
 }
 async createChallenge(tenantId:string,userId:string,context:LoginContext={}){
  await enforceLoginBoundary(this.db,tenantId,userId,context);
  const mode=(await readSessionPolicy(this.db,tenantId)).require_mfa?'Required':await this.mode(tenantId);
  if(mode==='Off')return null;
  const {rows:enrollment}=await this.db.query<{enrolled:boolean}>(`
    SELECT EXISTS(SELECT 1 FROM md_user_mfa_secrets WHERE tenant_id=$1 AND user_id=$2)
     OR EXISTS(SELECT 1 FROM md_webauthn_credentials WHERE tenant_id=$1 AND user_id=$2) AS enrolled`,
    [tenantId,userId]);
  const enrolled=enrollment[0]?.enrolled===true;
  if(!enrolled&&mode==='Optional')return null;
  const token=randomBytes(32).toString('base64url');
  const secret=enrolled?null:base32(randomBytes(20));
  const encrypted=secret?this.vault.encryptOpaque(secret):null;
  await this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenantId+':mfa:'+userId]);
   const {rows}=await client.query<{n:string}>(`
    SELECT count(*)::text AS n FROM md_mfa_login_challenges
    WHERE tenant_id=$1 AND user_id=$2 AND created_at>now()-interval '15 minutes'`,
    [tenantId,userId]);
   if(Number(rows[0]?.n??0)>=6)throw new Error('Too many MFA challenges');
   await client.query(`INSERT INTO md_mfa_login_challenges
    (tenant_id,user_id,challenge_hash,enrollment_secret_ciphertext,key_id,expires_at,source_ip)
    VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes',$6::inet)`,
    [tenantId,userId,digest(token),encrypted?.ciphertext??null,encrypted?.keyId??null,context.ip??null]);
  });
  return {mfa_required:true,challenge_token:token,enrollment_required:!enrolled,
    ...(secret?{setup_secret:secret}:{})};
 }
 async verifyChallenge(token:unknown,code:unknown,context:LoginContext={}){
  if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(token))
   throw new Error('Invalid MFA challenge');
  const identity=await this.db.transaction(async client=>{
   const {rows}=await client.query<{
    id:string;tenant_id:string;user_id:string;
    enrollment_secret_ciphertext:Buffer|null;key_id:string|null
   }>(`SELECT id,tenant_id,user_id,enrollment_secret_ciphertext,key_id
      FROM md_mfa_login_challenges
      WHERE challenge_hash=$1 AND consumed_at IS NULL AND expires_at>now() AND failed_attempts<5 FOR UPDATE`,
      [digest(token)]);
   const challenge=rows[0];
   if(!challenge)throw new Error('Invalid MFA challenge');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[challenge.tenant_id+':mfa:'+challenge.user_id]);
   if(!challenge.enrollment_secret_ciphertext&&await consumeBackupCode(client,challenge.tenant_id,challenge.user_id,code)){
    await client.query('UPDATE md_mfa_login_challenges SET consumed_at=now() WHERE id=$1',[challenge.id]);
    await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'MfaBackupCodeUsed')",[challenge.tenant_id,challenge.user_id]);
    return {tenantId:challenge.tenant_id,userId:challenge.user_id};
   }
   let cipher:Buffer,keyId:string,lastCounter=-1;
   if(challenge.enrollment_secret_ciphertext&&challenge.key_id){
    const enrolled=await client.query('SELECT user_id FROM md_user_mfa_secrets WHERE tenant_id=$1 AND user_id=$2',[challenge.tenant_id,challenge.user_id]);
    if(enrolled.rows[0])throw Error('Invalid MFA enrollment: already enrolled');
    cipher=challenge.enrollment_secret_ciphertext;keyId=challenge.key_id;
   }else{
    const {rows:stored}=await client.query<{secret_ciphertext:Buffer;key_id:string;last_counter:number}>(`
      SELECT secret_ciphertext,key_id,last_counter FROM md_user_mfa_secrets
      WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE`,[challenge.tenant_id,challenge.user_id]);
    if(!stored[0])throw new Error('MFA enrollment unavailable');
    cipher=stored[0].secret_ciphertext;keyId=stored[0].key_id;
    lastCounter=Number(stored[0].last_counter);
   }
   const secret=this.vault.decryptOpaque(cipher,keyId);
   const counter=acceptableCounter(secret,code,lastCounter);
   if(counter===null){
    await client.query('UPDATE md_mfa_login_challenges SET failed_attempts=failed_attempts+1 WHERE id=$1',
      [challenge.id]);
    await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action) VALUES($1,$2,$2,'LoginMfaFailed')",[challenge.tenant_id,challenge.user_id]);
    return null;
   }
   if(challenge.enrollment_secret_ciphertext){
    await client.query(`INSERT INTO md_user_mfa_secrets
      (tenant_id,user_id,secret_ciphertext,key_id,last_counter) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,user_id) DO UPDATE
      SET secret_ciphertext=$3,key_id=$4,last_counter=$5,enrolled_at=now()`,
      [challenge.tenant_id,challenge.user_id,cipher,keyId,counter]);
   }else{
    await client.query('UPDATE md_user_mfa_secrets SET last_counter=$3 WHERE tenant_id=$1 AND user_id=$2',
      [challenge.tenant_id,challenge.user_id,counter]);
   }
   await client.query('UPDATE md_mfa_login_challenges SET consumed_at=now() WHERE id=$1',[challenge.id]);
   return {tenantId:challenge.tenant_id,userId:challenge.user_id};
  });
  if(!identity)throw new Error('Invalid authenticator code');
  return this.auth.issueMfaSession(identity.tenantId,identity.userId,context);
 }
}
