import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';

// Match Acetill's data model while staying inside CODEXTILL's existing Smart
// Component contracts. In particular, NEVER use a missing category state as a
// mandatory Product filter: PageRuntime correctly blocks missing filter inputs.
const RECEIPT='codextill-tab-and-cart-read-bindings-20261101-v1';
const cartRead={
 actionType:'Flow',flowType:'Autolaunched Flow',
 flowApiName:'AcetillCopilotReadCart',
 inputs:{cartId:'$session.cartId'},
 outputs:{
  cartId:'activeCartId',
  cartItems:'cartItems',
  subtotal:'subtotal',
  total:'total'
 }
};
const categoryChange={
 actionType:'PageState',stateKey:'categoryId',value:'$event.record.Id'
};
export const BINDINGS={
 'codextill-categories':{
  objectApiName:'MenuCategory',
  textSource:'@Name',
  actionFlows:{change:categoryChange}
 },
 'codextill-cart':{
  objectApiName:'CartLine',
  relatedFilterKey:'activeCartId',
  relatedFieldApiName:'Cart',
  textSource:'@Name',
  column2Source:'@UnitPrice',
  column3Source:'@Quantity',
  column4Source:'@LineTotal',
  column5Source:'@DiscountAmount',
  column3SourceType:'Number',
  subtotalValue:'$state.subtotal',
  totalValue:'$state.total',
  currencyCode:'GBP',
  actionFlows:{start:cartRead}
 }
};
const originalTypes={
 'codextill-categories':'Custom:smart_tabs',
 'codextill-cart':'Custom:smart_cart'
};
const expectedFields={
 MenuCategory:['Name'],
 CartLine:['Cart','Name','UnitPrice','Quantity','LineTotal','DiscountAmount']
};
const actionKeys=new Set(['start','change']);
for(const [id,props] of Object.entries(BINDINGS)){
 assert(id in originalTypes);
 assert(props.objectApiName);
 for(const key of Object.keys(props))assert(!['position','parentId','layoutParentId','width','height','x','y','canvasWidth','canvasHeight'].includes(key),'Forbidden geometry property '+key);
 for(const [event,action] of Object.entries(props.actionFlows||{})){
  assert(actionKeys.has(event));
  assert(['Flow','PageState'].includes(action.actionType));
 }
}
assert.equal(BINDINGS['codextill-categories'].actionFlows.change.value,'$event.record.Id');
assert.equal(BINDINGS['codextill-cart'].relatedFilterKey,'activeCartId');
assert.equal(BINDINGS['codextill-cart'].actionFlows.start.flowApiName,'AcetillCopilotReadCart');
const checksum=createHash('sha256').update(JSON.stringify(BINDINGS)).digest('hex');
if(process.argv.includes('--preflight')){
 console.info('CODEXTILL data-binding preflight passed: 2 components, category PageState + read-only cart Flow; Product Active filter preserved');
 process.exit(0);
}
if(!process.env.DATABASE_URL)throw Error('Configured production DATABASE_URL required');
if(typeof process.getuid==='function'&&process.getuid()===0){
 process.initgroups('metadrive','metadrive');
 process.setgid('metadrive');
 process.setuid('metadrive');
}
if(typeof process.getuid==='function'&&process.getuid()===0)throw Error('Refusing root database connection');
const db=new SqlPersistence(process.env.DATABASE_URL);
try{
 const found=await db.query(`SELECT p.tenant_id FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
   WHERE p.api_name='CODEXTILL' AND p.enabled=true
   AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages a
   WHERE a.tenant_id=p.tenant_id AND a.page_id=p.id)`);
 assert.equal(found.rows.length,1,'Expected exactly one non-app-managed CODEXTILL page');
 const tenant=found.rows[0].tenant_id;
 const prereq=await db.query(`SELECT api_name,active,flow_type FROM md_flow_definitions
   WHERE tenant_id=$1 AND api_name='AcetillCopilotReadCart'`,[tenant]);
 assert.equal(prereq.rows.length,1,'Existing AcetillCopilotReadCart Flow is not installed');
 assert.equal(prereq.rows[0].active,true,'Cart read Flow is not active');
 assert.equal(prereq.rows[0].flow_type,'Autolaunched Flow','Cart read Flow type mismatch');
 const fields=await db.query(`SELECT object_api,api_name FROM md_field_definitions
   WHERE tenant_id=$1 AND object_api IN ('MenuCategory','CartLine')`,[tenant]);
 const available=new Set(fields.rows.map(r=>r.object_api+'.'+r.api_name));
 for(const [object,names] of Object.entries(expectedFields))for(const name of names)
  assert(available.has(object+'.'+name),'Missing metadata field '+object+'.'+name);
 const receipt=await db.query('SELECT checksum FROM md_system_migrations WHERE version=$1',[RECEIPT]);
 if(receipt.rows.length){
  assert.equal(receipt.rows[0].checksum,checksum,'Binding receipt checksum changed');
  console.log('CODEXTILL tab/cart bindings already applied; preserve subsequent user edits');
 }else{
  const page=new PageRuntime(db);
  const before=await page.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(before.layoutMode,'free-canvas');
  const original=new Map(before.components.map(c=>[c.id,c]));
  for(const [id,type] of Object.entries(originalTypes)){
   const c=original.get(id);
   assert(c&&c.type===type,'CODEXTILL target missing or type changed: '+id);
   assert(!c.parentId&&!c.properties?.layoutParentId,'CODEXTILL target is nested: '+id);
   const existing=c.properties?.actionFlows;
   for(const key of Object.keys(BINDINGS[id].actionFlows))
    assert(!existing?.[key]||JSON.stringify(existing[key])===JSON.stringify(BINDINGS[id].actionFlows[key]),
     'Existing action must not be overwritten: '+id+'.'+key);
  }
  assert.equal(original.get('codextill-product-grid')?.properties?.objectApiName,'Product',
   'Existing Product Grid binding changed unexpectedly');
  const productFilters=original.get('codextill-product-grid')?.properties?.filters;
  assert(Array.isArray(productFilters)
   && productFilters.some(f=>f?.field==='Active'&&f?.operator==='Equals'&&f?.value===true),
   'Product Grid must retain Active=true; no existing filters will be modified');
  const next=before.components.map(c=>{
   const add=BINDINGS[c.id];
   if(!add)return c;
   const {actionFlows,...props}=add;
   return {...c,properties:{...c.properties,...props,
    actionFlows:{...(c.properties?.actionFlows||{}),...actionFlows}}};
  });
  await page.saveLayoutDraft(tenant,'CODEXTILL','Desktop',{...before,components:next});
  const saved=await page.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(saved.components.length,before.components.length);
  assert.equal(saved.layoutMode,before.layoutMode);
  assert.equal(saved.canvasWidth,before.canvasWidth);
  assert.equal(saved.canvasHeight,before.canvasHeight);
  const after=new Map(saved.components.map(c=>[c.id,c]));
  for(const originalComponent of before.components){
   const now=after.get(originalComponent.id);
   assert(now,'Lost '+originalComponent.id);
   assert.deepEqual(now.position,originalComponent.position,'Changed geometry: '+originalComponent.id);
   assert.equal(now.type,originalComponent.type,'Changed component type: '+originalComponent.id);
   assert.equal(now.parentId??null,originalComponent.parentId??null,'Changed parent');
   if(!(originalComponent.id in BINDINGS)){
    assert.deepEqual(now,originalComponent,'Unrelated component changed: '+originalComponent.id);
    continue;
   }
   const patch=BINDINGS[originalComponent.id];
   for(const [k,val] of Object.entries(patch)){
    if(k==='actionFlows'){
     for(const [ev,action] of Object.entries(val))
      assert.deepEqual(now.properties?.actionFlows?.[ev],action,'Action binding mismatch: '+ev);
    }else assert.deepEqual(now.properties?.[k],val,'Property mismatch: '+originalComponent.id+'.'+k);
   }
   for(const [k,v] of Object.entries(originalComponent.properties||{}))
    if(!(k in patch))assert.deepEqual(now.properties?.[k],v,'Overwrote unrelated property: '+k);
  }
  await db.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)
    ON CONFLICT(version) DO NOTHING`,[RECEIPT,checksum]);
  console.log('CODEXTILL TAB/CART DATA BINDINGS VERIFIED: MenuCategory dynamic tabs, categoryId PageState selection, CartLine scoped to current Cart via AcetillCopilotReadCart; all layout and Product bindings preserved');
 }
}finally{await db.pool.end();}
