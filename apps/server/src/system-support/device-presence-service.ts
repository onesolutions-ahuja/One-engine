/**
 * Is a device's open sale still being worked on? While the app is open on a device (any
 * page, e.g. Reports), it keeps one connection here. The server stamps the device's Open
 * carts with DeviceOnlineAt every minute; when the connection closes (tab closed, device
 * off, network gone) it stamps a time long ago. A cart whose DeviceOnlineAt is older than
 * two minutes belongs to a device that is gone (this also covers a server restart), so the
 * Held sales window lists it under "Open on other tills" to resume. DeviceStatus says the
 * same as text (Online / Offline), which any list filter can use.
 */
import type {RecordEngine} from '../system-files/record-engine.js';

type Actor={tenant_id:string;user_id:string};
export const DEVICE_OFFLINE_AT='2000-01-01T00:00:00.000Z';
const devicePattern=/^[A-Za-z0-9_-]{16,128}$/;
export const validDeviceKey=(key:unknown):key is string=>typeof key==='string'&&devicePattern.test(key);

/** Stamp the device's Open carts (one per device, a few at most). Never throws. */
export async function stampDeviceCarts(records:Pick<RecordEngine,'list'|'update'>,actor:Actor,deviceKey:string,at:string){
 try{
  const page=await records.list(actor.tenant_id,actor.user_id,'Cart',20,0,{filters:[
   {field:'DeviceKey',operator:'eq',value:deviceKey},{field:'Status',operator:'eq',value:'Open'}]}) as {records:Array<Record<string,unknown>>};
  for(const cart of page.records)
   await records.update(actor.tenant_id,actor.user_id,'Cart',String(cart.Id),
    {DeviceOnlineAt:at,DeviceStatus:at===DEVICE_OFFLINE_AT?'Offline':'Online'});
 }catch{/* presence is a hint; never break the app */}
}
