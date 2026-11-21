import test from 'node:test';
import assert from 'node:assert/strict';
import {applySavedRecordMutations,movedSessionParent,type SessionParentFilter} from '../src/core/pages/PageRuntime/pageMutationScope.ts';

// Any app: child rows (cart lines, basket items) of the session's newest parent (cart).
const provisional=(batch:string,n=1)=>'ffffffff-ffff-4fff-8fff-'+batch+String(n).padStart(4,'0');
const oldCart:SessionParentFilter={field:'Cart',value:'cart-voided',related:true,parent:{object:'Cart',session:'s-1'}};
const newCart=(id:string,session='s-1')=>({objectApiName:'Cart',operation:'create' as const,record:{Id:id,SessionKey:session,Status:'Open'}});

test('a tap makes a new cart in this session: the line list moves to it, empty (first item of a new sale)',()=>{
 const p=provisional('0000aa01');
 assert.deepEqual(movedSessionParent(oldCart,{objectApiNames:['Cart'],recordChanges:[newCart(p)],optimistic:'0000aa01'}),{value:p,keepRows:false});
});
test('a new cart of ANOTHER session does not move the list',()=>{
 assert.equal(movedSessionParent(oldCart,{objectApiNames:['Cart'],recordChanges:[newCart('cart-x','s-2')]}),null);
});
test('the saved cart replaces the provisional one: the rows stay, the list takes the saved Id',()=>{
 const p=provisional('0000aa02');
 const moved=movedSessionParent({...oldCart,value:p},{objectApiNames:['Cart'],replacesOptimistic:'0000aa04',
  recordChanges:[{objectApiName:'Cart',operation:'delete',record:{Id:p}},newCart('cart-saved')]});
 assert.deepEqual(moved,{value:'cart-saved',keepRows:true});
});
test('a saved new cart seen without its prediction: the list moves to it, empty',()=>{
 assert.deepEqual(movedSessionParent(oldCart,{objectApiNames:['Cart'],recordChanges:[newCart('cart-saved')]}),{value:'cart-saved',keepRows:false});
});
test('a list waiting for its first parent moves to the first cart',()=>{
 assert.deepEqual(movedSessionParent({...oldCart,value:''},{objectApiNames:['Cart'],recordChanges:[newCart('cart-1')]}),{value:'cart-1',keepRows:false});
});
test('a list without a session parent (a page-state or record parent) never moves',()=>{
 assert.equal(movedSessionParent({field:'Cart',value:'cart-voided',related:true},{objectApiNames:['Cart'],recordChanges:[newCart('cart-1')]}),null);
});
test('after the move, the predicted first line is placed at once',()=>{
 const p=provisional('0000aa05');
 const moved=movedSessionParent(oldCart,{objectApiNames:['Cart'],recordChanges:[newCart(p)],optimistic:'0000aa05'})!;
 const line={objectApiName:'CartLine',operation:'create' as const,record:{Id:provisional('0000aa05',2),Cart:p,Quantity:1}};
 const patched=applySavedRecordMutations([],'CartLine',{objectApiNames:['CartLine'],recordChanges:[line],optimistic:'0000aa05'},
  {total:0,offset:0,pageSize:1,readObjectApiNames:['CartLine'],relatedFilter:{...oldCart,value:moved.value}});
 assert.deepEqual(patched?.records.map(row=>row.Quantity),[1]);
});
