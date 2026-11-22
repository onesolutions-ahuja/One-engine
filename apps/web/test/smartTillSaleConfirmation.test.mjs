import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationPage,customerDraft,validateVisualDraft,
 POPUP,CUSTOMER,PAID_LAYER} from '../../../scripts/smarttill/migrate-sale-confirmation.mjs';

test('confirmation popup is one editable In-Screen Page with its Done action',()=>{
 for(const variant of ['Desktop','Tablet','Mobile','Custom']){
  const popup=confirmationPage(variant);
  assert.equal(popup.apiName,POPUP);
  assert.equal(popup.pageType,'In-Screen Page');
  assert.equal(popup.canvasHeight>=320,true);
  assert.ok(popup.components.every(c=>
   c.position.x>=0&&c.position.y>=0&&
   c.position.x+c.position.width<=popup.canvasWidth&&
   c.position.y+c.position.height<=popup.canvasHeight),
   variant+' popup components must fit their authored device canvas');
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
   properties:{textSource:'@CartLine.Name',pageLayer:1},region:'main',visible:true}]};
 const first=customerDraft(existing,'Desktop');
 assert.equal(first.changed,true);
 validateVisualDraft(existing,first.draft);
 assert.equal(first.draft.components[0],existing.components[0]);
 assert.equal(first.draft.components.slice(1).every(c=>c.properties.pageLayer===PAID_LAYER),true);
 assert.deepEqual(customerDraft(first.draft,'Desktop').added,[]);
 assert.equal(customerDraft(first.draft,'Desktop').changed,false);
});

test('customer receipt shows paid amount, method and optional change without cropping short canvases',()=>{
 for(const [width,height] of [[320,320],[360,480],[620,320],[1440,900],[1920,1080]]){
  const existing={apiName:CUSTOMER,layoutMode:'free-canvas',canvasWidth:width,canvasHeight:height,components:[]};
  const {draft}=customerDraft(existing,'Desktop');
  assert.equal(draft.components.length,6);
  const sources=draft.components.map(c=>String(c.properties.textSource??''));
  assert.ok(sources.some(source=>source.includes('@ThisPage.Input.paymentAmount')));
  assert.ok(sources.some(source=>source.includes('@ThisPage.Input.paymentMethod')));
  assert.ok(sources.some(source=>source.includes('@ThisPage.Input.changeAmount')));
  for(const c of draft.components){
   assert.equal(c.properties.pageLayer,PAID_LAYER);
   assert.ok(c.position.x>=0&&c.position.y>=0,c.id+' starts off canvas '+width+'x'+height);
   assert.ok(c.position.x+c.position.width<=width,c.id+' exceeds width '+width);
   assert.ok(c.position.y+c.position.height<=height,c.id+' exceeds height '+height);
  }
 }
});

test('receipt layer cannot overwrite the already-designed customer cart or another layer 9 screen',()=>{
 const page={apiName:CUSTOMER,layoutMode:'free-canvas',canvasWidth:1440,canvasHeight:900,
  components:[{id:'customer-cart',type:'Custom:smart_cart',properties:{pageLayer:1}}]};
 const result=customerDraft(page,'Desktop');
 assert.equal(result.draft.components[0],page.components[0]);
 assert.equal(result.draft.components.slice(1).every(c=>c.properties.pageLayer===9),true);
 const occupied={...page,components:[...page.components,
  {id:'some-other-screen',type:'Custom:smart_image',properties:{pageLayer:9}}]};
 assert.throws(()=>customerDraft(occupied,'Desktop'),/Layer 9 is already used/);
});

test('mobile popup has its own authored dimensions rather than inherited Desktop coordinates',()=>{
 const desktop=confirmationPage('Desktop'),mobile=confirmationPage('Mobile');
 assert.notEqual(desktop.canvasWidth,mobile.canvasWidth);
 assert.notEqual(desktop.canvasHeight,mobile.canvasHeight);
 assert.notDeepEqual(desktop.components[0].position,mobile.components[0].position);
});
