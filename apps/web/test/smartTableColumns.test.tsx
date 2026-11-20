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

test('Sort orders the shown rows by a column, numbers as numbers, including formula columns',()=>{
 const many=[{Id:'a',Name:'B',StockLevel:10},{Id:'b',Name:'a',StockLevel:2},{Id:'c',Name:'C',StockLevel:0}];
 const html=(sort:string)=>renderToStaticMarkup(React.createElement(SmartTable as never,{p:{objectApiName:'Product',objects,
  tableColumns:'Name, Level',column2Source:'=LEVEL',tableSort:sort},records:many,
  expression:(f:string,row:Record<string,unknown>)=>f==='=LEVEL'?String(row.StockLevel):''}));
 const names=(markup:string)=>[...markup.matchAll(/<tr[^>]*><td[^>]*>([^<]*)<\/td>/g)].map(m=>m[1]);
 assert.deepEqual(names(html('Level asc')),['C','a','B']);
 assert.deepEqual(names(html('Level desc')),['B','a','C']);
 assert.deepEqual(names(html('Name asc')),['a','B','C']);
});

test('Sort reads UK dates as dates, and every column formula is read per row',async()=>{
 const rows=[{Id:'a',Name:'A',When:'19/11/2026 09:05'},{Id:'b',Name:'B',When:'18/11/2026 20:34'},{Id:'c',Name:'C',When:'02/12/2026 08:00'}];
 const html=renderToStaticMarkup(React.createElement(SmartTable as never,{p:{objectApiName:'Product',objects,
  tableColumns:'Name, When',column2Source:'=W',tableSort:'When desc'},records:rows,
  expression:(f:string,row:Record<string,unknown>)=>String(row.When)}));
 assert.deepEqual([...html.matchAll(/<tr[^>]*><td[^>]*>([^<]*)<\/td>/g)].map(m=>m[1]),['C','A','B']);
 const {isRowDisplayProperty}=await import('../src/core/components/RegisteredComponent/componentFormulaProps');
 for(const key of ['column1Source','column6Source','column4Color'])assert.equal(isRowDisplayProperty('smart_table',key,{records:[]}),true);
 assert.equal(isRowDisplayProperty('smart_table','tableSort',{records:[]}),false);
});

test('Show record count off hides the table footer',()=>{
 assert.match(render({}),/smart-table-footer/);
 assert.doesNotMatch(render({footerVisible:false}),/smart-table-footer/);
});

test('Show only keeps rows whose column shows one of the values; blank shows all',()=>{
 const html=render({tableColumns:'Name, Status',column2Source:'=STATUS',tableShowWhen:'Status=Out of stock'});
 assert.ok(html.includes('>Cola<')&&!html.includes('>Tea<'));
 const none=render({tableColumns:'Name, Status',column2Source:'=STATUS',tableShowWhen:'Status=Low',emptyText:'Nothing low'});
 assert.ok(none.includes('Nothing low')&&!none.includes('>Cola<'));
 const all=render({tableColumns:'Name, Status',column2Source:'=STATUS',tableShowWhen:''});
 assert.ok(all.includes('>Cola<')&&all.includes('>Tea<'));
});
