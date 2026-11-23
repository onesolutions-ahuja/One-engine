import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {UserActionError} from './screen-pairing-service.js';
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
export async function deviceTill(deps:Deps,actor:Actor,deviceKey:unknown,attachedDevices?:unknown):Promise<{till:Row|null;tills:Row[];mirrorKey:string;suggestedTillId?:string}>{
 const till=await findDeviceTill(deps.records,actor,deviceKey);
 const mirrorKey=await findMirrorKey(deps.records,actor,deviceKey);
 if(till)return {till,tills:[],mirrorKey};
 // An installed app lists the devices it sees attached (window.__uneAttachedDevices). A drawer
 // or printer fixed to exactly one Till sets this device up as that Till, if this person may;
 // otherwise that Till is offered first. Browsers send nothing and the page asks as before.
 const suggested=await attachedTill(deps,actor,attachedDevices);
 if(suggested){
  try{return {till:await setDeviceTill(deps,actor,deviceKey,suggested),tills:[],mirrorKey};}catch{/* asks below */}
 }
 const page=await deps.records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,100,0,{sortField:'Name',sortDirection:'asc',
  filters:tillFilters()}) as {records:Row[]};
 const tills=page.records.map(row=>({Id:row.Id,Name:row.Name??'',Code:row.Code??'',Location:row.Location??''}))
  .sort((a,b)=>Number(b.Id===suggested)-Number(a.Id===suggested));
 return {till:null,mirrorKey,tills,...(suggested?{suggestedTillId:suggested}:{})};
}

/** The one Till that the attached devices (USB/Bluetooth/serial IDs) are fixed to, or ''. */
export async function attachedTill(deps:Pick<Deps,'records'>,actor:Actor,attachedDevices:unknown):Promise<string>{
 const ids=Array.isArray(attachedDevices)?[...new Set(attachedDevices.filter((id):id is string=>
  typeof id==='string'&&/^[\x21-\x7e]{3,128}$/.test(id)))].slice(0,20):[];
 if(!ids.length)return '';
 const tills=new Set<string>();
 for(const field of ['Address','DeviceId']){
  const found=await deps.records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,50,0,{filters:[
   {field,operator:'in',value:ids},{field:'Active',operator:'eq',value:'true'}]}) as {records:Row[]};
  for(const row of found.records)if(typeof row.AttachedTill==='string'&&uuid.test(row.AttachedTill))tills.add(row.AttachedTill);
 }
 return tills.size===1?[...tills][0]:'';
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

/** The device a person pairs a screen from: this device's active Named Device of any type
 * (a POS Terminal, a Kiosk...), found by its device key. */
export async function pairingDevice(records:Pick<RecordEngine,'list'>,actor:Actor,deviceKey:unknown):Promise<{id:string;name:string;deviceKey:string}>{
 if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))throw new UserActionError('This device has no valid device key');
 const page=await records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,2,0,{filters:[
  {field:'DeviceId',operator:'eq',value:deviceKey},{field:'Active',operator:'eq',value:'true'}]}) as {records:Row[]};
 const device=page.records[0];
 if(!device)throw new UserActionError('Set this device up first (e.g. choose which till it is)');
 return {id:String(device.Id),name:String(device.Name??''),deviceKey};
}
