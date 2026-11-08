import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** Create an assignable least-privilege permission set; never assign it automatically. */
export async function seedMailAdminPermissions(db:Pick<SqlPersistence,'transaction'>):Promise<number>{
 return db.transaction(async client=>{
  const {rows:tenants}=await client.query<{id:string}>('SELECT id FROM md_tenants ORDER BY id');
  for(const {id:tenantId} of tenants){
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenantId+':mail-admin-permissions']);
   await client.query(`INSERT INTO md_permission_sets(tenant_id,api_name)
    VALUES($1,'MailAdmin') ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId]);
   await client.query(`INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
    SELECT $1,p.id,rights.resource,rights.action,'allow'
    FROM md_permission_sets p CROSS JOIN (VALUES
      ('Mailbox','read'),('Mailbox','manage')
    ) AS rights(resource,action)
    WHERE p.tenant_id=$1 AND p.api_name='MailAdmin'
    ON CONFLICT(tenant_id,permission_set_id,resource,action) DO NOTHING`,[tenantId]);
  }
  return tenants.length;
 });
}
