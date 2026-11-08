import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';
import {PRICE_FORMULA} from './price-formula.mjs';

// Supported Smart renderer properties only. No component insert/delete,
// geometry, app records, page publishing, actionFlows, or business data writes.
const RECEIPT='codextill-supported-metadata-20261101-v1';

const commonButton={labelAlignment:'center',textSize:16,borderColor:'#DDE3EC',radius:14};
const topButton={...commonButton,backgroundColor:'#FAFAFC',labelColor:'#172033'};
const footerButton={...commonButton,backgroundColor:'#FFFFFF',labelColor:'#8295B0',borderColor:'#E1E6ED'};
export const PATCH={
 'codextill-till-lock':{iconId:'lock',backgroundColor:'#FAFAFC',iconFillColor:'#172033',radius:14,borderColor:'#DDE3EC'},
 'codextill-settings':{iconId:'settings',backgroundColor:'#FAFAFC',iconFillColor:'#172033',radius:14,borderColor:'#DDE3EC'},
 'codextill-clear-order':{iconId:'trash',backgroundColor:'transparent',iconFillColor:'#374151'},
 'codextill-customer-display':topButton,
 'codextill-held-sales-top':topButton,
 'codextill-sales-return':topButton,
 'codextill-sign-out':topButton,
 'codextill-categories':{
  tabCount:8,tabWidth:100,tabHeight:56,textSize:16,labelAlignment:'center',
  radius:3,tabColor:'#FFFFFF',selectedTabColor:'#F2F5FA',
  labelColor:'#153B64',borderColor:'#DCE3ED'
 },
 'codextill-search':{
  objectApiName:'Product',textSource:'@Name',
  filters:[{field:'Active',operator:'Equals',value:true}],
  textSize:16,labelAlignment:'left',placeholder:'Search or scan products',
  backgroundColor:'#FFFFFF',borderColor:'#DCE3ED',radius:16
 },
 'codextill-product-grid':{
  objectApiName:'Product',
  filters:[{field:'Active',operator:'Equals',value:true}],
  textSource:'@Name',imageSource:'@ImageUrl',
  badgeText:PRICE_FORMULA,badgeVisible:true,badgeAlignment:'text-left',
  badgeTextSize:15,badgeBold:false,badgeTextColor:'#6B7280',badgeBodyColor:'#FFFFFF',
  cardsPerRow:5,cardsPerColumn:2,cardMinHeight:240,gap:16,
  imageHeight:190,headerBoxHeight:40,imagePlacement:'top',imageFill:'fit',
  headerAlignment:'left',headerBold:true,wrapText:true,
  backgroundColor:'#FFFFFF',borderColor:'#DCE3ED',borderWidth:1,
  radius:16,shadow:'none'
 },
 'codextill-cart':{
  headerBoxHeight:48,headerTextColor:'#FFFFFF',
  headerAlignment:'left',headerBold:true,
  supportingBoxHeight:28,supportingTextColor:'#6B7280',
  rowHeight:52,imageHeight:36,
  columnVisibility:['Column 1','Column 2','Column 3','Column 4'],
  tableBackgroundColor:'#FFFFFF',tableBorderColor:'#FFFFFF',
  rowLabelColor:'#354052',
  summaryBackgroundColor:'#FFFFFF',summaryBorderColor:'#DCE3ED',
  summaryHeight:130,summaryTextSize:14,summaryTextColor:'#6B7280',
  summary2TextSize:22,summary2TextColor:'#172033',currencyCode:'GBP'
 },
 'codextill-cash':{labelAlignment:'center',textSize:18,labelColor:'#FFFFFF',radius:15},
 'codextill-card':{labelAlignment:'center',textSize:18,labelColor:'#FFFFFF',radius:15},
 'codextill-hold-label':{textSize:16,labelAlignment:'left'},
 'codextill-hold-sale':footerButton,
 'codextill-discount':{...footerButton,shapeId:'tag'},
 'codextill-rewards':{...footerButton,shapeId:'shield-check'},
 'codextill-gift-cards':{...footerButton,shapeId:'wallet'},
 'codextill-more':{...footerButton,shapeId:'ellipsis'}
};
const expectedTypes={
 'codextill-till-lock':'smart_icon','codextill-settings':'smart_icon',
 'codextill-clear-order':'smart_icon','codextill-customer-display':'smart_button',
 'codextill-held-sales-top':'smart_button','codextill-sales-return':'smart_button',
 'codextill-sign-out':'smart_button','codextill-categories':'smart_tabs',
 'codextill-search':'smart_lookup','codextill-product-grid':'smart_card_grid',
 'codextill-cart':'smart_cart','codextill-cash':'smart_button',
 'codextill-card':'smart_button','codextill-hold-label':'smart_text',
 'codextill-hold-sale':'smart_button','codextill-discount':'smart_button',
 'codextill-rewards':'smart_button','codextill-gift-cards':'smart_button',
 'codextill-more':'smart_button'
};
assert.deepEqual(Object.keys(PATCH).sort(),Object.keys(expectedTypes).sort());
for(const [id,properties] of Object.entries(PATCH)){
 assert(properties&&typeof properties==='object'&&!Array.isArray(properties),id);
 for(const key of Object.keys(properties))assert(!['actionFlows','parentId','layoutParentId','position','width','height','x','y','canvasWidth','canvasHeight'].includes(key),'Forbidden property '+id+':'+key);
}
const checksum=createHash('sha256').update(JSON.stringify(PATCH)).digest('hex');
if(process.argv.includes('--preflight')){
 console.log('CODEXTILL supported-metadata preflight passed:',Object.keys(PATCH).length,'scoped components; no actions, geometry or publishing');
 process.exit(0);
}
if(!process.env.DATABASE_URL)throw Error('Production database connection required');
if(typeof process.getuid==='function'&&process.getuid()===0){
 process.initgroups('metadrive','metadrive');
 process.setgid('metadrive');
 process.setuid('metadrive');
}
if(typeof process.getuid==='function'&&process.getuid()===0)throw Error('Refusing root SQL access');
const db=new SqlPersistence(process.env.DATABASE_URL);
try{
 const receipt=await db.query('SELECT checksum FROM md_system_migrations WHERE version=$1',[RECEIPT]);
 if(receipt.rows.length){
  assert.equal(receipt.rows[0].checksum,checksum,'Existing migration checksum mismatch');
  console.log('CODEXTILL metadata draft update already applied; keeping subsequent user edits');
 }else{
  const found=await db.query(`SELECT p.tenant_id FROM md_page_definitions p
    JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
    WHERE p.api_name='CODEXTILL' AND p.enabled=true
    AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages s
    WHERE s.tenant_id=p.tenant_id AND s.page_id=p.id)`);
  assert.equal(found.rows.length,1,'Expected unique editable CODEXTILL page');
  const pages=new PageRuntime(db),tenant=found.rows[0].tenant_id;
  const current=await pages.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(current.layoutMode,'free-canvas','CODEXTILL must remain free-canvas');
  const before=new Map(current.components.map(c=>[c.id,c]));
  for(const [id,type] of Object.entries(expectedTypes)){
   assert(before.has(id),'Missing component '+id);
   assert.equal(before.get(id).type,'Custom:'+type,'Unexpected type '+id);
   assert.equal(before.get(id).parentId??null,null,'Nested component '+id);
   assert.equal(before.get(id).properties?.layoutParentId??null,null,'Nested metadata '+id);
  }
  const updated=current.components.map(c=>PATCH[c.id]?{
   ...c,properties:{...c.properties,...PATCH[c.id]}
  }:c);
  assert.equal(updated.length,current.components.length,'Lost component');
  for(let i=0;i<updated.length;i++){
   assert.deepEqual(updated[i].position,current.components[i].position,'Position changed: '+updated[i].id);
   assert.equal(updated[i].type,current.components[i].type,'Type changed');
   assert.equal(updated[i].id,current.components[i].id,'Id changed');
   if(!PATCH[updated[i].id])assert.deepEqual(updated[i],current.components[i],'Unrelated component changed');
  }
  await pages.saveLayoutDraft(tenant,'CODEXTILL','Desktop',{...current,components:updated});
  const saved=await pages.editor(tenant,'CODEXTILL','Desktop');
  assert.equal(saved.components.length,current.components.length,'Save changed component count');
  assert.equal(saved.layoutMode,current.layoutMode,'Save changed layout mode');
  assert.equal(saved.canvasWidth,current.canvasWidth,'Save changed canvas width');
  assert.equal(saved.canvasHeight,current.canvasHeight,'Save changed canvas height');
  const after=new Map(saved.components.map(c=>[c.id,c]));
  for(const [id,changes] of Object.entries(PATCH)){
   const c=after.get(id),prior=before.get(id);
   assert(c,'Missing component in readback '+id);
   assert.deepEqual(c.position,prior.position,'Geometry mismatch '+id);
   assert.equal(c.parentId??null,null,'Nested after readback '+id);
   assert.equal(c.properties?.layoutParentId??null,null,'Nested after readback '+id);
   for(const [key,val] of Object.entries(changes))assert.deepEqual(c.properties?.[key],val,'Property mismatch '+id+'.'+key);
   for(const [key,val] of Object.entries(prior.properties||{}))
    if(!(key in changes))assert.deepEqual(c.properties?.[key],val,'Unexpected property loss '+id+'.'+key);
  }
  for(const c of current.components)if(!PATCH[c.id])assert.deepEqual(after.get(c.id),c,'Unrelated component modified '+c.id);
  await db.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)
   ON CONFLICT(version) DO NOTHING`,[RECEIPT,checksum]);
  console.log('CODEXTILL METADATA VERIFIED:',Object.keys(PATCH).length,
   'Smart Components; Product source and price formula saved; geometry, actions, unrelated content preserved');
 }
}finally{await db.pool.end();}
