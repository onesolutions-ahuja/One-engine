import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import type {MfaService} from './mfa-service.js';

/** One-time activation for a pre-seeded disabled tenant-scoped identity. */
export class TenantDeveloperService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly auth:AuthenticationService,private readonly mfa:MfaService){}
 async status(tenant:string,actor:string){
  await this.rbac.require(tenant,actor,'Security','read');
  const {rows}=await this.db.query<{
   user_id:string;email:string;enabled:boolean;activated_at:Date|null
  }>(`SELECT a.user_id,u.email,u.enabled,a.activated_at
     FROM md_tenant_developer_accounts a JOIN md_users u
       ON u.tenant_id=a.tenant_id AND u.id=a.user_id
     WHERE a.tenant_id=$1`,[tenant]);
  const existing=rows[0];
  if(!existing)return {seeded:false,tenantControlled:true};
  return {seeded:true,userId:existing.user_id,email:existing.email,
   active:existing.enabled,activated:existing.activated_at!==null,
   initialPermissions:'OneEngine',tenantControlled:true};
 }
 async activate(tenant:string,actor:string,body:unknown){
  await this.rbac.require(tenant,actor,'Security','manage');
  if(!body||typeof body!=='object'||Array.isArray(body))
   throw Error('Invalid developer activation');
  const value=body as Record<string,unknown>;
  if(typeof value.password!=='string'||value.password.length<12||
     value.password.length>256||typeof value.mfaCode!=='string'||
     !/^[0-9]{6}$/.test(value.mfaCode))
   throw Error('A strong password and fresh authenticator code are required');
  // The replay counter is consumed in SQL before any privileged identity change.
  await this.mfa.verifyFresh(tenant,actor,value.mfaCode);
  const hash=await this.auth.hashPassword(value.password,tenant);
  await this.db.transaction(async client=>{
   const {rows}=await client.query<{
    user_id:string;activated_at:Date|null;enabled:boolean
   }>(`SELECT a.user_id,a.activated_at,u.enabled
     FROM md_tenant_developer_accounts a
     JOIN md_users u ON u.tenant_id=a.tenant_id AND u.id=a.user_id
     WHERE a.tenant_id=$1 FOR UPDATE OF a,u`,[tenant]);
   const account=rows[0];
   if(!account)throw Error('Tenant developer was not seeded');
   if(account.activated_at||account.enabled)throw Error('Developer account was already activated');
   if(account.user_id===actor)throw Error('Cannot activate own developer identity');
   await client.query('UPDATE md_users SET password_hash=$3,password_changed_at=now(),enabled=true WHERE tenant_id=$1 AND id=$2',
     [tenant,account.user_id,hash]);
   await client.query(`UPDATE md_tenant_developer_accounts
     SET activated_at=now(),activated_by=$2 WHERE tenant_id=$1`,[tenant,actor]);
   await client.query('INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action) VALUES($1,$2,$3,$4)',
    [tenant,actor,account.user_id,'TenantDeveloperActivated']);
  });
  return {activated:true};
 }
}
