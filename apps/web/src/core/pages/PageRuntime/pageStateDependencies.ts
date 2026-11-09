import {componentInstanceNames} from '../../../../../server/src/system-support/page-component-names.js';
import {componentStateName} from '../../../../../server/src/expression-engine/FormulaComponentState.js';
import {namedCollectionNames} from './pageCollectionSession';
import {activePageRecordFilters} from './pageComponentBindings';

/** Dependency channels are derived from published Page metadata, not app names. */
type Component = {id:string;type?:string;properties:Readonly<Record<string,unknown>>};
type Channel = string;
export type PageStateDependencies = ReadonlyMap<Channel,ReadonlySet<Channel>>;
const identifier=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const state=(name:string):Channel=>'state:'+name;
const collection=(name:string):Channel=>'collection:'+name.toLowerCase();

function references(formula:unknown,inputs:Set<Channel>,available:ReadonlySet<string>):void {
 if(typeof formula!=='string')return;
 for(const match of formula.matchAll(/(?:\$state\.|@state\.)([A-Za-z][A-Za-z0-9_]{0,63})\b/g))
  inputs.add(state(match[1]));
 for(const match of formula.matchAll(/@([A-Za-z][A-Za-z0-9_]{0,79})\.state\.(?:Id|Name|Value|Text|Field|Criteria)\b/gi))
  inputs.add(collection(match[1]));
 // Direct @NamedCollection reads are dependencies too, including nested IFs.
 for(const match of formula.matchAll(/@([A-Za-z][A-Za-z0-9_]{0,79})(?![.\w])/g))
  if(available.has(match[1].toLowerCase()))inputs.add(collection(match[1]));
}

/** Build a directed dependency graph across any number of tabs/collection layers.
 * A component that reads an upstream state is responsible only for its own
 * selection outputs; independent siblings, cart data and other state survive.
 */
export function pageStateDependencies(components:readonly Component[]):PageStateDependencies {
 const graph=new Map<Channel,Set<Channel>>();
 const emitted=(props:Readonly<Record<string,unknown>>):string[]=>{
  const authored=Object.entries(props).filter(([key])=>key!=='collectionFormula')
   .flatMap(([,value])=>namedCollectionNames(value));
  return authored.length?authored:namedCollectionNames(props.collectionFormula);
 };
 const available=new Set(components.flatMap(item=>emitted(item.properties)
  .map(name=>name.replace(/ +/g,'_').toLowerCase())));
 // Every component also publishes its own value under its page name
 // (@CategoryTabs.state.Id), so picking a parent clears what depends on it.
 const instanceNames=components.every(item=>typeof item.type==='string')
  ?componentInstanceNames(components as Array<{id:string;type:string;properties:Record<string,unknown>}>)
  :new Map<string,string>();
 for(const {id,properties:props} of components){
  const inputs=new Set<Channel>(),outputs=new Set<Channel>();
  const own=componentStateName(instanceNames.get(id)??props.navigatorName);
  if(own)outputs.add(collection(own));
  const declared=typeof props.collectionFormula==='string'?props.collectionFormula:'';
  const names=[...new Set(emitted(props))];
  for(const name of names)outputs.add(collection(name));

  const active=activePageRecordFilters(props);
  if(Array.isArray(active.filters))for(const entry of active.filters){
   if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
   const value=(entry as {value?:unknown}).value;
   if(!value||typeof value!=='object'||Array.isArray(value))continue;
   const source=value as {source?:unknown;key?:unknown};
   if(typeof source.key!=='string')continue;
   if(source.source==='PageState'&&identifier.test(source.key))
    inputs.add(state(source.key));
   if(source.source==='CollectionState'){
    const match=/^([A-Za-z][A-Za-z0-9_]{0,79})\.state\.(Id|Name|Value|Text|Field|Criteria)$/i.exec(source.key);
    if(match)inputs.add(collection(match[1]));
   }
  }
  references(active.formula,inputs,available);
  references(declared,inputs,available);
  // A named Collection can be authored in any formula-capable Data property.
  // Dependencies on selected parent collections also work in those properties.
  for(const [key,value] of Object.entries(props))
   if(key!=='collectionFormula'&&key!=='filterFormula')references(value,inputs,available);
  if(typeof props.relatedFilterKey==='string'&&identifier.test(props.relatedFilterKey))
   inputs.add(state(props.relatedFilterKey));

  const actions=props.actionFlows;
  if(actions&&typeof actions==='object'&&!Array.isArray(actions))
   for(const [event,raw] of Object.entries(actions)){
    if(!['change','select','itemSelect','rowSelect','click','itemClick','rowClick'].includes(event)
      ||!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const action=raw as {actionType?:unknown;stateKey?:unknown;formula?:unknown;outputs?:unknown};
    if(action.actionType==='PageState'&&typeof action.stateKey==='string'
      &&identifier.test(action.stateKey))outputs.add(state(action.stateKey));
    if(action.actionType==='Flow'&&action.outputs&&typeof action.outputs==='object'
      &&!Array.isArray(action.outputs))
     for(const key of Object.values(action.outputs))
      if(typeof key==='string'&&identifier.test(key))outputs.add(state(key));
    if(action.actionType==='Formula'&&typeof action.formula==='string'){
     const assignment=/^@state\.([A-Za-z][A-Za-z0-9_]{0,63})\s*:=/.exec(action.formula.trim());
     if(assignment)outputs.add(state(assignment[1]));
    }
   }
  for(const input of inputs)for(const output of outputs){
   if(input===output)continue;
   if(!graph.has(input))graph.set(input,new Set());
   graph.get(input)!.add(output);
  }
 }
 return graph;
}

type SelectionChange =
 |{kind:'state';key:string;value:unknown}
 |{kind:'collection';key:string;value:Readonly<Record<string,unknown>>};

/** Apply selection and invalidate only the transitive descendants.
 * Called by both App Page and Record/Builder Page Runtimes on their existing
 * page-scoped events; no additional event bus or persisted runtime state.
 */
export function applyPageSelection(
 previous:Readonly<Record<string,unknown>>,change:SelectionChange,
 dependencies:PageStateDependencies
):Record<string,unknown>{
 if(!identifier.test(change.key))return previous as Record<string,unknown>;
 const currentSelections=previous.collectionSelections;
 const selections=currentSelections&&typeof currentSelections==='object'
   &&!Array.isArray(currentSelections)
   ?currentSelections as Record<string,unknown>:{};
 const previousCollectionKey=change.kind==='collection'
   ?Object.keys(selections).find(key=>key.toLowerCase()===change.key.toLowerCase()):undefined;
 const oldValue=change.kind==='state'?previous[change.key]
   :previousCollectionKey?selections[previousCollectionKey]:undefined;
 const same=change.kind==='state'?Object.is(oldValue,change.value)
   :JSON.stringify(oldValue)===JSON.stringify(change.value);
 if(same)return previous as Record<string,unknown>;

 const next:Record<string,unknown>={...previous};
 const nextSelections:Record<string,unknown>={...selections};
 if(change.kind==='state')next[change.key]=change.value;
 else{
  if(previousCollectionKey)delete nextSelections[previousCollectionKey];
  nextSelections[change.key]=change.value;
 }
 const root=change.kind==='state'?state(change.key):collection(change.key);
 const visited=new Set<Channel>([root]),pending=[root];
 while(pending.length){
  const parent=pending.shift()!;
  for(const child of dependencies.get(parent)??[]){
   if(visited.has(child))continue;
   visited.add(child);
   pending.push(child);
   if(child.startsWith('state:'))delete next[child.slice(6)];
   else if(child.startsWith('collection:'))
    for(const name of Object.keys(nextSelections))
     if(name.toLowerCase()===child.slice(11))delete nextSelections[name];
  }
 }
 if(change.kind==='collection'||visited.size>1)next.collectionSelections=nextSelections;
 return next;
}

/** Shared with the server-side page compiler. */
import {implicitPageStateKeys} from '../../../../../server/src/page-compiler/pageCompilerSupport.js';
export {implicitPageStateKeys};

/** Names whose value differs between two page states (top-level keys and
 * named collection selections). */
export function changedPageStateNames(
 previous:Readonly<Record<string,unknown>>,next:Readonly<Record<string,unknown>>
):string[]{
 const names=new Set<string>();
 for(const key of new Set([...Object.keys(previous),...Object.keys(next)])){
  if(key==='collectionSelections')continue;
  if(!Object.is(previous[key],next[key]))names.add(key);
 }
 const sel=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:{};
 const a=sel(previous.collectionSelections),b=sel(next.collectionSelections);
 for(const key of new Set([...Object.keys(a),...Object.keys(b)]))
  if(JSON.stringify(a[key])!==JSON.stringify(b[key]))names.add(key);
 return [...names];
}

/** True when a component's authored properties (formulas, filters, actions,
 * bindings) or its implicit scoping keys could read one of the changed names.
 * Conservative: any whole-word mention counts, case-insensitively. */
export function pageStateChangeIsRelevant(
 propertiesText:string,implicitKeys:ReadonlySet<string>,changed:readonly string[]
):boolean{
 const text=propertiesText.toLowerCase();
 return changed.some(name=>{
  if(implicitKeys.has(name))return true;
  const needle=name.toLowerCase().replace(/ +/g,'_');
  let at=text.indexOf(needle);
  while(at>=0){
   const before=text.charCodeAt(at-1),after=text.charCodeAt(at+needle.length);
   const word=(c:number)=>(c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===95;
   if(!word(before)&&!word(after))return true;
   at=text.indexOf(needle,at+1);
  }
  return false;
 });
}
