import type {SqlPersistence} from '../system-files/sql-persistence.js';
/** Published SQL metadata remains authoritative; this is a tenant-scoped lookup, not a second registry. */
export async function registeredObject(db:SqlPersistence,tenantId:string,objectApi:string){
 const {rows}=await db.query<{api_name:string;label:string}>(`
 SELECT api_name,label FROM md_object_definitions
 WHERE tenant_id=$1 AND api_name=$2`,[tenantId,objectApi]);
 return rows[0]??null;
}
