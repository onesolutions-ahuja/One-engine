import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import {deviceKeyPattern,findDeviceTill} from './page-code-runtime.js';

/**
 * Which Till a device is. The device makes its own key (a random UUID kept in the
 * browser, or the OS vendor id in the installed app); Till.DeviceKey maps it to one
 * Till. Any signed-in user on that device then gets that Till (BYOD: people sign in
 * anywhere; the device, not the person, decides the Till and so the Location).
 * Setting a device up is a normal Till edit: the user's own permissions apply.
 */
type Actor={tenant_id:string;user_id:string};
type Row=Record<string,unknown>;
type Deps={db:Pick<SqlPersistence,'transaction'>;records:Pick<RecordEngine,'list'|'get'|'update'>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This device's Till, plus the active Tills to pick from when it is not set up yet. */
export async function deviceTill(deps:Deps,actor:Actor,deviceKey:unknown):Promise<{till:Row|null;tills:Row[]}>{
 const till=await findDeviceTill(deps.records,actor,deviceKey);
 if(till)return {till,tills:[]};
 const page=await deps.records.list(actor.tenant_id,actor.user_id,'Till',100,0,{sortField:'Name',sortDirection:'asc',
  filters:[{field:'Active',operator:'eq',value:'true'}]}) as {records:Row[]};
 return {till:null,tills:page.records.map(row=>({Id:row.Id,Name:row.Name??'',Code:row.Code??'',Location:row.Location??''}))};
}

/** Set this device up as one Till (a device is one Till; a Till is one device). */
export async function setDeviceTill(deps:Deps,actor:Actor,deviceKey:unknown,tillId:unknown,
 seen:{ip?:string;agent?:string}={}):Promise<Row>{
 if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))throw Error('This device has no valid device key');
 if(typeof tillId!=='string'||!uuid.test(tillId))throw Error('Choose a Till');
 return deps.db.transaction(async()=>{
  const till=await deps.records.get(actor.tenant_id,actor.user_id,'Till',tillId) as Row;
  if(till.Active!==true&&till.Active!=='true')throw Error('That Till is not active');
  // The key moves: a Till previously set up on this device lets it go first (DeviceKey is unique).
  const others=await deps.records.list(actor.tenant_id,actor.user_id,'Till',10,0,{filters:[
   {field:'DeviceKey',operator:'eq',value:deviceKey}]}) as {records:Row[]};
  for(const other of others.records)if(other.Id!==tillId)
   await deps.records.update(actor.tenant_id,actor.user_id,'Till',String(other.Id),{DeviceKey:null});
  await deps.records.update(actor.tenant_id,actor.user_id,'Till',tillId,{DeviceKey:deviceKey,
   DeviceSetUpAt:new Date().toISOString(),DeviceSetUpBy:actor.user_id,
   DeviceIp:seen.ip?.slice(0,64)??null,DeviceAgent:seen.agent?.slice(0,255)??null});
  const bound=await findDeviceTill(deps.records,actor,deviceKey);
  if(!bound)throw Error('The Till could not be set up for this device');
  return bound;
 });
}
