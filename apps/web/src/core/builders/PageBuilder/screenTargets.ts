import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
import {childrenOf, multiPageName, multiPageTabId} from '../../pages/TemplatePageRuntime/pageComponentLayout';
import type {ScreenTarget} from './actionArgumentSuggestions';
import type {PageLayoutSummary} from './pageLayoutSummary';
import {MULTIPAGE_TYPE} from './multiPageBuilder';

/** The MultiPages of one page's components, with their tabs (id = the tab's own number). */
export function screenTargetsOf(components:readonly PageComponentMetadata[]):ScreenTarget[]{
 const all=[...components];
 return all.filter(item=>item.type===MULTIPAGE_TYPE).map(multiPage=>{
  const tabs=childrenOf(all,multiPage.id);
  return {name:multiPageName(multiPage),tabs:tabs.map(tab=>({id:multiPageTabId(tab,tabs),label:tab.label}))};
 });
}
/** SCREEN(page, ...) suggestions: the MultiPages of every layout of that page that has a design
 * (Desktop when none has), merged by name. */
export async function loadScreenTargets(request:<T>(path:string)=>Promise<T>,page:string):Promise<ScreenTarget[]>{
 const {pages}=await request<{pages:PageLayoutSummary[]}>('/metadata/page-layout-summaries?pages='+encodeURIComponent(page));
 const designed=(pages[0]?.layouts??[]).filter(item=>item.authored&&item.components>0).map(item=>item.variant);
 const variants=designed.length?designed:['Desktop'];
 const found=new Map<string,ScreenTarget>();
 for(const variant of variants){
  const result=await request<{page:{components?:PageComponentMetadata[]}}>(
   '/metadata/pages/'+encodeURIComponent(page)+'/layouts/'+variant+'/editor').catch(()=>null);
  for(const target of screenTargetsOf(result?.page.components??[])){
   const old=found.get(target.name.toLowerCase());
   const tabs=new Map((old?.tabs??[]).map(tab=>[tab.id,tab]));
   for(const tab of target.tabs)if(!tabs.has(tab.id))tabs.set(tab.id,tab);
   found.set(target.name.toLowerCase(),{name:old?.name??target.name,tabs:[...tabs.values()].sort((a,b)=>a.id-b.id)});
  }
 }
 return [...found.values()];
}
