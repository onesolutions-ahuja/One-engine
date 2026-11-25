import {createHash,randomBytes} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';

/**
 * Guest access for ANY app: a link (printed as a QR code) that opens one app page with no
 * sign-in, bound to one record (a table, a room, a locker...). Self ordering at a table is
 * one use: scan the table's QR on a phone, or open it once on the table's tablet.
 *  - Each bound record has its own guest user (enabled, no usable password, internal), with
 *    the profile the link names. That profile is all the guest can do; records the guest
 *    creates are owned by that record's guest user, so one table never sees another's.
 *  - The guest user's User field GuestOf holds the record Id: page formulas read it as
 *    @ThisTenant.User.GuestOf (from SQL on the server, never from the browser).
 *  - Only a hash of the link's secret is kept. A new link for the same record ends the old
 *    one and every guest session it gave (a reprinted QR stops the old sticker).
 */
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apiName=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const appPattern=/^[A-Za-z0-9_-]{1,80}$/;
const tokenPattern=/^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;
export const GUEST_LINK_GONE='This link is no longer valid. Ask a member of staff for help.';
/** A guest session ends after this much idle time; scanning the QR again starts a new one. */
export const GUEST_PATH='/guest/';

type Actor={tenant_id:string;user_id:string};
type Client={query:SqlPersistence['query']};
function checkTarget(step:string,input:{appId:unknown;pageApiName:unknown;recordId:unknown;profile:unknown})
 :{appId:string;pageApiName:string;recordId:string;profile:string}{
 const {appId,pageApiName,recordId,profile}=input;
 if(typeof appId!=='string'||!appPattern.test(appId))throw Error(step+' needs the app');
 if(typeof pageApiName!=='string'||!apiName.test(pageApiName))throw Error(step+' needs the page guests open');
 if(typeof recordId!=='string'||!uuid.test(recordId))throw Error(step+' needs the record the guest is at (e.g. the table Id)');
 if(typeof profile!=='string'||!apiName.test(profile))throw Error(step+' needs the guest profile, e.g. SelfOrder');
 return {appId,pageApiName,recordId,profile};
}
export type GuestSession={accessToken:string;refreshToken:string;expiresIn:number};
export type GuestTarget={appId:string;pageApiName:string;recordId:string;objectApiName:string};
export type GuestLink={id:string;url:string;path:string;userId:string};

export class GuestAccessService{
 constructor(private readonly db:SqlPersistence,
  private readonly auth:Pick<AuthenticationService,'issueTrustedDeviceSession'|'hashPassword'>,
  private readonly rbac:Pick<RbacEngine,'require'>,
  private readonly records:Pick<RecordEngine,'get'>){}

 /** A new link for this record (the old one stops). Needs Security manage: it makes a user. */
 async link(actor:Actor,input:{appId:unknown;pageApiName:unknown;recordId:unknown;profile:unknown;origin?:string}):Promise<GuestLink>{
  const {appId,pageApiName,recordId,profile}=checkTarget('GUESTLINK',input);
  return this.db.transaction(async client=>{
   const guest=await this.guestUser(client,actor,appId,recordId,profile);
   const old=await client.query<{session_families:string[]}>(`UPDATE md_guest_links SET revoked_at=now()
     WHERE tenant_id=$1 AND app_id=$2 AND record_id=$3 AND revoked_at IS NULL RETURNING session_families`,
   [actor.tenant_id,appId,recordId]);
   await endSessions(client,actor.tenant_id,old.rows.flatMap(row=>row.session_families));
   const secret=randomBytes(32).toString('base64url');
   const {rows}=await client.query<{id:string}>(`INSERT INTO md_guest_links(tenant_id,app_id,page_api_name,object_api,record_id,user_id,secret_hash,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING replace(id::text,'-','') AS id`,
   [actor.tenant_id,appId,pageApiName,guest.objectApi,recordId,guest.userId,hash(secret),actor.user_id]);
   const path=GUEST_PATH+rows[0].id+'.'+secret;
   return {id:rows[0].id,path,url:(input.origin??'')+path,userId:guest.userId};
  });
 }

 /** A table's tablet: the guest user a paired screen signs in as (PAIRDISPLAY with a record). */
 async pairingGuest(actor:Actor,input:{appId:unknown;pageApiName:unknown;recordId:unknown;profile:unknown}):Promise<{userId:string;name:string;recordId:string}>{
  const {appId,recordId,profile}=checkTarget('PAIRDISPLAY',input);
  const guest=await this.db.transaction(client=>this.guestUser(client,actor,appId,recordId,profile));
  return {userId:guest.userId,name:guest.name,recordId};
 }

 /** The record's guest user for this app: made once (Security manage), given the profile. */
 private async guestUser(client:Client,actor:Actor,appId:string,recordId:string,profile:string)
  :Promise<{userId:string;objectApi:string;name:string}>{
  await this.rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actor.tenant_id+':guest:'+recordId]);
  // The record must exist and be readable by the person setting the guest up.
  const kind=await client.query<{object_api:string}>('SELECT object_api FROM md_records WHERE tenant_id=$1 AND id=$2 AND is_deleted=false',
   [actor.tenant_id,recordId]);
  if(!kind.rows[0])throw Error('Record not found');
  const row=await this.records.get(actor.tenant_id,actor.user_id,kind.rows[0].object_api,recordId);
  const name=typeof row.Name==='string'&&row.Name?row.Name:recordId;
  const prof=await client.query<{id:string}>('SELECT id FROM md_profiles WHERE tenant_id=$1 AND api_name=$2',[actor.tenant_id,profile]);
  if(!prof.rows[0])throw Error('Create the guest profile '+profile+' first (Setup > Profiles)');
  const email=('guest-'+recordId+'@'+appId+'.guest.invalid').toLowerCase();
  let user=(await client.query<{id:string}>('SELECT id FROM md_users WHERE tenant_id=$1 AND lower(email)=$2',
   [actor.tenant_id,email])).rows[0];
  if(!user){
   // Nobody knows this password: a guest only signs in through its link or a paired tablet.
   const passwordHash=await this.auth.hashPassword(randomBytes(32).toString('base64url')+'aA1!',actor.tenant_id);
   user=(await client.query<{id:string}>(`INSERT INTO md_users(tenant_id,email,display_name,password_hash,enabled,landing_app_api,custom_fields)
     VALUES($1,$2,$3,$4,true,$5,jsonb_build_object('GuestOf',$6::text)) RETURNING id`,
   [actor.tenant_id,email,('Guest · '+name).slice(0,120),passwordHash,appId,recordId])).rows[0];
  }else await client.query(`UPDATE md_users SET enabled=true,landing_app_api=$3,
    custom_fields=COALESCE(custom_fields,'{}'::jsonb)||jsonb_build_object('GuestOf',$4::text) WHERE tenant_id=$1 AND id=$2`,
  [actor.tenant_id,user.id,appId,recordId]);
  await client.query(`INSERT INTO md_user_profiles(tenant_id,user_id,profile_id) VALUES($1,$2,$3)
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET profile_id=EXCLUDED.profile_id`,[actor.tenant_id,user.id,prof.rows[0].id]);
  return {userId:user.id,objectApi:kind.rows[0].object_api,name};
 }

 /** /guest/<token> with no sign-in: a session as the record's guest, and the page to open. */
 async open(token:unknown,context:{ip?:string}={}):Promise<{session:GuestSession}&GuestTarget>{
  const match=typeof token==='string'?tokenPattern.exec(token):null;
  if(!match)throw Error(GUEST_LINK_GONE);
  const id=match[1].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  const {rows}=await this.db.query<{id:string;tenant_id:string;user_id:string;app_id:string;page_api_name:string;
   object_api:string;record_id:string}>(`UPDATE md_guest_links SET last_used_at=now()
    WHERE id=$1 AND secret_hash=$2 AND revoked_at IS NULL RETURNING *`,[id,hash(match[2])]);
  const link=rows[0];
  if(!link)throw Error(GUEST_LINK_GONE);
  let session;
  try{session=await this.auth.issueTrustedDeviceSession(link.tenant_id,link.user_id,false,context);}
  catch(error){if(error instanceof Error&&/Invalid credentials|MFA required/.test(error.message))throw Error(GUEST_LINK_GONE);throw error;}
  // Remember the session family: a new link for this record ends it.
  await this.db.query(`UPDATE md_guest_links SET session_families=COALESCE((SELECT array_agg(DISTINCT f) FROM unnest(array_append(session_families,
    (SELECT family_id FROM md_sessions WHERE token_hash=$2))) f WHERE f IS NOT NULL),session_families) WHERE id=$1`,[link.id,hash(session.accessToken)]);
  return {session:{accessToken:session.accessToken,refreshToken:session.refreshToken,expiresIn:session.expiresIn},
   appId:link.app_id,pageApiName:link.page_api_name,recordId:link.record_id,objectApiName:link.object_api};
 }
}

async function endSessions(client:Client,tenantId:string,families:string[]){
 if(!families.length)return;
 for(const table of ['md_sessions','md_refresh_sessions'])
  await client.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND family_id=ANY($2::uuid[]) AND revoked_at IS NULL',
   [tenantId,families]);
}

export const GUEST_ACCESS_DDL=`-- Guest links (QR codes): only a hash of each link's secret is kept.
CREATE TABLE IF NOT EXISTS md_guest_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_id text NOT NULL,
 page_api_name text NOT NULL,
 object_api text NOT NULL,
 record_id uuid NOT NULL,
 user_id uuid NOT NULL,
 secret_hash text NOT NULL,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz,
 revoked_at timestamptz,
 session_families uuid[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS md_guest_links_live ON md_guest_links(tenant_id,app_id,record_id) WHERE revoked_at IS NULL;
`;
