import test from 'node:test';
import assert from 'node:assert/strict';
import {ScreenPairingService} from '../../server/src/system-support/screen-pairing-service.js';
import {followMirroredSale,setFollowingSale} from '../src/core/pages/PageCompiler/mirrorLiveRefresh';

const user={tenant_id:'test-tenant',user_id:'authorised-user'};
const id='11111111-1111-4111-8111-111111111111';
const device='pos-terminal-device-test-001';

test('paid display accepts only a server-recorded Paid Invoice, not a claimed payment',async()=>{
 const queries:Array<{sql:string;args:unknown[]}>=[]; 
 const db={query:async(sql:string,args:unknown[] = [])=>{
  queries.push({sql,args});
  // Simulate a device whose live Cart is already on layer 1.
  if(sql.includes('UPDATE md_screen_devices')&&sql.includes('RETURNING COALESCE'))
   return {rows:[{layer:1}]};
  return {rows:[]};
 }};
 const service=new ScreenPairingService(db as never,{} as never);
 await assert.rejects(()=>service.showPaidInvoice(user,device,{Id:id,Total:15,Status:'PartPaid'}),/completed invoice/i);
 const receipt=await service.showPaidInvoice(user,device,{
  Id:id,Total:15,Status:'Paid',PaymentMethod:'Cash'
 });
 assert.deepEqual(receipt,{invoiceId:id,amount:15,method:'Cash',change:null});
 assert.equal(queries.filter(query=>/INSERT INTO md_screen_devices/i.test(query.sql)).length,1);
 assert.match(queries.at(-1)!.sql,/smart_till_customer_display/);
 assert.match(queries.at(-1)!.sql,/jsonb_build_object\('smart_till_customer_display',9\)/);
 assert.match(queries.at(-1)!.sql,/returnLayer/);
 assert.match(String(queries.at(-1)!.args[2]),/"amount":15/);
 await service.reportSession(user,device,id);
 assert.match(queries.at(-1)!.sql,/payment_confirmation->>'returnLayer'/);
 assert.match(queries.at(-1)!.sql,/ELSE md_screen_devices.page_layers END/);
 await service.showLayer(user,device,'smart_till_customer_display',1);
 assert.ok(queries.some(query=>query.sql.includes("AND $4::int<>9")),
  'Switching back to Cart must clear stale payment receipt');
 const restored=await service.restoreSaleLayer(user,device);
 assert.equal(restored.layer,1,'Resume must keep the authored Cart layer instead of returning to blank layer 0');
 assert.match(queries.at(-1)!.sql,/payment_confirmation->>'returnLayer'/);
 assert.match(queries.at(-1)!.sql,/layer_revision=layer_revision\+1/);
 assert.ok(!/jsonb_build_object\('smart_till_customer_display',0\)/.test(queries.at(-1)!.sql),
  'A Resume must not force an authored layer-1 Cart to layer zero');
});
test('customer display restores new session, then applies verified payment values and layer',async()=>{
 setFollowingSale(false);
 let session='old',reset=false;const calls:string[]=[];
 await followMirroredSale({
  mirrorKey:device,openedWithSession:false,
  request:(async()=>({sessionId:'new',layers:{smart_till_customer_display:1},layerRevision:2,
   payment:{amount:15,method:'Cash',change:null,invoiceId:id}})) as never,
  sessionId:()=>session,
  resetSession:next=>{reset=true;session=next??'';calls.push('reset');},
  onLayers:(layers,revision)=>{calls.push('layer:'+layers.smart_till_customer_display+':'+revision);},
  onPayment:payment=>{calls.push('payment:'+payment?.amount);}
 });
 assert.equal(reset,true);
 assert.deepEqual(calls,['reset','layer:1:2','payment:15']);
});
