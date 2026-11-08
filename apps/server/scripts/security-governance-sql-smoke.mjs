import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {withSqlTestConnection} from './login-password-policy-sql-smoke.mjs';
import {AuthenticationService} from '../dist-system/system-files/authentication.js';
import {RbacEngine} from '../dist-system/system-files/rbac-engine.js';
import {LicenseService} from '../dist-system/system-support/license-service.js';
import {ConnectedAppService} from '../dist-system/system-support/connected-app-service.js';
import {SecurityMonitorService} from '../dist-system/system-support/security-monitor-service.js';
import {SetupAuditService} from '../dist-system/system-support/setup-audit-service.js';
import {SqlPersistence} from '../dist-system/system-files/sql-persistence.js';
import {createSystemServer} from '../dist-system/system-support/server.js';
import {once} from 'node:events';
import {AsyncLocalStorage} from 'node:async_hooks';
const digest=v=>createHash('sha256').update(v).digest('hex');
const migrations=new URL('../src/system-support/migrations/',import.meta.url);
export async function verifySecurityGovernanceSql(db){
 const schema='governance_test_'+Date.now();await db.query(`CREATE SCHEMA ${schema}`);
 try{
  await db.query(`SET search_path TO ${schema},public`);
  // Test schemas do not install cluster-wide extensions. gen_random_uuid is built in.
  const sql=n=>readFileSync(n,'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/g,'');
  await db.query(sql(new URL('../src/system-files/schema.sql',import.meta.url)));
  // schema.sql is the current full schema: it already contains the credential FK.
  // Adapt only this test's full-schema replay; never rewrite an applied migration
  // (production validates each applied file's immutable SHA-256 checksum).
  const replay=async(minVersion='')=>{
   for(const n of readdirSync(migrations).filter(n=>n.endsWith('.sql')&&n>=minVersion).sort()){
    let source=sql(new URL(n,migrations));
    if(n==='20261127-credential-webhooks.sql'){
     source=source.replace(
      /ALTER TABLE md_inbound_webhook_endpoints\s+ADD CONSTRAINT md_inbound_webhook_credential_fk\s+FOREIGN KEY \(tenant_id,credential_id\)\s+REFERENCES md_named_credentials\(tenant_id,id\) ON DELETE CASCADE;/,
      `DO $test_replay$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname='md_inbound_webhook_credential_fk'
            AND conrelid='md_inbound_webhook_endpoints'::regclass) THEN
          ALTER TABLE md_inbound_webhook_endpoints
            ADD CONSTRAINT md_inbound_webhook_credential_fk
            FOREIGN KEY (tenant_id,credential_id)
            REFERENCES md_named_credentials(tenant_id,id) ON DELETE CASCADE;
        END IF;
       END $test_replay$;`);
    }
    await db.query(source);
   }
  };
  await replay();
  const tenant=(await db.query("INSERT INTO md_tenants(slug,name,status) VALUES('governance','Governance test','ACTIVE') RETURNING id")).rows[0].id;
  const other=(await db.query("INSERT INTO md_tenants(slug,name,status) VALUES('other','Other test','ACTIVE') RETURNING id")).rows[0].id;
  const auth=new AuthenticationService(db),rbac=new RbacEngine(db),licenses=new LicenseService(db,rbac),connected=new ConnectedAppService(db,auth,rbac),monitor=new SecurityMonitorService(db,rbac);
  const password=await auth.hashPassword('GovernancePassword!2026');
  const addUser=async(t,email)=>(await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',[t,email,password])).rows[0].id;
  const admin=await addUser(tenant,'admin@test.example'),user=await addUser(tenant,'user@test.example'),foreign=await addUser(other,'foreign@test.example');
  const addSet=async(name)=>(await db.query('INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,$2) RETURNING id',[tenant,name])).rows[0].id;
  const full=await addSet('OneEngine'),limited=await addSet('Restricted');
  await db.query("INSERT INTO md_permission_rules VALUES($1,$2,'*','*','allow'),($1,$3,'API','execute','allow')",[tenant,full,limited]);
  await db.query('INSERT INTO md_permission_assignments VALUES($1,$2,$3),($1,$4,$5)',[tenant,admin,full,user,limited]);
  assert.equal(await rbac.allowed(tenant,admin,'ConnectedApp','manage'),true);
  await assert.rejects(()=>licenses.issue(tenant,user,{tenantId:other,license_key:'Escalation',label:'Bad',kind:'User',enabled:true,seat_limit:null,expires_at:null,capabilities:[{resource:'*',action:'*'}]}),/Permission denied/);
  const entitlement=(await db.query("INSERT INTO md_license_entitlements(tenant_id,license_key,label,kind,seat_limit) VALUES($1,'APIAddOn','API add-on','PermissionSet',1) RETURNING id",[tenant])).rows[0].id;
  await licenses.requirement(tenant,admin,{permission_set_id:limited,entitlement_id:entitlement,required:true});
  assert.equal(await rbac.allowed(tenant,user,'API','execute'),false);
  await licenses.assign(tenant,admin,{user_id:user,entitlement_id:entitlement,assigned:true});
  assert.equal(await rbac.allowed(tenant,user,'API','execute'),true);
  await assert.rejects(()=>licenses.assign(tenant,admin,{user_id:admin,entitlement_id:entitlement,assigned:true}),/seats exhausted/);
  await assert.rejects(()=>licenses.assign(tenant,admin,{user_id:foreign,entitlement_id:entitlement,assigned:true}));
  await db.query("INSERT INTO md_permission_rules VALUES($1,$2,'ObjectDefinition','read','deny')",[tenant,limited]);
  await licenses.assign(tenant,admin,{user_id:user,entitlement_id:entitlement,assigned:false});
  assert.equal((await db.query("SELECT deny_granted FROM md_rbac_decision($1,$2,'ObjectDefinition','read')",[tenant,user])).rows[0].deny_granted,true);
  const core=(await db.query("SELECT id FROM md_license_entitlements WHERE tenant_id=$1 AND license_key='CoreFull'",[tenant])).rows[0].id;
  const session=await auth.issuePasswordSession(tenant,user);
  await licenses.assign(tenant,admin,{user_id:user,entitlement_id:core,assigned:false});
  await assert.rejects(()=>auth.authenticate(session.accessToken),/Invalid session/);
  await replay('20261123');
  assert.equal((await db.query('SELECT md_user_licensed($1,$2) AS yes',[tenant,user])).rows[0].yes,false,'migration replay must preserve licence revocation');
  await licenses.assign(tenant,admin,{user_id:user,entitlement_id:core,assigned:true});
  await licenses.assign(tenant,admin,{user_id:user,entitlement_id:entitlement,assigned:true});
  await db.query('UPDATE md_license_entitlements SET enabled=false WHERE tenant_id=$1 AND id=$2',[tenant,core]);
  await assert.rejects(()=>auth.issuePasswordSession(tenant,user),/Invalid credentials/);
  await db.query('UPDATE md_license_entitlements SET enabled=true WHERE tenant_id=$1 AND id=$2',[tenant,core]);
  await db.query("INSERT INTO md_object_definitions(tenant_id,api_name,label) VALUES($1,'AuditContact','Audit Contact')",[tenant]);
  const record=(await db.query("INSERT INTO md_records(tenant_id,object_api,owner_id) VALUES($1,'AuditContact',$2) RETURNING id",[tenant,admin])).rows[0].id;
  await db.query("INSERT INTO md_permission_rules VALUES($1,$2,'AuditContact','read','allow'),($1,$2,'AuditContact','edit','allow')",[tenant,limited]);
  const recordAllowed=async(action)=>(await db.query('SELECT md_record_access($1,$2,$3,$4) AS yes',[tenant,user,record,action])).rows[0].yes;
  assert.equal(await recordAllowed('read'),false);
  await db.query("INSERT INTO md_permission_rules VALUES($1,$2,'Record','viewAll','allow')",[tenant,limited]);
  assert.equal(await recordAllowed('read'),true);assert.equal(await recordAllowed('edit'),false);
  await db.query("INSERT INTO md_permission_rules VALUES($1,$2,'Record','modifyAll','allow')",[tenant,limited]);
  assert.equal(await recordAllowed('edit'),true);
  await db.query("INSERT INTO md_permission_rules VALUES($1,$2,$3,'edit','deny')",[tenant,limited,'Record:'+record]);
  assert.equal(await recordAllowed('edit'),false,'Modify All Data must preserve explicit record denies');
  assert.equal((await db.query("SELECT md_record_access($1,$2,$3,'read') AS yes",[other,foreign,record])).rows[0].yes,false);
  const correlation=randomUUID();
  await db.transaction(async c=>{
   await c.query("SELECT set_config('metadrive.actor_tenant',$1,true),set_config('metadrive.actor_user',$2,true),set_config('metadrive.correlation_id',$3,true)",[tenant,admin,correlation]);
   await c.query("UPDATE md_users SET password_hash='NEVER-STORE-THIS-SECRET' WHERE id=$1",[user]);
  });
  const trail=await db.query('SELECT * FROM md_setup_audit_events WHERE correlation_id=$1',[correlation]);
  assert.equal(trail.rows.length,1);assert.equal(trail.rows[0].actor_user_id,admin);assert.ok(trail.rows[0].changed_fields.includes('password_hash'));
  assert.equal(JSON.stringify(trail.rows).includes('NEVER-STORE'),false);
  await assert.rejects(()=>db.query('DELETE FROM md_setup_audit_events'),/append-only/);
  await assert.rejects(()=>db.query('TRUNCATE md_setup_audit_events'),/append-only/);
  const audit=new SetupAuditService(db,rbac);assert.ok((await audit.coverage(tenant,admin)).some(t=>t.table_name==='md_flow_editor_values'));
  assert.ok((await audit.list(tenant,admin)).events.every(e=>e.tenant_id===tenant));
  const count=Number((await db.query('SELECT count(*) AS n FROM md_setup_audit_events')).rows[0].n);
  await assert.rejects(()=>db.transaction(async c=>{await c.query("UPDATE md_users SET email='rollback@example.test' WHERE id=$1",[user]);throw Error('rollback');}));
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM md_setup_audit_events')).rows[0].n),count);
  const input={actor:{tenant_id:tenant,user_id:admin},correlationId:randomUUID(),eventType:'api',path:'/api/records/Contact',method:'GET',ip:'203.0.113.8'};
  await monitor.saveRule(tenant,admin,{label:'Block request burst',enabled:true,event_type:'api',method:'GET',path_prefix:'/api/records',threshold:2,window_seconds:60,response:'Block'});
  assert.equal((await monitor.enforce(input)).blocked,false);const blocked=await monitor.enforce(input);assert.equal(blocked.blocked,true);
  await monitor.complete(tenant,blocked.id,403,5);assert.equal((await monitor.describe(tenant,admin)).summary.errors,1);
  await db.query("INSERT INTO md_flow_definitions(tenant_id,api_name,label,flow_type,version,active) VALUES($1,'SecurityResponse','Security Response','Autolaunched Flow',1,true)",[tenant]);
  await monitor.saveRule(tenant,admin,{label:'Flow response',enabled:true,event_type:'api',method:'GET',path_prefix:'/api/records',threshold:1,window_seconds:60,response:'Flow',flow_api:'SecurityResponse',service_user_id:admin});
  await monitor.enforce(input);await monitor.enforce(input);
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM md_durable_jobs WHERE tenant_id=$1 AND job_type='flow.execute'",[tenant])).rows[0].n),1,'only one Flow job per user/rule/window');
  const flowRule=(await monitor.describe(tenant,admin)).rules.find(r=>r.response==='Flow');
  await monitor.saveRule(tenant,admin,{...flowRule,enabled:false});
  assert.equal((await db.query("SELECT status FROM md_durable_jobs WHERE tenant_id=$1 AND job_type='flow.execute'",[tenant])).rows[0].status,'cancelled');
  const revoked=await auth.issueMfaSession(tenant,admin);
  await monitor.saveRule(tenant,admin,{label:'Revoke response',enabled:true,event_type:'metadata',method:'PUT',path_prefix:'/api/metadata',threshold:1,window_seconds:60,response:'RevokeSessions'});
  assert.equal((await monitor.enforce({...input,eventType:'metadata',method:'PUT',path:'/api/metadata/objects'})).blocked,true);
  await assert.rejects(()=>auth.authenticate(revoked.accessToken),/Invalid session/);
  const client=await connected.save(tenant,admin,{label:'Test public app',enabled:true,client_type:'public',require_mfa:true,redirects:['https://client.example.test/callback'],scopes:['records:read'],users:[admin]});
  const verifier='V'.repeat(64),request={client_id:client.id,redirect_uri:'https://client.example.test/callback',response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:'state-'.repeat(8),scope:'records:read'};
  const normal=await auth.issuePasswordSession(tenant,admin);
  await assert.rejects(()=>connected.grant(tenant,admin,normal.accessToken,request,true),/MFA required/);
  const mfa=await auth.issueMfaSession(tenant,admin);
  await assert.rejects(()=>connected.consent(other,foreign,request),/Invalid OAuth client/);
  await assert.rejects(()=>connected.consent(tenant,admin,{...request,redirect_uri:'https://evil.example/callback'}),/Invalid OAuth/);
  await assert.rejects(()=>connected.consent(tenant,admin,{...request,scope:'records:write'}),/Invalid OAuth scope/);
  const grant=await connected.grant(tenant,admin,mfa.accessToken,request,true),code=new URL(grant.redirect).searchParams.get('code');
  const exchange={grant_type:'authorization_code',client_id:client.id,code,redirect_uri:request.redirect_uri,code_verifier:verifier};
  await assert.rejects(()=>connected.exchange({...exchange,code_verifier:'X'.repeat(64)}),/Invalid OAuth grant/);
  const token=await connected.exchange(exchange);await assert.rejects(()=>connected.exchange(exchange),/Invalid OAuth grant/);
  await auth.authenticate(token.access_token,{path:'/api/records/Contact',method:'GET'});
  await assert.rejects(()=>auth.authenticate(token.access_token,{path:'/api/security/licenses',method:'GET'}),/Invalid session/);
  await assert.rejects(()=>auth.authenticate(token.access_token,{path:'/api/records/Contact',method:'POST'}),/Invalid session/);
  await assert.rejects(()=>auth.refresh(token.refresh_token),/Invalid session/);
  const refresh={grant_type:'refresh_token',client_id:client.id,refresh_token:token.refresh_token};
  const rotated=await connected.refresh(refresh);await auth.authenticate(rotated.access_token,{path:'/api/records/Contact',method:'GET'});
  await assert.rejects(()=>connected.refresh(refresh),/refresh replay/);
  await assert.rejects(()=>auth.authenticate(rotated.access_token,{path:'/api/records/Contact',method:'GET'}),/Invalid session/);
  assert.equal(await connected.originAllowed('https://client.example.test'),true);assert.equal(await connected.originAllowed('https://evil.example'),false);
  const secretClient=await connected.save(tenant,admin,{label:'Confidential test',enabled:true,client_type:'confidential',require_mfa:false,redirects:[request.redirect_uri],scopes:['records:read'],users:[admin]});
  assert.equal(secretClient.clientSecret.length,43);assert.equal((await connected.describe(tenant,admin)).clients.some(c=>'secret_hash' in c),false);
  assert.notEqual((await db.query('SELECT secret_hash FROM md_oauth_clients WHERE id=$1',[secretClient.id])).rows[0].secret_hash,secretClient.clientSecret);
  // Granular OAuth scopes are platform-owned SQL metadata, scoped per client.
  const catalogue=await connected.describe(tenant,admin);
  assert.ok(catalogue.scopeGroups.length>=10);
  assert.ok(catalogue.scopeGroups.flatMap(group=>group.scopes).length>=80);
  assert.ok(catalogue.scopeGroups.some(group=>group.label.includes('Builders')));
  const sqlDiagnostic=catalogue.scopeGroups.flatMap(group=>group.scopes)
   .find(item=>item.scope==='sql:diagnostics');
  assert.equal(sqlDiagnostic?.assignable,false,'unsupported diagnostics cannot be granted');
  const scopeConfig={label:'Builder read-only client',enabled:true,client_type:'public',
   require_mfa:true,redirects:['https://client.example.test/builder-callback'],
   scopes:['pages:read','flows:read'],users:[admin]};
  const builderClient=await connected.save(tenant,admin,scopeConfig);
  await assert.rejects(()=>connected.save(tenant,admin,{...scopeConfig,
   id:builderClient.id,scopes:['sql:diagnostics']}),/Invalid or unavailable OAuth scope/);
  const requested={client_id:builderClient.id,redirect_uri:scopeConfig.redirects[0],
   response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),
   code_challenge_method:'S256',state:'builder-state-'.repeat(4),scope:'pages:read flows:read'};
  const allowedSession=await auth.issueMfaSession(tenant,admin);
  const grantBuilder=await connected.grant(tenant,admin,allowedSession.accessToken,requested,true);
  const builderToken=await connected.exchange({grant_type:'authorization_code',
   client_id:builderClient.id,code:new URL(grantBuilder.redirect).searchParams.get('code'),
   redirect_uri:scopeConfig.redirects[0],code_verifier:verifier});
  await auth.authenticate(builderToken.access_token,{path:'/api/metadata/pages',method:'GET'});
  await auth.authenticate(builderToken.access_token,{path:'/api/metadata/flows',method:'GET'});
  await assert.rejects(()=>auth.authenticate(builderToken.access_token,
   {path:'/api/metadata/pages',method:'POST'}),/Invalid session/);
  await assert.rejects(()=>auth.authenticate(builderToken.access_token,
   {path:'/api/records/User',method:'GET'}),/Invalid session/);
  await assert.rejects(()=>auth.authenticate(builderToken.access_token,
   {path:'/api/security/connected-apps',method:'GET'}),/Invalid session/);
  await verifyMcpSql(db,{tenant,admin,auth,connected,verifier});
  await verifyHttpBoundary(db,{tenant,admin,auth,connected,request,exchange,verifier});
  console.log('Governance SQL: full schema, migrations/replay, licensing/seats/denies, audit redaction/rollback, monitoring and OAuth PKCE/consent/scope/refresh replay passed');
 }finally{await db.query('SET search_path TO public');await db.query(`DROP SCHEMA ${schema} CASCADE`);}
}
async function verifyHttpBoundary(db,{tenant,admin,auth,connected,request,exchange}){
 // Exercise actual SqlPersistence request context/transactions on the isolated
 // connection. Serialise the pool adapter so concurrent HTTP completions cannot
 // run statements inside one another's test transactions.
 let tail=Promise.resolve();
 const lock=async()=>{let release;const previous=tail;tail=new Promise(r=>{release=r;});await previous;return release;};
 const requestDb=Object.create(SqlPersistence.prototype);
 // The test adapter bypasses the constructor, so initialize its transaction context.
 requestDb.activeTransaction=new AsyncLocalStorage();
 requestDb.pool={query:async(sql,args)=>{const release=await lock();try{return await db.query(sql,args);}finally{release();}},connect:async()=>{const release=await lock();return {query:(sql,args)=>db.query(sql,args),release};}};
 await db.query('UPDATE md_transaction_security_rules SET enabled=false WHERE tenant_id=$1',[tenant]);
 const normal=await auth.issueMfaSession(tenant,admin);
 const newGrant=await connected.grant(tenant,admin,normal.accessToken,request,true);
 const code=new URL(newGrant.redirect).searchParams.get('code');
 const server=createSystemServer(requestDb).listen(0,'127.0.0.1');
 try{
  if(!server.listening)await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const tokenResponse=await fetch(base+'/api/oauth/token',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://client.example.test'},body:JSON.stringify({...exchange,code})});
  assert.equal(tokenResponse.status,200);assert.equal(tokenResponse.headers.get('access-control-allow-credentials'),null);
  const token=await tokenResponse.json();
  const read=await fetch(base+'/api/records/AuditContact',{headers:{Authorization:'Bearer '+token.access_token,Origin:'https://client.example.test'}});
  assert.equal(read.status,200,await read.text());
  const denied=await fetch(base+'/api/security/permissions',{headers:{Authorization:'Bearer '+token.access_token}});assert.equal(denied.status,401);
  const alien=await fetch(base+'/api/records/AuditContact',{headers:{Authorization:'Bearer '+token.access_token,Origin:'https://evil.example'}});assert.equal(alien.status,403);
  const save=await fetch(base+'/api/security/monitoring',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+normal.accessToken},body:JSON.stringify({enabled:false,retention_days:90})});
  assert.equal(save.status,200,await save.text());const correlation=save.headers.get('x-correlation-id');assert.ok(correlation);
  const audit=await requestDb.query("SELECT actor_user_id FROM md_setup_audit_events WHERE correlation_id=$1 AND table_name='md_monitor_settings'",[correlation]);assert.equal(audit.rows[0]?.actor_user_id,admin);
  // SQL audit context must not interfere with the RBAC snapshot isolation level.
  const permissions=await fetch(base+'/api/metadata/permissions',{headers:{Authorization:'Bearer '+normal.accessToken}});assert.equal(permissions.status,200,await permissions.text());
 }finally{server.closeIdleConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await tail;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await withSqlTestConnection(verifySecurityGovernanceSql);

async function verifyMcpSql(db,{tenant,admin,auth,connected,verifier}){
 const previous=process.env.METADRIVE_MCP_ORIGIN;
 process.env.METADRIVE_MCP_ORIGIN='https://api.example.test';
 try{
  const resource='https://api.example.test/api/mcp';
  const config={label:'MCP SQL test',enabled:true,client_type:'public',require_mfa:true,redirects:['https://client.example.test/mcp-callback'],scopes:['mcp:access','records:read'],users:[admin]};
  const client=await connected.save(tenant,admin,config);
  const request={client_id:client.id,redirect_uri:config.redirects[0],response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:'mcp-state-'.repeat(4),scope:'mcp:access records:read',resource};
  // ChatGPT may send OAuth extensions such as prompt/login_hint. Unknown fields
  // must not break consent, while the validated request is stripped to safe keys.
  const extended=await connected.consent(tenant,admin,{...request,prompt:'consent',login_hint:'admin@example.test'});
  assert.equal(extended.request.client_id,client.id);
  assert.equal('prompt' in extended.request,false);
  await assert.rejects(()=>connected.consent(tenant,admin,{...request,code_challenge_method:'plain'}),/Invalid OAuth authorization request/);
  await assert.rejects(()=>connected.consent(tenant,admin,{...request,resource:'https://evil.example/mcp'}),/Invalid OAuth resource/);
  const session=await auth.issueMfaSession(tenant,admin);
  const grant=await connected.grant(tenant,admin,session.accessToken,request,true);
  const exchange={grant_type:'authorization_code',client_id:client.id,code:new URL(grant.redirect).searchParams.get('code'),redirect_uri:request.redirect_uri,code_verifier:verifier,resource};
  await assert.rejects(()=>connected.exchange({...exchange,resource:undefined}),/Invalid OAuth grant/);
  const token=await connected.exchange(exchange);
  const actor=await auth.authenticate(token.access_token,{path:'/api/mcp',method:'POST'});
  assert.equal(actor.tenant_id,tenant);assert.equal(actor.user_id,admin);
  await assert.rejects(()=>auth.authenticate(token.access_token,{path:'/api/security/licenses',method:'GET'}),/Invalid session/);
  await assert.rejects(()=>connected.refresh({grant_type:'refresh_token',client_id:client.id,refresh_token:token.refresh_token,resource:'https://evil.example/mcp'}),/Invalid OAuth grant/);
  const refreshed=await connected.refresh({grant_type:'refresh_token',client_id:client.id,refresh_token:token.refresh_token,resource});
  await auth.authenticate(refreshed.access_token,{path:'/api/mcp',method:'POST'});
  await connected.save(tenant,admin,{...config,id:client.id,enabled:false});
  await assert.rejects(()=>auth.authenticate(refreshed.access_token,{path:'/api/mcp',method:'POST'}),/Invalid session/);
  assert.equal((await db.query('SELECT resource FROM md_oauth_consents WHERE tenant_id=$1 AND client_id=$2',[tenant,client.id])).rows[0].resource,resource);
 }finally{if(previous===undefined)delete process.env.METADRIVE_MCP_ORIGIN;else process.env.METADRIVE_MCP_ORIGIN=previous;}
}
