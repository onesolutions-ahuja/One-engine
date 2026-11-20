import {createHash,randomInt} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import {deviceKeyPattern,findDeviceTill,findMirrorKey,TILL_DEVICE_OBJECT,TILL_DEVICE_TYPE,tillFilters} from './page-code-runtime.js';

/**
 * Which Till a device is. The device makes its own key (a random UUID kept in the
 * browser, or the OS vendor id in the installed app); a Named Device of type POS Terminal
 * (its DeviceId) maps it to one Till. Any signed-in user on that device then gets that Till (BYOD: people sign in
 * anywhere; the device, not the person, decides the Till and so the Location).
 * Setting a device up is a normal Named Device edit: the user's own permissions apply.
 */
type Actor={tenant_id:string;user_id:string};
type Row=Record<string,unknown>;
type Deps={db:Pick<SqlPersistence,'transaction'>;records:Pick<RecordEngine,'list'|'get'|'update'>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This device's Till, plus the active Tills to pick from when it is not set up yet. */
export async function deviceTill(deps:Deps,actor:Actor,deviceKey:unknown):
 Promise<{till:Row|null;tills:Row[];mirrorKey:string;displayFor:string}>{
 const till=await findDeviceTill(deps.records,actor,deviceKey);
 const mirrorKey=await findMirrorKey(deps.records,actor,deviceKey);
 if(till)return {till,tills:[],mirrorKey,displayFor:''};
 const page=await deps.records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,100,0,{sortField:'Name',sortDirection:'asc',
  filters:tillFilters()}) as {records:Row[]};
 // displayFor: the Till this device is paired with as its customer display ('' = not paired).
 const paired=typeof deviceKey==='string'&&deviceKeyPattern.test(deviceKey)
  ?page.records.find(row=>row.CustomerDisplayKey===deviceKey):undefined;
 return {till:null,mirrorKey,displayFor:String(paired?.Name??''),
  tills:page.records.map(row=>({Id:row.Id,Name:row.Name??'',Code:row.Code??'',Location:row.Location??''}))};
}

/** Set this device up as one Till (a device is one Till; a Till is one device). */
export async function setDeviceTill(deps:Deps,actor:Actor,deviceKey:unknown,tillId:unknown,
 seen:{ip?:string;agent?:string}={}):Promise<Row>{
 if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))throw Error('This device has no valid device key');
 if(typeof tillId!=='string'||!uuid.test(tillId))throw Error('Choose a Till');
 return deps.db.transaction(async()=>{
  const till=await deps.records.get(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,tillId) as Row;
  if(till.DeviceType!==TILL_DEVICE_TYPE)throw Error('Choose a Till');
  if(till.Active!==true&&till.Active!=='true')throw Error('That Till is not active');
  // The key moves: a Till previously set up on this device lets it go first.
  const others=await deps.records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,10,0,{filters:[
   {field:'DeviceType',operator:'eq',value:TILL_DEVICE_TYPE},{field:'DeviceId',operator:'eq',value:deviceKey}]}) as {records:Row[]};
  for(const other of others.records)if(other.Id!==tillId)
   await deps.records.update(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,String(other.Id),{DeviceId:null});
  await deps.records.update(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,tillId,{DeviceId:deviceKey,
   DeviceSetUpAt:new Date().toISOString(),DeviceSetUpBy:actor.user_id,
   DeviceIp:seen.ip?.slice(0,64)??null,DeviceAgent:seen.agent?.slice(0,255)??null});
  const bound=await findDeviceTill(deps.records,actor,deviceKey);
  if(!bound)throw Error('The Till could not be set up for this device');
  return bound;
 });
}

/**
 * Pairing a customer display with a Till by a 6-digit code: any browser, Android or iOS
 * device. The Till asks for a code (shown on the till for 5 minutes); the display types it;
 * the Till's CustomerDisplayKey becomes the display's device key, which is what
 * @ThisPage.Device.MirrorKey already follows. Only a hash of the code is stored, the code
 * works once, and a person gets a few tries per minute (a code is only 6 digits).
 */
export const DISPLAY_CODE_TTL_MS=5*60_000;
const DISPLAY_TRIES_PER_MINUTE=10;
const codeHash=(tenantId:string,code:string)=>createHash('sha256').update(tenantId+'\u0000display\u0000'+code).digest('hex');
const tries=new Map<string,number[]>();
function allowTry(key:string,now:number):boolean{
 const recent=(tries.get(key)??[]).filter(at=>now-at<60_000);
 if(tries.size>5000)tries.clear();
 recent.push(now);tries.set(key,recent);
 return recent.length<=DISPLAY_TRIES_PER_MINUTE;
}

/** On the Till: a new pairing code (the previous one stops working). */
export async function startDisplayPairing(deps:Deps,actor:Actor,deviceKey:unknown,now=Date.now()):
 Promise<{code:string;expiresAt:string;till:string}>{
 const till=await findDeviceTill(deps.records,actor,deviceKey);
 if(!till)throw Error('Set this device up as a till first');
 const code=String(randomInt(0,1_000_000)).padStart(6,'0');
 const expiresAt=new Date(now+DISPLAY_CODE_TTL_MS).toISOString();
 await deps.records.update(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,String(till.Id),
  {DisplayPairCode:codeHash(actor.tenant_id,code),DisplayPairExpiresAt:expiresAt});
 return {code,expiresAt,till:String(till.Name??'')};
}

/** On the display: the code from the till links this device to that Till. */
export async function claimDisplayPairing(deps:Deps,actor:Actor,deviceKey:unknown,code:unknown,now=Date.now()):
 Promise<{till:string;mirrorKey:string}>{
 if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))throw Error('This device has no valid device key');
 if(typeof code!=='string'||!/^\d{6}$/.test(code.trim()))throw Error('Enter the 6-digit code shown on the till');
 if(!allowTry(actor.tenant_id+'\u0000'+actor.user_id,now))throw Error('Too many tries. Wait a minute and try again');
 return deps.db.transaction(async()=>{
  const page=await deps.records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,2,0,{filters:tillFilters(
   {field:'DisplayPairCode',operator:'eq',value:codeHash(actor.tenant_id,code.trim())})}) as {records:Row[]};
  const till=page.records[0];
  const expires=Date.parse(String(till?.DisplayPairExpiresAt??''));
  if(!till||!Number.isFinite(expires)||expires<now)throw Error('That code is wrong or has expired. Get a new code on the till');
  if(typeof till.DeviceId!=='string'||!deviceKeyPattern.test(till.DeviceId))throw Error('That till is not set up on a device yet');
  if(till.DeviceId===deviceKey)throw Error('Open the customer display on the other screen, not on the till itself');
  // A display follows one Till: a Till it was paired with before lets it go.
  const others=await deps.records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,10,0,{filters:[
   {field:'DeviceType',operator:'eq',value:TILL_DEVICE_TYPE},{field:'CustomerDisplayKey',operator:'eq',value:deviceKey}]}) as {records:Row[]};
  for(const other of others.records)if(other.Id!==till.Id)
   await deps.records.update(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,String(other.Id),{CustomerDisplayKey:null});
  await deps.records.update(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,String(till.Id),
   {CustomerDisplayKey:deviceKey,DisplayPairCode:null,DisplayPairExpiresAt:null});
  return {till:String(till.Name??''),mirrorKey:till.DeviceId};
 });
}

/** On the Till: forget its customer display (the display then needs a new code). */
export async function unpairDisplay(deps:Deps,actor:Actor,deviceKey:unknown):Promise<{ok:true}>{
 const till=await findDeviceTill(deps.records,actor,deviceKey);
 if(!till)throw Error('Set this device up as a till first');
 await deps.records.update(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,String(till.Id),
  {CustomerDisplayKey:null,DisplayPairCode:null,DisplayPairExpiresAt:null});
 return {ok:true};
}
