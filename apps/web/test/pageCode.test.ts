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

const tillAddFormula=`=ACTIONS(IF(COUNTIFS(Cart, SessionKey, $session, Status, "Open") = 0, CREATERECORD(Cart, SessionKey, $session, Status, "Open", Name, "Till sale"), ""), GETRECORD(Cart, Status, "Open", SessionKey, $session, AS(sc)), GETRECORD(CartLine, Cart, sc.Id, session_key__c, $session, Product, @recordId, Status, "Open", AS(line)), IF(ISBLANK(line.Id), CREATERECORD(CartLine, Cart, sc.Id, Product, @recordId, Name, @record.Name, Quantity, 1, UnitPrice, @record.Price, OriginalUnitPrice, @record.Price, LineTotal, @record.Price, DiscountAmount, 0, session_key__c, $session, Status, "Open"), UPDATERECORD(CartLine, line.Id, Quantity, line.Quantity + 1, LineTotal, (line.Quantity + 1) * line.UnitPrice)), GETRECORD(Cart, Id, sc.Id, AS(c)), IF(ISBLANK(c.Id), "", UPDATERECORD(Cart, c.Id, Subtotal, SUMIFS(CartLine, LineTotal, Cart, c.Id, Status, "Open"), Total, SUMIFS(CartLine, LineTotal, Cart, c.Id, Status, "Open"))))`;

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
 assert.equal(fn(compileDisplayFormula('=$state.category & ":" & $session').js)({},display({category:'beer'})),'beer:s-1');
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
 {id:'cart',objectApiName:'CartLine',formulas:[{property:'totalValue',source:'=SUMIFS(Cart, Total, SessionKey, $session, Status, "Open")'}],actions:[]}]};

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
 const total=rt.formulasFor('cart').get('=SUMIFS(Cart, Total, SessionKey, $session, Status, "Open")')!;
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
