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

test('Field mode with no field conditions uses the written filter formula',async()=>{
 const {activePageRecordFilters}=await import('../../server/src/page-compiler/pageCompilerSupport');
 assert.deepEqual(activePageRecordFilters({filterMode:'Field',filters:[],filterFormula:'@Product.Active = TRUE'}),
  {filters:[],formula:'@Product.Active = TRUE'});
 const kept=[{field:'Name',operator:'Equals',value:'x'}];
 assert.deepEqual(activePageRecordFilters({filterMode:'Field',filters:kept,filterFormula:'@Product.Active = TRUE'}),
  {filters:kept,formula:undefined});
});
