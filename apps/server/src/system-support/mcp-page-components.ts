/**
 * Small, named edits to a Page Builder page for MCP clients.
 *
 * Reading or saving a whole layout sends every component (tens of KB) for a
 * one-property fix, which is slow and easy to get wrong. These helpers find
 * components by id or navigator name, change only the named properties, and
 * keep every layout variant in step:
 *  - Desktop holds the wiring (formulas, data, actions) that device layouts inherit,
 *    so it is changed first;
 *  - each device layout the page uses is then saved again on top of that Desktop
 *    draft (inheriting layouts must be re-based or they keep the old wiring);
 *  - standalone device layouts get the same edits directly.
 * Every save is a normal versioned draft; publishing is optional and uses the
 * shared revision check, so older versions stay in the page history.
 */
import type {PageLayoutVariant} from '../system-files/page-layout-version-runtime.js';

type Json=Record<string,unknown>;
export type PageComponent=Json&{id:string;type?:string;label?:string;visible?:boolean;properties?:Json;position?:Json};
export type ComponentChange={
 component:string;
 set?:Json;
 unset?:string[];
 position?:{x?:number;y?:number;width?:number;height?:number};
 visible?:boolean;
 label?:string;
 remove?:boolean;
};
type PagesApi={
 editor(tenant:string,page:string,variant:PageLayoutVariant):Promise<unknown>;
 metadata(tenant:string,page:string,variant:PageLayoutVariant):Promise<unknown>;
 saveLayoutDraft(tenant:string,page:string,variant:PageLayoutVariant,payload:unknown,actor?:string):Promise<unknown>;
 publishLayout(tenant:string,page:string,variant:PageLayoutVariant,expected?:number,actor?:string):Promise<unknown>;
};
type Snapshot=Json&{components?:PageComponent[];devices?:string[];draftRevision?:number;publishedRevision?:number;
 inheritsDesktop?:boolean;desktopDraftRevision?:number};

const unsafe=new Set(['__proto__','prototype','constructor']);
const record=(value:unknown):value is Json=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const clone=<T>(value:T):T=>structuredClone(value);
const pathParts=(path:string)=>{
 const parts=path.split('.');
 if(!parts.length||parts.some(part=>!part||unsafe.has(part)||!/^[A-Za-z0-9_$-]{1,120}$/.test(part)))
  throw Error('Invalid property path '+JSON.stringify(path));
 return parts;
};
function setPath(target:Json,path:string,value:unknown){
 const parts=pathParts(path);
 let node=target;
 for(const part of parts.slice(0,-1)){
  if(!record(node[part]))node[part]={};
  node=node[part] as Json;
 }
 node[parts[parts.length-1]]=clone(value);
}
function unsetPath(target:Json,path:string){
 const parts=pathParts(path);
 let node:unknown=target;
 for(const part of parts.slice(0,-1)){
  if(!record(node))return;
  node=node[part];
 }
 if(record(node))delete node[parts[parts.length-1]];
}
const navigatorName=(component:PageComponent)=>String(component.properties?.navigatorName??'');

/** Components a reference names: an exact id, else every component with that navigator name. */
export function findComponents(components:readonly PageComponent[],reference:string):PageComponent[]{
 const byId=components.filter(component=>component.id===reference);
 return byId.length?byId:components.filter(component=>navigatorName(component)===reference);
}

/** Apply named edits to a copy of a layout's components. Ambiguous names are refused. */
export function applyComponentChanges(components:readonly PageComponent[],changes:readonly ComponentChange[],
 added:readonly PageComponent[]=[]){
 let next=clone([...components]) as PageComponent[];
 const matched:string[]=[],unmatched:string[]=[];
 for(const change of changes){
  const found=findComponents(next,change.component);
  if(!found.length){unmatched.push(change.component);continue;}
  if(found.length>1)throw Error(`"${change.component}" names ${found.length} components; use the component id`);
  const target=found[0];
  matched.push(change.component);
  if(change.remove){
   const removed=new Set([target.id]);
   // Children go with their parent, like deleting a container in the builder.
   for(let grew=true;grew;){
    grew=false;
    for(const component of next)if(!removed.has(component.id)&&removed.has(String(component.parentId??component.properties?.layoutParentId??''))){
     removed.add(component.id);grew=true;
    }
   }
   next=next.filter(component=>!removed.has(component.id));
   continue;
  }
  const properties=record(target.properties)?target.properties:(target.properties={});
  for(const [path,value] of Object.entries(change.set??{}))setPath(properties,path,value);
  for(const path of change.unset??[])unsetPath(properties,path);
  if(change.position){
   const position=record(target.position)?target.position:(target.position={});
   for(const key of ['x','y','width','height'] as const)
    if(change.position[key]!==undefined){
     const value=Number(change.position[key]);
     if(!Number.isFinite(value))throw Error('Invalid position for '+change.component);
     position[key]=value;
    }
  }
  if(change.visible!==undefined)target.visible=change.visible;
  if(change.label!==undefined)target.label=change.label;
 }
 const ids=new Set(next.map(component=>component.id));
 for(const component of added){
  if(!record(component)||typeof component.id!=='string'||!component.id||typeof component.type!=='string')
   throw Error('Each added component needs an id and a type');
  if(ids.has(component.id))throw Error('Component id already exists: '+component.id);
  ids.add(component.id);
  next.push(clone(component));
 }
 return {components:next,matched,unmatched};
}

/** A compact view: every component's name, or the full properties of the ones asked for. */
export function summarizeComponents(components:readonly PageComponent[],options:{
 components?:readonly string[];search?:string;properties?:readonly string[];
}={}){
 const wanted=new Set<string>();
 for(const reference of options.components??[])for(const component of findComponents(components,reference))wanted.add(component.id);
 const needle=options.search?.toLowerCase();
 if(needle)for(const component of components)
  if(JSON.stringify(component).toLowerCase().includes(needle))wanted.add(component.id);
 const detailed=Boolean(options.components?.length||needle);
 return components.filter(component=>!detailed||wanted.has(component.id)).map(component=>{
  const base={id:component.id,name:navigatorName(component)||undefined,type:component.type,
   parent:component.parentId??component.properties?.layoutParentId??undefined,
   visible:component.visible!==false,...(record(component.position)?{position:component.position}:{})};
  if(!detailed)return base;
  const properties=record(component.properties)?component.properties:{};
  const keys=options.properties?.length?options.properties:Object.keys(properties);
  return {...base,label:component.label,properties:Object.fromEntries(keys.filter(key=>key in properties).map(key=>[key,properties[key]]))};
 });
}

const deviceVariant:Record<string,PageLayoutVariant>={Desktop:'Desktop',Phone:'Mobile',Mobile:'Mobile',Tablet:'Tablet',Custom:'Custom'};
/** Desktop first (it carries the wiring), then every device layout the page is assigned to. */
export function pageVariants(devices:unknown):PageLayoutVariant[]{
 const list=Array.isArray(devices)?devices.map(device=>deviceVariant[String(device)]).filter(Boolean):[];
 return ['Desktop',...new Set(list.filter(variant=>variant!=='Desktop'))];
}
/** The layout people actually see when no variant is named: the page's first assigned device. */
export function primaryVariant(devices:unknown):PageLayoutVariant{
 const list=Array.isArray(devices)?devices.map(device=>deviceVariant[String(device)]).filter(Boolean):[];
 return list[0]??'Desktop';
}

export async function readPageComponents(pages:PagesApi,tenant:string,input:{
 page:string;variant?:PageLayoutVariant;view:'draft'|'published';components?:string[];search?:string;properties?:string[];
}){
 const variant=input.variant??primaryVariant(((await pages.metadata(tenant,input.page,'Desktop')) as Snapshot).devices);
 const snapshot=(input.view==='draft'?await pages.editor(tenant,input.page,variant):await pages.metadata(tenant,input.page,variant)) as Snapshot;
 return {page:input.page,variant,view:input.view,devices:snapshot.devices,
  draftRevision:snapshot.draftRevision,publishedRevision:snapshot.publishedRevision,
  inheritsDesktop:snapshot.inheritsDesktop,
  components:summarizeComponents(snapshot.components??[],input)};
}

export async function updatePageComponents(pages:PagesApi,tenant:string,actor:string,input:{
 page:string;changes:ComponentChange[];add?:PageComponent[];publish:boolean;
}){
 const desktop=(await pages.editor(tenant,input.page,'Desktop')) as Snapshot;
 const variants=pageVariants(desktop.devices);
 const results:Array<{variant:PageLayoutVariant;matched:string[];draftRevision?:number;publishedRevision?:number;saved:boolean}>=[];
 const everMatched=new Set<string>();
 let desktopSaved=false;
 for(const variant of variants){
  const snapshot=variant==='Desktop'?desktop:(await pages.editor(tenant,input.page,variant)) as Snapshot;
  const applied=applyComponentChanges(snapshot.components??[],input.changes,
   // New components are wired on Desktop; inheriting layouts receive them from there.
   variant==='Desktop'||!snapshot.inheritsDesktop?input.add??[]:[]);
  applied.matched.forEach(name=>everMatched.add(name));
  const rebase=variant!=='Desktop'&&snapshot.inheritsDesktop&&desktopSaved;
  const changed=applied.matched.length>0||Boolean(input.add?.length&&(variant==='Desktop'||!snapshot.inheritsDesktop));
  if(!changed&&!rebase){results.push({variant,matched:[],saved:false});continue;}
  const saved=(await pages.saveLayoutDraft(tenant,input.page,variant,
   {...snapshot,components:applied.components},actor)) as Snapshot;
  if(variant==='Desktop')desktopSaved=true;
  results.push({variant,matched:applied.matched,saved:true,draftRevision:saved.draftRevision,publishedRevision:saved.publishedRevision});
 }
 const unmatched=input.changes.map(change=>change.component).filter(name=>!everMatched.has(name));
 if(unmatched.length&&!results.some(result=>result.saved))
  throw Error('No component found for: '+unmatched.join(', '));
 if(input.publish)for(const result of results){
  if(!result.saved||!result.draftRevision)continue;
  const published=(await pages.publishLayout(tenant,input.page,result.variant,result.draftRevision,actor)) as Snapshot;
  result.publishedRevision=published.publishedRevision;
 }
 return {page:input.page,published:input.publish,unmatched,variants:results};
}
