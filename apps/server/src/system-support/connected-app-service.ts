import {validMcpResource} from './mcp-resource.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {LoginContext} from './session-policy-service.js';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const mint=()=>randomBytes(32).toString('base64url');
// Scope definitions and assignment status live in SQL (md_oauth_scope_catalogue).
// Never accept unknown scope strings just because an OAuth client requests them.
const uuid=z.string().uuid(),scope=z.string().regex(/^[a-z][a-z0-9]*:[a-z][a-z0-9-]*$/).max(64);
const config=z.object({id:uuid.optional(),label:z.string().trim().min(1).max(100),enabled:z.boolean(),client_type:z.enum(['public','confidential']),require_mfa:z.boolean(),
 redirects:z.array(z.string().max(2000).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}})).min(1).max(20),
 scopes:z.array(scope).min(1).max(96),users:z.array(uuid).max(2000)}).strict();
const authorize=z.object({client_id:uuid,redirect_uri:z.string().max(2000),response_type:z.literal('code'),code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
 code_challenge_method:z.literal('S256'),state:z.string().min(16).max(512),scope:z.string().max(4096),resource:z.string().max(2000).optional()}).strip();
type Client={tenant_id:string;id:string;label:string;enabled:boolean;client_type:'public'|'confidential';secret_hash:string|null;require_mfa:boolean};
export class ConnectedAppService{
 constructor(private readonly db:SqlPersistence,private readonly auth:AuthenticationService,private readonly rbac:RbacEngine){}
 async describe(tenant:string,user:string){
  await this.rbac.require(tenant,user,'ConnectedApp','manage');
  const [c,r,s,u,users,catalogue]=await Promise.all([
   this.db.query('SELECT id,label,enabled,client_type,require_mfa FROM md_oauth_clients WHERE tenant_id=$1 ORDER BY label',[tenant]),
   this.db.query('SELECT client_id,uri FROM md_oauth_redirects WHERE tenant_id=$1',[tenant]),
   this.db.query('SELECT client_id,scope FROM md_oauth_client_scopes WHERE tenant_id=$1',[tenant]),
   this.db.query('SELECT client_id,user_id FROM md_oauth_client_users WHERE tenant_id=$1',[tenant]),
   this.db.query('SELECT id,email FROM md_users WHERE tenant_id=$1 ORDER BY email',[tenant]),
   this.db.query<{scope:string;group_key:string;group_label:string;label:string;description:string;risk:string;assignable:boolean}>(
    'SELECT scope,group_key,group_label,label,description,risk,assignable FROM md_oauth_scope_catalogue ORDER BY group_order,sort_order')
  ]);
  return {clients:c.rows.map(p=>({...p,redirects:r.rows.filter(v=>v.client_id===p.id).map(v=>v.uri),scopes:s.rows.filter(v=>v.client_id===p.id).map(v=>v.scope),users:u.rows.filter(v=>v.client_id===p.id).map(v=>v.user_id)})),users:users.rows,scopes:catalogue.rows.filter(s=>s.assignable).map(s=>s.scope),
   scopeGroups:[...new Set(catalogue.rows.map(s=>s.group_key))].map(key=>{
    const items=catalogue.rows.filter(row=>row.group_key===key);
    return {key,label:items[0].group_label,scopes:items.map(({scope,label,description,risk,assignable})=>({scope,label,description,risk,assignable}))};
   })};
 }
 async save(tenant:string,user:string,input:unknown){
  await this.rbac.require(tenant,user,'ConnectedApp','manage');
  const parsed=config.safeParse(input);if(!parsed.success)throw Error('Invalid connected app');const p=parsed.data;
  const active=await this.db.query<{scope:string}>(
   'SELECT scope FROM md_oauth_scope_catalogue WHERE assignable=true AND scope=ANY($1::text[])',[p.scopes]);
  if(new Set(active.rows.map(row=>row.scope)).size!==new Set(p.scopes).size)
   throw Error('Invalid or unavailable OAuth scope');
  const secret=!p.id&&p.client_type==='confidential'?mint():null;
  const id=await this.db.transaction(async c=>{
   let id=p.id;
   if(id){
    const old=await c.query<{client_type:string}>('SELECT client_type FROM md_oauth_clients WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id]);
    if(!old.rows[0])throw Error('Connected app not found');if(old.rows[0].client_type!==p.client_type)throw Error('Invalid client type change');
    await c.query('UPDATE md_oauth_clients SET label=$3,enabled=$4,require_mfa=$5 WHERE tenant_id=$1 AND id=$2',[tenant,id,p.label,p.enabled,p.require_mfa]);
   }else id=(await c.query<{id:string}>('INSERT INTO md_oauth_clients(tenant_id,label,enabled,client_type,secret_hash,require_mfa) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[tenant,p.label,p.enabled,p.client_type,secret?hash(secret):null,p.require_mfa])).rows[0].id;
   for(const table of ['md_oauth_redirects','md_oauth_client_scopes','md_oauth_client_users'])await c.query('DELETE FROM '+table+' WHERE tenant_id=$1 AND client_id=$2',[tenant,id]);
   for(const uri of new Set(p.redirects))await c.query('INSERT INTO md_oauth_redirects VALUES($1,$2,$3,$4)',[tenant,id,uri,new URL(uri).origin]);
   for(const value of new Set(p.scopes))await c.query('INSERT INTO md_oauth_client_scopes VALUES($1,$2,$3)',[tenant,id,value]);
   for(const value of new Set(p.users))await c.query('INSERT INTO md_oauth_client_users VALUES($1,$2,$3)',[tenant,id,value]);
   await c.query('UPDATE md_oauth_consents SET revoked_at=now() WHERE tenant_id=$1 AND client_id=$2 AND revoked_at IS NULL',[tenant,id]);
   return id;
  });return {id,...(secret?{clientSecret:secret}:{})};
 }
 private async client(id:unknown,secret?:unknown){
  if(!uuid.safeParse(id).success)throw Error('Invalid OAuth client');
  const {rows}=await this.db.query<Client>('SELECT * FROM md_oauth_clients WHERE id=$1 AND enabled=true',[id]);const p=rows[0];
  if(!p)throw Error('Invalid OAuth client');
  if(secret!==undefined||p.client_type==='confidential'){
   if(typeof secret!=='string'||!p.secret_hash||!timingSafeEqual(Buffer.from(hash(secret),'hex'),Buffer.from(p.secret_hash,'hex')))throw Error('Invalid OAuth client');
  }return p;
 }
 async rotateSecret(tenant:string,user:string,id:unknown){
  await this.rbac.require(tenant,user,'ConnectedApp','manage');
  if(!uuid.safeParse(id).success)throw Error('Invalid OAuth client');
  const secret=mint();await this.db.transaction(async c=>{
   const found=await c.query("UPDATE md_oauth_clients SET secret_hash=$3 WHERE tenant_id=$1 AND id=$2 AND client_type='confidential' RETURNING id",[tenant,id,hash(secret)]);
   if(!found.rows[0])throw Error('Invalid confidential OAuth client');
   await c.query('UPDATE md_oauth_consents SET revoked_at=now() WHERE tenant_id=$1 AND client_id=$2 AND revoked_at IS NULL',[tenant,id]);
  });return {clientSecret:secret};
 }
 async consent(tenant:string,user:string,input:unknown){
  const parsed=authorize.safeParse(input);if(!parsed.success)throw Error('Invalid OAuth authorization request');const v=parsed.data;
  // No client secret is needed to display consent. Only the authenticated user can grant it.
  const {rows}=await this.db.query<Client>('SELECT * FROM md_oauth_clients WHERE tenant_id=$1 AND id=$2 AND enabled=true',[tenant,v.client_id]);
  const p=rows[0];if(!p)throw Error('Invalid OAuth client');
  const [redirect,member,scopes]=await Promise.all([
   this.db.query('SELECT uri FROM md_oauth_redirects WHERE tenant_id=$1 AND client_id=$2 AND uri=$3',[tenant,p.id,v.redirect_uri]),
   this.db.query('SELECT user_id FROM md_oauth_client_users WHERE tenant_id=$1 AND client_id=$2 AND user_id=$3',[tenant,p.id,user]),
   this.db.query<{scope:string}>('SELECT scope FROM md_oauth_client_scopes WHERE tenant_id=$1 AND client_id=$2',[tenant,p.id])]);
  if(!redirect.rows[0]||!member.rows[0])throw Error('Invalid OAuth client authorization');
  const selected=[...new Set(v.scope.split(' '))];if(!selected.length||selected.some(s=>!scopes.rows.some(v=>v.scope===s)))throw Error('Invalid OAuth scope');
  const enabled=await this.db.query<{scope:string}>(
   'SELECT scope FROM md_oauth_scope_catalogue WHERE assignable=true AND scope=ANY($1::text[])',[selected]);
  if(selected.some(s=>!enabled.rows.some(row=>row.scope===s)))throw Error('Invalid OAuth scope');
  if(selected.includes('mcp:access')?(!v.resource||!validMcpResource(v.resource)):v.resource!==undefined)throw Error('Invalid OAuth resource');
  await this.rbac.require(tenant,user,'API','execute');return {clientId:p.id,label:p.label,scopes:selected,requireMfa:p.require_mfa,request:v};
 }
 async grant(tenant:string,user:string,accessToken:string,input:unknown,approved:unknown){
  const consent=await this.consent(tenant,user,input),v=consent.request;
  const url=new URL(v.redirect_uri);url.searchParams.set('state',v.state);
  if(approved!==true){url.searchParams.set('error','access_denied');return {redirect:url.toString()};}
  const current=await this.db.query<{mfa_verified:boolean}>('SELECT mfa_verified FROM md_sessions WHERE tenant_id=$1 AND user_id=$2 AND token_hash=$3 AND revoked_at IS NULL AND expires_at>now()',[tenant,user,hash(accessToken)]);
  if(!current.rows[0]||(consent.requireMfa&&!current.rows[0].mfa_verified))throw Error('MFA required for connected app consent');
  const code=mint();await this.db.transaction(async c=>{
   const id=(await c.query<{id:string}>('INSERT INTO md_oauth_consents(tenant_id,client_id,user_id,resource) VALUES($1,$2,$3,$4) RETURNING id',[tenant,v.client_id,user,v.resource??null])).rows[0].id;
   await c.query('INSERT INTO md_oauth_codes(code_hash,tenant_id,consent_id,redirect_uri,challenge,mfa_verified) VALUES($1,$2,$3,$4,$5,$6)',[hash(code),tenant,id,v.redirect_uri,v.code_challenge,current.rows[0].mfa_verified]);
   for(const s of consent.scopes)await c.query('INSERT INTO md_oauth_consent_scopes VALUES($1,$2,$3)',[tenant,id,s]);
   await c.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'OAuthConsentGranted')",[tenant,user]);
  });url.searchParams.set('code',code);return {redirect:url.toString()};
 }
 private async bind(tenant:string,consent:string,session:{accessToken:string;refreshToken:string;expiresIn:number}){
  try{
   await this.db.transaction(async c=>{for(const [kind,raw] of [['access',session.accessToken],['refresh',session.refreshToken]])await c.query('INSERT INTO md_oauth_tokens VALUES($1,$2,$3,$4)',[hash(raw),tenant,consent,kind]);});
  }catch(error){await this.auth.signOut(session.accessToken);throw error;}
  return {access_token:session.accessToken,refresh_token:session.refreshToken,token_type:'Bearer',expires_in:session.expiresIn};
 }
 async exchange(input:unknown,context:LoginContext={}){
  const parsed=z.object({grant_type:z.literal('authorization_code'),client_id:uuid,client_secret:z.string().max(200).optional(),code:z.string().regex(/^[\w-]{43}$/),
   resource:z.string().max(2000).optional(),redirect_uri:z.string().max(2000),code_verifier:z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)}).strict().safeParse(input);
  if(!parsed.success)throw Error('Invalid OAuth grant');const v=parsed.data,p=await this.client(v.client_id,v.client_secret);
  const grant=await this.db.transaction(async c=>{
   const {rows}=await c.query<{consent_id:string;user_id:string;redirect_uri:string;challenge:string;mfa_verified:boolean;resource:string|null}>(`SELECT x.consent_id,g.user_id,x.redirect_uri,x.challenge,x.mfa_verified,g.resource FROM md_oauth_codes x JOIN md_oauth_consents g ON g.tenant_id=x.tenant_id AND g.id=x.consent_id
    JOIN md_oauth_client_users a ON a.tenant_id=g.tenant_id AND a.client_id=g.client_id AND a.user_id=g.user_id
    WHERE x.code_hash=$1 AND x.tenant_id=$2 AND g.client_id=$3 AND x.consumed_at IS NULL AND x.expires_at>now() AND g.revoked_at IS NULL FOR UPDATE OF x`,[hash(v.code),p.tenant_id,p.id]);
   const g=rows[0];if(!g||(g.resource??undefined)!==v.resource||g.redirect_uri!==v.redirect_uri||createHash('sha256').update(v.code_verifier).digest('base64url')!==g.challenge)throw Error('Invalid OAuth grant');
   await c.query('UPDATE md_oauth_codes SET consumed_at=now() WHERE code_hash=$1',[hash(v.code)]);return g;
  });await this.rbac.require(p.tenant_id,grant.user_id,'API','execute');
  const session=grant.mfa_verified?await this.auth.issueMfaSession(p.tenant_id,grant.user_id,context):await this.auth.issuePasswordSession(p.tenant_id,grant.user_id,context);
  return this.bind(p.tenant_id,grant.consent_id,session);
 }
 async refresh(input:unknown,context:LoginContext={}){
  const parsed=z.object({grant_type:z.literal('refresh_token'),client_id:uuid,client_secret:z.string().max(200).optional(),refresh_token:z.string().regex(/^[\w-]{43}$/),resource:z.string().max(2000).optional()}).strict().safeParse(input);
  if(!parsed.success)throw Error('Invalid OAuth grant');const v=parsed.data,p=await this.client(v.client_id,v.client_secret);
  const {rows}=await this.db.query<{consent_id:string;revoked_at:Date|null;resource:string|null}>(`SELECT b.consent_id,s.revoked_at,c.resource FROM md_oauth_tokens b JOIN md_oauth_consents c ON c.tenant_id=b.tenant_id AND c.id=b.consent_id
   JOIN md_refresh_sessions s ON s.token_hash=b.token_hash WHERE b.token_hash=$1 AND b.kind='refresh' AND b.tenant_id=$2 AND c.client_id=$3 AND c.revoked_at IS NULL`,[hash(v.refresh_token),p.tenant_id,p.id]);
  const g=rows[0];if(!g||(g.resource??undefined)!==v.resource)throw Error('Invalid OAuth grant');
  if(g.revoked_at){await this.revokeConsent(p.tenant_id,g.consent_id);throw Error('Invalid OAuth grant: refresh replay');}
  let session;
  try{session=await this.auth.refresh(v.refresh_token,{...context,oauthClientId:p.id});}
  catch(error){const used=await this.db.query('SELECT 1 FROM md_refresh_sessions WHERE token_hash=$1 AND revoked_at IS NOT NULL',[hash(v.refresh_token)]);if(used.rows[0])await this.revokeConsent(p.tenant_id,g.consent_id);throw error;}
  return this.bind(p.tenant_id,g.consent_id,session);
 }
 private async revokeConsent(tenant:string,consent:string){
  await this.db.transaction(async c=>{
   await c.query('UPDATE md_oauth_consents SET revoked_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,consent]);
   for(const table of ['md_sessions','md_refresh_sessions'])await c.query(`UPDATE ${table} SET revoked_at=now() WHERE tenant_id=$1 AND token_hash IN(SELECT token_hash FROM md_oauth_tokens WHERE tenant_id=$1 AND consent_id=$2)`,[tenant,consent]);
  });
 }
 async revoke(input:unknown){
  const p=z.object({client_id:uuid,client_secret:z.string().max(200).optional(),token:z.string().max(200)}).strict().safeParse(input);if(!p.success)throw Error('Invalid OAuth grant');
  const client=await this.client(p.data.client_id,p.data.client_secret);
  const found=await this.db.query<{consent_id:string}>(`SELECT b.consent_id FROM md_oauth_tokens b JOIN md_oauth_consents c ON c.tenant_id=b.tenant_id AND c.id=b.consent_id WHERE b.token_hash=$1 AND b.tenant_id=$2 AND c.client_id=$3`,[hash(p.data.token),client.tenant_id,client.id]);
  if(found.rows[0])await this.revokeConsent(client.tenant_id,found.rows[0].consent_id);return {revoked:true};
 }
 async loginOrigin(clientId:unknown){
  if(!uuid.safeParse(clientId).success)throw Error('Invalid OAuth client');
  const {rows}=await this.db.query<{domain:string}>('SELECT d.domain FROM md_oauth_clients c JOIN md_tenant_domains d ON d.tenant_id=c.tenant_id WHERE c.id=$1 AND c.enabled=true ORDER BY d.domain LIMIT 1',[clientId]);
  if(!rows[0])throw Error('Invalid OAuth client');return 'https://'+rows[0].domain;
 }
 async originAllowed(origin:string,token?:string){
  const {rows}=await this.db.query(`SELECT 1 FROM md_oauth_redirects r JOIN md_oauth_clients c ON c.tenant_id=r.tenant_id AND c.id=r.client_id AND c.enabled
   WHERE r.origin=$1 AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM md_oauth_tokens b JOIN md_oauth_consents g ON g.tenant_id=b.tenant_id AND g.id=b.consent_id AND g.revoked_at IS NULL
    WHERE b.token_hash=$2 AND b.kind='access' AND g.tenant_id=c.tenant_id AND g.client_id=c.id)) LIMIT 1`,[origin,token?hash(token):null]);return !!rows[0];
 }
}
