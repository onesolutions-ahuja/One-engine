import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';

// A pure metadata binding: the user's Formula field stays editable in the
// generic Page Builder ribbon. No application-owned code, objects, records or Flow changes.
export const FORMULA='IF(ISBLANK($state.categoryId), TRUE, @MenuCategory = $state.categoryId)';
const VERSION='codextill-category-filter-formula-20261101-v1';
const checksum=createHash('sha256').update(FORMULA).digest('hex');
if(process.argv.includes('--preflight')){
 assert(FORMULA.includes('$state.categoryId')&&FORMULA.includes('@MenuCategory'));
 console.log('CODEXTILL category Formula preflight passed (metadata only)');
 process.exit(0);
}
if(!process.env.DATABASE_URL)throw Error('Production DATABASE_URL is required');
if(typeof process.getuid==='function'&&process.getuid()===0){
 process.initgroups('metadrive','metadrive');process.setgid('metadrive');process.setuid('metadrive');
}
if(typeof process.getuid==='function'&&process.getuid()===0)throw Error('Refusing root SQL connection');
const db=new SqlPersistence(process.env.DATABASE_URL);
try{
 const receipt=await db.query('SELECT checksum FROM md_system_migrations WHERE version=$1',[VERSION]);
 if(receipt.rows.length){
  assert.equal(receipt.rows[0].checksum,checksum,'Unexpected prior metadata version');
  console.log('CODEXTILL category filter formula already saved; preserving any later edits');
 }else{
  const found=await db.query(`SELECT p.tenant_id FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
   WHERE p.api_name='CODEXTILL' AND p.enabled=true
   AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages s WHERE s.tenant_id=p.tenant_id AND s.page_id=p.id)`);
  assert.equal(found.rows.length,1,'Expected one editable CODEXTILL page');
  const tenant=found.rows[0].tenant_id;
  const fields=await db.query(`SELECT object_api,api_name FROM md_field_definitions
   WHERE tenant_id=$1 AND deleted_at IS NULL AND
   (object_api='Product' AND api_name='MenuCategory' OR object_api='MenuCategory' AND api_name='Name')`,[tenant]);
  assert.equal(fields.rows.length,2,'Category lookup metadata unavailable');
  const runtime=new PageRuntime(db);
  const before=await runtime.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(before.layoutMode,'free-canvas');
  const map=new Map(before.components.map(c=>[c.id,c]));
  const grid=map.get('codextill-product-grid'),tabs=map.get('codextill-categories');
  assert.equal(grid?.type,'Custom:smart_card_grid','Product Grid is missing');
  assert.equal(tabs?.type,'Custom:smart_tabs','Category Tabs missing');
  assert.equal(grid.properties?.objectApiName,'Product');
  assert.equal(tabs.properties?.objectApiName,'MenuCategory');
  assert.equal(tabs.properties?.actionFlows?.change?.actionType,'PageState');
  assert.equal(tabs.properties?.actionFlows?.change?.stateKey,'categoryId');
  assert.equal(tabs.properties?.actionFlows?.change?.value,'$event.record.Id');
  assert(!grid.parentId&&!grid.properties?.layoutParentId,'Grid must be free canvas');
  const existing=grid.properties?.filterFormula;
  assert(!existing||existing===FORMULA,'An existing user formula must not be overwritten');
  const filters=grid.properties?.filters;
  assert(Array.isArray(filters),'Existing Product Grid filters are missing');
  assert(filters.some(f=>f.field==='Active'&&f.operator==='Equals'&&f.value===true),
    'Product Grid active-product filter is missing');
  const updated=before.components.map(c=>c.id===grid.id?{...c,properties:{...c.properties,filterFormula:FORMULA}}:c);
  await runtime.saveLayoutDraft(tenant,'CODEXTILL','Desktop',{...before,components:updated});
  const saved=await runtime.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(saved.layoutMode,before.layoutMode);
  assert.equal(saved.canvasWidth,before.canvasWidth);
  assert.equal(saved.canvasHeight,before.canvasHeight);
  assert.equal(saved.components.length,before.components.length);
  const after=new Map(saved.components.map(c=>[c.id,c]));
  for(const beforeItem of before.components){
   const now=after.get(beforeItem.id);
   assert(now,'Missing component '+beforeItem.id);
   assert.deepEqual(now.position,beforeItem.position,'Component geometry changed '+beforeItem.id);
   if(beforeItem.id===grid.id){
    assert.equal(now.properties?.filterFormula,FORMULA,'Formula field not retained');
    for(const [k,v] of Object.entries(beforeItem.properties||{}))
     if(k!=='filterFormula')assert.deepEqual(now.properties?.[k],v,'Unrelated Product Grid property changed '+k);
   }else assert.deepEqual(now,beforeItem,'Unrelated component modified '+beforeItem.id);
  }
  await db.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)
   ON CONFLICT(version) DO NOTHING`,[VERSION,checksum]);
  console.log('CODEXTILL PRODUCT FORMULA VERIFIED: '+FORMULA+'; existing filters, geometry and all other metadata preserved');
 }
}finally{await db.pool.end();}
