import test from 'node:test';
import assert from 'node:assert/strict';
import {referencedMentionPaths,resolveCollectionMentionRows} from
 '../src/component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';

const objects=[
 {apiName:'CartLine',label:'Cart line',fields:[
  {apiName:'ProductId',dataType:'Lookup',relationship:{relationshipName:'Product',targetObject:'Product'}},
  {apiName:'Quantity',dataType:'Number'}]},
 {apiName:'Product',label:'Product',fields:[
  {apiName:'Name',dataType:'Text'},
  {apiName:'ImageUrl',dataType:'Url'}]}
] as never;

test('short related Product fields load for every CartLine while preserving their authored keys',async()=>{
 const bindings={imageSource:'@Product.ImageUrl',textSource:'@Product.Name',
  rowSupportingSource:'@CartLine.Product.Name'};
 const paths=referencedMentionPaths(bindings,objects,'CartLine');
 assert.equal(paths.length,3,'different fields/references may share the same lookup');
 let calls=0;
 const rows=await resolveCollectionMentionRows(objects,'CartLine',[
  {Id:'line-1',ProductId:'product-1',Quantity:1},
  {Id:'line-2',ProductId:'product-2',Quantity:1}
 ],bindings,async (_object,id)=>({Id:id,Name:id,ImageUrl:id+'.jpg'}),
 async (_object,ids)=>{calls++;return ids.map(id=>({Id:id,Name:id,ImageUrl:id+'.jpg'}));});
 assert.equal(calls,1,'one authorised batch per parent Object');
 assert.deepEqual(rows.map(row=>(row.__mentionValues as Record<string,unknown>)['@Product.ImageUrl']),
  ['product-1.jpg','product-2.jpg']);
 assert.deepEqual(rows.map(row=>(row.__mentionValues as Record<string,unknown>)['@Product.Name']),
  ['product-1','product-2']);
 assert.equal((rows[0].__mentionValues as Record<string,unknown>)['@CartLine.Product.Name'],'product-1');
});
test('short Product reference refuses ambiguous CartLine parent relationships',()=>{
 const ambiguous=[
  {apiName:'CartLine',label:'Cart line',fields:[
   {apiName:'ProductId',dataType:'Lookup',relationship:{relationshipName:'Product',targetObject:'Product'}},
   {apiName:'GiftProductId',dataType:'Lookup',relationship:{relationshipName:'Gift',targetObject:'Product'}}]},
  {apiName:'Product',label:'Product',fields:[{apiName:'ImageUrl',dataType:'Url'}]}
 ] as never;
 assert.deepEqual(referencedMentionPaths({imageSource:'@Product.ImageUrl'},ambiguous,'CartLine'),[]);
});
