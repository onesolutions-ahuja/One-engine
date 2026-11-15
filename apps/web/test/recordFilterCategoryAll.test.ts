import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRecordFilterFormula,validateRecordFilterFormula} from '../src/core/pages/PageRuntime/recordFilterFormula';
import type {FieldMetadata} from '../src/core/metadata/Definitions/metadata';

const fields=[{apiName:'MenuCategory',label:'Category',dataType:'Lookup(MenuCategory)',relationship:{targetObjectApiName:'MenuCategory'}},
 {apiName:'Name',label:'Name',dataType:'Text'}] as unknown as FieldMetadata[];

test('category filter: blank or "*" state shows every category, a tab Id filters to it',()=>{
 for(const formula of ['@Product.MenuCategory = BLANKVALUE($state.category, "*")',
  '@Product.MenuCategory = IF(ISBLANK($state.category), "*", $state.category)']){
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
 assert.equal(validateRecordFilterFormula('@Product.MenuCategory = $state.category',fields),null);
});
