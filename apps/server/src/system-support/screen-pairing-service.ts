import {createHash,createHmac,randomBytes,randomInt} from 'node:crypto';
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
/** A message for the person at the screen or till (shown as is, HTTP 400/409), never an outage. */
export class UserActionError extends Error{
 constructor(message:string,readonly status=400){super(message);this.name='UserActionError';}
}
// A function declaration with `never`, so TypeScript narrows after `if(...)fail(...)`.
function fail(message:string,status=400):never{throw new UserActionError(message,status);}
/** A till in use elsewhere: taking it over needs the code in the corner of its screen. */
export const TAKEOVER_CODE_NEEDED='is in use on another device. Type the code shown in the corner of its customer display';

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
  if(typeof screenKey!=='string'||!deviceKeyPattern.test(screenKey))fail('This screen has no valid device key');
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
  fail('No pairing code is free right now. Try again in a minute');
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
  if(typeof code!=='string'||!/^\d{4}$/.test(code.trim()))fail('Type the 4-digit code shown on the screen');
  if(typeof appId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(appId))fail('Choose the app this screen belongs to');
  if(typeof pageApiName!=='string'||!apiName.test(pageApiName))fail('Choose the page this screen shows');
  if(!uuid.test(device.id)||!deviceKeyPattern.test(device.deviceKey))fail('Set this device up first');
  if(!this.allowTry(actor.tenant_id+'\u0000'+actor.user_id))fail('Too many tries. Wait a minute and try again');
  const {rows}=await this.db.query<{id:string;screen_key:string;approved_at:Date}>(`UPDATE md_screen_pairings
    SET tenant_id=$2,user_id=$3,mfa_verified=$4,device_record_id=$5,device_name=$6,mirror_key=$7,app_id=$8,page_api_name=$9,
        approved_at=now(),code=NULL,screen_name=$10
    WHERE id=(SELECT id FROM md_screen_pairings WHERE code=$1 AND approved_at IS NULL AND revoked_at IS NULL
      AND code_expires_at>now() ORDER BY created_at DESC LIMIT 1)
    RETURNING id,screen_key,approved_at`,
  [code.trim(),actor.tenant_id,actor.user_id,mfaVerified,device.id,device.name.slice(0,120),device.deviceKey,appId,pageApiName,label||null]);
  const row=rows[0];
  if(!row)fail('That code is wrong or has expired. Check the code on the screen');
  if(row.screen_key===device.deviceKey){await this.revokeRow(row.id);return fail('Open /display on the other screen, not on this device');}
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
  if(typeof id!=='string'||!uuid.test(id))fail('Choose a screen');
  const label=screenName(name);
  if(!label)fail('Type a name for the screen');
  const {rows}=await this.db.query<{id:string}>(`UPDATE md_screen_pairings SET screen_name=$3
   WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id`,[id,actor.tenant_id,label]);
  return {renamed:Boolean(rows[0])};
 }

 /** Unpair: the screen key and every session it was given stop at once. */
 async revoke(actor:Actor,id:unknown):Promise<{revoked:boolean}>{
  if(typeof id!=='string'||!uuid.test(id))fail('Choose a screen');
  const {rows}=await this.db.query<{id:string}>('SELECT id FROM md_screen_pairings WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL',[id,actor.tenant_id]);
  if(!rows[0])return {revoked:false};
  await this.revokeRow(id);
  return {revoked:true};
 }

 /** The sale a device is on (its selling page's session): a paired screen shows that sale only. */
 async reportSession(actor:Actor,deviceKey:unknown,sessionId:unknown):Promise<{ok:true}>{
  if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))fail('This device has no valid device key');
  if(typeof sessionId!=='string'||!uuid.test(sessionId))fail('Invalid page session');
  await this.db.query(`INSERT INTO md_screen_devices(tenant_id,device_key,session_key,session_at,seen_at,offline)
   VALUES($1,$2,$3,now(),now(),false) ON CONFLICT(tenant_id,device_key) DO UPDATE
   SET page_layers=CASE WHEN md_screen_devices.session_key IS DISTINCT FROM EXCLUDED.session_key
     THEN COALESCE(md_screen_devices.page_layers,'{}'::jsonb)
       ||jsonb_build_object('smart_till_customer_display',0)
     ELSE md_screen_devices.page_layers END,
    payment_confirmation=CASE WHEN md_screen_devices.session_key IS DISTINCT FROM EXCLUDED.session_key
     THEN NULL ELSE md_screen_devices.payment_confirmation END,
    session_key=EXCLUDED.session_key,session_at=now(),seen_at=now(),offline=false`,[actor.tenant_id,deviceKey,sessionId]);
  return {ok:true};
 }
 /** Device presence (the app open on that device, or closed). */
 async deviceSeen(actor:Actor,deviceKey:string,online:boolean):Promise<void>{
  if(!deviceKeyPattern.test(deviceKey))return;
  await this.db.query(`INSERT INTO md_screen_devices(tenant_id,device_key,seen_at,offline) VALUES($1,$2,now(),$3)
   ON CONFLICT(tenant_id,device_key) DO UPDATE SET seen_at=now(),offline=EXCLUDED.offline`,[actor.tenant_id,deviceKey,!online]);
 }
 /** The sale the mirrored device is on now ('' = none reported), and the layer each page
  * should show on its screens (SCREEN(page, n) run on that device). */
 async currentSession(actor:Actor,mirrorKey:unknown):Promise<{sessionId:string;layers:Record<string,number>;payment:Record<string,unknown>|null}>{
  if(typeof mirrorKey!=='string'||!deviceKeyPattern.test(mirrorKey))return {sessionId:'',layers:{},payment:null};
  const {rows}=await this.db.query<{session_key:string|null;page_layers:Record<string,number>|null;
   payment_confirmation:Record<string,unknown>|null}>(
   'SELECT session_key,page_layers,payment_confirmation FROM md_screen_devices WHERE tenant_id=$1 AND device_key=$2',
   [actor.tenant_id,mirrorKey]);
  return {sessionId:rows[0]?.session_key??'',layers:rows[0]?.page_layers??{},
   payment:rows[0]?.payment_confirmation??null};
 }
 /** Only a server-paid Invoice the current user can read is displayed as completed.
  * Ignore client-supplied amount, method and change; get all from the saved invoice. */
 async showPaidInvoice(actor:Actor,deviceKey:unknown,invoice:Record<string,unknown>):
   Promise<{amount:number;method:string;change:number|null;invoiceId:string}>{
  if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))fail('Invalid till device');
  if(typeof invoice.Id!=='string'||!uuid.test(invoice.Id)||String(invoice.Status)!=='Paid')
   fail('Only a completed invoice can be shown as paid');
  const amount=Number(invoice.Total);
  if(!Number.isFinite(amount)||amount<0||amount>100000000)fail('Invalid completed invoice total');
  const method=String(invoice.PaymentMethod??invoice.PaymentType??'');
  const changeRaw=Number(invoice.ChangeAmount);
  // Absent change must remain unknown, never an invented zero.
  const change=invoice.ChangeAmount!==undefined&&invoice.ChangeAmount!==null
   &&invoice.ChangeAmount!==''&&Number.isFinite(changeRaw)&&changeRaw>=0?changeRaw:null;
  const payment={invoiceId:invoice.Id,amount,method,change};
  await this.db.query(`INSERT INTO md_screen_devices(tenant_id,device_key,page_layers,payment_confirmation)
   VALUES($1,$2,jsonb_build_object('smart_till_customer_display',1),$3::jsonb)
   ON CONFLICT(tenant_id,device_key) DO UPDATE SET
    page_layers=COALESCE(md_screen_devices.page_layers,'{}'::jsonb)
      ||jsonb_build_object('smart_till_customer_display',1),
    payment_confirmation=EXCLUDED.payment_confirmation`,
   [actor.tenant_id,deviceKey,JSON.stringify(payment)]);
  return payment;
 }
 /** SCREEN(page, n) on a device: the screens that follow it and show that page switch to layer n.
  * Returns how many paired screens show that page (0: nobody follows it with that page). */
 async showLayer(actor:Actor,deviceKey:unknown,page:unknown,layer:unknown):Promise<{screens:number}>{
  if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))fail('This device has no valid device key');
  if(typeof page!=='string'||!apiName.test(page))fail('Choose the page');
  if(typeof layer!=='number'||!Number.isInteger(layer)||layer<0||layer>9)fail('Choose a layer 0-9');
  const key=page.toLowerCase();
  await this.db.query(`INSERT INTO md_screen_devices(tenant_id,device_key,page_layers) VALUES($1,$2,jsonb_build_object($3::text,$4::int))
   ON CONFLICT(tenant_id,device_key) DO UPDATE SET
    page_layers=COALESCE(md_screen_devices.page_layers,'{}'::jsonb)||jsonb_build_object($3::text,$4::int),
    payment_confirmation=CASE WHEN $3='smart_till_customer_display' AND $4::int=0
     THEN NULL ELSE md_screen_devices.payment_confirmation END`,
  [actor.tenant_id,deviceKey,key,layer]);
  const {rows}=await this.db.query<{count:string}>(`SELECT count(*) AS count FROM md_screen_pairings WHERE tenant_id=$1 AND mirror_key=$2
   AND lower(page_api_name)=$3 AND revoked_at IS NULL AND approved_at IS NOT NULL`,[actor.tenant_id,deviceKey,key]);
  return {screens:Number(rows[0]?.count??0)};
 }
 /** The small code in the corner of a paired screen: changes every minute. Only the screen
  * device paired with that till (its own device key, in this tenant) may read it; its sign-in
  * may change (e.g. a browser shared with the till for testing), its device key does not. */
 async cornerCode(actor:Actor,screenKey:unknown,mirrorKey:unknown):Promise<{code:string;device:string;secondsLeft:number}>{
  if(typeof mirrorKey!=='string'||!deviceKeyPattern.test(mirrorKey))fail('This screen follows no device');
  if(typeof screenKey!=='string'||!deviceKeyPattern.test(screenKey))fail('This screen has no valid device key');
  const {rows}=await this.db.query<{device_name:string}>(`SELECT p.device_name FROM md_screen_pairings p
   WHERE p.tenant_id=$1 AND p.mirror_key=$2 AND p.screen_key=$3 AND p.revoked_at IS NULL AND p.approved_at IS NOT NULL LIMIT 1`,
  [actor.tenant_id,mirrorKey,screenKey]);
  if(!rows[0])fail('Only a paired screen shows its code',403);
  const secret=await this.cornerSecret(actor.tenant_id,mirrorKey as string);
  const minute=Math.floor(this.now()/60_000);
  return {code:cornerCodeFor(secret,minute),device:rows[0]!.device_name??'',secondsLeft:60-Math.floor(this.now()/1000)%60};
 }
 /** Before a device takes over a till in use elsewhere: allowed when the till's device is
  * closed or offline, or no screen of it is on; otherwise the corner code is needed. */
 async checkTakeover(actor:Actor,holderKey:string,tillName:string,code:unknown):Promise<void>{
  if(!deviceKeyPattern.test(holderKey))return;
  const {rows}=await this.db.query<{online:boolean;screens:number;corner_secret:string|null}>(`SELECT
    (d.offline IS NOT TRUE AND d.seen_at>now()-interval '3 minutes') AS online,
    (SELECT count(*)::int FROM md_screen_pairings p WHERE p.tenant_id=$1 AND p.mirror_key=$2 AND p.revoked_at IS NULL
      AND p.approved_at IS NOT NULL AND EXISTS(SELECT 1 FROM md_sessions s WHERE s.tenant_id=p.tenant_id
       AND s.family_id=ANY(p.session_families) AND s.revoked_at IS NULL AND s.last_seen_at>now()-interval '1 minute')) AS screens,
    d.corner_secret
   FROM md_screen_devices d WHERE d.tenant_id=$1 AND d.device_key=$2`,[actor.tenant_id,holderKey]);
  const holder=rows[0];
  if(!holder?.online||!holder.screens||!holder.corner_secret)return;
  const minute=Math.floor(this.now()/60_000);
  const typed=typeof code==='string'?code.trim():'';
  if(/^\d{4}$/.test(typed)&&[minute,minute-1].some(at=>cornerCodeFor(holder.corner_secret!,at)===typed))return;
  if(!this.allowTry('takeover\u0000'+actor.tenant_id+'\u0000'+actor.user_id))fail('Too many tries. Wait a minute and try again',429);
  fail((tillName||'This till')+' '+TAKEOVER_CODE_NEEDED,409);
 }
 private async cornerSecret(tenantId:string,deviceKey:string):Promise<string>{
  const {rows}=await this.db.query<{corner_secret:string}>(`INSERT INTO md_screen_devices(tenant_id,device_key,corner_secret)
   VALUES($1,$2,$3) ON CONFLICT(tenant_id,device_key) DO UPDATE
   SET corner_secret=COALESCE(md_screen_devices.corner_secret,EXCLUDED.corner_secret) RETURNING corner_secret`,
  [tenantId,deviceKey,secret()]);
  return rows[0]!.corner_secret;
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
/** 4 digits from the device's secret and the minute (HMAC): nothing to store per minute. */
export const cornerCodeFor=(secret:string,minute:number)=>
 String(parseInt(createHmac('sha256',secret).update(String(minute)).digest('hex').slice(0,8),16)%10_000).padStart(4,'0');
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
-- Per device: the sale it is on (its selling page's session), presence, and the corner-code secret.
CREATE TABLE IF NOT EXISTS md_screen_devices (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 device_key text NOT NULL,
 session_key uuid,
 session_at timestamptz,
 seen_at timestamptz,
 offline boolean NOT NULL DEFAULT false,
 corner_secret text,
 PRIMARY KEY(tenant_id,device_key)
);
ALTER TABLE md_screen_devices ADD COLUMN IF NOT EXISTS page_layers jsonb;
ALTER TABLE md_screen_devices ADD COLUMN IF NOT EXISTS payment_confirmation jsonb;
CREATE INDEX IF NOT EXISTS md_screen_pairings_mirror ON md_screen_pairings(tenant_id,mirror_key) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS md_screen_pairings_code ON md_screen_pairings(code) WHERE approved_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS md_screen_pairings_device ON md_screen_pairings(tenant_id,device_record_id) WHERE revoked_at IS NULL;
`;
