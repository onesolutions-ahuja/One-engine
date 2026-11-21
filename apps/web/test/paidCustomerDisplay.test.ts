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
  return {rows:[]};
 }};
 const service=new ScreenPairingService(db as never,{} as never);
 await assert.rejects(()=>service.showPaidInvoice(user,device,{Id:id,Total:15,Status:'PartPaid'}),/completed invoice/i);
 await assert.rejects(()=>service.showPaidInvoice(user,device,{Id:id,Total:15,Status:'Paid',ChangeAmount:'NaN'}),/Invalid/).catch(()=>{});
 const receipt=await service.showPaidInvoice(user,device,{
  Id:id,Total:15,Status:'Paid',PaymentMethod:'Cash'
 });
 assert.deepEqual(receipt,{invoiceId:id,amount:15,method:'Cash',change:null});
 assert.equal(queries.filter(query=>/INSERT INTO md_screen_devices/i.test(query.sql)).length,1);
 assert.match(queries.at(-1)!.sql,/smart_till_customer_display/);
 assert.match(String(queries.at(-1)!.args[2]),/"amount":15/);
});
test('customer display restores new session, then applies verified payment values and layer',async()=>{
 setFollowingSale(false);
 let session='old',reset=false;const calls:string[]=[];
 await followMirroredSale({
  mirrorKey:device,openedWithSession:false,
  request:(async()=>({sessionId:'new',layers:{smart_till_customer_display:1},
   payment:{amount:15,method:'Cash',change:null,invoiceId:id}})) as never,
  sessionId:()=>session,
  resetSession:next=>{reset=true;session=next??'';calls.push('reset');},
  onLayers:layers=>{calls.push('layer:'+layers.smart_till_customer_display);},
  onPayment:payment=>{calls.push('payment:'+payment?.amount);}
 });
 assert.equal(reset,true);
 assert.deepEqual(calls,['reset','layer:1','payment:15']);
});
