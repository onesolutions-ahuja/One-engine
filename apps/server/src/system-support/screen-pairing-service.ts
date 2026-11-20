import {createHash,randomBytes,randomInt} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {AuthenticationService} from '../system-files/authentication.js';

/**
 * Paired screens (a customer display, a kitchen or order-status screen) for ANY app.
 *  1. The screen opens /display with no sign-in. It gets a 4-digit code and keeps a
 *     random poll secret; only hashes are stored here.
 *  2. A signed-in person on a device (a Till, a Kiosk...) types that code. The screen is
 *     then theirs: it works as that person, under the same RBAC, linked to that device
 *     and to the app page the app chose for it.
 *  3. The screen collects a long-lived screen key once and signs in with it after a
 *     restart. Unpairing ends the key and every session it was given at once.
 * Signing out on the till does not touch the screen: it has its own session family.
 */
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const validSecret=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const deviceKeyPattern=/^[A-Za-z0-9_-]{16,128}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apiName=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
/** A code is valid this long; the screen then shows a new one. */
export const SCREEN_CODE_MINUTES=10;
/** A paired screen keeps its key this long without use. */
const SCREEN_KEY_DAYS=365;
/** Wrong codes one person may type per minute (4 digits). */
const TRIES_PER_MINUTE=10;
export const SCREEN_GONE='This screen is no longer paired. Pair it again from the till.';

export type ScreenSession={accessToken:string;refreshToken:string;expiresIn:number};
export type ScreenTarget={appId:string;pageApiName:string;deviceName:string;mirrorKey:string};
export type PairedScreen={id:string;name:string;appId:string;pageApiName:string;pairedAt:string;lastSeenAt:string|null;online:boolean};
type Actor={tenant_id:string;user_id:string};
type Row={id:string;tenant_id:string|null;user_id:string|null;mfa_verified:boolean;device_record_id:string|null;
 device_name:string|null;mirror_key:string|null;app_id:string|null;page_api_name:string|null;approved_at:Date|null;key_hash:string|null};
/** The device the person pairs from, as the app knows it (its Named Device). */
export type PairingDevice={id:string;name:string;deviceKey:string};

export class ScreenPairingService{
 private readonly tries=new Map<string,number[]>();
 constructor(private readonly db:SqlPersistence,private readonly auth:Pick<AuthenticationService,'issueTrustedDeviceSession'>,
  private readonly now:()=>number=Date.now){}

 /** /display with no sign-in: a new 4-digit code for this screen. */
 async start(screenKey:unknown):Promise<{code:string;poll:string;expiresAt:string}>{
  if(typeof screenKey!=='string'||!deviceKeyPattern.test(screenKey))throw Error('This screen has no valid device key');
  const poll=secret();
  for(let attempt=0;attempt<20;attempt++){
   const code=String(randomInt(0,10_000)).padStart(4,'0');
   // A code is unique among the codes still waiting (anywhere), so one code finds one screen.
   const {rows}=await this.db.query<{code_expires_at:Date}>(`INSERT INTO md_screen_pairings
    (code,poll_hash,screen_key,code_expires_at) SELECT $1,$2,$3,now()+($4::integer * interval '1 minute')
    WHERE NOT EXISTS(SELECT 1 FROM md_screen_pairings WHERE code=$1 AND approved_at IS NULL AND revoked_at IS NULL AND code_expires_at>now())
    RETURNING code_expires_at`,[code,hash(poll),screenKey,SCREEN_CODE_MINUTES]);
   if(rows[0])return {code,poll,expiresAt:new Date(rows[0].code_expires_at).toISOString()};
  }
  throw Error('No pairing code is free right now. Try again in a minute');
 }

 /** The screen asks whether it was paired yet. Paired: its key and first session, once. */
 async poll(poll:unknown,context:{ip?:string}={}):Promise<{status:'waiting'}|{status:'expired'}
  |({status:'paired';key:string;session:ScreenSession}&ScreenTarget)>{
  if(!validSecret(poll))return {status:'expired'};
  const key=secret();
  const {rows}=await this.db.query<Row&{waiting:boolean}>(`UPDATE md_screen_pairings
    SET key_hash=CASE WHEN approved_at IS NOT NULL THEN $2 ELSE key_hash END,
        poll_hash=CASE WHEN approved_at IS NOT NULL THEN NULL ELSE poll_hash END,
        expires_at=CASE WHEN approved_at IS NOT NULL THEN now()+($3::integer * interval '1 day') ELSE expires_at END
    WHERE poll_hash=$1 AND revoked_at IS NULL AND (approved_at IS NOT NULL OR code_expires_at>now())
    RETURNING *,(approved_at IS NULL) AS waiting`,[hash(poll),hash(key),SCREEN_KEY_DAYS]);
  const row=rows[0];
  if(!row)return {status:'expired'};
  if(row.waiting)return {status:'waiting'};
  try{return {status:'paired',key,session:await this.signIn(row,context),...target(row)};}
  catch(error){
   // The person who paired it cannot sign in (disabled, locked, needs MFA): the screen starts over.
   if(error instanceof Error&&/Invalid credentials|MFA required/.test(error.message)){await this.revokeRow(row.id);return {status:'expired'};}
   throw error;
  }
 }

 /** After a restart or an expired session: the saved screen key signs the screen in again. */
 async resume(key:unknown,context:{ip?:string}={}):Promise<{session:ScreenSession}&ScreenTarget>{
  if(!validSecret(key))throw Error(SCREEN_GONE);
  const {rows}=await this.db.query<Row>(`UPDATE md_screen_pairings SET last_seen_at=now(),
    expires_at=now()+($2::integer * interval '1 day')
    WHERE key_hash=$1 AND revoked_at IS NULL AND approved_at IS NOT NULL AND expires_at>now() RETURNING *`,
  [hash(key),SCREEN_KEY_DAYS]);
  const row=rows[0];
  if(!row)throw Error(SCREEN_GONE);
  try{return {session:await this.signIn(row,context),...target(row)};}
  catch(error){
   // The person was disabled, locked out or lost their licence: the screen stops too.
   if(error instanceof Error&&/Invalid credentials|MFA required/.test(error.message)){await this.revokeRow(row.id);throw Error(SCREEN_GONE);}
   throw error;
  }
 }

 /** On the till (signed in): the code shown on the screen pairs it with this device and page. */
 async approve(actor:Actor,mfaVerified:boolean,code:unknown,device:PairingDevice,appId:unknown,pageApiName:unknown,name?:unknown):Promise<PairedScreen>{
  const label=screenName(name);
  if(typeof code!=='string'||!/^\d{4}$/.test(code.trim()))throw Error('Type the 4-digit code shown on the screen');
  if(typeof appId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(appId))throw Error('Choose the app this screen belongs to');
  if(typeof pageApiName!=='string'||!apiName.test(pageApiName))throw Error('Choose the page this screen shows');
  if(!uuid.test(device.id)||!deviceKeyPattern.test(device.deviceKey))throw Error('Set this device up first');
  if(!this.allowTry(actor.tenant_id+'\u0000'+actor.user_id))throw Error('Too many tries. Wait a minute and try again');
  const {rows}=await this.db.query<{id:string;screen_key:string;approved_at:Date}>(`UPDATE md_screen_pairings
    SET tenant_id=$2,user_id=$3,mfa_verified=$4,device_record_id=$5,device_name=$6,mirror_key=$7,app_id=$8,page_api_name=$9,
        approved_at=now(),code=NULL,screen_name=$10
    WHERE id=(SELECT id FROM md_screen_pairings WHERE code=$1 AND approved_at IS NULL AND revoked_at IS NULL
      AND code_expires_at>now() ORDER BY created_at DESC LIMIT 1)
    RETURNING id,screen_key,approved_at`,
  [code.trim(),actor.tenant_id,actor.user_id,mfaVerified,device.id,device.name.slice(0,120),device.deviceKey,appId,pageApiName,label||null]);
  const row=rows[0];
  if(!row)throw Error('That code is wrong or has expired. Check the code on the screen');
  if(row.screen_key===device.deviceKey){await this.revokeRow(row.id);throw Error('Open /display on the other screen, not on this device');}
  return {id:row.id,name:label||'Display',appId,pageApiName,pairedAt:new Date(row.approved_at).toISOString(),lastSeenAt:null,online:false};
 }

 /** Whether the till's own sign-in passed MFA: the screen gets no more than that. */
 async sessionMfa(bearer:string):Promise<boolean>{
  if(!/^[A-Za-z0-9_-]{20,}$/.test(bearer))return false;
  const {rows}=await this.db.query<{mfa_verified:boolean}>('SELECT mfa_verified FROM md_sessions WHERE token_hash=$1 AND revoked_at IS NULL',[hash(bearer)]);
  return rows[0]?.mfa_verified===true;
 }
 /** The screens paired with one device (its settings). Online: the screen used its sign-in
  * in the last minute (a display re-reads every couple of seconds while it is on). */
 async list(actor:Actor,deviceRecordId:string):Promise<PairedScreen[]>{
  if(!uuid.test(deviceRecordId))return [];
  const {rows}=await this.db.query<{id:string;screen_name:string|null;app_id:string;page_api_name:string;approved_at:string;seen:string|null}>(`
   SELECT p.id,p.screen_name,p.app_id,p.page_api_name,p.approved_at,
    GREATEST(p.last_seen_at,(SELECT max(s.last_seen_at) FROM md_sessions s
     WHERE s.tenant_id=p.tenant_id AND s.family_id=ANY(p.session_families) AND s.revoked_at IS NULL)) AS seen
   FROM md_screen_pairings p
   WHERE p.tenant_id=$1 AND p.device_record_id=$2 AND p.approved_at IS NOT NULL AND p.revoked_at IS NULL ORDER BY p.approved_at`,
  [actor.tenant_id,deviceRecordId]);
  const now=this.now();
  return rows.map((row,index)=>{
   const seen=row.seen?new Date(row.seen).toISOString():null;
   return {id:row.id,name:row.screen_name||'Display '+(index+1),appId:row.app_id,pageApiName:row.page_api_name,
    pairedAt:new Date(row.approved_at).toISOString(),lastSeenAt:seen,online:Boolean(seen&&now-Date.parse(seen)<60_000)};
  });
 }

 /** Give a paired screen a name people recognise ("Counter", "Kitchen"). */
 async rename(actor:Actor,id:unknown,name:unknown):Promise<{renamed:boolean}>{
  if(typeof id!=='string'||!uuid.test(id))throw Error('Choose a screen');
  const label=screenName(name);
  if(!label)throw Error('Type a name for the screen');
  const {rows}=await this.db.query<{id:string}>(`UPDATE md_screen_pairings SET screen_name=$3
   WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id`,[id,actor.tenant_id,label]);
  return {renamed:Boolean(rows[0])};
 }

 /** Unpair: the screen key and every session it was given stop at once. */
 async revoke(actor:Actor,id:unknown):Promise<{revoked:boolean}>{
  if(typeof id!=='string'||!uuid.test(id))throw Error('Choose a screen');
  const {rows}=await this.db.query<{id:string}>('SELECT id FROM md_screen_pairings WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL',[id,actor.tenant_id]);
  if(!rows[0])return {revoked:false};
  await this.revokeRow(id);
  return {revoked:true};
 }

 private async signIn(row:Row,context:{ip?:string}):Promise<ScreenSession>{
  if(!row.tenant_id||!row.user_id)throw Error(SCREEN_GONE);
  const session=await this.auth.issueTrustedDeviceSession(row.tenant_id,row.user_id,row.mfa_verified,context);
  // Remember the session family so unpairing can end it, even mid-shift.
  await this.db.query(`UPDATE md_screen_pairings SET last_seen_at=now(),
    session_families=(SELECT array_agg(DISTINCT f) FROM unnest(array_append(session_families,
     (SELECT family_id FROM md_sessions WHERE token_hash=$2))) f WHERE f IS NOT NULL)
    WHERE id=$1`,[row.id,hash(session.accessToken)]);
  return {accessToken:session.accessToken,refreshToken:session.refreshToken,expiresIn:session.expiresIn};
 }
 private async revokeRow(id:string){
  await this.db.transaction(async client=>{
   const {rows}=await client.query<{tenant_id:string|null;session_families:string[]|null}>(
    'UPDATE md_screen_pairings SET revoked_at=now(),key_hash=NULL,poll_hash=NULL,code=NULL WHERE id=$1 RETURNING tenant_id,session_families',[id]);
   const row=rows[0];
   if(!row?.tenant_id||!row.session_families?.length)return;
   for(const table of ['md_sessions','md_refresh_sessions'])
    await client.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND family_id=ANY($2::uuid[]) AND revoked_at IS NULL',
     [row.tenant_id,row.session_families]);
  });
 }
 private allowTry(key:string):boolean{
  const now=this.now();
  const recent=(this.tries.get(key)??[]).filter(at=>now-at<60_000);
  if(this.tries.size>5000)this.tries.clear();
  recent.push(now);this.tries.set(key,recent);
  return recent.length<=TRIES_PER_MINUTE;
 }
}

/** A screen's name: plain text, at most 60 characters ('' = none given). */
const screenName=(name:unknown):string=>typeof name==='string'?name.replace(/[\u0000-\u001f]/g,'').trim().slice(0,60):'';
const target=(row:Row):ScreenTarget=>({appId:row.app_id??'',pageApiName:row.page_api_name??'',
 deviceName:row.device_name??'',mirrorKey:row.mirror_key??''});

export const SCREEN_PAIRING_DDL=`-- Paired screens (customer displays...): only hashes of codes' secrets and screen keys are kept.
CREATE TABLE IF NOT EXISTS md_screen_pairings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text,
 poll_hash text UNIQUE,
 key_hash text UNIQUE,
 screen_key text NOT NULL,
 code_expires_at timestamptz NOT NULL,
 tenant_id uuid REFERENCES md_tenants(id),
 user_id uuid,
 mfa_verified boolean NOT NULL DEFAULT false,
 device_record_id uuid,
 device_name text,
 mirror_key text,
 app_id text,
 page_api_name text,
 session_families uuid[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,
 last_seen_at timestamptz,
 expires_at timestamptz,
 revoked_at timestamptz
);
ALTER TABLE md_screen_pairings ADD COLUMN IF NOT EXISTS screen_name text;
CREATE INDEX IF NOT EXISTS md_screen_pairings_code ON md_screen_pairings(code) WHERE approved_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS md_screen_pairings_device ON md_screen_pairings(tenant_id,device_record_id) WHERE revoked_at IS NULL;
`;
