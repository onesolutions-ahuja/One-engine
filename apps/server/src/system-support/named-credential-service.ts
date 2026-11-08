import {requireAvailableMetadataName} from './metadata-name-guard.js';
import {OAuthAuthorizationService} from './oauth-authorization-service.js';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID,createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {publicHttpsUrl,publicIp,requestExternalHttps} from './external-http-transport.js';
import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';
import {flowAppIsEntitled} from '../system-files/flow-validation.js';
import {prepareFlowHttpRequest,bindPublicHttpCredentialVariables} from '../system-files/flow-http-mapping.js';
import {resolveFlowIntegrationCallout} from '../system-files/flow-integration-connection.js';
import {writeIntegrationActivity,type IntegrationActivityWriter,type IntegrationCommunicationDetails} from './integration-api-log.js';
import {sendPlatformRecoveryEmail} from './platform-recovery-mailer.js';

type CalloutJob={
 id:string;tenant_id:string;run_id:string;user_id:string;credential_id:string;method:string;
 connection_api:string|null;operation_api:string|null;operation_path_ciphertext:Buffer|null;
 path_ciphertext:Buffer;headers_ciphertext:Buffer;body_ciphertext:Buffer|null;
 idempotency_key_ciphertext:Buffer|null;max_attempts:number;timeout_ms:number;attempt_count:number
};
type CalloutValue={api_name:string;value_ciphertext:Buffer;data_type:string};
type FlowEmailJob={id:string;tenant_id:string;user_id:string;credential_id:string;
 flow_id:string;flow_version:number;flow_api:string;payload_ciphertext:Buffer;encryption_key_id:string};
type CalloutScalar=string|number|boolean|null;
const isCalloutScalar=(value:unknown):value is CalloutScalar=>
 value===null||typeof value==='string'||typeof value==='boolean'
 ||typeof value==='number'&&Number.isFinite(value);

function mappedCommunicationDetails(config:Record<string,unknown>,
 variables:Record<string,string|number|boolean|null>,responseBody?:string,requestBody?:string):IntegrationCommunicationDetails|undefined{
 const raw=config.communicationLog;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
 const mapping=raw as Record<string,unknown>;
 const render=(value:unknown):string|undefined=>{
  if(typeof value!=='string')return undefined;
  return value.replace(/\{!([A-Za-z][A-Za-z0-9_.]*)\}/g,(_match,key:string)=>
   Object.hasOwn(variables,key)?String(variables[key]??''):'');
 };
 const details:IntegrationCommunicationDetails={};
 for(const key of ['channel','name','sender','recipient','subject','body','provider'] as const){
  const value=render(mapping[key]);
  if(value!==undefined)details[key]=value;
 }
 // Field extraction is declared by the installed connector, never by a Flow
 // implementation. Only explicitly selected scalar fields enter Communication.
 if(requestBody && requestBody.length<=32768){
  try{
   const json:unknown=JSON.parse(requestBody);
   const get=(selector:unknown):string|undefined=>{
    if(typeof selector!=='string'||!/^[A-Za-z][A-Za-z0-9_]*(?:\[\d{1,2}\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\d{1,2}\])?){0,5}$/.test(selector))
     return undefined;
    let value:unknown=json;
    for(const part of selector.match(/[A-Za-z][A-Za-z0-9_]*|\[\d+\]/g)??[]){
     if(part.startsWith('[')){
      if(!Array.isArray(value)){value=undefined;break;}
      value=value[Number(part.slice(1,-1))];
     }else if(value&&typeof value==='object'&&!Array.isArray(value))
      value=(value as Record<string,unknown>)[part];
     else {value=undefined;break;}
    }
    return typeof value==='string'||typeof value==='number'?String(value).slice(0,10000):undefined;
   };
   for(const [field,selector] of [
    ['recipient','requestRecipientPath'],['sender','requestSenderPath'],['body','requestBodyPath']
   ] as const){
    const value=get(mapping[selector]);
    if(value!==undefined)details[field]=value;
   }
  }catch{/* Generic opaque HTTP payloads are logged without message details. */}
 }
 const path=mapping.externalMessageIdResponsePath;
 if(typeof path==='string'&&responseBody&&/^[A-Za-z][A-Za-z0-9_]*(?:\[\d+\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\d+\])?)*$/.test(path)){
  try{
   let value:unknown=JSON.parse(responseBody);
   for(const part of path.match(/[A-Za-z][A-Za-z0-9_]*|\[\d+\]/g)??[]){
    if(part.startsWith('[')){
     if(!Array.isArray(value)){value=undefined;break;}
     value=value[Number(part.slice(1,-1))];
    }else if(value&&typeof value==='object'&&!Array.isArray(value))
     value=(value as Record<string,unknown>)[part];
    else {value=undefined;break;}
   }
   if(typeof value==='string'||typeof value==='number')details.externalMessageId=String(value);
  }catch{/* Provider response IDs are optional metadata; never fail the HTTP callout for logging. */}
 }
 return details;
}
/** Tenant-scoped encrypted named credentials. Never disclose stored secret material. */
export class NamedCredentialService {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
  private dispatching=false;
  private integrationActivityWriter?:IntegrationActivityWriter;
  setIntegrationActivityWriter(writer:IntegrationActivityWriter){this.integrationActivityWriter=writer;}
  private activeKeyId():string {
   return process.env.METADRIVE_CREDENTIAL_ACTIVE_KEY_ID || 'legacy';
 }
 private keyFor(id:string):Buffer|null {
  if(id==='legacy' && process.env.METADRIVE_CREDENTIAL_ENCRYPTION_KEY){
   const decoded=Buffer.from(process.env.METADRIVE_CREDENTIAL_ENCRYPTION_KEY,'base64');
   return decoded.length===32?decoded:null;
  }
  let parsed:unknown;
  try {parsed=JSON.parse(process.env.METADRIVE_CREDENTIAL_KEYS??'');}catch{return null;}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
  const raw=(parsed as Record<string,unknown>)[id];
  if(typeof raw!=='string')return null;
  const decoded=Buffer.from(raw,'base64');
  return decoded.length===32?decoded:null;
 }
 private key() {
  // The active key belongs to the application, never to a hosting provider.
  // Keep the legacy single-key setting readable for existing installations.
  const activeId=process.env.METADRIVE_CREDENTIAL_ACTIVE_KEY_ID;
  if(process.env.METADRIVE_CREDENTIAL_KEYS||activeId)
   return activeId?this.keyFor(activeId):null;
  return this.keyFor('legacy');
 }
 private encryptValue(value:string) {
  const key=this.key();
  if(!key)throw new Error('Durable HTTP Callout encryption is not configured');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]);
 }
 private decryptValue(value:Buffer) {
  const key=this.key();
  if(!key||value.length<29)throw new Error('Queued HTTP Callout cannot be decrypted');
  const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));
  decipher.setAuthTag(value.subarray(value.length-16));
  return Buffer.concat([decipher.update(value.subarray(12,value.length-16)),
   decipher.final()]).toString('utf8');
 }
 private decryptValueWithKey(value:Buffer,keyId:string) {
  const key=this.keyFor(keyId);
  if(!key||value.length<29)throw new Error('Queued Flow email cannot be decrypted');
  const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));
  decipher.setAuthTag(value.subarray(value.length-16));
  return Buffer.concat([decipher.update(value.subarray(12,value.length-16)),
   decipher.final()]).toString('utf8');
 }
 /** Opaque tenant metadata encryption shared by MFA and Named Credentials.
  * Callers keep key identity in relational SQL and never expose ciphertext to clients.
  */
 encryptOpaque(value:string):{ciphertext:Buffer;keyId:string}{
  const key=this.key();
  if(!key)throw new Error('Credential encryption is not configured');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  return {ciphertext:Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]),
   keyId:this.activeKeyId()};
 }
 decryptOpaque(ciphertext:Buffer,keyId:string):string{
  const key=this.keyFor(keyId);
  if(!key||!ciphertext||ciphertext.length<29)throw new Error('Credential encryption key is unavailable');
  const decipher=createDecipheriv('aes-256-gcm',key,ciphertext.subarray(0,12));
  decipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([decipher.update(ciphertext.subarray(12,-16)),decipher.final()]).toString('utf8');
 }
 async manageFederationCredentials(client:PoolClient,tenantId:string,providerId:string,
  tokenUrl:string,jwksUrl:string,clientSecret?:string){
  const tokenEndpoint=publicHttpsUrl(tokenUrl),jwksEndpoint=publicHttpsUrl(jwksUrl);
  const {rows}=await client.query<{
   token_credential_id:string|null;jwks_credential_id:string|null
  }>(`SELECT token_credential_id,jwks_credential_id FROM md_identity_providers
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,providerId]);
  const provider=rows[0];
  if(!provider)throw new Error('Identity provider not found');
  const suffix=providerId.replace(/-/g,'');
  const values=[
   {kind:'Token',name:'Federation_'+suffix+'_Token',label:'Federation token: '+suffix,
    url:tokenEndpoint.href,id:provider.token_credential_id,
    secret:clientSecret?this.encryptOpaque(clientSecret):undefined},
   {kind:'Jwks',name:'Federation_'+suffix+'_Jwks',label:'Federation JWKS: '+suffix,
    url:jwksEndpoint.href,id:provider.jwks_credential_id,secret:undefined}
  ];
  const ids:string[]=[];
  for(const value of values){
   const existing=await client.query<{id:string;name:string;protocol:string}>(
    `SELECT id,name,protocol FROM md_named_credentials
      WHERE tenant_id=$1 AND (id=$2 OR name=$3) FOR UPDATE`,
    [tenantId,value.id,value.name]);
   if(existing.rows.length>1)throw new Error('Federation Named Credential ownership conflict');
   const credential=existing.rows[0];
   if(credential&&(credential.name!==value.name||credential.protocol!=='HTTPS'||
      credential.id!==value.id))
    throw new Error('Federation Named Credential ownership conflict');
   if(credential){
    await client.query(`UPDATE md_named_credentials SET base_url=$3,
      secret_ciphertext=COALESCE($4,secret_ciphertext),
      encryption_key_id=CASE WHEN $4::bytea IS NULL THEN encryption_key_id ELSE $5 END,
      enabled=true,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantId,credential.id,value.url,value.secret?.ciphertext??null,
       value.secret?.keyId??null]);
    ids.push(credential.id);
   }else{
    const created=await client.query<{id:string}>(`INSERT INTO md_named_credentials
      (tenant_id,name,label,protocol,base_url,auth_type,header_name,secret_ciphertext,
       enabled,encryption_key_id)
      VALUES($1,$2,$3,'HTTPS',$4,'None','',$5,true,$6) RETURNING id`,
      [tenantId,value.name,value.label,value.url,value.secret?.ciphertext??null,
       value.secret?.keyId??this.activeKeyId()]);
    if(!created.rows[0])throw new Error('Unable to create federation Named Credential');
    ids.push(created.rows[0].id);
   }
  }
  await client.query(`UPDATE md_identity_providers SET token_credential_id=$3,
    jwks_credential_id=$4,secret_ciphertext=NULL,key_id=NULL
    WHERE tenant_id=$1 AND id=$2`,[tenantId,providerId,ids[0],ids[1]]);
  return {tokenCredentialId:ids[0],jwksCredentialId:ids[1]};
 }
 async identityProviderJson(tenantId:string,providerId:string,endpoint:'token'|'jwks',
  parameters?:URLSearchParams){
  const token=endpoint==='token';
  const {rows}=await this.db.query<{
   provider:string;enabled:boolean;client_id:string;expected_url:string;
   id:string;base_url:string;secret_ciphertext:Buffer|null;encryption_key_id:string
  }>(`SELECT p.label AS provider,p.enabled,p.client_id,
     CASE WHEN $3='token' THEN p.token_url ELSE p.jwks_url END AS expected_url,
     c.id,c.base_url,c.secret_ciphertext,c.encryption_key_id
    FROM md_identity_providers p
    JOIN md_named_credentials c ON c.tenant_id=p.tenant_id
     AND c.id=CASE WHEN $3='token' THEN p.token_credential_id ELSE p.jwks_credential_id END
    WHERE p.tenant_id=$1 AND p.id=$2 AND p.protocol='oidc'
     AND c.enabled=true AND c.protocol='HTTPS'`,
   [tenantId,providerId,endpoint]);
  const credential=rows[0];
  if(!credential?.enabled||!credential.id||credential.base_url!==credential.expected_url)
   throw new Error('Federation Named Credential unavailable');
  const url=publicHttpsUrl(credential.base_url);
  let body:string|undefined;
  if(token){
   if(!parameters)throw new Error('Federation token request is required');
   parameters.delete('client_secret');
   parameters.set('client_id',credential.client_id);
   if(credential.secret_ciphertext){
    parameters.set('client_secret',this.decryptOpaque(
     credential.secret_ciphertext,credential.encryption_key_id));
   }
   body=parameters.toString();
  }
  const startedAt=Date.now(),requestBytes=Buffer.byteLength(body??'');
  let statusCode:number|undefined,responseBytes=0;
  const log=(outcome:'success'|'http_error'|'network_error',errorCode?:string)=>
   writeIntegrationActivity(this.db,{
    tenantId,direction:'Outbound',transport:'HTTP',provider:credential.provider,
    credentialId:credential.id,endpoint:url.origin+url.pathname,
    method:token?'POST':'GET',statusCode,outcome,durationMs:Date.now()-startedAt,
    requestBytes,responseBytes,errorCode,
    communication:{name:token?'Identity token exchange':'Identity provider JWKS',
     provider:credential.provider,relatedObject:'NamedCredential',
     relatedRecordId:credential.id}
   },this.integrationActivityWriter);
  let response:{status:number;body:string;responseBytes:number};
  try{
   response=await requestExternalHttps(url,{method:token?'POST':'GET',timeoutMs:10000,
    maxResponseBytes:262144,body,headers:{Accept:'application/json',
     ...(token?{'Content-Type':'application/x-www-form-urlencoded',
      'Content-Length':String(Buffer.byteLength(body??''))}:{})}});
   statusCode=response.status;responseBytes=response.responseBytes;
  }catch(error){
   await log('network_error',error instanceof Error?error.name:'NETWORK_ERROR');
   throw error;
  }
  if(token?statusCode<200||statusCode>=300:statusCode!==200){
   await log('http_error','HTTP_STATUS_'+statusCode);
   throw new Error('Identity provider request failed');
  }
  await log('success');
  try{
   const parsed:unknown=JSON.parse(response.body);
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();
   return parsed as Record<string,unknown>;
  }catch{throw new Error('Invalid identity provider JSON');}
 }
 async readiness(tenantId:string,userId:string){
  return {canManage:await this.rbac.allowed(tenantId,userId,'NamedCredential','manage'),
   encryptionReady:Boolean(this.key())};
 }
 async list(tenantId:string,userId:string){
  await this.rbac.require(tenantId,userId,'NamedCredential','read');
  const {rows}=await this.db.query<{
   id:string;name:string;label:string;protocol:string;base_url:string;auth_type:string;
   header_name:string;secret_ciphertext:Buffer|null;configuration_ciphertext:Buffer|null;
   encryption_key_id:string;enabled:boolean;updated_at:Date;
   webhook_id:string|null;webhook_enabled:boolean|null;
  }>(`SELECT c.id,c.name,c.label,c.protocol,c.base_url,c.auth_type,c.header_name,
     c.secret_ciphertext,c.configuration_ciphertext,c.encryption_key_id,
     c.enabled,c.updated_at,w.id AS webhook_id,w.enabled AS webhook_enabled
     FROM md_named_credentials c
     LEFT JOIN md_inbound_webhook_endpoints w ON w.tenant_id=c.tenant_id AND w.credential_id=c.id
     WHERE c.tenant_id=$1 AND c.protocol='HTTPS' ORDER BY c.label,c.name`,[tenantId]);
  // Generic, opt-in public settings convention for all provider integrations.
  // Tokens, passwords and keys are never allowed to be client-readable.
  const safePublicKey=(key:string)=>/^public_[A-Za-z][A-Za-z0-9_]*$/.test(key)
   && !/(secret|token|password|passphrase|private|pin|credential|authorization|api_?key)/i.test(key);
  const {rows:declared}=await this.db.query<{credential_name:string;field_api:string;label:string;default_value:string}>(`
    SELECT f.credential_name,f.field_api,f.label,f.default_value
    FROM md_connector_app_fields f
    JOIN md_app_installations a ON a.tenant_id=f.tenant_id AND a.app_id=f.app_id
    WHERE f.tenant_id=$1 ORDER BY f.credential_name,f.field_api`,[tenantId]);
  const fieldsByName=new Map<string,typeof declared>();
  for(const field of declared){
   if(!safePublicKey(field.field_api))continue;
   const current=fieldsByName.get(field.credential_name)??[];
   current.push(field);
   fieldsByName.set(field.credential_name,current);
  }
  return rows.map(x=>{
   let configuration:Record<string,string>={};
   if(x.configuration_ciphertext){
    try{
     const raw=JSON.parse(this.decryptOpaque(x.configuration_ciphertext,x.encryption_key_id)) as unknown;
     if(raw&&typeof raw==='object'&&!Array.isArray(raw))
      configuration=Object.fromEntries(Object.entries(raw)
       .filter(([key,value])=>safePublicKey(key)&&typeof value==='string')) as Record<string,string>;
    }catch{/* Never expose unreadable or confidential credential values. */}
   }
   const fields=fieldsByName.get(x.name)??[];
   let removed:string[]=[];
   if(x.configuration_ciphertext){
    try{const raw=JSON.parse(this.decryptOpaque(x.configuration_ciphertext,x.encryption_key_id));
      if(typeof raw?.__removedPublicFields==='string')removed=raw.__removedPublicFields.split(',').filter(safePublicKey);
    }catch{/* Preserve secrecy on unreadable credentials. */}
   }
   configuration={...Object.fromEntries(fields.map(f=>[f.field_api,f.default_value])),...configuration};
   for(const key of removed)delete configuration[key];
   const configurationLabels=Object.fromEntries(fields.map(f=>[f.field_api,f.label]));
   return {id:x.id,name:x.name,label:x.label,protocol:x.protocol,
    baseUrl:x.base_url,authType:x.auth_type,headerName:x.header_name,
    hasSecret:Boolean(x.secret_ciphertext),enabled:x.enabled,configuration,configurationLabels,
    webhookId:x.webhook_id??null,webhookEnabled:x.webhook_enabled===true,
    keyId:x.encryption_key_id,updatedAt:x.updated_at};
  });
 }
 async create(tenantId:string,userId:string,body:unknown){
  await this.rbac.require(tenantId,userId,'NamedCredential','manage');
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid credential');
  const x=body as Record<string,unknown>;
  if(typeof x.name==='string'&&/^onesys/i.test(x.name))
   throw new Error('onesys is reserved for system-installed credentials');
  if(typeof x.name!=='string'|| !/^[A-Za-z][A-Za-z0-9_]*$/.test(x.name)
    ||typeof x.label!=='string'||!x.label.trim()
    ||x.protocol!=='HTTPS'
    ||!['None','Bearer','Basic','API Key','OAuth Client Credentials','OAuth Authorization Code','Authorization Scheme'].includes(String(x.authType))
    ||typeof x.baseUrl!=='string'||typeof x.headerName!=='string')
    throw new Error('Invalid credential');
  if(x.configuration && (typeof x.configuration!=='object'||Array.isArray(x.configuration)||Object.values(x.configuration as object).some(v=>typeof v!=='string')))throw new Error('Invalid credential configuration');
  const secret=x.secret;
  if(secret!==undefined && typeof secret!=='string')throw new Error('Invalid credential secret');
  const key=secret?this.key():null;
  if(secret&&!key)throw new Error('Credential encryption is not configured');
  let encrypted:Buffer|null=null;
  if(secret&&key) {
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
   encrypted=Buffer.concat([iv,cipher.update(secret,'utf8'),cipher.final(),cipher.getAuthTag()]);
  }
  let encryptedConfiguration:Buffer|null=null;
  const config={...(x.configuration as Record<string,string>|undefined),...(typeof x.username==='string'&&x.username?{username:x.username}:{})};
  if(config && Object.keys(config).length){
   if(!this.key())throw new Error('Credential encryption is not configured');
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key()!,iv);
   encryptedConfiguration=Buffer.concat([iv,cipher.update(JSON.stringify(config),'utf8'),cipher.final(),cipher.getAuthTag()]);
  }
  const {rows}=await this.db.transaction(async client=>{
   await requireAvailableMetadataName(client,tenantId,'namedCredential',x.name as string);
   return client.query<{id:string}>(
    'INSERT INTO md_named_credentials(tenant_id,name,label,protocol,base_url,auth_type,header_name,secret_ciphertext,configuration_ciphertext,enabled,encryption_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
    [tenantId,x.name,x.label,x.protocol,x.baseUrl,x.authType,x.headerName,encrypted,encryptedConfiguration,x.enabled!==false,this.activeKeyId()]);
  });
  return (await this.list(tenantId,userId)).find(item=>item.id===rows[0].id);
 }
 /** Transactional, privileged re-encryption of a single tenant credential. */
 async rotate(tenantId:string,userId:string,id:string) {
  await this.rbac.require(tenantId,userId,'Security','manage');
  await this.rbac.require(tenantId,userId,'NamedCredential','manage');
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid credential');
  const targetId=this.activeKeyId(),targetKey=this.key();
  if(!targetKey)throw new Error('Credential encryption is not configured');
  await this.db.transaction(async client=>{
   const {rows}=await client.query<{
    encryption_key_id:string;secret_ciphertext:Buffer|null;configuration_ciphertext:Buffer|null
   }>('SELECT encryption_key_id,secret_ciphertext,configuration_ciphertext FROM md_named_credentials WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id]);
   const existing=rows[0];
   if(!existing)throw new Error('Credential not found');
   if(existing.encryption_key_id===targetId)return;
   const oldKey=this.keyFor(existing.encryption_key_id);
   if(!oldKey&&(existing.secret_ciphertext||existing.configuration_ciphertext))
    throw new Error('Original credential encryption key is unavailable');
   const reencrypt=(encrypted:Buffer|null):Buffer|null=>{
    if(!encrypted)return null;
    if(!oldKey||encrypted.length<29)throw new Error('Invalid encrypted credential');
    const decipher=createDecipheriv('aes-256-gcm',oldKey,encrypted.subarray(0,12));
    decipher.setAuthTag(encrypted.subarray(encrypted.length-16));
    const plain=Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()]);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',targetKey,iv);
    return Buffer.concat([iv,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
   };
   const secret=reencrypt(existing.secret_ciphertext);
   const config=reencrypt(existing.configuration_ciphertext);
   await client.query('UPDATE md_named_credentials SET secret_ciphertext=$3,configuration_ciphertext=$4,encryption_key_id=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2',
    [tenantId,id,secret,config,targetId]);
   // Provider grants have independent key identities and must rotate atomically as well.
   const {rows:oauthRows}=await client.query<{
    key_id:string;access_ciphertext:Buffer;refresh_ciphertext:Buffer|null
   }>('SELECT key_id,access_ciphertext,refresh_ciphertext FROM md_credential_oauth_tokens WHERE tenant_id=$1 AND credential_id=$2 FOR UPDATE',
    [tenantId,id]);
   if(oauthRows[0]&&oauthRows[0].key_id!==targetId){
    const token=oauthRows[0];
    const rotateToken=(value:Buffer|null)=>{
     if(!value)return null;
     const plaintext=this.decryptOpaque(value,token.key_id);
     return this.encryptOpaque(plaintext).ciphertext;
    };
    await client.query(`UPDATE md_credential_oauth_tokens
      SET key_id=$3,access_ciphertext=$4,refresh_ciphertext=$5,updated_at=now()
      WHERE tenant_id=$1 AND credential_id=$2`,
      [tenantId,id,targetId,rotateToken(token.access_ciphertext),rotateToken(token.refresh_ciphertext)]);
   }
   await client.query(
    'INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
    [tenantId,userId,'NamedCredentialKeyRotation',JSON.stringify({credentialId:id,previousKeyId:existing.encryption_key_id,newKeyId:targetId})]);
  });
  return (await this.list(tenantId,userId)).find(c=>c.id===id);
 }

 /** Configure an optional, standalone signed inbound endpoint for this credential.
  * No app or Flow is assigned. Only its generated verification token is returned once.
  */
 async configureWebhook(tenantId:string,userId:string,id:string,required:boolean,secret?:string,requestedVerifyToken?:string){
  await this.rbac.require(tenantId,userId,'NamedCredential','manage');
  await this.rbac.require(tenantId,userId,'WebhookSubscription','manage');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)||typeof required!=='boolean'
    ||secret!==undefined&&(typeof secret!=='string'||secret.length<16||secret.length>512))
   throw new Error('Invalid webhook configuration');
  if(requestedVerifyToken!==undefined && (typeof requestedVerifyToken!=='string'||requestedVerifyToken.length<16||requestedVerifyToken.length>256))throw new Error('Verification token must be 16–256 characters');
  const {rows:credentials}=await this.db.query<{name:string;protocol:string}>(`
   SELECT name,protocol FROM md_named_credentials WHERE tenant_id=$1 AND id=$2`,
   [tenantId,id]);
  const credential=credentials[0];
  if(!credential)throw new Error('Named Credential not found');
  if(required&&credential.protocol!=='HTTPS')throw new Error('Webhooks require HTTPS credentials');
  const {rows:existing}=await this.db.query<{id:string}>(`
   SELECT id FROM md_inbound_webhook_endpoints
   WHERE tenant_id=$1 AND credential_id=$2`,[tenantId,id]);
  const endpoint=existing[0];
  if(!required){
   if(endpoint)await this.db.query(`
    UPDATE md_inbound_webhook_endpoints SET enabled=false,updated_at=now()
     WHERE tenant_id=$1 AND id=$2`,[tenantId,endpoint.id]);
   return {webhookId:endpoint?.id??null,enabled:false};
  }
  if(!endpoint&&!secret)throw new Error('Enter the webhook signing secret');
  let verifyToken:string|undefined;
  let secured:{ciphertext:Buffer;keyId:string}|undefined;
  if(secret)secured=this.encryptOpaque(secret);
  if(requestedVerifyToken||secret)verifyToken=requestedVerifyToken??randomBytes(32).toString('hex');
  const encryptedVerifyToken=verifyToken?this.encryptOpaque(verifyToken):undefined;
  let endpointId=endpoint?.id;
  if(endpoint){
   await this.db.query(`
    UPDATE md_inbound_webhook_endpoints
     SET enabled=true,updated_at=now(),
       verify_token_digest=COALESCE($3,verify_token_digest),
       verify_token_ciphertext=COALESCE($6,verify_token_ciphertext),
       signature_secret_ciphertext=COALESCE($4,signature_secret_ciphertext),
       encryption_key_id=COALESCE($5,encryption_key_id)
     WHERE tenant_id=$1 AND id=$2`,
    [tenantId,endpoint.id,verifyToken?createHash('sha256').update(verifyToken).digest():null,
     secured?.ciphertext??null,secured?.keyId??null,encryptedVerifyToken?.ciphertext??null]);
  }else{
   const {rows:created}=await this.db.query<{id:string}>(`
    INSERT INTO md_inbound_webhook_endpoints
     (tenant_id,api_name,credential_id,flow_api,execution_user_id,app_id,
      provider,verify_token_digest,signature_secret_ciphertext,encryption_key_id,
      enabled,created_by,verify_token_ciphertext)
    VALUES($1,$2,$3,NULL,NULL,NULL,'HmacSha256',$4,$5,$6,true,$7,$8)
    RETURNING id`,
    [tenantId,'Credential_'+credential.name,id,
     createHash('sha256').update(verifyToken!).digest(),
     secured!.ciphertext,secured!.keyId,userId,encryptedVerifyToken!.ciphertext]);
   endpointId=created[0].id;
  }
  await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
   VALUES($1,$2,'CredentialWebhookConfigured',
    jsonb_build_object('credentialId',$3::text,'endpointId',$4::text))`,
   [tenantId,userId,id,endpointId]);
  return {webhookId:endpointId!,enabled:true,...(verifyToken?{verifyToken}:{})};
 }
 async revealWebhookVerifyToken(tenantId:string,userId:string,id:string){
  await this.rbac.require(tenantId,userId,'NamedCredential','manage');
  await this.rbac.require(tenantId,userId,'WebhookSubscription','manage');
  const {rows}=await this.db.query<{verify_token_ciphertext:Buffer|null;encryption_key_id:string}>(`
    SELECT verify_token_ciphertext,encryption_key_id FROM md_inbound_webhook_endpoints
    WHERE tenant_id=$1 AND credential_id=$2 AND enabled=true`,[tenantId,id]);
  if(!rows[0])throw new Error('No enabled webhook endpoint');
  if(!rows[0].verify_token_ciphertext)return {verifyToken:null,regenerationRequired:true};
  await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,$2,'CredentialWebhookTokenViewed',jsonb_build_object('credentialId',$3::text))`,
    [tenantId,userId,id]);
  return {verifyToken:this.decryptOpaque(rows[0].verify_token_ciphertext,rows[0].encryption_key_id)};
 }
 async setEnabled(tenantId:string,userId:string,id:string,enabled:unknown){
  await this.rbac.require(tenantId,userId,'NamedCredential','manage');
  if(typeof enabled!=='boolean'|| !/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid credential');
  const result=await this.db.query(
   'UPDATE md_named_credentials SET enabled=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id',
   [tenantId,id,enabled]);
  if(!result.rowCount)throw new Error('Credential not found');
  return (await this.list(tenantId,userId)).find(item=>item.id===id);
 }
 async remove(tenantId:string,userId:string,id:string){
  await this.rbac.require(tenantId,userId,'NamedCredential','manage');
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid credential');
  const linked=await this.db.query(`SELECT 1 FROM md_identity_providers
   WHERE tenant_id=$1 AND (token_credential_id=$2 OR jwks_credential_id=$2)`,[tenantId,id]);
  if(linked.rowCount)throw new Error('Federation Named Credentials must be removed from provider settings');
  const result=await this.db.query(
   'DELETE FROM md_named_credentials WHERE tenant_id=$1 AND id=$2 RETURNING id',[tenantId,id]);
  if(!result.rowCount)throw new Error('Credential not found');
 }
 async enqueueCallout(client:PoolClient,tenantId:string,userId:string,runId:string,nodeId:number,
   config:Record<string,unknown>,variables:Record<string,CalloutScalar>){
  // An external callout must never be queued by an unwired runtime.
  if(!this.integrationActivityWriter)throw new Error('Central Communication writer is unavailable');
  await this.rbac.require(tenantId,userId,'NamedCredential','read');
  await this.rbac.require(tenantId,userId,'HTTPCallout','execute');
  const resolvedConfig=await resolveFlowIntegrationCallout(client,this.rbac,tenantId,userId,config);
  const credentialId=resolvedConfig.namedCredentialId;
  const templates=[resolvedConfig.path,resolvedConfig.body,resolvedConfig.headers];
  const {rows:credentialSettings}=await client.query<{
   id:string;configuration_ciphertext:Buffer|null;encryption_key_id:string
  }>(`SELECT id,configuration_ciphertext,encryption_key_id FROM md_named_credentials
    WHERE tenant_id=$1 AND id=$2 AND protocol='HTTPS' AND enabled=true`,
    [tenantId,credentialId]);
  if(!credentialSettings[0])throw new Error('HTTPS credential unavailable');
  const needsPublic=templates.some(value=>typeof value==='string'
    &&/\{!public_[A-Za-z][A-Za-z0-9_]*\}/.test(value));
  const configuration=needsPublic&&credentialSettings[0].configuration_ciphertext
   ?JSON.parse(this.decryptOpaque(credentialSettings[0].configuration_ciphertext,
      credentialSettings[0].encryption_key_id)) as unknown:null;
  const mappedVariables=bindPublicHttpCredentialVariables(variables,configuration,templates);
  if(Object.hasOwn(mappedVariables,'OneSysCommunicationLog'))
   throw new Error('Reserved durable communication metadata variable');
  const prepared=prepareFlowHttpRequest(resolvedConfig,mappedVariables);
  const method=String(resolvedConfig.method??'GET').toUpperCase();
  const path=prepared.path;
  const headers=typeof resolvedConfig.headers==='string'?resolvedConfig.headers:'';
  const body=prepared.body??null;
  const maxAttempts=Number(config.maxAttempts??5);
  const idempotencyKey=typeof config.idempotencyKey==='string'
   ?config.idempotencyKey.trim().replace(/\{!([A-Za-z][A-Za-z0-9_.]*)\}/g,(_match,name:string)=>{
    if(!Object.hasOwn(variables,name))throw new Error('Unknown HTTP Callout idempotency resource');
    return String(variables[name]??'');
   }):'';
  const timeout=Math.min(30000,Math.max(1000,Number(config.timeoutMs)||15000));
  if(typeof credentialId!=='string'||!/^[0-9a-f-]{36}$/i.test(credentialId)
    ||!['GET','POST','PUT','PATCH','DELETE'].includes(method)
    ||typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.length>2048
    ||headers.length>8192||body&&Buffer.byteLength(body)>32768
    ||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>5
    ||idempotencyKey.length>200)
   throw new Error('Invalid durable HTTP Callout configuration');
  await client.query('SAVEPOINT flow_http_callout_job');
  try{
   const credential=await client.query<{id:string}>(`
    SELECT id FROM md_named_credentials
    WHERE tenant_id=$1 AND id=$2 AND protocol='HTTPS' AND enabled=true
   `,[tenantId,credentialId]);
   if(!credential.rows[0])throw new Error('HTTPS credential unavailable');
   const {rows}=await client.query<{id:string}>(`
    INSERT INTO md_http_callout_jobs(tenant_id,run_id,node_id,user_id,credential_id,method,
     path_ciphertext,headers_ciphertext,body_ciphertext,idempotency_key_ciphertext,
     max_attempts,timeout_ms,connection_api,operation_api,operation_path_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id
   `,[tenantId,runId,nodeId,userId,credentialId,method,
    this.encryptValue(path),this.encryptValue(headers),body===null?null:this.encryptValue(body),
    idempotencyKey?this.encryptValue(idempotencyKey):null,maxAttempts,timeout,
    resolvedConfig.integrationConnectionId??null,resolvedConfig.integrationConnectionId
      ?resolvedConfig.operation:null,
    resolvedConfig.integrationConnectionId?this.encryptValue(String(resolvedConfig.path)):null]);
   // Persist channel classification with the durable callout. The worker cannot
   // infer this reliably from a reconstructed HTTP request.
   const communicationLog=resolvedConfig.communicationLog??config.communicationLog;
   if(communicationLog!==undefined){
    if(!communicationLog||typeof communicationLog!=='object'||Array.isArray(communicationLog))
     throw new Error('Invalid Communication classification');
    const serialized=JSON.stringify(communicationLog);
    if(serialized.length>8192)throw new Error('Communication classification too large');
    await client.query(`
     INSERT INTO md_http_callout_job_values(tenant_id,job_id,api_name,value_ciphertext,data_type)
     VALUES($1,$2,'OneSysCommunicationLog',$3,'string')`,
     [tenantId,rows[0].id,this.encryptValue(serialized)]);
   }
   // Persist the trusted credential-derived scalar snapshot encrypted for durable headers.
   for(const [apiName,value] of Object.entries(mappedVariables)){
    if(!/^[A-Za-z][A-Za-z0-9_.]*$/.test(apiName)||!isCalloutScalar(value))
     throw new Error('Invalid durable HTTP Callout variable');
    await client.query(`
     INSERT INTO md_http_callout_job_values(tenant_id,job_id,api_name,value_ciphertext,data_type)
     VALUES($1,$2,$3,$4,$5)
    `,[tenantId,rows[0].id,apiName,this.encryptValue(value===null?'null':String(value)),
     value===null?'null':typeof value]);
   }
   await client.query('RELEASE SAVEPOINT flow_http_callout_job');
   return rows[0].id;
  }catch(error){
   await client.query('ROLLBACK TO SAVEPOINT flow_http_callout_job');
   await client.query('RELEASE SAVEPOINT flow_http_callout_job');
   throw error;
  }
 }
 async dispatchOne(){
  if(this.dispatching)return false;
  this.dispatching=true;
  try{
   const job=await this.db.transaction(async client=>{
    // Unknown remote outcome: quarantine abandoned calls, never send them twice.
    await client.query(`UPDATE md_http_callout_jobs
      SET status='failed',claimed_at=NULL,last_error='RECONCILIATION_REQUIRED',completed_at=now()
      WHERE status='processing' AND claimed_at<now()-interval '5 minutes'`);
    const {rows}=await client.query<CalloutJob>(`
     WITH candidate AS (
      SELECT id FROM md_http_callout_jobs
      WHERE status='queued' AND next_attempt_at<=now()
      ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE md_http_callout_jobs j
     SET status='processing',attempt_count=j.attempt_count+1,claimed_at=now()
     FROM candidate c WHERE j.id=c.id
     RETURNING j.id,j.tenant_id,j.run_id,j.user_id,j.credential_id,j.method,j.path_ciphertext,
     j.headers_ciphertext,j.body_ciphertext,j.idempotency_key_ciphertext,j.max_attempts,
     j.timeout_ms,j.attempt_count,j.connection_api,j.operation_api,j.operation_path_ciphertext
    `);
    return rows[0];
   });
   if(!job)return false;
   try{
    // Validate current tenant, actor and published Flow before any remote side effect.
    const {rows:eligible}=await this.db.query<{api_name:string}>(`
      SELECT f.api_name FROM md_flow_runs r
      JOIN md_flow_definitions f ON f.tenant_id=r.tenant_id AND f.id=r.flow_id
      JOIN md_users u ON u.tenant_id=r.tenant_id AND u.id=r.started_by
      JOIN md_tenants t ON t.id=r.tenant_id
      WHERE r.tenant_id=$1 AND r.id=$2 AND r.started_by=$3
        AND f.active=true AND f.archived=false
        AND u.enabled=true AND t.status='ACTIVE'`,
      [job.tenant_id,job.run_id,job.user_id]);
    if(!eligible.length ||
       !await this.rbac.allowed(job.tenant_id,job.user_id,
        'Flow:'+eligible[0].api_name,'execute'))
      throw new Error('Queued HTTP Callout eligibility changed');
    const {rows}=await this.db.query<CalloutValue>(`
     SELECT api_name,value_ciphertext,data_type FROM md_http_callout_job_values
     WHERE tenant_id=$1 AND job_id=$2
    `,[job.tenant_id,job.id]);
    const variables:Record<string,CalloutScalar>=Object.create(null) as Record<string,CalloutScalar>;
    let communicationLog:Record<string,unknown>|undefined;
    for(const row of rows){
     if(row.api_name==='OneSysCommunicationLog'&&row.data_type==='string'){
      const parsed:unknown=JSON.parse(this.decryptValue(row.value_ciphertext));
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
       throw new Error('Invalid durable communication metadata');
      communicationLog=parsed as Record<string,unknown>;
      continue;
     }
     let value:CalloutScalar;
     const stored=this.decryptValue(row.value_ciphertext);
     if(row.data_type==='null'){
      if(stored!=='null')throw new Error('Invalid queued HTTP Callout null');
      value=null;
     }
     else if(row.data_type==='boolean'){
      if(stored!=='true'&&stored!=='false')throw new Error('Invalid queued HTTP Callout Boolean');
      value=stored==='true';
     }
     else if(row.data_type==='number'){
      value=Number(stored);
      if(!Number.isFinite(value))throw new Error('Invalid queued HTTP Callout number');
     }else if(row.data_type==='string')value=stored;
     else throw new Error('Invalid queued HTTP Callout value type');
     variables[row.api_name]=value;
    }
    if(job.connection_api){
     if(!job.operation_api||!job.operation_path_ciphertext)
      throw new Error('Queued Flow provider identity is incomplete');
     const approved=await resolveFlowIntegrationCallout(this.db,this.rbac,
      job.tenant_id,job.user_id,{integrationConnectionId:job.connection_api,
       operation:job.operation_api});
     if(approved.namedCredentialId!==job.credential_id||approved.method!==job.method
       ||approved.path!==this.decryptValue(job.operation_path_ciphertext))
      throw new Error('Queued Flow provider operation is no longer approved');
    }
    const response=await this.callout(job.tenant_id,job.user_id,{
     namedCredentialId:job.credential_id,method:job.method,
     path:this.decryptValue(job.path_ciphertext),headers:this.decryptValue(job.headers_ciphertext),
     body:job.body_ciphertext?this.decryptValue(job.body_ciphertext):'',
     timeoutMs:job.timeout_ms,
     ...(communicationLog?{communicationLog}:{})
    },variables,job.idempotency_key_ciphertext
      ?this.decryptValue(job.idempotency_key_ciphertext):job.id,true);
    // Commit terminal state and provider acknowledgement atomically.
    await this.db.transaction(async client=>{
     const {rowCount}=await client.query(`
      UPDATE md_http_callout_jobs SET status='completed',completed_at=now(),claimed_at=NULL
      WHERE tenant_id=$1 AND id=$2 AND status='processing'
     `,[job.tenant_id,job.id]);
     if(!rowCount)throw new Error('HTTP Callout claim no longer active');
     await client.query(`
      INSERT INTO md_http_callout_receipts(tenant_id,job_id,attempt,response_status)
      VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,job_id,attempt) DO NOTHING
     `,[job.tenant_id,job.id,job.attempt_count,response.status]);
    });
   }catch(error){
    // Any thrown error may have occurred after a remote side effect.
    await this.db.query(`
     UPDATE md_http_callout_jobs SET status='failed',
      last_error='RECONCILIATION_REQUIRED',claimed_at=NULL,completed_at=now()
     WHERE tenant_id=$1 AND id=$2 AND status='processing'
    `,[job.tenant_id,job.id]);
   }
   return true;
  }finally{this.dispatching=false;}
 }
 async update(tenantId:string,userId:string,id:string,body:unknown){
  await this.rbac.require(tenantId,userId,'NamedCredential','manage');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!body||typeof body!=='object'||Array.isArray(body))
   throw new Error('Invalid credential');
  const current=await this.db.query<{encryption_key_id:string;secret_ciphertext:Buffer|null;configuration_ciphertext:Buffer|null}>(
   'SELECT encryption_key_id,secret_ciphertext,configuration_ciphertext FROM md_named_credentials WHERE tenant_id=$1 AND id=$2',
   [tenantId,id]);
  if(!current.rows[0])throw new Error('Credential not found');
  // A partial update cannot re-label ciphertext encrypted with an older key.
  if(current.rows[0].encryption_key_id!==this.activeKeyId() &&
     (current.rows[0].secret_ciphertext || current.rows[0].configuration_ciphertext))
    throw new Error('Credential key rotation requires a complete re-encryption workflow');
  const x=body as Record<string,unknown>;
  const {rows:bindings}=await this.db.query<{credential_name:string}>(`
   SELECT credential_name FROM md_connector_app_credentials
   WHERE tenant_id=$1 AND credential_id=$2`,[tenantId,id]);
  if(bindings.length&&bindings.some(binding=>binding.credential_name!==x.name))
   throw new Error('Connector credential name cannot be changed');
  if(typeof x.name==='string'&&/^onesys/i.test(x.name)
    &&!bindings.some(binding=>binding.credential_name===x.name))
   throw new Error('System credential names are managed by AppExchange');
  if(typeof x.name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(x.name)||
    typeof x.label!=='string'||!x.label.trim()||
    x.protocol!=='HTTPS'||
    !['None','Bearer','Basic','API Key','OAuth Client Credentials','OAuth Authorization Code','Authorization Scheme'].includes(String(x.authType))||
    typeof x.baseUrl!=='string'||typeof x.headerName!=='string')throw new Error('Invalid credential');
  const linked=await this.db.query(`SELECT 1 FROM md_identity_providers
   WHERE tenant_id=$1 AND (token_credential_id=$2 OR jwks_credential_id=$2)`,[tenantId,id]);
  if(linked.rowCount)throw new Error('Federation Named Credentials must be changed in provider settings');
  if(x.configuration && (typeof x.configuration!=='object'||Array.isArray(x.configuration)
    ||Object.values(x.configuration as object).some(value=>typeof value!=='string')))
    throw new Error('Invalid credential configuration');
  if(x.removedConfigurationKeys!==undefined && (!Array.isArray(x.removedConfigurationKeys)||x.removedConfigurationKeys.length>100||x.removedConfigurationKeys.some(k=>typeof k!=='string'||!/^public_[A-Za-z][A-Za-z0-9_]*$/.test(k))))throw new Error('Invalid removed variable list');
  if(x.secret!==undefined && typeof x.secret!=='string')throw new Error('Invalid credential secret');
  const encrypt=(plain:string):Buffer=>{
   const key=this.key();if(!key)throw new Error('Credential encryption is not configured');
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
   return Buffer.concat([iv,cipher.update(plain,'utf8'),cipher.final(),cipher.getAuthTag()]);
  };
  const encrypted=x.secret?encrypt(x.secret as string):null;
  let existingRemoved:string[]=[];
  if(current.rows[0].configuration_ciphertext){
    try{const previous=JSON.parse(this.decryptOpaque(current.rows[0].configuration_ciphertext,current.rows[0].encryption_key_id));
      if(typeof previous?.__removedPublicFields==='string')existingRemoved=previous.__removedPublicFields.split(',').filter((k:string)=>/^public_[A-Za-z][A-Za-z0-9_]*$/.test(k));
    }catch{/* Invalid prior metadata will be replaced on explicit edits. */}
  }
  const removed=Array.from(new Set([...existingRemoved,...((x.removedConfigurationKeys as string[]|undefined)??[])])).filter(k=>!Object.hasOwn((x.configuration as Record<string,string>|undefined)??{},k));
  const configuration:Record<string,string>={...(x.configuration as Record<string,string>|undefined),...(typeof x.username==='string'&&x.username?{username:x.username}:{})};
  if(removed.length)configuration.__removedPublicFields=removed.join(',');
  const encryptedConfig=configuration&&Object.keys(configuration).length
    ?encrypt(JSON.stringify(configuration)):null;
  const result=await this.db.query(
   `UPDATE md_named_credentials SET name=$3,label=$4,protocol=$5,base_url=$6,
     auth_type=$7,header_name=$8,
     secret_ciphertext=COALESCE($9,secret_ciphertext),
     configuration_ciphertext=CASE WHEN $12::boolean THEN $10 ELSE COALESCE($10,configuration_ciphertext) END,
     encryption_key_id=CASE WHEN $9::bytea IS NOT NULL OR $10::bytea IS NOT NULL THEN $11 ELSE encryption_key_id END,
     updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id`,
   [tenantId,id,x.name,x.label,x.protocol,x.baseUrl,x.authType,x.headerName,encrypted,encryptedConfig,this.activeKeyId(),x.configuration!==undefined]);
  if(!result.rowCount)throw new Error('Credential not found');
  return (await this.list(tenantId,userId)).find(c=>c.id===id);
 }
 
 /** Deliver password recovery mail using the server-only platform SMTP configuration.
  * Tenant Named Credentials and tenant-supplied sender addresses are deliberately ignored.
  */
 async sendRecoveryEmail(tenantId:string,_id:string,_from:string,to:string,subject:string,body:string):Promise<void>{
  const startedAt=Date.now();
  const requestBytes=Buffer.byteLength([to,subject,body].join('\n'));
  let result:{from:string;endpoint:string};
  try{
   result=await sendPlatformRecoveryEmail(to,subject,body);
  }catch(error){
   try{
    await writeIntegrationActivity(this.db,{
     tenantId,direction:'Outbound',transport:'SMTP',provider:'Platform SMTP',
     endpoint:'smtp://platform-configured',method:'SMTP',outcome:'network_error',
     durationMs:Date.now()-startedAt,requestBytes,
     errorCode:error instanceof Error?error.name:'SMTP_ERROR',
     communication:{channel:'Email',name:'Password recovery',provider:'Platform SMTP'}
    },this.integrationActivityWriter);
   }catch{/* Delivery failure must not be masked by a secondary logging failure. */}
   throw error;
  }
  try{
   await writeIntegrationActivity(this.db,{
    tenantId,direction:'Outbound',transport:'SMTP',provider:'Platform SMTP',
    endpoint:result.endpoint,method:'SMTP',outcome:'success',
    durationMs:Date.now()-startedAt,requestBytes,
    communication:{channel:'Email',name:'Password recovery',provider:'Platform SMTP'}
   },this.integrationActivityWriter);
  }catch{
   // A successfully sent recovery token must remain valid if audit projection is unavailable.
   console.error('Password recovery communication logging failed for tenant',tenantId);
  }
 }
 /** Prevent legacy SMTP Quick Actions from appearing to succeed. */
 async sendQuickActionEmail(tenantId:string,userId:string,objectApi:string,recordId:string,
  actionId:string,credentialId:string,from:string,to:string,subject:string,body:string,
  requestKey:string=randomUUID()){
  await this.rbac.require(tenantId,userId,'Email','send');
  void objectApi; void recordId; void actionId; void credentialId;
  void from; void to; void subject; void body; void requestKey;
  throw new Error('SMTP email delivery has been removed; configure email through an HTTP Callout Flow');
 }

 private quickActionEmailDispatching=false;
 async dispatchOneQuickActionEmail(){
  if(this.quickActionEmailDispatching)return false;
  this.quickActionEmailDispatching=true;
  try{
    const job=await this.db.transaction(async client=>{
      await client.query(`UPDATE md_quick_action_email_jobs
        SET status='failed',error_code='DELIVERY_OUTCOME_UNKNOWN',completed_at=now()
        WHERE status='sending' AND claimed_at<now()-interval '5 minutes'`);
      const {rows}=await client.query<{
        id:string;tenant_id:string;user_id:string;object_api:string;record_id:string|null;
        action_id:string;credential_id:string;payload_ciphertext:Buffer;encryption_key_id:string
      }>(`WITH candidate AS(
        SELECT id FROM md_quick_action_email_jobs WHERE status='queued'
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
       ) UPDATE md_quick_action_email_jobs j SET status='sending',claimed_at=now()
       FROM candidate c WHERE j.id=c.id
       RETURNING j.id,j.tenant_id,j.user_id,j.object_api,j.record_id,j.action_id,
        j.credential_id,j.payload_ciphertext,j.encryption_key_id`);
      return rows[0];
    });
    if(!job)return false;
    let errorCode='AUTHORIZATION_CHANGED';
    try{
      const actionResource='Action:'+(job.object_api==='Global'
        ?'Global.':job.object_api+'.')+job.action_id;
      const {rowCount:eligible}=await this.db.query(`
        SELECT 1 FROM md_users u
        JOIN md_tenants t ON t.id=u.tenant_id
        JOIN md_named_credentials c ON c.tenant_id=u.tenant_id AND c.id=$4
        WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true
          AND t.status='ACTIVE' AND c.protocol='SMTP' AND c.enabled=true
          AND (
            ($3='Global' AND EXISTS(
              SELECT 1 FROM md_global_quick_actions a
              WHERE a.tenant_id=u.tenant_id AND a.action_id=$5
                AND a.enabled=true AND a.behavior='Send Email'
                AND a.credential_id=$4))
            OR ($3<>'Global' AND EXISTS(
              SELECT 1 FROM md_object_actions a
              WHERE a.tenant_id=u.tenant_id AND a.object_api=$3 AND a.action_id=$5
                AND a.enabled=true AND a.behavior='Send Email'
                AND a.credential_id=$4))
          )`,
        [job.tenant_id,job.user_id,job.object_api,job.credential_id,job.action_id]);
      if(!eligible
        ||!await this.rbac.allowed(job.tenant_id,job.user_id,actionResource,'execute')
        ||!await this.rbac.allowed(job.tenant_id,job.user_id,'Email','send')
        ||!await this.rbac.allowed(job.tenant_id,job.user_id,'NamedCredential','read'))
        throw new Error('Quick Action email authorization changed');
      if(job.object_api!=='Global'){
        await this.rbac.require(job.tenant_id,job.user_id,job.object_api,'read');
        if(!job.record_id)throw new Error('Quick Action source record unavailable');
        await this.rbac.requireRecord(job.tenant_id,job.user_id,
          job.object_api,job.record_id,'read');
      }
      const payload=JSON.parse(this.decryptValueWithKey(
        job.payload_ciphertext,job.encryption_key_id)) as Record<string,unknown>;
      if(!payload||typeof payload.from!=='string'||typeof payload.to!=='string'
        ||typeof payload.subject!=='string'||typeof payload.body!=='string')
        throw new Error('Queued Quick Action email payload invalid');
      errorCode='SMTP_REMOVED';
      await this.sendTenantEmail(job.tenant_id,job.credential_id,
        payload.from,payload.to,payload.subject,payload.body,job.user_id);
      await this.db.query(`UPDATE md_quick_action_email_jobs SET status='completed',
        claimed_at=NULL,completed_at=now() WHERE tenant_id=$1 AND id=$2 AND status='sending'`,
        [job.tenant_id,job.id]);
      await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
        VALUES($1,$2,'quick-action.email.delivered',jsonb_build_object('jobId',$3::text))`,
        [job.tenant_id,job.user_id,job.id]);
    }catch{
      await this.db.query(`UPDATE md_quick_action_email_jobs SET status='failed',
        error_code=$3,claimed_at=NULL,completed_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='sending'`,
        [job.tenant_id,job.id,errorCode]);
      await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
        VALUES($1,$2,'quick-action.email.failed',
          jsonb_build_object('jobId',$3::text,'errorCode',$4::text))`,
        [job.tenant_id,job.user_id,job.id,errorCode]);
    }
    return true;
  }finally{this.quickActionEmailDispatching=false;}
 }

 async enqueueFlowEmail(client:PoolClient,tenantId:string,userId:string,flowId:string,flowVersion:number,
  runId:string,nodeId:number,step:number,credentialId:string,from:string,recipients:string[],
  subject:string,body:string) {
  await this.rbac.require(tenantId,userId,'Email','send');
  await this.rbac.require(tenantId,userId,'NamedCredential','read');
  void client; void flowId; void flowVersion; void runId; void nodeId; void step;
  void credentialId; void from; void recipients; void subject; void body;
  throw new Error('SMTP email delivery has been removed; configure email through an HTTP Callout Flow');
 }

 private emailDispatching=false;
 async dispatchOneFlowEmail() {
  if(this.emailDispatching)return false;
  this.emailDispatching=true;
  try{
   const job=await this.db.transaction(async client=>{
    await client.query(`UPDATE md_flow_email_jobs SET status='failed',
     error_code='DELIVERY_OUTCOME_UNKNOWN',completed_at=now()
     WHERE status='sending' AND claimed_at<now()-interval '5 minutes'`);
    await client.query(`UPDATE md_flow_email_jobs j SET status='failed',
     error_code='AUTHORIZATION_CHANGED',completed_at=now()
     WHERE j.status='queued' AND NOT EXISTS(
      SELECT 1 FROM md_flow_runs r JOIN md_flow_definitions f
       ON f.tenant_id=r.tenant_id AND f.id=j.flow_id
      WHERE r.tenant_id=j.tenant_id AND r.id=j.run_id
       AND r.flow_id=j.flow_id
       AND r.status IN ('completed','waiting') AND f.version=j.flow_version
       AND f.active=true AND f.archived=false)
      OR j.status='queued' AND NOT EXISTS(
       SELECT 1 FROM md_users u WHERE u.tenant_id=j.tenant_id
        AND u.id=j.user_id AND u.enabled=true)
      OR j.status='queued' AND NOT EXISTS(
       SELECT 1 FROM md_named_credentials c WHERE c.tenant_id=j.tenant_id
        AND c.id=j.credential_id AND c.protocol='SMTP' AND c.enabled=true)`);
    const {rows}=await client.query<FlowEmailJob>(`
     WITH candidate AS(
      SELECT j.id FROM md_flow_email_jobs j
      JOIN md_flow_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id
      JOIN md_flow_definitions f ON f.tenant_id=j.tenant_id AND f.id=j.flow_id
      JOIN md_users u ON u.tenant_id=j.tenant_id AND u.id=j.user_id AND u.enabled=true
      JOIN md_named_credentials c ON c.tenant_id=j.tenant_id AND c.id=j.credential_id
       AND c.protocol='SMTP' AND c.enabled=true
      WHERE j.status='queued' AND r.flow_id=j.flow_id AND r.status IN ('completed','waiting')
       AND f.version=j.flow_version AND f.active=true AND f.archived=false
      ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
     )
     UPDATE md_flow_email_jobs j SET status='sending',claimed_at=now()
     FROM candidate c WHERE j.id=c.id
     RETURNING j.id,j.tenant_id,j.user_id,j.credential_id,j.flow_id,j.flow_version,
      j.payload_ciphertext,j.encryption_key_id,
      (SELECT api_name FROM md_flow_definitions WHERE tenant_id=j.tenant_id AND id=j.flow_id) AS flow_api
    `);
    return rows[0];
   });
   if(!job)return false;
   let errorCode='DELIVERY_FAILED';
   const markFailed=async(code:string)=>{
    await this.db.query(`UPDATE md_flow_email_jobs SET status='failed',
     error_code=$3,completed_at=now(),claimed_at=NULL
     WHERE tenant_id=$1 AND id=$2 AND status='sending'`,
     [job.tenant_id,job.id,code]);
    await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
     VALUES($1,$2,'flow.email.failed',jsonb_build_object('flowId',$3,'jobId',$4,'errorCode',$5))`,
     [job.tenant_id,job.user_id,job.flow_id,job.id,code]);
   };
   let message:{from:string;recipients:string[];subject:string;body:string};
   try{
    const {rows:metadata}=await this.db.query<MetadataValueRow>(`
     SELECT property_path,value_kind,value_text FROM md_flow_editor_values
     WHERE tenant_id=$1 AND flow_id=$2`,[job.tenant_id,job.flow_id]);
    const graph=decodeMetadataValues(metadata).builder as Record<string,unknown>|undefined;
    const appApiName=typeof graph?.appApiName==='string'&&graph.appApiName
     ?graph.appApiName:null;
    const authorized=await flowAppIsEntitled(this.db,job.tenant_id,appApiName)
     &&await this.rbac.allowed(job.tenant_id,job.user_id,'Flow:'+job.flow_api,'execute')
     &&await this.rbac.allowed(job.tenant_id,job.user_id,'Email','send')
     &&await this.rbac.allowed(job.tenant_id,job.user_id,'NamedCredential','read');
    if(!authorized){
     errorCode='AUTHORIZATION_CHANGED';
     throw new Error('Flow email authorization changed');
    }
    let payload:unknown;
    try{payload=JSON.parse(this.decryptValueWithKey(job.payload_ciphertext,job.encryption_key_id));}
    catch{throw new Error('Queued Flow email payload is invalid');}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))
     throw new Error('Queued Flow email payload is invalid');
    const data=payload as Record<string,unknown>;
    if(typeof data.from!=='string'||!Array.isArray(data.recipients)
      ||!data.recipients.every((value):value is string=>typeof value==='string')
      ||typeof data.subject!=='string'||typeof data.body!=='string')
     throw new Error('Queued Flow email payload is invalid');
    message={from:data.from,recipients:data.recipients,subject:data.subject,body:data.body};
   }catch{
    await markFailed(errorCode);
    return true;
   }
   try{
    await this.sendTenantEmail(job.tenant_id,job.credential_id,message.from,
     message.recipients.join(','),message.subject,message.body,job.user_id);
   }catch{
    await markFailed('SMTP_REMOVED');
    return true;
   }
   const {rowCount}=await this.db.query(`UPDATE md_flow_email_jobs SET status='completed',
    completed_at=now(),claimed_at=NULL WHERE tenant_id=$1 AND id=$2 AND status='sending'`,
    [job.tenant_id,job.id]);
   if(!rowCount)throw new Error('Flow email job state changed before completion');
   await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,$2,'flow.email.delivered',jsonb_build_object('flowId',$3,'jobId',$4))`,
    [job.tenant_id,job.user_id,job.flow_id,job.id]);
   return true;
  }finally{this.emailDispatching=false;}
 }

 async sendTenantEmail(tenantId:string,id:string,from:string,to:string,subject:string,body:string,
  actorUserId?:string):Promise<void>{
  void tenantId; void id; void from; void to; void subject; void body; void actorUserId;
  throw new Error('SMTP email delivery has been removed; configure email through an HTTP Callout Flow');
 }

 /** One reusable, host-independent outbound HTTP transport. Credential secrets are never returned to a Flow. */
 async callout(tenantId:string,userId:string,config:Record<string,unknown>,
   variables:Record<string,string|number|boolean|null>,idempotencyKey:string,
   previouslyPrepared=false,maxBodyBytes=32768){
  if(!Number.isInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>8*1024*1024)
   throw Error('Invalid HTTP Callout body size limit');
  // Guard before any provider side effect; Flow configuration never controls logging.
  if(!this.integrationActivityWriter)throw new Error('Central Communication writer is unavailable');
  await this.rbac.require(tenantId,userId,'NamedCredential','read');
  await this.rbac.require(tenantId,userId,'HTTPCallout','execute');
  config=await resolveFlowIntegrationCallout(this.db,this.rbac,tenantId,userId,config);
  if(typeof config.namedCredentialId!=='string'||!/^[0-9a-f-]{36}$/i.test(config.namedCredentialId))
    throw new Error('HTTP Callout requires a saved HTTPS Named Credential');
  const {rows}=await this.db.query<{
   name:string;protocol:string;base_url:string;auth_type:string;header_name:string;
   secret_ciphertext:Buffer|null;configuration_ciphertext:Buffer|null;encryption_key_id:string;enabled:boolean
  }>('SELECT name,protocol,base_url,auth_type,header_name,secret_ciphertext,configuration_ciphertext,encryption_key_id,enabled FROM md_named_credentials WHERE tenant_id=$1 AND id=$2',
    [tenantId,config.namedCredentialId]);
  const item=rows[0];
  if(!item||!item.enabled||item.protocol!=='HTTPS')throw new Error('HTTPS credential unavailable');
  // Only flows that explicitly reference a public_ setting read the encrypted
  // provider configuration. Sensitive settings are never exposed to a Flow.
  const templates=[config.path,config.body,config.headers];
  const needsPublicSetting=templates.some(value=>typeof value==='string'
    &&/\{!public_[A-Za-z][A-Za-z0-9_]*\}/.test(value));
  const decoded=!previouslyPrepared&&needsPublicSetting&&item.configuration_ciphertext
   ?JSON.parse(this.decryptOpaque(item.configuration_ciphertext,item.encryption_key_id)) as unknown:null;
  const flowVariables=previouslyPrepared?variables:
   bindPublicHttpCredentialVariables(variables,decoded,templates);
  // Durable jobs hold an encrypted, already-expanded snapshot. Never expand it twice.
  const prepared=previouslyPrepared?{
   path:String(config.path??''),body:typeof config.body==='string'&&config.body
    ?config.body:undefined
  }:prepareFlowHttpRequest(config,flowVariables,maxBodyBytes);
  const method=String(config.method??'GET').toUpperCase();
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(method))throw new Error('Unsupported HTTP method');
  if(config.deliveryMode==='DURABLE_ASYNC')
   throw new Error('Durable HTTP Callouts must be queued through the SQL dispatcher');
  if(typeof config.path!=='string'||config.path.startsWith('/')||config.path.includes('\\')||config.path.length>2048)
    throw new Error('Invalid relative callout path');
  const substitute=(source:string)=>source.replace(/\{!([A-Za-z][A-Za-z0-9_.]*)\}/g,(_,key:string)=>{
   if(!Object.hasOwn(flowVariables,key))throw new Error('Unknown HTTP Callout resource');
   return String(flowVariables[key]??'');
  });
  const base=new URL(item.base_url);
  if(base.protocol!=='https:'||base.username||base.password||base.hash||base.port&&base.port!=='443')
    throw new Error('HTTP Callouts require a standard HTTPS origin');
  const destination=new URL(prepared.path,base.href.endsWith('/')?base.href:base.href+'/');
  if(destination.origin!==base.origin||destination.username||destination.password||destination.hash)
    throw new Error('HTTP Callout destination is outside Named Credential');
  if(isIP(destination.hostname)||destination.hostname==='localhost'||destination.hostname.endsWith('.local'))
    throw new Error('Direct IP and local network callouts are prohibited');
  const resolved=await lookup(destination.hostname,{all:true,verbatim:true});
  if(!resolved.length||resolved.some(x=>!publicIp(x.address)))
    throw new Error('HTTP Callout destination resolves to a restricted network');
  const header:Record<string,string>={'Accept':'application/json'};
  if(typeof config.headers==='string'&&config.headers.trim()){
   for(const line of config.headers.split(/\r?\n/)){
    const colon=line.indexOf(':');
    if(colon<1)throw new Error('Invalid HTTP header');
    const name=line.slice(0,colon).trim(),value=substitute(line.slice(colon+1).trim());
    if(!/^X-[a-z0-9-]+$/i.test(name)||/[\r\n]/.test(value))throw new Error('Restricted HTTP header');
    header[name]=value;
   }
  }
  let oauthClientSecret:string|undefined;
  if(item.auth_type==='OAuth Authorization Code'){
   header.Authorization='Bearer '+await new OAuthAuthorizationService(
    this.db,this.rbac,this,this.integrationActivityWriter)
    .bearerToken(tenantId,String(config.namedCredentialId),userId);
  }else if(item.auth_type!=='None'){
   const encrypted=item.secret_ciphertext;
   const key=this.keyFor(item.encryption_key_id);
   if(!encrypted||!key||encrypted.length<29)throw new Error('Named Credential cannot be decrypted');
   const decipher=createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));
   decipher.setAuthTag(encrypted.subarray(encrypted.length-16));
   const secret=Buffer.concat([decipher.update(encrypted.subarray(12,encrypted.length-16)),decipher.final()]).toString('utf8');
   if(item.auth_type==='Bearer')header.Authorization='Bearer '+secret;
   else if(item.auth_type==='Basic'){
    // Existing credentials may store an entire user:password string.
    // The Named Credentials editor also supports a separate encrypted username.
    let basicValue=secret;
    if(item.configuration_ciphertext){
     let settings:Record<string,unknown>;
     try{settings=JSON.parse(this.decryptOpaque(item.configuration_ciphertext,item.encryption_key_id)) as Record<string,unknown>;}
     catch{throw new Error('Invalid Basic credential configuration');}
     if(typeof settings.username==='string'&&settings.username&&!secret.startsWith(settings.username+':'))
      basicValue=settings.username+':'+secret;
    }
    header.Authorization='Basic '+Buffer.from(basicValue).toString('base64');
   }
   else if(item.auth_type==='API Key'){
    if(!/^(?:X-[a-z0-9-]+|api-key)$/i.test(item.header_name))throw new Error('Credential header must be an X- header or Brevo api-key');
    header[item.header_name]=secret;
   }else if(item.auth_type==='Authorization Scheme'){
    if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.header_name))
     throw new Error('Invalid authorization scheme');
    header.Authorization=item.header_name+' '+secret;
   }else if(item.auth_type==='OAuth Client Credentials')oauthClientSecret=secret;
   else throw new Error('OAuth Authorization Code requires an interactive authorization grant');
  }
  if(item.auth_type==='OAuth Client Credentials'){
   const cipher=item.configuration_ciphertext,key=this.keyFor(item.encryption_key_id);
   if(!cipher||!key||cipher.length<29||!oauthClientSecret)
    throw new Error('OAuth client configuration is unavailable');
   const decipher=createDecipheriv('aes-256-gcm',key,cipher.subarray(0,12));
   decipher.setAuthTag(cipher.subarray(-16));
   let settings:Record<string,unknown>;
   try {settings=JSON.parse(Buffer.concat([
    decipher.update(cipher.subarray(12,-16)),decipher.final()
   ]).toString('utf8')) as Record<string,unknown>;}
   catch{throw new Error('Invalid OAuth client configuration');}
   const clientId=settings.clientId,tokenPath=settings.tokenPath,scope=settings.scope;
   if(typeof clientId!=='string'||!clientId||clientId.length>512||
      typeof tokenPath!=='string'||!tokenPath||tokenPath.length>1024||
      tokenPath.startsWith('/')||tokenPath.includes('\\')||
      (scope!==undefined&&(typeof scope!=='string'||scope.length>1024)))
    throw new Error('Invalid OAuth client configuration');
   const tokenUrl=new URL(tokenPath,base.href.endsWith('/')?base.href:base.href+'/');
   if(tokenUrl.origin!==base.origin||tokenUrl.username||tokenUrl.password||tokenUrl.hash||
      tokenUrl.search)throw new Error('Invalid OAuth token endpoint');
   const form=new URLSearchParams({grant_type:'client_credentials'});
   if(scope)form.set('scope',scope as string);
   const payload=form.toString();
   const authorization='Basic '+Buffer.from(clientId+':'+oauthClientSecret).toString('base64');
   const tokenStartedAt=Date.now(),tokenRequestBytes=Buffer.byteLength(payload);
   let tokenStatus:number|undefined,tokenResponseBytes=0;
   let tokenResponse:string;
   try{
    const response=await requestExternalHttps(tokenUrl,{method:'POST',timeoutMs:15000,
     maxResponseBytes:8192,body:payload,
     headers:{Authorization:authorization,'Content-Type':'application/x-www-form-urlencoded',
      Accept:'application/json','Content-Length':String(Buffer.byteLength(payload))}});
    tokenStatus=response.status;
    tokenResponseBytes=response.responseBytes;
    if(tokenStatus<200||tokenStatus>=300)
     throw new Error('OAuth token endpoint rejected credentials');
    tokenResponse=response.body;
   }catch(error){
    await writeIntegrationActivity(this.db,{
     tenantId,direction:'Outbound',transport:'HTTP',provider:item.name,
     credentialId:String(config.namedCredentialId),actorUserId:userId,
     endpoint:tokenUrl.origin+tokenUrl.pathname,method:'POST',statusCode:tokenStatus,
     outcome:tokenStatus===undefined?'network_error':'http_error',
     durationMs:Date.now()-tokenStartedAt,requestBytes:tokenRequestBytes,
     responseBytes:tokenResponseBytes,
     errorCode:tokenStatus===undefined
      ?error instanceof Error?error.name:'NETWORK_ERROR':'HTTP_STATUS_'+tokenStatus,
     communication:{name:'OAuth client credentials token exchange',provider:item.name,
      relatedObject:'NamedCredential',relatedRecordId:String(config.namedCredentialId)}
    },this.integrationActivityWriter);
    throw error;
   }
   await writeIntegrationActivity(this.db,{
    tenantId,direction:'Outbound',transport:'HTTP',provider:item.name,
    credentialId:String(config.namedCredentialId),actorUserId:userId,
    endpoint:tokenUrl.origin+tokenUrl.pathname,method:'POST',statusCode:tokenStatus,
    outcome:'success',durationMs:Date.now()-tokenStartedAt,requestBytes:tokenRequestBytes,
    responseBytes:tokenResponseBytes,
    communication:{name:'OAuth client credentials token exchange',provider:item.name,
     relatedObject:'NamedCredential',relatedRecordId:String(config.namedCredentialId)}
   },this.integrationActivityWriter);
   let token:unknown;
   try{token=JSON.parse(tokenResponse);}catch{throw new Error('Invalid OAuth token response');}
   const result=token as {access_token?:unknown;token_type?:unknown};
   if(typeof result.access_token!=='string'||!result.access_token||
      result.access_token.length>8192||result.token_type?.toString().toLowerCase()!=='bearer')
    throw new Error('Invalid OAuth token response');
   header.Authorization='Bearer '+result.access_token;
  }
  if(method!=='GET')header['Idempotency-Key']=idempotencyKey;
  const body=prepared.body;
  if(body&&Buffer.byteLength(body)>maxBodyBytes)throw new Error('HTTP Callout body too large');
  if(body)header['Content-Type']='application/json';
  const timeout=Math.min(30000,Math.max(1000,Number(config.timeoutMs)||15000));
  const requestStartedAt=Date.now();
  const requestBytes=body?Buffer.byteLength(body):0;
  const auditEndpoint=destination.origin+destination.pathname;
  let result:{status:number;body:string;responseBytes:number};
  try{
   result=await requestExternalHttps(destination,{method,headers:header,timeoutMs:timeout,
    maxResponseBytes:65536,body});
  }catch(error){
   await writeIntegrationActivity(this.db,{
    tenantId,direction:'Outbound',transport:'HTTP',provider:item.name,
    credentialId:String(config.namedCredentialId),actorUserId:userId,
    endpoint:auditEndpoint,method,outcome:'network_error',
    durationMs:Date.now()-requestStartedAt,requestBytes,
    errorCode:error instanceof Error?error.name:'NETWORK_ERROR',
    communication:mappedCommunicationDetails(config,flowVariables,undefined,body)
   },this.integrationActivityWriter);
   throw error;
  }
  const successful=result.status>=200&&result.status<300;
  await writeIntegrationActivity(this.db,{
   tenantId,direction:'Outbound',transport:'HTTP',provider:item.name,
   credentialId:String(config.namedCredentialId),actorUserId:userId,
   endpoint:auditEndpoint,method,statusCode:result.status,
   outcome:successful?'success':'http_error',durationMs:Date.now()-requestStartedAt,
   requestBytes,responseBytes:result.responseBytes,
   errorCode:successful?null:'HTTP_STATUS_'+result.status,
   communication:mappedCommunicationDetails(config,flowVariables,successful?result.body:undefined,body)
  },this.integrationActivityWriter);
  if(!successful)throw new Error('HTTP Callout failed with status '+result.status);
  return {status:result.status,body:result.body.slice(0,4096)};
 }

}
