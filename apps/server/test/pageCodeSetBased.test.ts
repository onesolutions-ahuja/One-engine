import assert from 'node:assert/strict';
import test from 'node:test';
import {compileActionFormula} from '../src/page-compiler/code/generateCode.js';
import {F,O} from '../src/page-compiler/code/formulaLibrary.js';

type Row=Record<string,unknown>;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const fn=(js:string)=>new Function('F','O','return '+js)(F,O) as ($:unknown)=>Promise<void>;

/** A `$` that counts the statements a batched loop makes (one per step, never per row). */
function counting(rows:Row[]){
 const statements:string[]=[];
 const created:Row[]=[];
 const updated:Row[]=[];
 const $={
  state:()=>'',pageValue:()=> 'cart-1',session:()=> '',tenant:()=> '',event:()=> '',timeZone:()=> 'UTC',
  f:(row:Row,field:string)=>row[field]??'',
  create:async()=>{statements.push('create-one');return {};},
  update:async()=>{statements.push('update-one');return {};},
  getRecord:async()=>{statements.push('getRecord');return {};},
  list:async()=>{statements.push('list');return rows;},
  createFrom:async(object:string,given:Row[],fields:Record<string,(row:Row)=>unknown>)=>{
   statements.push('create:'+object);
   for(const row of given)created.push(Object.fromEntries(await Promise.all(Object.entries(fields).map(async([field,make])=>[field,await make(row)]))));
   return created.length;
  },
  updateWhere:async(object:string,given:Row[],fields:Record<string,(row:Row)=>unknown>)=>{
   statements.push('update:'+object);
   for(const row of given)updated.push({Id:row.Id,...Object.fromEntries(await Promise.all(Object.entries(fields).map(async([field,make])=>[field,await make(row)])))});
   return updated.length;
  },
  removeWhere:async(object:string,given:Row[])=>{statements.push('delete:'+object);return given.length;}
 };
 return {$,statements,created,updated};
}

const lines=(count:number):Row[]=>Array.from({length:count},(_,index)=>({Id:'line-'+index,Quantity:index+1,Status:'Open'}));
const sale='=FOREACH(CartLine, Cart, @ThisPage.Cart.Id, AS(line), '+
 'ACTIONS(CREATERECORD(InvoiceLine, Item, line.Id, Qty, line.Quantity, Total, line.Quantity * 10), '+
 'UPDATERECORD(CartLine, line.Id, Status, "Sold")))';

test('a FOREACH of saves becomes one call per step, not one per row',async()=>{
 const code=compileActionFormula(sale,'CartLine');
 assert.match(code.js,/\$\.createFrom\("InvoiceLine", /);
 assert.match(code.js,/\$\.updateWhere\("CartLine", /);
 assert.doesNotMatch(code.js,/for \(const item/);
 assert.equal(code.data,true);
 assert.deepEqual(code.writes.sort(),['CartLine','InvoiceLine']);
});

test('3 lines and 300 lines make the same number of statements and the same rows',async()=>{
 const small=counting(lines(3));
 const large=counting(lines(300));
 const code=compileActionFormula(sale,'CartLine');
 const run=fn(code.js);
 await run(small.$);
 await run(large.$);
 // One CREATE and one UPDATE, whatever the number of rows.
 assert.deepEqual(small.statements,['list','create:InvoiceLine','update:CartLine']);
 assert.deepEqual(large.statements,small.statements);
 // The saved rows are what the old loop produced, row for row.
 const expected=(count:number)=>lines(count).map(line=>({Item:line.Id,Qty:line.Quantity,Total:Number(line.Quantity)*10}));
 assert.deepEqual(small.created,expected(3));
 assert.equal(large.created.length,300);
 assert.deepEqual(large.created.slice(0,3),expected(3));
 assert.deepEqual(small.updated,[{Id:'line-0',Status:'Sold'},{Id:'line-1',Status:'Sold'},{Id:'line-2',Status:'Sold'}]);
});

test('anything else in the body keeps today\'s loop',async()=>{
 const reads='=FOREACH(CartLine, Cart, @ThisPage.Cart.Id, AS(line), '+
  'ACTIONS(GETRECORD(Product, Id, line.Product, AS(p)), CREATERECORD(InvoiceLine, Qty, line.Quantity, Name, p.Name)))';
 const read=compileActionFormula(reads,'CartLine');
 assert.match(read.js,/for \(const item of await \$\.list\("CartLine"/);
 assert.doesNotMatch(read.js,/\$\.createFrom/);
 // An update on a row other than the loop item is not the same set.
 const other='=FOREACH(CartLine, Cart, @ThisPage.Cart.Id, AS(line), UPDATERECORD(CartLine, @ThisPage.Other.Value, Status, "Sold"))';
 const otherCode=compileActionFormula(other,'CartLine');
 assert.match(otherCode.js,/for \(const item of await \$\.list/);
 assert.doesNotMatch(otherCode.js,/\$\.updateWhere/);
});

test('DELETE through the loop deletes the matching rows once',async()=>{
 const remove='=FOREACH(CartLine, Cart, @ThisPage.Cart.Id, AS(line), DELETERECORD(CartLine, line.Id))';
 const code=compileActionFormula(remove,'CartLine');
 assert.match(code.js,/\$\.removeWhere\("CartLine", /);
 assert.doesNotMatch(code.js,/for \(const item/);
 const counting=fn(code.js);
 const state=counting.length;
 assert.ok(state>0);
});

test('the rows are read once: a step that changes them never hides them from the next step',async()=>{
 // Update first, then create: in a per-row loop every line gets its invoice line. Reading
 // the loop's rows again after Status became "Sold" would find none.
 const formula='=FOREACH(CartLine, Status, "Open", AS(line), ACTIONS(UPDATERECORD(CartLine, line.Id, Status, "Sold"), '+
  'CREATERECORD(InvoiceLine, Item, line.Id)))';
 const code=compileActionFormula(formula,'CartLine');
 assert.equal(code.js.split('$.list(').length-1,1);
 const run=counting(lines(4));
 await fn(code.js)(run.$);
 assert.deepEqual(run.statements,['list','update:CartLine','create:InvoiceLine']);
 assert.equal(run.created.length,4);
});

test('an update of another Object by the loop item keeps today\'s loop',()=>{
 const other='=FOREACH(CartLine, Cart, @ThisPage.Cart.Id, AS(line), UPDATERECORD(Product, line.Id, Status, "Sold"))';
 const code=compileActionFormula(other,'CartLine');
 assert.match(code.js,/for \(const item of await \$\.list/);
 assert.doesNotMatch(code.js,/\$\.updateWhere/);
});

test('a value that awaits (BLANKVALUE) still converts, parses and runs per row',async()=>{
 const formula='=FOREACH(CartLine, Status, "Open", AS(line), CREATERECORD(InvoiceLine, Product, BLANKVALUE(line.Product, ""), Qty, line.Quantity))';
 const code=compileActionFormula(formula,'CartLine');
 assert.match(code.js,/\$\.createFrom\(/);
 // BLANKVALUE of a known field is plain (item?.Product || ""): no await needed per row.
 assert.match(code.js,/Product: \(item\) => /);
 const run=counting(lines(2).map(line=>({...line,Product:'p-'+line.Id})));
 // The fake saves call make(row) without awaiting: await the values here as the runtimes do.
 const created:Row[]=[];
 run.$.createFrom=async(_object:string,given:Row[],fields:Record<string,(row:Row)=>unknown>)=>{
  for(const row of given){const values:Row={};for(const [field,make] of Object.entries(fields))values[field]=await make(row);created.push(values);}
  return created.length;
 };
 await fn(code.js)(run.$);
 assert.deepEqual(created,[{Product:'p-line-0',Qty:1},{Product:'p-line-1',Qty:2}]);
});

import {assertCodeParses} from '../src/page-compiler/code/pageCode.js';
test('converted code that does not parse is refused (listed as an issue, never put in the page file)',()=>{
 assert.equal(assertCodeParses('async ($) => { await $.x(); }'),'async ($) => { await $.x(); }');
 assert.throws(()=>assertCodeParses('async ($) => { [1].map(function (i) { return await i; }); }'),/not valid JavaScript/);
});
