import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** Permission set that administers ONE tenant only. Seeded for every tenant's developers. */
export const TENANT_DEVELOPER_PERMISSION_SET='TenantDeveloper';

/**
 * Initial tenant RBAC, applied only on provisioning; later changes are owned by
 * the RBAC administration UI.
 *
 * - TenantDeveloper permission set: full rights inside this tenant only. The
 *   Tenant Developer role (administrator + developer identity) uses it.
 * - OneEngine permission set: system-wide control of every tenant. It is created
 *   in every tenant so the system owner can grant it, but it is assigned only in
 *   the first tenant of a fresh system (systemOwner). Only an existing OneEngine
 *   holder may grant it afterwards.
 */
export async function seedOneEnginePolicy(client:PoolClient,tenantId:string,users:{
 administratorUserId:string;developerUserId:string;
},options:{systemOwner?:boolean}={}):Promise<void>{
 const role=await client.query<{id:string}>(
  'INSERT INTO md_roles (tenant_id,api_name,label) VALUES ($1,$2,$3) RETURNING id',
  [tenantId,'TenantDeveloper','Tenant Developer']);
 const oneEngine=await client.query<{id:string}>(
  'INSERT INTO md_permission_sets (tenant_id,api_name) VALUES ($1,$2) RETURNING id',
  [tenantId,'OneEngine']);
 const tenantDeveloper=await client.query<{id:string}>(
  'INSERT INTO md_permission_sets (tenant_id,api_name,label,description) VALUES ($1,$2,$3,$4) RETURNING id',
  [tenantId,TENANT_DEVELOPER_PERMISSION_SET,'Tenant Developer','Full administration of this tenant only; no access to other tenants']);
 for(const userId of [users.administratorUserId,users.developerUserId]){
  await client.query('INSERT INTO md_user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)',
   [tenantId,userId,role.rows[0].id]);
 }
 await client.query('INSERT INTO md_role_permission_sets (tenant_id,role_id,permission_set_id) VALUES ($1,$2,$3)',
  [tenantId,role.rows[0].id,options.systemOwner?oneEngine.rows[0].id:tenantDeveloper.rows[0].id]);
 // Wildcard rights are SQL rules, never an email/identity-based bypass. Both sets
 // allow everything inside their own tenant; cross-tenant authority is granted
 // only by OneEngine membership (hasPlatformOneEngine), never by these rules.
 for(const id of [oneEngine.rows[0].id,tenantDeveloper.rows[0].id])
  await client.query(
   "INSERT INTO md_permission_rules (tenant_id,permission_set_id,resource,action,effect) VALUES ($1,$2,'*','*','allow')",
   [tenantId,id]);
 // Add only missing setup navigation policies; do not overwrite customised grants.
 await client.query('SELECT md_seed_setup_menu_permission_sets($1::uuid)',[tenantId]);
}

/** Existing canonical platform OneEngine grants remain separate from tenant
 * administration and never create a second platform permission set.
 */
export async function seedPlatformOneEngineDeploymentPermission(
 db:Pick<SqlPersistence,'query'>
):Promise<number>{
 const {rows}=await db.query<{tenant_id:string}>(`
  WITH granted AS (
   INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
   SELECT p.tenant_id,p.id,'PlatformOperations','manage','allow'
   FROM md_permission_sets p
   JOIN md_tenant_domains d ON d.tenant_id=p.tenant_id
   JOIN md_tenants t ON t.id=d.tenant_id
   WHERE p.api_name='OneEngine' AND d.domain='unesolutions.co.uk'
     AND t.status='ACTIVE'
   ON CONFLICT(tenant_id,permission_set_id,resource,action) DO NOTHING
   RETURNING tenant_id
  ), audited AS (
   INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
   SELECT tenant_id,NULL,'platform.oneengine-deploy-grant.seeded',
    '{"policy":"OneEngine","resource":"PlatformOperations","action":"manage"}'::jsonb
   FROM granted RETURNING tenant_id
  )
  SELECT tenant_id FROM audited`);
 return rows.length;
}

/**
 * One-time upgrade for tenants provisioned before TenantDeveloper existed: their
 * Tenant Developer role granted OneEngine, which is now system-wide authority.
 * Relinks that role to a TenantDeveloper permission set (full rights inside the
 * tenant only). Idempotent: one receipt per tenant in md_security_events.
 *
 * System-owner tenants are left unchanged so their operators keep OneEngine:
 * the oldest tenant, and any tenant where an enabled internal user holds
 * OneEngine by direct assignment. Direct OneEngine assignments, profiles and
 * groups are never changed anywhere.
 */
export async function upgradeTenantDeveloperPolicy(db:Pick<SqlPersistence,'query'|'transaction'>):Promise<string[]>{
 const {rows:candidates}=await db.query<{id:string;slug:string}>(`
  SELECT t.id,t.slug FROM md_tenants t
  WHERE t.id<>(SELECT id FROM md_tenants ORDER BY created_at,id LIMIT 1)
   AND NOT EXISTS(SELECT 1 FROM md_security_events e
    WHERE e.tenant_id=t.id AND e.action='tenant-developer-policy.upgraded')
   AND NOT EXISTS(SELECT 1 FROM md_permission_assignments a
    JOIN md_permission_sets p ON p.tenant_id=a.tenant_id AND p.id=a.permission_set_id
    JOIN md_users u ON u.tenant_id=a.tenant_id AND u.id=a.user_id
    WHERE a.tenant_id=t.id AND p.api_name='OneEngine' AND u.enabled AND u.user_type='internal')
  ORDER BY t.created_at,t.id`);
 const upgraded:string[]=[];
 for(const tenant of candidates){
  const changed=await db.transaction(async client=>{
   await client.query('SELECT id FROM md_tenants WHERE id=$1 FOR UPDATE',[tenant.id]);
   const done=await client.query(`SELECT 1 FROM md_security_events
    WHERE tenant_id=$1 AND action='tenant-developer-policy.upgraded'`,[tenant.id]);
   if(done.rowCount)return false;
   const role=await client.query<{id:string}>(
    "SELECT id FROM md_roles WHERE tenant_id=$1 AND api_name='TenantDeveloper'",[tenant.id]);
   const oneEngine=await client.query<{id:string}>(
    "SELECT id FROM md_permission_sets WHERE tenant_id=$1 AND api_name='OneEngine'",[tenant.id]);
   let relinked=0;
   if(role.rows[0]&&oneEngine.rows[0]){
    const created=await client.query<{id:string}>(`
     INSERT INTO md_permission_sets(tenant_id,api_name,label,description) VALUES($1,$2,$3,$4)
     ON CONFLICT(tenant_id,api_name) DO NOTHING RETURNING id`,
     [tenant.id,TENANT_DEVELOPER_PERMISSION_SET,'Tenant Developer','Full administration of this tenant only; no access to other tenants']);
    if(created.rows[0])await client.query(`INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
     VALUES($1,$2,'*','*','allow') ON CONFLICT DO NOTHING`,[tenant.id,created.rows[0].id]);
    const target=created.rows[0]??(await client.query<{id:string}>(
     'SELECT id FROM md_permission_sets WHERE tenant_id=$1 AND api_name=$2',[tenant.id,TENANT_DEVELOPER_PERMISSION_SET])).rows[0];
    const removed=await client.query(`DELETE FROM md_role_permission_sets
     WHERE tenant_id=$1 AND role_id=$2 AND permission_set_id=$3`,[tenant.id,role.rows[0].id,oneEngine.rows[0].id]);
    relinked=removed.rowCount??0;
    if(relinked)await client.query(`INSERT INTO md_role_permission_sets(tenant_id,role_id,permission_set_id)
     VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenant.id,role.rows[0].id,target.id]);
   }
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,NULL,'tenant-developer-policy.upgraded',$2::jsonb)`,
    [tenant.id,JSON.stringify({role:'TenantDeveloper',from:'OneEngine',to:TENANT_DEVELOPER_PERMISSION_SET,relinked})]);
   return relinked>0;
  });
  if(changed)upgraded.push(tenant.slug);
 }
 return upgraded;
}
