import type {SqlPersistence} from './sql-persistence.js';

/** The canonical platform tenant is the active tenant that owns this verified domain. */
export const PLATFORM_TENANT_DOMAIN='unesolutions.co.uk';

/**
 * Platform (cross-tenant) authority: OneEngine membership (direct, role, profile or
 * group) held by an enabled internal user OF THE PLATFORM TENANT. Every tenant has its
 * own OneEngine permission set, so OneEngine alone must never grant cross-tenant access.
 */
export async function hasPlatformOneEngine(db:Pick<SqlPersistence,'query'>,
  tenantId:string,userId:string):Promise<boolean>{
  const {rows}=await db.query<{authorised:boolean}>(`
   SELECT EXISTS(
    SELECT 1 FROM md_tenant_domains d JOIN md_tenants t ON t.id=d.tenant_id
    JOIN md_users u ON u.tenant_id=t.id AND u.id=$2
    WHERE d.tenant_id=$1 AND d.domain=$3
      AND t.status='ACTIVE' AND u.enabled=true AND u.user_type='internal'
   ) AND EXISTS(
    SELECT 1 FROM md_permission_assignments a JOIN md_permission_sets p
     ON p.tenant_id=a.tenant_id AND p.id=a.permission_set_id
     WHERE a.tenant_id=$1 AND a.user_id=$2 AND p.api_name='OneEngine'
    UNION ALL SELECT 1 FROM md_user_roles ur JOIN md_role_permission_sets rp
     ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id
     JOIN md_permission_sets p ON p.tenant_id=rp.tenant_id AND p.id=rp.permission_set_id
     WHERE ur.tenant_id=$1 AND ur.user_id=$2 AND p.api_name='OneEngine'
    UNION ALL SELECT 1 FROM md_user_profiles up JOIN md_profile_permission_sets pp
     ON pp.tenant_id=up.tenant_id AND pp.profile_id=up.profile_id
     JOIN md_permission_sets p ON p.tenant_id=pp.tenant_id AND p.id=pp.permission_set_id
     WHERE up.tenant_id=$1 AND up.user_id=$2 AND p.api_name='OneEngine'
    UNION ALL SELECT 1 FROM md_user_permission_groups ug JOIN md_permission_group_sets gs
     ON gs.tenant_id=ug.tenant_id AND gs.group_id=ug.group_id
     JOIN md_permission_sets p ON p.tenant_id=gs.tenant_id AND p.id=gs.permission_set_id
     WHERE ug.tenant_id=$1 AND ug.user_id=$2 AND p.api_name='OneEngine'
   ) AS authorised`,[tenantId,userId,PLATFORM_TENANT_DOMAIN]);
  return rows[0]?.authorised===true;
}
