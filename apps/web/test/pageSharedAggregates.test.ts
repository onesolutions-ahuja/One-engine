import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePage} from '../src/core/pages/PageCompiler/compilePage';
import {createCompiledDataLayer} from '../src/core/pages/PageCompiler/compiledPageStore';
import {evaluatePageActionSql} from '../src/component-libraries/shared/SqlFormulaPageRequest.js';
import {noteSharedMutation,clearSharedAggregates} from '../src/component-libraries/shared/PageFormulaShare.js';
import type {LightningPageMetadata,ObjectMetadata} from '../src/core/metadata/Definitions/metadata';

const field=(apiName:string,dataType='Text')=>({apiName,label:apiName,dataType,required:false,unique:false});
const objects=[{apiName:'Product',label:'Product',pluralLabel:'Products',kind:'Custom Object',description:'',
 fields:[field('Name'),field('Price','Currency')]}] as unknown as ObjectMetadata[];
const total='SUMIFS(CartLine, LineTotal, session_key__c, $session, Status, "Open")';
const qty='SUMIFS(CartLine, Quantity, session_key__c, $session, Status, "Open")';
const label=(id:string,formula:string,extra:Record<string,unknown>={})=>({id,type:'Custom:smart_text',label:id,visible:true,
 properties:{textSource:formula,...extra}});
const page={apiName:'p',label:'P',targetObject:'',pageType:'App Page',layoutMode:'free-canvas',status:'Draft',devices:['Desktop'],
 components:[
  ...Array.from({length:30},(_,i)=>label('a'+i,'=ROUND('+total+' * '+(i+1)+', 2)')),
  ...Array.from({length:30},(_,i)=>label('b'+i,'=TEXT('+total+', "0.00") & " / " & '+qty+' & "'+i+'"')),
  {id:'grid',type:'Custom:smart_card_grid',label:'Grid',visible:true,properties:{objectApiName:'Product',
   actionFlows:{click:{actionType:'Formula',flowApiName:'SmartTillAddProduct',
    formula:'ACTIONS(CREATERECORD(CartLine, Quantity, 1, Cart, $state.activeCartId))'}}}}
 ]} as unknown as LightningPageMetadata;

test('a stale flowApiName does not replace an authored formula click',()=>{
 const compiled=compilePage(page,objects);
 const grid=compiled.components.find(item=>item.id==='grid')!;
 assert.equal(grid.actions[0].kind,'ActionPlan');
 assert.equal(grid.actions[0].flowApiName,undefined);
 assert.equal(grid.mode,'compiled');
 assert.ok(!grid.legacyReasons.some(reason=>reason.startsWith('Flow action')));
});

test('a real Flow action (no formula type) still compiles as a Flow',()=>{
 const flowPage={...page,components:[{id:'f',type:'Custom:smart_button',label:'F',visible:true,
  properties:{objectApiName:'Product',actionFlows:{click:{actionType:'Flow',flowApiName:'X'}}}}]} as unknown as LightningPageMetadata;
 assert.equal(compilePage(flowPage,objects).components[0].actions[0].kind,'Flow');
});

test('compile reports repeated aggregates once',()=>{
 const compiled=compilePage(page,objects);
 assert.equal(compiled.stats.aggregateCalls,90);
 assert.equal(compiled.stats.distinctAggregates,2);
 assert.deepEqual(compiled.aggregates.map(item=>item.uses),[60,30]);
 assert.deepEqual(compiled.aggregates[0].objects,['CartLine']);
});

test('nothing falls back to the previous runtime, even in strict mode',()=>{
 const relatedPage={...page,components:[{id:'r',type:'Custom:smart_table',label:'R',visible:true,
  properties:{objectApiName:'Product',relatedFilterKey:'activeCartId'}}]} as unknown as LightningPageMetadata;
 const compiled=compilePage(relatedPage,objects,{strictLegacy:true});
 assert.equal(compiled.components[0].mode,'compiled');
 assert.deepEqual(compiled.diagnostics,[]);
});

test('the same total inside many different formulas is asked for once',async()=>{
 clearSharedAggregates();
 let calls=0;
 const request=async(_path:string,init:{body:string})=>{
  calls++;
  const body=JSON.parse(init.body);
  assert.ok(/^SUMIFS\(/.test(body.formula),'only the bare aggregate is sent');
  return {value:body.formula.includes('Quantity')?3:12.5};
 };
 const ask=(formula:string)=>evaluatePageActionSql(request as never,formula,{},{},'','',[],'session-1',{});
 const answers=await Promise.all([
  ...Array.from({length:30},(_,i)=>ask('ROUND('+total+' * '+(i+1)+', 2)')),
  ask(total),ask('ROUND('+qty+' * 2, 2)')]);
 assert.equal(answers[0],12.5);assert.equal(answers[1],25);assert.equal(answers[30],12.5);assert.equal(answers[31],6);
 assert.equal(calls,2,'two distinct aggregates, two requests');
});

test('a write drops the shared answer so the next ask goes back to the server',async()=>{
 clearSharedAggregates();
 let calls=0,value=10;
 const request=async()=>{calls++;return {value};};
 const ask=()=>evaluatePageActionSql(request as never,'ROUND('+total+', 2)',{},{},'','',[],'session-2',{});
 assert.equal(await ask(),10);assert.equal(await ask(),10);
 assert.equal(calls,1);
 value=20;
 noteSharedMutation('session-2',{objectApiNames:['Product']});
 assert.equal(await ask(),10,'unrelated Object write keeps the answer');
 noteSharedMutation('session-2',{objectApiNames:['CartLine']});
 assert.equal(await ask(),20);
 assert.equal(calls,2);
});

test('anything the shared path cannot answer falls back to the original request',async()=>{
 clearSharedAggregates();
 const sent:string[]=[];
 const request=async(_p:string,init:{body:string})=>{sent.push(JSON.parse(init.body).formula);return {value:null};};
 await evaluatePageActionSql(request as never,'ROUND('+total+', 2)',{},{},'','',[],'session-3',{});
 assert.equal(sent.length,2,'null aggregate: shared ask, then the unchanged whole-formula request');
 assert.ok(sent[1].startsWith('ROUND('));
});

test('refreshing a data source with identical rows does not redraw its readers',async()=>{
 const compiled=compilePage({...page,components:[{id:'g',type:'Custom:smart_card_grid',label:'G',visible:true,
  properties:{objectApiName:'Product'}}]} as unknown as LightningPageMetadata,objects);
 let rows=[{Id:'1',Name:'A'},{Id:'2',Name:'B'}];
 const layer=createCompiledDataLayer(compiled,async()=>({records:rows.map(row=>({...row})),total:rows.length,predictable:false,paged:true}),()=>({}));
 const id=compiled.dataSources[0].id;
 await layer.reload(id);
 let redraws=0;
 layer.subscribe(id,()=>{redraws++;});
 await layer.reload(id);
 assert.equal(redraws,0,'same rows, no redraw');
 rows=[{Id:'1',Name:'A'},{Id:'2',Name:'C'}];
 await layer.reload(id);
 assert.equal(redraws,1,'changed rows redraw exactly once');
 assert.equal(layer.get(id).records[1].Name,'C');
});
