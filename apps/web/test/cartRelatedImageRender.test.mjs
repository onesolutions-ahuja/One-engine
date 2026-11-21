import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SmartCartRuntime from '../src/component-libraries/smart_cart/SmartComponent.jsx';

globalThis.React=React;

test('published cart renders authorised related Product image and name for each separate row',()=>{
 const records=[
  {Id:'line-a',ProductId:'product-a',Quantity:1,__mentionValues:{
   '@Product.ImageUrl':'https://img.example.test/a.webp','@Product.Name':'Coffee A'}},
  {Id:'line-b',ProductId:'product-b',Quantity:2,__mentionValues:{
   '@Product.ImageUrl':'https://img.example.test/b.webp','@Product.Name':'Coffee B'}}
 ];
 const html=renderToStaticMarkup(React.createElement(SmartCartRuntime,{
  kind:'smart_cart',records,objectApiName:'CartLine',imageSource:'@Product.ImageUrl',
  textSource:'@Product.Name',column3Source:'@CartLine.Quantity',
  summaryVisible:false,loading:false,
  cartColumn1Visible:true,cartColumn2Visible:false,cartColumn3Visible:true,
  cartColumn4Visible:false,cartColumn5Visible:false
 }));
 assert.match(html,/Coffee A/);
 assert.match(html,/Coffee B/);
 assert.match(html,/img\.example\.test\/a\.webp/);
 assert.match(html,/img\.example\.test\/b\.webp/);
});
