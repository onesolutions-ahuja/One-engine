import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createLocalJWKSet,jwtVerify,type JSONWebKeySet} from 'jose';
import type {CacheProvider} from '@node-saml/node-saml';
import {z} from 'zod';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {NamedCredentialService} from './named-credential-service.js';
import {safeUrl} from './oauth-authorization-service.js';
import {writeIntegrationActivity,type IntegrationActivityWriter} from './integration-api-log.js';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const schema=z.object({id:z.string().uuid().optional(),label:z.string().trim().min(1).max(100),protocol:z.enum(['oidc','saml']),
 enabled:z.boolean(),issuer:z.string().min(1).max(2000),authorization_url:z.string().max(2000),token_url:z.string().max(2000).default(''),
 jwks_url:z.string().max(2000).default(''),client_id:z.string().max(500).default(''),secret:z.string().max(4000).optional(),certificate:z.string().max(20000).default('')}).strict();
type Provider={id:string;tenant_id:string;label:string;protocol:'oidc'|'saml';enabled:boolean;issuer:string;authorization_url:string;token_url:string;
 jwks_url:string;client_id:string;certificate:string;secret_ciphertext:Buffer|null;key_id:string|null;
 token_credential_id:string|null;jwks_credential_id:string|null};
type Pending={tenant_id:string;provider_id:string;nonce:string;verifier_ciphertext:Buffer;key_id:string;origin:string};
export class FederationService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,private readonly vault:NamedCredentialService,
  private readonly activityWriter?:IntegrationActivityWriter){}
 private callbackUri(){
  const raw=process.env.METADRIVE_AUTH_PUBLIC_ORIGIN;if(!raw)throw Error('Invalid federation: public HTTPS origin is not configured');
  const url=safeUrl(raw);if(url.origin!==raw)throw Error('Invalid federation origin');
  return raw+'/api/auth/federation/callback';
 }
 private async provider(tenant:string,id:string){
  if(!z.string().uuid().safeParse(id).success)throw Error('Invalid identity provider');
  const {rows}=await this.db.query<Provider>('SELECT * FROM md_identity_providers WHERE tenant_id=$1 AND id=$2 AND enabled=true',[tenant,id]);
  if(!rows[0])throw Error('Invalid identity provider');return rows[0];
 }
 configuration(){try{return {callbackUrl:this.callbackUri(),configured:true};}catch{return {callbackUrl:'',configured:false};}}
 async list(tenant:string,user?:string){
  if(user)await this.rbac.require(tenant,user,'Security','read');
  const cols=user?'id,label,protocol,enabled,issuer,authorization_url,token_url,jwks_url,client_id,certificate':'id,label,protocol';
  return (await this.db.query(`SELECT ${cols} FROM md_identity_providers WHERE tenant_id=$1${user?'':' AND enabled=true'} ORDER BY label`,[tenant])).rows;
 }
 async save(tenant:string,user:string,input:unknown){
  await this.rbac.require(tenant,user,'Security','manage');
  const parsed=schema.safeParse(input);if(!parsed.success)throw Error('Invalid identity provider settings');
  const p=parsed.data,authorizationUrl=safeUrl(p.authorization_url).href;
  let tokenUrl=p.token_url,jwksUrl=p.jwks_url;
  if(p.protocol==='oidc'){
   safeUrl(p.issuer);tokenUrl=safeUrl(p.token_url).href;jwksUrl=safeUrl(p.jwks_url).href;
   if(!p.client_id)throw Error('Invalid OIDC client');
   await this.rbac.require(tenant,user,'NamedCredential','manage');
   await this.rbac.require(tenant,user,'HTTPCallout','execute');
  }
  else if(!p.certificate.includes('-----BEGIN CERTIFICATE-----'))throw Error('Invalid SAML certificate');
  const providerId=p.id??randomUUID();
  await this.db.transaction(async c=>{
   let migratedSecret:string|undefined=p.secret||undefined;
   if(p.id){
    const previous=await c.query<Pick<Provider,'secret_ciphertext'|'key_id'|'token_credential_id'>>(
     `SELECT secret_ciphertext,key_id,token_credential_id FROM md_identity_providers
       WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenant,providerId]);
    if(!previous.rows[0])throw Error('Identity provider not found');
    if(!migratedSecret&&!previous.rows[0].token_credential_id&&previous.rows[0].secret_ciphertext){
     if(!previous.rows[0].key_id)throw Error('Legacy identity provider secret key is unavailable');
     migratedSecret=this.vault.decryptOpaque(previous.rows[0].secret_ciphertext,previous.rows[0].key_id);
    }
    await c.query(`UPDATE md_identity_providers SET label=$3,protocol=$4,enabled=$5,issuer=$6,authorization_url=$7,
     token_url=$8,jwks_url=$9,client_id=$10,certificate=$11,secret_ciphertext=NULL,key_id=NULL
     WHERE tenant_id=$1 AND id=$2`,[tenant,providerId,p.label,p.protocol,p.enabled,p.issuer,authorizationUrl,tokenUrl,jwksUrl,p.client_id,p.certificate]);
    // Configuration changes invalidate outstanding authorization requests.
    await c.query('UPDATE md_federation_requests SET consumed_at=now() WHERE tenant_id=$1 AND provider_id=$2',[tenant,providerId]);
   }else await c.query(`INSERT INTO md_identity_providers
     (id,tenant_id,label,protocol,enabled,issuer,authorization_url,token_url,jwks_url,
      client_id,certificate,secret_ciphertext,key_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL)`,
     [providerId,tenant,p.label,p.protocol,p.enabled,p.issuer,authorizationUrl,tokenUrl,jwksUrl,p.client_id,p.certificate]);
   if(p.protocol==='oidc')
    await this.vault.manageFederationCredentials(c,tenant,providerId,tokenUrl,jwksUrl,migratedSecret);
   await c.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'IdentityProviderUpdated')",[tenant,user]);
  });return this.list(tenant,user);
 }
 async links(tenant:string,user:string){
  await this.rbac.require(tenant,user,'Security','read');
  return (await this.db.query('SELECT provider_id,subject,user_id FROM md_federated_identities WHERE tenant_id=$1 ORDER BY provider_id,subject',[tenant])).rows;
 }
 async link(tenant:string,actor:string,raw:unknown){
  await this.rbac.require(tenant,actor,'Security','manage');
  const parsed=z.object({provider_id:z.string().uuid(),user_id:z.string().uuid(),subject:z.string().min(1).max(2000),remove:z.boolean().default(false)}).strict().safeParse(raw);
  if(!parsed.success)throw Error('Invalid federated identity');const v=parsed.data;
  await this.db.transaction(async c=>{
   if(v.remove)await c.query('DELETE FROM md_federated_identities WHERE tenant_id=$1 AND provider_id=$2 AND user_id=$3 AND subject=$4',[tenant,v.provider_id,v.user_id,v.subject]);
   else await c.query('INSERT INTO md_federated_identities(tenant_id,provider_id,user_id,subject) VALUES($1,$2,$3,$4)',[tenant,v.provider_id,v.user_id,v.subject]);
   await c.query("INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action) VALUES($1,$2,$3,'FederatedIdentityUpdated')",[tenant,actor,v.user_id]);
  });return {saved:true};
 }
 private async saml(p:Provider,nonce:string){
  const {SAML,ValidateInResponseTo}=await import('@node-saml/node-saml');
  const callback=this.callbackUri();
  const cache:CacheProvider={
   saveAsync:async(key,value)=>{await this.db.query('INSERT INTO md_saml_request_ids(tenant_id,provider_id,request_id,value) VALUES($1,$2,$3,$4)',[p.tenant_id,p.id,key,value]);return {value,createdAt:Date.now()};},
   getAsync:async key=>key!=='_'+nonce?null:(await this.db.query<{value:string}>("SELECT value FROM md_saml_request_ids WHERE tenant_id=$1 AND provider_id=$2 AND request_id=$3 AND created_at>now()-interval '5 minutes'",[p.tenant_id,p.id,key])).rows[0]?.value??null,
   removeAsync:async key=>(await this.db.query<{value:string}>('DELETE FROM md_saml_request_ids WHERE tenant_id=$1 AND provider_id=$2 AND request_id=$3 RETURNING value',[p.tenant_id,p.id,key])).rows[0]?.value??null
  };
  return new SAML({callbackUrl:callback,issuer:callback+'/'+p.id,idpIssuer:p.issuer,audience:callback+'/'+p.id,entryPoint:p.authorization_url,
   idpCert:p.certificate,validateInResponseTo:ValidateInResponseTo.always,requestIdExpirationPeriodMs:300000,cacheProvider:cache,
   generateUniqueId:()=>'_'+nonce,wantAssertionsSigned:true,wantAuthnResponseSigned:true,maxAssertionAgeMs:300000,acceptedClockSkewMs:30000,disableRequestedAuthnContext:true});
 }
 async start(tenant:string,id:string,origin:string,browser:string){
  const url=new URL(origin);if(url.origin!==origin||url.protocol!=='https:')throw Error('Invalid federation return origin');
  const registered=await this.db.query('SELECT tenant_id FROM md_tenant_domains WHERE tenant_id=$1 AND domain=$2',[tenant,url.hostname]);
  if(!registered.rows[0])throw Error('Invalid federation domain');
  const p=await this.provider(tenant,id),state=token(),nonce=token(),verifier=token(),encrypted=this.vault.encryptOpaque(verifier);
  await this.db.query(`INSERT INTO md_federation_requests(state_hash,tenant_id,provider_id,browser_hash,nonce,verifier_ciphertext,key_id,origin)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[hash(state),tenant,id,hash(browser),nonce,encrypted.ciphertext,encrypted.keyId,origin]);
  if(p.protocol==='saml')return {url:await (await this.saml(p,nonce)).getAuthorizeUrlAsync(state,undefined,{}),state};
  const auth=safeUrl(p.authorization_url);for(const [key,value] of Object.entries({response_type:'code',client_id:p.client_id,redirect_uri:this.callbackUri(),scope:'openid email profile',
   state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))auth.searchParams.set(key,value);
  return {url:auth.toString(),state};
 }
 async callback(state:unknown,browser:unknown,code:unknown,samlResponse:unknown,method:'GET'|'POST'='GET'){
  if(typeof state!=='string'||!/^[\w-]{43}$/.test(state)||typeof browser!=='string')throw Error('Invalid federation state');
  // Atomic claim before verification/network work prevents response replay across replicas.
  const claimed=await this.db.query<Pending>(`UPDATE md_federation_requests SET consumed_at=now()
   WHERE state_hash=$1 AND browser_hash=$2 AND consumed_at IS NULL AND expires_at>now()
   RETURNING tenant_id,provider_id,nonce,verifier_ciphertext,key_id,origin`,[hash(state),hash(browser)]);
  const request=claimed.rows[0];if(!request)throw Error('Invalid federation state');
  const startedAt=Date.now();
  let provider:Provider|undefined;
  const log=(outcome:'success'|'rejected',userId?:string)=>
   writeIntegrationActivity(this.db,{
    tenantId:request.tenant_id,direction:'Inbound',transport:'HTTP',
    provider:provider?.label??'Identity Provider',credentialId:request.provider_id,
    actorUserId:userId,endpoint:'/api/auth/federation/callback',method,
    statusCode:outcome==='success'?303:400,outcome,
    durationMs:Date.now()-startedAt,
    requestBytes:Buffer.byteLength(String(code??''))+Buffer.byteLength(String(samlResponse??'')),
    errorCode:outcome==='success'?null:'IDENTITY_CALLBACK_REJECTED',
    communication:{name:'Identity provider callback',provider:provider?.label??'Identity Provider',
     relatedObject:'IdentityProvider',relatedRecordId:request.provider_id}
   },this.activityWriter);
  try{
   provider=await this.provider(request.tenant_id,request.provider_id);
   let subject:string;
   if(provider.protocol==='saml'){
    if(typeof samlResponse!=='string'||samlResponse.length>1000000)throw Error('Invalid SAML response');
    const verified=await (await this.saml(provider,request.nonce)).validatePostResponseAsync({SAMLResponse:samlResponse});
    if(!verified.profile?.nameID||verified.loggedOut)throw Error('Invalid SAML identity');subject=verified.profile.nameID;
   }else{
    if(typeof code!=='string'||!code||code.length>4096)throw Error('Invalid OIDC code');
    const body=new URLSearchParams({grant_type:'authorization_code',code,client_id:provider.client_id,redirect_uri:this.callbackUri(),
     code_verifier:this.vault.decryptOpaque(request.verifier_ciphertext,request.key_id)});
    const response=await this.vault.identityProviderJson(request.tenant_id,provider.id,'token',body);
    if(typeof response.id_token!=='string')throw Error('Invalid OIDC ID token');
    const jwks=await this.vault.identityProviderJson(request.tenant_id,provider.id,'jwks');
    const {payload}=await jwtVerify(response.id_token,createLocalJWKSet(jwks as unknown as JSONWebKeySet),{issuer:provider.issuer,audience:provider.client_id,algorithms:['RS256','ES256','PS256'],requiredClaims:['exp','iat','sub','nonce']});
    if(payload.nonce!==request.nonce||!payload.sub||payload.sub.length>2000)throw Error('Invalid OIDC nonce or subject');subject=payload.sub;
   }
   // No implicit email matching, provisioning or role assignment. Social providers use the same explicit subject links.
   const linked=await this.db.query<{user_id:string}>(`SELECT i.user_id FROM md_federated_identities i JOIN md_users u ON u.tenant_id=i.tenant_id AND u.id=i.user_id
    JOIN md_tenants t ON t.id=u.tenant_id AND t.status='ACTIVE' WHERE i.tenant_id=$1 AND i.provider_id=$2 AND i.subject=$3 AND u.enabled=true`,[request.tenant_id,provider.id,subject]);
   if(!linked.rows[0])throw Error('Invalid federated identity: account is not linked');
   const ticket=token();await this.db.query('INSERT INTO md_federation_tickets(token_hash,tenant_id,user_id,origin) VALUES($1,$2,$3,$4)',[hash(ticket),request.tenant_id,linked.rows[0].user_id,request.origin]);
   await log('success',linked.rows[0].user_id);
   return {ticket,origin:request.origin};
  }catch(error){
   await log('rejected');
   throw error;
  }
 }
 async complete(ticket:string,tenant:string){
  const {rows}=await this.db.query<{user_id:string}>(`UPDATE md_federation_tickets SET consumed_at=now() WHERE token_hash=$1 AND tenant_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING user_id`,[hash(ticket),tenant]);
  if(!rows[0])throw Error('Invalid federation ticket');return rows[0].user_id;
 }
}
