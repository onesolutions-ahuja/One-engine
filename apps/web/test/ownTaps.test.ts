import test from 'node:test';
import assert from 'node:assert/strict';
import {drawOwnTap,newTapLedger,type PageLiveTarget} from '../src/core/pages/PageCompiler/pageLiveWiring.ts';

// The tapping screen itself (a till, a kiosk, any app): fast taps are answered one by one,
// and each answer is the saved state up to its own tap. The list must never step back.
type Change={objectApiName:string;operation:'create'|'update'|'delete';record:Record<string,unknown>};
const provisional=(batch:string,n=1)=>'ffffffff-ffff-4fff-8fff-'+batch+String(n).padStart(4,'0');

/** A list on screen fed by data.saved, like the real data layer for an exact list. */
function screen(start:Array<Record<string,unknown>>){
 const rows=new Map(start.map(row=>[String(row.Id),row]));
 const shown:number[]=[];
 const target:PageLiveTarget={apiName:'till',pageSessionKey:'S',dataSources:[],
  data:{saved:async(detail:{recordChanges?:Change[];replacesOptimistic?:string})=>{
   if(detail.replacesOptimistic)for(const id of [...rows.keys()])if(id.startsWith(provisional(detail.replacesOptimistic).slice(0,-4)))rows.delete(id);
   for(const change of detail.recordChanges??[]){
    const id=String(change.record.Id);
    if(change.operation==='delete')rows.delete(id);
    else rows.set(id,{...rows.get(id),...change.record});
   }
   shown.push([...rows.values()].reduce((sum,row)=>sum+Number(row.Quantity??0),0));
  },live:async()=>undefined,reload:async()=>undefined} as never};
 return {target,shown,rows};
}
const line=(id:string,quantity:number):Change=>({objectApiName:'CartLine',operation:'update',record:{Id:id,Quantity:quantity}});

test('4 fast taps on a line already in the cart: the till shows 5, 6, 7, 8 and never 5 again',async()=>{
 const {target,shown}=screen([{Id:'line-1',Quantity:4}]);
 const ledger=newTapLedger();
 const batches=['00000001','00000002','00000003','00000004'];
 for(const [index,batch] of batches.entries())await drawOwnTap(target,{changes:[line('line-1',5+index)],optimistic:batch},ledger);
 // Answers come one by one, each with the saved row up to its own tap.
 for(const [index,batch] of batches.entries())await drawOwnTap(target,{changes:[line('line-1',5+index)],replaces:batch},ledger);
 assert.deepEqual(shown.filter((value,index)=>index===0||value!==shown[index-1]),[5,6,7,8]);
});

test('4 fast taps on a NEW line: one swap from provisional to saved, never stepping back',async()=>{
 const {target,shown,rows}=screen([]);
 const ledger=newTapLedger();
 const first='0000000a',p=provisional(first);
 await drawOwnTap(target,{changes:[{objectApiName:'CartLine',operation:'create',record:{Id:p,Quantity:1}}],optimistic:first},ledger);
 await drawOwnTap(target,{changes:[line(p,2)],optimistic:'0000000b'},ledger);
 await drawOwnTap(target,{changes:[line(p,3)],optimistic:'0000000c'},ledger);
 // Tap 1 is answered: the saved Id is new; the provisional row stays (taps 2 and 3 change it).
 await drawOwnTap(target,{changes:[{objectApiName:'CartLine',operation:'create',record:{Id:'saved-1',Quantity:1}}],replaces:first},ledger);
 // Tap 4 is predicted on the saved Id (the till's held rows know it now).
 await drawOwnTap(target,{changes:[line('saved-1',4)],optimistic:'0000000d'},ledger);
 await drawOwnTap(target,{changes:[line('saved-1',2)],replaces:'0000000b'},ledger);
 await drawOwnTap(target,{changes:[line('saved-1',3)],replaces:'0000000c'},ledger);
 await drawOwnTap(target,{changes:[line('saved-1',4)],replaces:'0000000d'},ledger);
 assert.deepEqual(shown.filter((value,index)=>index===0||value!==shown[index-1]),[1,2,3,4]);
 assert.deepEqual([...rows.keys()],['saved-1'],'only the saved row is left');
});

test('a tap the till could not predict is drawn when answered, after waiting taps',async()=>{
 const {target,shown}=screen([{Id:'line-1',Quantity:1}]);
 const ledger=newTapLedger();
 await drawOwnTap(target,{changes:[line('line-1',2)],optimistic:'00000011'},ledger);
 // An older unpredicted answer naming the same row does not draw over the prediction.
 await drawOwnTap(target,{changes:[line('line-1',1)]},ledger);
 await drawOwnTap(target,{changes:[line('line-1',2)],replaces:'00000011'},ledger);
 assert.deepEqual(shown.filter((value,index)=>index===0||value!==shown[index-1]),[2]);
});
