import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';

/**
 * Durable SQL-source-of-truth retention lifecycle. No actor-less purge:
 * automatic jobs recheck the policy owner's current Security and record rights.
 * Each root plus Master-Detail children is purged atomically in a single SQL
 * transaction. Other live references and unfinished approvals fail closed.
 */
export class RecordRetentionService {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async get(tenantId:string,userId:string){
  await this.rbac.require(tenantId,userId,'Security','manage');
  const {rows}=await this.db.query<{retention_days:number;automatic_purge_enabled:boolean}>(`
   SELECT retention_days,automatic_purge_enabled FROM md_record_retention_settings
   WHERE tenant_id=$1`,[tenantId]);
  return {retentionDays:rows[0]?.retention_days??15,
   automaticPurgeEnabled:rows[0]?.automatic_purge_enabled??false};
 }
 async set(tenantId:string,userId:string,days:unknown,enabled:unknown){
  await this.rbac.require(tenantId,userId,'Security','manage');
  if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>3650
    ||typeof enabled!=='boolean')throw new Error('Invalid retention configuration');
  await this.db.transaction(async client=>{
   await client.query(`INSERT INTO md_record_retention_settings
    (tenant_id,retention_days,automatic_purge_enabled,configured_by)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(tenant_id) DO UPDATE SET retention_days=EXCLUDED.retention_days,
    automatic_purge_enabled=EXCLUDED.automatic_purge_enabled,
    configured_by=EXCLUDED.configured_by,updated_at=now()`,[tenantId,days,enabled,userId]);
   await client.query(`INSERT INTO md_record_retention_audit
    (tenant_id,actor_id,retention_days,automatic_purge_enabled)
    VALUES($1,$2,$3,$4)`,[tenantId,userId,days,enabled]);
  });
  return {retentionDays:days,automaticPurgeEnabled:enabled};
 }

 /** The caller must be an authorized human or currently authorized opt-in owner. */
 async purge(tenantId:string,actorId:string,objectApi:string,rootId:string){
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)
    ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rootId))
    throw new Error('Invalid purge target');
  await this.rbac.require(tenantId,actorId,'Security','manage');
  await this.rbac.require(tenantId,actorId,objectApi,'delete');
  await this.rbac.requireRecord(tenantId,actorId,objectApi,rootId,'delete');
  return this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [tenantId+':record-retention:'+rootId]);
   const {rows:roots}=await client.query<{deletion_group_id:string}>(`
    SELECT deletion_group_id FROM md_records
    WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=true
      AND deletion_root_id=id AND md_record_access($1,$4,id,'delete')
    FOR UPDATE`,[tenantId,objectApi,rootId,actorId]);
   const group=roots[0]?.deletion_group_id;
   if(!group)throw new Error('Deleted root record not found');
   const {rows:policies}=await client.query<{retention_days:number}>(`
    SELECT retention_days FROM md_record_retention_settings WHERE tenant_id=$1`,[tenantId]);
   const days=policies[0]?.retention_days??15;
   const {rows}=await client.query<{id:string;object_api:string}>(`
    SELECT id,object_api FROM md_records
    WHERE tenant_id=$1 AND deletion_group_id=$2 AND is_deleted=true
      AND deleted_at<=now()-make_interval(days=>$3)
    ORDER BY object_api,id FOR UPDATE`,[tenantId,group,days]);
   const {rows:all}=await client.query<{id:string}>(`
    SELECT id FROM md_records WHERE tenant_id=$1 AND deletion_group_id=$2 AND is_deleted=true`,
    [tenantId,group]);
   if(rows.length!==all.length||!rows.some(r=>r.id===rootId))
    throw new Error('Recycle Bin retention period has not expired');
   // Every Object and Record in the group must be explicitly authorized.
   for(const rec of rows){
    await this.rbac.require(tenantId,actorId,rec.object_api,'delete');
    await this.rbac.requireRecord(tenantId,actorId,rec.object_api,rec.id,'delete');
   }
   const ids=rows.map(r=>r.id);
   // Blocks any orphaning, even if the referencing Field was deleted.
   const foreign=await client.query(`
    SELECT 1 FROM md_record_values v
    WHERE v.tenant_id=$1 AND v.reference_record_id=ANY($2::uuid[])
      AND NOT (v.record_id=ANY($2::uuid[]))
    LIMIT 1`,[tenantId,ids]);
   if(foreign.rowCount)throw new Error('Purge blocked: other records still reference this group');
   const savedLinks=await client.query(`
    SELECT 1 FROM md_deleted_lookup_links l
    WHERE l.tenant_id=$1 AND l.target_record_id=ANY($2::uuid[])
      AND l.deletion_group_id<>$3::uuid LIMIT 1`,[tenantId,ids,group]);
   if(savedLinks.rowCount)throw new Error('Purge blocked: another deletion group references this group');
   const pending=await client.query(`
    SELECT 1 FROM md_approval_requests
    WHERE tenant_id=$1 AND record_id=ANY($2::uuid[]) AND status='Pending' LIMIT 1`,
    [tenantId,ids]);
   if(pending.rowCount)throw new Error('Purge blocked: a pending approval requires this record');

   // These owned business records are deliberately purged only after configured
   // retention and authorization, never on normal Delete.
   await client.query(`DELETE FROM md_record_chatter_comments WHERE tenant_id=$1
    AND post_id IN (SELECT id FROM md_record_chatter_posts
      WHERE tenant_id=$1 AND record_id=ANY($2::uuid[]))`,[tenantId,ids]);
   await client.query(`DELETE FROM md_record_chatter_posts
    WHERE tenant_id=$1 AND record_id=ANY($2::uuid[])`,[tenantId,ids]);
   await client.query(`DELETE FROM md_record_activities
    WHERE tenant_id=$1 AND record_id=ANY($2::uuid[])`,[tenantId,ids]);
   await client.query(`DELETE FROM md_approval_requests
    WHERE tenant_id=$1 AND record_id=ANY($2::uuid[])`,[tenantId,ids]);
   await client.query(`DELETE FROM md_deleted_lookup_links
    WHERE tenant_id=$1 AND deletion_group_id=$2`,[tenantId,group]);
   const deleted=await client.query(`DELETE FROM md_records
    WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND is_deleted=true`,[tenantId,ids]);
   if(deleted.rowCount!==rows.length)throw new Error('Purge failed: record group changed concurrently');
   await client.query(`INSERT INTO md_record_lifecycle_audit
    (tenant_id,record_id,object_api,deletion_group_id,actor_id,operation)
    VALUES($1,$2,$3,$4,$5,'purge')`,
    [tenantId,rootId,objectApi,group,actorId]);
   return {purged:rows.length};
  }).catch((error:unknown)=>{
   if(error&&typeof error==='object'&&'code' in error&&error.code==='23503')
    throw new Error('Purge blocked: dependent business records need review');
   throw error;
  });
 }

 /**
  * Bounded hourly scan: requires explicit opt-in, current authorization,
  * and SQL transaction locks. Errors are reported without deleting records.
  */
 async purgeExpired(limit=20){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid purge batch');
  const {rows}=await this.db.query<{
   tenant_id:string;object_api:string;id:string;configured_by:string
  }>(`SELECT r.tenant_id,r.object_api,r.id,s.configured_by
   FROM md_records r
   JOIN md_record_retention_settings s ON s.tenant_id=r.tenant_id
   JOIN md_users u ON u.tenant_id=s.tenant_id AND u.id=s.configured_by AND u.enabled=true
   WHERE s.automatic_purge_enabled=true AND r.is_deleted=true
    AND r.deletion_root_id=r.id
    AND r.deleted_at<=now()-make_interval(days=>s.retention_days)
   ORDER BY r.deleted_at,r.id LIMIT $1`,[limit]);
  let purged=0,blocked=0;
  for(const row of rows){
   try {
    const result=await this.purge(row.tenant_id,row.configured_by,row.object_api,row.id);
    purged+=result.purged;
   }catch(error){
    blocked++;
    console.warn('Record retention purge skipped:',row.tenant_id,row.object_api,
      error instanceof Error?error.message:'Unknown retention restriction');
   }
  }
  return {purged,blocked};
 }
}
