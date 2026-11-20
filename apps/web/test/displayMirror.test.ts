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

test('PAIRDISPLAY(Page) is a button action: it opens the pairing box and saves nothing',async()=>{
 const {compileActionFormula}=await import('../../server/src/page-compiler/code/generateCode.ts');
 const {isActionPlan}=await import('../../server/src/expression-engine/ActionFormulas.ts');
 const {ACTION_FORMULA_FUNCTIONS}=await import('../../server/src/expression-engine/FormulaActions.ts');
 assert.ok(ACTION_FORMULA_FUNCTIONS.has('PAIRDISPLAY'));
 assert.ok(isActionPlan('=PAIRDISPLAY(smart_till_customer_display)'));
 const code=compileActionFormula('=PAIRDISPLAY(smart_till_customer_display)','Cart').js;
 assert.match(code,/\$\.ui\("PAIRDISPLAY", "smart_till_customer_display"\)/);
 assert.doesNotMatch(code,/\$\.(?:create|update|remove)\(/);
 assert.throws(()=>compileActionFormula('=PAIRDISPLAY()','Cart'),/argument|page/i,'the page the screen shows is required');
});

test('a paired screen remembers its page and till, and only its own page goes back to /display',async()=>{
 const store=new Map<string,string>();
 (globalThis as {window?:unknown}).window={localStorage:{getItem:(k:string)=>store.get(k)??null,
  setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}},location:{pathname:'/'}};
 const screen=await import('../src/core/authentication/PairedScreen/pairedScreen.ts');
 const {openerMirrorKey}=await import('../src/core/authentication/TillDevice/deviceTill.ts');
 assert.equal(screen.onPairedScreenPage('/une/apps/SMARTTILL/pages/smart_till_customer_display'),false);
 const path=screen.rememberScreen({access_token:'a',appId:'SMARTTILL',pageApiName:'smart_till_customer_display',
  deviceName:'Till 1',mirrorKey:'till-device-key-000000000001',key:'k'.repeat(43)});
 assert.equal(path,'/une/apps/SMARTTILL/pages/smart_till_customer_display');
 assert.equal(screen.onPairedScreenPage(path),true);
 assert.equal(screen.onPairedScreenPage('/une/apps/SMARTTILL/pages/smart_till_billing'),false,'the till page in the same browser is not the screen');
 (globalThis as {window:{location:{search:string}}}).window.location.search='';
 (globalThis as {window:{sessionStorage?:unknown}}).window.sessionStorage={getItem:()=>null,setItem:()=>undefined};
 assert.equal(openerMirrorKey(),'till-device-key-000000000001','the screen follows the device it was paired with');
 assert.throws(()=>screen.rememberScreen({access_token:'a',appId:'X',pageApiName:'bad page',deviceName:'',mirrorKey:''}),/page/);
 screen.forgetScreen();
 assert.equal(screen.onPairedScreenPage(path),false);assert.equal(openerMirrorKey(),'');
 delete (globalThis as {window?:unknown}).window;
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
