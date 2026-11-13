import * as React from 'react';
import {createContext,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import type {LibraryComponentMetadata,ObjectMetadata,PageComponentMetadata,LightningAppMetadata,LightningPageMetadata,FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';
import {resolveMetadataProperties} from '../../metadata/Definitions/metadataReferences';
import {bindPageStateProperties,resolvePageStatePath} from '../PageRuntime/pageComponentBindings';
import {componentLayoutProps} from '../TemplatePageRuntime/pageComponentLayout';
import {behaviorAction,behaviorValidation,pageBehaviors} from '../PageRuntime/pageBehaviorRuntime';
import {executePageFormulaAction,parseActionFormulaAssignment,resolveActionFormulaValue} from '../PageRuntime/formulaAction';
import {adjustNumberRecord,type AdjustNumberBinding} from '../PageRuntime/adjustNumberRecord';
import {executeOpenPageActionNode} from '../PageRuntime/OpenPageActionNode';
import {isActionPlan,isScreenAction} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import {previewPrintTemplate,openFormulaScreen,closeFormulaScreen} from '../PageRuntime/screenFormula';
import {lockTillScreen} from '../../authentication/TillDevice/tillDevice';
import {runSequenceFlow} from '../PageRuntime/formulaFlowSequence';
import {flowActionFormulaTarget} from '../PageRuntime/actionFlowFormula';
import {runtimeComponentLabel} from '../PageRuntime/smartComponentLabel';
import {evaluateFieldExpressionDetailed} from '../../../component-libraries/shared/FieldExpression.js';
import {requestPageMediaAsset} from '../PageRuntime/pageMediaAssetCoalescer';
import type {PageMutationDetail} from '../PageRuntime/pageMutationScope';
import {scopedFieldAllows} from '../PageRuntime/fieldScopedRecordFilters';
import {loadFlowScreenRecordPage,loadFlowScreenRecords,getAccessToken} from '../../authentication/Client/authClient';
import {presentPageRecords,type ChannelGrant} from '../../records/RecordWorkspace/recordPresentationAdapters';
import {resolveFlowOutputBindings,resolveStructuredFlowInput} from '../../automation/FlowScreen/flowInputBindings';
import {useFlowStateChannel} from '../../automation/FlowScreen/useFlowStateChannel';
import type {CompiledPage,CompiledComponent} from './compilePage';
import {createCompiledPageStore,createCompiledDataLayer,SOURCE_PAGE_SIZE,type CompiledPageStore,type CompiledDataLayer} from './compiledPageStore';
import {compiledSourceLoader} from './compiledSourceLoader';
import {PURE_ACTION_FUNCTIONS} from './generatePageScript';
import type {LoadedPageScript} from './serverPageScript';
import {pageStateDependencies} from '../PageRuntime/pageStateDependencies';
import {componentInstanceNames} from '../../../../../server/src/system-support/page-component-names';
import {componentStateFromEvent,componentStateName,type ComponentState} from '../../../../../server/src/expression-engine/FormulaComponentState';
import {usePageCollectionFormula,namedCollectionRows} from '../PageRuntime/usePageCollectionFormula';
import {resolveMentionProperties,referencedMentionPaths,resolveCollectionMentionRows} from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';
import {explicitMentionRecordId,useRelationshipMentionContext} from '../../records/RecordFormDialog/useRelationshipMentionContext';
import {resolveSmartToggleFieldBinding,updateSmartToggleField} from '../PageRuntime/smartToggleFieldBinding';

/**
 * Compiled page runtime: runs the page the compiler produced. One provider
 * per page owns the ONLY page store, the ONLY data loads and the page's few
 * window listeners. Components are drawers: they read the store and their
 * shared data source and redraw only when something they read changes.
 * Every data/state/action feature of a page runs here; there is no fallback
 * engine. Window events are still emitted so Flows, screens and the page
 * layout (interactions, overlays) keep working unchanged.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Flows=Array<Pick<FlowDefinitionMetadata,'id'|'apiName'|'label'|'flowType'|'status'>>;
type Runtime={compiled:CompiledPage;byId:ReadonlyMap<string,CompiledComponent>;store:CompiledPageStore;
 /** The server-built page file this page runs from (null: the browser-compiled plan). */
 script:LoadedPageScript|null;
 data:CompiledDataLayer;request:Request;objects:ObjectMetadata[];pageSessionKey:string;recordId:string;
 searchRecords(sourceId:string,query:string):Promise<Record<string,unknown>[]>;
 /** Remember what the user picked/typed/toggled in a component, under its page
  * name, so any formula, filter or action reads @Name.state.Id / Value / Text. */
 publishState(componentId:string,value:unknown):void;
 sessionId:()=>string;subscribeSession(listener:()=>void):()=>void;
 /** Flow "reset session on success": a fresh page session, state and data. */
 resetSession(next?:string):void;
 /** Tells Flows, screens and the page layout about compiled changes. */
 broadcastState(changes:ReadonlyArray<{key:string;value:unknown}>):void;
 broadcastSaved(detail:PageMutationDetail):void};
const CompiledRuntimeContext=createContext<Runtime|null>(null);
export const useCompiledPageRuntime=()=>useContext(CompiledRuntimeContext);
const compiledOrigin='compiled-runtime';
const sessionStorageKey=(pageSessionKey:string)=>'metadrive-page-session:'+pageSessionKey;

function pageSessionId(pageSessionKey:string,override?:string):string{
 if(override)return override;
 try{
  let value=window.sessionStorage.getItem(sessionStorageKey(pageSessionKey));
  if(!value){value=crypto.randomUUID();window.sessionStorage.setItem(sessionStorageKey(pageSessionKey),value);}
  return value;
 }catch{return crypto.randomUUID();}
}

export function CompiledPageProvider({compiled:browserPlan,script=null,components,objects,request,pageSessionKey,initialState,sessionIdOverride,recordId='',children}:{
 compiled:CompiledPage;script?:LoadedPageScript|null;components:readonly PageComponentMetadata[];objects:ObjectMetadata[];request:Request;pageSessionKey:string;
 initialState?:Record<string,unknown>;sessionIdOverride?:string;recordId?:string;children:ReactNode;
}){
 // A server-built file carries its own plan: the page runs exactly that.
 const compiled=script?.plan??browserPlan;
 const runtime=useMemo<Runtime>(()=>{
  let sessionId=pageSessionId(pageSessionKey,sessionIdOverride);
  const sessionListeners=new Set<()=>void>();
  // Which selections clear which (Category → Product): computed once for the page.
  const store=createCompiledPageStore(compiled,initialState,pageStateDependencies(components));
  const sourceLoader=compiledSourceLoader(objects,()=>({sessionId,recordId}),loadFlowScreenRecordPage);
  const data=createCompiledDataLayer(compiled,sourceLoader,store.get,objects);
  const stateNames=new Map([...componentInstanceNames(components)].map(([id,name])=>[id,componentStateName(name)]));
  const typing=new Map<string,number>();
  const publish=(name:string,value:ComponentState)=>{
   const changed=store.select('collection',name,value);
   if(changed.length)void data.stateChanged(changed);
  };
  return {
   publishState(componentId:string,value:unknown){
    const name=stateNames.get(componentId);
    const next=name?componentStateFromEvent(value):null;
    if(!name||!next)return;
    window.clearTimeout(typing.get(componentId));
    // Typed text (Search Box) waits for a short pause, so lists reload once, not per key.
    if(typeof value==='string')typing.set(componentId,window.setTimeout(()=>publish(name,next),250));
    else publish(name,next);
   },compiled,script,byId:new Map(compiled.components.map(item=>[item.id,item])),store,data,request,objects,
   searchRecords:async(sourceId:string,query:string)=>{
    const source=compiled.dataSources.find(item=>item.id===sourceId);
    if(!source)throw Error('Search Box has no configured Object data source');
    return sourceLoader.search(source,store.get(),query);
   },
   pageSessionKey,recordId,
   sessionId:()=>sessionId,
   subscribeSession(listener){sessionListeners.add(listener);return ()=>{sessionListeners.delete(listener);};},
   resetSession(next){
    sessionId=next??crypto.randomUUID();
    try{window.sessionStorage.setItem(sessionStorageKey(pageSessionKey),sessionId);}catch{/* private window */}
    store.reset({});
    sessionListeners.forEach(listener=>listener());
    void data.start();
   },
   broadcastState(changes){
    for(const change of changes)window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
     detail:{pageSessionKey,key:change.key,value:change.value,origin:compiledOrigin}}));
   },
   broadcastSaved(detail){
    window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
     detail:{...detail,pageSessionKey,sessionId,origin:compiledOrigin}}));
   }};
 // One runtime per compiled page version; metadata edits recompile.
 },[compiled,script,components,objects,request,pageSessionKey,sessionIdOverride,recordId]);
 useEffect(()=>{
  void runtime.data.start();
  // Flows and screens speak window events: fold them into the one store.
  const onState=(event:Event)=>{
   const detail=(event as CustomEvent<{pageSessionKey?:string;key?:string;value?:unknown;origin?:string}>).detail;
   if(detail?.origin===compiledOrigin||detail?.pageSessionKey!==runtime.pageSessionKey)return;
   if(typeof detail.key!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(detail.key))return;
   const changed=runtime.store.select('state',detail.key,detail.value);
   if(changed.length)void runtime.data.stateChanged(changed);
  };
  const onSaved=(event:Event)=>{
   const detail=(event as CustomEvent<PageMutationDetail&{origin?:string}>).detail;
   if(detail?.origin===compiledOrigin||detail?.pageSessionKey!==runtime.pageSessionKey)return;
   // A Flow that started a new page session moves the whole page to it.
   if(detail.sessionId&&detail.sessionId!==runtime.sessionId()){runtime.resetSession(detail.sessionId);return;}
   void runtime.data.saved(detail);
  };
  const onSelected=(event:Event)=>{
   const detail=(event as CustomEvent<{pageSessionKey?:string;name?:string;value?:unknown}>).detail;
   if(detail?.pageSessionKey!==runtime.pageSessionKey||typeof detail.name!=='string'
     ||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(detail.name))return;
   const changed=runtime.store.select('collection',detail.name,detail.value);
   if(changed.length)void runtime.data.stateChanged(changed);
  };
  window.addEventListener('metadrive:page-local-state',onState);
  window.addEventListener('metadrive:page-flow-mutated',onSaved);
  window.addEventListener('metadrive:page-collection-selected',onSelected);
  return ()=>{
   window.removeEventListener('metadrive:page-local-state',onState);
   window.removeEventListener('metadrive:page-flow-mutated',onSaved);
   window.removeEventListener('metadrive:page-collection-selected',onSelected);
  };
 },[runtime]);
 return <CompiledRuntimeContext.Provider value={runtime}>{children}</CompiledRuntimeContext.Provider>;
}

/** Redraw when (and only when) this component's own readers fire. */
function useComponentState(runtime:Runtime,id:string){
 return useSyncExternalStore(listener=>runtime.store.subscribeComponent(id,listener),runtime.store.get,runtime.store.get);
}
const emptySource={records:[] as Record<string,unknown>[],total:0,loading:false,error:'',hasMore:false,loadingMore:false,predictable:false,version:0};
function useSourceSnapshot(runtime:Runtime,sourceId:string|undefined){
 return useSyncExternalStore(
  listener=>sourceId?runtime.data.subscribe(sourceId,listener):()=>{},
  ()=>sourceId?runtime.data.get(sourceId):emptySource,
  ()=>sourceId?runtime.data.get(sourceId):emptySource);
}
const eventPayload=(value:unknown):Record<string,unknown>=>
 value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{value};
const identifier=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Declarative action inputs ($state, $event, $session, $record, structured). Never scripts. */
function resolveInput(source:unknown,payload:Record<string,unknown>,state:Readonly<Record<string,unknown>>,
 sessionId:string,record:Readonly<Record<string,unknown>>|undefined):unknown{
 const again=(candidate:unknown)=>resolveInput(candidate,payload,state,sessionId,record);
 if(source&&typeof source==='object'&&!Array.isArray(source)){
  const option=source as Record<string,unknown>;
  if(option.source==='ToNumber'||option.source==='ProjectRecords')return resolveStructuredFlowInput(option,again);
  if(option.source==='FirstNonEmpty'&&Array.isArray(option.values)&&option.values.length>0&&option.values.length<=5){
   for(const candidate of option.values){
    const result=again(candidate);
    if(typeof result==='string'&&result.trim())return result.trim();
   }
   return '';
  }
  if(option.source==='NormalizePhone'){
   const result=again(option.value);
   return typeof result==='string'?result.replace(/[^0-9]/g,''):'';
  }
  return undefined;
 }
 if(source==='$session')return sessionId;
 if(typeof source==='string'&&source.startsWith('$state.'))return resolvePageStatePath(state,source.slice(7));
 if(source==='$event')return payload;
 if(typeof source==='string'&&source.startsWith('$event.'))
  return source.slice(7).split('.').reduce<unknown>((current,key)=>
   current&&typeof current==='object'&&!['__proto__','prototype','constructor'].includes(key)
    ?(current as Record<string,unknown>)[key]:undefined,payload);
 if(typeof source==='string'&&source.startsWith('$record.')){
  const field=source.slice(8);
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(field)?record?.[field]:undefined;
 }
 return source;
}

type ChannelAccess={userId:string;viewAll:boolean;grants:ChannelGrant[];eligibleAssignees:{id:string;name:string;channelAccountId:string}[]};
const noChannelAccess:ChannelAccess={userId:'',viewAll:false,grants:[],eligibleAssignees:[]};
/** Channel grants for record presenters: authenticated API only, refreshed on focus. */
function useChannelAccess(request:Request,path:unknown,version:number):ChannelAccess{
 const [access,setAccess]=useState<ChannelAccess>(noChannelAccess);
 useEffect(()=>{
  setAccess(noChannelAccess);
  const accessPath=String(path??'');
  if(!/^\/[A-Za-z0-9/_-]+$/.test(accessPath))return;
  let active=true,request_=0;
  const load=()=>{
   const id=++request_;
   void request<ChannelAccess>(accessPath).then(value=>{if(active&&id===request_)setAccess(value);})
    .catch(()=>{if(active&&id===request_)setAccess(noChannelAccess);});
  };
  load();
  const onVisible=()=>{if(document.visibilityState==='visible')load();};
  window.addEventListener('focus',load);document.addEventListener('visibilitychange',onVisible);
  const timer=window.setInterval(onVisible,20000);
  return ()=>{active=false;window.clearInterval(timer);
   window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',onVisible);};
 },[request,path,version]);
 return access;
}
/** Contact choices: one authorised read of the configured contacts Object. */
function useContactChoices(properties:Readonly<Record<string,unknown>>,version:number){
 const object=typeof properties.contactsObjectApiName==='string'?properties.contactsObjectApiName:'';
 const [rows,setRows]=useState<Record<string,unknown>[]>([]);
 useEffect(()=>{
  let active=true;
  setRows([]);
  if(!object)return ()=>{active=false;};
  void loadFlowScreenRecords(object).then(value=>{if(active)setRows(value);}).catch(()=>{if(active)setRows([]);});
  return ()=>{active=false;};
 },[object,version]);
 if(!object)return null;
 return rows.map(row=>({id:String(row.Id??''),name:String(row[String(properties.contactNameFieldApiName??'')]??''),
  phone:String(row[String(properties.contactPhoneFieldApiName??'')]??'')})).filter(contact=>contact.id&&contact.phone);
}

export function CompiledComponentNode({definition,component,objectApiName,formFactor,apps,pages,currentAppId,
 availableFlows,reports,onNavigate,onLaunchFlow,children}:{
 definition:LibraryComponentMetadata;component:PageComponentMetadata;objectApiName:string;
 formFactor:'Desktop'|'Tablet'|'Phone';apps:LightningAppMetadata[];pages:LightningPageMetadata[];currentAppId:string;
 availableFlows:Flows;reports?:unknown[];
 onNavigate:(route:never)=>void;onLaunchFlow:(flowApiName:string,inputs?:Record<string,unknown>,context?:{requestId?:string})=>void;
 children?:ReactNode;
}){
 const runtime=useCompiledPageRuntime()!;
 const compiled=runtime.byId.get(component.id)!;
 const state=useComponentState(runtime,component.id);
 const source=useSourceSnapshot(runtime,compiled.dataSourceId);
 const sessionId=useSyncExternalStore(runtime.subscribeSession,runtime.sessionId,runtime.sessionId);
 const [actionError,setActionError]=useState('');
 const properties=useMemo(()=>resolveMetadataProperties({...component.properties,objectApiName},runtime.objects,availableFlows),
  [component.properties,objectApiName,runtime.objects,availableFlows]);
 const actionFlows=(properties.actionFlows&&typeof properties.actionFlows==='object'&&!Array.isArray(properties.actionFlows)
  ?properties.actionFlows:{}) as Record<string,unknown>;
 const fields=runtime.objects.find(item=>item.apiName===objectApiName)?.fields??[];
 // Resolve metadata-validated parent lookups for each Card/Table row, not only
 // for a single record page. Every read still goes through tenant/RBAC API.
 const rowMentionKey=JSON.stringify([source.version,objectApiName,source.records.map(row=>row.Id),
  Object.entries(properties).filter(([,value])=>typeof value==='string'&&value.includes('@'))]);
 const [rowMentions,setRowMentions]=useState<{key:string;rows:Record<string,unknown>[]} |null>(null);
 useEffect(()=>{
  let active=true;
  setRowMentions(null);
  if(!objectApiName||!source.records.length||
    !referencedMentionPaths(properties,runtime.objects,objectApiName).some(path=>path.steps.length))
   return()=>{active=false};
  const getRecord=async(target:string,id:string)=>{
   const result=await runtime.request<{record:Record<string,unknown>}>(
    '/records/'+encodeURIComponent(target)+'/'+encodeURIComponent(id));
   return result.record?.Id===id?result.record:undefined;
  };
  const getRecords=async(target:string,ids:readonly string[])=>
   (await loadFlowScreenRecordPage(target,{limit:100,filters:[{field:'Id',operator:'in',value:[...ids]}]})).records;
  void Promise.all(Array.from({length:Math.ceil(source.records.length/100)},(_,i)=>
   resolveCollectionMentionRows(runtime.objects,objectApiName,source.records.slice(i*100,(i+1)*100),
    properties,getRecord,getRecords))).then(parts=>{
    if(active)setRowMentions({key:rowMentionKey,rows:parts.flat()});
   }).catch(()=>{if(active)setRowMentions(null)});
  return()=>{active=false};
 },[rowMentionKey,runtime,properties,source.records,objectApiName]);
 const displayRows=rowMentions?.key===rowMentionKey?rowMentions.rows:source.records;
 // @Object.Field mentions: same authorised loader; it reads only when a record id is bound.
 const mentionRoot=runtime.compiled.targetObject||objectApiName;
 const boundRecordId=runtime.recordId||explicitMentionRecordId(properties);
 const mentionContext=useRelationshipMentionContext(runtime.objects,mentionRoot,boundRecordId,
  properties,runtime.request,source.version);
 const resolved=useMemo(()=>{
  const bound=bindPageStateProperties(resolveMentionProperties(properties,mentionContext.records,mentionContext.fields,
   runtime.objects,mentionRoot),state);
  // Row-level @Object.Field formulas stay as written: list renderers resolve them per row.
  const withRows={...bound,...Object.fromEntries(Object.entries(properties).filter(([,value])=>
   typeof value==='string'&&/@[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/.test(value)))};
  // Page-level display formulas (page state, session, plain functions) run from the
  // converted page file. Row, Object, collection and database formulas stay with the
  // component, which resolves them per record with the same formula library.
  const script=runtime.script;
  if(!script)return withRows;
  const textKinds=['TEXT','LONG_TEXT','TEXTAREA','STRING'];
  const fromFile:Record<string,unknown>={};
  for(const formula of compiled.formulas){
   const run=script.formulas[component.id+':'+formula.property];
   if(!run||formula.error||formula.property.includes('.')||withRows[formula.property]!==formula.source)continue;
   if(!definition.propertyDefinitions?.some(item=>item.propertyKey===formula.property&&textKinds.includes(item.kind)))continue;
   if(!formula.references.every(ref=>/^\$state\.[A-Za-z][A-Za-z0-9_.]*$|^\$session$/.test(ref)))continue;
   if(!formula.functions.every(name=>PURE_ACTION_FUNCTIONS.has(name)))continue;
   try{fromFile[formula.property]=run({record:{},state,sessionId:runtime.sessionId()});}
   catch{/* The component shows the formula's own error. */}
  }
  return Object.keys(fromFile).length?{...withRows,...fromFile}:withRows;
 },[properties,mentionContext,runtime.objects,mentionRoot,state,runtime.script,compiled,definition]);
 // COLLECTION()/TABLE(): users author collections; the shared rows feed them.
 const namedSource=usePageCollectionFormula(properties.collectionFormula,properties,runtime.objects,objectApiName,
  source.records,source.total,source.version,state,sessionId,runtime.pageSessionKey,component.id);
 const dataCollection=properties.recordPresenterApiName?null:namedSource.collection;
 const dataCollectionRows=dataCollection?namedCollectionRows(dataCollection):null;
 // Record presenters (inboxes) and contact choices.
 const channelAccess=useChannelAccess(runtime.request,properties.channelAccessPath,source.version);
 const presented=presentPageRecords(properties.recordPresenterApiName,source.records as never,channelAccess,properties);
 const contactChoices=useContactChoices(properties,source.version);
 const stateChannel=useFlowStateChannel(properties,sessionId,runtime.request,false);
 // Two-way toggle bound to one Boolean field of one authorised record.
 const boundRow=boundRecordId&&mentionContext.records[objectApiName]?.Id===boundRecordId
  ?[mentionContext.records[objectApiName]]:source.records;
 const toggleBinding=resolveSmartToggleFieldBinding(definition.apiName,properties,objectApiName,fields,
  boundRow,boundRow===source.records?source.total:1,boundRecordId);
 const toggleCanWrite=Boolean(toggleBinding?.ready&&behaviorAction(properties,'change',{formFactor})==='enabled');
 // Screen Flow outputs arrive by event when the interview completes.
 const pendingFlows=useRef(new Map<string,{flowApiName:string;mappings:Record<string,unknown>}>());
 // Same selection rule as every other state write: dependants of a changed key are cleared.
 const applyState=(changes:ReadonlyArray<{key:string;value:unknown}>)=>{
  const changed=[...new Set(changes.flatMap(change=>identifier.test(change.key)?runtime.store.select('state',change.key,change.value):[]))];
  runtime.broadcastState(changes);
  if(changed.length)void runtime.data.stateChanged(changed);
 };
 const saved=(detail:PageMutationDetail)=>{void runtime.data.saved(detail);runtime.broadcastSaved(detail);};
 useEffect(()=>{
  const complete=(event:Event)=>{
   const detail=(event as CustomEvent<{requestId?:string;flowApiName?:string;outputs?:Record<string,unknown>}>).detail;
   const pending=typeof detail?.requestId==='string'?pendingFlows.current.get(detail.requestId):undefined;
   if(!pending||pending.flowApiName!==detail.flowApiName)return;
   pendingFlows.current.delete(detail.requestId!);
   try{
    const outputs=detail.outputs&&typeof detail.outputs==='object'&&!Array.isArray(detail.outputs)?detail.outputs:{};
    applyState(resolveFlowOutputBindings(outputs,pending.mappings));
    saved({});
   }catch(error){setActionError(error instanceof Error?error.message:'Unable to apply Flow outputs');}
  };
  const fail=(event:Event)=>{
   const detail=(event as CustomEvent<{requestId?:string}>).detail;
   if(typeof detail?.requestId==='string')pendingFlows.current.delete(detail.requestId);
  };
  window.addEventListener('metadrive:flow-completed',complete);
  window.addEventListener('metadrive:flow-failed',fail);
  window.addEventListener('metadrive:flow-paused',fail);
  return ()=>{
   window.removeEventListener('metadrive:flow-completed',complete);
   window.removeEventListener('metadrive:flow-failed',fail);
   window.removeEventListener('metadrive:flow-paused',fail);
   pendingFlows.current.clear();
  };
 },[runtime]);
 const onAction=async(action:{event:string;value?:unknown})=>{
  const session=runtime.sessionId();
  if(behaviorAction(properties,action.event,{formFactor})!=='enabled')
   throw Error('This action is unavailable under the published Page rules.');
  const validation=behaviorValidation(properties,action.event,{formFactor});
  if(validation)throw Error(validation);
  // Tabs, Navigation, Toggle, Search Box, Lookup, grids… publish their value
  // first, so an action and any reader of @Name.state.* see the new pick.
  if(['change','select','click'].includes(action.event))runtime.publishState(component.id,action.value);
  window.dispatchEvent(new CustomEvent('metadrive:in-screen-action',{
   detail:{pageSessionKey:runtime.pageSessionKey,componentId:component.id,event:action.event,value:action.value}}));
  // Page interactions (show/hide/set another component) are applied by the page layout.
  const interactions=pageBehaviors(properties)?.interactions;
  const hasInteraction=Array.isArray(interactions)&&(interactions as Array<{event?:unknown}>).some(item=>item?.event===action.event);
  if(hasInteraction)window.dispatchEvent(new CustomEvent('metadrive:page-component-interaction',{
   detail:{pageSessionKey:runtime.pageSessionKey,componentId:component.id,event:action.event,value:action.value}}));
  // Selecting a collection item publishes it for every reader (no Flow needed).
  const selection=action.value&&typeof action.value==='object'&&!Array.isArray(action.value)?action.value as Record<string,unknown>:null;
  const collectionName=selection?.collectionName;
  const selectsCollection=action.event==='change'&&typeof collectionName==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(collectionName);
  if(selectsCollection){
   const record=selection?.record&&typeof selection.record==='object'&&!Array.isArray(selection.record)
    ?selection.record as Record<string,unknown>:{};
   window.dispatchEvent(new CustomEvent('metadrive:page-collection-selected',{detail:{
    pageSessionKey:runtime.pageSessionKey,name:collectionName,
    value:{Id:String(record.Id??selection?.value??''),Name:String(record.Name??''),Value:selection?.value??null,
     Field:typeof record.Field==='string'?record.Field:'',Criteria:typeof record.Criteria==='string'?record.Criteria:''}}}));
  }
  const raw=actionFlows[action.event];
  const binding=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
  if(!binding){
   if(hasInteraction||selectsCollection)return {updated:true};
   throw Error('No metadata event action is configured for "'+action.event+'".');
  }
  const payload=eventPayload(action.value);
  const record=source.records.length===1?source.records[0]:mentionContext.records[mentionRoot];
  const input=(value:unknown,event:Record<string,unknown>=payload)=>resolveInput(value,event,runtime.store.get(),session,record);
  const navigationContext={objects:runtime.objects,apps,pages,currentAppId,defaultObjectApiName:objectApiName};
  const selectFilter=(filterKey:string,value:string,label:string)=>{
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(filterKey))throw Error('Invalid filter key');
   window.dispatchEvent(new CustomEvent('metadrive:page-filter-selected',{detail:{
    pageSessionKey:runtime.pageSessionKey,filterKey,value,label,
    recordId:String(payload.recordId??''),sourceObjectApiName:String(payload.sourceObjectApiName??'')}}));
   return {selected:value};
  };
  const navigateTo=(kind:string,name:unknown)=>{
   if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*(?:\/[A-Za-z][A-Za-z0-9_]*)?$/.test(name))
    throw Error('Formula navigation requires a declared destination name.');
   const [first,second]=name.split('/');
   const next=kind==='page'
    ?{actionType:'Navigate',navigationTargetType:'App Page',navigationAppId:first,navigationPageApiName:second??''}
    :kind==='home'?{actionType:'Navigate',navigationTargetType:'App Home',navigationAppId:first}
    :{actionType:'Navigate',navigationTargetType:'Record List',navigationAppId:'Records',navigationObjectApiName:first};
   return executeOpenPageActionNode({binding:next,context:navigationContext,onNavigate:onNavigate as never});
  };
  // Record saves: one request, one SQL transaction. The saved rows are shown
  // first (prediction) and replaced by the real save.
  const runSave=async(settings:Record<string,unknown>,event:Record<string,unknown>,
   compiledAction?:{pageApiName:string;variant:string;revision:number;key:string})=>{
   let predicted=false;
   let result:Awaited<ReturnType<typeof executePageFormulaAction>>;
   try{
    result=await executePageFormulaAction(runtime.request,settings,event,runtime.store.get(),runtime.objects,objectApiName,
     session,(template,id)=>previewPrintTemplate(template,id,runtime.pageSessionKey,session,currentAppId),
     // SCREEN/CLOSESCREEN/FLOW steps inside an action plan (same as the standard runtime).
     async(name,target,mode,screenRecordId)=>{
      if(name==='CLOSESCREEN')return closeFormulaScreen(runtime.pageSessionKey);
      if(name==='LOCKSCREEN')return lockTillScreen();
      if(name==='SCREEN')return openFormulaScreen('SCREEN('+target+(mode?','+mode:'')+')',navigationContext,
       onNavigate as never,runtime.pageSessionKey,session,
       screenRecordId??String(event.recordId??runtime.store.get().recordId??record?.Id??''));
      return runSequenceFlow(target,availableFlows,runtime.request,onLaunchFlow);
     },undefined,{},prediction=>{
      predicted=true;
      saved({objectApiNames:prediction.objectApiNames,recordChanges:prediction.recordChanges,optimistic:prediction.batch});
     },compiledAction);
   }catch(error){
    if(predicted)saved({});
    throw error;
   }
   if(result.changes.length)applyState(result.changes);
   if(result.recordChanged)saved({objectApiNames:result.mutatedObjectApiNames?.length?result.mutatedObjectApiNames:undefined,
    recordChanges:result.recordChanges,replacesOptimistic:result.predictionBatch});
   else if(predicted)saved({});
   return {updated:true};
  };
  const runBinding=async(settings:Record<string,unknown>,event:Record<string,unknown>=payload):Promise<unknown>=>{
   const pageState=runtime.store.get();
   if(settings.actionType==='SetFilter'){
    const key=String(settings.filterKey||'category');
    const value=String(event.value??event.label??'');
    return selectFilter(key,value,String(event.label??value));
   }
   if(settings.actionType==='PageState'){
    const key=String(settings.stateKey??'');
    if(!identifier.test(key))throw Error('Page state action requires a valid metadata state key');
    applyState([{key,value:input(settings.value,event)}]);
    return {updated:true};
   }
   if(settings.actionType==='Navigate')
    return executeOpenPageActionNode({binding:settings,context:navigationContext,onNavigate:onNavigate as never});
   if(settings.actionType==='AdjustNumber'){
    const changes=await adjustNumberRecord(runtime.request,settings as unknown as AdjustNumberBinding,event,pageState,runtime.objects,objectApiName);
    applyState(changes);
    saved({objectApiNames:[objectApiName]});
    return {updated:true};
   }
   if(settings.actionType==='Formula'){
    const formula=String(settings.formula??'');
    // SCREEN(Page[,mode[,record]]) opens a page or popup (was missing in compiled mode).
    if(isScreenAction(formula))
     return openFormulaScreen(formula,navigationContext,onNavigate as never,runtime.pageSessionKey,session,
      String(event.recordId??pageState.recordId??record?.Id??''),
      source=>{
       const result=evaluateFieldExpressionDetailed('='+source,event,{sessionId:session,pageState});
       if(result.error)throw Error('SCREEN record Id: '+result.error);
       return result.value;
      });
    // $flow formula: IF(..., $flow.A, $flow.B) picks the Flow; blank = do nothing.
    if(!isActionPlan(formula)){
     const flow=flowActionFormulaTarget(settings,event,pageState,session,availableFlows);
     if(flow==='')return {skipped:true};
     if(flow)return runBinding({...settings,actionType:'Flow',flowApiName:flow},event);
    }
    const assignment=parseActionFormulaAssignment(formula);
    if(assignment?.kind==='filter'){
     const value=String(resolveActionFormulaValue(assignment.value,event,pageState,session)??'');
     return selectFilter(assignment.key,value,value);
    }
    if(assignment?.kind==='navigate')
     return navigateTo(assignment.key,resolveActionFormulaValue(assignment.value,event,pageState,session));
    return runSave(settings,event);
   }
   // Flow actions: Screen Flows open their screen; Autolaunched Flows run on the server.
   const flowApiName=String(settings.flowApiName??'');
   const selected=availableFlows.find(flow=>flow.apiName===flowApiName);
   const flowType=selected?.flowType??settings.flowType;
   if(selected&&selected.status!=='Active')throw Error('Choose an active Flow for the "'+action.event+'" action in Page Builder.');
   if(flowType!=='Screen Flow'&&flowType!=='In-Screen Flow'&&flowType!=='Autolaunched Flow')
    throw Error('Configure an Autolaunched Flow for this standalone app action.');
   const inputs=Object.fromEntries(Object.entries(settings.inputs&&typeof settings.inputs==='object'&&!Array.isArray(settings.inputs)
    ?settings.inputs as Record<string,unknown>:{}).map(([key,value])=>[key,input(value,event)]));
   if(settings.inputRules&&typeof settings.inputRules==='object'&&!Array.isArray(settings.inputRules))
    for(const [name,rule] of Object.entries(settings.inputRules as Record<string,unknown>)){
     if(!identifier.test(name))throw Error('Invalid input rule');
     const value=inputs[name];
     if(rule==='NonEmpty'&&(typeof value!=='string'||!value.trim()))throw Error('Please provide '+name+'.');
     if(rule==='E164'&&(typeof value!=='string'||!/^[1-9][0-9]{6,14}$/.test(value)))
      throw Error('Enter a valid international phone number, including country code.');
    }
   if(settings.outputs!==undefined&&(!settings.outputs||typeof settings.outputs!=='object'||Array.isArray(settings.outputs)))
    throw Error('Flow output mappings must be an object.');
   const mappings:Record<string,unknown>={...(settings.outputs as Record<string,unknown>|undefined)};
   resolveFlowOutputBindings({},mappings);
   if(flowType==='Screen Flow'||flowType==='In-Screen Flow'){
    if(!selected)throw Error('Screen Flow metadata is unavailable for this action.');
    if(pendingFlows.current.size>=10)throw Error('Too many pending Flow output mappings.');
    const requestId=crypto.randomUUID();
    pendingFlows.current.set(requestId,{flowApiName,mappings});
    onLaunchFlow(flowApiName,inputs,{requestId});
    return {interviewStarted:true};
   }
   const response=await runtime.request<{outputs?:Record<string,unknown>;interviewId?:string}>(
    '/flows/'+encodeURIComponent(flowApiName)+'/execute',{method:'POST',body:JSON.stringify(inputs)});
   if(response.interviewId)throw Error('This action was paused by a Flow Wait element.');
   const outputs=response.outputs&&typeof response.outputs==='object'&&!Array.isArray(response.outputs)?response.outputs:{};
   applyState(resolveFlowOutputBindings(outputs,mappings));
   if(settings.successState&&typeof settings.successState==='object'&&!Array.isArray(settings.successState))
    applyState(Object.entries(settings.successState as Record<string,unknown>)
     .filter(([key,value])=>identifier.test(key)&&(value===null||['string','number','boolean'].includes(typeof value)))
     .map(([key,value])=>({key,value})));
   if(settings.resetSessionOnSuccess===true)runtime.resetSession();
   else if(settings.mutatesData!==false)saved({});
   return {...response,completed:typeof settings.successOutput==='string'
    &&response.outputs?.[settings.successOutput]===settings.successValue};
  };
  // The server-built page file's compiled action, when the page runs from it (fix 2 + 4).
  const script=runtime.script;
  const compiledAction=script?.actions[component.id+':'+action.event];
  const compiledContext={
   sessionId:session,
   setState:(key:string,value:unknown)=>{
    if(!identifier.test(key))throw Error('Page state action requires a valid metadata state key');
    applyState([{key,value}]);
   },
   pick:(event:unknown,path:readonly string[])=>path.reduce<unknown>((current,key)=>
    current&&typeof current==='object'&&!['__proto__','prototype','constructor'].includes(key)
     ?(current as Record<string,unknown>)[key]:undefined,event),
   statePath:(path:string)=>resolvePageStatePath(runtime.store.get(),path),
   recordField:(field:string)=>/^[A-Za-z][A-Za-z0-9_]*$/.test(field)?record?.[field]:undefined,
   input:(value:unknown,event:Record<string,unknown>)=>input(value,event),
   formulaScope:(event:Record<string,unknown>)=>({record:{state:runtime.store.get(),event,session:{id:session}},
    state:runtime.store.get(),sessionId:session}),
   platformValue:async(kind:string,expression:string,event:Record<string,unknown>)=>kind==='state'
    ?(await executePageFormulaAction(runtime.request,{actionType:'Formula',formula:'@state.value := '+expression},
      event,runtime.store.get(),runtime.objects,objectApiName,session)).changes[0]?.value
    :resolveActionFormulaValue(expression,event,runtime.store.get(),session),
   save:(key:string,plan:{formula:string},event:Record<string,unknown>)=>runSave(
    {...binding,actionType:'Formula',formula:plan.formula},event,
    script?{pageApiName:runtime.compiled.apiName,variant:script.variant,revision:script.revision,key,
     ...(script.previewId?{previewId:script.previewId}:{}),...(script.app?{app:script.app}:{})}:undefined),
   runFormula:(settings:Record<string,unknown>,event:Record<string,unknown>)=>runBinding(settings,event),
   navigate:(settings:Record<string,unknown>)=>runBinding(settings),
   navigateTo:async(kind:string,target:unknown)=>navigateTo(kind,target),
   selectFilter:async(key:string,value:unknown)=>selectFilter(key,String(value??''),String(value??'')),
   adjustNumber:(settings:Record<string,unknown>,event:Record<string,unknown>)=>runBinding(settings,event),
   runFlow:(settings:Record<string,unknown>,event:Record<string,unknown>)=>runBinding(settings,event)
  };
  setActionError('');
  try{
   return compiledAction?await compiledAction(compiledContext,payload):await runBinding(binding);
  }catch(error){
   setActionError(error instanceof Error?error.message:'Action failed');
   throw error;
  }
 };
 const actionRef=useRef(onAction);
 actionRef.current=onAction;
 const started=useRef('');
 useEffect(()=>{
  if(started.current===sessionId||!actionFlows.start)return;
  started.current=sessionId;
  void actionRef.current({event:'start',value:{}}).catch(()=>{started.current='';});
 // The page's start action runs once per page session.
 },[sessionId]);
 // Live refresh: re-read this component's rows while the page is visible.
 useEffect(()=>{
  if(properties.liveRefreshEnabled!==true||!compiled.dataSourceId)return;
  const id=compiled.dataSourceId;
  const refresh=()=>{if(document.visibilityState==='visible')void runtime.data.reload(id);};
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  const timer=window.setInterval(refresh,5000);
  return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[properties.liveRefreshEnabled,compiled.dataSourceId,runtime]);
 // Live Flow refresh: run the configured refresh events on an interval and after saves.
 useEffect(()=>{
  if(properties.liveFlowRefreshEnabled!==true)return;
  const raw=typeof properties.liveFlowRefreshEvents==='string'?properties.liveFlowRefreshEvents:'refresh';
  const events=raw.split(',').map(key=>key.trim())
   .filter(key=>identifier.test(key)&&key!=='start'&&Object.prototype.hasOwnProperty.call(actionFlows,key)).slice(0,3);
  if(!events.length)return;
  const configured=Number(properties.liveFlowRefreshIntervalMs);
  const interval=Number.isFinite(configured)?Math.max(5000,Math.min(120000,configured)):15000;
  let active=true,working=false;
  const refresh=async()=>{
   if(!active||working||document.visibilityState!=='visible')return;
   working=true;
   try{for(const event of events){if(!active)break;await actionRef.current({event,value:{}});}}
   catch(error){if(active)setActionError(error instanceof Error?error.message:'Unable to refresh this page');}
   finally{working=false;}
  };
  const timer=window.setInterval(()=>{void refresh();},interval);
  const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',onVisible);
  return ()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
 },[properties.liveFlowRefreshEnabled,properties.liveFlowRefreshEvents,properties.liveFlowRefreshIntervalMs]);
 const records=dataCollectionRows??displayRows;
 const loading=source.loading&&source.version===0||namedSource.loading;
 // Scroll near the end of any list inside this component → load the next 50.
 const onScrollCapture=(event:React.UIEvent<HTMLElement>)=>{
  if(!compiled.dataSourceId||!source.hasMore||source.loadingMore||dataCollectionRows)return;
  const target=event.target as HTMLElement;
  if(target.scrollHeight-target.scrollTop-target.clientHeight<240)void runtime.data.loadMore(compiled.dataSourceId);
 };
 const changeBoundToggle=async(next:boolean)=>{
  if(!toggleBinding||!toggleCanWrite)throw Error('Toggle field is not editable.');
  try{
   await updateSmartToggleField(runtime.request,objectApiName,toggleBinding,next);
   setActionError('');
   saved({objectApiNames:[objectApiName]});
  }catch(error){setActionError(error instanceof Error?error.message:'Toggle update failed');throw error;}
 };
 return <div style={definition.apiName==='smart_toggle'||(definition.apiName.startsWith('smart_')&&Boolean(component.position))||(definition.apiName==='ui_image'&&Boolean(component.position))
   ?{width:'100%',height:'100%',minHeight:0,minWidth:0}
   :properties.fillRegion===true?{height:'100%',minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}:undefined}
   data-compiled-component={component.id} onScrollCapture={onScrollCapture}>
  {source.error&&<div className="records-message" role="alert">{source.error}</div>}
  {actionError&&<div className="records-message" role="alert">{actionError}</div>}
  {namedSource.error&&<div className="records-message" role="alert">{namedSource.error}</div>}
  <RegisteredComponent definition={definition} layoutTransparent props={{
   ...resolved,...componentLayoutProps(properties,formFactor),
   ...(definition.apiName.startsWith('smart_')&&component.position?{canvasFrameSized:true}:{}),
   label:runtimeComponentLabel(component,resolved.label),
   properties:resolved,objects:runtime.objects,reports:reports??[],flows:availableFlows,pageState:state,children,
   dataCollection,formulaCollectionSources:namedSource.formulaSources,namedCollections:namedSource.namedCollections,
   fieldAllowed:(key:string,row:Record<string,unknown>)=>scopedFieldAllows(properties.dataFieldFilters,key,row,fields,
    {pageState:state,recordId:runtime.recordId,sessionId}),
   pageSessionKey:runtime.pageSessionKey,componentId:component.id,device:formFactor,onNavigate,onLaunchFlow,onAction,actionError,
   disabled:behaviorAction(properties,'click',{formFactor})!=='enabled',
   loadAsset:(id:string)=>requestPageMediaAsset<{contentType:string;contentBase64:string}>(runtime.request,id,getAccessToken()??''),
   viewRevision:source.version,
   loadCompanySettings:()=>runtime.request('/metadata/currencies'),
   searchRecords:(query:string)=>compiled.dataSourceId
    ?runtime.searchRecords(compiled.dataSourceId,query)
    :Promise.reject(new Error('Search Box requires an Object data source')),
   onChange:(value:unknown)=>{
    runtime.publishState(component.id,value);
    const interactions=pageBehaviors(properties)?.interactions;
    if(actionFlows.change||(Array.isArray(interactions)&&(interactions as Array<{event?:unknown}>).some(item=>item?.event==='change')))
     void onAction({event:'change',value}).catch(()=>{});
   },
   loading,sessionId,stateChannel,
   ...(records.length===1?{record:records[0]}:{}),
   ...(objectApiName?{records:displayRows}:{}),
   ...presented,
   ...(dataCollectionRows?{records:dataCollectionRows}:{}),
   ...(objectApiName&&!dataCollectionRows?{recordPagination:{limit:SOURCE_PAGE_SIZE,offset:0,total:source.total,
    hasPrevious:false,hasNext:false,available:false,loadedRows:source.records.length,hasMore:source.hasMore,
    loadingMore:source.loadingMore,loadMore:()=>compiled.dataSourceId&&runtime.data.loadMore(compiled.dataSourceId)}}:{}),
   ...(contactChoices?{contactChoices}:{}),
   ...(toggleBinding?{toggleFieldBound:true,toggleFieldReady:toggleCanWrite,toggleFieldError:toggleBinding.error??'',
    value:toggleBinding.ready?toggleBinding.value:false,onBoundToggleChange:changeBoundToggle}:{})
  }}/>
  {source.loadingMore&&<div className="records-loading" role="status">Loading more…</div>}
 </div>;
}
export const MemoizedCompiledComponentNode=React.memo(CompiledComponentNode);

/** Builder canvas slot: in Preview the compiled node runs; while editing the
 * design canvas keeps its read-only design rendering. */
export function CompiledPreviewSlot({componentId,enabled,compiled,fallback}:{
 componentId:string;enabled:boolean;compiled:(runtime:Runtime)=>ReactNode;fallback:ReactNode;
}){
 const runtime=useCompiledPageRuntime();
 return <>{enabled&&runtime&&runtime.byId.get(componentId)?.mode==='compiled'?compiled(runtime):fallback}</>;
}
