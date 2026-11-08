/** One Desktop parent and compact, inheriting per-device overrides.
 * Pure metadata operations; no app logic, builder code or runtime state.
 * The SQL layout version owns the override lifetime and publish boundary. */
export type InheritedComponent=Record<string,unknown>&{
 id:string;type:string;label:string;properties:Record<string,unknown>;
 region?:string;visible?:boolean;
};
type DeviceMarker={
 kind:'override'|'added'|'removed';
 fields?:string[];
 clearedProperties?:string[];
 clearedExtra?:string[];
 order?:number;
};
const MARKER='__deviceLayout';
/** Engine wiring and bindings are inherited, never device-specific.
 * Additional Data/Actions keys come from the SQL Ribbon property registry. */
const sharedWiring=new Set(['actionFlows','actions','interactions','dataBindings',
 'dataBinding','binding','bindings','objectApiName','fieldApiName','contextApiName',
 'flowApiName','eventHandlers','eventBindings',
 'query','recordQuery','dataSource','formula','formulaExpression']);
const visualOnly=(properties:Record<string,unknown>,shared:ReadonlySet<string>)=>
 Object.fromEntries(Object.entries(properties).filter(([key])=>
  !sharedWiring.has(key)&&!shared.has(key)));
const rootKeys=new Set(['id','type','label','region','visible','properties',MARKER]);
const unsafe=new Set(['__proto__','prototype','constructor']);
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const clone=<T>(value:T):T=>structuredClone(value);
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
const own=(value:Record<string,unknown>,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
const pointer=(path:string,key:string)=>path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1');
const extras=(component:InheritedComponent):Record<string,unknown>=>Object.fromEntries(
 Object.entries(component).filter(([key])=>!rootKeys.has(key)));

/** An absent property means inherit. Explicit null remains an actual value.
 * Removed paths are recorded separately, so clearing an inherited setting works. */
function differences(parent:unknown,edited:unknown,cleared:string[],path=''):unknown{
 if(equal(parent,edited))return undefined;
 if(!record(parent)||!record(edited))return clone(edited);
 const output:Record<string,unknown>={};
 for(const [key,value] of Object.entries(edited)){
  if(unsafe.has(key))throw Error('Invalid device layout property');
  if(!own(parent,key)){output[key]=clone(value);continue;}
  const change=differences(parent[key],value,cleared,pointer(path,key));
  if(change!==undefined)output[key]=change;
 }
 for(const key of Object.keys(parent))if(!own(edited,key))cleared.push(pointer(path,key));
 return Object.keys(output).length?output:undefined;
}
function overlay(parent:unknown,changes:unknown):unknown{
 if(changes===undefined)return clone(parent);
 if(!record(parent)||!record(changes))return clone(changes);
 const result=clone(parent);
 for(const [key,value] of Object.entries(changes)){
  if(unsafe.has(key))throw Error('Invalid device layout property');
  result[key]=overlay(result[key],value);
 }
 return result;
}
function clearPaths(data:Record<string,unknown>,paths:readonly string[]=[]){
 for(const path of paths){
  const parts=path.split('/').slice(1).map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'));
  if(!parts.length||parts.some(key=>unsafe.has(key)))throw Error('Invalid device layout clear path');
  let target:unknown=data;
  for(const key of parts.slice(0,-1))target=record(target)?target[key]:undefined;
  if(record(target))delete target[parts[parts.length-1]];
 }
}
/** Store only actual device differences. Newly added Desktop nodes are absent
 * from the delta and therefore automatically appear on every child layout. */
export function createDeviceComponentOverrides(
 desktop:readonly InheritedComponent[],edited:readonly InheritedComponent[],
 sharedPropertyKeys:ReadonlySet<string>=new Set()
):InheritedComponent[]{
 const parent=new Map(desktop.map(item=>[item.id,item]));
 const selected=new Map(edited.map(item=>[item.id,item]));
 if(selected.size!==edited.length)throw Error('Duplicate device layout component');
 const commonDesktop=desktop.filter(item=>selected.has(item.id)).map(item=>item.id);
 const commonEdited=edited.filter(item=>parent.has(item.id)).map(item=>item.id);
 const orderChanged=!equal(commonDesktop,commonEdited);
 const overrides:InheritedComponent[]=[];
 for(const item of desktop)if(!selected.has(item.id))overrides.push({
  id:item.id,type:item.type,label:item.label,properties:{},
  [MARKER]:{kind:'removed'} satisfies DeviceMarker
 });
 for(const [index,item] of edited.entries()){
  const baseline=parent.get(item.id);
  if(!baseline){
   overrides.push({...clone(item),[MARKER]:{kind:'added',...(orderChanged?{order:index}:{})} satisfies DeviceMarker});
   continue;
  }
  if(item.type!==baseline.type)throw Error('Device layout cannot change a shared component type');
  const clearedProperties:string[]=[],clearedExtra:string[]=[];
  const props=differences(visualOnly(baseline.properties??{},sharedPropertyKeys),
   visualOnly(item.properties??{},sharedPropertyKeys),clearedProperties) as Record<string,unknown>|undefined;
  const extra=differences(visualOnly(extras(baseline),sharedPropertyKeys),
   visualOnly(extras(item),sharedPropertyKeys),clearedExtra) as Record<string,unknown>|undefined;
  const fields=['label','region','visible'].filter(key=>!equal(baseline[key],item[key]));
  if(!props&&!extra&&!fields.length&&!clearedProperties.length&&!clearedExtra.length&&!orderChanged)continue;
  overrides.push({
   id:item.id,type:item.type,label:item.label||baseline.label,
   region:item.region??baseline.region,visible:item.visible!==false,
   properties:props??{},...extra,
   [MARKER]:{kind:'override',...(fields.length?{fields}:{}),
    ...(clearedProperties.length?{clearedProperties}:{}),
    ...(clearedExtra.length?{clearedExtra}:{}),
    ...(orderChanged?{order:index}:{})} satisfies DeviceMarker
  });
 }
 return overrides;
}
/** Resolve the selected variant against its Desktop draft or published version,
 * never against an unpublished Desktop draft at live runtime. */
export function applyDeviceComponentOverrides(
 desktop:readonly InheritedComponent[],changes:readonly InheritedComponent[]
):InheritedComponent[]{
 const result=new Map(desktop.map(item=>[item.id,clone(item)]));
 const preferred=new Map<string,number>();
 for(const change of changes){
  const marker=change[MARKER] as DeviceMarker|undefined;
  if(!marker)throw Error('Invalid device layout override marker');
  if(marker.kind==='removed'){result.delete(change.id);continue;}
  if(marker.kind==='added'){
   const added=clone(change);delete added[MARKER];result.set(change.id,added);
  }else{
   const parent=result.get(change.id);
   if(!parent)continue; // Desktop removal wins; do not resurrect deleted shared nodes.
   if(parent.type!==change.type)continue;
   const merged:InheritedComponent={...parent,
    properties:overlay(parent.properties??{},change.properties??{}) as Record<string,unknown>};
   const nextExtra=overlay(extras(parent),extras(change)) as Record<string,unknown>;
   clearPaths(merged.properties,marker.clearedProperties);
   clearPaths(nextExtra,marker.clearedExtra);
   // Clearing an inherited extra (such as a canvas position) must really
   // remove it; assigning onto the parent would retain the old value.
   for(const key of Object.keys(extras(parent)))delete merged[key];
   Object.assign(merged,nextExtra);
   for(const field of marker.fields??[]){
    if(!['label','region','visible'].includes(field))throw Error('Invalid device layout override field');
    if(own(change,field))merged[field]=clone(change[field]);
    else delete merged[field];
   }
   result.set(change.id,merged);
  }
  if(marker.order!==undefined){
   if(!Number.isSafeInteger(marker.order)||marker.order<0)throw Error('Invalid device layout sort order');
   preferred.set(change.id,marker.order);
  }
 }
 const order=[...result.values()];
 if(preferred.size){
  const original=new Map(order.map((component,index)=>[component.id,index]));
  order.sort((a,b)=>(preferred.get(a.id)??(desktop.length+(original.get(a.id)??0)))
   -(preferred.get(b.id)??(desktop.length+(original.get(b.id)??0))));
 }
 return order;
}
