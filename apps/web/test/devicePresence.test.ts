import test from 'node:test';
import assert from 'node:assert/strict';
import {stampDeviceCarts,validDeviceKey,DEVICE_OFFLINE_AT} from '../../server/src/system-support/device-presence-service';

test('device presence stamps only this device\'s Open carts and never throws',async()=>{
 const calls:unknown[]=[];
 const records={
  list:async(_t:string,_u:string,object:string,_l:number,_o:number,options:unknown)=>{calls.push(['list',object,options]);return {records:[{Id:'c1'},{Id:'c2'}],total:2};},
  update:async(_t:string,_u:string,object:string,id:string,values:unknown)=>{calls.push(['update',object,id,values]);return {};}
 };
 await stampDeviceCarts(records as never,{tenant_id:'t',user_id:'u'},'device-key-1234567890',DEVICE_OFFLINE_AT);
 assert.deepEqual(calls[0],['list','Cart',{filters:[{field:'DeviceKey',operator:'eq',value:'device-key-1234567890'},{field:'Status',operator:'eq',value:'Open'}]}]);
 assert.deepEqual(calls.slice(1),[['update','Cart','c1',{DeviceOnlineAt:DEVICE_OFFLINE_AT,DeviceStatus:'Offline'}],['update','Cart','c2',{DeviceOnlineAt:DEVICE_OFFLINE_AT,DeviceStatus:'Offline'}]]);
 await stampDeviceCarts({list:async()=>{throw Error('down');},update:async()=>({})} as never,{tenant_id:'t',user_id:'u'},'device-key-1234567890','x');
 assert.equal(validDeviceKey('short'),false);
 assert.equal(validDeviceKey('0f3c2b1a-1111-2222-3333-444455556666'),true);
});
