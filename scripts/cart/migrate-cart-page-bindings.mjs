/**
 * Move saved CartLine components from CartSession to the active Cart.
 * Defaults to read-only; --apply saves drafts; --publish publishes changed
 * variants after explicit operator instruction and should follow Flow upgrade.
 */
import assert from 'node:assert/strict';
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../../apps/server/dist-system/system-files/page-runtime.js';
import {rewriteLegacyCartPage,loadLegacyCartIdMap} from './cart-legacy-references.mjs';

const conn=process.env.DATABASE_URL??process.env.METADRIVE_DATABASE_URL;
if(!conn)throw Error('DATABASE_URL is required');
const apply=process.argv.includes('--apply'),publish=process.argv.includes('--publish');
if(publish&&!apply)throw Error('--publish requires --apply');
const db=new SqlPersistence(conn);
const runtime=new PageRuntime(db);
const variants=['Desktop','Tablet','Mobile','Custom'];
const checkout=new Set(['AcetillPaymentCash','AcetillPaymentCard']);
const known=new Set(['AcetillCopilotReadCart','AcetillCopilotAddProduct',
 'AcetillCopilotChangeQuantity','SmartTillAddProduct','AcetillHoldCart',
 'AcetillResumeHeldCart',...checkout]);
const migrated=(action,component)=>{
 if(!action||typeof action!=='object'||Array.isArray(action))return action;
 const a=structuredClone(action),name=String(a.flowApiName??'');
 if(!known.has(name))return a;
 if(name==='AcetillCopilotReadCart'&&component.label==='New sale'){
  a.flowApiName='AcetillCopilotNewCart';
  a.inputs={sessionKey:'$session'};
  a.outputs={cartId:'activeCartId'};
  delete a.resetSessionOnSuccess;
  return a;
 }
 const inputs=a.inputs&&typeof a.inputs==='object'&&!Array.isArray(a.inputs)?a.inputs:{};
 const outputs=a.outputs&&typeof a.outputs==='object'&&!Array.isArray(a.outputs)?a.outputs:{};
 if(name==='AcetillCopilotReadCart'||name==='AcetillCopilotChangeQuantity')
  delete inputs.sessionKey;
 if(name==='AcetillCopilotReadCart'||name==='AcetillCopilotAddProduct'||
   name==='AcetillCopilotChangeQuantity'||name==='SmartTillAddProduct')
  inputs.cartId='$session.cartId';
 if(name==='AcetillHoldCart'){
  inputs.cartId='$session.cartId';
  a.successState={...(a.successState??{}),activeCartId:null};
  delete a.resetSessionOnSuccess;
 }
 if(checkout.has(name)){
  inputs.cartId='$session.cartId';
  inputs.requestId='$session.cartId';
  a.successState={...(a.successState??{}),activeCartId:null};
 }
 if(name==='AcetillResumeHeldCart')outputs.cartId='activeCartId';
 if(Object.hasOwn(outputs,'cartSessionId')){
  delete outputs.cartSessionId;
  outputs.cartId='activeCartId';
 }
 if(['AcetillCopilotReadCart','AcetillCopilotAddProduct','AcetillCopilotChangeQuantity','SmartTillAddProduct'].includes(name))
  outputs.cartId='activeCartId';
 a.inputs=inputs;a.outputs=outputs;
 return a;
};
function patchComponent(component){
 const p=component.properties;
 if(!p||typeof p!=='object'||Array.isArray(p))return component;
 const cart=p.objectApiName==='CartLine';
 const legacySessionGrid=p.objectApiName==='CartSession';
 const oldLink=p.relatedFieldApiName==='CartSession' || p.relatedFilterKey==='cartSessionId';
 const actions=p.actionFlows&&typeof p.actionFlows==='object'&&!Array.isArray(p.actionFlows)
  ?p.actionFlows:{};
 const oldActions=Object.values(actions).some(a=>a&&typeof a==='object'&&known.has(String(a.flowApiName??'')));
 if(!legacySessionGrid&&!oldLink&&!oldActions)return component;
 const props=structuredClone(p);
 if(legacySessionGrid)props.objectApiName='Cart';
 if(cart&&oldLink){
  props.relatedFieldApiName='Cart';
  props.relatedFilterKey='activeCartId';
  props.autoRecordScope=false;
 }
 if(oldActions){
  props.actionFlows={...actions};
  for(const [event,action] of Object.entries(actions))
   props.actionFlows[event]=migrated(action,component);
 }
 return {...component,properties:props};
}
try{
 const pages=await db.query(`
  SELECT DISTINCT p.tenant_id,p.api_name FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
  WHERE p.enabled=true ORDER BY p.tenant_id,p.api_name`);
 const output=[],maps=new Map();
 for(const {tenant_id:tenant,api_name:page} of pages.rows){
  if(!maps.has(tenant))maps.set(tenant,await loadLegacyCartIdMap(db,tenant));
  const cartIds=maps.get(tenant);
  for(const variant of variants){
   let current;
   try{current=await runtime.editor(tenant,page,variant);}catch(error){
    if(error instanceof Error && /not found|not configured/i.test(error.message))continue;
    throw error;
   }
   if(!Array.isArray(current.components))continue;
   const components=current.components.map(patchComponent);
   const {page:converted,changed}=rewriteLegacyCartPage({...current,components},{cartIds});
   if(!changed&&JSON.stringify(components)===JSON.stringify(current.components))continue;
   const legacy=converted.components.filter(c=>c.properties?.objectApiName==='CartLine'
     &&(c.properties?.relatedFieldApiName==='CartSession'||c.properties?.relatedFilterKey==='cartSessionId'));
   assert.equal(legacy.length,0,'Legacy CartLine binding remains');
   output.push({tenant,page,variant,changed:converted.components.filter((c,i)=>JSON.stringify(c)!==JSON.stringify(current.components[i])).length});
   if(!apply)continue;
   const reloaded=await runtime.editor(tenant,page,variant);
   assert.deepEqual(reloaded,current,'Page draft changed during migration');
   await runtime.saveLayoutDraft(tenant,page,variant,converted);
   if(publish)await runtime.publishLayout(tenant,page,variant);
  }
 }
 console.log(JSON.stringify({mode:publish?'published':apply?'drafted':'preflight',pages:output},null,2));
}finally{await db.close();}
