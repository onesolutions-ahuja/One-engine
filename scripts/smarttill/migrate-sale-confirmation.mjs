import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

/** Safe SmartTill tenant-page migration, from a known-good Page Builder draft.
 * --preflight runs pure checks, no database.
 * With DATABASE_URL, --tenant UUID --actor UUID: inspect planned popup and
 * customer-display page edits (no writes). Saved action formulas are out of scope.
 * --apply saves DRAFTS, --apply --publish publishes those drafts explicitly.
 * Do not bulk-rewrite payment Yes/No branches: pre-payment authorisation is not success.
 */
export const POPUP='smart_till_sale_confirmation';
export const CUSTOMER='smart_till_customer_display';
const variants=['Desktop','Tablet','Mobile','Custom'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const api=(value)=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const rect=(x,y,width,height)=>({x,y,width,height});
const colours={ink:'#17283A',secondary:'#536477',green:'#087E47',pale:'#E4F8ED',white:'#FFFFFF'};
function node(id,type,label,position,properties,pageLayer){
 return {id,type:'Custom:'+type,label,region:'main',visible:true,position,
  properties:{libraryComponentId:type,pageLayer,...properties}};
}
function label(id,caption,position,textSource,size=24,bold=false,layer=0){
 return node(id,'smart_label',caption,position,{textSource,backgroundColor:'transparent',
  labelColor:colours.ink,textSize:size,labelAlignment:'center',
  headerBold:bold,wrapText:true},layer);
}
function layout(variant){
 const phone=variant==='Mobile',small=phone?360:620,h=phone?520:480;
 return {phone,w:small,h};
}
export function confirmationComponents(variant){
 const {phone,w,h}=layout(variant);
 return [
  node('sts-success-icon','smart_icon','Payment complete icon',rect((w-80)/2,36,80,80),
   {iconId:'check',iconFillColor:colours.green,backgroundColor:colours.pale,radius:40},0),
  label('sts-success-title','Sale completed',rect(24,139,w-48,54),'Payment successful',phone?30:36,true),
  label('sts-success-amount','Amount received',rect(24,214,w-48,66),
   '=FORMAT(@ThisPage.Input.paymentAmount, "£0.00")',phone?36:46,true),
  label('sts-success-method','Payment method',rect(24,293,w-48,38),
   '="Payment method: " & @ThisPage.Input.paymentMethod',phone?15:18),
  label('sts-success-change','Change returned',rect(24,334,w-48,34),
   '=IF(ISBLANK(@ThisPage.Input.changeAmount), "", "Change returned: " & FORMAT(@ThisPage.Input.changeAmount, "£0.00"))',phone?15:18),
  node('sts-success-done','smart_button','Done',rect(phone?50:145,h-91,phone?w-100:w-290,56),
   {label:'Done',labelAlignment:'center',backgroundColor:colours.green,
    labelColor:colours.white,radius:14,textSize:19,
    actionFlows:{click:{actionType:'Formula',formula:'=CLOSESCREEN()'}}},0)
 ];
}
export function confirmationPage(variant='Desktop'){
 const {w,h}=layout(variant);
 return {apiName:POPUP,label:'SmartTill Sale Confirmation',pageType:'In-Screen Page',
  targetObject:'',status:'Active',layoutMode:'free-canvas',layoutVariant:variant,
  canvasWidth:w,canvasHeight:h,canvasFillColor:colours.white,
  devices:['Desktop','Tablet','Phone','Custom'],activationAssignments:[],
  components:confirmationComponents(variant)};
}
export function customerLayerComponents(page,variant){
 assert(page.layoutMode==='free-canvas','Customer display must be a free canvas');
 const w=Number(page.canvasWidth),h=Number(page.canvasHeight);
 assert(Number.isFinite(w)&&w>=320&&Number.isFinite(h)&&h>=320,'Missing customer-display canvas');
 // Scale all six visual elements to fit short tablet/mobile canvases as well
 // as a full-size second monitor. Never crop the final confirmation caption.
 const gap=Math.max(5,Math.min(18,Math.floor(h/45)));
 const iconSize=Math.max(40,Math.min(90,Math.floor(h*0.14)));
 const titleH=Math.max(34,Math.min(60,Math.floor(h*0.14)));
 const amountH=Math.max(50,Math.min(80,Math.floor(h*0.19)));
 const detailH=Math.max(27,Math.min(42,Math.floor(h*0.095)));
 const thankH=Math.max(30,Math.min(56,Math.floor(h*0.13)));
 const all=[iconSize,titleH,amountH,detailH,detailH,thankH];
 const total=all.reduce((sum,size)=>sum+size,0)+gap*(all.length-1);
 assert(total<=h,'Payment confirmation cannot fit the current display');
 let cursor=Math.floor((h-total)/2);
 const position=(height)=>{const at=cursor;cursor+=height+gap;return rect(24,at,w-48,height);};
 const font=Math.min(58,Math.max(22,Math.round(w/24)));
 const iconRect=position(iconSize);
 return [
  node('stcd-paid-icon','smart_icon','Payment received',
   {...iconRect,x:(w-iconSize)/2,width:iconSize},
   {iconId:'check',iconFillColor:colours.green,backgroundColor:colours.pale,radius:iconSize/2},1),
  label('stcd-paid-title','Payment complete',position(titleH),
   'Payment complete',Math.min(38,font),true,1),
  label('stcd-paid-amount','Paid amount',position(amountH),
   '=FORMAT(@ThisPage.Input.paymentAmount, "£0.00")',Math.min(64,font+9),true,1),
  label('stcd-paid-method','Payment method',position(detailH),
   '=IF(ISBLANK(@ThisPage.Input.paymentMethod), "", "Payment method: " & @ThisPage.Input.paymentMethod)',
   Math.min(19,Math.max(14,font-9)),false,1),
  label('stcd-paid-change','Change returned',position(detailH),
   '=IF(ISBLANK(@ThisPage.Input.changeAmount), "", "Change returned: " & FORMAT(@ThisPage.Input.changeAmount, "£0.00"))',
   Math.min(19,Math.max(14,font-9)),false,1),
  label('stcd-paid-message','Thank you',position(thankH),
   'Thank you for shopping with us',Math.min(28,Math.max(17,font-7)),false,1)
 ];
}
export function customerDraft(current,variant){
 const wanted=customerLayerComponents(current,variant);
 const byId=new Map(current.components.map(c=>[c.id,c]));
 const newBlocks=wanted.filter(c=>!byId.has(c.id));
 for(const c of wanted){
  const existing=byId.get(c.id);
  if(existing)assert.equal(existing.type,c.type,'Incompatible existing confirmation component '+c.id);
 }
 return {changed:newBlocks.length>0,added:newBlocks.map(c=>c.id),
  draft:{...current,components:[...current.components,...newBlocks]}};
}
export function validateVisualDraft(current,next){
 assert.equal(current.apiName,next.apiName);
 assert.equal(current.components.length<=next.components.length,true);
 for(const item of current.components)
  assert.deepEqual(next.components.find(c=>c.id===item.id),item,'Original component changed: '+item.id);
 assert.equal(new Set(next.components.map(c=>c.id)).size,next.components.length);
}
async function run(){
 const args=process.argv.slice(2),has=x=>args.includes(x),option=name=>{
  const at=args.indexOf(name);return at>=0?args[at+1]:undefined;};
 const apply=has('--apply'),publish=has('--publish');
 if(publish&&!apply)throw Error('--publish requires --apply');
 if(has('--preflight')){
  for(const variant of variants){
   const pop=confirmationPage(variant);
   assert.equal(new Set(pop.components.map(c=>c.id)).size,pop.components.length);
   assert.equal(pop.components.every(c=>c.position.x>=0&&c.position.y>=0&&c.position.width>0&&
    c.position.height>0),true);
   const customer={apiName:CUSTOMER,layoutMode:'free-canvas',canvasWidth:1440,canvasHeight:900,
    components:[]};
   const patch=customerDraft(customer,variant);
   validateVisualDraft(customer,patch.draft);
   assert.equal(customerDraft(patch.draft,variant).changed,false);
  }
  console.log('SmartTill confirmation: 4 popup layouts + 4 idempotent display layers verified');
  return;
 }
 const tenant=option('--tenant'),actor=option('--actor');
 assert(uuid.test(tenant??'')&&uuid.test(actor??''),'--tenant and --actor UUID required');
 assert(process.env.DATABASE_URL,'DATABASE_URL required');
 const [{SqlPersistence},{PageRuntime},{RbacEngine}]=await Promise.all([
  import('../../apps/server/dist-system/system-files/sql-persistence.js'),
  import('../../apps/server/dist-system/system-files/page-runtime.js'),
  import('../../apps/server/dist-system/system-files/rbac-engine.js')
 ]);
 const db=new SqlPersistence(process.env.DATABASE_URL);
 try{
  await new RbacEngine(db).require(tenant,actor,'PageDefinition','manage');
  const found=await db.query(`SELECT p.api_name,p.title,d.page_type,p.id
    FROM md_page_definitions p JOIN md_lightning_page_details d
      ON d.tenant_id=p.tenant_id AND d.page_id=p.id
    WHERE p.tenant_id=$1 AND p.enabled=true`,[tenant]);
  const displayPages=found.rows.filter(row=>api(row.api_name)===api(CUSTOMER)
    ||api(row.title)==='smarttillcustomerdisplay');
  assert.equal(displayPages.length,1,'Expected exactly one saved SmartTill customer-display page');
  const actualCustomer=displayPages[0].api_name;
  const existingPopup=found.rows.filter(row=>api(row.api_name)===api(POPUP));
  assert(existingPopup.length<=1,'Duplicate sale-confirmation pages');
  if(existingPopup.length)assert.equal(existingPopup[0].page_type,'In-Screen Page',
   'Existing confirmation page must be an In-Screen Page');
  const runtime=new PageRuntime(db);
  const jobs=[];
  for(const variant of variants){
   const customer=await runtime.editor(tenant,actualCustomer,variant);
   const planned=customerDraft(customer,variant);
   validateVisualDraft(customer,planned.draft);
   jobs.push({page:actualCustomer,variant,current:customer,...planned});
  }
  console.log(JSON.stringify({mode:publish?'publish':apply?'draft':'dry-run',
   confirmationPage:POPUP,popupExists:Boolean(existingPopup.length),
   customerDrafts:jobs.map(job=>({variant:job.variant,added:job.added}))},null,2));
  if(!apply)return;
  if(!existingPopup.length)await runtime.save(tenant,POPUP,confirmationPage(),true);
  // Preserve every existing component, including all existing payment actions.
  // Popup uses the server-proven payment data sent in SCREEN's input state.
  for(const variant of variants){
   const editor=await runtime.editor(tenant,POPUP,variant);
   const wanted=confirmationComponents(variant),prior=new Map(editor.components.map(c=>[c.id,c]));
   for(const c of wanted)if(prior.has(c.id))
    assert.equal(prior.get(c.id).type,c.type,'Unexpected popup component collision');
   const missing=wanted.filter(c=>!prior.has(c.id));
   if(missing.length){
    const {w,h}=layout(variant);
    await runtime.saveLayoutDraft(tenant,POPUP,variant,{
     ...editor,layoutMode:'free-canvas',canvasWidth:w,canvasHeight:h,
     components:[...editor.components,...missing]},actor);
   }
   if(publish)await runtime.publishLayout(tenant,POPUP,variant,undefined,actor);
  }
  for(const job of jobs){
   if(job.changed){
    const latest=await runtime.editor(tenant,job.page,job.variant);
    assert.deepEqual(latest,job.current,'Customer display changed during migration');
    await runtime.saveLayoutDraft(tenant,job.page,job.variant,job.draft,actor);
   }
   if(publish)await runtime.publishLayout(tenant,job.page,job.variant,undefined,actor);
  }
  console.log('SmartTill confirmation page and customer display layer saved; publish requested: '+publish);
 }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 run().catch(error=>{console.error(error);process.exitCode=1;});
