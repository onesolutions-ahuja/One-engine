import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveComponentFormulaProps} from '../src/core/components/RegisteredComponent/componentFormulaProps';
import {scopedFieldAllows} from '../src/core/pages/PageRuntime/fieldScopedRecordFilters';
import {formulaSignatureAt} from '../src/core/builders/PageBuilder/formulaSignatureHelp';
import type {FieldMetadata} from '../src/core/metadata/Definitions/metadata';

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
