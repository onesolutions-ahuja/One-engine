import {AuthenticationService} from '../system-files/authentication.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/**
 * One-off first-install reconciliation of the developer's Railway password
 * with the existing account. Never accepts a password over HTTP and never
 * writes to historical Object/tenant registries.
 */
export async function reconcileBootstrapPassword(
  db:SqlPersistence,env:NodeJS.ProcessEnv=process.env
):Promise<'disabled'|'already-done'|'unchanged'|'updated'> {
  if(env.METADRIVE_SYNC_BOOTSTRAP_PASSWORD_ONCE!=='true')return 'disabled';
  const email=env.METADRIVE_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const domain=env.METADRIVE_BOOTSTRAP_DOMAIN?.trim().toLowerCase();
  const password=env.METADRIVE_BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if(!email||!domain||!password||password.length<12)
    throw new Error('One-time password sync requires valid developer bootstrap settings');

  // This is only permitted on the fresh single-tenant, single-user installation.
  const counts=await db.query<{tenants:number;users:number}>(
    'SELECT (SELECT count(*)::int FROM md_tenants) AS tenants, (SELECT count(*)::int FROM md_users) AS users',
    []
  );
  if(counts.rows.length===0)throw new Error('Missing bootstrap database counts');
  // Require both counts in the same query before any write.
  if(counts.rows[0].tenants!==1||counts.rows[0].users!==1)
    throw new Error('Password sync is only valid for the fresh single-user installation');
  const auth=new AuthenticationService(db);
  return db.transaction(async client=>{
    const found=await client.query<{id:string;tenant_id:string;password_hash:string}>(
      `SELECT u.id,u.tenant_id,u.password_hash
       FROM md_users u JOIN md_tenant_domains d ON d.tenant_id=u.tenant_id
       WHERE lower(u.email)=$1 AND d.domain=$2 AND u.enabled=true
       FOR UPDATE OF u`,[email,domain]);
    if(found.rows.length!==1)throw new Error('Bootstrap account/domain mismatch');
    const user=found.rows[0];
    const prior=await client.query(
      'SELECT 1 FROM md_bootstrap_password_repairs WHERE tenant_id=$1 AND user_id=$2',
      [user.tenant_id,user.id]);
    if(prior.rows.length)return 'already-done' as const;
    const matched=await auth.verifyPassword(password,user.password_hash);
    if(!matched){
      const newHash=await auth.hashPassword(password);
      await client.query(
        'UPDATE md_users SET password_hash=$1,password_changed_at=now() WHERE tenant_id=$2 AND id=$3',
        [newHash,user.tenant_id,user.id]);
      await client.query(
        'UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [user.tenant_id,user.id]);
      await client.query(
        'UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [user.tenant_id,user.id]);
    }
    await client.query(
      'INSERT INTO md_bootstrap_password_repairs (tenant_id,user_id) VALUES ($1,$2)',
      [user.tenant_id,user.id]);
    return matched?'unchanged' as const:'updated' as const;
  });
}
