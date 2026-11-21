import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveFrameParser,isOwnBatch,isOwnEcho,noteOwnBatch} from '../src/core/pages/PageCompiler/liveChanges.ts';
import {drawLiveTap,newTapLedger,type PageLiveTarget} from '../src/core/pages/PageCompiler/pageLiveWiring.ts';
import {LiveChangeHub,readLiveRelay,relayChanges,MAX_RELAY_BYTES} from '../../server/src/system-support/live-changes.ts';
import {actionTurnKey} from '../../server/src/system-support/page-code-runtime.ts';

const provisional=(batch:string,n=1)=>'ffffffff-ffff-4fff-8fff-'+batch+String(n).padStart(4,'0');

test('a tap on another screen arrives as preview, then settled (ok or not)',()=>{
 const events:unknown[]=[];
 const parser=new LiveFrameParser(event=>events.push(event));
 parser.append('event: preview\ndata: {"batch":"0a0b0c0d","changes":[{"objectApiName":"CartLine","operation":"create","record":{"Id":"x","Qty":1}},{"bad":1}]}\n\n');
 parser.append('event: settled\ndata: {"batch":"0a0b0c0d","ok":false,"changes":[]}\n\n');
 parser.append('event: settled\ndata: {"batch":"not-hex!","ok":true,"changes":[]}\n\n');
 assert.deepEqual(events,[
  {kind:'preview',tap:{batch:'0a0b0c0d',ok:true,changes:[{objectApiName:'CartLine',operation:'create',record:{Id:'x',Qty:1}}]}},
  {kind:'settled',tap:{batch:'0a0b0c0d',ok:false,changes:[]}}]);
 noteOwnBatch('11111111');
 assert.equal(isOwnBatch('11111111'),true,'a window skips its own taps coming back');
 assert.equal(isOwnBatch('22222222'),false);
});

function fakeTarget(){
 const saved:unknown[]=[],applied:unknown[]=[],changed:unknown[]=[];
 let reloads=0;
 const target:PageLiveTarget={apiName:'display',pageSessionKey:'S',dataSources:[{id:'cart'} as never],
  data:{saved:async(detail:unknown)=>{saved.push(detail);},live:async()=>undefined,reload:async()=>{reloads++;}} as never,
  code:{applyLiveRows:(object,rows,gone)=>{applied.push([object,rows,gone]);},
   liveChanged:async(objects,without)=>{changed.push([objects,without]);},loadSets:async()=>{reloads++;},refreshTotals:()=>undefined}};
 return {target,saved,applied,changed,reloads:()=>reloads};
}

test('a display draws the till\'s prediction at once, then swaps it for the saved rows',async()=>{
 const batch='00c0ffee';
 const {target,saved,applied,changed}=fakeTarget();
 const ledger=newTapLedger();
 await drawLiveTap(target,'preview',{batch,ok:true,changes:[
  {objectApiName:'CartLine',operation:'create',record:{Id:provisional(batch),Qty:1}},
  {objectApiName:'CartLine',operation:'update',record:{Id:'line-2',Qty:3}}]},ledger);
 assert.deepEqual(saved[0],{pageSessionKey:'S',objectApiNames:['CartLine'],optimistic:batch,live:true,recordChanges:[
  {objectApiName:'CartLine',operation:'create',record:{Id:provisional(batch),Qty:1}},
  {objectApiName:'CartLine',operation:'update',record:{Id:'line-2',Qty:3}}]});
 assert.deepEqual(applied[0],['CartLine',[{Id:provisional(batch),Qty:1},{Id:'line-2',Qty:3}],[]]);
 assert.equal(changed.length,0,'no server read for a prediction');

 await drawLiveTap(target,'settled',{batch,ok:true,changes:[
  {objectApiName:'CartLine',operation:'create',record:{Id:'real-1',Qty:1}},
  {objectApiName:'CartLine',operation:'update',record:{Id:'line-2',Qty:3}}]},ledger);
 assert.equal((saved[1] as {replacesOptimistic:string}).replacesOptimistic,batch,'lists drop the provisional rows');
 assert.deepEqual(applied[1],['CartLine',[{Id:'real-1',Qty:1},{Id:'line-2',Qty:3}],[provisional(batch)]],'held rows too');
 assert.deepEqual(changed[0],[['CartLine'],[]],'server totals over the Object are read again');
 assert.equal(isOwnEcho({object:'CartLine',ids:['real-1','line-2'],count:2,operation:'update'}),true,
  'the database notice of the same rows is skipped (already drawn)');
 // A late preview of an answered tap draws nothing.
 await drawLiveTap(target,'preview',{batch,ok:true,changes:[{objectApiName:'CartLine',operation:'create',record:{Id:provisional(batch)}}]},ledger);
 assert.equal(saved.length,2);
});

test('a tap that was not saved: the display reads again what the prediction touched',async()=>{
 const {target,reloads}=fakeTarget();
 const ledger=newTapLedger();
 await drawLiveTap(target,'preview',{batch:'0000beef',ok:true,changes:[{objectApiName:'CartLine',operation:'update',record:{Id:'l',Qty:9}}]},ledger);
 await drawLiveTap(target,'settled',{batch:'0000beef',ok:false,changes:[]},ledger);
 assert.equal(reloads(),2,'lists and held sets read again');
 // An unknown failed tap (no prediction seen here) reads nothing.
 await drawLiveTap(target,'settled',{batch:'0000dead',ok:false,changes:[]},ledger);
 assert.equal(reloads(),2);
});

test('the server passes a tap only to the same login\'s screens that may read the Object',async()=>{
 const hub=new LiveChangeHub({pool:{connect:()=>new Promise(()=>undefined)}} as never,
  {allowed:async(_tenant:string,_user:string,object:string)=>object==='CartLine'} as never);
 const got:Record<string,unknown[]>={a:[],b:[],other:[]};
 hub.subscribe({tenant_id:'T',user_id:'u1'},(event,data)=>{got.a.push([event,data]);});
 hub.subscribe({tenant_id:'T',user_id:'u1'},(event,data)=>{got.b.push([event,data]);});
 hub.subscribe({tenant_id:'T',user_id:'u2'},(event,data)=>{got.other.push([event,data]);});
 const sent=await hub.relay({tenant_id:'T',user_id:'u1'},'preview',{batch:'0000abcd',changes:[
  {objectApiName:'CartLine',operation:'create',record:{Id:'p'}},{objectApiName:'Secret',operation:'update',record:{Id:'s'}}]});
 assert.equal(sent,2);
 assert.deepEqual(got.a,[['preview',{batch:'0000abcd',changes:[{objectApiName:'CartLine',operation:'create',record:{Id:'p'}}]}]]);
 assert.equal(got.b.length,1);
 assert.equal(got.other.length,0,'another login gets the saved rows the usual way, never a prediction');
 assert.equal(await hub.relay({tenant_id:'T',user_id:'u1'},'preview',{batch:'0000abce',changes:[{objectApiName:'Secret',operation:'update',record:{Id:'s'}}]}),0);
 assert.equal(await hub.relay({tenant_id:'T',user_id:'u1'},'settled',{batch:'0000abce',ok:true,changes:[]}),2,'an answer always goes');
});

test('relayed changes are checked: shape, count and size',()=>{
 assert.deepEqual(readLiveRelay({batch:'0000abcd'}),{batch:'0000abcd',changes:null});
 assert.equal(readLiveRelay({batch:'XYZ'}),null);
 assert.equal(readLiveRelay(null),null);
 assert.equal(relayChanges([{objectApiName:'1bad',operation:'create',record:{Id:'a'}}]),null);
 assert.equal(relayChanges([{objectApiName:'A',operation:'merge',record:{Id:'a'}}]),null);
 assert.equal(relayChanges([{objectApiName:'A',operation:'create',record:{}}]),null);
 assert.equal(relayChanges(Array.from({length:101},(_,i)=>({objectApiName:'A',operation:'create',record:{Id:String(i)}}))),null);
 assert.equal(relayChanges([{objectApiName:'A',operation:'create',record:{Id:'a',Big:'x'.repeat(MAX_RELAY_BYTES)}}]),null);
 assert.deepEqual(relayChanges([{objectApiName:'A',operation:'delete',record:{Id:'a'}}]),[{objectApiName:'A',operation:'delete',record:{Id:'a'}}]);
});

test('one page\'s taps take turns on the server; other pages and devices do not wait',()=>{
 const actor={tenant_id:'T',user_id:'u'};
 assert.equal(actionTurnKey(actor,{sessionId:'sale-1',deviceKey:'dev-1234567890abcdef'}),'page-action:T:session:sale-1');
 assert.notEqual(actionTurnKey(actor,{sessionId:'sale-1'}),actionTurnKey(actor,{sessionId:'sale-2'}));
 assert.notEqual(actionTurnKey(actor,{sessionId:'sale-1'}),actionTurnKey({tenant_id:'T2',user_id:'u'},{sessionId:'sale-1'}));
 assert.equal(actionTurnKey(actor,{sessionId:'',deviceKey:'dev-1234567890abcdef'}),'page-action:T:device:dev-1234567890abcdef');
 assert.equal(actionTurnKey(actor,{sessionId:''}),'');
});
