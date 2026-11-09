import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {sameFormulaSnapshot} from './pageFormulaSnapshot';
import {componentInstanceNames,type NamedComponent} from '../../../../../server/src/system-support/page-component-names';
import type {LibraryComponentMetadata} from '../../metadata/Definitions/metadata';
import {resolveFieldText,getAuthenticatedFormulaBindingContext} from './fieldExpressionRuntime';
import {useSqlFormulaDisplay} from '../../../component-libraries/shared/useSqlFormulaDisplay';
import {componentReaderKey} from '../../../component-libraries/shared/FieldExpression.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';

type Scalar=string|number|boolean;
type Entry={id:string;name:string;token:string;keys:string[]};
type Scope={
 entries:Entry[];
 read:(name:string,key:string)=>Scalar;
 publish:(id:string,values:Record<string,Scalar>|null)=>void;
 subscribe:(dependencies:readonly string[],listener:()=>void)=>()=>void;
 version:(dependencies:readonly string[])=>string;
};
const Context=createContext<Scope|null>(null);
/** Live user input (typed text, selections) published by the page runtime's onChange. */
export const componentInputEvent='metadrive:component-input';
export function publishComponentInput(componentId:string,value:unknown){
 window.dispatchEvent(new CustomEvent(componentInputEvent,{detail:{componentId,value}}));
}
export const usePageFormulaScope=()=>useContext(Context);
const safeKey=/^[A-Za-z_][A-Za-z0-9_]*$/;
// Preserve simple names. Reserve a prefix for reversible encoding of legacy names.
function nameToken(name:string){
 return safeKey.test(name)&&!name.startsWith('__n_')?name:
  '__n_'+Array.from(name,char=>char.codePointAt(0)!.toString(16)).join('_');
}
/** Subscribe only to the named component properties actually referenced by a binding.
 * A change in one Text or Cart component must not rerender all page components.
 */
// Runtime inputs that are data or metadata, never authored bindings. Scanning
// them (all Objects' field metadata, rows, page state) on every render ran
// String.matchAll ~12,000 times per component: ~5 ms each, ~0.4 s for a page
// of 50 formula boxes after every tap.
const nonBindingKeys=new Set(['objects','records','items','record','currentRecord','recordData',
 'pageState','apps','pages','reports','pageComponents','recordPagination']);
const dependencyCache=new WeakMap<object,string[]>();
export function componentFormulaDependencies(source:unknown):string[]{
 if(source&&typeof source==='object'){
  const cached=dependencyCache.get(source);
  if(cached)return cached;
 }
 const found=new Set<string>();
 const seen=new WeakSet<object>();
 const visit=(value:unknown,depth:number,key?:string):void=>{
  if(depth>8||value===null||value===undefined)return;
  if(typeof value==='string'){
   if(!value.includes('$component.'))return;
   for(const match of value.matchAll(/\$component\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g))
    found.add(match[1]+'.'+match[2]);
  }else if(typeof value==='object'){
   if(depth===1&&key&&nonBindingKeys.has(key))return;
   if(seen.has(value))return;
   seen.add(value);
   if(Array.isArray(value))for(const child of value)visit(child,depth+1);
   else for(const [childKey,child] of Object.entries(value as Record<string,unknown>))visit(child,depth+1,childKey);
  }
 };
 visit(source,0);
 const result=[...found].sort();
 if(source&&typeof source==='object')dependencyCache.set(source,result);
 return result;
}
export function useFormulaDependencyVersion(scope:Scope|null,source:unknown):string{
 const key=componentFormulaDependencies(source).join('|');
 const dependencies=useMemo(()=>key?key.split('|'):[],[key]);
 const subscribe=useCallback((listener:()=>void)=>
  scope?.subscribe(dependencies,listener)??(()=>{}),[scope,dependencies]);
 const snapshot=useCallback(()=>scope?.version(dependencies)??'',[scope,dependencies]);
 return useSyncExternalStore(subscribe,snapshot,()=> '');
}
export function useComponentFormulaState(state:Record<string,unknown>,bindings?:unknown){
 const scope=usePageFormulaScope();
 const version=useFormulaDependencyVersion(scope,bindings);
 return useMemo(()=>scope?Object.assign({},state,{[componentReaderKey]:scope.read}):state,[state,scope,version]);
}
export function PageFormulaScope({components,catalog,children}:{
 components?:readonly NamedComponent[];catalog:readonly LibraryComponentMetadata[];children:ReactNode
}){
 const model=useMemo(()=>{
  const items=components??[];
  const names=componentInstanceNames(items);
  const entries:Entry[]=[];
  const edges=new Map<string,string[]>();
  for(const item of items){
   const definition=catalog.find(d=>'Custom:'+d.apiName===item.type);
   if(!definition)continue;
   const name=names.get(item.id)!;
   const token=nameToken(name);
   const authored=Object.keys(item.properties).filter(key=>['string','number','boolean'].includes(typeof item.properties[key]));
   const keys=Array.from(new Set([...authored,...(definition.propertyDefinitions??[])
    .filter(field=>field.kind!=='GROUP'&&field.kind!=='COLLECTION').map(field=>field.propertyKey)]))
    .filter(key=>safeKey.test(key)&&!['constructor','prototype','__proto__'].includes(key));
   // Every component exposes its live input as $component.Name.value (typed text, selection).
   if(!keys.includes('value'))keys.push('value');
   // ...and the one record it is bound to as $component.Name.recordId, so a
   // screen can say which of several carts it means: SCREEN(Pay,popup,$component.Cart2.recordId).
   if(!keys.includes('recordId'))keys.push('recordId');
   if(['smart_image','ui_image'].includes(definition.apiName)){
    for(const key of ['textSource','imageSource','badgeText'])if(!keys.includes(key))keys.push(key);
   }
   if(keys.includes('textSource')&&!keys.includes('text')){
    keys.push('text');
    edges.set(token+'.text',[token+'.textSource']);
   }
   entries.push({id:item.id,name,token,keys});
   for(const key of keys){
    const value=item.properties[key];
    if(typeof value!=='string'||!value.includes('$component.'))continue;
    try{
     const refs=tokenize(value).filter(t=>t.kind!=='string'&&t.value.startsWith('$component.'));
     edges.set(token+'.'+key,refs.map(t=>t.value.slice(11)));
    }catch{/* The binding editor reports malformed expressions. */}
   }
  }
  const seen=new Set<string>(),active=new Set<string>(),cyclic=new Set<string>();
  function visit(path:string):boolean{
   if(active.has(path))return true;
   if(seen.has(path))return cyclic.has(path);
   active.add(path);
   if(edges.get(path)?.some(visit))cyclic.add(path);
   active.delete(path);seen.add(path);
   return cyclic.has(path);
  }
  for(const path of edges.keys())visit(path);
  return {entries,cyclic};
 },[components,catalog]);
 const values=useRef(new Map<string,Record<string,Scalar>>());
 const inputs=useRef(new Map<string,Scalar>());
 const revisions=useRef(new Map<string,number>());
 const listeners=useRef(new Set<{dependencies:readonly string[];listener:()=>void}>());
 const notify=useCallback((changed:ReadonlySet<string>)=>{
  if(!changed.size)return;
  for(const item of listeners.current)
   if(item.dependencies.some(key=>changed.has(key)))item.listener();
 },[]);
 const publish=useCallback((id:string,next:Record<string,Scalar>|null)=>{
  const previous=values.current.get(id);
  if(next===null&&!previous)return;
  if(next!==null&&sameFormulaSnapshot(previous,next))return;
  if(next===null)values.current.delete(id);else values.current.set(id,next);
  const entry=model.entries.find(item=>item.id===id);
  if(!entry)return;
  const changed=new Set<string>();
  for(const key of new Set([...Object.keys(previous??{}),...Object.keys(next??{})])){
   if(Object.is(previous?.[key],next?.[key]))continue;
   const name=entry.token+'.'+key;
   revisions.current.set(name,(revisions.current.get(name)??0)+1);
   changed.add(name);
  }
  notify(changed);
 },[model,notify]);
 useEffect(()=>{
  const byId=new Map(model.entries.map(entry=>[entry.id,entry.token]));
  const changed=(event:Event)=>{
   const detail=(event as CustomEvent<{componentId?:unknown;value?:unknown}>).detail;
   if(typeof detail?.componentId!=='string'||!byId.has(detail.componentId))return;
   const value=detail.value;
   const scalar:Scalar=typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)
    ?value:value==null?'':String(value);
   if(inputs.current.has(detail.componentId)&&Object.is(inputs.current.get(detail.componentId),scalar))return;
   inputs.current.set(detail.componentId,scalar);
   const name=byId.get(detail.componentId)!+'.value';
   revisions.current.set(name,(revisions.current.get(name)??0)+1);
   notify(new Set([name]));
  };
  window.addEventListener(componentInputEvent,changed);
  return ()=>window.removeEventListener(componentInputEvent,changed);
 },[model,notify]);
 const scope=useMemo<Scope>(()=>({...model,publish,
  subscribe(dependencies,listener){
   const item={dependencies,listener};
   listeners.current.add(item);
   return ()=>{listeners.current.delete(item);};
  },
  version(dependencies){
   return dependencies.map(key=>revisions.current.get(key)??0).join(',');
  },
  read(name:string,key:string){
   if(model.cyclic.has(name+'.'+key))throw Error('Circular component reference: '+name+'.'+key);
   const entry=model.entries.find(item=>item.token===name);
   if(!entry?.keys.includes(key))throw Error('Unknown component property: '+name+'.'+key);
   if(key==='value'&&inputs.current.has(entry.id))return inputs.current.get(entry.id)!;
   const row=values.current.get(entry.id);
   return row&&Object.hasOwn(row,key)?row[key]:'';
  }
 }),[model,publish]);
 return <Context.Provider value={scope}>{children}</Context.Provider>;
}
export function PublishedFormulaProperties({id,values,rendered}:{id?:string;values:Record<string,unknown>;rendered:Readonly<Record<string,string>>}){
 const scope=usePageFormulaScope();
 const sqlLookup=useSqlFormulaDisplay(values,{useEffect,useMemo,useRef,useState});
 const entry=scope?.entries.find(item=>item.id===id);
 const publish=scope?.publish;
 const output:Record<string,Scalar>=Object.create(null);
 const rows=Array.isArray(values.records)?values.records:[];
 const record=values.record??rows[0];
 for(const key of entry?.keys??[]){
  const source=key==='text'&&values.text===undefined?'textSource':key;
  if(Object.hasOwn(rendered,source)){output[key]=rendered[source];continue;}
  if(typeof values.fieldAllowed==='function'&&!values.fieldAllowed(source,record??{}))continue;
  let value=values[source];
  if(key==='recordId'&&(typeof value!=='string'||!value)){
   // Bound record first; a list exposes an Id only when it shows exactly one row.
   const bound=values.record&&typeof values.record==='object'?(values.record as Record<string,unknown>).Id:
    rows.length===1&&rows[0]&&typeof rows[0]==='object'?(rows[0] as Record<string,unknown>).Id:undefined;
   if(typeof bound==='string'&&bound)output[key]=bound;
   continue;
  }
  if(typeof value==='string'&&(/^(?:=|@|\$component\.|\$state\.|\$session(?:\.|$))/.test(value)||/^[A-Z]+\(/i.test(value))){
   if(rows.length>1&&!values.record&&/@[A-Za-z]/.test(value)&&!['smart_image','ui_image'].includes(String(values.kind??'')))continue;
   const sql=sqlLookup(value,record as Record<string,unknown>|undefined);
   if(sql){
    if(sql.error||sql.loading)continue;
    value=sql.value;
   }else try{
    value=resolveFieldText(value,record,{...getAuthenticatedFormulaBindingContext(),
     rootObjectApiName:typeof values.objectApiName==='string'?values.objectApiName:undefined,
     pageState:values.pageState as Record<string,unknown>,readComponent:scope?.read});
   }catch{continue;}
  }
  if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))output[key]=value;
 }
 const snapshot=JSON.stringify(output);
 useEffect(()=>{
  if(id&&entry&&publish)publish(id,JSON.parse(snapshot));
 },[id,entry?.token,publish,snapshot]);
 useEffect(()=>()=>{if(id&&publish)publish(id,null)},[id,publish]);
 return null;
}
