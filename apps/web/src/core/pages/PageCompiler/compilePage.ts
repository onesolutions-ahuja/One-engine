import {Parser,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {compileActionPlan,isActionPlan,splitServerDataActionPlan,type ActionStep} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import {implicitPageStateKeys} from '../PageRuntime/pageStateDependencies';
import {pageComponentReadObjectNames} from '../PageRuntime/pageMutationScope';
import {activePageRecordFilters,needsMetadataComponentRuntime} from '../PageRuntime/pageComponentBindings';
import {parseActionFormulaAssignment} from '../PageRuntime/formulaAction';
import {pageBehaviors} from '../PageRuntime/pageBehaviorRuntime';
import type {LightningPageMetadata,ObjectMetadata,PageComponentMetadata} from '../../metadata/Definitions/metadata';

/**
 * Page compiler. Runs ONCE per saved page version (Builder save, Preview open,
 * script download) instead of inside every component on every redraw.
 *
 * Output is a plain, serialisable plan:
 *  - every formula parsed once (syntax errors are reported at save time);
 *  - one shared data source per Object + filter, however many components use it;
 *  - who-reads-what indexes, so a change redraws only the components that read it;
 *  - every action compiled to its step list, with the server (one request,
 *    one SQL transaction) part already split off.
 *
 * Metadata in SQL stays the source of truth. The plan is rebuilt from it and
 * never stored, so editing a page always reloads formulas from metadata.
 */
export const PAGE_COMPILER_VERSION=1;

export type CompiledFormula={
 property:string;source:string;ast:Expression|null;error?:string;
 /** Field, state, session and component references used by the formula. */
 references:string[];functions:string[];
};
export type CompiledActionKind='Formula'|'ActionPlan'|'PageState'|'Navigate'|'AdjustNumber'|'Flow'|'SetFilter'|'Other';
export type CompiledAction={
 event:string;kind:CompiledActionKind;formula?:string;stateKey?:string;flowApiName?:string;
 steps:Array<{name:string;object:string}>;
 /** Leading steps that run on the server in ONE request and ONE SQL transaction. */
 serverDataSteps:number;totalSteps:number;
 writesObjects:string[];writesState:string[];error?:string;
};
export type CompiledComponentMode=
 /** Draws from its properties only (no data, no state, no actions). */
 'static'|
 /** Runs on the compiled runtime: shared store, shared data source. */
 'compiled'|
 /** Uses a feature the compiled runtime does not cover yet; runs on the previous runtime. */
 'legacy';
export type CompiledComponent={
 id:string;type:string;label:string;parentId?:string;region?:string;
 libraryApiName:string;objectApiName:string;mode:CompiledComponentMode;legacyReasons:string[];
 formulas:CompiledFormula[];actions:CompiledAction[];
 stateReads:string[];stateWrites:string[];
 /** null = reads cannot be determined statically: refresh on any Object write. */
 objectReads:string[]|null;
 dataSourceId?:string;
 /** Lower-case authored text, for state keys only known at run time (STATE() results). */
 searchText:string;
};
export type CompiledDataSource={
 id:string;objectApiName:string;components:string[];
 /** Load every row (bounded): a COLLECTION/TABLE over these rows needs all of them.
  * Otherwise rows load 50 at a time as the user scrolls. */
 complete:boolean;
 filters:unknown;filterLogic:'AND'|'OR';filterFormula?:string;
 /** Page state keys the filter reads: the source reloads only when one changes. */
 stateInputs:string[];
};
export type CompiledPage={
 compilerVersion:number;apiName:string;label:string;pageType:string;layoutMode:string;targetObject:string;
 revision:number|null;
 components:CompiledComponent[];
 dataSources:CompiledDataSource[];
 /** state key → component ids that redraw when it changes. */
 stateReaders:Record<string,string[]>;
 /** Object → component ids that redraw when one of its records is saved. */
 objectReaders:Record<string,string[]>;
 /** Components whose Object reads are unknown: any write refreshes them. */
 anyObjectReaders:string[];
 stateKeys:string[];
 diagnostics:Array<{componentId:string;level:'error'|'info';message:string}>;
 stats:{components:number;compiled:number;legacy:number;static:number;formulas:number;
  actions:number;dataSources:number;componentsWithData:number};
};

const identifier=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const unique=(values:Iterable<string>)=>[...new Set(values)].sort();

export function parseFormulaOnce(source:string):{ast:Expression|null;error?:string}{
 try{return {ast:new Parser(tokenize(source.trim().replace(/^=\s*/,''))).parse()};}
 catch(error){return {ast:null,error:error instanceof Error?error.message:String(error)};}
}
export function formulaReferences(ast:Expression|null):{references:string[];functions:string[]}{
 const references=new Set<string>(),functions=new Set<string>();
 const visit=(node:Expression):void=>{
  if(node.kind==='reference')references.add(node.value);
  else if(node.kind==='call'){functions.add(node.name);node.args.forEach(visit);}
  else if(node.kind==='unary')visit(node.value);
  else if(node.kind==='binary'){visit(node.left);visit(node.right);}
 };
 if(ast)visit(ast);
 return {references:unique(references),functions:unique(functions)};
}
/** A component formula: an Excel-style "=..." value or a bare @mention. */
export function isFormulaText(value:unknown):value is string{
 if(typeof value!=='string')return false;
 const text=value.trim();
 return text.startsWith('=')&&text.length>1||/^@[A-Za-z][A-Za-z0-9_.]*$/.test(text);
}
function collectFormulas(properties:Readonly<Record<string,unknown>>):CompiledFormula[]{
 const found:CompiledFormula[]=[];
 const seen=new WeakSet<object>();
 const visit=(path:string,value:unknown,depth:number)=>{
  if(depth>6||found.length>400)return;
  if(isFormulaText(value)){
   // Action formulas are compiled as actions, not display formulas.
   if(/^actionFlows\./.test(path))return;
   const source=value.trim();
   const parsed=parseFormulaOnce(source);
   found.push({property:path,source,ast:parsed.ast,...(parsed.error?{error:parsed.error}:{}),
    ...formulaReferences(parsed.ast)});
   return;
  }
  if(!value||typeof value!=='object'||seen.has(value))return;
  seen.add(value);
  for(const [key,child] of Array.isArray(value)?value.map((v,i)=>[String(i),v] as const):Object.entries(value))
   visit(path?path+'.'+key:key,child,depth+1);
 };
 for(const [key,value] of Object.entries(properties)){
  if(['objects','records','items','pageState','pagePropertyContract'].includes(key))continue;
  visit(key,value,0);
 }
 return found;
}
const stepList=(steps:readonly ActionStep[]):Array<{name:string;object:string}>=>
 steps.flatMap(step=>[{name:step.name,object:step.object},...stepList(step.body??[])]);
const browserServiceSteps=new Set(['PRINT','CREATEPDF','CLOSESCREEN','EMAIL','WHATSAPP','SMS','WAIT']);

export function compileComponentAction(event:string,raw:unknown):CompiledAction|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const binding=raw as Record<string,unknown>;
 const base={event,steps:[] as Array<{name:string;object:string}>,serverDataSteps:0,totalSteps:0,
  writesObjects:[] as string[],writesState:[] as string[]};
 const type=String(binding.actionType??'');
 if(type==='PageState'){
  const key=String(binding.stateKey??'');
  return {...base,kind:'PageState',stateKey:key,writesState:identifier.test(key)?[key]:[],
   ...(identifier.test(key)?{}:{error:'Page state action requires a valid state key'})};
 }
 if(type==='Navigate')return {...base,kind:'Navigate'};
 if(type==='SetFilter')return {...base,kind:'SetFilter'};
 if(type==='AdjustNumber')return {...base,kind:'AdjustNumber',
  writesObjects:typeof binding.objectApiName==='string'?[binding.objectApiName]:[]};
 if(type==='Flow'||typeof binding.flowApiName==='string'&&binding.flowApiName)
  return {...base,kind:'Flow',flowApiName:String(binding.flowApiName??''),
   writesState:binding.outputs&&typeof binding.outputs==='object'&&!Array.isArray(binding.outputs)
    ?Object.values(binding.outputs as Record<string,unknown>).filter((k):k is string=>typeof k==='string'&&identifier.test(k)):[]};
 if(type!=='Formula')return {...base,kind:'Other'};
 const formula=String(binding.formula??'').trim();
 try{
  const assignment=parseActionFormulaAssignment(formula);
  if(assignment)return {...base,
   kind:assignment.kind==='filter'?'SetFilter':assignment.kind==='navigate'?'Navigate':'Formula',
   formula,writesState:assignment.kind==='state'?[assignment.key]:[]};
 }catch(error){return {...base,kind:'Formula',formula,error:error instanceof Error?error.message:String(error)};}
 if(!isActionPlan(formula)){
  const parsed=parseFormulaOnce(formula);
  return {...base,kind:'Formula',formula,...(parsed.error?{error:parsed.error}:{})};
 }
 try{
  const steps=stepList(compileActionPlan(formula));
  let split:ReturnType<typeof splitServerDataActionPlan>=null;
  try{split=/\bFOREACH\s*\(/i.test(formula)?null:splitServerDataActionPlan(formula);}catch{split=null;}
  const writes=steps.filter(step=>['CREATERECORD','UPDATERECORD','DELETERECORD'].includes(step.name)).map(step=>step.object);
  const stateWrites=[...formula.matchAll(/\bSTATE\s*\(\s*["']([A-Za-z][A-Za-z0-9_]{0,63})["']/gi)].map(match=>match[1]);
  return {...base,kind:'ActionPlan',formula,steps,serverDataSteps:split?.dataSteps??0,totalSteps:steps.length,
   writesObjects:unique(writes),writesState:unique(stateWrites)};
 }catch(error){
  return {...base,kind:'ActionPlan',formula,error:error instanceof Error?error.message:String(error)};
 }
}

/** Features the compiled runtime does not run natively yet. Such a component
 * keeps working on the previous runtime, inside the same compiled page. */
function legacyReasons(component:PageComponentMetadata,formulas:readonly CompiledFormula[],
 actions:readonly CompiledAction[]):string[]{
 const p=component.properties??{};
 const reasons:string[]=[];
 const add=(when:unknown,reason:string)=>{if(when)reasons.push(reason);};
 add(p.relatedFilterKey,'related list scope');
 add(p.recordPresenterApiName,'record presenter');
 add(p.liveRefreshEnabled||p.liveFlowRefreshEnabled,'live refresh');
 add(p.channelAccessPath,'channel access');
 add(p.contactsObjectApiName,'contact choices');
 add(p.dataFieldFilters,'field-scoped filters');
 add(p.recordId,'fixed record id');
 add(Array.isArray(pageBehaviors(p)?.interactions)&&(pageBehaviors(p)!.interactions as unknown[]).length,'page interactions');
 for(const action of actions){
  if(action.kind==='Flow')reasons.push('Flow action ('+action.event+')');
  else if(action.kind==='SetFilter')reasons.push('filter action ('+action.event+')');
  else if(action.kind==='Other')reasons.push('unsupported action ('+action.event+')');
  else if(action.kind==='ActionPlan'&&action.steps.some(step=>browserServiceSteps.has(step.name)||step.name==='SCREEN'))
   reasons.push('print/screen/message action ('+action.event+')');
  else if(action.kind==='ActionPlan'&&/\bFLOW\s*\(|\bSCREEN\s*\(/i.test(action.formula??''))
   reasons.push('Flow call in action ('+action.event+')');
 }
 return unique(reasons);
}
export function usesCollections(properties:Readonly<Record<string,unknown>>,formulas:readonly CompiledFormula[]):boolean{
 return Boolean(typeof properties.collectionFormula==='string'&&properties.collectionFormula.trim()
  ||formulas.some(f=>f.functions.includes('COLLECTION')||f.functions.includes('TABLE')||f.functions.includes('SUM')));
}
function wordIn(text:string,word:string):boolean{
 const needle=word.toLowerCase();
 let at=text.indexOf(needle);
 const isWord=(c:number)=>(c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===95;
 while(at>=0){
  if(!isWord(text.charCodeAt(at-1))&&!isWord(text.charCodeAt(at+needle.length)))return true;
  at=text.indexOf(needle,at+1);
 }
 return false;
}
function filterStateInputs(filters:unknown,formula:unknown):string[]{
 const keys=new Set<string>();
 if(Array.isArray(filters))for(const entry of filters){
  const value=entry&&typeof entry==='object'?(entry as {value?:unknown}).value:undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))continue;
  const source=value as {source?:unknown;key?:unknown};
  if(source.source==='PageState'&&typeof source.key==='string'&&identifier.test(source.key))keys.add(source.key);
  // A collection selection is published under the collection's own name.
  const named=source.source==='CollectionState'&&typeof source.key==='string'
   ?/^([A-Za-z][A-Za-z0-9_]{0,79})\.state\./.exec(source.key):null;
  if(named)keys.add(named[1]);
 }
 if(typeof formula==='string')
  for(const match of formula.matchAll(/(?:\$state\.|@state\.)([A-Za-z][A-Za-z0-9_]{0,63})\b/g))keys.add(match[1]);
 return unique(keys);
}
function stableHash(text:string):string{
 let h=2166136261;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(36);
}

export function compilePage(page:LightningPageMetadata,objects:readonly ObjectMetadata[]):CompiledPage{
 const diagnostics:CompiledPage['diagnostics']=[];
 const sources=new Map<string,CompiledDataSource>();
 const components:CompiledComponent[]=[];
 const allStateWrites=new Set<string>();
 for(const component of page.components??[]){
  const properties=(component.properties??{}) as Record<string,unknown>;
  const libraryApiName=component.type.startsWith('Custom:')?component.type.slice(7):'';
  const objectApiName=String(properties.objectApiName||(needsMetadataComponentRuntime(properties)?page.targetObject:'')||'');
  const formulas=collectFormulas(properties);
  for(const formula of formulas)if(formula.error)
   diagnostics.push({componentId:component.id,level:'error',message:formula.property+': '+formula.error});
  const actionFlows=properties.actionFlows;
  const actions=actionFlows&&typeof actionFlows==='object'&&!Array.isArray(actionFlows)
   ?Object.entries(actionFlows).map(([event,raw])=>compileComponentAction(event,raw))
     .filter((item):item is CompiledAction=>item!==null):[];
  for(const action of actions)if(action.error)
   diagnostics.push({componentId:component.id,level:'error',message:'Action '+action.event+': '+action.error});
  const runtime=libraryApiName!==''&&needsMetadataComponentRuntime(properties);
  const reasons=runtime?legacyReasons(component,formulas,actions):[];
  const mode:CompiledComponentMode=!runtime?'static':reasons.length?'legacy':'compiled';
  if(mode==='legacy')diagnostics.push({componentId:component.id,level:'info',
   message:'Runs on the previous runtime: '+reasons.join(', ')});
  const stateWrites=unique(actions.flatMap(action=>action.writesState));
  stateWrites.forEach(key=>allStateWrites.add(key));
  const stateBindings=properties.stateBindings;
  if(stateBindings&&typeof stateBindings==='object'&&!Array.isArray(stateBindings))
   Object.values(stateBindings).forEach(key=>{if(typeof key==='string'&&identifier.test(key))allStateWrites.add(key);});
  let dataSourceId:string|undefined;
  if(mode==='compiled'&&objectApiName){
   const active=activePageRecordFilters(properties);
   const filterLogic=properties.filterLogic==='OR'?'OR':'AND';
   const filterFormula=typeof active.formula==='string'&&active.formula.trim()?active.formula.trim():undefined;
   const key=JSON.stringify([objectApiName,active.filters??null,filterLogic,filterFormula??'']);
   const id=objectApiName+'#'+stableHash(key);
   dataSourceId=id;
   const existing=sources.get(id);
   const complete=usesCollections(properties,formulas);
   if(existing){existing.components.push(component.id);existing.complete||=complete;}
   else sources.set(id,{id,objectApiName,components:[component.id],complete,filters:active.filters??null,
    filterLogic,...(filterFormula?{filterFormula}:{}),stateInputs:filterStateInputs(active.filters,filterFormula)});
  }
  components.push({id:component.id,type:component.type,label:component.label,
   ...(component.parentId?{parentId:component.parentId}:{}),...(component.region?{region:component.region}:{}),
   libraryApiName,objectApiName,mode,legacyReasons:reasons,formulas,actions,
   stateReads:[],stateWrites,
   objectReads:mode==='static'?[]:pageComponentReadObjectNames(objectApiName,properties,objects as ObjectMetadata[]),
   ...(dataSourceId?{dataSourceId}:{}),
   // Actions read the latest state when they run, so a key used only inside an
   // action never redraws the component (a product grid must not redraw on cart change).
   searchText:JSON.stringify({...properties,actionFlows:undefined}).toLowerCase()});
 }
 // State reads are resolved once the page's full set of state keys is known.
 const stateKeys=unique(allStateWrites);
 const stateReaders:Record<string,string[]>={};
 const objectReaders:Record<string,string[]>={};
 const anyObjectReaders:string[]=[];
 for(const item of components){
  if(item.mode==='static')continue;
  const fields=objects.find(object=>object.apiName===item.objectApiName)?.fields??[];
  const implicit=implicitPageStateKeys(fields);
  item.stateReads=unique([...stateKeys.filter(key=>wordIn(item.searchText,key)),
   ...implicit.filter(key=>stateKeys.includes(key))]);
  for(const key of item.stateReads)(stateReaders[key]??=[]).push(item.id);
  if(item.objectReads===null)anyObjectReaders.push(item.id);
  else for(const object of item.objectReads)(objectReaders[object]??=[]).push(item.id);
 }
 const dataSources=[...sources.values()];
 const count=(mode:CompiledComponentMode)=>components.filter(item=>item.mode===mode).length;
 return {compilerVersion:PAGE_COMPILER_VERSION,apiName:page.apiName,label:page.label,targetObject:page.targetObject??'',
  pageType:page.pageType,layoutMode:page.layoutMode,
  revision:page.draftRevision??page.revision??page.publishedRevision??null,
  components,dataSources,stateReaders,objectReaders,anyObjectReaders,stateKeys,diagnostics,
  stats:{components:components.length,compiled:count('compiled'),legacy:count('legacy'),static:count('static'),
   formulas:components.reduce((n,item)=>n+item.formulas.length,0),
   actions:components.reduce((n,item)=>n+item.actions.length,0),
   dataSources:dataSources.length,
   componentsWithData:dataSources.reduce((n,source)=>n+source.components.length,0)}};
}

/** Cache: one compile per page version, shared by Preview, runtime and download. */
const cache=new WeakMap<LightningPageMetadata,{objects:readonly ObjectMetadata[];compiled:CompiledPage}>();
export function compilePageCached(page:LightningPageMetadata,objects:readonly ObjectMetadata[]):CompiledPage{
 const hit=cache.get(page);
 if(hit&&hit.objects===objects)return hit.compiled;
 const compiled=compilePage(page,objects);
 cache.set(page,{objects,compiled});
 return compiled;
}
