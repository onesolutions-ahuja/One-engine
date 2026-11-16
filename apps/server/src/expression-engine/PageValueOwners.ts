import {componentInstanceNames} from '../system-support/page-component-names.js';
import {componentStateName} from './FormulaComponentState.js';

/** Which component saves which page value, read from page metadata only.
 * A value belongs to the first component (page order) whose action saves it:
 * a PageState action, a Formula assignment, a Flow output or a state binding.
 * Builders read it as @ThisPage.<Owner>.<Key>. */
type Component={id:string;type?:string;properties:Readonly<Record<string,unknown>>};
const key=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const record=(value:unknown):Record<string,unknown>|null=>
 value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Formula name of each component (spaces and hyphens become _). */
export function componentFormulaNames(components:readonly Component[]):Map<string,string>{
 const typed=components.every(item=>typeof item.type==='string');
 const names=typed
  ?componentInstanceNames(components as Array<{id:string;type:string;properties:Record<string,unknown>}>)
  :new Map<string,string>();
 const out=new Map<string,string>();
 for(const item of components){
  const name=componentStateName(names.get(item.id)??item.properties.navigatorName);
  if(name)out.set(item.id,name);
 }
 return out;
}

/** Keys one component's actions save (bound=true: also keys it only displays). */
export function savedKeysOf(properties:Readonly<Record<string,unknown>>,bound=false):string[]{
 const keys:string[]=[];
 const add=(value:unknown)=>{if(typeof value==='string'&&key.test(value)&&!keys.includes(value))keys.push(value);};
 const actions=record(properties.actionFlows);
 for(const config of Object.values(actions??{})){
  const binding=record(config);
  if(!binding)continue;
  if(binding.actionType==='PageState')add(binding.stateKey);
  const formula=typeof binding.formula==='string'?binding.formula.trim():'';
  const assigned=/^@(?:state|ThisPage\.[A-Za-z_][A-Za-z0-9_]{0,79})\.([A-Za-z][A-Za-z0-9_]{0,63})\s*:=/i.exec(formula);
  if(binding.actionType==='Formula'&&assigned)add(assigned[1]);
  for(const target of Object.values(record(binding.outputs)??{}))add(target);
 }
 if(bound)for(const target of Object.values(record(properties.stateBindings)??{}))add(target);
 return keys;
}

/** key -> owning component formula name. */
export function pageValueOwners(components:readonly Component[]):Map<string,string>{
 const names=componentFormulaNames(components);
 const owners=new Map<string,string>();
 for(const item of components){
  const owner=names.get(item.id);
  if(!owner)continue;
  for(const saved of savedKeysOf(item.properties))if(!owners.has(saved))owners.set(saved,owner);
 }
 // A value no action saves (e.g. set by a Flow elsewhere) is shown under the
 // first component that displays it.
 for(const item of components){
  const owner=names.get(item.id);
  if(owner)for(const saved of savedKeysOf(item.properties,true))if(!owners.has(saved))owners.set(saved,owner);
 }
 return owners;
}
