import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { SqlPersistence } from './sql-persistence.js';
import {setAuditActor} from '../system-support/audit-context.js';
import {readPasswordPolicy,validatePassword,checkPasswordHistory,retainPasswordHistory} from '../system-support/password-policy-service.js';
import {enforceLoginBoundary,normalizedLoginIp,readSessionPolicy,type LoginContext} from '../system-support/session-policy-service.js';
const scrypt = promisify(scryptCallback);
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
const mintToken = () => randomBytes(32).toString('base64url');
export class AuthenticationService {
  constructor(private readonly db:SqlPersistence) {}
  private loginGuard?: (tenant:string,user:string,context:LoginContext)=>Promise<void>;
  setLoginGuard(guard:(tenant:string,user:string,context:LoginContext)=>Promise<void>){this.loginGuard=guard;}
  async hashPassword(password:string,tenantId?:string) {
    if (password.length < 12||password.length>1024) throw new Error('Invalid password: length must be 12 to 1024 characters');
    if(tenantId)validatePassword(password,await readPasswordPolicy(this.db,tenantId));
    const salt=randomBytes(16).toString('hex');
    const digest=await scrypt(password,salt,64) as Buffer;
    return `scrypt:${salt}:${digest.toString('hex')}`;
  }
  async verifyPassword(password:string,encoded:string) {
    const [method,salt,hash]=encoded.split(':');
    if(method!=='scrypt'|| !salt || !/^[a-f0-9]{128}$/i.test(hash??'')) return false;
    const digest=await scrypt(password,salt,64) as Buffer;
    return timingSafeEqual(digest,Buffer.from(hash,'hex'));
  }
  private async issue(tenantId:string,userId:string,mfaVerified=false,context:LoginContext={}) {
    setAuditActor(tenantId,userId);
    const access=mintToken(),refresh=mintToken(),family=randomUUID();
    const policy=await readSessionPolicy(this.db,tenantId);
    if(policy.require_mfa&&!mfaVerified)throw Error('MFA required');
    await enforceLoginBoundary(this.db,tenantId,userId,context);
    await this.loginGuard?.(tenantId,userId,context);
    const accessSeconds=Math.min(policy.access_minutes,policy.refresh_minutes)*60,refreshSeconds=policy.refresh_minutes*60;
    await this.db.transaction(async client=>{
      const eligible=await client.query(`SELECT u.id FROM md_users u
        JOIN md_tenants t ON t.id=u.tenant_id AND t.status='ACTIVE'
        LEFT JOIN md_password_policies p ON p.tenant_id=u.tenant_id
        WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true AND md_user_licensed(u.tenant_id,u.id)
        AND (u.locked_until IS NULL OR u.locked_until<=now())
        AND (COALESCE(p.max_age_days,0)=0 OR u.password_changed_at+(p.max_age_days * interval '1 day')>now()) FOR UPDATE OF u`,[tenantId,userId]);
      if(!eligible.rows[0])throw new Error('Invalid credentials');
      await client.query('INSERT INTO md_sessions (tenant_id,user_id,token_hash,expires_at,mfa_verified,source_ip,family_id) VALUES ($1,$2,$3,now()+($4 * interval \'1 second\'),$5,$6::inet,$7)',
        [tenantId,userId,fingerprint(access),accessSeconds,mfaVerified,normalizedLoginIp(context.ip),family]);
      await client.query('INSERT INTO md_refresh_sessions (tenant_id,user_id,token_hash,expires_at,mfa_verified,absolute_expires_at,source_ip,family_id) VALUES ($1,$2,$3,now()+($4 * interval \'1 second\'),$5,now()+($4 * interval \'1 second\'),$6::inet,$7)',
        [tenantId,userId,fingerprint(refresh),refreshSeconds,mfaVerified,normalizedLoginIp(context.ip),family]);
      await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action) VALUES($1,$2,$2,'LoginSucceeded')",[tenantId,userId]);
    });
    return {accessToken:access,refreshToken:refresh,expiresIn:accessSeconds};
  }
  async verifyIdentity(tenantId:string,email:string,password:string,sourceIp?:string):Promise<string> {
    if(email.length>254||password.length>1024)throw new Error('Invalid credentials');
    // Return rejection instead of throwing inside the transaction: failures must commit.
    const result=await this.db.transaction(async client=>{
      const policy=await readPasswordPolicy(client,tenantId);
      const {rows}=await client.query<{id:string;password_hash:string;enabled:boolean;locked_until:Date|null;failed_login_attempts:number;expired:boolean}>(
        `SELECT id,password_hash,enabled,locked_until,failed_login_attempts,
         ($3::integer>0 AND password_changed_at+($3 * interval '1 day')<=now()) AS expired
         FROM md_users WHERE tenant_id=$1 AND lower(email)=lower($2)
         AND EXISTS(SELECT 1 FROM md_tenants t WHERE t.id=md_users.tenant_id AND t.status='ACTIVE') FOR UPDATE`,
        [tenantId,email,policy.max_age_days]);
      const user=rows[0];
      const locked=!!user?.locked_until&&new Date(user.locked_until).getTime()>Date.now();
      const valid=!!user?.enabled&&!locked&&await this.verifyPassword(password,user.password_hash);
      if(!valid){
        if(user?.enabled&&!locked){
          const failures=(user.locked_until?0:user.failed_login_attempts)+1;
          await client.query(`UPDATE md_users SET failed_login_attempts=$3,
            locked_until=CASE WHEN $3::integer >= $4::integer THEN now()+($5::integer * interval '1 minute') ELSE NULL END
            WHERE tenant_id=$1 AND id=$2`,[tenantId,user.id,failures,policy.max_failed_attempts,policy.lockout_minutes]);
          if(failures>=policy.max_failed_attempts){
            for(const table of ['md_sessions','md_refresh_sessions'])await client.query(
              'UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,user.id]);
          }
        }
        await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action,login_identifier,source_ip)
          VALUES($1,$2,$2,'LoginFailed',$3,$4)`,[tenantId,user?.id??null,email.toLowerCase(),sourceIp?.slice(0,64)??null]);
        return {error:'Invalid credentials'};
      }
      await client.query('UPDATE md_users SET failed_login_attempts=0,locked_until=NULL WHERE tenant_id=$1 AND id=$2',[tenantId,user.id]);
      await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action,login_identifier,source_ip)
        VALUES($1,$2,$2,$3,$4,$5)`,[tenantId,user.id,user.expired?'LoginPasswordExpired':'LoginPasswordVerified',email.toLowerCase(),sourceIp?.slice(0,64)??null]);
      return user.expired?{error:'Password expired. Use password recovery to set a new password.'}:{userId:user.id};
    });
    if(result.error)throw new Error(result.error);
    return result.userId!;
  }
  /** Side-effect-free password check, used only to pick between several tenants
   * that share one email. The chosen tenant then runs verifyIdentity normally. */
  async passwordMatches(tenantId:string,email:string,password:string):Promise<boolean> {
    if(email.length>254||password.length>1024)return false;
    const {rows}=await this.db.query<{password_hash:string;locked_until:Date|null}>(
      'SELECT password_hash,locked_until FROM md_users WHERE tenant_id=$1 AND lower(email)=lower($2) AND enabled=true',
      [tenantId,email.trim()]);
    const user=rows[0];
    if(!user||user.locked_until&&new Date(user.locked_until).getTime()>Date.now())return false;
    return this.verifyPassword(password,user.password_hash);
  }
  async verifyCurrentPassword(tenantId:string,userId:string,password:string):Promise<void> {
    const {rows}=await this.db.query<{password_hash:string}>(
      'SELECT password_hash FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true',
      [tenantId,userId]);
    if(!rows[0]||!(await this.verifyPassword(password,rows[0].password_hash)))
      throw new Error('Invalid credentials');
  }
  async signIn(tenantId:string,email:string,password:string) {
    const userId=await this.verifyIdentity(tenantId,email,password);
    return this.issuePasswordSession(tenantId,userId);
  }
  async issuePasswordSession(tenantId:string,userId:string,context:LoginContext={}) {
    const {rows}=await this.db.query<{required:boolean}>(`
      SELECT (COALESCE(p.mode,'Off')='Required'
         OR (p.mode='Optional' AND (m.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM md_webauthn_credentials w WHERE w.tenant_id=u.tenant_id AND w.user_id=u.id)))) AS required
      FROM md_users u
      LEFT JOIN md_tenant_mfa_policies p ON p.tenant_id=u.tenant_id
      LEFT JOIN md_user_mfa_secrets m ON m.tenant_id=u.tenant_id AND m.user_id=u.id
      WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true
        AND (u.locked_until IS NULL OR u.locked_until<=now())`,
      [tenantId,userId]);
    if(!rows[0])throw new Error('Invalid credentials');
    if(rows[0].required)throw new Error('MFA required');
    return this.issue(tenantId,userId,false,context);
  }
  /** Shared-till PIN sign-in: the saved device key was created by a full sign-in, which
   * already passed MFA when mfaVerified is true. Disabled or locked users are refused. */
  async issueTrustedDeviceSession(tenantId:string,userId:string,mfaVerified:boolean,context:LoginContext={}) {
    const {rows}=await this.db.query(`SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true
      AND (locked_until IS NULL OR locked_until<=now())`,[tenantId,userId]);
    if(!rows[0])throw new Error('Invalid credentials');
    return this.issue(tenantId,userId,mfaVerified,context);
  }
  async issueMfaSession(tenantId:string,userId:string,context:LoginContext={}) {
    return this.issue(tenantId,userId,true,context);
  }
  async refresh(token:string,context:LoginContext={}) {
    if(!/^[a-zA-Z0-9_-]{35,}$/.test(token)) throw new Error('Invalid session');
    const nextAccess=mintToken(),nextRefresh=mintToken();
    const identity=await this.db.transaction(async client=>{
      const old=await client.query<{tenant_id:string,user_id:string;mfa_verified:boolean;absolute_expires_at:Date;last_seen_at:Date;family_id:string}>(
        'UPDATE md_refresh_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now() AND md_oauth_refresh_allowed($1,$2::uuid) RETURNING tenant_id,user_id,mfa_verified,absolute_expires_at,last_seen_at,family_id',
        [fingerprint(token),context.oauthClientId??null]);
      if(!old.rows[0]) throw new Error('Invalid session');
      const {tenant_id,user_id,mfa_verified}=old.rows[0];
      const policy=await readSessionPolicy(client,tenant_id);
      if((policy.require_mfa&&!mfa_verified)||Date.now()-new Date(old.rows[0].last_seen_at).getTime()>policy.idle_minutes*60000)throw Error('Invalid session');
      await enforceLoginBoundary(client,tenant_id,user_id,context);
      const enabled=await client.query(`SELECT u.id FROM md_users u JOIN md_tenants t ON t.id=u.tenant_id AND t.status='ACTIVE'
        LEFT JOIN md_tenant_mfa_policies p ON p.tenant_id=u.tenant_id
        LEFT JOIN md_user_mfa_secrets m ON m.tenant_id=u.tenant_id AND m.user_id=u.id
        LEFT JOIN md_password_policies pp ON pp.tenant_id=u.tenant_id
        WHERE (COALESCE(pp.max_age_days,0)=0 OR u.password_changed_at+(pp.max_age_days * interval '1 day')>now())
          AND u.id=$1 AND u.tenant_id=$2 AND u.enabled=true AND md_user_licensed(u.tenant_id,u.id) AND (u.locked_until IS NULL OR u.locked_until<=now())
          AND (COALESCE(p.mode,'Off')='Off' OR (p.mode='Optional' AND m.user_id IS NULL AND NOT EXISTS(SELECT 1 FROM md_webauthn_credentials w WHERE w.tenant_id=u.tenant_id AND w.user_id=u.id)) OR $3::boolean=true)`,[user_id,tenant_id,mfa_verified]);
      if(!enabled.rowCount) throw new Error('Invalid session');
      const seconds=Math.min(policy.access_minutes*60,Math.max(0,Math.floor((new Date(old.rows[0].absolute_expires_at).getTime()-Date.now())/1000)));
      if(seconds<=0)throw Error('Invalid session');
      await client.query('INSERT INTO md_sessions (tenant_id,user_id,token_hash,expires_at,mfa_verified,source_ip,family_id) VALUES ($1,$2,$3,now()+($4 * interval \'1 second\'),$5,$6::inet,$7)',
        [tenant_id,user_id,fingerprint(nextAccess),seconds,mfa_verified,normalizedLoginIp(context.ip),old.rows[0].family_id]);
      await client.query('INSERT INTO md_refresh_sessions (tenant_id,user_id,token_hash,expires_at,mfa_verified,absolute_expires_at,source_ip,family_id) VALUES ($1,$2,$3,LEAST($4::timestamptz,now()+($7::integer * interval \'1 minute\')),$5,$4,$6::inet,$8)',
        [tenant_id,user_id,fingerprint(nextRefresh),old.rows[0].absolute_expires_at,mfa_verified,normalizedLoginIp(context.ip),policy.refresh_minutes,old.rows[0].family_id]);
      return {tenant_id,user_id,expiresIn:seconds};
    });
    return { ...identity,accessToken:nextAccess,refreshToken:nextRefresh };
  }
  async authenticate(token:string,context:LoginContext={}) {
    const {rows}=await this.db.query<{tenant_id:string;user_id:string}>(`WITH active AS (
      SELECT s.tenant_id,s.user_id,s.family_id,
             s.last_seen_at<now()-interval '5 seconds' AS stale
      FROM md_sessions s
      JOIN md_users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
      JOIN md_tenants t ON t.id=u.tenant_id AND t.status='ACTIVE'
      LEFT JOIN md_tenant_mfa_policies m ON m.tenant_id=u.tenant_id
      LEFT JOIN md_password_policies p ON p.tenant_id=u.tenant_id
      LEFT JOIN md_session_policies policy ON policy.tenant_id=u.tenant_id
      WHERE u.enabled=true
        AND (u.locked_until IS NULL OR u.locked_until<=now())
        AND (COALESCE(p.max_age_days,0)=0 OR u.password_changed_at+(p.max_age_days * interval '1 day')>now())
        AND (s.mfa_verified OR (NOT COALESCE(policy.require_mfa,false) AND
          (COALESCE(m.mode,'Off')='Off' OR (m.mode='Optional'
           AND NOT EXISTS(SELECT 1 FROM md_user_mfa_secrets x WHERE x.tenant_id=u.tenant_id AND x.user_id=u.id)
           AND NOT EXISTS(SELECT 1 FROM md_webauthn_credentials w WHERE w.tenant_id=u.tenant_id AND w.user_id=u.id)))))
        AND s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL
        AND s.last_seen_at>now()-(COALESCE(policy.idle_minutes,60)*interval '1 minute')
        AND md_login_boundary_allowed(s.tenant_id,s.user_id,$2::inet)
        AND md_user_licensed(s.tenant_id,s.user_id) AND md_oauth_token_allowed(s.tenant_id,s.user_id,$1,$3,$4)
    ), touched_session AS (
      -- Validation above is read-only. Writing last_seen_at on EVERY request made all parallel
      -- requests of one session queue on one row lock (24 parallel requests ran one at a time).
      -- It is now refreshed at most every 5 seconds, so idle timeout is accurate to 5 seconds.
      UPDATE md_sessions s SET last_seen_at=now() FROM active a
      WHERE a.stale AND s.token_hash=$1 AND s.tenant_id=a.tenant_id AND s.user_id=a.user_id
      RETURNING s.token_hash
    ), touched AS (
      UPDATE md_refresh_sessions r SET last_seen_at=now() FROM active a
      WHERE a.stale AND r.family_id=a.family_id AND r.tenant_id=a.tenant_id AND r.user_id=a.user_id
       AND r.revoked_at IS NULL AND r.expires_at>now() RETURNING r.id
    ) SELECT tenant_id,user_id FROM active`,[fingerprint(token),normalizedLoginIp(context.ip),context.path??'',context.method??'']);
    if(!rows[0])throw Error('Invalid session');
    return rows[0];
  }

  async activeSessions(tenantId:string,userId:string){
    const {rows}=await this.db.query<{id:string;expires_at:Date|string;mfa_verified:boolean}>(
      'SELECT id,expires_at,mfa_verified FROM md_refresh_sessions WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY expires_at DESC LIMIT 100',
      [tenantId,userId]);
    return {sessions:rows.map(row=>({
      familyId:row.id,
      expiresAt:Math.floor(new Date(row.expires_at).getTime()/1000),
      mfaVerified:row.mfa_verified===true
    }))};
  }
  async revokeAllSessions(tenantId:string,userId:string,password:string){
    if(!password)throw new Error('Invalid credentials');
    await this.db.transaction(async client=>{
      const result=await client.query<{password_hash:string}>(
        'SELECT password_hash FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true FOR UPDATE',
        [tenantId,userId]);
      if(!result.rows[0]||!(await this.verifyPassword(password,result.rows[0].password_hash)))
        throw new Error('Invalid credentials');
      await client.query('UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,userId]);
      await client.query('UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,userId]);
    });
  }
  async changePassword(tenantId:string,userId:string,currentPassword:string,newPassword:string){
    if(!currentPassword||!newPassword||newPassword===currentPassword)
      throw new Error('Invalid password change');
    const passwordHash=await this.hashPassword(newPassword);
    await this.db.transaction(async client=>{
      const result=await client.query<{password_hash:string}>(
        'SELECT password_hash FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true FOR UPDATE',
        [tenantId,userId]);
      if(!result.rows[0]||!(await this.verifyPassword(currentPassword,result.rows[0].password_hash)))
        throw new Error('Invalid credentials');
      const policy=await checkPasswordHistory(client,tenantId,userId,newPassword,result.rows[0].password_hash,this.verifyPassword.bind(this));
      await retainPasswordHistory(client,tenantId,userId,result.rows[0].password_hash,policy.history_count);
      await client.query('UPDATE md_users SET password_hash=$3,password_changed_at=now(),failed_login_attempts=0 WHERE tenant_id=$1 AND id=$2',
        [tenantId,userId,passwordHash]);
      await client.query('UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,userId]);
      await client.query('UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[tenantId,userId]);
      await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action) VALUES($1,$2,$2,'PasswordChanged')",[tenantId,userId]);
      await client.query('UPDATE md_password_reset_challenges SET consumed_at=now() WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL',[tenantId,userId]);
      await client.query('UPDATE md_mfa_login_challenges SET consumed_at=now() WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL',[tenantId,userId]);
    });
  }
  async signOut(token:string,_refreshToken?:string) {
    await this.db.query(`WITH identity AS (
      SELECT tenant_id,user_id,family_id FROM md_sessions WHERE token_hash=$1
    ), revoked AS (
      UPDATE md_sessions s SET revoked_at=now() FROM identity i
      WHERE s.tenant_id=i.tenant_id AND s.user_id=i.user_id AND s.family_id=i.family_id RETURNING s.id
    ) UPDATE md_refresh_sessions r SET revoked_at=now() FROM identity i
      WHERE r.tenant_id=i.tenant_id AND r.user_id=i.user_id AND r.family_id=i.family_id`,[fingerprint(token)]);
  }
}
