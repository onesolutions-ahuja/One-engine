import {modernizeFormula} from '../../server/src/expression-engine/PageReferences.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileDisplayFormula,compileActionFormula} from '../../server/src/page-compiler/code/generateCode';
import {F,O} from '../../server/src/page-compiler/code/formulaLibrary';
import {FORMULA_DICTIONARY} from '../../server/src/page-compiler/code/formulaDictionary';
import {buildPageCode,pageCodeModule,serverPageCode} from '../../server/src/page-compiler/code/pageCode';
import {executePageCodeAction} from '../../server/src/system-support/page-code-runtime';
import {evaluateFieldExpressionDetailed} from '../src/component-libraries/shared/FieldExpression.js';
import {createPageCodeRuntime,type PageCode} from '../src/core/pages/PageCompiler/pageCodeRuntime';

type Row=Record<string,unknown>;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const fn=(js:string)=>new Function('F','O','return '+js)(F,O);
const display=(state:Row={},session='s-1')=>({sessionId:session,state:(k:string)=>state[k]??'',now:()=>new Date('2026-11-15T21:07:30Z'),
 timeZone:()=>'UTC',f:(row:Row,field:string)=>row?.[field]??'',session:()=>'',tenant:()=>'',event:()=>'',
 agg:()=>{throw Error('no rows');}});

const tillAddFormula=`=ACTIONS(IF(COUNTIFS(Cart, SessionKey, @ThisPage.Session.Id, Status, "Open") = 0, CREATERECORD(Cart, SessionKey, @ThisPage.Session.Id, Status, "Open", Name, "Till sale"), ""), GETRECORD(Cart, Status, "Open", SessionKey, @ThisPage.Session.Id, AS(sc)), GETRECORD(CartLine, Cart, sc.Id, session_key__c, @ThisPage.Session.Id, Product, @recordId, Status, "Open", AS(line)), IF(ISBLANK(line.Id), CREATERECORD(CartLine, Cart, sc.Id, Product, @recordId, Name, @record.Name, Quantity, 1, UnitPrice, @record.Price, OriginalUnitPrice, @record.Price, LineTotal, @record.Price, DiscountAmount, 0, session_key__c, @ThisPage.Session.Id, Status, "Open"), UPDATERECORD(CartLine, line.Id, Quantity, line.Quantity + 1, LineTotal, (line.Quantity + 1) * line.UnitPrice)), GETRECORD(Cart, Id, sc.Id, AS(c)), IF(ISBLANK(c.Id), "", UPDATERECORD(Cart, c.Id, Subtotal, SUMIFS(CartLine, LineTotal, Cart, c.Id, Status, "Open"), Total, SUMIFS(CartLine, LineTotal, Cart, c.Id, Status, "Open"))))`;

test('every dictionary entry has a code rule', ()=>{
 for(const [name,entry] of Object.entries(FORMULA_DICTIONARY)){
  if(entry.kind==='pure')assert.equal(typeof (F as Record<string,unknown>)[name],'function',name+' has no plain function');
  if(entry.kind==='inline'||entry.kind==='page')assert.equal(typeof entry.js,'function',name);
 }
});

test('display formulas become plain functions that match the formula language', ()=>{
 const row={Price:2.5,Name:'Cola',AgeRestricted:true,TrackStock:true,StockLevel:0,MenuCategory:'drinks'};
 const formulas=[
  '="£" & LEFT(TEXT(@Product.Price) & IF(FIND(".", TEXT(@Product.Price) & ".") > LEN(TEXT(@Product.Price)), ".00", "00"), FIND(".", TEXT(@Product.Price) & ".") + 2)',
  '=IF(@Product.AgeRestricted, "18+", IF(AND(@Product.TrackStock, @Product.StockLevel <= 0), "Out", ""))',
  '=UPPER(LEFT(@Product.Name, 2)) & ROUND(@Product.Price * 1.2, 2)',
  '=BLANKVALUE(@Product.Missing, "none") & "/" & IFERROR(VALUE("x"), "bad")',
  '=IF(@Product.Name = "C*", "starts with C", "other")',
  '=MAX(1, @Product.Price, 2) + MIN(3, 4)',
  '=NOT(ISBLANK(@Product.Name)) && TRUE'
 ];
 for(const source of formulas.slice(0,6)){
  const compiled=fn(compileDisplayFormula(source,'Product').js)(row,display());
  const interpreted=evaluateFieldExpressionDetailed(source,row,{rootObjectApiName:'Product'});
  assert.equal(interpreted.error,undefined,source);
  assert.equal(String(compiled),String(interpreted.value),source);
 }
 assert.equal(fn(compileDisplayFormula('=RIGHT("0" & TEXT(HOUR(NOW())), 2)').js)({},display()),'21');
 assert.equal(fn(compileDisplayFormula('=LPAD(7, 3, "0") & RPAD("a", 3, "-")').js)({},display()),'007a--');
 assert.equal(fn(compileDisplayFormula('=@ThisPage.Input.category & ":" & @ThisPage.Session.Id').js)({},display({category:'beer'})),'beer:s-1');
});

test('event and related references convert', ()=>{
 const action=compileActionFormula('=ACTIONS(STATE(pick, @event.value), STATE(name, @event.record.Name), SCREEN(edit, popup, @event.recordId))','Product');
 assert.match(action.js,/\$\.event\("value"\)/);
 assert.match(action.js,/\$\.f\(\$\.event\("record"\), "Name"\)/);
 const image=compileDisplayFormula('=@Product.ImageUrl','CartLine');
 assert.equal(fn(image.js)({__mentionValues:{'@Product.ImageUrl':'a.png'}},{...display(),m:(row:Row,p:string)=>(row.__mentionValues as Row)['@'+p]}),'a.png');
});

test('unknown functions are save errors, not run-time interpretation', ()=>{
 assert.throws(()=>compileDisplayFormula('=NOPE(1)'),/not in the formula dictionary/);
 assert.throws(()=>compileDisplayFormula('=CREATERECORD(Cart, Name, "x")'),/is an action/);
});

test('an action becomes one async function and names the rows the page should hold', ()=>{
 const action=compileActionFormula(tillAddFormula,'Product');
 assert.equal(action.data,true);
 assert.deepEqual(action.writes.sort(),['Cart','CartLine']);
 assert.match(action.js,/^async \(\$\) => \{/);
 assert.ok(action.sets.some(set=>set.object==='Cart'&&set.criteria.map(c=>c.field).join()==='SessionKey,Status'));
 assert.ok(action.sets.some(set=>set.object==='CartLine'&&set.parent?.field==='Cart'));
 const ui=compileActionFormula('=ACTIONS(STATE(category, "*"), SCREEN(smart_till_payment, popup, @recordId))','Product');
 assert.equal(ui.data,false);
 assert.deepEqual(ui.ui,['SCREEN']);
});

const compiledPage={apiName:'till',components:[{id:'grid',objectApiName:'Product',formulas:[
 {property:'cardValue',source:'=TEXT(@Product.Price)'}],
 actions:[{event:'click',kind:'Formula',formula:tillAddFormula}]},
 {id:'cart',objectApiName:'CartLine',formulas:[{property:'totalValue',source:'=SUMIFS(Cart, Total, SessionKey, @ThisPage.Session.Id, Status, "Open")'}],actions:[]}]};

test('the page module and the server copy are built from the same code', ()=>{
 const code=buildPageCode(compiledPage as never);
 assert.equal(code.issues.length,0,JSON.stringify(code.issues));
 const module=pageCodeModule(code);
 assert.match(module,/export function createCode\(F, O\)/);
 const server=serverPageCode(code);
 assert.equal(typeof server.actions['grid:click'].run,'function');
 assert.ok(server.recordSets.length>=2);
});

function fakeRecords(tables:Record<string,Row[]>){
 let next=0;
 const calls:string[]=[];
 const match=(row:Row,filters:Array<{field:string;operator:string;value:unknown}>)=>filters.every(f=>
  f.operator==='isBlank'?row[f.field]===undefined||row[f.field]===''||row[f.field]===null
  :f.operator==='in'?(f.value as string[]).includes(String(row[f.field])):String(row[f.field]??'')===String(f.value));
 return {calls,tables,records:{
  async list(_t:string,_u:string,object:string,limit:number,_o:number,options:{filters?:never[]}={}){
   calls.push('list '+object);
   const rows=(tables[object]??[]).filter(row=>match(row,options.filters??[]));
   return {records:rows.slice(0,limit),total:rows.length};
  },
  async get(_t:string,_u:string,object:string,id:string){return {...(tables[object]??[]).find(row=>row.Id===id)};},
  async create(_t:string,_u:string,object:string,values:Row){
   calls.push('create '+object);
   const id='00000000-0000-4000-8000-'+String(++next).padStart(12,'0');
   (tables[object]??=[]).push({Id:id,...values});
   return id;
  },
  async update(_t:string,_u:string,object:string,id:string,values:Row){
   calls.push('update '+object);
   Object.assign(tables[object].find(row=>row.Id===id)!,values);
  },
  async remove(_t:string,_u:string,object:string,id:string){
   calls.push('delete '+object);
   tables[object]=tables[object].filter(row=>row.Id!==id);
  }
 }};
}
const productId='11111111-1111-4111-8111-111111111111';

test('server function: every step in ONE transaction, the clicked row is read from SQL', async ()=>{
 const fake=fakeRecords({Product:[{Id:productId,Name:'Cola',Price:1.5}],Cart:[],CartLine:[]});
 let transactions=0;
 const db={transaction:async<T>(run:()=>Promise<T>)=>{transactions++;return run();},query:async()=>({rows:[]})};
 const server=serverPageCode(buildPageCode(compiledPage as never));
 const request={sessionId:'s-1',state:{},rowObject:'Product',event:{recordId:productId,value:'',
  // A changed price from the browser is ignored: @record comes from SQL.
 }};
 const first=await executePageCodeAction({db,records:fake.records} as never,{tenant_id:'t',user_id:'u'},server,'grid:click',request,'');
 assert.equal(first.ok,true,first.error);
 const second=await executePageCodeAction({db,records:fake.records} as never,{tenant_id:'t',user_id:'u'},server,'grid:click',request,'');
 assert.equal(second.ok,true,second.error);
 assert.equal(transactions,2);
 assert.equal(fake.tables.Cart.length,1);
 assert.equal(fake.tables.CartLine.length,1);
 assert.equal(fake.tables.CartLine[0].Quantity,2);
 assert.equal(fake.tables.Cart[0].Total,3);
 assert.ok(Object.keys(second.sets).length>=1,'fresh rows of the written Objects come back');
});

test('server function: a failing step saves nothing', async ()=>{
 const fake=fakeRecords({Product:[{Id:productId,Name:'Cola',Price:1.5}],Cart:[],CartLine:[]});
 fake.records.update=async()=>{throw Error('Field is read only');};
 const db={transaction:async<T>(run:()=>Promise<T>)=>run(),query:async()=>({rows:[]})};
 const server=serverPageCode(buildPageCode(compiledPage as never));
 const request={sessionId:'s-1',state:{},rowObject:'Product',event:{recordId:productId}};
 const result=await executePageCodeAction({db,records:fake.records} as never,{tenant_id:'t',user_id:'u'},server,'grid:click',request,'');
 assert.equal(result.ok,false);
 assert.match(result.error??'',/read only/);
});

test('browser: a tap shows at once from held rows, then the server confirms', async ()=>{
 const module=pageCodeModule(buildPageCode(compiledPage as never));
 const createCode=new Function('F','O',module.replace(/export /g,'')+'\nreturn createCode(F, O);') as (f:typeof F,o:typeof O)=>PageCode;
 const code=createCode(F,O);
 const cartId='22222222-2222-4222-8222-222222222222';
 const sets:Record<string,{rows:Row[];complete:boolean}>={};
 for(const set of code.recordSets)sets[set.key]=set.object==='Cart'
  ?{rows:[{Id:cartId,SessionKey:'s-1',Status:'Open',Total:0}],complete:true}:{rows:[],complete:true};
 const posts:string[]=[];
 let resolveSave:(value:unknown)=>void=()=>{};
 const rt=createPageCodeRuntime(code,{endpoint:'/apps/X',build:{buildId:'b'},sessionId:()=>'s-1',state:()=>({}),
  request:(async(path:string)=>{
   posts.push(path);
   if(path.endsWith('/sets'))return {ok:true,sets};
   return new Promise(resolve=>{resolveSave=resolve;});
  }) as never});
 await rt.loadSets();
 const total=rt.formulasFor('cart').get('=SUMIFS(Cart, Total, SessionKey, @ThisPage.Session.Id, Status, "Open")')!;
 assert.equal(total({}),0);
 const shown:Array<{changes:unknown[];optimistic?:string;replaces?:string}>=[];
 const running=rt.run('grid:click',{recordId:productId,record:{Id:productId,Name:'Cola',Price:1.5}},'Product',
  {show:update=>{shown.push(update);},effects:async()=>{}});
 await new Promise(resolve=>setTimeout(resolve,0));
 // Shown before the server answered:
 assert.equal(shown.length,1);
 assert.ok(shown[0].optimistic);
 assert.equal(total({}),1.5);
 resolveSave({ok:true,changes:[{objectApiName:'CartLine',operation:'create',record:{Id:'x'}}],state:{},effects:[],
  sets:{[code.recordSets.find(set=>set.object==='Cart')!.key]:{rows:[{Id:cartId,SessionKey:'s-1',Status:'Open',Total:1.5}],complete:true}}});
 await running;
 assert.equal(shown.length,2);
 assert.equal(shown[1].replaces,shown[0].optimistic);
 assert.deepEqual(posts.filter(path=>path.endsWith('/execute')).length,1);
});

test('messages and payments run on the server; device steps stay with the action engine', ()=>{
 const email=compileActionFormula('=EMAIL(Mailer, "a@b.co", "Receipt", "Thanks")','Cart');
 assert.equal(email.data,true);
 assert.match(email.js,/\$\.service\("EMAIL", \["Mailer", "a@b\.co", "Receipt", "Thanks"\]\)/);
 const pay=compileActionFormula('=RECORDPAYMENT(@recordId, 10, "Cash", AS(p))','Invoice');
 assert.deepEqual(pay.writes.sort(),['CashLedger','Invoice']);
 const wait=compileActionFormula('=ACTIONS(STATE(a, 1), WAIT(1, 0), STATE(b, 2))','Cart');
 assert.equal(wait.data,true);
 assert.match(wait.js,/\$\.service\("WAIT", \[1, 0, 0, "=ACTIONS/);
 assert.match(wait.js,/return;/);
 const pdf=compileActionFormula('=ACTIONS(CREATEPDF(Receipt, @ThisPage.Input.recordId, AS(pdf)), LOCATION(AS(here)))','Cart');
 assert.equal(pdf.data,true);
 assert.match(pdf.js,/\$\.service\("CREATEPDF", \["Receipt", /);
 assert.match(pdf.js,/v\["here"\] = await \$\.service\("LOCATION", \[\]\)/);
});

test('assignment actions convert: state, filter and navigation', ()=>{
 const state=compileActionFormula('@ThisPage.Calendar1.calendarDate := TODAY()','');
 assert.equal(state.data,false);
 assert.match(state.js,/\$\.setState\("calendarDate", /);
 const nav=compileActionFormula('@navigate.list := "Customer"','');
 assert.deepEqual(nav.ui,['NAVIGATE']);
 assert.match(nav.js,/\$\.ui\("NAVIGATE", "list", "Customer"\)/);
 assert.match(compileActionFormula('@ThisPage.NotesBox.notes := @event.value','').js,/setState\("notes", /);
});

/* ---------- @ThisPage / @ThisTenant (the one reference style) ---------- */
test('page and tenant values convert to page code calls', ()=>{
 const code=(source:string)=>compileDisplayFormula(source).js;
 assert.match(code('=@ThisPage.Session.Id'),/\$\.sessionId/);
 assert.match(code('=@ThisPage.Input.recordId'),/\$\.state\("recordId"\)/);
 assert.match(code('=@ThisPage.Cart1.recordId'),/\$\.component\("Cart1", "recordId"\)/);
 assert.match(code('=@ThisPage.MyBox1.value'),/\$\.component\("MyBox1", "value"\)/);
 assert.match(code('=@ThisPage.PayButton.CartTotal'),/\$\.pageValue\("PayButton", "CartTotal"\)/);
 assert.match(code('=@ThisPage.Tabs1.Selected.Id'),/\$\.componentState\("Tabs1", "Id"\)/);
 assert.match(code('=@ThisTenant.User.Name'),/\$\.session\("user\.name"\)/);
 assert.match(code('=@ThisTenant.User.CartId'),/\$\.session\("cartId"\)/);
 assert.match(code('=@ThisTenant.Company.Id'),/\$\.session\("tenant\.id"\)/);
 assert.match(code('=@ThisTenant.Company.Name & @ThisTenant.Company.Logo'),/\$\.tenant\("name"\)[\s\S]*\$\.tenant\("logo"\)/);
 assert.throws(()=>code('=@ThisPage.Session.Name'),/use @ThisPage\.Session\.Id/);
 assert.throws(()=>code('=@ThisTenant.Company.Secret'),/Unknown tenant value/);
});

test('old $ spellings are refused; the one-time rewrite gives the same code', ()=>{
 for(const old of ['=$state.category & $session','@state.calendarDate := TODAY()','=$flow.Pay']){
  assert.throws(()=>old.includes(':=')?compileActionFormula(old,''):compileDisplayFormula(old),/Old \$ references|Invalid/);
 }
 const pairs:Array<[string,string,string]>=[
  ['=$state.category & ":" & $session','=@ThisPage.Input.category & ":" & @ThisPage.Session.Id',''],
  ['=@CategoryTabs.state.Id','=@ThisPage.CategoryTabs.Selected.Id',''],
  ['=$component.Cart2.recordId & $session.user.name & $tenant.logo','=@ThisPage.Cart2.recordId & @ThisTenant.User.Name & @ThisTenant.Company.Logo','']
 ];
 for(const [old,next] of pairs){
  assert.equal(modernizeFormula(old),next);
  assert.equal(compileDisplayFormula(modernizeFormula(old)).js,compileDisplayFormula(next).js);
 }
 const owner=(key:string)=>key==='calendarDate'?'Calendar1':undefined;
 assert.equal(modernizeFormula('@state.calendarDate := TODAY()',owner),'@ThisPage.Calendar1.calendarDate := TODAY()');
 assert.equal(modernizeFormula('=SCREEN(Pay, popup, $state.recordId)'),'=SCREEN(Pay, popup, @ThisPage.Input.recordId)');
 // Quoted text is never touched.
 assert.equal(modernizeFormula('="$state.x" & $state.x'),'="$state.x" & @ThisPage.Input.x');
});

test('new-style actions: state, filter, navigation, WAIT, LOCATION, CREATEPDF, messages and payments', ()=>{
 const state=compileActionFormula('@ThisPage.Calendar1.calendarDate := @ThisPage.Session.Id','');
 assert.match(state.js,/\$\.setState\("calendarDate", \$\.sessionId\)/);
 const filter=compileActionFormula('@filter.category := @ThisPage.Tabs1.Selected.Id','');
 assert.match(filter.js,/\$\.ui\("FILTER", "category", \$\.componentState\("Tabs1", "Id"\)\)/);
 const nav=compileActionFormula('@navigate.list := @ThisPage.Input.listName','');
 assert.match(nav.js,/\$\.ui\("NAVIGATE", "list", \$\.state\("listName"\)\)/);
 assert.throws(()=>compileActionFormula('@ThisPage.Session.Id := "x"',''),/session cannot be changed/);
 const wait=compileActionFormula('=ACTIONS(WAIT(1, 0), STATE(b, @ThisPage.Input.recordId))','Cart');
 assert.match(wait.js,/\$\.service\("WAIT", \[1, 0, 0, /);
 assert.match(wait.js,/setState\("b", \$\.state\("recordId"\)\)/);
 const pdf=compileActionFormula('=ACTIONS(CREATEPDF(Receipt, @ThisPage.Input.recordId, AS(pdf)), LOCATION(AS(here)))','Cart');
 assert.match(pdf.js,/\$\.service\("CREATEPDF", \["Receipt", \$\.state\("recordId"\)\]\)/);
 assert.match(pdf.js,/v\["here"\] = await \$\.service\("LOCATION", \[\]\)/);
 const email=compileActionFormula('=EMAIL(Mailer, @ThisTenant.User.Email, "Receipt", @ThisTenant.Company.Name)','Cart');
 assert.match(email.js,/\$\.service\("EMAIL", \["Mailer", \$\.session\("user\.email"\), "Receipt", \$\.tenant\("name"\)\]\)/);
 const sms=compileActionFormula('=SMS(Texter, @ThisPage.MessageBox.value)','Cart');
 assert.match(sms.js,/\$\.service\("SMS", \["Texter", \$\.component\("MessageBox", "value"\)\]\)/);
 const whatsapp=compileActionFormula('=WHATSAPP(Chat, @ThisPage.Input.phone, "Hi")','Cart');
 assert.match(whatsapp.js,/\$\.service\("WHATSAPP", \["Chat", \$\.state\("phone"\), "Hi"\]\)/);
 const pay=compileActionFormula('=RECORDPAYMENT(@ThisPage.Input.recordId, @ThisPage.PayButton.CartTotal, "Cash", AS(p))','Invoice');
 assert.match(pay.js,/\$\.service\("RECORDPAYMENT", \[\$\.state\("recordId"\), \$\.pageValue\("PayButton", "CartTotal"\), "Cash"\]\)/);
 assert.deepEqual(pay.writes.sort(),['CashLedger','Invoice']);
 // A cart held by session ID is still page-known: the page keeps its rows.
 const add=compileActionFormula('=GETRECORD(Cart, SessionKey, @ThisPage.Session.Id, Status, "Open", AS(c))','');
 assert.equal(add.sets.length,1);
});

test('one-time saved-formula rewrite names the owning component and is idempotent', async ()=>{
 const {modernizePageRows}=await import('../../server/src/system-support/modernize-formula-references');
 const {encodeMetadataValue}=await import('../../server/src/system-files/component-runtime');
 const encode=(component:string,type:string,props:Record<string,unknown>)=>{
  const out:Array<{path:string;kind:string;text:string|null}>=[];
  encodeMetadataValue(props,'/props',out);
  return out.map(item=>({group_key:'t|p|Desktop|1',component_key:component,component_type:type,
   property_path:item.path,value_kind:item.kind,value_text:item.text}));
 };
 const rows=[
  ...encode('b1','smart_button',{navigatorName:'PayButton',actionFlows:{click:{actionType:'Formula',
   formula:'@state.CartTotal := SUMIFS(Cart, Total, SessionKey, $session)'}}}),
  ...encode('t1','smart_text',{navigatorName:'Total1',
   textSource:'=$state.CartTotal & " " & $state.recordId & " " & @Tabs1.state.Name',label:'Price in "$state.x" stays'})
 ];
 const changes=modernizePageRows(rows as never);
 assert.deepEqual(changes.map(change=>[change.path,change.after]),[
  ['/props/actionFlows/click/formula','@ThisPage.PayButton.CartTotal := SUMIFS(Cart, Total, SessionKey, @ThisPage.Session.Id)'],
  ['/props/textSource','=@ThisPage.PayButton.CartTotal & " " & @ThisPage.Input.recordId & " " & @ThisPage.Tabs1.Selected.Name']
 ]);
 const again=rows.map(item=>({...item,value_text:changes.find(change=>change.component===item.component_key&&change.path===item.property_path)?.after??item.value_text}));
 assert.deepEqual(modernizePageRows(again as never),[]);
 for(const change of changes)
  assert.doesNotThrow(()=>change.path.includes('actionFlows')?compileActionFormula(change.after,''):compileDisplayFormula(change.after));
});
