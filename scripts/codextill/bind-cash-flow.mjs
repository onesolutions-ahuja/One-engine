import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';
/* Dedicated CODEXTILL page metadata ONLY. Existing Acetill cash Flow is reused,
   not changed; payment records are never created by this script. */
const RECEIPT='codextill-bind-exact-cash-flow-20261101-v1';
export const cash={
 actionType:'Flow',flowType:'Autolaunched Flow',flowApiName:'AcetillPaymentCash',
 inputs:{
  cartItems:{source:'ProjectRecords',value:'$state.cartItems',fields:['Product','Quantity']},
  cartTotal:{source:'ToNumber',value:'$state.total'},
  cartId:'$session.cartId',
  requestId:'$session.cartId',
  cashReceived:{source:'ToNumber',value:'$state.total'}
 },
 inputRules:{requestId:'NonEmpty'},
 outputs:{status:'checkoutStatus',invoiceId:'invoiceId',total:'checkoutTotal'},
 resetSessionOnSuccess:true,mutatesData:true,
 successState:{activeCartId:null,subtotal:0,total:0}
};
assert.equal(cash.inputs.cashReceived.value,'$state.total','Cash tender must equal displayed total');
assert.equal(cash.inputs.requestId,'$session.cartId','Must use idempotent session key');
assert(cash.resetSessionOnSuccess);
const checksum=createHash('sha256').update(JSON.stringify(cash)).digest('hex');
if(process.argv.includes('--preflight')){
 console.log('CODEXTILL cash binding preflight passed: exact cash, Invoice/InvoiceLine Flow, idempotent request, Card untouched');
 process.exit(0);
}
if(!process.env.DATABASE_URL)throw Error('Production SQL configuration unavailable');
if(typeof process.getuid==='function'&&process.getuid()===0){
 process.initgroups('metadrive','metadrive');process.setgid('metadrive');process.setuid('metadrive');
}
if(typeof process.getuid==='function'&&process.getuid()===0)throw Error('Refusing privileged SQL connection');
const db=new SqlPersistence(process.env.DATABASE_URL);
try{
 const pages=await db.query(`SELECT p.tenant_id FROM md_page_definitions p
 JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
 WHERE p.api_name='CODEXTILL' AND p.enabled=true
 AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages s
 WHERE s.tenant_id=p.tenant_id AND s.page_id=p.id)`);
 assert.equal(pages.rows.length,1,'CODEXTILL page not uniquely editable');
 const tenant=pages.rows[0].tenant_id;
 const flows=await db.query(`SELECT api_name,flow_type,active,archived FROM md_flow_definitions
 WHERE tenant_id=$1 AND api_name='AcetillPaymentCash' ORDER BY version DESC LIMIT 1`,[tenant]);
 assert.equal(flows.rows.length,1,'Cash Flow not installed');
 assert.equal(flows.rows[0].active,true,'Cash Flow inactive');
 assert.equal(flows.rows[0].archived,false,'Cash Flow archived');
 assert.equal(flows.rows[0].flow_type,'Autolaunched Flow','Cash Flow type mismatch');
 const objects=await db.query(`SELECT object_api,api_name FROM md_field_definitions
 WHERE tenant_id=$1 AND object_api IN ('Invoice','InvoiceLine','Product') AND deleted_at IS NULL`,[tenant]);
 const fields=new Set(objects.rows.map(r=>r.object_api+'.'+r.api_name));
 for(const name of ['Invoice.Total','Invoice.Status','InvoiceLine.Invoice','InvoiceLine.Product',
  'InvoiceLine.Quantity','InvoiceLine.UnitPrice','Product.Price','Product.Active'])
  assert(fields.has(name),'Cash Flow prerequisite field missing: '+name);
 const receipt=await db.query('SELECT checksum FROM md_system_migrations WHERE version=$1',[RECEIPT]);
 if(receipt.rows.length){
  assert.equal(receipt.rows[0].checksum,checksum,'Cash configuration checksum differs');
  console.log('CODEXTILL cash metadata previously applied; preserve subsequent edits');
 }else{
  const runtime=new PageRuntime(db);
  const before=await runtime.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(before.layoutMode,'free-canvas','CODEXTILL layout not movable');
  const original=new Map(before.components.map(c=>[c.id,c]));
  const cashButton=original.get('codextill-cash'),card=original.get('codextill-card'),
    cart=original.get('codextill-cart');
  assert.equal(cashButton?.type,'Custom:smart_button');
  assert.equal(card?.type,'Custom:smart_button');
  assert.equal(cart?.type,'Custom:smart_cart');
  assert.equal(cart.properties?.actionFlows?.start?.flowApiName,'AcetillCopilotReadCart',
   'Cash requires existing read Flow');
  assert(!card.properties?.actionFlows||Object.keys(card.properties.actionFlows).length===0,
   'Card button has existing action: not overwriting');
  assert(!cashButton.properties?.actionFlows?.click,'Cash button action already configured');
  const components=before.components.map(c=>c.id==='codextill-cash'?{
    ...c,properties:{...c.properties,actionFlows:{...(c.properties.actionFlows||{}),click:cash}}
   }:c);
  await runtime.saveLayoutDraft(tenant,'CODEXTILL','Desktop',{...before,components});
  const after=await runtime.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(after.components.length,before.components.length,'Component count changed');
  assert.equal(after.layoutMode,before.layoutMode,'Layout mode changed');
  assert.equal(after.canvasWidth,before.canvasWidth,'Canvas width changed');
  assert.equal(after.canvasHeight,before.canvasHeight,'Canvas height changed');
  for(const row of before.components){
   const saved=after.components.find(c=>c.id===row.id);
   assert(saved,'Missing '+row.id);
   if(row.id==='codextill-cash'){
    assert.deepEqual(saved.position,row.position,'Cash geometry changed');
    assert.deepEqual(saved.properties.actionFlows.click,cash,'Cash mapping not saved');
    for(const [key,value] of Object.entries(row.properties||{}))
     if(key!=='actionFlows')assert.deepEqual(saved.properties[key],value,'Cash style altered: '+key);
   }else assert.deepEqual(saved,row,'Unexpected modification '+row.id);
  }
  await db.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)
   ON CONFLICT(version) DO NOTHING`,[RECEIPT,checksum]);
  console.log('CODEXTILL CASH METADATA VERIFIED: exact-cash click bound to existing Invoice/InvoiceLine Flow; Card unassigned, geometry and other components preserved');
 }
}finally{await db.pool.end();}
