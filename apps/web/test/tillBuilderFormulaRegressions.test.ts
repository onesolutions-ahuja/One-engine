import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveComponentFormulaProps} from '../src/core/components/RegisteredComponent/componentFormulaProps';
import {scopedFieldAllows} from '../src/core/pages/PageRuntime/fieldScopedRecordFilters';
import {formulaSignatureAt} from '../src/core/builders/PageBuilder/formulaSignatureHelp';
import type {FieldMetadata} from '../src/core/metadata/Definitions/metadata';
import {pageStartKey,carriedPageState} from '../src/core/pages/PageCompiler/pageStartAction';
import {compiledSourceLoader} from '../src/core/pages/PageCompiler/compiledSourceLoader';

const subtotal='="£" & TEXT(SUMIFS(Cart, Subtotal, SessionKey, @ThisPage.Session.Id, Status, "Open"))';

test('design canvas: an unconverted cart total is a blank placeholder, not FORMULAERROR',()=>{
 const props={subtotalValue:subtotal,totalValue:'=SUMIFS(Cart, Total, SessionKey, @ThisPage.Session.Id)'};
 const canvas=resolveComponentFormulaProps(props,'smart_cart',null,true);
 assert.equal(canvas.subtotalValue,'');
 assert.equal(canvas.totalValue,'');
});

test('published pages and Preview still refuse a total that has no page code',()=>{
 const props={subtotalValue:subtotal};
 assert.equal(resolveComponentFormulaProps(props,'smart_cart',null).subtotalValue,'FORMULAERROR');
 assert.equal(resolveComponentFormulaProps(props,'smart_cart',new Map()).subtotalValue,'FORMULAERROR');
 assert.equal(resolveComponentFormulaProps(props,'smart_cart',new Map(),true).subtotalValue,'FORMULAERROR');
 const code=new Map([[subtotal,()=>'£27.47']]);
 assert.equal(resolveComponentFormulaProps(props,'smart_cart',code,true).subtotalValue,'£27.47');
});

test('per-field filters read @ThisPage.Session.Id from the page session',()=>{
 const fields=[{apiName:'SessionKey',label:'Session',dataType:'Text'}] as FieldMetadata[];
 const rules={Name:{filterMode:'Formula',filters:[],filterLogic:'AND',filterFormula:'@Cart.SessionKey = @ThisPage.Session.Id'}};
 const row={Id:'c1',Name:'Till sale',SessionKey:'till-1'};
 assert.equal(scopedFieldAllows(rules,'Name',row,fields,{sessionId:'till-1'}),true);
 assert.equal(scopedFieldAllows(rules,'Name',{...row,SessionKey:'till-2'},fields,{sessionId:'till-1'}),false);
});

test('property formula bar names SUMIFS arguments (Object, ValueField, Field, Value)',()=>{
 const source='=SUMIFS(Cart, Subtotal, SessionKey, ';
 const help=formulaSignatureAt(source,source.length);
 assert.deepEqual(help?.parameters.slice(0,4).map(p=>p.name),['Object','ValueField','Field','Value']);
 assert.equal(help?.argument,3);
 const count=formulaSignatureAt('=COUNTIFS(Cart, ',16);
 assert.deepEqual(count?.parameters.slice(0,3).map(p=>p.name),['Object','Field','Value']);
});

// Live till: the SaleCart list reads @ThisPage.Input.sk, which PageBackground's start action
// sets with =STATE(sk, @ThisPage.Session.Id). It showed "0 items" + "Selected formula state value is empty".
const saleCart='AND(@CartLine.session_key__c = @ThisPage.Input.sk, @CartLine.Status = "Open")';
const cartLineFields=[{apiName:'session_key__c',label:'Session',dataType:'Text'},
 {apiName:'Status',label:'Status',dataType:'Text'}] as FieldMetadata[];
const saleCartSource={id:'CartLine#1',objectApiName:'CartLine',components:['SaleCart'],scope:{kind:'none' as const},
 complete:false,filters:[],filterLogic:'AND' as const,filterFormula:saleCart,stateInputs:['sk']};

test('till start action waits for the page code instead of failing once and never running',()=>{
 const start={actionType:'Formula',formula:'=STATE(sk, @ThisPage.Session.Id)'};
 assert.equal(pageStartKey('s-1',start,false),'');
 assert.equal(pageStartKey('s-1',start,true),'s-1');
 // Non-formula starts (page state, flows) need no page code.
 assert.equal(pageStartKey('s-1',{actionType:'PageState',stateKey:'sk'},false),'s-1');
 assert.equal(pageStartKey('s-1',undefined,true),'');
});

test('a rebuilt till runtime keeps the page session state (sk), but not another session\'s',()=>{
 const previous={session:()=>'till\ns-1',state:()=>({sk:'s-1',category:'drinks'})};
 assert.deepEqual(carriedPageState(previous,'till\ns-1'),{sk:'s-1',category:'drinks'});
 assert.deepEqual(carriedPageState(previous,'till\ns-2'),{});
 assert.deepEqual(carriedPageState(previous,'till\ns-1',{category:'food'}),{sk:'s-1',category:'food'});
 assert.deepEqual(carriedPageState(null,'till\ns-1'),{});
});

test('cart list with sk not set yet is an empty list, not a red error; with sk it filters this session',async()=>{
 const asked:unknown[]=[];
 const load=compiledSourceLoader([{apiName:'CartLine',label:'Cart Line',fields:cartLineFields}] as never,
  ()=>({sessionId:'s-1'}),async(_object,options)=>{asked.push(options);return {records:[{Id:'l1'}],total:1};});
 assert.equal(await load(saleCartSource as never,{},{offset:0,limit:50}),null);
 assert.equal(asked.length,0,'nothing is read while the value is blank');
 const page=await load(saleCartSource as never,{sk:'s-1'},{offset:0,limit:50});
 assert.equal(page?.records.length,1);
 assert.deepEqual((asked[0] as {filters:unknown}).filters,
  [{field:'session_key__c',operator:'eq',value:'s-1'},{field:'Status',operator:'eq',value:'Open'}]);
});

test('other filter errors still show',async()=>{
 const load=compiledSourceLoader([{apiName:'CartLine',label:'Cart Line',fields:cartLineFields}] as never,
  ()=>({sessionId:'s-1'}),async()=>({records:[],total:0}));
 await assert.rejects(load({...saleCartSource,filterFormula:'@CartLine.Nope = 1'} as never,{},{offset:0,limit:50}));
});
