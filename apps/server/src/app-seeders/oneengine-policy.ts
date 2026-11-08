import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** OneEnginePolicy grants Core tenant permissions only on initial provisioning.
 * Changes after provisioning are owned by the RBAC administration UI.
 */
export async function seedOneEnginePolicy(client:PoolClient,tenantId:string,users:{
 administratorUserId:string;developerUserId:string;
}):Promise<void>{
 const role=await client.query<{id:string}>(
  'INSERT INTO md_roles (tenant_id,api_name,label) VALUES ($1,$2,$3) RETURNING id',
  [tenantId,'TenantDeveloper','Tenant Developer']);
 const permissionSet=await client.query<{id:string}>(
  'INSERT INTO md_permission_sets (tenant_id,api_name) VALUES ($1,$2) RETURNING id',
  [tenantId,'OneEngine']);
 for(const userId of [users.administratorUserId,users.developerUserId]){
  await client.query('INSERT INTO md_user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)',
   [tenantId,userId,role.rows[0].id]);
 }
 await client.query('INSERT INTO md_role_permission_sets (tenant_id,role_id,permission_set_id) VALUES ($1,$2,$3)',
  [tenantId,role.rows[0].id,permissionSet.rows[0].id]);
 // Wildcard rights are SQL rules, never an email/identity-based bypass.
 await client.query(
  "INSERT INTO md_permission_rules (tenant_id,permission_set_id,resource,action,effect) VALUES ($1,$2,'*','*','allow')",
  [tenantId,permissionSet.rows[0].id]);
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
