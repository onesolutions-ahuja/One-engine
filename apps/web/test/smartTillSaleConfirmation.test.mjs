import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationPage,customerDraft,validateVisualDraft,
 POPUP,CUSTOMER} from '../../../scripts/smarttill/migrate-sale-confirmation.mjs';

test('confirmation popup is one editable In-Screen Page with its Done action',()=>{
 for(const variant of ['Desktop','Tablet','Mobile','Custom']){
  const popup=confirmationPage(variant);
  assert.equal(popup.apiName,POPUP);
  assert.equal(popup.pageType,'In-Screen Page');
  assert.equal(popup.canvasHeight>=320,true);
  assert.equal(popup.components.every(c=>c.properties.libraryComponentId),true);
  assert.deepEqual(popup.components.filter(c=>c.properties.actionFlows)
   .map(c=>c.properties.actionFlows.click.formula),['=CLOSESCREEN()']);
  assert.equal(popup.components.some(c=>String(c.properties.textSource??'')
   .includes('@ThisPage.Input.paymentAmount')),true);
 }
});
test('customer display layer is independent, defaults to hidden, and idempotent',()=>{
 const existing={apiName:CUSTOMER,layoutMode:'free-canvas',canvasWidth:1440,canvasHeight:900,
  components:[{id:'normal-cart',type:'Custom:smart_cart',label:'Cart',
   properties:{textSource:'@CartLine.Name'},region:'main',visible:true}]};
 const first=customerDraft(existing,'Desktop');
 assert.equal(first.changed,true);
 validateVisualDraft(existing,first.draft);
 assert.equal(first.draft.components[0],existing.components[0]);
 assert.equal(first.draft.components.slice(1).every(c=>c.properties.pageLayer===1),true);
 assert.deepEqual(customerDraft(first.draft,'Desktop').added,[]);
 assert.equal(customerDraft(first.draft,'Desktop').changed,false);
});
