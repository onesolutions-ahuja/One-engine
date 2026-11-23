import {modernizeFormula} from '../../server/src/expression-engine/PageReferences.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileDisplayFormula,compileActionFormula} from '../../server/src/page-compiler/code/generateCode';
import {F,O} from '../../server/src/page-compiler/code/formulaLibrary';
import {FORMULA_DICTIONARY} from '../../server/src/page-compiler/code/formulaDictionary';
import {buildPageCode,pageCodeModule,serverPageCode} from '../../server/src/page-compiler/code/pageCode';
import {executePageCodeAction} from '../../server/src/system-support/page-code-runtime';
import {createPageCodeRuntime,type PageCode} from '../src/core/pages/PageCompiler/pageCodeRuntime';
import {resolveCollectionMentionRows,resolveComponentMentionRows} from '../src/component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';
import type {ObjectMetadata} from '../src/core/metadata/Definitions/metadata';

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
 const expected=['£2.50','18+','CO3','none/bad','starts with C','5.5'];
 formulas.slice(0,6).forEach((source,index)=>
  assert.equal(String(fn(compileDisplayFormula(source,'Product').js)(row,display())),expected[index],source));
 assert.equal(fn(compileDisplayFormula('=RIGHT("0" & TEXT(HOUR(NOW())), 2)').js)({},display()),'21');
 assert.equal(fn(compileDisplayFormula('=LPAD(7, 3, "0") & RPAD("a", 3, "-")').js)({},display()),'007a--');
 assert.equal(fn(compileDisplayFormula('=@ThisPage.Input.category & ":" & @ThisPage.Session.Id').js)({},display({category:'beer'})),'beer:s-1');
});

test('event and related references convert', ()=>{
 const action=compileActionFormula('=ACTIONS(@ThisPage.Pick.Value = @event.value, @ThisPage.PickName.Value = @event.record.Name, SCREEN(edit, popup, @event.recordId))','Product');
 assert.match(action.js,/\$\.event\("value"\)/);
 assert.match(action.js,/\$\.f\(\$\.event\("record"\), "Name"\)/);
 const image=compileDisplayFormula('=@Product.ImageUrl','CartLine');
 assert.match(image.js,/\.m\(row, "CartLine\.Product\.ImageUrl"\)/);
 assert.equal(fn(image.js)({__mentionValues:{'@CartLine.Product.ImageUrl':'a.png'}},{...display(),m:(row:Row,p:string)=>(row.__mentionValues as Row)['@'+p]}),'a.png');
 const pickerImage=compileDisplayFormula('=@CartLine.Product.ImageUrl','CartLine');
 assert.match(pickerImage.js,/\.m\(row, "CartLine\.Product\.ImageUrl"\)/);
});

test('row-relative lookup image references load and resolve through the canonical metadata path',async()=>{
 const objects:ObjectMetadata[]=[
  {apiName:'CartLine',label:'Cart Line',pluralLabel:'Cart Lines',kind:'Custom Object',description:'',fields:[
   {apiName:'Id',label:'Id',dataType:'Id',required:true,unique:true},
   {apiName:'Product',label:'Product',dataType:'reference',required:false,unique:false,
    relationship:{type:'Lookup',targetObject:'Product',relationshipName:'Product',childRelationshipName:'CartLines'}}
  ]},
  {apiName:'Product',label:'Product',pluralLabel:'Products',kind:'Custom Object',description:'',fields:[
   {apiName:'Id',label:'Id',dataType:'Id',required:true,unique:true},
   {apiName:'ImageUrl',label:'Image URL',dataType:'text',required:false,unique:false}
  ]}
 ];
 const rows=await resolveCollectionMentionRows(objects,'CartLine',
  [{Id:'line-1',Product:'product-1'}],{imageSource:'@Product.ImageUrl'},
  async(_object,id)=>({Id:id,ImageUrl:'asset:00000000-0000-4000-8000-000000000001'}));
 assert.equal(rows[0].__mentionValues&&
  (rows[0].__mentionValues as Row)['@CartLine.Product.ImageUrl'],
  'asset:00000000-0000-4000-8000-000000000001');
 const image=compileDisplayFormula('=@Product.ImageUrl','CartLine');
 assert.equal(fn(image.js)(rows[0],{...display(),m:(row:Row,path:string)=>(row.__mentionValues as Row)['@'+path]}),
  'asset:00000000-0000-4000-8000-000000000001');
});

test('two fields of the same related record both resolve (image + age flag on a cart line)',async()=>{
 const objects:ObjectMetadata[]=[
  {apiName:'CartLine',label:'Cart Line',pluralLabel:'Cart Lines',kind:'Custom Object',description:'',fields:[
   {apiName:'Id',label:'Id',dataType:'Id',required:true,unique:true},
   {apiName:'Name',label:'Name',dataType:'text',required:false,unique:false},
   {apiName:'Quantity',label:'Quantity',dataType:'number',required:false,unique:false},
   {apiName:'Product',label:'Product',dataType:'reference',required:false,unique:false,
    relationship:{type:'Lookup',targetObject:'Product',relationshipName:'Product',childRelationshipName:'CartLines'}}
  ]},
  {apiName:'Product',label:'Product',pluralLabel:'Products',kind:'Custom Object',description:'',fields:[
   {apiName:'Id',label:'Id',dataType:'Id',required:true,unique:true},
   {apiName:'ImageUrl',label:'Image URL',dataType:'text',required:false,unique:false},
   {apiName:'AgeRestricted',label:'Age restricted',dataType:'text',required:false,unique:false}
  ]}
 ];
 const rows=await resolveCollectionMentionRows(objects,'CartLine',[{Id:'l1',Name:'Cola',Quantity:2,Product:'p1'}],
  {imageSource:'@Product.ImageUrl',rowSupportingSource:'=IF(@CartLine.Product.AgeRestricted, "18+", "")',
   textSource:'@CartLine.Name',column3Source:'@CartLine.Quantity'},
  async(_object,id)=>({Id:id,ImageUrl:'asset:00000000-0000-4000-8000-000000000002',AgeRestricted:'yes'}));
 const values=rows[0].__mentionValues as Row;
 assert.equal(values['@CartLine.Product.ImageUrl'],'asset:00000000-0000-4000-8000-000000000002');
 assert.equal(values['@CartLine.Product.AgeRestricted'],'yes');
 assert.equal(values['@CartLine.Name'],'Cola');
 assert.equal(values['@CartLine.Quantity'],2);
});

test('named Collection CartLine rows hydrate related image values before rendering',async()=>{
 const objects:ObjectMetadata[]=[
  {apiName:'CartLine',label:'Cart Line',pluralLabel:'Cart Lines',kind:'Custom Object',description:'',fields:[
   {apiName:'Id',label:'Id',dataType:'Id',required:true,unique:true},
   {apiName:'Product',label:'Product',dataType:'reference',required:false,unique:false,
    relationship:{type:'Lookup',targetObject:'Product',relationshipName:'Product',childRelationshipName:'CartLines'}}
  ]},
  {apiName:'Product',label:'Product',pluralLabel:'Products',kind:'Custom Object',description:'',fields:[
   {apiName:'Id',label:'Id',dataType:'Id',required:true,unique:true},
   {apiName:'ImageUrl',label:'Image URL',dataType:'text',required:false,unique:false}
  ]}
 ];
 const fetchedRows=[{Id:'queried-line',Product:'missing-product'}];
 const collectionRows=[{Id:'cart-line',Product:'product-1'}];
 const renderedRows=await resolveComponentMentionRows(objects,'CartLine',fetchedRows,collectionRows,
  {imageSource:'@Product.ImageUrl'},
  async(_object,id)=>({Id:id,ImageUrl:'https://cdn.example.test/product.png'}));
 assert.deepEqual(renderedRows.map(row=>row.Id),['cart-line']);
 assert.equal((renderedRows[0].__mentionValues as Row)['@CartLine.Product.ImageUrl'],
  'https://cdn.example.test/product.png');
});

test('trusted registered components receive the host tenant asset loader',()=>{
 const source=readFileSync(new URL('../src/core/components/RegisteredComponent/RegisteredComponent.tsx',import.meta.url),'utf8');
 assert.match(source,/loadAsset:props\.loadAsset/);
});

test('unknown functions are save errors, not run-time interpretation', ()=>{
 assert.throws(()=>compileActionFormula('=STATE(err, "x")',''),/STATE is no longer used/);
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
 const ui=compileActionFormula('=ACTIONS(@ThisPage.Category.Value = "*", SCREEN(smart_till_payment, popup, @recordId))','Product');
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

test('messages run on the server; device steps stay with the action engine', ()=>{
 const email=compileActionFormula('=EMAIL(Mailer, "a@b.co", "Receipt", "Thanks")','Cart');
 assert.equal(email.data,true);
 assert.match(email.js,/\$\.service\("EMAIL", \["Mailer", "a@b\.co", "Receipt", "Thanks"\]\)/);
 // RECORDPAYMENT was removed: pages post payments with CREATERECORD(CashLedger) + UPDATERECORD(Invoice).
 assert.throws(()=>compileActionFormula('=RECORDPAYMENT(@recordId, 10, "Cash")','Invoice'));
 const wait=compileActionFormula('=ACTIONS(@ThisPage.A.Value = 1, WAIT(1, 0), @ThisPage.B.Value = 2)','Cart');
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
 assert.match(code('=@ThisPage.MyBox1.value'),/\$\.componentState\("MyBox1", "Value"\)/);
 assert.match(code('=@ThisPage.PayButton.CartTotal'),/\$\.pageValue\("PayButton", "CartTotal"\)/);
 assert.match(code('=@ThisPage.Tabs1.Selected.Id'),/\$\.componentState\("Tabs1", "Id"\)/);
 assert.match(code('=@ThisTenant.User.Name'),/\$\.session\("user\.name"\)/);
 assert.match(code('=@ThisTenant.User.CartId'),/\$\.session\("cartId"\)/);
 assert.match(code('=@ThisTenant.Company.Id'),/\$\.session\("tenant\.id"\)/);
 assert.match(code('=@ThisTenant.Company.Name & @ThisTenant.Company.Logo'),/\$\.tenant\("name"\)[\s\S]*\$\.tenant\("logo"\)/);
 assert.throws(()=>code('=@ThisPage.Session.Name'),/use @ThisPage\.Session\.Id/);
 assert.match(code('=@ThisTenant.Company.VatNumber'),/\$\.tenant\("vatnumber"\)/);
 assert.throws(()=>code('=@ThisTenant.Other.Secret'),/Unknown tenant value/);
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
 const wait=compileActionFormula('=ACTIONS(WAIT(1, 0), @ThisPage.B.Value = @ThisPage.Input.recordId)','Cart');
 assert.match(wait.js,/\$\.service\("WAIT", \[1, 0, 0, /);
 assert.match(wait.js,/setValue\("B", \$\.state\("recordId"\)\)/);
 const pdf=compileActionFormula('=ACTIONS(CREATEPDF(Receipt, @ThisPage.Input.recordId, AS(pdf)), LOCATION(AS(here)))','Cart');
 assert.match(pdf.js,/\$\.service\("CREATEPDF", \["Receipt", \$\.state\("recordId"\)\]\)/);
 assert.match(pdf.js,/v\["here"\] = await \$\.service\("LOCATION", \[\]\)/);
 const email=compileActionFormula('=EMAIL(Mailer, @ThisTenant.User.Email, "Receipt", @ThisTenant.Company.Name)','Cart');
 assert.match(email.js,/\$\.service\("EMAIL", \["Mailer", \$\.session\("user\.email"\), "Receipt", \$\.tenant\("name"\)\]\)/);
 const sms=compileActionFormula('=SMS(Texter, @ThisPage.Input.phone, @ThisPage.MessageBox.value)','Cart');
 assert.match(sms.js,/\$\.service\("SMS", \["Texter", \$\.state\("phone"\), \$\.componentState\("MessageBox", "Value"\)\]\)/);
 // Same counts as the save check (credential + values): a 2-value SMS has no recipient.
 assert.throws(()=>compileActionFormula('=SMS(Texter, "Hi")','Cart'));
 // Assignments keep working with the leading "=" the action bar and CSV store.
 assert.match(compileActionFormula('=@ThisPage.Input.result := "ok"','Cart').js,/\$\.setState\("result", "ok"\)/);
 const whatsapp=compileActionFormula('=WHATSAPP(Chat, @ThisPage.Input.phone, "Hi")','Cart');
 assert.match(whatsapp.js,/\$\.service\("WHATSAPP", \["Chat", \$\.state\("phone"\), "Hi"\]\)/);
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

test('values saved with STATE() belong to that component; rewrite moves them off Input', async ()=>{
 const {modernizePageRows}=await import('../../server/src/system-support/modernize-formula-references');
 const {encodeMetadataValue}=await import('../../server/src/system-files/component-runtime');
 const encode=(component:string,type:string,props:Record<string,unknown>)=>{
  const out:Array<{path:string;kind:string;text:string|null}>=[];
  encodeMetadataValue(props,'/props',out);
  return out.map(item=>({group_key:'g',component_key:component,component_type:type,
   property_path:item.path,value_kind:item.kind,value_text:item.text}));
 };
 const rows=[
  ...encode('b1','smart_button',{navigatorName:'ResumeButton',actionFlows:{click:{actionType:'Formula',
   formula:'=IF(COUNTIFS(CartLine, Status, "Open") > 0, STATE(heldError, "Hold or finish the current sale first"), CLOSESCREEN())'}}}),
  ...encode('t1','smart_text',{navigatorName:'Error1',textSource:'=@ThisPage.Input.heldError & @ThisPage.Input.recordId'})
 ];
 const changes=modernizePageRows(rows as never);
 assert.deepEqual(changes.map(change=>change.after),['=@ThisPage.ResumeButton.heldError & @ThisPage.Input.recordId']);
 assert.match(compileDisplayFormula(changes[0].after).js,/\$\.pageValue\("ResumeButton", "heldError"\)/);
});

test('browser: fast taps keep counting from the newest prediction while earlier answers arrive',async()=>{
 const module=pageCodeModule(buildPageCode(compiledPage as never));
 const createCode=new Function('F','O',module.replace(/export /g,'')+'\nreturn createCode(F, O);') as (f:typeof F,o:typeof O)=>PageCode;
 const code=createCode(F,O);
 const cartId='22222222-2222-4222-8222-222222222222';
 const cart=(total:number)=>({Id:cartId,SessionKey:'s-1',Status:'Open',Total:total,Subtotal:total});
 const setsWith=(lines:Row[],total:number)=>Object.fromEntries(code.recordSets.map(set=>[set.key,
  {rows:set.object==='Cart'?[cart(total)]:set.object==='CartLine'?lines:[],complete:true}]));
 const answers:Array<(value:unknown)=>void>=[];
 const rt=createPageCodeRuntime(code,{endpoint:'/apps/X',build:{buildId:'b'},sessionId:()=>'s-1',state:()=>({}),
  request:(async(path:string)=>path.endsWith('/sets')?{ok:true,sets:setsWith([],0)}
   :new Promise(resolve=>{answers.push(resolve);})) as never});
 await rt.loadSets();
 const total=rt.formulasFor('cart').get('=SUMIFS(Cart, Total, SessionKey, @ThisPage.Session.Id, Status, "Open")')!;
 const shown:Array<{changes:Array<{objectApiName:string;operation:string;record:Row}>;optimistic?:string}>=[];
 const io={show:(update:never)=>{shown.push(update);},effects:async()=>{}};
 const tap=()=>rt.run('grid:click',{recordId:productId,record:{Id:productId,Name:'Cola',Price:1.5}},'Product',io);
 const quantity=(index:number)=>shown[index].changes.find(change=>change.objectApiName==='CartLine')!.record.Quantity;
 const running=[tap(),tap(),tap()];
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual([0,1,2].map(quantity),[1,2,3]);
 assert.equal(total({}),4.5);
 const provisionalId=String(shown[0].changes.find(change=>change.objectApiName==='CartLine')!.record.Id);
 // Tap 1 is answered (the new line saved, quantity 1) while taps 2 and 3 still wait.
 const saved={Id:'33333333-3333-4333-8333-333333333333',Cart:cartId,Product:productId,Name:'Cola',Quantity:1,
  UnitPrice:1.5,LineTotal:1.5,session_key__c:'s-1',Status:'Open'};
 answers[0]({ok:true,changes:[{objectApiName:'CartLine',operation:'create',record:saved}],state:{},effects:[],sets:setsWith([saved],1.5)});
 await running[0];
 assert.equal(total({}),4.5,'the held total keeps taps 2 and 3');
 // Tap 4, after that answer, counts from 3: 4 (on the saved row, not the provisional one).
 const fourth=tap();
 await new Promise(resolve=>setTimeout(resolve,0));
 const line=shown.at(-1)!.changes.find(change=>change.objectApiName==='CartLine')!;
 assert.equal(line.record.Quantity,4);
 assert.equal(line.record.Id,saved.Id);
 assert.notEqual(line.record.Id,provisionalId);
 assert.equal(total({}),6);
 // An older answer arriving after a newer one never replaces the newer saved rows.
 answers[2]({ok:true,changes:[],state:{},effects:[],sets:setsWith([{...saved,Quantity:3,LineTotal:4.5}],4.5)});
 await running[2];
 answers[1]({ok:true,changes:[],state:{},effects:[],sets:setsWith([{...saved,Quantity:2,LineTotal:3}],3)});
 await running[1];
 assert.equal(total({}),6,'tap 4 still waits on top of the newest answer');
 answers[3]({ok:true,changes:[],state:{},effects:[],sets:setsWith([{...saved,Quantity:4,LineTotal:6}],6)});
 await fourth;
 assert.equal(total({}),6);
});

test('a popup for a row the tap creates opens after the save, with the saved Id',async()=>{
 const {earlyScreens}=await import('../src/core/pages/PageCompiler/pageCodeRuntime.ts');
 const effects=[{name:'CLOSESCREEN',args:[]},{name:'SCREEN',args:['smart_till_receipt','popup','tmp-inv-1']},
  {name:'SCREEN',args:['smart_till_customer_display','4']}];
 const changes=[{objectApiName:'Invoice',operation:'create' as const,record:{Id:'tmp-inv-1'}},
  {objectApiName:'Cart',operation:'update' as const,record:{Id:'cart-1'}}];
 assert.deepEqual(earlyScreens(effects,changes),[{name:'SCREEN',args:['smart_till_customer_display','4']}]);
 assert.equal(earlyScreens(effects,[]).length,2);
});
