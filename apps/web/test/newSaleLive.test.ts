/**
 * The live case that was slow (21 Nov): Clear sale, then 4 fast taps. A screen following the
 * till must show the first item from the till's prediction and count 1, 2, 3, 4 with no step
 * back, although the line belongs to a cart that is not saved yet. Real data layer, source
 * loader and tap drawing; the events are the ones the live stream sent, in that order.
 * Generic: any child list of the session's newest parent (cart lines, basket items...).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {compiledSourceLoader} from '../src/core/pages/PageCompiler/compiledSourceLoader.ts';
import {createCompiledDataLayer} from '../src/core/pages/PageCompiler/compiledPageStore.ts';
import {drawLiveTap,newTapLedger} from '../src/core/pages/PageCompiler/pageLiveWiring.ts';

type Row=Record<string,unknown>;
const objects=[{apiName:'Cart',fields:[{apiName:'SessionKey',dataType:'Text(255)'},{apiName:'Status',dataType:'Text(40)'}]},
 {apiName:'CartLine',fields:[{apiName:'Cart',dataType:'Lookup(Cart)',relationship:{targetObject:'Cart'}},
  {apiName:'Quantity',dataType:'Number'},{apiName:'Status',dataType:'Text(40)'}]}] as never;
const lines={id:'lines',objectApiName:'CartLine',components:['cart'],scope:{kind:'auto'},complete:false,
 filters:null,filterLogic:'AND',filterFormula:'',stateInputs:[]};
const compiled={apiName:'display',dataSources:[lines],components:[{id:'cart',objectReads:['CartLine']}]} as never;
const P=(batch:string,n:number)=>'ffffffff-ffff-4fff-8fff-'+batch+String(n).padStart(4,'0');

function screen(carts:Row[]){
 const table:{Cart:Row[];CartLine:Row[]}={Cart:carts,CartLine:[]};
 let reads=0;
 const loadPage=async(object:'Cart'|'CartLine',options:{filter?:{field:string;value:string}})=>{
  if(object==='CartLine')reads++;
  const rows=table[object].filter(row=>!options.filter||String(row[options.filter.field])===options.filter.value);
  return {records:rows.map(row=>({...row})),total:rows.length};
 };
 const data=createCompiledDataLayer(compiled,compiledSourceLoader(objects,()=>({sessionId:'s-1'}),loadPage as never),()=>({}));
 const shown:number[]=[];
 const target={apiName:'display',pageSessionKey:'S',dataSources:[lines] as never,data,code:null};
 const watch=()=>{const rows=data.get('lines').records;shown.push(rows.reduce((sum,row)=>sum+Number(row.Quantity??0),0));};
 return {table,data,target,shown,watch,reads:()=>reads};
}
const cart=(id:string,extra:Row={})=>({objectApiName:'Cart',operation:'create',record:{Id:id,SessionKey:'s-1',Status:'Open',...extra}});
const cartTotal=(id:string)=>({objectApiName:'Cart',operation:'update',record:{Id:id,SessionKey:'s-1',Status:'Open'}});
const line=(op:'create'|'update',id:string,cartId:string,quantity:number)=>({objectApiName:'CartLine',operation:op,
 record:{Id:id,Cart:cartId,Quantity:quantity,Status:'Open'}});

test('Clear sale, then 4 fast taps: the display shows 1, 2, 3, 4 from the predictions, never stepping back',async()=>{
 const s=screen([{Id:'cart-voided',SessionKey:'s-1',Status:'Voided',CreatedAt:'2026-11-21T21:00:00Z'}]);
 await s.data.start();
 assert.deepEqual(s.data.get('lines').records,[]);
 const ledger=newTapLedger();
 const step=async(kind:'preview'|'settled',batch:string,changes:unknown[])=>{
  await drawLiveTap(s.target as never,kind,{batch,ok:true,changes:changes as never},ledger);
  await new Promise(resolve=>setTimeout(resolve,0));
  s.watch();
 };
 const [b1,b2,b3,b4]=['0afc703c','0afc703d','0afc703e','0afc703f'];
 const pc=P(b1,1),pl=P(b1,2),sc='cart-new',sl='line-new';
 const readsBefore=s.reads();
 await step('preview',b1,[cart(pc),line('create',pl,pc,1),cartTotal(pc)]);
 assert.equal(s.shown.at(-1),1,'the first item shows from the prediction');
 await step('preview',b2,[line('update',pl,pc,2),cartTotal(pc)]);
 // Tap 1 saved (the server has the new cart and line now).
 s.table.Cart.push({Id:sc,SessionKey:'s-1',Status:'Open',CreatedAt:'2026-11-21T21:05:00Z'});
 s.table.CartLine.push({Id:sl,Cart:sc,Quantity:1,Status:'Open'});
 await step('settled',b1,[cart(sc),line('create',sl,sc,1),cartTotal(sc)]);
 await step('preview',b3,[line('update',sl,sc,3),cartTotal(sc)]);
 await step('settled',b2,[line('update',sl,sc,2),cartTotal(sc)]);
 await step('preview',b4,[line('update',sl,sc,4),cartTotal(sc)]);
 await step('settled',b3,[line('update',sl,sc,3),cartTotal(sc)]);
 s.table.CartLine[0].Quantity=4;
 await step('settled',b4,[line('update',sl,sc,4),cartTotal(sc)]);
 await new Promise(resolve=>setTimeout(resolve,10));s.watch();
 const counts=s.shown.filter((value,index)=>index===0||value!==s.shown[index-1]);
 assert.deepEqual(counts,[1,2,3,4]);
 assert.deepEqual(s.data.get('lines').records.map(row=>row.Id),[sl],'one saved row left');
 assert.equal(s.data.get('lines').relatedFilter?.value,sc,'the list follows the saved cart');
 assert.ok(s.reads()-readsBefore<=1,'at most one read of the lines in the whole sale');
});

test('the first item of a brand-new session (no cart yet) shows from the prediction',async()=>{
 const s=screen([]);
 await s.data.start();
 const ledger=newTapLedger();
 const pc=P('0b000001',1),pl=P('0b000001',2);
 await drawLiveTap(s.target as never,'preview',{batch:'0b000001',ok:true,changes:[cart(pc),line('create',pl,pc,1)] as never},ledger);
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(s.data.get('lines').records.map(row=>row.Quantity),[1]);
});
