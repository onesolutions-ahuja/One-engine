import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';

// A scoped, versioned Page Builder metadata update. Reuses the existing
// Acetill Flow, shared Smart Card Grid and generic Action/Flow runtime.
// Never edits Acetill or the saved CODEXTILL layout outside the click binding.
const VERSION='codextill-product-card-click-20261101-v1';
export const CARD_CLICK={
 actionType:'Flow',flowType:'Autolaunched Flow',
 flowApiName:'AcetillCopilotAddProduct',
 inputs:{sessionKey:'$session',cartId:'$session.cartId',productId:'$event.recordId'},
 outputs:{cartId:'activeCartId',cartItems:'cartItems',
  subtotal:'subtotal',total:'total'}
};
const checksum=createHash('sha256').update(JSON.stringify(CARD_CLICK)).digest('hex');
if(process.argv.includes('--preflight')){
 assert.equal(CARD_CLICK.inputs.productId,'$event.recordId');
 assert.equal(CARD_CLICK.flowApiName,'AcetillCopilotAddProduct');
 assert.equal(CARD_CLICK.outputs.cartItems,'cartItems');
 console.log('CODEXTILL product card click metadata validated (no persistence).');
 process.exit(0);
}
if(!process.env.DATABASE_URL)throw Error('Production DATABASE_URL is required');
if(typeof process.getuid==='function'&&process.getuid()===0){
 process.initgroups('metadrive','metadrive');
 process.setgid('metadrive');
 process.setuid('metadrive');
}
if(typeof process.getuid==='function'&&process.getuid()===0)
 throw Error('Refusing root SQL connection');
const db=new SqlPersistence(process.env.DATABASE_URL);
try{
 const found=await db.query(`SELECT p.tenant_id FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
   WHERE p.api_name='CODEXTILL' AND p.enabled=true
   AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages a WHERE a.tenant_id=p.tenant_id AND a.page_id=p.id)`);
 assert.equal(found.rows.length,1,'Expected exactly one editable CODEXTILL Page');
 const tenant=found.rows[0].tenant_id;
 const flow=await db.query(`SELECT active,flow_type FROM md_flow_definitions
   WHERE tenant_id=$1 AND api_name=$2 AND archived=false
   ORDER BY version DESC LIMIT 1`,[tenant,CARD_CLICK.flowApiName]);
 assert.equal(flow.rows[0]?.active,true,'Existing AddProduct Flow must be active');
 assert.equal(flow.rows[0]?.flow_type,'Autolaunched Flow','Expected active Autolaunched Flow');
 const receipt=await db.query('SELECT checksum FROM md_system_migrations WHERE version=$1',[VERSION]);
 if(receipt.rows.length){
  assert.equal(receipt.rows[0].checksum,checksum,'Unexpected change to applied binding');
  console.log('CODEXTILL product card binding already applied; preserving later user changes.');
 }else{
  const runtime=new PageRuntime(db);
  const before=await runtime.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(before.layoutMode,'free-canvas');
  const grid=before.components.find(c=>c.id==='codextill-product-grid');
  assert(grid&&grid.type==='Custom:smart_card_grid','Expected existing Smart Card Grid');
  assert.equal(grid.properties?.objectApiName,'Product','Product binding must be preserved');
  const existing=grid.properties.actionFlows;
  assert(!existing?.click||JSON.stringify(existing.click)===JSON.stringify(CARD_CLICK),
   'Product Grid click already customised; refusing to override user action');
  const next=before.components.map(c=>c.id!==grid.id?c:{
   ...c,properties:{...c.properties,
    actionFlows:{...(c.properties.actionFlows||{}),click:CARD_CLICK}}
  });
  await runtime.saveLayoutDraft(tenant,'CODEXTILL','Desktop',{...before,components:next});
  const saved=await runtime.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(saved.components.length,before.components.length);
  assert.equal(saved.layoutMode,before.layoutMode);
  assert.equal(saved.canvasWidth,before.canvasWidth);
  assert.equal(saved.canvasHeight,before.canvasHeight);
  const after=new Map(saved.components.map(c=>[c.id,c]));
  for(const original of before.components){
   const current=after.get(original.id);
   assert(current,'Missing '+original.id);
   if(original.id!==grid.id){
    assert.deepEqual(current,original,'Unrelated component changed');
    continue;
   }
   assert.deepEqual(current.position,original.position,'Product grid geometry changed');
   assert.deepEqual(current.properties?.actionFlows?.click,CARD_CLICK);
   for(const [key,value] of Object.entries(original.properties||{})){
    if(key==='actionFlows'){
     for(const [event,action] of Object.entries(value||{}))
      if(event!=='click')assert.deepEqual(current.properties.actionFlows[event],action);
    }else assert.deepEqual(current.properties[key],value,'Changed authored property '+key);
   }
  }
  await db.query(`INSERT INTO md_system_migrations(version,checksum)
    VALUES($1,$2) ON CONFLICT(version) DO NOTHING`,[VERSION,checksum]);
  console.log('CODEXTILL Product Grid click bound to shared AcetillCopilotAddProduct Flow. All other page metadata preserved.');
 }
}finally{await db.pool.end();}
