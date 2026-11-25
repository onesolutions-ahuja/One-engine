import {createHash,randomBytes} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {AuthenticationService} from '../system-files/authentication.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';

/**
 * Guest access for ANY app (like /display): /guest/<code> opens the app's guest page with no
 * sign-in, for one record (a table, a room...). Set per app in App Manager > Guest access:
 * On/Off, the guest page, the guest profile and the Object a guest belongs to.
 *  - GUESTLINK(App, RecordId, AS(x)): the record's link (x.Url, printed as a QR code).
 *  - PAIRGUEST(App, RecordId): a tablet showing /display pairs as the record's guest.
 *  - Each record has its own guest user (the app's guest profile, no usable password), so one
 *    table never sees another's records. @ThisTenant.User.GuestOf = the record Id (from SQL).
 *  - Off in App Manager: every link and guest tablet of the app stops at once (server).
 *  - Only a hash of a link's secret is kept; a new link for a record ends the old one.
 */
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const appPattern=/^[A-Za-z0-9_-]{1,80}$/;
const tokenPattern=/^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;
export const GUEST_LINK_GONE='This link is no longer valid. Ask a member of staff for help.';
export const GUEST_ACCESS_OFF='Ordering here is switched off at the moment. Ask a member of staff.';
export const GUEST_PATH='/guest/';

type Actor={tenant_id:string;user_id:string};
type Client={query:SqlPersistence['query']};
export type GuestSession={accessToken:string;refreshToken:string;expiresIn:number};
export type GuestTarget={appId:string;pageApiName:string;recordId:string;objectApiName:string};
export type GuestLink={id:string;url:string;path:string;userId:string};
export type GuestSettings={enabled:boolean;pageApiName:string;profile:string;objectApiName:string};

/** The app's guest access setting (App Manager), by the app's API name. */
export async function guestSettings(db:Client,tenantId:string,appId:string):Promise<GuestSettings|null>{
 const {rows}=await db.query<{guest_enabled:boolean;guest_page:string|null;guest_profile:string|null;guest_object:string|null}>(`
  SELECT m.guest_enabled,m.guest_page,m.guest_profile,m.guest_object FROM md_apps a
  JOIN md_app_installations i ON i.tenant_id=$1 AND i.app_id=a.id
  JOIN md_app_entitlements e ON e.tenant_id=$1 AND e.app_id=a.id AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
  JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
  WHERE COALESCE(m.api_name,a.api_name)=$2 AND a.enabled=true AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
  LIMIT 1`,[tenantId,appId]);
 const row=rows[0];
 if(!row)return null;
 return {enabled:row.guest_enabled===true,pageApiName:row.guest_page??'',profile:row.guest_profile??'',objectApiName:row.guest_object??''};
}
/** Guest access of an app switched off: end every session its links and guest tablets gave. */
export async function endGuestSessions(client:Client,tenantId:string,appId:string){
 const {rows}=await client.query<{families:string[]|null}>(`SELECT array_agg(DISTINCT f) AS families FROM (
   SELECT unnest(session_families) f FROM md_guest_links WHERE tenant_id=$1 AND app_id=$2 AND revoked_at IS NULL
   UNION ALL SELECT unnest(session_families) FROM md_screen_pairings
    WHERE tenant_id=$1 AND app_id=$2 AND guest=true AND revoked_at IS NULL) x`,[tenantId,appId]);
 await endSessions(client,tenantId,rows[0]?.families??[]);
}

export class GuestAccessService{
 constructor(private readonly db:SqlPersistence,
  private readonly auth:Pick<AuthenticationService,'issueTrustedDeviceSession'|'hashPassword'>,
  private readonly rbac:Pick<RbacEngine,'require'>,
  private readonly records:Pick<RecordEngine,'get'>){}

 /** GUESTLINK: a new link for the record (the old one stops). Security manage: it makes a user. */
 async link(actor:Actor,input:{appId:unknown;recordId:unknown;origin?:string}):Promise<GuestLink>{
  const {appId,recordId}=checkTarget('GUESTLINK',input);
  return this.db.transaction(async client=>{
   const guest=await this.guestUser(client,actor,appId,recordId);
   const old=await client.query<{session_families:string[]}>(`UPDATE md_guest_links SET revoked_at=now()
     WHERE tenant_id=$1 AND app_id=$2 AND record_id=$3 AND revoked_at IS NULL RETURNING session_families`,
   [actor.tenant_id,appId,recordId]);
   await endSessions(client,actor.tenant_id,old.rows.flatMap(row=>row.session_families));
   const secret=randomBytes(32).toString('base64url');
   const {rows}=await client.query<{id:string}>(`INSERT INTO md_guest_links(tenant_id,app_id,object_api,record_id,user_id,secret_hash,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING replace(id::text,'-','') AS id`,
   [actor.tenant_id,appId,guest.objectApi,recordId,guest.userId,hash(secret),actor.user_id]);
   const path=GUEST_PATH+rows[0].id+'.'+secret;
   return {id:rows[0].id,path,url:(input.origin??'')+path,userId:guest.userId};
  });
 }

 /** PAIRGUEST: the guest user a tablet showing /display pairs as, and the page it shows. */
 async pairingGuest(actor:Actor,input:{appId:unknown;recordId:unknown}):Promise<{userId:string;name:string;recordId:string;pageApiName:string}>{
  const {appId,recordId}=checkTarget('PAIRGUEST',input);
  const guest=await this.db.transaction(client=>this.guestUser(client,actor,appId,recordId));
  return {userId:guest.userId,name:guest.name,recordId,pageApiName:guest.pageApiName};
 }

 /** The app's guest page while its guest access is on; throws GUEST_ACCESS_OFF when off. */
 async guestPage(tenantId:string,appId:string):Promise<string>{
  const settings=await guestSettings(this.db,tenantId,appId);
  if(!settings?.enabled||!settings.pageApiName)throw Error(GUEST_ACCESS_OFF);
  return settings.pageApiName;
 }

 /** /guest/<code> with no sign-in: a session as the record's guest, and the app's guest page. */
 async open(token:unknown,context:{ip?:string}={}):Promise<{session:GuestSession}&GuestTarget>{
  const match=typeof token==='string'?tokenPattern.exec(token):null;
  if(!match)throw Error(GUEST_LINK_GONE);
  const id=match[1].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  const {rows}=await this.db.query<{id:string;tenant_id:string;user_id:string;app_id:string;object_api:string;record_id:string}>(
   'SELECT id,tenant_id,user_id,app_id,object_api,record_id FROM md_guest_links WHERE id=$1 AND secret_hash=$2 AND revoked_at IS NULL',
   [id,hash(match[2])]);
  const link=rows[0];
  if(!link)throw Error(GUEST_LINK_GONE);
  const pageApiName=await this.guestPage(link.tenant_id,link.app_id);
  let session;
  try{session=await this.auth.issueTrustedDeviceSession(link.tenant_id,link.user_id,false,context);}
  catch(error){if(error instanceof Error&&/Invalid credentials|MFA required/.test(error.message))throw Error(GUEST_LINK_GONE);throw error;}
  // Remember the session family: a new link for this record, or Off, ends it.
  await this.db.query(`UPDATE md_guest_links SET last_used_at=now(),session_families=COALESCE((SELECT array_agg(DISTINCT f)
    FROM unnest(array_append(session_families,(SELECT family_id FROM md_sessions WHERE token_hash=$2))) f WHERE f IS NOT NULL),
    session_families) WHERE id=$1`,[link.id,hash(session.accessToken)]);
  return {session:{accessToken:session.accessToken,refreshToken:session.refreshToken,expiresIn:session.expiresIn},
   appId:link.app_id,pageApiName,recordId:link.record_id,objectApiName:link.object_api};
 }

 /** The record's guest user for this app: made once (Security manage), with the app's guest profile. */
 private async guestUser(client:Client,actor:Actor,appId:string,recordId:string)
  :Promise<{userId:string;objectApi:string;name:string;pageApiName:string}>{
  await this.rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
  const settings=await guestSettings(client,actor.tenant_id,appId);
  if(!settings)throw Error('App '+appId+' is not installed');
  if(!settings.enabled)throw Error('Turn on Guest access for '+appId+' in App Manager first');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actor.tenant_id+':guest:'+recordId]);
  // The record must exist, be of the app's guest Object and be readable by the person setting it up.
  const kind=await client.query<{object_api:string}>('SELECT object_api FROM md_records WHERE tenant_id=$1 AND id=$2 AND is_deleted=false',
   [actor.tenant_id,recordId]);
  if(!kind.rows[0])throw Error('Record not found');
  if(kind.rows[0].object_api!==settings.objectApiName)
   throw Error(appId+' guests belong to a '+settings.objectApiName+', not a '+kind.rows[0].object_api);
  const row=await this.records.get(actor.tenant_id,actor.user_id,kind.rows[0].object_api,recordId);
  const name=typeof row.Name==='string'&&row.Name?row.Name:recordId;
  const prof=await client.query<{id:string}>('SELECT id FROM md_profiles WHERE tenant_id=$1 AND api_name=$2',[actor.tenant_id,settings.profile]);
  if(!prof.rows[0])throw Error('The guest profile '+settings.profile+' does not exist (Setup > Profiles)');
  const email=('guest-'+recordId+'@'+appId+'.guest.invalid').toLowerCase();
  let user=(await client.query<{id:string}>('SELECT id FROM md_users WHERE tenant_id=$1 AND lower(email)=$2',
   [actor.tenant_id,email])).rows[0];
  if(!user){
   // Nobody knows this password: a guest only signs in through its link or a paired tablet.
   const passwordHash=await this.auth.hashPassword(randomBytes(32).toString('base64url')+'aA1!',actor.tenant_id);
   user=(await client.query<{id:string}>(`INSERT INTO md_users(tenant_id,email,display_name,password_hash,enabled,landing_app_api,custom_fields)
     VALUES($1,$2,$3,$4,true,$5,jsonb_build_object('GuestOf',$6::text)) RETURNING id`,
   [actor.tenant_id,email,('Guest · '+name).slice(0,120),passwordHash,appId,recordId])).rows[0];
  }else await client.query(`UPDATE md_users SET enabled=true,landing_app_api=$3,display_name=$5,
    custom_fields=COALESCE(custom_fields,'{}'::jsonb)||jsonb_build_object('GuestOf',$4::text) WHERE tenant_id=$1 AND id=$2`,
  [actor.tenant_id,user.id,appId,recordId,('Guest · '+name).slice(0,120)]);
  await client.query(`INSERT INTO md_user_profiles(tenant_id,user_id,profile_id) VALUES($1,$2,$3)
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET profile_id=EXCLUDED.profile_id`,[actor.tenant_id,user.id,prof.rows[0].id]);
  return {userId:user.id,objectApi:kind.rows[0].object_api,name,pageApiName:settings.pageApiName};
 }
}

function checkTarget(step:string,input:{appId:unknown;recordId:unknown}):{appId:string;recordId:string}{
 const {appId,recordId}=input;
 if(typeof appId!=='string'||!appPattern.test(appId))throw Error(step+' needs the app, e.g. '+step+'(SelfOrder, @recordId'+(step==='GUESTLINK'?', AS(g))':')'));
 if(typeof recordId!=='string'||!uuid.test(recordId))throw Error(step+' needs the record the guest belongs to (e.g. the table Id)');
 return {appId,recordId};
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
-- A table's tablet paired with PAIRGUEST signs in as the record's guest.
ALTER TABLE md_screen_pairings ADD COLUMN IF NOT EXISTS guest boolean NOT NULL DEFAULT false;
`;
