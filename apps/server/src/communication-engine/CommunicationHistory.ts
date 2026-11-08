import type {SqlPersistence} from '../system-files/sql-persistence.js';
/** Tenant-scoped status view over the existing durable Flow email outbox. */
export async function flowEmailHistory(db:SqlPersistence,tenantId:string,runId:string){
 const {rows}=await db.query<{id:string;status:string;error_code:string|null;completed_at:Date|null}>(`
 SELECT id,status,error_code,completed_at FROM md_flow_email_jobs
 WHERE tenant_id=$1 AND run_id=$2 ORDER BY id`,[tenantId,runId]);
 return rows;
}
