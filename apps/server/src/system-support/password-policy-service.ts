import {z} from 'zod';
import type {SqlExecutor,SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {isPlatformRecoveryMailConfigured} from './platform-recovery-mailer.js';

export const passwordPolicySchema=z.object({
 min_length:z.number().int().min(12).max(128).default(12),
 require_uppercase:z.boolean().default(false),require_lowercase:z.boolean().default(false),
 require_number:z.boolean().default(false),require_symbol:z.boolean().default(false),
 max_age_days:z.number().int().min(0).max(365).default(0),
 history_count:z.number().int().min(0).max(24).default(5),
 max_failed_attempts:z.number().int().min(3).max(20).default(5),
 lockout_minutes:z.number().int().min(1).max(1440).default(15)
}).strict();
export type PasswordPolicy=z.infer<typeof passwordPolicySchema>;
export async function readPasswordPolicy(db:SqlExecutor,tenantId:string):Promise<PasswordPolicy>{
 const {rows}=await db.query('SELECT min_length,require_uppercase,require_lowercase,require_number,require_symbol,max_age_days,history_count,max_failed_attempts,lockout_minutes FROM md_password_policies WHERE tenant_id=$1',[tenantId]);
 return passwordPolicySchema.parse(rows[0]??{});
}
export function validatePassword(password:string,policy:PasswordPolicy){
 if(password.length<policy.min_length||password.length>1024)
  throw new Error(`Invalid password: length must be ${policy.min_length} to 1024 characters`);
 for(const [required,pattern,label] of [
  [policy.require_uppercase,/[A-Z]/,'uppercase letter'],[policy.require_lowercase,/[a-z]/,'lowercase letter'],
  [policy.require_number,/[0-9]/,'number'],[policy.require_symbol,/[^A-Za-z0-9\s]/,'symbol']
 ] as const)if(required&&!pattern.test(password))throw new Error(`Invalid password: requires a ${label}`);
}
/** Called while the user's row is locked, by change and recovery alike. */
export async function checkPasswordHistory(db:SqlExecutor,tenantId:string,userId:string,password:string,
 currentHash:string,verify:(password:string,hash:string)=>Promise<boolean>){
 const policy=await readPasswordPolicy(db,tenantId);
 validatePassword(password,policy);
 if(await verify(password,currentHash))throw new Error('Invalid password: recently used');
 const {rows}=await db.query<{password_hash:string}>(
  'SELECT password_hash FROM md_password_history WHERE tenant_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT $3',
  [tenantId,userId,policy.history_count]);
 for(const row of rows)if(await verify(password,row.password_hash))throw new Error('Invalid password: recently used');
 return policy;
}
export async function retainPasswordHistory(db:SqlExecutor,tenantId:string,userId:string,hash:string,count:number){
 await db.query('INSERT INTO md_password_history(tenant_id,user_id,password_hash) VALUES($1,$2,$3)',[tenantId,userId,hash]);
 await db.query(`DELETE FROM md_password_history WHERE tenant_id=$1 AND user_id=$2 AND id NOT IN
  (SELECT id FROM md_password_history WHERE tenant_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT $3)`,[tenantId,userId,count]);
}
export class PasswordPolicyService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async read(tenantId:string,userId:string){
  await this.rbac.require(tenantId,userId,'Security','read');
  return readPasswordPolicy(this.db,tenantId);
 }
 async save(tenantId:string,userId:string,input:unknown){
  await this.rbac.require(tenantId,userId,'Security','manage');
  const parsed=passwordPolicySchema.safeParse(input);
  if(!parsed.success)throw new Error('Invalid password policy');
  const p=parsed.data;
  await this.db.transaction(async client=>{
   if(p.max_age_days>0&&!isPlatformRecoveryMailConfigured())
    throw new Error('Invalid expiry policy: platform SMTP recovery delivery is not configured');
   await client.query(`INSERT INTO md_password_policies(tenant_id,min_length,require_uppercase,require_lowercase,
    require_number,require_symbol,max_age_days,history_count,max_failed_attempts,lockout_minutes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id) DO UPDATE SET
    min_length=$2,require_uppercase=$3,require_lowercase=$4,require_number=$5,require_symbol=$6,
    max_age_days=$7,history_count=$8,max_failed_attempts=$9,lockout_minutes=$10,updated_at=now()`,
    [tenantId,p.min_length,p.require_uppercase,p.require_lowercase,p.require_number,p.require_symbol,
     p.max_age_days,p.history_count,p.max_failed_attempts,p.lockout_minutes]);
   await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'PasswordPolicyUpdated')",[tenantId,userId]);
  });
  return p;
 }
}
