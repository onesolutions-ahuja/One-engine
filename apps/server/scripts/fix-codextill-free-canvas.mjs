import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SqlPersistence} from '../dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../dist-system/system-files/page-runtime.js';
import {codextillDesktopComponents} from '../dist-system/app-seeders/codextill-page-layout.js';

// The original visual seed authored child-relative positions in nested
// Smart Containers. Page Builder uses width:100%, height:auto and disables
// free-canvas movement for nested components. Convert just these 26
// instances to independent page-level coordinates in a NEW Desktop draft.
// Preserve the existing component identity, type, visual properties and
// all unrelated components. Never publish.
const RECEIPT='codextill-free-canvas-geometry-20261101-v1';
const source=new Map(codextillDesktopComponents.map(c=>[c.id,c]));
assert.equal(source.size,26,'Expected 26 distinct CODEXTILL components');

const memo=new Map();
function absolutePosition(id,visited=new Set()){
 if(memo.has(id))return memo.get(id);
 const component=source.get(id);
 assert(component,'Missing seeded component '+id);
 assert(!visited.has(id),'CODEXTILL parent cycle '+id);
 const parent=component.properties?.layoutParentId||component.parentId;
 const origin=parent?absolutePosition(parent,new Set([...visited,id])):{x:0,y:0};
 const {x,y,width,height}=component.position;
 const rect={x:x+origin.x,y:y+origin.y,width,height};
 assert(Object.values(rect).every(v=>Number.isFinite(v)),'Non-numeric CODEXTILL geometry '+id);
 assert(rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0,'Invalid CODEXTILL frame '+id);
 assert(rect.x+rect.width<=1920&&rect.y+rect.height<=889,'Out-of-canvas CODEXTILL frame '+id);
 memo.set(id,rect);
 return rect;
}
for(const id of source.keys())absolutePosition(id);
assert.deepEqual(memo.get('codextill-cash'),{x:1354,y:784,width:260,height:75});
assert.deepEqual(memo.get('codextill-card'),{x:1631,y:784,width:261,height:75});
assert.deepEqual(memo.get('codextill-product-grid'),{x:33,y:251,width:1259,height:534});
assert.deepEqual(memo.get('codextill-hold-sale'),{x:245,y:805,width:201,height:56});
if(process.argv.includes('--preflight')){
 console.log('CODEXTILL absolute-geometry preflight passed: 26 valid independent canvas rectangles');
 process.exit(0);
}

if(!process.env.DATABASE_URL)throw Error('Production database connection required');
if(typeof process.getuid==='function'&&process.getuid()===0){
 // The restricted Oracle runner checkout is only traversable before we drop
 // privileges, while PostgreSQL peer authentication requires metadrive.
 process.initgroups('metadrive','metadrive');
 process.setgid('metadrive');
 process.setuid('metadrive');
}
if(typeof process.getuid==='function'&&process.getuid()===0)
 throw Error('Refusing privileged CODEXTILL SQL connection');

const db=new SqlPersistence(process.env.DATABASE_URL);
try{
 const {rows}=await db.query(`
 SELECT p.tenant_id FROM md_page_definitions p
 JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
 WHERE p.api_name='CODEXTILL' AND p.enabled=true
  AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages a
   WHERE a.tenant_id=p.tenant_id AND a.page_id=p.id)`);
 assert.equal(rows.length,1,'Expected exactly one editable Page Builder CODEXTILL page');
 const tenant=rows[0].tenant_id,pages=new PageRuntime(db);
 const current=await pages.editor(tenant,'CODEXTILL','Desktop');
 assert(['App Page','Home Page'].includes(current.pageType),'CODEXTILL wrong page type');
 const before=new Map(current.components.map(c=>[c.id,c]));
 for(const [id,original] of source){
  assert(before.has(id),'CODEXTILL source instance missing: '+id);
  assert.equal(before.get(id).type,original.type,'CODEXTILL instance type changed: '+id);
 }
 const checksum=createHash('sha256').update(JSON.stringify([...memo])).digest('hex');
 const receipt=await db.query('SELECT checksum FROM md_system_migrations WHERE version=$1',[RECEIPT]);
 if(receipt.rows[0]){
  assert.equal(receipt.rows[0].checksum,checksum,'CODEXTILL repair receipt differs');
  console.info('CODEXTILL geometry repair previously applied; user edits preserved');
  process.exitCode=0;
 }else{
  const components=current.components.map(c=>{
   const expected=memo.get(c.id);
   if(!expected)return c;
   const props={...(c.properties||{})};
   delete props.layoutParentId;
   const updated={...c,position:{...c.position,...expected},properties:props};
   delete updated.parentId;
   return updated;
  });
  assert.equal(components.length,current.components.length,'Unrelated components lost');
  const adjusted=components.filter(c=>source.has(c.id)).length;
  assert.equal(adjusted,26);
  const needsSave=current.layoutMode!=='free-canvas'
   ||current.canvasWidth<1920||current.canvasHeight<889
   ||components.some((c,i)=>JSON.stringify(c)!==JSON.stringify(current.components[i]));
  if(needsSave){
   await pages.saveLayoutDraft(tenant,'CODEXTILL','Desktop',{
    ...current,layoutMode:'free-canvas',
    canvasWidth:Math.max(current.canvasWidth,1920),
    canvasHeight:Math.max(current.canvasHeight,889),
    components
   });
  }
  const saved=await pages.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(saved.layoutMode,'free-canvas','Desktop canvas mode did not persist');
  assert.equal(saved.components.length,current.components.length,'Component count changed');
  const found=new Map(saved.components.map(c=>[c.id,c]));
  for(const [id,expected] of memo){
   const c=found.get(id);
   assert(c,'CODEXTILL component missing after save: '+id);
   assert.equal(c.parentId??null,null,'Still nested via parentId: '+id);
   assert.equal(c.properties?.layoutParentId??null,null,'Still nested via layoutParentId: '+id);
   assert.deepEqual(c.position,expected,'Position/size mismatch after save: '+id);
   assert.equal(c.type,before.get(id).type,'Component type changed: '+id);
   const otherProps={...(c.properties||{})},priorProps={...(before.get(id).properties||{})};
   delete otherProps.layoutParentId;
   delete priorProps.layoutParentId;
   assert.deepEqual(otherProps,priorProps,'Other properties changed: '+id);
  }
  await db.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)
   ON CONFLICT(version) DO NOTHING`,[RECEIPT,checksum]);
  console.info('CODEXTILL Desktop draft VERIFIED: 26 independent, movable free-canvas components; x/y/w/h correct and all other properties retained');
 }
}finally{
 await db.pool.end();
}
