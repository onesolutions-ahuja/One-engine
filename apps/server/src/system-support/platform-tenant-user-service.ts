import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {AuthenticationService} from '../system-files/authentication.js';
import {HUMAN_USER,PlatformTenantService} from '../system-files/platform-tenant-service.js';

/**
 * Cross-tenant user administration for platform operators.
 *
 * Authority: OneEngine held inside the canonical platform tenant
 * (PlatformTenantService.requirePlatform). OneEngine seeded into a customer
 * tenant never reaches these endpoints' data for other tenants.
 *
 * Every change writes a platform-tenant security event; row-level changes are
 * also captured by the setup audit trigger with the platform actor.
 */
type Actor={tenant_id:string;user_id:string};
type Target={id:string;slug:string;platform:boolean};
type UserInput={
 email?:string;name?:string;password?:string;enabled?:boolean;userType?:'internal'|'external';
 unlock?:boolean;entitlementIds?:string[];permissionSetIds?:string[];
};

const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Access-only rows: removing them deletes no business data or audit history. */
const ACCESS_TABLES=['md_sessions','md_refresh_sessions','md_user_roles','md_permission_assignments',
 'md_user_license_assignments','md_password_history','md_bootstrap_password_repairs',
 'md_initial_password_rotations','md_federated_identities','md_federation_tickets','md_oauth_consents'] as const;

function ids(value:unknown,label:string):string[]|undefined{
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>200||!value.every(v=>typeof v==='string'&&UUID.test(v)))
  throw new Error('Invalid '+label);
 return [...new Set(value as string[])];
}
function parseInput(body:unknown,creating:boolean):UserInput{
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid user');
 const x=body as Record<string,unknown>;
 const allowed=['email','name','password','enabled','userType','unlock','entitlementIds','permissionSetIds'];
 if(Object.keys(x).some(k=>!allowed.includes(k)))throw new Error('Invalid user field');
 const out:UserInput={};
 if(x.email!==undefined){
  if(typeof x.email!=='string')throw new Error('Invalid user email');
  const email=x.email.trim().toLowerCase();
  if(!EMAIL.test(email)||email.length>254)throw new Error('Invalid user email');
  out.email=email;
 }else if(creating)throw new Error('Invalid user email');
 if(x.name!==undefined){
  if(typeof x.name!=='string'||x.name.length>200)throw new Error('Invalid user name');
  out.name=x.name.trim();
 }
 if(x.password!==undefined){
  if(typeof x.password!=='string')throw new Error('Invalid password');
  out.password=x.password;
 }else if(creating)throw new Error('Invalid password: an initial password is required');
 if(x.enabled!==undefined){if(typeof x.enabled!=='boolean')throw new Error('Invalid user status');out.enabled=x.enabled;}
 if(x.unlock!==undefined){if(typeof x.unlock!=='boolean')throw new Error('Invalid unlock');out.unlock=x.unlock;}
 if(x.userType!==undefined){
  if(x.userType!=='internal'&&x.userType!=='external')throw new Error('Invalid user type');
  out.userType=x.userType;
 }
 out.entitlementIds=ids(x.entitlementIds,'licence selection');
 out.permissionSetIds=ids(x.permissionSetIds,'permission set selection');
 return out;
}
const isUniqueViolation=(e:unknown)=>(e as {code?:string})?.code==='23505';
const isForeignKeyViolation=(e:unknown)=>(e as {code?:string})?.code==='23503';

export class PlatformTenantUserService{
 private readonly platform:PlatformTenantService;
 private readonly auth:AuthenticationService;
 constructor(private readonly db:SqlPersistence,rbac:RbacEngine){
  this.platform=new PlatformTenantService(db,rbac);
  this.auth=new AuthenticationService(db);
 }
 private async target(actor:Actor,slug:string):Promise<Target>{
  await this.platform.requirePlatform(actor.tenant_id,actor.user_id);
  if(!SLUG.test(slug))throw new Error('Invalid tenant');
  const {rows}=await this.db.query<{id:string;slug:string}>('SELECT id,slug FROM md_tenants WHERE slug=$1',[slug]);
  if(!rows[0])throw new Error('Tenant not found');
  return {...rows[0],platform:rows[0].id===actor.tenant_id};
 }
 private async audit(client:PoolClient,actor:Actor,action:string,target:Target,details:Record<string,unknown>){
  await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
   VALUES($1,$2,$3,$4::jsonb)`,[actor.tenant_id,actor.user_id,action,
   JSON.stringify({targetTenant:target.slug,...details})]);
 }
 private async revokeSessions(client:PoolClient,tenantId:string,userId:string){
  await client.query('UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,userId]);
  await client.query('UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,userId]);
 }
 /** Replace User licences; enforces enabled, unexpired entitlements and seat limits. */
 private async setLicences(client:PoolClient,tenantId:string,userId:string,wanted:string[]){
  const current=(await client.query<{entitlement_id:string}>(`SELECT a.entitlement_id FROM md_user_license_assignments a
   JOIN md_license_entitlements e ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
   WHERE a.tenant_id=$1 AND a.user_id=$2 AND e.kind='User'`,[tenantId,userId])).rows.map(r=>r.entitlement_id);
  for(const id of current.filter(id=>!wanted.includes(id)))
   await client.query('DELETE FROM md_user_license_assignments WHERE tenant_id=$1 AND user_id=$2 AND entitlement_id=$3',[tenantId,userId,id]);
  for(const id of wanted.filter(id=>!current.includes(id))){
   const {rows}=await client.query<{enabled:boolean;active:boolean;seat_limit:number|null;label:string}>(`
    SELECT enabled,(expires_at IS NULL OR expires_at>now()) AS active,seat_limit,label FROM md_license_entitlements
    WHERE tenant_id=$1 AND id=$2 AND kind='User' FOR UPDATE`,[tenantId,id]);
   const e=rows[0];
   if(!e)throw new Error('Licence not found');
   if(!e.enabled||!e.active)throw new Error('Invalid licence: '+e.label+' is disabled or expired');
   const used=await client.query<{used:string}>('SELECT count(*)::text AS used FROM md_user_license_assignments WHERE tenant_id=$1 AND entitlement_id=$2',[tenantId,id]);
   if(e.seat_limit!==null&&Number(used.rows[0]?.used)>=e.seat_limit)
    throw new Error('Invalid licence: no seats left on '+e.label+'. Increase the seat limit first');
   await client.query('INSERT INTO md_user_license_assignments VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenantId,userId,id]);
  }
 }
 /** Replace direct permission-set assignments. */
 private async setPermissionSets(client:PoolClient,tenantId:string,userId:string,wanted:string[]){
  if(wanted.length){
   const {rows}=await client.query<{id:string}>('SELECT id FROM md_permission_sets WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenantId,wanted]);
   if(rows.length!==wanted.length)throw new Error('Permission set not found');
  }
  await client.query('DELETE FROM md_permission_assignments WHERE tenant_id=$1 AND user_id=$2 AND NOT (permission_set_id=ANY($3::uuid[]))',[tenantId,userId,wanted]);
  for(const id of wanted)
   await client.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenantId,userId,id]);
 }
 private async hasOneEngine(client:PoolClient,tenantId:string,ids:string[]){
  const {rows}=await client.query("SELECT 1 FROM md_permission_sets WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND api_name='OneEngine'",[tenantId,ids]);
  return rows.length>0;
 }

 async list(actor:Actor,slug:string,query:Record<string,unknown>={}){
  const target=await this.target(actor,slug);
  const q=typeof query.q==='string'?query.q.trim():'';
  if(q.length>200)throw new Error('Invalid search');
  const search=q?'%'+q.replace(/[%_\\]/g,'\\$&')+'%':null;
  const [users,licences,assignments,permissionSets,permissionAssignments]=await Promise.all([
   this.db.query<{id:string;email:string;display_name:string;enabled:boolean;user_type:string;
    locked:boolean;last_login:Date|null;developer:boolean}>(`
    SELECT u.id,u.email,u.display_name,u.enabled,u.user_type,
     (u.locked_until IS NOT NULL AND u.locked_until>now()) AS locked,
     (SELECT max(s.created_at) FROM md_security_events s WHERE s.tenant_id=u.tenant_id
       AND s.subject_user_id=u.id AND s.action='LoginSucceeded') AS last_login,
     EXISTS(SELECT 1 FROM md_tenant_developer_accounts d WHERE d.tenant_id=u.tenant_id AND d.user_id=u.id) AS developer
    FROM md_users u WHERE u.tenant_id=$1 AND ${HUMAN_USER}
     AND ($2::text IS NULL OR u.email ILIKE $2 OR u.display_name ILIKE $2)
    ORDER BY lower(u.email),u.id LIMIT 500`,[target.id,search]),
   this.db.query<{id:string;label:string;license_key:string;enabled:boolean;active:boolean;seat_limit:number|null;used_seats:number}>(`
    SELECT e.id,e.label,e.license_key,e.enabled,(e.expires_at IS NULL OR e.expires_at>now()) AS active,e.seat_limit,
     (SELECT count(*)::integer FROM md_user_license_assignments a WHERE a.tenant_id=e.tenant_id AND a.entitlement_id=e.id) AS used_seats
    FROM md_license_entitlements e WHERE e.tenant_id=$1 AND e.kind='User' ORDER BY e.label`,[target.id]),
   this.db.query<{user_id:string;entitlement_id:string}>(`SELECT a.user_id,a.entitlement_id FROM md_user_license_assignments a
    JOIN md_license_entitlements e ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
    WHERE a.tenant_id=$1 AND e.kind='User'`,[target.id]),
   this.db.query<{id:string;api_name:string}>('SELECT id,api_name FROM md_permission_sets WHERE tenant_id=$1 ORDER BY api_name LIMIT 1000',[target.id]),
   this.db.query<{user_id:string;permission_set_id:string}>('SELECT user_id,permission_set_id FROM md_permission_assignments WHERE tenant_id=$1',[target.id])
  ]);
  return {
   tenantId:target.slug,
   users:users.rows.map(u=>({
    id:u.id,email:u.email,name:u.display_name,enabled:u.enabled,userType:u.user_type,
    locked:u.locked,lastLoginAt:u.last_login,tenantDeveloper:u.developer,
    licensed:assignments.rows.some(a=>a.user_id===u.id&&licences.rows.some(l=>l.id===a.entitlement_id&&l.enabled&&l.active)),
    entitlementIds:assignments.rows.filter(a=>a.user_id===u.id).map(a=>a.entitlement_id),
    permissionSetIds:permissionAssignments.rows.filter(a=>a.user_id===u.id).map(a=>a.permission_set_id)
   })),
   licences:licences.rows.map(l=>({id:l.id,label:l.label,key:l.license_key,enabled:l.enabled&&l.active,
    seatLimit:l.seat_limit,usedSeats:l.used_seats})),
   permissionSets:permissionSets.rows.map(p=>({id:p.id,apiName:p.api_name}))
  };
 }

 async create(actor:Actor,slug:string,body:unknown){
  const target=await this.target(actor,slug);
  const input=parseInput(body,true);
  const hash=await this.auth.hashPassword(input.password!,target.id);
  try{
   const id=await this.db.transaction(async client=>{
    const {rows}=await client.query<{id:string}>(`INSERT INTO md_users(tenant_id,email,display_name,password_hash,enabled,user_type)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
     [target.id,input.email,input.name??'',hash,input.enabled??true,input.userType??'internal']);
    const userId=rows[0].id;
    const profile=await client.query<{id:string}>("SELECT id FROM md_profiles WHERE tenant_id=$1 AND api_name='Default'",[target.id]);
    if(profile.rows[0])await client.query('INSERT INTO md_user_profiles(tenant_id,user_id,profile_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
     [target.id,userId,profile.rows[0].id]);
    // Auto-assign licences come from the insert trigger; an explicit choice replaces them.
    if(input.entitlementIds)await this.setLicences(client,target.id,userId,input.entitlementIds);
    if(input.permissionSetIds)await this.setPermissionSets(client,target.id,userId,input.permissionSetIds);
    await this.audit(client,actor,'PlatformTenantUserCreated',target,{targetUserId:userId,targetEmail:input.email});
    return userId;
   });
   return this.one(actor,slug,id);
  }catch(error){
   if(isUniqueViolation(error))throw new Error('Duplicate user email: '+input.email+' already exists in this tenant');
   throw error;
  }
 }

 async update(actor:Actor,slug:string,userId:string,body:unknown){
  const target=await this.target(actor,slug);
  if(!UUID.test(userId))throw new Error('Invalid user');
  const input=parseInput(body,false);
  const self=target.platform&&userId===actor.user_id;
  if(self&&input.enabled===false)throw new Error('Invalid self deactivation');
  const hash=input.password!==undefined?await this.auth.hashPassword(input.password,target.id):null;
  try{
   await this.db.transaction(async client=>{
    const {rows}=await client.query<{email:string;enabled:boolean}>(`SELECT u.email,u.enabled FROM md_users u
     WHERE u.tenant_id=$1 AND u.id=$2 AND ${HUMAN_USER} FOR UPDATE`,[target.id,userId]);
    const before=rows[0];
    if(!before)throw new Error('User not found');
    if(self&&input.permissionSetIds&&!(await this.hasOneEngine(client,target.id,input.permissionSetIds)))
     throw new Error('Cannot alter own OneEngine assignment');
    await client.query(`UPDATE md_users SET email=COALESCE($3,email),display_name=COALESCE($4,display_name),
      enabled=COALESCE($5,enabled),user_type=COALESCE($6,user_type),
      password_hash=COALESCE($7,password_hash),
      password_changed_at=CASE WHEN $7::text IS NULL THEN password_changed_at ELSE now() END,
      locked_until=CASE WHEN $8::boolean OR $7::text IS NOT NULL THEN NULL ELSE locked_until END,
      failed_login_attempts=CASE WHEN $8::boolean OR $7::text IS NOT NULL THEN 0 ELSE failed_login_attempts END
     WHERE tenant_id=$1 AND id=$2`,
     [target.id,userId,input.email??null,input.name??null,input.enabled??null,input.userType??null,hash,input.unlock===true]);
    if(input.entitlementIds)await this.setLicences(client,target.id,userId,input.entitlementIds);
    if(input.permissionSetIds)await this.setPermissionSets(client,target.id,userId,input.permissionSetIds);
    // Access changes take effect immediately: existing sessions must sign in again.
    if(input.enabled===false||hash||input.entitlementIds||input.permissionSetIds||input.userType)
     await this.revokeSessions(client,target.id,userId);
    await this.audit(client,actor,'PlatformTenantUserUpdated',target,{
     targetUserId:userId,targetEmail:input.email??before.email,
     changed:Object.keys(input).filter(k=>k!=='password').concat(hash?['password']:[])
    });
   });
  }catch(error){
   if(isUniqueViolation(error))throw new Error('Duplicate user email: '+input.email+' already exists in this tenant');
   throw error;
  }
  return this.one(actor,slug,userId);
 }

 /**
  * Permanently deletes a user who has no history. A user referenced by records,
  * audit trails or other history cannot be removed without losing that data, so
  * they are deactivated instead: access, licences and sessions are removed and
  * they no longer count towards licensed or active users.
  */
 async remove(actor:Actor,slug:string,userId:string){
  const target=await this.target(actor,slug);
  if(!UUID.test(userId))throw new Error('Invalid user');
  if(target.platform&&userId===actor.user_id)throw new Error('Invalid self deactivation');
  return this.db.transaction(async client=>{
   const {rows}=await client.query<{email:string;developer:boolean}>(`SELECT u.email,
     EXISTS(SELECT 1 FROM md_tenant_developer_accounts d WHERE d.tenant_id=u.tenant_id AND d.user_id=u.id) AS developer
    FROM md_users u WHERE u.tenant_id=$1 AND u.id=$2 AND ${HUMAN_USER} FOR UPDATE`,[target.id,userId]);
   const user=rows[0];
   if(!user)throw new Error('User not found');
   let deleted=false;
   if(!user.developer){
    try{
     await this.db.transaction(async inner=>{
      for(const table of ACCESS_TABLES)
       await inner.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND user_id=$2`,[target.id,userId]);
      await inner.query('DELETE FROM md_users WHERE tenant_id=$1 AND id=$2',[target.id,userId]);
     });
     deleted=true;
    }catch(error){
     if(!isForeignKeyViolation(error))throw error;
    }
   }
   if(!deleted){
    await client.query('UPDATE md_users SET enabled=false WHERE tenant_id=$1 AND id=$2',[target.id,userId]);
    await client.query('DELETE FROM md_user_license_assignments WHERE tenant_id=$1 AND user_id=$2',[target.id,userId]);
    await client.query('DELETE FROM md_permission_assignments WHERE tenant_id=$1 AND user_id=$2',[target.id,userId]);
    await client.query('DELETE FROM md_user_roles WHERE tenant_id=$1 AND user_id=$2',[target.id,userId]);
    await this.revokeSessions(client,target.id,userId);
   }
   await this.audit(client,actor,deleted?'PlatformTenantUserDeleted':'PlatformTenantUserDeactivated',target,
    {targetUserId:userId,targetEmail:user.email});
   return {deleted,deactivated:!deleted,
    reason:deleted?null:user.developer
     ?'The tenant developer account cannot be deleted, so it was deactivated and its licences and access were removed.'
     :'This user has history (sign-ins, records or audit entries), so they were deactivated and their licences and access were removed instead of being deleted.'};
  });
 }

 private async one(actor:Actor,slug:string,userId:string){
  const result=await this.list(actor,slug);
  const user=result.users.find(u=>u.id===userId);
  if(!user)throw new Error('User not found');
  return {user,licences:result.licences};
 }
}
