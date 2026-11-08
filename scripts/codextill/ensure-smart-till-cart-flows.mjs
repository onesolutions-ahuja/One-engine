import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';
import {encodeMetadataValue} from '../../apps/server/dist-system/system-files/component-runtime.js';

// Tenant-owned, no-code-editable Flow metadata. Not an Acetill AppExchange
// resource: uninstalling Acetill must not remove Smart Till's cart operations.
const VERSION=1;
const node=(id,type,label,config={})=>({id,type,label,config});
const edge=(from,to,label='Next')=>({from,to,kind:'normal',label});
const variable=(name,dataType='Text',input=false,output=false)=>({
 name,type:'Variable',dataType,...(input?{availableForInput:true}:{}),
 ...(output?{availableForOutput:true}:{})
});
const resource=[
 variable('sessionKey','Text',true),
 variable('cartId','Text',true,true),
 {name:'currentSession',type:'Record',dataType:'Cart'},
 {name:'cartItems',type:'Record Collection',dataType:'CartLine',availableForOutput:true},
 {name:'cartLine',type:'Record',dataType:'CartLine'},
 {name:'calculatedLineTotal',type:'Formula',dataType:'Number',
  value:'cartLine.Quantity * cartLine.UnitPrice'},
 variable('subtotal','Number',false,true),
 variable('total','Number',false,true)
];
const totals=start=>({
 elements:[
  node(start,'Assignment','Reset subtotal',{variable:'subtotal',operator:'Assign',value:0}),
  node(start+1,'Loop','Each cart line',{collection:'cartItems',loopVariable:'cartLine'}),
  node(start+2,'Assignment','Add line total',{
   variable:'subtotal',operator:'Add',value:'{!calculatedLineTotal}'}),
  node(start+3,'Assignment','Set total',{variable:'total',operator:'Assign',value:'{!subtotal}'})
 ],
 links:[edge(start,start+1),edge(start+1,start+2,'For Each'),
  edge(start+2,start+1),edge(start+1,start+3,'After Last')]
});
const readSession=(id)=>node(id,'Get Records','Read session',{
 object:'Cart',recordLimit:'1',outputVariable:'currentSession',
 conditions:[{field:'Id',operator:'Equals',value:'{!cartId}'},
  {field:'UserId',operator:'Equals',value:'{!$User.Id}'},
  {field:'Status',operator:'Equals',value:'Open'}]
});
const readLines=(id)=>node(id,'Get Records','Read cart lines',{
 object:'CartLine',recordLimit:'all',outputVariable:'cartItems',
 conditions:[{field:'Cart',operator:'Equals',value:'{!cartId}'}]
});
const decision=(id,label,conditions,outcome='Valid')=>node(id,'Decision',label,{
 outcomes:[{name:outcome,label:outcome,conditionLogic:'All',conditions}]
});
const exists=ref=>[{field:ref,operator:'IsNotNull'}];
const graph=(apiName,label,elements,connectors,extra=[])=>({
 apiName,label,flowType:'Autolaunched Flow',status:'Active',version:VERSION,
 startConfig:{executionContext:'User'},elements,connectors,
 resources:[...resource,...extra],tests:[]
});
const addTotals=totals(12);

export const SMART_TILL_ADD=graph('SmartTillAddProduct','Smart Till: add selected product to cart',[
 node(1,'Start','Start'),
 decision(2,'Valid session and clicked product?',[
  ...exists('{!sessionKey}'),...exists('{!productId}')]),
 node(3,'Get Records','Read clicked product by ID',{
  object:'Product',recordLimit:'1',outputVariable:'product',
  conditions:[{field:'Id',operator:'Equals',value:'{!productId}'}]}),
 decision(4,'Product found?',exists('{!product}'),'Found'),
 decision(5,'Price available?',[
  {field:'{!product.Price}',operator:'GreaterThanOrEqualTo',value:0}]),
 readSession(6),
 decision(7,'Open session found?',exists('{!currentSession}'),'Found'),
 node(8,'Assignment','Use existing Cart',{
  variable:'cartId',operator:'Assign',value:'{!currentSession.Id}'}),
 node(9,'Create Records','Create Cart when missing',{
  object:'Cart',recordSource:'fields',resultVariable:'cartId',
  fieldValues:[{field:'Name',value:'Smart Till cart'},
   {field:'SessionKey',value:'{!sessionKey}'},{field:'UserId',value:'{!$User.Id}'},
   {field:'Status',value:'Open'}]}),
 node(10,'Create Records','Create CartLine for clicked product',{
  object:'CartLine',recordSource:'fields',resultVariable:'cartLineId',
  fieldValues:[{field:'Cart',value:'{!cartId}'},
   {field:'Product',value:'{!product.Id}'},
   {field:'Name',value:'{!product.Name}'},
   {field:'Quantity',value:1},
   {field:'UnitPrice',value:'{!product.Price}'},
   {field:'OriginalUnitPrice',value:'{!product.Price}'},
   {field:'LineTotal',value:'{!product.Price}'}]}),
 readLines(11),...addTotals.elements,
 node(16,'End','Cart updated'),
 node(20,'Custom Error','Invalid product or session',{
  errorLocation:'Page',errorMessage:'Select an available product with a valid price.'}),
 decision(21,'No Cart selected?', [{field:'{!cartId}',operator:'Equals',value:''}],'New'),
 node(22,'Custom Error','Invalid Cart ID',{errorLocation:'Page',
  errorMessage:'Cart is closed or does not belong to this user.'})
],[
 edge(1,2),edge(2,3,'Valid'),edge(2,20,'Default'),
 edge(3,4),edge(4,5,'Found'),edge(4,20,'Default'),
 edge(5,6,'Valid'),edge(5,20,'Default'),
 edge(6,7),edge(7,8,'Found'),edge(7,21,'Default'),edge(21,9,'New'),edge(21,22,'Default'),edge(22,16),
 edge(8,10),edge(9,10),edge(10,11),edge(11,12),
 ...addTotals.links,edge(15,16)
],[variable('productId','Text',true),{name:'product',type:'Record',dataType:'Product'},
 variable('cartLineId','Text',false,true)]);

export const SMART_TILL_OUTPUTS={
 cartId:'activeCartId',cartItems:'cartItems',
 subtotal:'subtotal',total:'total'
};
export const SMART_TILL_CLICK={
 actionType:'Flow',flowType:'Autolaunched Flow',
 flowApiName:'SmartTillAddProduct',
 inputs:{sessionKey:'$session',cartId:'$session.cartId',productId:'$event.recordId'},
 outputs:SMART_TILL_OUTPUTS
};
const isBound=(b,name)=>b&&typeof b==='object'&&!Array.isArray(b)&&b.flowApiName===name;
const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function smartTillCartBindings(layout){
 const grid=layout.components.find(c=>c.id==='codextill-product-grid');
 const cart=layout.components.find(c=>c.id==='codextill-cart');
 assert(grid?.type==='Custom:smart_card_grid'
  &&grid.properties?.objectApiName==='Product','Expected authored Product Card Grid');
 assert(cart?.type==='Custom:smart_cart'
  &&cart.properties?.objectApiName==='CartLine','Expected authored CartLine Smart Cart');
 let changed=false,skipped=[];
 const components=layout.components.map(c=>{
  if(c.id===grid.id){
   const actions=isObject(c.properties.actionFlows)?c.properties.actionFlows:{};
   const click=actions.click;
   if(isBound(click,'AcetillCopilotAddProduct')||isBound(click,SMART_TILL_CLICK.flowApiName)){
    const next={...click,...SMART_TILL_CLICK};
    if(JSON.stringify(next)!==JSON.stringify(click)){
     changed=true;
     return {...c,properties:{...c.properties,actionFlows:{...actions,click:next}}};
    }
   }else skipped.push('Product Card Grid click is not the expected legacy add Flow');
  }
  if(c.id===cart.id){
   const actions=isObject(c.properties.actionFlows)?c.properties.actionFlows:{};
   const start=actions.start;
   // The shared Smart Cart runtime fetches CartLine by its authorised
   // Cart relation. It prefers pageState.cartId returned by
   // AddProduct and resolves browser SessionKey on reload without a read Flow.
   if((!start||isBound(start,'AcetillCopilotReadCart')
       ||isBound(start,'SmartTillReadCart'))
     &&(!c.properties.relatedFilterKey||c.properties.relatedFilterKey==='cartId')
     &&(!c.properties.relatedFieldApiName||c.properties.relatedFieldApiName==='Cart')){
    const nextActions={...actions};
    delete nextActions.start;
    const props={...c.properties,autoRecordScope:true,actionFlows:nextActions};
    delete props.relatedFilterKey;
    delete props.relatedFieldApiName;
    if(JSON.stringify(props)!==JSON.stringify(c.properties)){
     changed=true;return {...c,properties:props};
    }
   }else skipped.push('Cart has a customised start Flow or related filter');
  }
  return c;
 });
 return {changed,skipped,layout:{...layout,components}};
}
export function validateSmartTillGraph(){
 for(const flow of [SMART_TILL_ADD]){
  assert(!Object.hasOwn(flow,'appApiName'));
  assert.equal(flow.status,'Active');
  const ids=new Set(flow.elements.map(n=>n.id));
  assert.equal(ids.size,flow.elements.length);
  for(const e of flow.connectors)assert(ids.has(e.from)&&ids.has(e.to));
  assert(flow.resources.some(r=>r.name==='cartId'&&r.availableForOutput));
 }
 const product=SMART_TILL_ADD.elements.find(n=>n.id===3);
 assert.equal(product.config.conditions.length,1,'Never hardcode Card Grid Active filters into server Flow');
 assert.deepEqual(product.config.conditions,[{field:'Id',operator:'Equals',value:'{!productId}'}]);
 assert.equal(SMART_TILL_CLICK.inputs.productId,'$event.recordId');
 assert.equal(SMART_TILL_CLICK.inputs.sessionKey,'$session');
}
validateSmartTillGraph();

// This runs in PR CI without touching tenant SQL or mutating any saved Page.
function validateBindings(){
 const layout={layoutMode:'free-canvas',canvasWidth:1400,canvasHeight:900,
  components:[
   {id:'codextill-product-grid',type:'Custom:smart_card_grid',position:{x:10,y:20},
    properties:{objectApiName:'Product',collectionFormula:'=@CatCollection',
     actionFlows:{click:{flowApiName:'AcetillCopilotAddProduct',
      actionType:'Flow',inputs:{productId:'$event.value'}},start:{actionType:'Navigate'}}}},
   {id:'codextill-cart',type:'Custom:smart_cart',position:{x:50,y:70},
    properties:{objectApiName:'CartLine',actionFlows:{start:{
     actionType:'Flow',flowApiName:'AcetillCopilotReadCart'}}}},
   {id:'unrelated',type:'Custom:smart_tabs',position:{x:1},
    properties:{collectionFormula:'=COLLECTION("CatCollection",@Name)'}}
  ]};
 const first=smartTillCartBindings(layout);
 assert(first.changed);
 assert.deepEqual(first.layout.components[2],layout.components[2]);
 assert.deepEqual(first.layout.components.map(c=>c.position),
  layout.components.map(c=>c.position));
 assert.equal(first.layout.components[0].properties.collectionFormula,
  layout.components[0].properties.collectionFormula);
 assert.deepEqual(first.layout.components[0].properties.actionFlows.start,
  layout.components[0].properties.actionFlows.start);
 assert.deepEqual(first.layout.components[0].properties.actionFlows.click.inputs,
  SMART_TILL_CLICK.inputs);
 assert.equal(first.layout.components[1].properties.autoRecordScope,true);
 assert.equal(first.layout.components[1].properties.relatedFilterKey,undefined);
 assert.equal(first.layout.components[1].properties.relatedFieldApiName,undefined);
 assert.equal(first.layout.components[1].properties.actionFlows.start,undefined);
 const again=smartTillCartBindings(first.layout);
 assert.equal(again.changed,false,'Seeder must be idempotent');
 const customised=structuredClone(layout);
 customised.components[0].properties.actionFlows.click.flowApiName='MyCustomFlow';
 const skipped=smartTillCartBindings(customised);
 assert.equal(skipped.layout.components[0].properties.actionFlows.click.flowApiName,'MyCustomFlow');
 assert(skipped.skipped.length>0);
 // Do not replace a customer's separate On Start action.
 const customCart=structuredClone(layout);
 customCart.components[1].properties.actionFlows.start={
  actionType:'Flow',flowApiName:'UserManagedCartFlow'};
 const customisedCart=smartTillCartBindings(customCart);
 assert.equal(customisedCart.layout.components[1].properties.actionFlows.start.flowApiName,
  'UserManagedCartFlow');
 assert(customisedCart.skipped.some(message=>message.includes('Cart')));
 // The new Auto scope keeps all unrelated Cart metadata and is safe to
 // reapply to an already SmartTillAddProduct-bound Card Grid.
 assert.equal(first.layout.components[1].properties.objectApiName,'CartLine');
 assert.deepEqual(first.layout.components[1].position,layout.components[1].position);
}
if(process.argv[1] && process.argv[1]===fileURLToPath(import.meta.url)){
 validateBindings();

if(process.argv.includes('--preflight')){
 console.log('Smart Till standalone Flow and Page metadata preflight passed');
 process.exit(0);
}
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
if(typeof process.getuid==='function'&&process.getuid()===0){
 process.initgroups('metadrive','metadrive');
 process.setgid('metadrive');process.setuid('metadrive');
}
if(typeof process.getuid==='function'&&process.getuid()===0)throw Error('Refusing root SQL connection');

const db=new SqlPersistence(process.env.DATABASE_URL);
try{
 const tenants=await db.query(`SELECT p.tenant_id FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
   WHERE p.api_name='CODEXTILL' AND p.enabled=true
   AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages s
     WHERE s.tenant_id=p.tenant_id AND s.page_id=p.id)`);
 assert.equal(tenants.rows.length,1,'Expected one tenant-owned, editable CODEXTILL Page');
 const tenant=tenants.rows[0].tenant_id;
 await db.transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['smarttill:cart-flows:'+tenant]);
  const prerequisites={
   Product:['Id','Name','Price'],
   Cart:['Name','Status','SessionKey','UserId'],
   CartLine:['Cart','Product','Name','Quantity','UnitPrice','OriginalUnitPrice','LineTotal']
  };
  const fields=await client.query(`SELECT object_api,api_name
    FROM md_field_definitions WHERE tenant_id=$1
    AND object_api IN ('Product','Cart','CartLine')`,[tenant]);
  const known=new Set(fields.rows.map(r=>r.object_api+'.'+r.api_name));
  for(const [object,names] of Object.entries(prerequisites))
   for(const field of names.filter(f=>f!=='Id'))
    assert(known.has(object+'.'+field),'Required shared field missing: '+object+'.'+field);
  for(const flow of [SMART_TILL_ADD]){
   const existing=await client.query(`SELECT id,active FROM md_flow_definitions
    WHERE tenant_id=$1 AND api_name=$2 AND archived=false ORDER BY version DESC LIMIT 1`,
    [tenant,flow.apiName]);
   if(existing.rows.length){
    assert(existing.rows[0].active===true,'Existing Smart Till Flow is inactive: '+flow.apiName);
    const owner=await client.query(`SELECT value_text FROM md_flow_editor_values
      WHERE tenant_id=$1 AND flow_id=$2 AND property_path='/builder/appApiName'`,
      [tenant,existing.rows[0].id]);
    assert(!owner.rows[0]?.value_text,'Existing Smart Till Flow is app-owned: '+flow.apiName);
    console.log(flow.apiName+': existing tenant customisation retained');
    continue;
   }
   const inserted=await client.query(`INSERT INTO md_flow_definitions
    (tenant_id,api_name,label,flow_type,version,active)
    VALUES($1,$2,$3,'Autolaunched Flow',$4,true) RETURNING id`,
    [tenant,flow.apiName,flow.label,VERSION]);
   const values=[];
   encodeMetadataValue(flow,'/builder',values);
   for(const value of values)
    await client.query(`INSERT INTO md_flow_editor_values
     (tenant_id,flow_id,property_path,value_kind,value_text)
     VALUES($1,$2,$3,$4,$5)`,
     [tenant,inserted.rows[0].id,value.path,value.kind,value.text]);
   console.log(flow.apiName+': installed independently of Acetill');
  }
  // Preserve explicit OneEngine/developer/cashier permission assignments.
  // Never assign a policy to a user or bypass Object/Field/Record RBAC.
  for(const [newFlow,oldFlow] of [
   ['SmartTillAddProduct','AcetillCopilotAddProduct']
  ]){
   await client.query(`INSERT INTO md_permission_rules
    (tenant_id,permission_set_id,resource,action,effect)
    SELECT r.tenant_id,r.permission_set_id,$2,'execute','allow'
    FROM md_permission_rules r WHERE r.tenant_id=$1
    AND r.resource=$3 AND r.action='execute' AND r.effect='allow'
    ON CONFLICT DO NOTHING`,[tenant,'Flow:'+newFlow,'Flow:'+oldFlow]);
  }
 });
 const runtime=new PageRuntime(db);
 const before=await runtime.editor(tenant,'CODEXTILL','Desktop');
 const patch=smartTillCartBindings(before);
 if(!patch.changed){
  console.log('Smart Till: no CODEXTILL draft bindings changed. '+patch.skipped.join('; '));
 }else{
  const latest=await runtime.editor(tenant,'CODEXTILL','Desktop');
  assert.deepEqual(latest,before,'CODEXTILL draft changed concurrently; refusing overwrite');
  await runtime.saveLayoutDraft(tenant,'CODEXTILL','Desktop',patch.layout);
  const saved=await runtime.editor(tenant,'CODEXTILL','Desktop');
  const expected=new Map(patch.layout.components.map(c=>[c.id,c]));
  for(const component of saved.components){
   const target=expected.get(component.id);
   assert(target,'Unrelated component removed');
   assert.deepEqual(component.position,target.position,'Page geometry changed');
   if(component.id==='codextill-product-grid'||component.id==='codextill-cart')
    assert.deepEqual(component.properties.actionFlows,target.properties.actionFlows);
  }
  console.log('Smart Till Cart auto-scope enabled, read Flow detached; draft only, publishing remains owner-controlled');
  if(patch.skipped.length)console.log('Preserved customizations: '+patch.skipped.join('; '));
 }
}finally{await db.pool.end();}

}
