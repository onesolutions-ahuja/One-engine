import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordBatcher} from '../src/core/authentication/Client/recordBatch.ts';

test('reads made together go as one request, answered in order; a lone read is a plain GET',async()=>{
 const calls:string[]=[];
 const read=createRecordBatcher(async(path,init)=>{
  calls.push(path);
  if(path==='/records-batch'){
   const {reads}=JSON.parse(String(init?.body)) as {reads:Array<{object:string;query:string}>};
   return {answers:reads.map(item=>item.object==='Bad'?{ok:false,error:'Permission denied'}:{ok:true,data:{records:[item.object],total:1}})} as never;
  }
  return {records:['alone'],total:1} as never;
 });
 const [a,b,c]=await Promise.allSettled([read('Product','limit=50'),read('CartLine','limit=50'),read('Bad','limit=1')]);
 assert.deepEqual(calls,['/records-batch']);
 assert.deepEqual((a as PromiseFulfilledResult<unknown>).value,{records:['Product'],total:1});
 assert.deepEqual((b as PromiseFulfilledResult<unknown>).value,{records:['CartLine'],total:1});
 assert.equal((c as PromiseRejectedResult).reason.message,'Permission denied','one failed read fails alone');
 calls.length=0;
 assert.deepEqual(await read('Product','limit=5'),{records:['alone'],total:1});
 assert.deepEqual(calls,['/records/Product?limit=5']);
});

test('if the batch request fails as a whole, each read is sent on its own',async()=>{
 const calls:string[]=[];
 const read=createRecordBatcher(async path=>{calls.push(path);if(path==='/records-batch')throw Error('404');return {records:[path]} as never;});
 const answers=await Promise.all([read('A','x=1'),read('B','x=2')]);
 assert.deepEqual(calls,['/records-batch','/records/A?x=1','/records/B?x=2']);
 assert.deepEqual(answers,[{records:['/records/A?x=1']},{records:['/records/B?x=2']}]);
});
