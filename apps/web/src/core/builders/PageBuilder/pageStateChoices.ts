import {componentInstanceNames} from '../../../../../server/src/system-support/page-component-names';
import {componentStateName} from '../../../../../server/src/expression-engine/FormulaComponentState';
type SourceComponent={id:string;type?:string;properties:Record<string,unknown>};
export type PageStateChoice={source:'PageState'|'CollectionState';key:string;label:string};
/** List metadata-declared state channels, not arbitrary strings or object data.
 * Stable names survive component renames and are scoped to the current page. */
export function pageStateChoices(components:readonly SourceComponent[]):PageStateChoice[]{
 const entries=new Map<string,PageStateChoice>();
 const add=(item:PageStateChoice)=>entries.set(item.source+':'+item.key,item);
 for(const component of components){
  const props=component.properties;
  const actions=props.actionFlows;
  if(actions&&typeof actions==='object'&&!Array.isArray(actions)){
   for(const config of Object.values(actions)){
    if(!config||typeof config!=='object'||Array.isArray(config))continue;
    const binding=config as Record<string,unknown>;
    const key=binding.actionType==='PageState'?binding.stateKey:undefined;
    if(typeof key==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
      add({source:'PageState',key,label:key});
    // Formula actions and Flow outputs also create declared page-state channels.
    // Surface the same keys in the Formula Bar without exposing live values.
    const formula=typeof binding.formula==='string'?binding.formula.trim():'';
    const assigned=/^@state\.([A-Za-z][A-Za-z0-9_]{0,63})\s*:=/.exec(formula);
    if(binding.actionType==='Formula'&&assigned)
     add({source:'PageState',key:assigned[1],label:assigned[1]});
    const outputs=binding.outputs;
    if(outputs&&typeof outputs==='object'&&!Array.isArray(outputs))
     for(const target of Object.values(outputs))
      if(typeof target==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(target))
       add({source:'PageState',key:target,label:target});
   }
  }
  const bindings=props.stateBindings;
  if(bindings&&typeof bindings==='object'&&!Array.isArray(bindings))
   for(const key of Object.values(bindings))
    if(typeof key==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
     add({source:'PageState',key,label:key});
 }
 // What each component publishes when the user picks, types or toggles:
 // @CategoryTabs.state.Id / Value / Name / Text.
 const names=components.every(item=>typeof item.type==='string')
  ?componentInstanceNames(components as Array<{id:string;type:string;properties:Record<string,unknown>}>)
  :new Map<string,string>();
 for(const component of components){
  const name=componentStateName(names.get(component.id)??component.properties.navigatorName);
  if(name)for(const field of ['Id','Value','Name','Text'])
   add({source:'CollectionState',key:name+'.state.'+field,label:name+'.state.'+field});
 }
 return [...entries.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
