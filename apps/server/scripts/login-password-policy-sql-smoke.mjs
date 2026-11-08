import {readBaselineMigration} from './baseline-sql-section.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {AuthenticationService} from '../dist-system/system-files/authentication.js';
import {PasswordResetService} from '../dist-system/system-support/password-reset-service.js';
import {PasswordPolicyService} from '../dist-system/system-support/password-policy-service.js';

/** Run against an isolated PostgreSQL-compatible executor; never uses the application's .env. */
export async function verifyLoginPasswordSql(db,additionalChecks){
 const schema='security_test_'+Date.now();
 await db.query(`CREATE SCHEMA ${schema}`);
 try{
  await db.query(`SET search_path TO ${schema},public`);
  await db.query(`-- Phase 1/2 isolate their own schema. Phase 3 tests exercise the actual licence/OAuth predicates.
   CREATE FUNCTION md_user_licensed(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
   CREATE FUNCTION md_oauth_refresh_allowed(text,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
   CREATE FUNCTION md_oauth_token_allowed(uuid,uuid,text,text,text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
   CREATE TABLE md_tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text DEFAULT 'ACTIVE');
   CREATE TABLE md_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES md_tenants(id),
    email text,password_hash text,enabled boolean DEFAULT true,locked_until timestamptz,UNIQUE(tenant_id,id));
   CREATE TABLE md_security_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES md_tenants(id),
    actor_user_id uuid NOT NULL,subject_user_id uuid,action text,created_at timestamptz DEFAULT now(),
    FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id));
   CREATE TABLE md_profiles(tenant_id uuid,id uuid DEFAULT gen_random_uuid(),label text,UNIQUE(tenant_id,id));
   CREATE TABLE md_user_profiles(tenant_id uuid,user_id uuid,profile_id uuid);
   CREATE TABLE md_sessions(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,token_hash text,expires_at timestamptz,mfa_verified boolean,revoked_at timestamptz);
   CREATE TABLE md_refresh_sessions(LIKE md_sessions);
   CREATE TABLE md_password_reset_challenges(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,token_hash text,consumed_at timestamptz,expires_at timestamptz,otp_length integer,verified_at timestamptz);
   CREATE TABLE md_named_credentials(tenant_id uuid,id uuid,protocol text,enabled boolean);
   CREATE TABLE md_password_recovery_settings(tenant_id uuid,smtp_credential_id uuid,from_email text);`);
  const tenant=(await db.query('INSERT INTO md_tenants DEFAULT VALUES RETURNING id')).rows[0].id;
  const other=(await db.query('INSERT INTO md_tenants DEFAULT VALUES RETURNING id')).rows[0].id;
  const migration=readBaselineMigration('20261121-login-password-policy.sql');
  await db.query(migration);
  await db.query(readBaselineMigration('20261023-mfa-identity.sql'));
  await db.query(readBaselineMigration('20261122-identity-session-controls.sql'));
  await db.query('UPDATE md_password_policies SET min_length=16 WHERE tenant_id=$1',[tenant]);
  await db.query(migration);
  assert.equal((await db.query('SELECT min_length FROM md_password_policies WHERE tenant_id=$1',[tenant])).rows[0].min_length,16);
  const auth=new AuthenticationService(db),password='FirstPassword!2026';
  const hash=await auth.hashPassword(password,tenant);
  const user=(await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',[tenant,'test@example.test',hash])).rows[0].id;
  const foreign=(await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',[other,'test@example.test',hash])).rows[0].id;
  for(let i=0;i<5;i++)await assert.rejects(()=>auth.verifyIdentity(tenant,'test@example.test','incorrect'),/Invalid credentials/);
  assert.equal((await db.query('SELECT failed_login_attempts FROM md_users WHERE id=$1',[user])).rows[0].failed_login_attempts,5);
  assert.equal((await db.query('SELECT failed_login_attempts FROM md_users WHERE id=$1',[foreign])).rows[0].failed_login_attempts,0);
  await assert.rejects(()=>auth.verifyIdentity(tenant,'test@example.test',password),/Invalid credentials/);
  await assert.rejects(()=>auth.verifyIdentity(tenant,'unknown@example.test',password),/Invalid credentials/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM md_security_events WHERE action='LoginFailed' AND actor_user_id IS NULL")).rows[0].n,1);
  await db.query("UPDATE md_users SET locked_until=now()-interval '1 minute' WHERE id=$1",[user]);
  assert.equal(await auth.verifyIdentity(tenant,'test@example.test',password),user);
  const session=await auth.issuePasswordSession(tenant,user);
  assert.equal((await auth.authenticate(session.accessToken)).user_id,user);
  await auth.changePassword(tenant,user,password,'SecondPassword!2026');
  await assert.rejects(()=>auth.changePassword(tenant,user,'SecondPassword!2026',password),/recently used/);
  const sessions=await db.query('SELECT revoked_at FROM md_sessions');assert.ok(sessions.rows.every(s=>s.revoked_at));
  const reset=new PasswordResetService(db,auth,async()=>{});
  const token='A'.repeat(43),{createHash}=await import('node:crypto');
  await db.query("INSERT INTO md_password_reset_challenges(tenant_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes')",[tenant,user,createHash('sha256').update(token).digest('hex')]);
  await assert.rejects(()=>reset.confirm(tenant,'test@example.test',token,password),/recently used/);
  await reset.confirm(tenant,'test@example.test',token,'ThirdPassword!2026');
  await assert.rejects(()=>reset.confirm(tenant,'test@example.test',token,'FourthPassword!2026'),/expired recovery token/);
  const policy=new PasswordPolicyService(db,{require:async()=>{}});
  await assert.rejects(()=>policy.save(tenant,user,{max_age_days:30}),/platform SMTP recovery delivery is not configured/);
  process.env.METADRIVE_PLATFORM_SMTP_HOST='smtp.example.test';
  process.env.METADRIVE_PLATFORM_SMTP_PORT='587';
  process.env.METADRIVE_PLATFORM_SMTP_USERNAME='test-user';
  process.env.METADRIVE_PLATFORM_SMTP_PASSWORD='test-password';
  process.env.METADRIVE_PLATFORM_SMTP_FROM_EMAIL='sender@example.test';
  await policy.save(tenant,user,{min_length:16,max_age_days:30,require_number:true});
  assert.equal((await policy.read(tenant,user)).max_age_days,30);
  const expiring=await auth.issuePasswordSession(tenant,user);
  await db.query("UPDATE md_users SET password_changed_at=now()-interval '31 days' WHERE id=$1",[user]);
  await assert.rejects(()=>auth.verifyIdentity(tenant,'test@example.test','ThirdPassword!2026'),/Password expired/);
  await assert.rejects(()=>auth.issueMfaSession(tenant,user),/Invalid credentials/);
  await assert.rejects(()=>auth.authenticate(expiring.accessToken),/Invalid session/);
  await assert.rejects(()=>auth.refresh(expiring.refreshToken),/Invalid session/);
  if(additionalChecks)await additionalChecks({db,tenant,other,user,foreign,auth});
  console.log('Password policy SQL: migration replay preserves customisation; tenant isolation, lockout, history, recovery, session revocation and expiry passed.');
 }finally{
  await db.query('SET search_path TO public');
  await db.query(`DROP SCHEMA ${schema} CASCADE`);
 }
}

export async function withSqlTestConnection(run){
 if(!process.env.METADRIVE_SQL_TEST_DATABASE_URL)throw Error('METADRIVE_SQL_TEST_DATABASE_URL is required; use an isolated test database');
 const {Client}=await import('pg');
 const client=new Client({connectionString:process.env.METADRIVE_SQL_TEST_DATABASE_URL});
 await client.connect();
 const db={query:(sql,args)=>client.query(sql,args),transaction:async run=>{
  await client.query('BEGIN');
  try{const result=await run(db);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}
 }};
 try{await run(db);}finally{await client.end();}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await withSqlTestConnection(verifyLoginPasswordSql);
