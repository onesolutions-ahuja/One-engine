import test from 'node:test';
import assert from 'node:assert/strict';
import {setSqlFormulaRequest,getSqlFormulaRequest} from './SqlFormulaRequest.js';

const post=(formula,extra={})=>['/formulas/evaluate',{method:'POST',
 body:JSON.stringify({formula,objectApi:'CartLine',state:{SqlInput0:'s1'},...extra})}];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function install(handler){
 const calls=[];
 setSqlFormulaRequest(async(path,init)=>{
  const body=init?.body?JSON.parse(init.body):null;
  calls.push({path,body});
  return handler(path,body);
 });
 return {calls,request:getSqlFormulaRequest()};
}
const manyOk=(path,body)=>{
 assert.equal(path,'/formulas/evaluate-many');
 return {results:body.items.map(item=>item.recordIds
   ?{value:Object.fromEntries(item.recordIds.map(id=>[id,'v:'+item.formula]))}
   :{value:'v:'+item.formula})};
};

test('50 different formulas leave as ONE request',async()=>{
 const {calls,request}=install(manyOk);
 const values=await Promise.all(Array.from({length:50},(_,i)=>request(...post('F'+i))));
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.items.length,50);
 assert.deepEqual(values.map(v=>v.value),Array.from({length:50},(_,i)=>'v:F'+i));
});

test('identical asks from many components share one item',async()=>{
 const {calls,request}=install(manyOk);
 const values=await Promise.all(Array.from({length:30},()=>request(...post('SAME'))));
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.items.length,1);
 assert.ok(values.every(v=>v.value==='v:SAME'));
});

test('same formula for 97 records becomes one batch item',async()=>{
 const {calls,request}=install(manyOk);
 const ids=Array.from({length:97},(_,i)=>'id'+i);
 const values=await Promise.all(ids.map(id=>request(...post('ROWF',{recordId:id}))));
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.items.length,1);
 assert.equal(calls[0].body.items[0].recordIds.length,97);
 assert.ok(values.every(v=>v.value==='v:ROWF'));
});

test('one failing item does not fail the others',async()=>{
 const {request}=install((p,b)=>({results:b.items.map(item=>item.formula==='BAD'
  ?{error:'Invalid Formula request'}:{value:'ok'})}));
 const results=await Promise.allSettled([request(...post('GOOD')),request(...post('BAD'))]);
 assert.equal(results[0].status,'fulfilled');
 assert.equal(results[0].value.value,'ok');
 assert.equal(results[1].status,'rejected');
 assert.match(results[1].reason.message,/Invalid Formula/);
});

test('a refused batch is retried per record in ONE more request, not one per record',async()=>{
 const {calls,request}=install((p,b)=>({results:b.items.map(item=>item.recordIds
  ?{error:'Unsupported Batch Formula: x'}:{value:'single:'+item.recordId})}));
 const ids=['a','b','c','d'];
 const values=await Promise.all(ids.map(id=>request(...post('ROWF',{recordId:id}))));
 assert.deepEqual(values.map(v=>v.value),ids.map(id=>'single:'+id));
 assert.equal(calls.length,2);
 assert.equal(calls[1].body.items.length,4);
});

test('a record missing from the batch answer is rejected as unavailable',async()=>{
 const {request}=install((p,b)=>({results:[{value:{a:'1'}}]}));
 const [a,b]=await Promise.allSettled([request(...post('F',{recordId:'a'})),request(...post('F',{recordId:'b'}))]);
 assert.equal(a.value.value,'1');
 assert.equal(b.status,'rejected');
});

test('when evaluate-many is unavailable the original path still answers',async()=>{
 const {calls,request}=install((path,body)=>{
  if(path==='/formulas/evaluate-many')throw Error('Not Found');
  assert.equal(path,'/formulas/evaluate');
  return {value:'legacy:'+body.formula};
 });
 const value=await request(...post('F1'));
 assert.equal(value.value,'legacy:F1');
 assert.equal(calls[0].path,'/formulas/evaluate-many');
 assert.equal(calls[1].path,'/formulas/evaluate');
});

test('after repeated endpoint failures it stops trying evaluate-many',async()=>{
 const {calls,request}=install((path,body)=>{
  if(path==='/formulas/evaluate-many')throw Error('Not Found');
  return {value:'legacy'};
 });
 await request(...post('A'));await wait(15);
 await request(...post('B'));await wait(15);
 const before=calls.filter(c=>c.path==='/formulas/evaluate-many').length;
 await request(...post('C'));
 assert.equal(before,2);
 assert.equal(calls.filter(c=>c.path==='/formulas/evaluate-many').length,2);
});

test('non-formula requests pass through untouched',async()=>{
 const {calls,request}=install(()=>({ok:true}));
 await request('/records/Product?limit=1');
 assert.equal(calls[0].path,'/records/Product?limit=1');
});
