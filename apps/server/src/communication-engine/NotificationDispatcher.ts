import type {SqlPersistence} from '../system-files/sql-persistence.js';
/** Tenant notification transport is the existing SQL metadata and durable job pipeline. */
export async function loadTenantNotificationDefinitions(db:SqlPersistence,tenantId:string){
 const {rows}=await db.query<{api_name:string;properties:Record<string,unknown>}>(`
 SELECT api_name,properties FROM md_system_definitions
 WHERE tenant_id=$1 AND kind='notifications' AND enabled=true ORDER BY api_name`,[tenantId]);
 return rows;
}
