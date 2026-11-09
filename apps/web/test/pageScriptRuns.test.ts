import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePage} from '../src/core/pages/PageCompiler/compilePage';
import {generatePageScript} from '../src/core/pages/PageCompiler/generatePageScript';
import {scriptFormulaOperators,scriptFormulaLibrary} from '../src/core/pages/PageCompiler/pageScriptHost';
import {PageScriptService} from '../../server/src/page-compiler/pageScriptService';
import type {LightningPageMetadata,ObjectMetadata} from '../src/core/metadata/Definitions/metadata';

const field=(apiName:string,dataType='Text')=>({apiName,label:apiName,dataType,required:false,unique:false});
const objects=[{apiName:'Product',label:'Product',pluralLabel:'Products',kind:'Custom Object',description:'',
 fields:[field('Name'),field('Price','Currency')]}] as unknown as ObjectMetadata[];
const button=(id:string,binding:Record<string,unknown>)=>({id,type:'Custom:smart_button',label:id,visible:true,
 properties:{actionFlows:{click:binding}}});
const page={apiName:'till',label:'Till',targetObject:'',pageType:'App Page',layoutMode:'free-canvas',
 status:'Draft',devices:['Desktop'],draftRevision:7,components:[
  {id:'grid',type:'Custom:smart_card_grid',label:'Grid',visible:true,properties:{objectApiName:'Product',
   actionFlows:{click:{actionType:'Formula',formula:'ACTIONS(CREATERECORD(CartLine, Quantity, 1, Cart, $state.activeCartId))'}}}},
  button('pick',{actionType:'PageState',stateKey:'activeCartId',value:'$event.value'}),
  button('calc',{actionType:'Formula',formula:'@state.total := ROUND($state.price * 2, 2) & " GBP"'}),
  button('sum',{actionType:'Formula',formula:'@state.lines := COUNTIFS(CartLine, Cart, $state.activeCartId)'}),
  button('go',{actionType:'Formula',formula:'@navigate.page := "Till/Checkout"'})
 ]} as unknown as LightningPageMetadata;
const load=async(code:string)=>import('data:text/javascript,'+encodeURIComponent(code));
const host={operators:scriptFormulaOperators,formulaLibrary:scriptFormulaLibrary};
const fakeCtx=(state:Record<string,unknown>)=>{
 const calls:Array<[string,...unknown[]]>=[];
 return {calls,ctx:{
  sessionId:'s-1',
  setState:(key:string,value:unknown)=>{calls.push(['setState',key,value]);state[key]=value;},
  pick:(event:Record<string,unknown>,path:string[])=>path.reduce<unknown>((c,k)=>c&&typeof c==='object'?(c as Record<string,unknown>)[k]:undefined,event),
  statePath:(path:string)=>state[path],recordField:()=>undefined,input:()=>undefined,
  formulaScope:(event:Record<string,unknown>)=>({record:{state,event,session:{id:'s-1'}},state,sessionId:'s-1'}),
  platformValue:async(kind:string,formula:string)=>{calls.push(['platformValue',kind,formula]);return 3;},
  save:async(key:string,plan:{serverDataSteps:number})=>{calls.push(['save',key,plan.serverDataSteps]);return {updated:true};},
  navigateTo:async(kind:string,target:unknown)=>{calls.push(['navigateTo',kind,target]);return {};},
  runFormula:async()=>({}),navigate:async()=>({}),selectFilter:async()=>({}),adjustNumber:async()=>({}),runFlow:async()=>({})
 }};
};

test('the generated file is a real module: actions run as JavaScript',async()=>{
 const module=await load(generatePageScript(compilePage(page,objects),'js'));
 const actions=module.createActions(host);
 const state:Record<string,unknown>={price:4.5};
 const {ctx,calls}=fakeCtx(state);
 await actions['pick:click'](ctx,{value:'cart-9'});
 await actions['calc:click'](ctx,{});
 await actions['sum:click'](ctx,{});
 await actions['go:click'](ctx,{});
 await actions['grid:click'](ctx,{recordId:'p1'});
 assert.deepEqual(calls,[
  ['setState','activeCartId','cart-9'],
  // Pure formula: worked out by the compiled JavaScript itself.
  ['setState','total','9 GBP'],
  // Database aggregate: the platform evaluates it (same rules as before).
  ['platformValue','state','COUNTIFS(CartLine, Cart, $state.activeCartId)'],['setState','lines',3],
  ['navigateTo','page','Till/Checkout'],
  // Record save: only the action key goes to the server, which runs its own compiled copy.
  ['save','grid:click',1]]);
});

test('the file carries the exact plan the runtime executes',async()=>{
 const compiled=compilePage(page,objects);
 const module=await load(generatePageScript(compiled,'js'));
 assert.equal(module.plan.apiName,'till');
 assert.equal(module.plan.revision,7);
 assert.deepEqual(module.plan.dataSources,JSON.parse(JSON.stringify(compiled.dataSources)));
 assert.deepEqual(module.plan.stateReaders,compiled.stateReaders);
 assert.equal(module.PLANS['grid:click'].serverDataSteps,1);
});

test('server tickets: single use, expire after 60 s, bound to one page',()=>{
 let now=1_000;
 const scripts=new PageScriptService(()=>now);
 const ticket=scripts.issueTicket('t1','u1','till','Desktop');
 assert.match(ticket,/^[A-Za-z0-9_-]{43}$/);
 assert.deepEqual(scripts.consumeTicket(ticket),{tenantId:'t1',userId:'u1',apiName:'till',variant:'Desktop',expires:61_000});
 assert.equal(scripts.consumeTicket(ticket),null,'single use');
 const late=scripts.issueTicket('t1','u1','till','Desktop');
 now+=60_001;
 assert.equal(scripts.consumeTicket(late),null,'expired');
 assert.equal(scripts.consumeTicket('../../etc/passwd'),null);
 assert.throws(()=>scripts.issueTicket('t1','u1','bad name','Desktop'));
});

test('server builds once per saved revision and runs actions only from its own copy',()=>{
 const scripts=new PageScriptService();
 const key={tenantId:'t1',apiName:'till',variant:'Desktop'};
 const first=scripts.build(key,page as never,objects as never);
 assert.equal(scripts.build(key,page as never,objects as never),first,'cached');
 assert.deepEqual(scripts.action(key,7,'grid:click'),{formula:'ACTIONS(CREATERECORD(CartLine, Quantity, 1, Cart, $state.activeCartId))',
  serverDataSteps:1,totalSteps:1});
 assert.equal(scripts.action(key,6,'grid:click'),null,'another revision is not trusted');
 assert.equal(scripts.action(key,7,'grid:delete'),null);
 assert.equal(scripts.action({...key,tenantId:'t2'},7,'grid:click'),null,'never across tenants');
 const changed=scripts.build(key,page as never,[...objects,{apiName:'Cart',fields:[]}] as never);
 assert.notEqual(changed,first,'an Object change rebuilds');
 assert.match(first.code,/THIS FILE RUNS THE PAGE/);
});

test('Preview converts unsaved edits on the server; only that user can run its saves',()=>{
 const scripts=new PageScriptService();
 const edited={...page,draftRevision:7,components:[...page.components,button('extra',{actionType:'Formula',
  formula:'ACTIONS(UPDATERECORD(Cart, $state.activeCartId, Name, "x"))'})]};
 const {previewId,built}=scripts.buildPreview('t1','u1','till','Desktop',edited as never,objects as never);
 assert.match(built.code,/"extra:click"/,'the unsaved button is in the converted file');
 assert.equal(scripts.buildPreview('t1','u1','till','Desktop',edited as never,objects as never).previewId,previewId,'same draft, same id');
 assert.equal(scripts.previewAction('t1','u1','till',previewId,'extra:click')?.serverDataSteps,1);
 assert.equal(scripts.previewAction('t1','u2','till',previewId,'extra:click'),null,'another user cannot use it');
 assert.equal(scripts.previewAction('t2','u1','till',previewId,'extra:click'),null,'another tenant cannot use it');
 assert.equal(scripts.action({tenantId:'t1',apiName:'till',variant:'Desktop'},7,'extra:click'),null,'never mixed with the saved page');
 const ticket=scripts.issueTicket('t1','u1','till','Desktop',previewId);
 assert.equal(scripts.consumeTicket(ticket)?.previewId,previewId);
 assert.throws(()=>scripts.buildPreview('t1','u1','other','Desktop',edited as never,objects as never),/does not match/);
});

test('page-level display formulas from the file equal the component result',async()=>{
 const {evaluateFieldExpression}=await import('../src/component-libraries/shared/FieldExpression.js');
 const labelled={...page,components:[{id:'t',type:'Custom:smart_text',label:'T',visible:true,
  properties:{textSource:'=ROUND($state.price * 1.2, 2) & " GBP " & UPPER($session)'}}]};
 const module=await load(generatePageScript(compilePage(labelled as never,objects),'js'));
 const formulas=module.createFormulas(host);
 const state={price:4.25};
 assert.equal(formulas['t:textSource']({record:{},state,sessionId:'abc'}),
  evaluateFieldExpression('=ROUND($state.price * 1.2, 2) & " GBP " & UPPER($session)',{},{pageState:state,sessionId:'abc'}));
});

test('one collection Object is loaded once for many components, and a save clears it',async()=>{
 const {sharedAggregate,clearSharedAggregates,noteSharedMutation}=await import('../src/component-libraries/shared/PageFormulaShare.js');
 clearSharedAggregates();
 let loads=0;
 const reader=async()=>({records:[],total:0});
 const ask=()=>sharedAggregate('s-1',reader,'["collection-source","Category"]',['Category'],async()=>{loads++;return [{Id:'c1'}];});
 await Promise.all([ask(),ask(),ask()]);
 assert.equal(loads,1);
 noteSharedMutation('s-1',{objectApiNames:['Category']});
 await ask();
 assert.equal(loads,2);
});
