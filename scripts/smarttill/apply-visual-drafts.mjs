import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

/**
 * One-time opt-in UI-only metadata patch for existing tenant-created SMARTTILL pages.
 * No bindings, flows, actions, objects, published revisions, or app records are touched.
 * Run with: DATABASE_URL=... node scripts/smarttill/apply-visual-drafts.mjs
 *   --tenant <tenant UUID> --actor <authorised user UUID> --apply
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const palettes={
 customer:{background:'#FFFFFF',ink:'#192230',muted:'#596579',accent:'#0054AA',border:'#D8DDE6'},
 lock:{background:'#101C35',ink:'#FFFFFF',muted:'#D8E2F5',pinBorder:'#C0CDE3'}
};
const variantSize={Desktop:[1440,900],Custom:[1440,900],Tablet:[1024,768],Mobile:[390,844]};
export const pageNames={
 customer:'SMARTTILL CUSTOMERDISPLAY',
 lock:'SMARTTILL LOCKSCREEN'
};
const frame=(x,y,width,height)=>({x,y,width,height});
function node(id,api,label,rect,properties={},parent=null,visible=true){
 const type='Custom:'+api;
 return {id,type,label,region:'main',visible,position:rect,
  ...(parent?{parentId:parent}:{}),
  properties:{libraryComponentId:api,...(parent?{layoutParentId:parent}:{}),...properties}
 };
}
const typeText=(value,textSize,textColor,alignment='left')=>({
 value,allowTyping:false,surface:'plain',shadow:'none',padding:0,
 backgroundColor:'transparent',borderWidth:0,borderColor:'transparent',
 textSize,textColor,labelAlignment:alignment
});
function cartProperties(){
 const c=palettes.customer;
 return {
  label:'Your order',backgroundColor:c.background,borderColor:c.border,
  radius:8,shadow:'none',headerBoxHeight:48,headerTextColor:c.ink,
  headerAlignment:'left',headerBold:true,
  supportingBoxHeight:28,supportingTextColor:c.muted,
  tableBackgroundColor:c.background,tableBorderColor:c.background,tableRadius:8,
  columnVisibility:['Column 1','Column 4'],rowHeight:64,
  rowLabelColor:c.ink,rowBorderColor:c.border,rowRadius:0,cardsPerRow:6,
  imageHeight:16,imagePlacement:'left',
  qtyIncreaseVisible:false,qtyDecreaseVisible:false,
  customButton1Visible:false,customButton2Visible:false,
  summaryBackgroundColor:c.background,summaryBorderColor:c.border,
  summaryRadius:8,summaryHeight:110,summaryTextSize:15,summaryTextColor:c.muted,
  summary2TextSize:26,summary2TextColor:c.ink,currencyCode:'GBP'
 };
}
const variant=(kind)=>variantSize[kind]?kind:'Desktop';
export function visualBlocks(page,layout='Desktop'){
 assert(['customer','lock'].includes(page),'Unknown visual page');
 assert(Object.hasOwn(variantSize,layout),'Unknown layout variant');
 const [W,H]=variantSize[layout];
 const mobile=layout==='Mobile',tablet=layout==='Tablet';
 if(page==='customer'){
  const c=palettes.customer,root='stcd-root',panel='stcd-complete-panel';
  const spec=mobile?{
   welcome:frame(16,24,358,66),order:frame(16,111,358,56),
   cart:frame(16,180,358,556),footer:frame(16,752,358,64),
   complete:frame(16,204,358,400),
   completedIcon:frame(143,35,72,72),completedTitle:frame(16,125,326,95),
   completedSub:frame(24,240,310,52)
  }:tablet?{
   welcome:frame(32,24,960,76),order:frame(32,114,960,48),
   cart:frame(32,177,960,490),footer:frame(32,695,960,40),
   complete:frame(170,160,684,390),
   completedIcon:frame(304,30,76,76),completedTitle:frame(35,130,614,80),
   completedSub:frame(86,245,512,52)
  }:{
   welcome:frame(64,46,1300,76),order:frame(64,154,1312,48),
   cart:frame(64,226,1312,540),footer:frame(64,803,1312,40),
   complete:frame(304,215,832,445),
   completedIcon:frame(378,34,76,76),completedTitle:frame(86,144,660,80),
   completedSub:frame(160,255,512,52)
  };
  return [
   node(root,'smart_container','Customer display canvas',frame(0,0,W,H),
    {layoutContainer:true,backgroundColor:c.background,radius:0}),
   node('stcd-welcome','ui_input','Welcome heading',spec.welcome,
    typeText('Welcome to SMARTTILL',mobile?28:50,c.accent),root),
   node('stcd-order-title','ui_input','Order title',spec.order,
    typeText('Your order will appear here',mobile?22:28,c.ink),root),
   node('stcd-order-cart','smart_cart','Order lines and subtotal',spec.cart,
    {...cartProperties(),...(mobile?{rowHeight:54,cardsPerRow:5,summaryTextSize:13,
      summary2TextSize:22}:tablet?{rowHeight:58,cardsPerRow:5}:{})},root),
   node('stcd-footer-note','ui_input','Total information',spec.footer,
    typeText('Final total confirmed at payment',mobile?13:17,c.muted),root),
   // Prepare alternate static presentation without displaying a false payment result.
   // Parent AND children remain invisible until the owner adds visibility formulas.
   node(panel,'smart_container','Payment-complete panel',spec.complete,
    {layoutContainer:true,backgroundColor:c.background,borderColor:c.border,
     radius:16,shadow:'none'},root,false),
   node('stcd-complete-icon','smart_icon','Completed checkmark',spec.completedIcon,
    {iconId:'check',iconFillColor:'#087E47',backgroundColor:'#E4F8ED',radius:38},
    panel,false),
   node('stcd-complete-title','ui_input','Thank-you heading',spec.completedTitle,
    typeText('Thank you for shopping with us!',mobile?24:38,c.ink,'center'),
    panel,false),
   node('stcd-complete-subtitle','ui_input','Payment confirmation text',spec.completedSub,
    typeText('Payment complete',mobile?18:24,c.muted,'center'),panel,false)
  ];
 }
 const c=palettes.lock,root='stls-root';
 const spec=mobile?{
  icon:frame(165,126,60,60),title:frame(24,219,342,54),
  instructions:frame(24,292,342,58),pinLabel:frame(24,372,342,40),
  pin:frame(24,416,342,64),unlock:frame(24,500,342,60),
  error:frame(24,573,342,40),logout:frame(65,645,260,56)
 }:tablet?{
  icon:frame(474,94,76,76),title:frame(282,189,460,60),
  instructions:frame(257,263,510,50),pinLabel:frame(312,321,400,40),
  pin:frame(312,363,400,66),unlock:frame(312,447,400,64),
  error:frame(312,530,400,40),logout:frame(382,591,260,56)
 }:{
  icon:frame(682,170,76,76),title:frame(490,271,460,60),
  instructions:frame(465,343,510,50),pinLabel:frame(520,408,400,40),
  pin:frame(520,450,400,66),unlock:frame(520,535,400,64),
  error:frame(520,610,400,40),logout:frame(590,675,260,56)
 };
 return [
  node(root,'smart_container','Lock screen canvas',frame(0,0,W,H),
   {layoutContainer:true,backgroundColor:c.background,radius:0}),
  node('stls-lock-icon','smart_icon','Lock icon',spec.icon,
   {iconId:'lock',iconFillColor:c.ink,backgroundColor:'transparent',
    radius:0,shadow:'none'},root),
  node('stls-title','ui_input','Locked heading',spec.title,
   typeText('Till locked',mobile?32:36,c.ink,'center'),root),
  node('stls-instructions','ui_input','Unlock instructions',spec.instructions,
   typeText('Enter your user PIN to resume this till.',mobile?16:18,c.muted,'center'),root),
  node('stls-pin-label','ui_input','PIN label',spec.pinLabel,
   typeText('User PIN',16,c.ink),root),
  node('stls-pin-input','ui_input','PIN entry',spec.pin,{
   label:'',value:'',inputType:'password',allowTyping:true,inputMode:'numeric',
   maxLength:8,required:true,autoComplete:'off',
   backgroundColor:'#FFFFFF',textColor:'#192538',borderColor:c.pinBorder,
   radius:12,padding:14,textSize:24,labelAlignment:'center',
   surface:'solid',shadow:'none'},root),
  node('stls-unlock','smart_button','Unlock till button',spec.unlock,{
   label:'Unlock till',labelAlignment:'center',
   backgroundColor:'#FFFFFF',labelColor:'#173869',borderColor:'#FFFFFF',
   radius:12,textSize:18,shadow:'none'},root),
  node('stls-error','ui_input','Validation status placeholder',spec.error,
   typeText('',15,'#FFB4B4','center'),root),
  node('stls-logout','smart_button','Log out button',spec.logout,{
   label:'Log out',labelAlignment:'center',
   backgroundColor:c.background,labelColor:c.ink,borderColor:'#A7B8D3',
   radius:10,textSize:17,shadow:'none'},root)
 ];
}
export function prepareVisualDraft(current,page,layout='Desktop'){
 assert(current&&typeof current==='object','Page draft required');
 assert(current.pageType==='App Page'||current.pageType==='Home Page',
  'Only existing App/Home Pages are supported');
 assert(Array.isArray(current.components),'Missing current page components');
 assert(Number.isInteger(current.draftRevision)&&current.draftRevision>=0,
  'Expected revisioned Page Runtime draft');
 assert(current.layoutMode==='free-canvas'||current.components.length===0,
  'Existing nonempty page must use free-canvas layout');
 const wanted=visualBlocks(page,layout);
 const prior=new Map(current.components.map(c=>[c.id,c]));
 const added=[];
 for(const candidate of wanted){
  const existing=prior.get(candidate.id);
  if(!existing){added.push(candidate);continue;}
  assert.equal(existing.type,candidate.type,
   'Existing component ID has incompatible type: '+candidate.id);
 }
 if(!added.length)return {changed:false,added:[],draft:current};
 // Preserve existing components and their metadata, including any user modifications.
 // Root is prepended only when absent to keep it behind content already on the page.
 const newRoots=added.filter(c=>!c.parentId);
 const newChildren=added.filter(c=>c.parentId);
 const size=variantSize[layout];
 const hasUnrelated=current.components.some(c=>!wanted.some(w=>w.id===c.id));
 const layoutChange=current.layoutMode!=='free-canvas';
 if(hasUnrelated){
  assert(!layoutChange,'Do not move an existing nonempty template page');
  assert(current.canvasWidth>=size[0]&&current.canvasHeight>=size[1],
   'Existing custom canvas is smaller than the proposed UI');
 }
 return {
  changed:true,added:added.map(c=>c.id),
  draft:{...current,layoutMode:'free-canvas',
   canvasWidth:hasUnrelated?current.canvasWidth:size[0],
   canvasHeight:hasUnrelated?current.canvasHeight:size[1],
   components:[...newRoots,...current.components,...newChildren]}
 };
}
export function verifyVisualDraft(before,after,page,layout,added){
 const expected=new Map(visualBlocks(page,layout).map(c=>[c.id,c]));
 const actual=new Map(after.components.map(c=>[c.id,c]));
 for(const old of before.components)
  assert.deepEqual(actual.get(old.id),old,'An existing component was modified: '+old.id);
 for(const id of added){
  const saved=actual.get(id),wanted=expected.get(id);
  assert(saved,'Missing inserted component '+id);
  for(const key of ['id','type','label','visible','region','position','parentId'])
   assert.deepEqual(saved[key],wanted[key],id+'.'+key+' not persisted');
  for(const [key,value] of Object.entries(wanted.properties))
   assert.deepEqual(saved.properties?.[key],value,id+'.'+key+' not persisted');
  assert.equal(saved.properties?.actionFlows,undefined,'Unexpected bound action');
  assert.equal(saved.properties?.objectApiName,undefined,'Unexpected data object');
 }
 assert(after.draftRevision>before.draftRevision,'Draft revision not advanced');
 if(before.draftRevision>0)
  assert.equal(after.draftRevision,before.draftRevision+1,'Unexpected draft revision jump');
 assert.equal(after.publishedRevision,before.publishedRevision,'Unexpected publish');
 assert.equal(after.targetObject,before.targetObject,'Page object binding changed');
}
async function run(){
 const argv=process.argv.slice(2);
 if(argv.includes('--preflight')){
  for(const layout of Object.keys(variantSize))for(const page of Object.keys(pageNames)){
   const blocks=visualBlocks(page,layout);
   assert.equal(new Set(blocks.map(b=>b.id)).size,blocks.length);
   for(const b of blocks){
    assert(b.position.x>=0&&b.position.y>=0&&b.position.width>0&&b.position.height>0);
    assert(!('objectApiName' in b.properties)&&!('actionFlows' in b.properties));
   }
  }
  console.log('SMARTTILL visual preflight passed: 2 pages x 4 layouts, no bindings/actions');
  return;
 }
 assert(argv.includes('--apply'),'Nothing changed. Explicit --apply required.');
 const param=name=>{const at=argv.indexOf(name);return at>=0?argv[at+1]:undefined;};
 const tenant=param('--tenant'),actor=param('--actor');
 assert(uuid.test(tenant??''),'A valid --tenant UUID is required');
 assert(uuid.test(actor??''),'A valid --actor UUID is required');
 assert(process.env.DATABASE_URL,'DATABASE_URL required');
 const [{SqlPersistence},{PageRuntime},{RbacEngine}]=await Promise.all([
  import('../../apps/server/dist-system/system-files/sql-persistence.js'),
  import('../../apps/server/dist-system/system-files/page-runtime.js'),
  import('../../apps/server/dist-system/system-files/rbac-engine.js')
 ]);
 if(typeof process.getuid==='function'&&process.getuid()===0)
  throw Error('Run the page update as an unprivileged service account, not root');
 const db=new SqlPersistence(process.env.DATABASE_URL);
 try{
  await new RbacEngine(db).require(tenant,actor,'PageDefinition','manage');
  const found=await db.query(`SELECT p.id,p.api_name,p.title,d.page_type
     FROM md_page_definitions p
     JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
     WHERE p.tenant_id=$1 AND p.enabled=true
       AND (regexp_replace(lower(p.title),'[^a-z0-9]','','g')=ANY($2::text[])
         OR regexp_replace(lower(p.api_name),'[^a-z0-9]','','g')=ANY($2::text[]))
       AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages s
          WHERE s.tenant_id=p.tenant_id AND s.page_id=p.id)`,
   [tenant,['smarttillcustomerdisplay','smarttilllockscreen']]);
  const byName=(name)=>found.rows.filter(row=>
   [row.title,row.api_name].some(value=>
    String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'')===name));
  const pages={customer:byName('smarttillcustomerdisplay'),
   lock:byName('smarttilllockscreen')};
  for(const [name,rows] of Object.entries(pages))
   assert.equal(rows.length,1,'Expected exactly one editable '+pageNames[name]+' in tenant');
  const runtime=new PageRuntime(db);
  const jobs=[];
  // Preflight all eight drafts before changing any of them.
  for(const [page,rows] of Object.entries(pages))
   for(const layout of Object.keys(variantSize)){
    const pageApi=rows[0].api_name;
    const current=await runtime.editor(tenant,pageApi,layout);
    assert.equal(current.apiName,pageApi);
    jobs.push({page,pageApi,layout,current,...prepareVisualDraft(current,page,layout)});
   }
  for(const job of jobs){
   if(!job.changed){console.log('Already configured',job.pageApi,job.layout);continue;}
   await runtime.saveLayoutDraft(tenant,job.pageApi,job.layout,job.draft,actor);
   const saved=await runtime.editor(tenant,job.pageApi,job.layout);
   verifyVisualDraft(job.current,saved,job.page,job.layout,job.added);
   console.log('Verified visual draft',job.pageApi,job.layout,
     job.added.length+' new components');
  }
 }finally{await db.pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 run().catch(error=>{console.error(error);process.exitCode=1;});
