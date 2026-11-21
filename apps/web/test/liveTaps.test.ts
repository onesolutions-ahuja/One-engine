import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveFrameParser,isOwnBatch,isOwnEcho,noteOwnBatch} from '../src/core/pages/PageCompiler/liveChanges.ts';
import {drawLiveTap,newTapLedger,waitingFor,withoutWaiting,TAP_WAIT_MS,type PageLiveTarget} from '../src/core/pages/PageCompiler/pageLiveWiring.ts';
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

test('fast taps: an older answer never draws over a newer tap still waiting (1, 2, 3 never shows 1, 2, 1)',async()=>{
 const {target,saved,applied,changed}=fakeTarget();
 const ledger=newTapLedger();
 const line=(qty:number)=>[{objectApiName:'CartLine',operation:'update' as const,record:{Id:'line-1',Qty:qty}}];
 await drawLiveTap(target,'preview',{batch:'0000000a',ok:true,changes:line(1)},ledger);
 await drawLiveTap(target,'preview',{batch:'0000000b',ok:true,changes:line(2)},ledger);
 await drawLiveTap(target,'settled',{batch:'0000000a',ok:true,changes:line(1)},ledger);
 assert.equal(saved.length,2,'tap 1\'s saved row waits for tap 2: lists are not touched (no re-read)');
 assert.equal(applied.length,2,'held rows keep tap 2\'s prediction');
 assert.equal(changed.length,0,'no server totals while a tap on the Object waits');
 // A database notice of the same line now is left to tap 2's answer; other rows still draw.
 const notice=[{object:'CartLine',ids:new Set(['line-1','line-9']),count:2,operation:'update',
  rows:new Map([['line-1',{Id:'line-1',Qty:1}],['line-9',{Id:'line-9',Qty:7}]]),created:new Set<string>()}];
 const kept=withoutWaiting(notice,waitingFor(ledger));
 assert.deepEqual([...kept[0].ids],['line-9']);
 assert.deepEqual([...kept[0].rows!.keys()],['line-9']);
 assert.equal(kept[0].count,1);
 assert.equal(withoutWaiting([{...notice[0],ids:new Set(['line-1']),rows:new Map([['line-1',{Id:'line-1'}]])}],waitingFor(ledger)).length,0);
 await drawLiveTap(target,'settled',{batch:'0000000b',ok:true,changes:line(2)},ledger);
 assert.deepEqual(applied[2],['CartLine',[{Id:'line-1',Qty:2}],[]],'the last answer draws the saved row');
 assert.deepEqual(changed[0],[['CartLine'],[]]);
 // A tap whose answer never comes stops holding its rows.
 await drawLiveTap(target,'preview',{batch:'0000000c',ok:true,changes:line(3)},ledger,1000);
 assert.equal(waitingFor(ledger,1000+TAP_WAIT_MS+1).ids.size,0);
});

test('a session with several carts (after Clear sale or Hold) uses its newest one, never a guess',async()=>{
 const {newestSessionParent,pageComponentSessionRelatedQuery}=await import('../src/core/pages/PageRuntime/pageComponentBindings.ts');
 assert.deepEqual(newestSessionParent([{Id:'a'}]),{Id:'a'});
 assert.equal(newestSessionParent([{Id:'old',CreatedAt:'2026-11-21T10:00:00Z'},{Id:'new',CreatedAt:'2026-11-21T11:00:00Z'}])?.Id,'new');
 assert.equal(newestSessionParent([{Id:'a',CreatedAt:'2026-11-21T10:00:00Z'},{Id:'b'}]),null,'no time to tell them apart');
 assert.equal(newestSessionParent([{Id:'a',CreatedAt:'2026-11-21T10:00:00Z'},{Id:'b',CreatedAt:'2026-11-21T10:00:00Z'}]),null,'a tie');
 const fields=[{apiName:'Cart',relationship:{targetObject:'Cart'},dataType:'reference',type:'reference'}] as never;
 const objects=[{apiName:'Cart',fields:[{apiName:'SessionKey',dataType:'text',type:'text'}]}] as never;
 const query=await pageComponentSessionRelatedQuery(fields,objects,'sale-1',async()=>({total:2,records:[
  {Id:'cleared',CreatedAt:'2026-11-21T10:00:00Z'},{Id:'current',CreatedAt:'2026-11-21T10:05:00Z'}]}));
 assert.equal(query.blocked,false);
 assert.equal(query.filter?.value,'current');
});

test('a new row of another parent makes a parent-scoped list read again (its parent may be new)',async()=>{
 const {applySavedRecordMutations}=await import('../src/core/pages/PageRuntime/pageMutationScope.ts');
 const scope={total:1,offset:0,pageSize:2,readObjectApiNames:['CartLine'],relatedFilter:{field:'Cart',value:'old',related:true}} as never;
 const rows=[{Id:'l1',Cart:'old',Qty:1}];
 assert.equal(applySavedRecordMutations(rows,'CartLine',{objectApiNames:['CartLine'],
  recordChanges:[{objectApiName:'CartLine',operation:'create',record:{Id:'l2',Cart:'new',Qty:1}}]},scope),null);
 const same=applySavedRecordMutations(rows,'CartLine',{objectApiNames:['CartLine'],
  recordChanges:[{objectApiName:'CartLine',operation:'create',record:{Id:'l2',Cart:'old',Qty:1}}]},scope);
 assert.deepEqual(same?.records.map(row=>row.Id),['l1','l2'],'same parent: drawn in place');
});

test('a display moves to the followed device\'s sale as soon as that device taps on it',async()=>{
 const {connectPageLive}=await import('../src/core/pages/PageCompiler/pageLiveWiring.ts');
 const events:unknown[]=[];
 const parser=new LiveFrameParser(event=>events.push(event));
 parser.append('event: preview\ndata: {"batch":"0000f00d","device":"till-device-key-0001","session":"sale-2","changes":[{"objectApiName":"CartLine","operation":"create","record":{"Id":"p"}}]}\n\n');
 const tap=(events[0] as {tap:{device:string;session:string}}).tap;
 assert.equal(tap.device,'till-device-key-0001');
 assert.equal(tap.session,'sale-2');
 const {target,saved}=fakeTarget();
 const followed:string[]=[];
 let listener:((event:never)=>void)|undefined;
 const stop=connectPageLive({...target,follow:(device:string,session:string)=>{followed.push(device+'>'+session);return true;}},
  next=>{listener=next as never;return ()=>undefined;});
 listener!(events[0] as never);
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(followed,['till-device-key-0001>sale-2'],'moved to the sale before drawing');
 assert.equal(saved.length,1,'then the tap is drawn there');
 stop();
});

test('database notices wait while another screen\'s taps wait, then draw once (nothing steps back)',async()=>{
 const {connectPageLive}=await import('../src/core/pages/PageCompiler/pageLiveWiring.ts');
 const {target,saved}=fakeTarget();
 let listener:((event:never)=>void)|undefined;
 const stop=connectPageLive(target,next=>{listener=next as never;return ()=>undefined;},0);
 const send=(event:unknown)=>listener!(event as never);
 send({kind:'preview',tap:{batch:'000000a1',ok:true,changes:[{objectApiName:'CartLine',operation:'update',record:{Id:'line-1',Qty:2}}]}});
 send({kind:'change',change:{object:'Cart',ids:['cart-1'],count:1,operation:'update',rows:[{Id:'cart-1',Total:1.25}]}});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(saved.filter(item=>(item as {objectApiNames:string[]}).objectApiNames[0]==='Cart').length,0,'held while the tap waits');
 send({kind:'change',change:{object:'Cart',ids:['cart-1'],count:1,operation:'update',rows:[{Id:'cart-1',Total:2.5}]}});
 send({kind:'settled',tap:{batch:'000000a1',ok:true,changes:[{objectApiName:'CartLine',operation:'update',record:{Id:'line-1',Qty:2}}]}});
 await new Promise(resolve=>setTimeout(resolve,0));
 const cart=saved.filter(item=>(item as {objectApiNames:string[]}).objectApiNames[0]==='Cart') as Array<{recordChanges:Array<{record:{Total:number}}>}>;
 assert.equal(cart.length,1,'drawn once, merged');
 assert.equal(cart[0].recordChanges[0].record.Total,2.5,'the newest value');
 stop();
});

test('a new cart is drawn before its first line (the list finds the new cart, then the line)',async()=>{
 const {parentsFirst}=await import('../src/core/pages/PageCompiler/pageLiveWiring.ts');
 assert.deepEqual(parentsFirst([['CartLine',[{Id:'l1',Cart:'c2'}]],['Cart',[{Id:'c2'}]]]),[1,0]);
 assert.deepEqual(parentsFirst([['Cart',[{Id:'c2'}]],['CartLine',[{Id:'l1',Cart:'c2'}]]]),[0,1]);
 assert.deepEqual(parentsFirst([['A',[{Id:'a',B:'b'}]],['B',[{Id:'b',A:'a'}]]]),[1,0],'a loop still draws each once');
 const {target,saved}=fakeTarget();
 const ledger=newTapLedger();
 await drawLiveTap(target,'settled',{batch:'0000c0de',ok:true,changes:[
  {objectApiName:'CartLine',operation:'create',record:{Id:'l1',Cart:'c2'}},
  {objectApiName:'Cart',operation:'create',record:{Id:'c2'}}]},ledger);
 assert.deepEqual(saved.map(item=>(item as {objectApiNames:string[]}).objectApiNames[0]),['Cart','CartLine']);
});
