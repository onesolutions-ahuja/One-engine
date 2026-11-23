import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRecordFilterFormula,validateRecordFilterFormula} from '../src/core/pages/PageRuntime/recordFilterFormula';
import type {FieldMetadata} from '../src/core/metadata/Definitions/metadata';

const fields=[{apiName:'MenuCategory',label:'Category',dataType:'Lookup(MenuCategory)',relationship:{targetObjectApiName:'MenuCategory'}},
 {apiName:'Name',label:'Name',dataType:'Text'}] as unknown as FieldMetadata[];

test('category filter: blank or "*" state shows every category, a tab Id filters to it',()=>{
 for(const formula of ['@Product.MenuCategory = BLANKVALUE(@ThisPage.Input.category, "*")',
  '@Product.MenuCategory = IF(ISBLANK(@ThisPage.Input.category), "*", @ThisPage.Input.category)']){
  assert.equal(validateRecordFilterFormula(formula,fields),null,formula);
  const all=compileRecordFilterFormula(formula,fields,{});
  assert.equal(all.blocked,false,all.error);
  assert.deepEqual(all.filters,[{field:'MenuCategory',operator:'isNotBlank',value:''}]);
  const star=compileRecordFilterFormula(formula,fields,{category:'*'});
  assert.deepEqual(star.filters,all.filters);
  const one=compileRecordFilterFormula(formula,fields,{category:'cat-1'});
  assert.deepEqual(one.filters,[{field:'MenuCategory',operator:'eq',value:'cat-1'}]);
 }
});

test('a filter on a state that is not picked yet still validates (and so saves)',()=>{
 assert.equal(validateRecordFilterFormula('@Product.MenuCategory = @ThisPage.Input.category',fields),null);
});

test('multi-select category filter: INCLUDES(ticked ids, @Product.MenuCategory) becomes ORed equals',()=>{
 const formula='IF(ISBLANK(@ThisPage.CatFilter.Value), TRUE, INCLUDES(@ThisPage.CatFilter.Value, @Product.MenuCategory))';
 assert.equal(validateRecordFilterFormula(formula,fields),null);
 const none=compileRecordFilterFormula(formula,fields,{});
 assert.deepEqual([none.blocked,none.filters],[false,[]]);
 const pick=(value:string)=>({collectionSelections:{CatFilter:{Id:value,Name:value,Value:value,Text:value,Field:'',Criteria:''}}});
 const two=compileRecordFilterFormula(formula,fields,pick('a;b'));
 assert.deepEqual(two.filters,[{field:'MenuCategory',operator:'eq',value:'a'},{field:'MenuCategory',operator:'eq',value:'b'}]);
 assert.equal(two.filterLogic,'(1 OR 2)');
});

test('Field mode with no field conditions uses the written filter formula',async()=>{
 const {activePageRecordFilters}=await import('../../server/src/page-compiler/pageCompilerSupport');
 assert.deepEqual(activePageRecordFilters({filterMode:'Field',filters:[],filterFormula:'@Product.Active = TRUE'}),
  {filters:[],formula:'@Product.Active = TRUE'});
 const kept=[{field:'Name',operator:'Equals',value:'x'}];
 assert.deepEqual(activePageRecordFilters({filterMode:'Field',filters:kept,filterFormula:'@Product.Active = TRUE'}),
  {filters:kept,formula:undefined});
});

test('open carts on other tills: <> and NOW() minus minutes compile to server filters',()=>{
 const cart=[{apiName:'Status',label:'Status',dataType:'Text'},{apiName:'SessionKey',label:'Session',dataType:'Text'},
  {apiName:'DeviceOnlineAt',label:'Online',dataType:'DateTime'}] as unknown as FieldMetadata[];
 const formula='AND(@Cart.Status = "Open", @Cart.SessionKey <> @ThisPage.Session.Id, @Cart.DeviceOnlineAt < NOW() - 2/1440)';
 const out=compileRecordFilterFormula(formula,cart,{},'s-1');
 assert.equal(out.blocked,false,out.error);
 assert.deepEqual(out.filters.slice(0,2),[{field:'Status',operator:'eq',value:'Open'},{field:'SessionKey',operator:'ne',value:'s-1'}]);
 assert.equal(out.filters[2].operator,'lt');
 const ago=(Date.now()-Date.parse(out.filters[2].value))/60000;
 assert.ok(ago>1&&ago<4,String(out.filters[2].value));
});

test('a written "" is a blank test: <> "" keeps filled rows, = "" keeps blank rows',()=>{
 const notBlank=compileRecordFilterFormula('AND(@Product.Name <> "Ready", @Product.Name <> "")',fields,{});
 assert.equal(notBlank.blocked,false,notBlank.error);
 assert.deepEqual(notBlank.filters,[{field:'Name',operator:'ne',value:'Ready'},{field:'Name',operator:'isNotBlank',value:''}]);
 const blank=compileRecordFilterFormula('@Product.Name = ""',fields,{});
 assert.deepEqual(blank.filters,[{field:'Name',operator:'isBlank',value:''}]);
 // An empty @ThisPage value still blocks until it is chosen.
 assert.equal(compileRecordFilterFormula('@Product.Name = @ThisPage.Input.pick',fields,{}).blocked,true);
});
