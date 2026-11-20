import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SmartTable from '../src/component-libraries/smart_table/SmartTable.jsx';

(globalThis as {React?:unknown}).React=React;
const objects=[{apiName:'Product',fields:[{apiName:'Name',label:'Product name'},{apiName:'SKU',label:'SKU'},
 {apiName:'StockLevel',label:'Stock Level'},{apiName:'Secret',label:'Secret'}]}];
const records=[{Id:'p1',Name:'Cola',SKU:'C1',StockLevel:0,Secret:'x'},{Id:'p2',Name:'Tea',SKU:'T1',StockLevel:9,Secret:'y'}];
const expression=(formula:string,row:Record<string,unknown>)=>formula==='=STATUS'?(Number(row.StockLevel)<=0?'Out of stock':'OK')
 :formula==='=COLOUR'?(Number(row.StockLevel)<=0?'#FF3B30':'#248A3D'):'';
const render=(p:Record<string,unknown>)=>renderToStaticMarkup(React.createElement(SmartTable as never,{p:{objectApiName:'Product',objects,...p},records,expression}));

test('Columns lists fields in order, adds formula columns, headers, colours and alignment',()=>{
 const html=render({tableColumns:'Name, StockLevel, Status',column2Header:'In stock',column2Align:'right',
  column3Source:'=STATUS',column3Header:'Status',column3Color:'=COLOUR'});
 const heads=[...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m=>m[1]);
 assert.deepEqual(heads,['Product name','In stock','Status']);
 assert.ok(!html.includes('Secret')&&!html.includes('>C1<'));
 assert.match(html,/text-align:right[^>]*>0</);
 assert.match(html,/color:#FF3B30[^>]*>Out of stock</);
 assert.match(html,/color:#248A3D[^>]*>OK</);
});

test('a name that is neither a field nor a formula column is dropped; no Columns keeps every field',()=>{
 const html=render({tableColumns:'Name, Nope'});
 assert.deepEqual([...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m=>m[1]),['Product name']);
 const all=render({});
 assert.ok(all.includes('Secret')&&all.includes('SKU'));
});
