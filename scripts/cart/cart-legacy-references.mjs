/**
 * Retire the legacy CartSession object without selecting a random Cart when a
 * browser session owns multiple carts. This module has no DB side effects.
 */
export const hasLegacyCartReference = value =>
  typeof value === 'string' && /CartSession|cartSessionId|activeCartSessionId/.test(value);

/** Flow API names are identifiers, not references to the old data object. */
export function hasActiveLegacyCartReference(value,root=true){
 if(typeof value==='string')return hasLegacyCartReference(value);
 if(Array.isArray(value))return value.some(v=>hasActiveLegacyCartReference(v,false));
 if(!value||typeof value!=='object')return false;
 if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
 return Object.entries(value).some(([key,item])=>{
  if(key==='flowApiName'||key==='subflowApiName'||(root&&key==='apiName'))return false;
  return hasLegacyCartReference(key)||hasActiveLegacyCartReference(item,false);
 });
}

/** Transform an expression or a literal API-name field, not a SQL statement. */
export function rewriteLegacyCartText(text,{page=false,cartIds=new Map()}={}){
 if(typeof text !== 'string')return text;
 let result=text
  // A Cart has no unique SessionKey: every single-record lookup selects Cart.Id.
  .replace(/\bGETRECORD\s*\(\s*(['"]?)CartSession\1\s*,\s*(['"]?)SessionKey\2\s*,\s*([^,()]+)(?=\s*,)/gi,
    (_match,_objectQuote,_fieldQuote,value)=>'GETRECORD(Cart, Id, '+(value.includes('$session')?'$session.cartId':
      value.includes('{!')?'{!cartId}':page?'$session.cartId':'{!cartId}'))
  .replace(/\bGETRECORD\s*\(\s*(['"]?)Cart\1\s*,\s*(['"]?)SessionKey\2\s*,\s*([^,()]+)(?=\s*,)/gi,
    (_match,_objectQuote,_fieldQuote,value)=>'GETRECORD(Cart, Id, '+(value.includes('$session')?'$session.cartId':
      value.includes('{!')?'{!cartId}':page?'$session.cartId':'{!cartId}'))
  .replace(/\$state\.cartSessionId\b/g,'$state.activeCartId')
  .replace(/\$session\.cartSessionId\b/g,'$session.cartId')
  .replace(/\bactiveCartSessionId\b/g,'activeCartId')
  .replace(/\bCartLine\.CartSession\b/g,'CartLine.Cart')
  .replace(/\bCartSession\b/g,'Cart')
  .replace(/\bCartSessionId\b/g,'CartId')
  .replace(/\bcartSessionId\b/g,page?'activeCartId':'cartId');
 for(const [oldId,newId] of cartIds)result=result.replaceAll(oldId,newId);
 return result;
}

/** Fully migrate nested published page/Flow metadata, including saved formulas. */
export function rewriteLegacyCartTree(input,{page=false,cartIds=new Map()}={}){
 if(typeof input==='string')return rewriteLegacyCartText(input,{page,cartIds});
 if(Array.isArray(input))return input.map(v=>rewriteLegacyCartTree(v,{page,cartIds}));
 if(!input||typeof input!=='object')return input;
 // PageRuntime metadata can include Date instances; preserve non-plain values.
 if(Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null)return input;
 const result={};
 for(const [key,value] of Object.entries(input)){
  const nextKey=rewriteLegacyCartText(key,{page,cartIds});
  if(Object.hasOwn(result,nextKey))throw Error('Legacy Cart key collides with existing key: '+nextKey);
  result[nextKey]=key==='flowApiName'||key==='subflowApiName'?value:
   rewriteLegacyCartTree(value,{page,cartIds});
 }
 return result;
}

/** Preserve a tenant's custom Flow graph; change the parent/link and no other logic. */
export function rewriteLegacyCartFlow(graph,{cartIds=new Map()}={}){
 if(!graph||typeof graph!=='object'||Array.isArray(graph))throw Error('Invalid Flow graph');
 const migrated=rewriteLegacyCartTree(graph,{cartIds});
 if(Object.hasOwn(graph,'apiName'))migrated.apiName=graph.apiName;
 const changed=JSON.stringify(graph)!==JSON.stringify(migrated);
 if(!changed)return {graph,changed:false};
 const nodes=Array.isArray(migrated.elements)?migrated.elements:[];
 let needsCartInput=false;
 for(const node of nodes){
  if(!node||typeof node!=='object'||!node.config)continue;
  const cfg=node.config;
  const old=graph.elements?.find?.(x=>x?.id===node.id);
  const fromSession=old?.config?.object==='CartSession';
  if(node.type==='Get Records'&&fromSession&&Array.isArray(cfg.conditions)){
   if(cfg.recordLimit!=='all'){
   for(const condition of cfg.conditions){
    if(condition.field==='SessionKey' &&
      /^(?:\{!sessionKey\}|\$session(?:\.id)?)$/.test(String(condition.value))){
     condition.field='Id';condition.value='{!cartId}';needsCartInput=true;
    }
   }
   }
   // Even multi-cart queries are user-scoped; a shared browser token is not ownership.
   if(!cfg.conditions.some(c=>c.field==='UserId')){
    cfg.conditions.push({field:'UserId',operator:'Equals',value:'{!$User.Id}'});
   }
  }
  if(node.type==='Create Records'&&fromSession&&cfg.object==='Cart'
      &&Array.isArray(cfg.fieldValues)&&
      !cfg.fieldValues.some(f=>f.field==='UserId')){
   cfg.fieldValues.push({field:'UserId',value:'{!$User.Id}'});
  }
 }
 if(needsCartInput){
  if(!Array.isArray(migrated.resources))throw Error('Legacy Cart Flow lacks resource definitions');
  let selected=migrated.resources.find(r=>r.name==='cartId');
  if(!selected){
   selected={name:'cartId',type:'Variable',dataType:'Text',availableForInput:true,availableForOutput:true};
   migrated.resources.push(selected);
  }else selected.availableForInput=true;
 }
 if(hasActiveLegacyCartReference(migrated))
  throw Error('Legacy CartSession Flow reference remains after conversion');
 return {graph:migrated,changed:true};
}

/** Convert all user-authored component formulas, bindings and Cart grids. */
export function rewriteLegacyCartPage(page,{cartIds=new Map()}={}){
 if(!page||typeof page!=='object'||Array.isArray(page))throw Error('Invalid Page metadata');
 const rewritten=rewriteLegacyCartTree(page,{page:true,cartIds});
 if(Object.hasOwn(page,'apiName'))rewritten.apiName=page.apiName;
 const components=rewritten.components;
 if(Array.isArray(components)){
  for(const c of components){
   const p=c?.properties;
   if(!p||typeof p!=='object')continue;
   if(p.relatedFilterKey==='activeCartId'&&p.relatedFieldApiName==='Cart')
    p.autoRecordScope=false; // never fall back to SessionKey when several Carts exist
   if(p.actionFlows&&typeof p.actionFlows==='object'){
    for(const action of Object.values(p.actionFlows)){
     if(!action||typeof action!=='object')continue;
     if(action.inputs&&typeof action.inputs==='object'&&Object.hasOwn(action.inputs,'activeCartId')){
      action.inputs.cartId='$session.cartId';
      delete action.inputs.activeCartId;
     }
     if(action.outputs&&typeof action.outputs==='object'&&Object.hasOwn(action.outputs,'activeCartId')){
      action.outputs.cartId='activeCartId';
      delete action.outputs.activeCartId;
     }
    }
   }
  }
 }
 if(hasActiveLegacyCartReference(rewritten))
  throw Error('Legacy CartSession Page reference remains after conversion');
 return {page:rewritten,changed:JSON.stringify(page)!==JSON.stringify(rewritten)};
}

/** Resolve stable record-ID pointers after the data copy, scoped to one tenant. */
export async function loadLegacyCartIdMap(db,tenant){
 const {rows:tables}=await db.query("SELECT to_regclass('md_cart_session_migration_map') AS name");
 if(!tables[0]?.name)return new Map();
 const {rows}=await db.query(
  'SELECT legacy_session_id,cart_id FROM md_cart_session_migration_map WHERE tenant_id=$1',[tenant]);
 return new Map(rows.map(row=>[String(row.legacy_session_id),String(row.cart_id)]));
}
