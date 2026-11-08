import {readBaselineMigration} from './baseline-sql-section.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {pathToFileURL} from 'node:url';
import {verifyLoginPasswordSql,withSqlTestConnection} from './login-password-policy-sql-smoke.mjs';
import {SessionPolicyService,enforceLoginBoundary,readSessionPolicy} from '../dist-system/system-support/session-policy-service.js';
import {MfaService,base32,totpAt} from '../dist-system/system-support/mfa-service.js';
import {MfaBackupService,consumeBackupCode} from '../dist-system/system-support/mfa-backup-service.js';
import {FederationService} from '../dist-system/system-support/federation-service.js';
import {WebAuthnService} from '../dist-system/system-support/webauthn-service.js';
import {syntheticPasskey,signedSamlResponse,testIdpCertificate} from './identity-test-assertions.mjs';
export async function verifyIdentitySessionSql(db){
 await verifyLoginPasswordSql(db,async({tenant,other,user,foreign,auth})=>{
  const allow={require:async()=>{}},vault={
   encryptOpaque:v=>({ciphertext:Buffer.from(v),keyId:'test'}),
   decryptOpaque:b=>Buffer.from(b).toString(),
   manageFederationCredentials:async(client,tenant,providerId,tokenUrl,jwksUrl)=>{
    const suffix=providerId.replaceAll('-','');
    const token=await client.query(`INSERT INTO md_named_credentials
     (tenant_id,name,label,protocol,base_url,auth_type,header_name,enabled,encryption_key_id)
     VALUES($1,$2,$3,'HTTPS',$4,'None','',true,'test') RETURNING id`,
     [tenant,'Federation_'+suffix+'_Token','Federation token',tokenUrl]);
    const jwks=await client.query(`INSERT INTO md_named_credentials
     (tenant_id,name,label,protocol,base_url,auth_type,header_name,enabled,encryption_key_id)
     VALUES($1,$2,$3,'HTTPS',$4,'None','',true,'test') RETURNING id`,
     [tenant,'Federation_'+suffix+'_Jwks','Federation JWKS',jwksUrl]);
    await client.query(`UPDATE md_identity_providers SET token_credential_id=$3,
     jwks_credential_id=$4 WHERE tenant_id=$1 AND id=$2`,
     [tenant,providerId,token.rows[0].id,jwks.rows[0].id]);
   },
   identityProviderJson:async(_tenant,_provider,endpoint,body)=>{
    if(endpoint==='jwks')return {keys:[jwk]};
    assert.ok(body.get('code_verifier'));return {id_token:await new SignJWT({nonce:signedNonce||nonce})
     .setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience('client')
     .setSubject('external-subject').setIssuedAt().setExpirationTime('2m').sign(privateKey)};
   }
  };
  const sessions=new SessionPolicyService(db,allow),mfa=new MfaService(db,allow,auth,vault),backups=new MfaBackupService(db,auth,mfa,allow);
  const migration=readBaselineMigration('20261122-identity-session-controls.sql');
  const federationCredentialsMigration=readBaselineMigration('20261201-federation-named-credentials.sql');
  await db.query(migration);await db.query(federationCredentialsMigration);await db.query('UPDATE md_password_policies SET max_age_days=0 WHERE tenant_id=$1',[tenant]);
  await db.query('UPDATE md_users SET password_changed_at=now() WHERE id=$1',[user]);
  await db.query('CREATE TABLE md_tenant_domains(domain text PRIMARY KEY,tenant_id uuid)');
  await db.query("INSERT INTO md_tenant_domains VALUES('tenant.example.test',$1)",[tenant]);
  const defaults={...(await sessions.read(tenant,user)),ranges:[],hours:[]};delete defaults.profiles;
  await sessions.save(tenant,user,{...defaults,ranges:[{kind:'login',profile_id:null,network:'203.0.113.0/24'},{kind:'trusted',profile_id:null,network:'198.51.100.0/24'}]});
  await enforceLoginBoundary(db,tenant,user,{ip:'203.0.113.5'});
  await assert.rejects(()=>enforceLoginBoundary(db,tenant,user,{ip:'198.51.100.5'}),/login restrictions/);
  await assert.rejects(()=>enforceLoginBoundary(db,tenant,user,{}),/login restrictions/);
  await enforceLoginBoundary(db,other,foreign,{ip:'198.51.100.5'});
  const profile=(await db.query("INSERT INTO md_profiles(tenant_id,label) VALUES($1,'Restricted') RETURNING id",[tenant])).rows[0].id;
  await db.query('INSERT INTO md_user_profiles VALUES($1,$2,$3)',[tenant,user,profile]);
  await sessions.save(tenant,user,{...defaults,ranges:[{kind:'login',profile_id:null,network:'203.0.113.0/24'},{kind:'login',profile_id:profile,network:'198.51.100.0/24'}]});
  await assert.rejects(()=>enforceLoginBoundary(db,tenant,user,{ip:'203.0.113.5'}),/login restrictions/);
  const tomorrow=(Number((await db.query('SELECT extract(isodow FROM now()) AS day')).rows[0].day)%7)+1;
  await sessions.save(tenant,user,{...defaults,hours:[{profile_id:profile,weekday:tomorrow,start_minute:0,end_minute:1440,timezone:'UTC'}]});
  await assert.rejects(()=>enforceLoginBoundary(db,tenant,user,{ip:'203.0.113.5'}),/login restrictions/);
  await sessions.save(tenant,user,defaults);
  const first=await auth.issuePasswordSession(tenant,user),second=await auth.issuePasswordSession(tenant,user);
  const {createHash}=await import('node:crypto'),digest=s=>createHash('sha256').update(s).digest('hex');
  await db.query("UPDATE md_sessions SET last_seen_at=now()-interval '61 minutes' WHERE token_hash=$1",[digest(first.accessToken)]);
  await assert.rejects(()=>auth.authenticate(first.accessToken),/Invalid session/);
  await auth.authenticate(second.accessToken);
  await db.query("UPDATE md_refresh_sessions SET absolute_expires_at=now()+interval '100 seconds' WHERE token_hash=$1",[digest(second.refreshToken)]);
  const rotated=await auth.refresh(second.refreshToken);assert.ok(rotated.expiresIn<=100&&rotated.expiresIn>0);
  await assert.rejects(()=>auth.refresh(second.refreshToken),/Invalid session/);
  await sessions.save(tenant,user,{...defaults,policy:{...defaults.policy,require_mfa:true}});
  await assert.rejects(()=>auth.authenticate(rotated.accessToken),/Invalid session/);
  await assert.rejects(()=>auth.issuePasswordSession(tenant,user),/MFA required/);
  const secret=base32(Buffer.from('12345678901234567890'));
  await db.query('INSERT INTO md_user_mfa_secrets(tenant_id,user_id,secret_ciphertext,key_id) VALUES($1,$2,$3,$4)',[tenant,user,Buffer.from(secret),'test']);
  const code=totpAt(secret,Math.floor(Date.now()/30000));
  const challenge=await mfa.createChallenge(tenant,user);
  const verified=await mfa.verifyChallenge(challenge.challenge_token,code);assert.ok(verified.accessToken);
  await auth.signOut(verified.accessToken,verified.refreshToken);
  await assert.rejects(()=>auth.authenticate(verified.accessToken),/Invalid session/);
  await assert.rejects(()=>auth.refresh(verified.refreshToken),/Invalid session/);
  await assert.rejects(()=>mfa.verifyChallenge(challenge.challenge_token,code),/Invalid MFA challenge/);
  await db.query('UPDATE md_user_mfa_secrets SET last_counter=-1 WHERE tenant_id=$1 AND user_id=$2',[tenant,user]);
  const generated=await backups.regenerate(tenant,user,'ThirdPassword!2026',totpAt(secret,Math.floor(Date.now()/30000)));
  assert.equal(generated.codes.length,10);
  const next=await mfa.createChallenge(tenant,user);
  await mfa.verifyChallenge(next.challenge_token,generated.codes[0]);
  assert.equal(await consumeBackupCode(db,tenant,user,generated.codes[0]),false);
  assert.equal(await consumeBackupCode(db,other,foreign,generated.codes[1]),false);
  assert.ok(!(await db.query('SELECT code_hash FROM md_mfa_backup_codes')).rows.some(r=>generated.codes.includes(r.code_hash)));
  const keys=new WebAuthnService(db,auth);
  await assert.rejects(()=>keys.registrationOptions(tenant,user,'https://foreign.example.test','ThirdPassword!2026'),/Invalid WebAuthn origin/);
  const request=await keys.registrationOptions(tenant,user,'https://tenant.example.test','ThirdPassword!2026');
  await assert.rejects(()=>keys.register(tenant,user,request.token,{},'Invalid'),/./);
  assert.equal((await keys.list(tenant,user)).length,0);
  const device=syntheticPasskey();
  await keys.register(tenant,user,request.token,device.register(request.options,'https://tenant.example.test'),'Test authenticator');
  const keyParent=await mfa.createChallenge(tenant,user),keyOptions=await keys.authenticationOptions(keyParent.challenge_token,'https://tenant.example.test');
  const keyResponse=device.authenticate(keyOptions.options,'https://tenant.example.test');
  const keySession=await keys.authenticate(keyOptions.token,keyResponse);assert.ok(keySession.accessToken);
  await assert.rejects(()=>keys.authenticate(keyOptions.token,keyResponse),/Invalid passkey challenge/);
  const badParent=await mfa.createChallenge(tenant,user),badOptions=await keys.authenticationOptions(badParent.challenge_token,'https://tenant.example.test');
  await assert.rejects(()=>keys.authenticate(badOptions.token,device.authenticate(badOptions.options,'https://foreign.example.test',2)),/origin/);
  const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test';
  const issuer='https://identity.example.test';let nonce='',signedNonce='';
  const federation=new FederationService(db,allow,vault);
  const old=process.env.METADRIVE_AUTH_PUBLIC_ORIGIN;process.env.METADRIVE_AUTH_PUBLIC_ORIGIN='https://api.example.test';
  try{
   await federation.save(tenant,user,{label:'Test OIDC',protocol:'oidc',enabled:true,issuer,authorization_url:issuer+'/authorize',token_url:issuer+'/token',jwks_url:issuer+'/keys',client_id:'client'});
   const provider=(await federation.list(tenant,user))[0];
   await federation.link(tenant,user,{provider_id:provider.id,user_id:user,subject:'external-subject'});
   const start=await federation.start(tenant,provider.id,'https://tenant.example.test','browser');nonce=new URL(start.url).searchParams.get('nonce');
   assert.equal(new URL(start.url).searchParams.get('code_challenge_method'),'S256');
   await assert.rejects(()=>federation.callback(start.state,'foreign-browser','code'),/Invalid federation state/);
   const result=await federation.callback(start.state,'browser','code');assert.equal(result.origin,'https://tenant.example.test');
   await assert.rejects(()=>federation.complete(result.ticket,other),/Invalid federation ticket/);
   assert.equal(await federation.complete(result.ticket,tenant),user);
   await assert.rejects(()=>federation.complete(result.ticket,tenant),/Invalid federation ticket/);
   await assert.rejects(()=>federation.callback(start.state,'browser','code'),/Invalid federation state/);
   const bad=await federation.start(tenant,provider.id,'https://tenant.example.test','browser');signedNonce='wrong';
   await assert.rejects(()=>federation.callback(bad.state,'browser','code'),/Invalid OIDC nonce/);
   await federation.save(tenant,user,{label:'Test SAML',protocol:'saml',enabled:true,issuer,authorization_url:issuer+'/sso',certificate:testIdpCertificate()});
   const saml=(await federation.list(tenant,user)).find(p=>p.protocol==='saml');
   await federation.link(tenant,user,{provider_id:saml.id,user_id:user,subject:'saml-subject'});
   const samlStart=await federation.start(tenant,saml.id,'https://tenant.example.test','browser');
   const req=(await db.query('SELECT request_id FROM md_saml_request_ids WHERE tenant_id=$1 AND provider_id=$2',[tenant,saml.id])).rows[0].request_id;
   const callback='https://api.example.test/api/auth/federation/callback';
   const assertion=signedSamlResponse({issuer,callback,audience:callback+'/'+saml.id,requestId:req,subject:'saml-subject'});
   const samlTicket=await federation.callback(samlStart.state,'browser',null,assertion);
   assert.equal(await federation.complete(samlTicket.ticket,tenant),user);
   await assert.rejects(()=>federation.callback(samlStart.state,'browser',null,assertion),/Invalid federation state/);
   const swapped=await federation.start(tenant,saml.id,'https://tenant.example.test','browser');
   await assert.rejects(()=>federation.callback(swapped.state,'browser',null,assertion),/./);
  }finally{if(old===undefined)delete process.env.METADRIVE_AUTH_PUBLIC_ORIGIN;else process.env.METADRIVE_AUTH_PUBLIC_ORIGIN=old;}
  await db.query(migration);assert.equal((await readSessionPolicy(db,tenant)).require_mfa,true);
  await db.query('UPDATE md_user_mfa_secrets SET last_counter=-1 WHERE tenant_id=$1 AND user_id=$2',[tenant,user]);
  await assert.rejects(()=>backups.reset(tenant,user,foreign,'ThirdPassword!2026',totpAt(secret,Math.floor(Date.now()/30000))),/User not found/);
  const recovered=(await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',[tenant,'recovery@example.test',await auth.hashPassword('TemporaryPassword!2026')])).rows[0].id;
  await db.query('INSERT INTO md_user_mfa_secrets(tenant_id,user_id,secret_ciphertext,key_id) VALUES($1,$2,$3,$4)',[tenant,recovered,Buffer.from(secret),'test']);
  const recoverySession=await auth.issueMfaSession(tenant,recovered);
  await db.query('UPDATE md_user_mfa_secrets SET last_counter=-1 WHERE tenant_id=$1 AND user_id=$2',[tenant,user]);
  await backups.reset(tenant,user,recovered,'ThirdPassword!2026',totpAt(secret,Math.floor(Date.now()/30000)));
  await assert.rejects(()=>auth.authenticate(recoverySession.accessToken),/Invalid session/);
  assert.equal((await db.query('SELECT user_id FROM md_user_mfa_secrets WHERE tenant_id=$1 AND user_id=$2',[tenant,recovered])).rows.length,0);
  assert.equal((await db.query("SELECT subject_user_id FROM md_security_events WHERE tenant_id=$1 AND action='MfaResetByAdministrator'",[tenant])).rows[0].subject_user_id,recovered);
  console.log('Phase 2 SQL: restrictions, session deadlines, TOTP, backup replay, signed WebAuthn registration/authentication/origin/replay, signed OIDC and SAML federation, nonce/state/browser/ticket isolation and migration preservation passed.');
 });
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await withSqlTestConnection(verifyIdentitySessionSql);
