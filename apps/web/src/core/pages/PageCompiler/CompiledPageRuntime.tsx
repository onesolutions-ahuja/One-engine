import * as React from 'react';
import {createContext,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import type {LibraryComponentMetadata,ObjectMetadata,PageComponentMetadata,LightningAppMetadata,LightningPageMetadata,FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';
import {resolveMetadataProperties} from '../../metadata/Definitions/metadataReferences';
import {bindPageStateProperties,resolvePageStatePath} from '../PageRuntime/pageComponentBindings';
import {componentLayoutProps} from '../TemplatePageRuntime/pageComponentLayout';
import {behaviorAction,behaviorValidation} from '../PageRuntime/pageBehaviorRuntime';
import {executePageFormulaAction,parseActionFormulaAssignment,resolveActionFormulaValue} from '../PageRuntime/formulaAction';
import {adjustNumberRecord,type AdjustNumberBinding} from '../PageRuntime/adjustNumberRecord';
import {executeOpenPageActionNode} from '../PageRuntime/OpenPageActionNode';
import {requestPageMediaAsset} from '../PageRuntime/pageMediaAssetCoalescer';
import type {PageMutationDetail} from '../PageRuntime/pageMutationScope';
import {loadFlowScreenRecordPage,getAccessToken} from '../../authentication/Client/authClient';
import type {CompiledPage,CompiledComponent} from './compilePage';
import {createCompiledPageStore,createCompiledDataLayer,SOURCE_PAGE_SIZE,type CompiledPageStore,type CompiledDataLayer} from './compiledPageStore';
import {compiledSourceLoader} from './compiledSourceLoader';

/**
 * Compiled page runtime. One provider per page owns the ONLY page store, the
 * ONLY data loads and the ONLY two window listeners. Components are drawers:
 * they read the store and their shared data source, and redraw only when
 * something they read changes. Components marked 'legacy' by the compiler keep
 * the previous runtime; the provider keeps both in sync through the existing
 * page events, so mixed pages behave as one page.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Runtime={compiled:CompiledPage;byId:ReadonlyMap<string,CompiledComponent>;store:CompiledPageStore;
 data:CompiledDataLayer;request:Request;objects:ObjectMetadata[];pageSessionKey:string;sessionId:string;
 /** Tells legacy siblings (and the page layout) about compiled changes. */
 broadcastState(changes:ReadonlyArray<{key:string;value:unknown}>):void;
 broadcastSaved(detail:PageMutationDetail):void};
const CompiledRuntimeContext=createContext<Runtime|null>(null);
export const useCompiledPageRuntime=()=>useContext(CompiledRuntimeContext);
const compiledOrigin='compiled-runtime';

function pageSessionId(pageSessionKey:string):string{
 const key='metadrive-page-session:'+pageSessionKey;
 try{
  let value=window.sessionStorage.getItem(key);
  if(!value){value=crypto.randomUUID();window.sessionStorage.setItem(key,value);}
  return value;
 }catch{return crypto.randomUUID();}
}

export function CompiledPageProvider({compiled,objects,request,pageSessionKey,initialState,children}:{
 compiled:CompiledPage;objects:ObjectMetadata[];request:Request;pageSessionKey:string;
 initialState?:Record<string,unknown>;children:ReactNode;
}){
 const [sessionId]=useState(()=>pageSessionId(pageSessionKey));
 const runtime=useMemo<Runtime>(()=>{
  const store=createCompiledPageStore(compiled,initialState);
  const data=createCompiledDataLayer(compiled,compiledSourceLoader(objects,()=>sessionId,loadFlowScreenRecordPage),store.get);
  return {compiled,byId:new Map(compiled.components.map(item=>[item.id,item])),store,data,request,objects,pageSessionKey,sessionId,
   broadcastState(changes){
    for(const change of changes)window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
     detail:{pageSessionKey,key:change.key,value:change.value,origin:compiledOrigin}}));
   },
   broadcastSaved(detail){
    window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
     detail:{...detail,pageSessionKey,sessionId,origin:compiledOrigin}}));
   }};
 // One runtime per compiled page version; metadata edits recompile.
 },[compiled,objects,request,pageSessionKey,sessionId]);
 useEffect(()=>{
  void runtime.data.start();
  // Legacy components (and Flows) still speak window events: fold them into the one store.
  const onState=(event:Event)=>{
   const detail=(event as CustomEvent<{pageSessionKey?:string;key?:string;value?:unknown;origin?:string}>).detail;
   if(detail?.origin===compiledOrigin||detail?.pageSessionKey!==pageSessionKey)return;
   if(typeof detail.key!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(detail.key))return;
   const changed=runtime.store.merge([{key:detail.key,value:detail.value}]);
   if(changed.length)void runtime.data.stateChanged(changed);
  };
  const onSaved=(event:Event)=>{
   const detail=(event as CustomEvent<PageMutationDetail&{origin?:string}>).detail;
   if(detail?.origin===compiledOrigin||detail?.pageSessionKey!==pageSessionKey)return;
   void runtime.data.saved(detail);
  };
  window.addEventListener('metadrive:page-local-state',onState);
  window.addEventListener('metadrive:page-flow-mutated',onSaved);
  return ()=>{
   window.removeEventListener('metadrive:page-local-state',onState);
   window.removeEventListener('metadrive:page-flow-mutated',onSaved);
  };
 },[runtime,pageSessionKey]);
 return <CompiledRuntimeContext.Provider value={runtime}>{children}</CompiledRuntimeContext.Provider>;
}

/** Redraw when (and only when) this component's own readers fire. */
function useComponentState(runtime:Runtime,id:string){
 return useSyncExternalStore(listener=>runtime.store.subscribeComponent(id,listener),runtime.store.get,runtime.store.get);
}
const emptySource={records:[] as Record<string,unknown>[],total:0,loading:false,error:'',predictable:false,version:0};
function useSourceSnapshot(runtime:Runtime,sourceId:string|undefined){
 return useSyncExternalStore(
  listener=>sourceId?runtime.data.subscribe(sourceId,listener):()=>{},
  ()=>sourceId?runtime.data.get(sourceId):emptySource,
  ()=>sourceId?runtime.data.get(sourceId):emptySource);
}
const eventPayload=(value:unknown):Record<string,unknown>=>
 value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{value};
function resolvePageStateInput(source:unknown,payload:Record<string,unknown>,state:Readonly<Record<string,unknown>>,sessionId:string):unknown{
 if(source==='$session')return sessionId;
 if(typeof source==='string'&&source.startsWith('$state.'))return resolvePageStatePath(state,source.slice(7));
 if(source==='$event')return payload;
 if(typeof source==='string'&&source.startsWith('$event.'))
  return source.slice(7).split('.').reduce<unknown>((current,key)=>
   current&&typeof current==='object'&&!['__proto__','prototype','constructor'].includes(key)
    ?(current as Record<string,unknown>)[key]:undefined,payload);
 return source??payload.value;
}

export function CompiledComponentNode({definition,component,objectApiName,formFactor,apps,pages,currentAppId,
 availableFlows,reports,onNavigate,onLaunchFlow,children}:{
 definition:LibraryComponentMetadata;component:PageComponentMetadata;objectApiName:string;
 formFactor:'Desktop'|'Tablet'|'Phone';apps:LightningAppMetadata[];pages:LightningPageMetadata[];currentAppId:string;
 availableFlows:Array<Pick<FlowDefinitionMetadata,'id'|'apiName'|'label'|'flowType'|'status'>>;reports?:unknown[];
 onNavigate:(route:never)=>void;onLaunchFlow:(flowApiName:string,inputs?:Record<string,unknown>)=>void;children?:ReactNode;
}){
 const runtime=useCompiledPageRuntime()!;
 const compiled=runtime.byId.get(component.id)!;
 const state=useComponentState(runtime,component.id);
 const source=useSourceSnapshot(runtime,compiled.dataSourceId);
 const [actionError,setActionError]=useState('');
 const properties=useMemo(()=>resolveMetadataProperties({...component.properties,objectApiName},runtime.objects,availableFlows),
  [component.properties,objectApiName,runtime.objects,availableFlows]);
 const resolved=useMemo(()=>bindPageStateProperties(properties,state),[properties,state]);
 const actionFlows=(properties.actionFlows&&typeof properties.actionFlows==='object'&&!Array.isArray(properties.actionFlows)
  ?properties.actionFlows:{}) as Record<string,unknown>;
 const onAction=async(action:{event:string;value?:unknown})=>{
  const pageState=runtime.store.get();
  if(behaviorAction(properties,action.event,{formFactor})!=='enabled')
   throw Error('This action is unavailable under the published Page rules.');
  const validation=behaviorValidation(properties,action.event,{formFactor});
  if(validation)throw Error(validation);
  window.dispatchEvent(new CustomEvent('metadrive:in-screen-action',{
   detail:{pageSessionKey:runtime.pageSessionKey,componentId:component.id,event:action.event,value:action.value}}));
  const raw=actionFlows[action.event];
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('No metadata event action is configured for "'+action.event+'".');
  const binding=raw as Record<string,unknown>;
  const payload=eventPayload(action.value);
  setActionError('');
  const applyState=(changes:ReadonlyArray<{key:string;value:unknown}>)=>{
   const changed=runtime.store.merge(changes);
   runtime.broadcastState(changes);
   if(changed.length)void runtime.data.stateChanged(changed);
  };
  const saved=(detail:PageMutationDetail)=>{void runtime.data.saved(detail);runtime.broadcastSaved(detail);};
  const navigationContext={objects:runtime.objects,apps,pages,currentAppId,defaultObjectApiName:objectApiName};
  try{
   if(binding.actionType==='PageState'){
    const key=String(binding.stateKey??'');
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))throw Error('Page state action requires a valid metadata state key');
    applyState([{key,value:resolvePageStateInput(binding.value,payload,pageState,runtime.sessionId)}]);
    return {updated:true};
   }
   if(binding.actionType==='Navigate')
    return executeOpenPageActionNode({binding,context:navigationContext,onNavigate:onNavigate as never});
   if(binding.actionType==='AdjustNumber'){
    const changes=await adjustNumberRecord(runtime.request,binding as unknown as AdjustNumberBinding,payload,pageState,runtime.objects,objectApiName);
    applyState(changes);
    saved({objectApiNames:[objectApiName]});
    return {updated:true};
   }
   if(binding.actionType!=='Formula')throw Error('This action type runs on the previous runtime.');
   const assignment=parseActionFormulaAssignment(String(binding.formula??''));
   if(assignment?.kind==='navigate'){
    const name=resolveActionFormulaValue(assignment.value,payload,pageState,runtime.sessionId);
    if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*(?:\/[A-Za-z][A-Za-z0-9_]*)?$/.test(name))
     throw Error('Formula navigation requires a declared destination name.');
    const [first,second]=name.split('/');
    const next=assignment.key==='page'
     ?{actionType:'Navigate',navigationTargetType:'App Page',navigationAppId:first,navigationPageApiName:second??''}
     :assignment.key==='home'?{actionType:'Navigate',navigationTargetType:'App Home',navigationAppId:first}
     :{actionType:'Navigate',navigationTargetType:'Record List',navigationAppId:'Records',navigationObjectApiName:first};
    return executeOpenPageActionNode({binding:next,context:navigationContext,onNavigate:onNavigate as never});
   }
   // Record saves: the existing one-request, one-transaction server path.
   let predicted=false;
   let result:Awaited<ReturnType<typeof executePageFormulaAction>>;
   try{
    result=await executePageFormulaAction(runtime.request,binding,payload,pageState,runtime.objects,objectApiName,
     runtime.sessionId,undefined,undefined,undefined,{},prediction=>{
      predicted=true;
      saved({objectApiNames:prediction.objectApiNames,recordChanges:prediction.recordChanges,optimistic:prediction.batch});
     });
   }catch(error){
    if(predicted)saved({});
    throw error;
   }
   if(result.changes.length)applyState(result.changes);
   if(result.recordChanged)saved({objectApiNames:result.mutatedObjectApiNames?.length?result.mutatedObjectApiNames:undefined,
    recordChanges:result.recordChanges,replacesOptimistic:result.predictionBatch});
   else if(predicted)saved({});
   return {updated:true};
  }catch(error){
   setActionError(error instanceof Error?error.message:'Action failed');
   throw error;
  }
 };
 const started=useRef(false);
 useEffect(()=>{
  if(started.current||!actionFlows.start)return;
  started.current=true;
  void onAction({event:'start',value:{}}).catch(()=>{started.current=false;});
 // Run the page's start action once per page session.
 },[runtime]);
 const records=source.records;
 const loading=source.loading&&source.version===0;
 return <div style={definition.apiName==='smart_toggle'||(definition.apiName.startsWith('smart_')&&Boolean(component.position))||(definition.apiName==='ui_image'&&Boolean(component.position))
   ?{width:'100%',height:'100%',minHeight:0,minWidth:0}
   :properties.fillRegion===true?{height:'100%',minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}:undefined}
   data-compiled-component={component.id}>
  {source.error&&<div className="records-message" role="alert">{source.error}</div>}
  {actionError&&<div className="records-message" role="alert">{actionError}</div>}
  <RegisteredComponent definition={definition} layoutTransparent props={{
   ...resolved,...componentLayoutProps(properties,formFactor),
   ...(definition.apiName.startsWith('smart_')&&component.position?{canvasFrameSized:true}:{}),
   label:component.type.startsWith('Custom:smart_')&&typeof resolved.label==='string'?resolved.label:component.label,
   properties:resolved,objects:runtime.objects,reports:reports??[],flows:availableFlows,pageState:state,children,
   pageSessionKey:runtime.pageSessionKey,componentId:component.id,device:formFactor,onNavigate,onLaunchFlow,onAction,actionError,
   disabled:behaviorAction(properties,'click',{formFactor})!=='enabled',
   loadAsset:(id:string)=>requestPageMediaAsset<{contentType:string;contentBase64:string}>(runtime.request,id,getAccessToken()??''),
   viewRevision:source.version,
   loadCompanySettings:()=>runtime.request('/metadata/currencies'),
   onChange:(value:unknown)=>{if(actionFlows.change)void onAction({event:'change',value}).catch(()=>{});},
   loading,sessionId:runtime.sessionId,
   ...(records.length===1?{record:records[0]}:{}),
   ...(objectApiName?{records,recordPagination:{limit:SOURCE_PAGE_SIZE,offset:0,total:source.total,
    hasPrevious:false,hasNext:source.total>SOURCE_PAGE_SIZE,available:source.predictable}}:{})
  }}/>
 </div>;
}
export const MemoizedCompiledComponentNode=React.memo(CompiledComponentNode);
