import {createHash,randomBytes} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import {TillPinService} from './till-pin-service.js';

const hashKey=(key:string)=>createHash('sha256').update(key).digest('hex');
const validKey=(key:unknown):key is string=>typeof key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(key);
/** A saved sign-in lasts this long; then the person signs in with email again. */
const DEVICE_DAYS=30;
/** Wrong PINs on one saved sign-in before it is removed. */
const MAX_FAILURES=5;
export const TILL_DEVICE_EXPIRED='Saved sign-in has expired. Sign in with your email.';

/**
 * Shared-till sign-in. After a full email sign-in the device keeps a random key for that
 * person (only its hash is stored here). The key plus the person's PIN gives that person
 * their own session. The PIN alone works nowhere, and the device never holds a password.
 * A key ends on: removal, 5 wrong PINs, 30 days, a password change, or the user being disabled.
 */
export class TillDeviceService {
 constructor(private readonly db:SqlPersistence,private readonly auth:AuthenticationService){}
 async enroll(tenantId:string,userId:string,mfaVerified:boolean):Promise<{key:string;userId:string;name:string;expiresAt:string}>{
  const key=randomBytes(32).toString('base64url');
  const {rows}=await this.db.query<{display_name:string|null;email:string;expires_at:Date}>(`
   WITH saved AS (
    INSERT INTO md_till_devices(tenant_id,user_id,token_hash,mfa_verified,expires_at)
    VALUES($1,$2,$3,$4,now()+($5::integer * interval '1 day')) RETURNING tenant_id,user_id,expires_at)
   SELECT u.display_name,u.email,s.expires_at FROM saved s JOIN md_users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id`,
  [tenantId,userId,hashKey(key),mfaVerified,DEVICE_DAYS]);
  if(!rows[0])throw Error('Invalid credentials');
  // Keep at most 20 live saved sign-ins per person (oldest go first).
  await this.db.query(`UPDATE md_till_devices SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL
   AND id NOT IN (SELECT id FROM md_till_devices WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 20)`,
  [tenantId,userId]);
  return {key,userId,name:rows[0].display_name||rows[0].email.split('@')[0],expiresAt:new Date(rows[0].expires_at).toISOString()};
 }
 async unlock(key:unknown,pin:unknown,context:{ip?:string}={}){
  if(!validKey(key))throw Error(TILL_DEVICE_EXPIRED);
  const {rows}=await this.db.query<{id:string;tenant_id:string;user_id:string;mfa_verified:boolean;failures:number;stale:boolean}>(`
   SELECT d.id,d.tenant_id,d.user_id,d.mfa_verified,d.failures,
    (u.password_changed_at IS NOT NULL AND u.password_changed_at>d.created_at) AS stale
   FROM md_till_devices d JOIN md_users u ON u.tenant_id=d.tenant_id AND u.id=d.user_id AND u.enabled=true
   WHERE d.token_hash=$1 AND d.revoked_at IS NULL AND d.expires_at>now()`,[hashKey(key)]);
  const device=rows[0];
  if(!device)throw Error(TILL_DEVICE_EXPIRED);
  if(device.stale){await this.revokeId(device.id);throw Error(TILL_DEVICE_EXPIRED);}
  const verified=await new TillPinService(this.db).verify(device.tenant_id,device.user_id,pin);
  if(!verified){
   const {rows:after}=await this.db.query<{failures:number}>(`UPDATE md_till_devices SET failures=failures+1,
     revoked_at=CASE WHEN failures+1>=$2 THEN now() ELSE NULL END WHERE id=$1 RETURNING failures`,[device.id,MAX_FAILURES]);
   if((after[0]?.failures??MAX_FAILURES)>=MAX_FAILURES)throw Error(TILL_DEVICE_EXPIRED);
   throw Error('Wrong PIN');
  }
  await this.db.query('UPDATE md_till_devices SET failures=0,last_used_at=now() WHERE id=$1',[device.id]);
  return this.auth.issueTrustedDeviceSession(device.tenant_id,device.user_id,device.mfa_verified,context);
 }
 /** Remove one saved sign-in (the × on the lock screen). Unknown keys are ignored. */
 async revoke(key:unknown){
  if(!validKey(key))return;
  await this.db.query('UPDATE md_till_devices SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[hashKey(key)]);
 }
 /** Remove a person from every till (manager action or the person themself). */
 async revokeUser(tenantId:string,userId:string){
  const {rowCount}=await this.db.query('UPDATE md_till_devices SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,userId]);
  return rowCount??0;
 }
 private async revokeId(id:string){
  await this.db.query('UPDATE md_till_devices SET revoked_at=now() WHERE id=$1',[id]);
 }
}

export const TILL_DEVICE_DDL=`-- Shared-till saved sign-ins: only the hash of each device key is stored.
CREATE TABLE IF NOT EXISTS md_till_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 user_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE,
 mfa_verified boolean NOT NULL DEFAULT false,
 failures integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_till_devices_user ON md_till_devices(tenant_id,user_id) WHERE revoked_at IS NULL;
`;
