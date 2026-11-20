import test from 'node:test';
import assert from 'node:assert/strict';
import {findMirrorKey} from '../../server/src/system-support/page-code-runtime.ts';
import {parsePageReference} from '../../server/src/expression-engine/PageReferences.ts';

const actor={tenant_id:'t',user_id:'u'};
const till='till-device-key-000000000001',display='display-device-key-0000000001';
const records=(rows:Array<Record<string,unknown>>)=>({
 list:async(_t:string,_u:string,object:string,_l:number,_off:number,options:{filters:Array<{field:string;value:string}>})=>
  ({records:object!=='NamedDevice'?[]:rows.filter(row=>options.filters.every(f=>f.field==='Active'||row[f.field]===f.value))}),
 get:async()=>({})}) as never;

test('a customer display mirrors the Till (POS Terminal) it is chosen for; any other screen mirrors itself',async()=>{
 const tills=[{Id:'1',DeviceType:'POS Terminal',DeviceId:till,CustomerDisplayKey:display,Active:true},
  // A display registered as a Named Device is not a Till, even if it names a display key.
  {Id:'2',DeviceType:'Customer Display',DeviceId:display,CustomerDisplayKey:'other-display-key-0000001',Active:true}];
 assert.equal(await findMirrorKey(records(tills),actor,display),till);
 assert.equal(await findMirrorKey(records(tills),actor,till),till);
 assert.equal(await findMirrorKey(records([]),actor,display),display,'not chosen yet: its own key (second monitor)');
 // One active Till: an unlinked display follows it with no setup.
 assert.equal(await findMirrorKey(records(tills),actor,'other-display-key-0000001'),till);
 // Two Tills: an unlinked screen cannot guess, it shows its own key.
 const two=[...tills,{Id:'3',DeviceType:'POS Terminal',DeviceId:'till-device-key-000000000002',Active:true}];
 assert.equal(await findMirrorKey(records(two),actor,'other-display-key-0000001'),'other-display-key-0000001');
 assert.equal(await findMirrorKey(records(tills),actor,'bad key'),'');
});

test('@ThisPage.Device.MirrorKey is a page value',()=>{
 assert.deepEqual(parsePageReference('@ThisPage.Device.MirrorKey'),{kind:'device',field:'MirrorKey'});
});
