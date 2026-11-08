import type {SqlPersistence} from '../system-files/sql-persistence.js';
/** Tenant installation, licence and entitlement checks remain SQL-backed. */
export async function loadTenantApps(db:SqlPersistence,tenantId:string){
 const {rows}=await db.query<{id:string;api_name:string;label:string;description:string|null;brand_color:string|null;revision:number|null}>(`
 SELECT a.id,COALESCE(m.api_name,a.api_name) AS api_name,
 COALESCE(m.label,a.label) AS label,m.description,m.brand_color,m.revision
 FROM md_apps a
 JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
 JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1
 LEFT JOIN md_tenant_app_metadata m ON m.app_id=a.id AND m.tenant_id=$1
 WHERE a.enabled=true AND a.app_type='Application'
 AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
 AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
 ORDER BY COALESCE(m.label,a.label),COALESCE(m.api_name,a.api_name)`,[tenantId]);
 return rows;
}
