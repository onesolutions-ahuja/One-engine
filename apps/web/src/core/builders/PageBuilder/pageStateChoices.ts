import {pageValueOwners,componentFormulaNames,savedKeysOf} from '../../../../../server/src/expression-engine/PageValueOwners';
type SourceComponent={id:string;type?:string;properties:Record<string,unknown>};
/** PageState: a value an action saves (key = stored key, owner = saving component).
 * CollectionState: what a component publishes when picked (key = Name.state.Field,
 * the stored filter key). Labels are the formula a builder writes. */
export type PageStateChoice={source:'PageState'|'CollectionState';key:string;label:string;owner?:string};
/** List metadata-declared page values, not arbitrary strings or object data.
 * Stable names survive component renames and are scoped to the current page. */
export function pageStateChoices(components:readonly SourceComponent[]):PageStateChoice[]{
 const entries=new Map<string,PageStateChoice>();
 const add=(item:PageStateChoice)=>entries.set(item.source+':'+item.key,item);
 const owners=pageValueOwners(components);
 for(const component of components)
  for(const key of savedKeysOf(component.properties,true)){
   const owner=owners.get(key);
   if(owner)add({source:'PageState',key,owner,label:'@ThisPage.'+owner+'.'+key});
  }
 // What each component publishes when the user picks, types or toggles:
 // @ThisPage.CategoryTabs.Selected.Id / Value / Name / Text.
 const names=componentFormulaNames(components);
 for(const component of components){
  const name=names.get(component.id);
  if(name)for(const field of ['Id','Value','Name','Text'])
   add({source:'CollectionState',key:name+'.state.'+field,owner:name,label:'@ThisPage.'+name+'.Selected.'+field});
 }
 return [...entries.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
