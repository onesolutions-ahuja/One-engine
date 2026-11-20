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

test('a customer display cart is not narrowed to the display page\'s own (empty) session cart',async()=>{
 const {recordScope}=await import('../../server/src/page-compiler/compilePage.ts');
 const display='AND(@CartLine.DeviceKey = @ThisPage.Device.MirrorKey, @CartLine.Status = "Open")';
 assert.deepEqual(recordScope('Custom:smart_cart',{},[null,display]),{kind:'none'},'display: rows picked by device');
 assert.deepEqual(recordScope('Custom:smart_cart',{},[[{field:'DeviceKey',value:'@ThisPage.Device.MirrorKey'}],'']),{kind:'none'});
 assert.deepEqual(recordScope('Custom:smart_cart',{},[null,'@CartLine.Status = "Open"']),{kind:'auto'},'till: its own session cart');
 assert.deepEqual(recordScope('smart_cart',{}),{kind:'auto'});
 assert.deepEqual(recordScope('Custom:smart_cart',{autoRecordScope:true},[null,display]),{kind:'auto'},'explicit setting wins');
 assert.deepEqual(recordScope('Custom:smart_cart',{autoRecordScope:false}),{kind:'none'});
});

test('a customer display re-reads the Till\'s sale on its own, fresh, while visible',async()=>{
 const {startMirrorLiveRefresh,mirrorSources}=await import('../src/core/pages/PageCompiler/mirrorLiveRefresh.ts');
 const source=(id:string,filterFormula:string)=>({id,objectApiName:id.split('#')[0],components:[],scope:{kind:'none'},
  complete:false,filters:null,filterLogic:'AND',filterFormula,stateInputs:[]}) as never;
 const lines=source('CartLine#a','AND(@CartLine.DeviceKey = @ThisPage.Device.MirrorKey, @CartLine.Status = "Open")');
 const products=source('Product#b','@Product.Active = TRUE');
 assert.deepEqual(mirrorSources([lines,products]).map(s=>(s as {id:string}).id),['CartLine#a']);
 let tick:()=>void=()=>{};let visible=true;let cleared=false;let deviceListener:(()=>void)|undefined;
 const clock={setInterval:(run:()=>void)=>{tick=run;return 1;},clearInterval:()=>{cleared=true;},
  visible:()=>visible,listen:()=>()=>undefined};
 const calls:string[]=[];
 const stop=startMirrorLiveRefresh([lines,products],true,{
  reload:async(id,fresh)=>{calls.push('reload '+id+(fresh?' fresh':''));},
  loadSets:async()=>{calls.push('sets');},
  refreshTotals:async()=>{calls.push('totals');},
  subscribeDevice:listener=>{deviceListener=listener;return ()=>{deviceListener=undefined;};}},clock);
 tick();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls.sort(),['reload CartLine#a fresh','sets','totals'],'only the mirrored rows, read fresh');
 calls.length=0;visible=false;tick();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls,[],'a hidden display does not poll');
 visible=true;deviceListener?.();await new Promise(r=>setTimeout(r,0));
 assert.ok(calls.includes('reload CartLine#a fresh'),'reads at once when it learns which Till it follows');
 stop();assert.ok(cleared);assert.equal(deviceListener,undefined);
 // A page that mirrors nothing starts no timer.
 let started=false;
 startMirrorLiveRefresh([products],false,{reload:async()=>{}},{...clock,setInterval:()=>{started=true;return 1;}});
 assert.equal(started,false);
});

test('a customer display pairs with a Till by a 6-digit code: once, before it expires, hashed',async()=>{
 const {startDisplayPairing,claimDisplayPairing,unpairDisplay,deviceTill,DISPLAY_CODE_TTL_MS}=
  await import('../../server/src/system-support/till-assignment-service.ts');
 const tillKey='till-device-key-000000000001',tablet='tablet-display-key-00000001',ipad='ipad-display-key-000000001';
 const rows:Array<Record<string,unknown>>=[
  {Id:'1',Name:'Till 1',DeviceType:'POS Terminal',DeviceId:tillKey,Active:true},
  {Id:'2',Name:'Till 2',DeviceType:'POS Terminal',DeviceId:'till-device-key-000000000002',Active:true,CustomerDisplayKey:tablet}];
 const match=(row:Record<string,unknown>,filters:Array<{field:string;value:unknown}>)=>
  filters.every(f=>f.field==='Active'?row.Active===true:String(row[f.field]??'')===String(f.value));
 const deps={db:{transaction:(run:()=>Promise<unknown>)=>run()},records:{
  list:async(_t:string,_u:string,_o:string,limit:number,_off:number,options:{filters?:Array<{field:string;value:unknown}>}={})=>
   ({records:rows.filter(row=>match(row,options.filters??[])).slice(0,limit).map(row=>({...row}))}),
  get:async()=>({}),
  update:async(_t:string,_u:string,_o:string,id:string,values:Record<string,unknown>)=>{Object.assign(rows.find(row=>row.Id===id)!,values);}}} as never;
 const actor={tenant_id:'t',user_id:'u'};
 const now=Date.parse('2026-11-20T15:00:00Z');

 await assert.rejects(startDisplayPairing(deps,actor,tablet,now),/set this device up as a till/i,'only a Till hands out codes');
 const {code,till}=await startDisplayPairing(deps,actor,tillKey,now);
 assert.match(code,/^\d{6}$/);assert.equal(till,'Till 1');
 assert.notEqual(rows[0].DisplayPairCode,code,'only a hash is stored');
 await assert.rejects(claimDisplayPairing(deps,actor,tillKey,code,now),/other screen/,'the till cannot pair with itself');
 await assert.rejects(claimDisplayPairing(deps,actor,tablet,code==='000000'?'000001':'000000',now),/wrong or has expired/);
 await assert.rejects(claimDisplayPairing(deps,actor,tablet,code,now+DISPLAY_CODE_TTL_MS+1),/expired/);
 // The tablet was Till 2's display; pairing with Till 1 moves it.
 assert.deepEqual(await claimDisplayPairing(deps,actor,tablet,code,now),{till:'Till 1',mirrorKey:tillKey});
 assert.equal(rows[0].CustomerDisplayKey,tablet);
 assert.equal(rows[1].CustomerDisplayKey,null,'a display follows one Till');
 assert.equal(rows[0].DisplayPairCode,null);
 await assert.rejects(claimDisplayPairing(deps,actor,ipad,code,now),/wrong or has expired/,'a code works once');
 const state=await deviceTill(deps,actor,tablet);
 assert.equal(state.displayFor,'Till 1');assert.equal(state.mirrorKey,tillKey);
 await unpairDisplay(deps,actor,tillKey);
 assert.equal(rows[0].CustomerDisplayKey,null);
 assert.equal((await deviceTill(deps,actor,tablet)).displayFor,'');
 // Six digits: a person gets only a few guesses a minute.
 const guess={tenant_id:'t',user_id:'guesser'};
 for(let i=0;i<10;i++)await assert.rejects(claimDisplayPairing(deps,guess,ipad,'12345'+(i%10),now),/wrong or has expired/);
 await assert.rejects(claimDisplayPairing(deps,guess,ipad,'999999',now),/Too many tries/);
});

test('PAIRDISPLAY() is a till button action: it shows the code and saves nothing',async()=>{
 const {compileActionFormula}=await import('../../server/src/page-compiler/code/generateCode.ts');
 const {isActionPlan}=await import('../../server/src/expression-engine/ActionFormulas.ts');
 const {ACTION_FORMULA_FUNCTIONS}=await import('../../server/src/expression-engine/FormulaActions.ts');
 assert.ok(ACTION_FORMULA_FUNCTIONS.has('PAIRDISPLAY'));
 assert.ok(isActionPlan('=PAIRDISPLAY()'));
 const code=compileActionFormula('=PAIRDISPLAY()','Cart').js;
 assert.match(code,/\$\.ui\("PAIRDISPLAY"\)/);
 assert.doesNotMatch(code,/\$\.(?:create|update|remove)\(/);
 assert.throws(()=>compileActionFormula('=PAIRDISPLAY("x")','Cart'),/argument/);
});

test('the display link keeps the till it follows when the app tidies its address',async()=>{
 const {keepScreenParams}=await import('../src/core/workspace/Navigation/appRouting.ts');
 const session='5f0c9a7e-1d2b-4c3d-9e8f-123456789abc';
 assert.equal(keepScreenParams('/une/apps/SMARTTILL/pages/smart_till_customer_display',
  '?mirror=till-device-key-000000000001&screenSession='+session+'&junk=1'),
  '/une/apps/SMARTTILL/pages/smart_till_customer_display?mirror=till-device-key-000000000001&screenSession='+session);
 assert.equal(keepScreenParams('/une/apps/X/home',''),'/une/apps/X/home');
 assert.equal(keepScreenParams('/une/apps/X/home','?mirror=<script>'),'/une/apps/X/home','bad values are dropped');
});

test('a till cart filtered by its OWN device key keeps its session cart',async()=>{
 const {recordScope}=await import('../../server/src/page-compiler/compilePage.ts');
 assert.deepEqual(recordScope('Custom:smart_cart',{},[null,'@CartLine.DeviceKey = @ThisPage.Device.Key']),{kind:'auto'});
});
