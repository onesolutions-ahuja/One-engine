import test from 'node:test';
import assert from 'node:assert/strict';
import {findMirrorKey} from '../../server/src/system-support/page-code-runtime.ts';
import {parsePageReference} from '../../server/src/expression-engine/PageReferences.ts';

const actor={tenant_id:'t',user_id:'u'};
const till='till-device-key-000000000001',display='display-device-key-0000000001';
const records=(rows:Array<Record<string,unknown>>)=>({
 list:async(_t:string,_u:string,_o:string,_l:number,_off:number,options:{filters:Array<{field:string;value:string}>})=>
  ({records:rows.filter(row=>options.filters.every(f=>f.field==='Active'||row[f.field]===f.value))}),
 get:async()=>({})}) as never;

test('a customer display mirrors the Till it is chosen for; any other screen mirrors itself',async()=>{
 const tills=[{Id:'1',DeviceKey:till,CustomerDisplayKey:display,Active:true}];
 assert.equal(await findMirrorKey(records(tills),actor,display),till);
 assert.equal(await findMirrorKey(records(tills),actor,till),till);
 assert.equal(await findMirrorKey(records([]),actor,display),display,'not chosen yet: its own key (second monitor)');
 assert.equal(await findMirrorKey(records(tills),actor,'bad key'),'');
});

test('@ThisPage.Device.MirrorKey is a page value',()=>{
 assert.deepEqual(parsePageReference('@ThisPage.Device.MirrorKey'),{kind:'device',field:'MirrorKey'});
});
