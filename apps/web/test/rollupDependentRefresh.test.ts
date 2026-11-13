import test from 'node:test';
import assert from 'node:assert/strict';
import {withDependentObjects} from '../src/core/pages/PageRuntime/pageMutationScope';

const objects=[
 {apiName:'Product',fields:[{apiName:'SoldQty',dataType:'Roll-Up Summary',rollup:{childObject:'InvoiceLine'}},
  {apiName:'StockLevel',dataType:'Formula (Number)',formula:{expression:'BLANKVALUE(Product.SoldQty, 0)'}}]},
 {apiName:'Category',fields:[{apiName:'Sold',dataType:'Roll-Up Summary',rollup:{childObject:'Product'}}]},
 {apiName:'InvoiceLine',fields:[{apiName:'Product',relationship:{targetObject:'Product'}},
  {apiName:'Price',formula:{expression:'Product.Price * 2'}}]},
 {apiName:'CartLine',fields:[{apiName:'Name'}]}
];

test('a child save also refreshes roll-up parents and grandparents', ()=>{
 assert.deepEqual([...withDependentObjects(['InvoiceLine'],objects)!].sort(),['Category','InvoiceLine','Product']);
});
test('a cross-object formula reader refreshes when its lookup target is saved', ()=>{
 assert.deepEqual([...withDependentObjects(['Product'],objects)!].sort(),['Category','InvoiceLine','Product']);
});
test('unrelated saves add nothing and keep the same array (no extra reloads)', ()=>{
 const written=['CartLine'];
 assert.equal(withDependentObjects(written,objects),written);
 assert.equal(withDependentObjects(undefined,objects),undefined);
});
