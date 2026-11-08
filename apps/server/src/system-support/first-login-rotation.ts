import {AuthenticationService} from '../system-files/authentication.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** Strictly scoped first-login credential rotation for the fresh single-user install. */
export async function rotateFirstLoginPassword(db:SqlPersistence,env:NodeJS.ProcessEnv=process.env):
  Promise<'disabled'|'already-rotated'|'rotated'> {
  if(env.METADRIVE_ROTATE_FIRST_LOGIN_ONCE!=='true')return 'disabled';
  const domain=env.METADRIVE_BOOTSTRAP_DOMAIN?.trim().toLowerCase();
  const email=env.METADRIVE_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const replacement=env.METADRIVE_BOOTSTRAP_ADMIN_PASSWORD;
  if(!domain||!email||!replacement||!(/^[A-Za-z0-9_-]{24,64}$/.test(replacement)))
    throw new Error('Invalid temporary first-login setup');
  const result=await db.query<{tenants:number;users:number}>(
    'SELECT (SELECT count(*)::int FROM md_tenants) AS tenants, (SELECT count(*)::int FROM md_users) AS users');
  if(result.rows[0]?.tenants!==1||result.rows[0]?.users!==1)
    throw new Error('First-login rotation requires precisely one tenant and one user');
  const auth=new AuthenticationService(db);
  const hash=await auth.hashPassword(replacement);
  return db.transaction(async client=>{
    const identity=await client.query<{id:string;tenant_id:string}>(
      `SELECT u.id,u.tenant_id FROM md_users u JOIN md_tenant_domains d ON d.tenant_id=u.tenant_id
       WHERE lower(u.email)=$1 AND d.domain=$2 AND u.enabled=true FOR UPDATE OF u`,[email,domain]);
    if(identity.rows.length!==1)throw new Error('First-login account/domain mismatch');
    const user=identity.rows[0];
    const already=await client.query('SELECT 1 FROM md_initial_password_rotations WHERE tenant_id=$1 AND user_id=$2',
      [user.tenant_id,user.id]);
    if(already.rows.length)return 'already-rotated' as const;
    await client.query('UPDATE md_users SET password_hash=$1,password_changed_at=now() WHERE tenant_id=$2 AND id=$3',
      [hash,user.tenant_id,user.id]);
    await client.query('UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
      [user.tenant_id,user.id]);
    await client.query('UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
      [user.tenant_id,user.id]);
    await client.query('INSERT INTO md_initial_password_rotations (tenant_id,user_id) VALUES ($1,$2)',
      [user.tenant_id,user.id]);
    return 'rotated' as const;
  });
}
