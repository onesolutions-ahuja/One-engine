import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
const scrypt=promisify(scryptCallback);
const validPin=(pin:unknown):pin is string=>typeof pin==='string'&&/^[0-9]{4,8}$/.test(pin);

/** Generic authenticated-user till PIN capability. No plaintext PIN is returned or stored. */
export class TillPinService {
 constructor(private readonly db:SqlPersistence){}
 async set(tenantId:string,userId:string,pin:unknown){
  if(!validPin(pin))throw Error('PIN must contain 4 to 8 digits');
  const salt=randomBytes(16).toString('hex');
  const digest=await scrypt(pin,salt,64) as Buffer;
  await this.db.query(`UPDATE md_users SET till_pin_hash=$3,till_pin_failures=0,till_pin_locked_until=NULL
    WHERE tenant_id=$1 AND id=$2 AND enabled=true`,[tenantId,userId,`scrypt:${salt}:${digest.toString('hex')}`]);
 }
 /** Verifies a user's PIN against its scrypt hash; the hash is never decrypted or returned.
  * actorUserId is who asked (e.g. a cashier requesting a manager override). */
 async verify(tenantId:string,userId:string,pin:unknown,actorUserId:string=userId):Promise<boolean>{
  // All checks and counters are serialized per user; lockout survives reloads.
  return this.db.transaction(async client=>{
   const {rows}=await client.query<{till_pin_hash:string|null;till_pin_failures:number;till_pin_locked_until:Date|null}>(
    'SELECT till_pin_hash,till_pin_failures,till_pin_locked_until FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true FOR UPDATE',
    [tenantId,userId]);
   const user=rows[0];
   if(!user||user.till_pin_locked_until&&new Date(user.till_pin_locked_until).getTime()>Date.now())return false;
   let verified=false;
   const match=/^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(user.till_pin_hash??'');
   if(match&&validPin(pin)){
    const hash=await scrypt(pin,match[1],64) as Buffer;
    verified=timingSafeEqual(hash,Buffer.from(match[2],'hex'));
   }
   const failed=verified?0:(user.till_pin_failures??0)+1;
   await client.query(`UPDATE md_users SET till_pin_failures=$3,
    till_pin_locked_until=CASE WHEN $3>=5 THEN now()+interval '15 minutes' ELSE NULL END
    WHERE tenant_id=$1 AND id=$2`,[tenantId,userId,failed]);
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action) VALUES($1,$2,$3,$4)`,
    [tenantId,actorUserId,userId,verified?'TillPinVerified':'TillPinRejected']);
   return verified;
  });
 }
}
