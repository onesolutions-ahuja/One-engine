import test from 'node:test';
import assert from 'node:assert/strict';
import {compiledSourceLoader} from '../src/core/pages/PageCompiler/compiledSourceLoader.ts';
import {createRecordPageCoalescer} from '../src/core/authentication/Client/recordPageCoalescer.ts';

// Any app: a list of child rows scoped to "this session's parent" (a till's cart lines, a
// kiosk's basket). After Clear sale or Hold the session gets a NEW parent; a screen that
// reads the list again because another screen saved must find that new parent.
const objects=[{apiName:'Cart',fields:[{apiName:'SessionKey',dataType:'Text(255)'}]},
 {apiName:'CartLine',fields:[{apiName:'Cart',dataType:'Lookup(Cart)',relationship:{targetObject:'Cart'}},
  {apiName:'Status',dataType:'Text(40)'}]}] as never;
const lines={id:'CartLine#a',objectApiName:'CartLine',components:[],scope:{kind:'auto'},complete:false,
 filters:null,filterLogic:'AND',filterFormula:'',stateInputs:[]} as never;

function fakeServer(){
 const carts=[{Id:'cart-old',SessionKey:'s-1',CreatedAt:'2026-11-21T19:23:30.000Z',Status:'Voided'}];
 const cartLines:Array<Record<string,unknown>>=[];
 const cache=new Map<string,{records:Record<string,unknown>[];total:number}>();
 const asked:Array<{object:string;fresh:boolean}>=[];
 // Like the browser's short read cache: the same query is answered from memory unless fresh.
 const loadPage=async(object:string,options:{filter?:{field:string;value:string};forceRefresh?:boolean})=>{
  asked.push({object,fresh:options.forceRefresh===true});
  const key=object+JSON.stringify(options.filter??null);
  if(!options.forceRefresh&&cache.has(key))return cache.get(key)!;
  const rows=(object==='Cart'?carts:cartLines).filter(row=>!options.filter||String(row[options.filter.field])===options.filter.value);
  const page={records:rows.map(row=>({...row})),total:rows.length};
  cache.set(key,page);
  return page;
 };
 return {carts,cartLines,asked,loadPage};
}

test('a fresh read after another screen\'s save finds the session\'s new parent (first item after Clear sale)',async()=>{
 const server=fakeServer();
 const load=compiledSourceLoader(objects,()=>({sessionId:'s-1'}),server.loadPage as never);
 // The display has read the sale: only the voided cart, no lines.
 assert.deepEqual((await load(lines,{},{offset:0,limit:50}))?.records,[]);
 // The till's first tap of the new sale: a new cart and its line (saved on another screen).
 server.carts.push({Id:'cart-new',SessionKey:'s-1',CreatedAt:'2026-11-21T19:24:14.393Z',Status:'Open'});
 server.cartLines.push({Id:'line-1',Cart:'cart-new',Status:'Open',Name:'KitKat'});
 load.invalidate(['Cart']);
 server.asked.length=0;
 const page=await load(lines,{},{offset:0,limit:50,fresh:true});
 assert.deepEqual(page?.records.map(row=>row.Id),['line-1'],'the new sale\'s line shows');
 assert.deepEqual(page?.relatedFilter,{field:'Cart',value:'cart-new',related:true,parent:{object:'Cart',session:'s-1'}});
 assert.ok(server.asked.find(item=>item.object==='Cart')?.fresh,'the parent is looked for fresh');
});

test('an ordinary (not fresh) read still uses the short read cache for the parent',async()=>{
 const server=fakeServer();
 const load=compiledSourceLoader(objects,()=>({sessionId:'s-1'}),server.loadPage as never);
 await load(lines,{},{offset:0,limit:50});
 load.invalidate(['Cart']);
 server.asked.length=0;
 await load(lines,{},{offset:0,limit:50});
 assert.equal(server.asked.find(item=>item.object==='Cart')?.fresh,false);
});

test('a fresh read never joins a request that started before the save',async()=>{
 const coalesce=createRecordPageCoalescer<{Id:string}>();
 let release:(rows:{Id:string}[])=>void=()=>{};
 const calls:string[]=[];
 const old=coalesce('k',20,()=>{calls.push('old');return new Promise(resolve=>{release=rows=>resolve({records:rows,total:rows.length});});});
 await new Promise(resolve=>setTimeout(resolve,0));
 const fresh=coalesce('k',20,async()=>{calls.push('fresh');return {records:[{Id:'new'}],total:1};},true);
 // A plain read made at the same time still shares the running request.
 const shared=coalesce('k',20,async()=>{calls.push('shared');return {records:[],total:0};});
 release([{Id:'old'}]);
 assert.deepEqual((await fresh).records,[{Id:'new'}]);
 assert.deepEqual((await old).records,[{Id:'old'}]);
 await shared;
 assert.deepEqual(calls,['old','fresh']);
});

test('a session with no parent yet: an empty list that knows which parent it waits for',async()=>{
 const server=fakeServer();
 server.carts.length=0;
 const load=compiledSourceLoader(objects,()=>({sessionId:'s-1'}),server.loadPage as never);
 const page=await load(lines,{},{offset:0,limit:50});
 assert.deepEqual(page?.records,[]);
 assert.deepEqual(page?.relatedFilter,{field:'Cart',value:'',related:true,parent:{object:'Cart',session:'s-1'}});
 assert.equal(server.asked.filter(item=>item.object==='CartLine').length,0,'no line read without a parent');
});
