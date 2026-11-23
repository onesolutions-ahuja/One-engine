import test from 'node:test';
import assert from 'node:assert/strict';
import {attachedTill} from '../../server/src/system-support/till-assignment-service.ts';

const TILL1='11111111-1111-4111-8111-111111111111',TILL2='22222222-2222-4222-8222-222222222222';
const devices=[{Address:'USB-DRAWER-1',AttachedTill:TILL1},{DeviceId:'BT-PRN-2',AttachedTill:TILL2},{Address:'USB-LOOSE'}];
const records={async list(_t:string,_u:string,_o:string,_l:number,_s:number,options:{filters:Array<{field:string;operator:string;value:unknown}>}){
 const f=options.filters[0];
 return {records:devices.filter(d=>(f.value as string[]).includes(String((d as Record<string,unknown>)[f.field]??'')))};
}};
const actor={tenant_id:'t',user_id:'u'};

test('an attached drawer fixed to one Till picks that Till',async()=>{
 assert.equal(await attachedTill({records} as never,actor as never,['USB-DRAWER-1']),TILL1);
});
test('no Till when nothing matches, devices disagree, or a browser sends nothing',async()=>{
 assert.equal(await attachedTill({records} as never,actor as never,['USB-LOOSE']),'');
 assert.equal(await attachedTill({records} as never,actor as never,['USB-DRAWER-1','BT-PRN-2']),'');
 assert.equal(await attachedTill({records} as never,actor as never,undefined),'');
 assert.equal(await attachedTill({records} as never,actor as never,['x']),'');
});
test('the app hook and checklist stay in place',async()=>{
 const {readFile}=await import('node:fs/promises');
 const client=await readFile(new URL('../src/core/authentication/TillDevice/deviceTill.ts',import.meta.url),'utf8');
 assert.match(client,/__uneAttachedDevices/);
 assert.match(client,/attachedDevices:attachedDevices\(\)/);
 const checklist=await readFile(new URL('../../../docs/APP-BUILD-CHECKLIST.md',import.meta.url),'utf8');
 assert.match(checklist,/__uneAttachedDevices/);
 const runtime=await readFile(new URL('../src/component-libraries/smart/shared/SmartRuntime.jsx',import.meta.url),'utf8');
 assert.match(runtime,/selectorPicklist\(p\.selectorPicklistField,p\.objects\)/);
});
