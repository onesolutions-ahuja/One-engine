import {beginOptimisticNumberChange} from '../PageRuntime/optimisticPageNumbers';
import {runSerializedPageAction,planReadWriteObjects} from '../PageRuntime/pageActionCoordinator';
import {runSequenceFlow} from '../PageRuntime/formulaFlowSequence';
import {evaluateFieldExpressionDetailed} from '../../../component-libraries/shared/FieldExpression.js';
import {shouldInvalidatePageComponent,pageComponentReadObjectNames,applyCompleteRecordMutation,type PageMutationDetail} from '../PageRuntime/pageMutationScope';
import {isActionPlan,isScreenAction,PartialActionError} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import {previewPrintTemplate,openFormulaScreen,closeFormulaScreen} from '../PageRuntime/screenFormula';
import {useComponentFormulaState,publishComponentInput} from '../../components/RegisteredComponent/PageFormulaScope';
import {adjustNumberRecord,type AdjustNumberBinding} from '../PageRuntime/adjustNumberRecord';
import {executePageFormulaAction,parseActionFormulaAssignment,resolveActionFormulaValue} from '../PageRuntime/formulaAction';
import {resolveMetadataProperties} from '../../metadata/Definitions/metadataReferences';
import * as React from 'react';
import {useState,useEffect,useRef,useMemo} from 'react';
import {ensureTenantBrand} from '../../branding/tenantBrandLoader';
import {pageStateDependencies,applyPageSelection} from '../PageRuntime/pageStateDependencies';
import {loadFlowScreenRecordPage,getAccessToken} from '../../authentication/Client/authClient';
import {requestPageMediaAsset} from '../PageRuntime/pageMediaAssetCoalescer';
// Load the browser API client only during the mounted effect, not on SSR import.
import {presentPageRecords,type ChannelGrant} from '../../records/RecordWorkspace/recordPresentationAdapters';
import {filterPageComponentRecords,pageComponentRecordQuery,bindPageStateProperties,activePageRecordFilters,collectionRecordFilterFormula} from '../PageRuntime/pageComponentBindings';
import {scopedFieldAllows} from '../PageRuntime/fieldScopedRecordFilters';
import {resolveSmartToggleFieldBinding,updateSmartToggleField} from '../PageRuntime/smartToggleFieldBinding';
import {usePageComponentRelatedScope} from '../PageRuntime/usePageSessionRelatedQuery';
import {filterRelatedRecords} from '../PageRuntime/filterRelatedRecords.mjs';
import {resolveMentionProperties,mentionGroups,referencedMentionPaths,resolveCollectionMentionRows} from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';
import { explicitMentionRecordId, useRelationshipMentionContext } from '../../records/RecordFormDialog/useRelationshipMentionContext';
import {resolvePageActionRoute} from '../PageRuntime/pageActionRouting';
import {resolveFlowOutputBindings,resolveStructuredFlowInput} from '../../automation/FlowScreen/flowInputBindings';
import {componentLayoutProps} from '../TemplatePageRuntime/pageComponentLayout';
import {usePageCollectionFormula,namedCollectionRows} from '../PageRuntime/usePageCollectionFormula';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import {behaviorValidation,behaviorAction,pageBehaviors,type BehaviorContext} from '../PageRuntime/pageBehaviorRuntime';
import type {LibraryComponentMetadata,PageComponentMetadata,ObjectMetadata,FieldMetadata,LightningAppMetadata,LightningPageMetadata,ReportMetadata,FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';
import type {AppRoute} from '../../workspace/Navigation/appRouting';
import {flowActionFormulaTarget} from '../PageRuntime/actionFlowFormula';

export default function MetadataBoundPageComponent({
  apiRequest, definition, component, objects, apps, pages, currentAppId, pageSessionKey, pageComponents, reports, availableFlows, formFactor, onNavigate, onLaunchFlow, disableActions = false, builderPreview = false, defaultObjectApiName = '', recordId = '', behaviorContext, initialPageState, sessionIdOverride
}: {
  apiRequest:<T>(path:string,init?:RequestInit)=>Promise<T>;
  definition: LibraryComponentMetadata;
  component: PageComponentMetadata;
  objects: ObjectMetadata[];
  apps: LightningAppMetadata[];
  pages: LightningPageMetadata[];
  currentAppId: string;
  pageSessionKey: string;
  reports: ReportMetadata[];
  availableFlows: Array<Pick<FlowDefinitionMetadata, 'id' | 'apiName' | 'label' | 'flowType' | 'status'>>;
  formFactor: 'Desktop' | 'Phone';
  onNavigate: (route: AppRoute) => void;
  onLaunchFlow: (flowApiName: string, inputs?: Record<string, unknown>, context?:{requestId?:string}) => void;
  disableActions?: boolean;
  builderPreview?: boolean;
  defaultObjectApiName?: string;
  recordId?: string;
  behaviorContext?:BehaviorContext;
  initialPageState?:Record<string,unknown>;
  pageComponents?:readonly PageComponentMetadata[];
  sessionIdOverride?:string;
}) {
  // $tenant.name / $tenant.logo formulas: load the signed-in tenant's brand once.
  useEffect(()=>{void ensureTenantBrand();},[]);
  const properties = resolveMetadataProperties({...component.properties,objectApiName:component.properties.objectApiName||defaultObjectApiName},objects,availableFlows);
  const objectApiName = String(properties.objectApiName || defaultObjectApiName || '');
  const mentionRootObjectApiName = defaultObjectApiName || objectApiName;
  // An application-independent session can be referenced by configured Flows.
  const [sessionId, setSessionId] = useState(() => {
    if(sessionIdOverride)return sessionIdOverride;
    const key = 'metadrive-page-session:' + pageSessionKey;
    try {
      let value = window.sessionStorage.getItem(key);
      if (!value) {
        value = crypto.randomUUID();
        window.sessionStorage.setItem(key, value);
      }
      return value;
    } catch {
      return crypto.randomUUID();
    }
  });
  const [storedPageState,setPageState]=useState<Record<string,unknown>>(initialPageState??{});
  const pageState=useComponentFormulaState(storedPageState,properties);
  const stateDependencies=useMemo(()=>pageStateDependencies(pageComponents??[component]),[pageComponents,component]);
  const [revision, setRevision] = useState(0);
  const contextApiName=typeof properties.contextApiName==='string'?properties.contextApiName:'';
  const [currentContextRecord,setCurrentContextRecord]=useState<Record<string,unknown>|null>(null);
  useEffect(()=>{
   let active=true;
   setCurrentContextRecord(null);
   if(!contextApiName||disableActions)return()=>{active=false;};
   void apiRequest<{objectApiName:string;record:Record<string,unknown>|null}>(
    '/contexts/current/'+encodeURIComponent(contextApiName))
     .then(result=>{if(active)setCurrentContextRecord(
      result.objectApiName===objectApiName?result.record:null
     );})
     .catch(()=>{if(active)setCurrentContextRecord(null);});
   return()=>{active=false;};
  },[contextApiName,objectApiName,disableActions,revision]);

  useEffect(()=>{
    const receive=(event:Event)=>{
      const data=(event as CustomEvent<{pageSessionKey:string;key:string;value:unknown}>).detail;
      if(data?.pageSessionKey!==pageSessionKey
        ||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(data.key))return;
      setPageState(previous=>applyPageSelection(previous,{kind:'state',key:data.key,value:data.value},stateDependencies));
    };
    const select=(event:Event)=>{
      const detail=(event as CustomEvent<{pageSessionKey:string;name:string;value:Record<string,unknown>}>).detail;
      if(detail?.pageSessionKey!==pageSessionKey||
        !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(detail.name))return;
      setPageState(previous=>applyPageSelection(previous,{kind:'collection',key:detail.name,value:detail.value},stateDependencies));
    };
    window.addEventListener('metadrive:page-local-state',receive);
    window.addEventListener('metadrive:page-collection-selected',select);
    return ()=>{window.removeEventListener('metadrive:page-local-state',receive);
     window.removeEventListener('metadrive:page-collection-selected',select)};
  },[pageSessionKey,stateDependencies]);
  const fields = objects.find((item) => item.apiName === objectApiName)?.fields ?? [];
  // Related filter targets retain the exact relationship path; type information
  // comes from the destination's permission-scoped metadata, not a name guess.
  const relatedFilterFields:FieldMetadata[]=mentionGroups(objects,objectApiName,[],'','text')
    .filter(group=>!group.primary).flatMap(group=>group.fields.flatMap(item=>{
      const source=objects.find(object=>object.apiName===item.objectApiName)
        ?.fields.find(field=>field.apiName===item.fieldApiName);
      return source?[{...source,apiName:item.reference,label:group.via+' → '+item.fieldLabel}]:[];
    }));
  const filterFields=[...fields,...relatedFilterFields];
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [recordsForRequest,setRecordsForRequest]=useState('');
  const [recordTotal,setRecordTotal]=useState(0);
  const [recordOffset,setRecordOffset]=useState(0);
  const recordPageSize=100;
  const [dataError, setDataError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionPending,setActionPending]=useState(0);
  const [selectedCategories, setSelectedCategories] = useState<Record<string,string>>({});
  const [selectedFilterRecords, setSelectedFilterRecords] = useState<Record<string,{
    recordId:string;label:string;sourceObjectApiName:string
  }>>({});
  const relatedKey=String(properties.relatedFilterKey??'');
  const {relatedQuery,relatedField,parentId}=usePageComponentRelatedScope(
    properties,component.type,fields,objects,pageState,sessionId,revision,
    loadFlowScreenRecordPage,
    relatedKey?selectedFilterRecords[relatedKey]?.recordId||pageState[relatedKey]:undefined,
    disableActions);
  const selectedRecordFilters=activePageRecordFilters(properties);
 const collectionPredicate=collectionRecordFilterFormula(properties,objectApiName,fields);
 const combinedRecordFormula=collectionPredicate
  ?selectedRecordFilters.formula? 'AND('+String(selectedRecordFilters.formula)+','+collectionPredicate+')'
   :collectionPredicate:selectedRecordFilters.formula;
  const recordQuery=pageComponentRecordQuery(selectedRecordFilters.filters,filterFields,{pageState,recordId,sessionId},
    properties.filterLogic==='OR'?'OR':'AND',combinedRecordFormula);
  const recordQueryKey=JSON.stringify([recordQuery,relatedQuery]);

  useEffect(() => {
    const listener = (event: Event) => {
      const data = (event as CustomEvent<{pageSessionKey:string;filterKey:string;value:string;
        recordId?:string;label?:string;sourceObjectApiName?:string}>).detail;
      if (data?.pageSessionKey !== pageSessionKey || !data.filterKey) return;
      setSelectedCategories(previous => ({...previous,[data.filterKey]:String(data.value??'')}));
      setSelectedFilterRecords(previous => ({...previous,[data.filterKey]:{
        recordId:String(data.recordId??''),label:String(data.label??data.value??''),
        sourceObjectApiName:String(data.sourceObjectApiName??'')
      }}));
    };
    window.addEventListener('metadrive:page-filter-selected',listener);
    return () => window.removeEventListener('metadrive:page-filter-selected',listener);
  },[pageSessionKey]);
  const [dataLoading, setDataLoading] = useState(false);

  const recordRequestKey=JSON.stringify([objectApiName,recordQueryKey,recordOffset,sessionId]);
  const lastRequestKey=useRef('');
  const [channelAccess, setChannelAccess] = useState<{userId: string;viewAll: boolean;grants: ChannelGrant[];eligibleAssignees: {id: string;name: string;channelAccountId: string}[]}>({
    userId: '', viewAll: false, grants: [], eligibleAssignees: []
  });
  const initializedSessions = useRef<Set<string>>(new Set());
  const pendingFlowOutputs=useRef(new Map<string,{flowApiName:string;mappings:Record<string,unknown>}>());
  useEffect(()=>setRecordOffset(0),[objectApiName,recordQueryKey]);
  useEffect(()=>{
    const complete=(event:Event)=>{
      const detail=(event as CustomEvent<{requestId?:string;flowApiName?:string;outputs?:Record<string,unknown>}>).detail;
      if(typeof detail?.requestId!=='string'||typeof detail.flowApiName!=='string')return;
      const pending=pendingFlowOutputs.current.get(detail.requestId);
      if(!pending||pending.flowApiName!==detail.flowApiName)return;
      pendingFlowOutputs.current.delete(detail.requestId);
      try{
        const outputs=detail.outputs&&typeof detail.outputs==='object'&&!Array.isArray(detail.outputs)
          ?detail.outputs:{};
        for(const item of resolveFlowOutputBindings(outputs,pending.mappings))
          window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
            detail:{pageSessionKey,key:item.key,value:item.value}
          }));
        window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
          detail:{pageSessionKey,sessionId}
        }));
      }catch(error){
        setActionError(error instanceof Error?error.message:'Unable to apply Flow outputs');
      }
    };
    const fail=(event:Event)=>{
      const detail=(event as CustomEvent<{requestId?:string}>).detail;
      if(typeof detail?.requestId==='string')pendingFlowOutputs.current.delete(detail.requestId);
    };
    window.addEventListener('metadrive:flow-completed',complete);
    window.addEventListener('metadrive:flow-failed',fail);
    window.addEventListener('metadrive:flow-paused',fail);
    return ()=>{
      window.removeEventListener('metadrive:flow-completed',complete);
      window.removeEventListener('metadrive:flow-failed',fail);
      window.removeEventListener('metadrive:flow-paused',fail);
      pendingFlowOutputs.current.clear();
    };
  },[pageSessionKey]);
  const readObjectApiNames=pageComponentReadObjectNames(objectApiName,properties,objects);
  const readObjectKey=JSON.stringify(readObjectApiNames);
  // Only reload consumers of changed objects; session resets still affect all components.
  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<PageMutationDetail>).detail;
      if (!shouldInvalidatePageComponent(detail,pageSessionKey,sessionId,readObjectApiNames)) return;
      if (detail.sessionId && detail.sessionId !== sessionId) {
        setSessionId(detail.sessionId);
        setSelectedCategories({});
        setSelectedFilterRecords({});
      }
      // On by default: an UPDATE to a row this component already shows patches that
      // row in place (saved, authorised fields only) instead of re-querying the list.
      // Set sessionStorage 'metadrive:mutation-record-fastpath'='0' to switch off.
      let fastPath=true;
      try{fastPath=window.sessionStorage.getItem('metadrive:mutation-record-fastpath')!=='0';}
      catch{/* Disabled private session keeps the default. */}
      if(fastPath&&detail?.sessionId===sessionId&&recordOffset===0&&
        recordsForRequest===recordRequestKey&&recordTotal===records.length&&
        !properties.collectionFormula&&!properties.recordPresenterApiName&&
        !relatedQuery.filter&&!recordQuery.filter&&!recordQuery.filters?.length){
        const updated=applyCompleteRecordMutation(records,objectApiName,detail);
        if(updated){setRecords(updated);return;}
      }
      setRevision(value => value + 1);
    };
    window.addEventListener('metadrive:page-flow-mutated', sync);
    return () => window.removeEventListener('metadrive:page-flow-mutated', sync);
  }, [pageSessionKey, sessionId, objectApiName,recordOffset,recordsForRequest,
    recordRequestKey,recordTotal,records,relatedQuery,recordQuery,
    properties.collectionFormula,properties.recordPresenterApiName,readObjectKey]);
  useEffect(() => {
    let active = true;
    if(lastRequestKey.current!==recordRequestKey){
      lastRequestKey.current=recordRequestKey;
      setRecords([]);
      setRecordsForRequest('');
      setRecordTotal(0);
    }
    setDataError('');
    if (!objectApiName || recordQuery.blocked || relatedQuery.blocked) {
      setRecords([]);
      setRecordsForRequest('');
      setRecordTotal(0);
      setDataLoading(false);
      return () => { active = false; };
    }
    setDataLoading(true);
    // Existing shared Object API enforces tenant, field and record permissions.
    void loadFlowScreenRecordPage(objectApiName,{
      limit:recordPageSize,offset:recordOffset,
      filter:relatedQuery.filter??(recordQuery.serverFilterable?recordQuery.filter:undefined),
      filters:recordQuery.filters,filterLogic:recordQuery.filterLogic
    })
      .then((page) => { if (active) {setRecords(page.records);setRecordsForRequest(recordRequestKey);setRecordTotal(page.total);} })
      .catch((reason: unknown) => {
        if (active) setDataError(reason instanceof Error ? reason.message : 'Unable to load records');
      })
      .finally(() => { if (active) setDataLoading(false); });
    return () => { active = false; };
  }, [objectApiName, recordQueryKey, recordOffset, sessionId, revision]);
  useEffect(() => {
    setChannelAccess({userId:'',viewAll:false,grants:[],eligibleAssignees:[]});
    const accessPath=String(properties.channelAccessPath??'');
    if(!/^\/[A-Za-z0-9/_-]+$/.test(accessPath))return;
    let active = true;
    setChannelAccess({userId:'',viewAll:false,grants:[],eligibleAssignees:[]});
    void apiRequest<{userId:string;viewAll:boolean;grants:ChannelGrant[];eligibleAssignees:{id:string;name:string;channelAccountId:string}[]}>(accessPath)
      .then(value => {if(active) setChannelAccess(value);})
      .catch(() => {if(active) setChannelAccess({userId:'',viewAll:false,grants:[],eligibleAssignees:[]});});
    return () => {active = false;};
  }, [properties.channelAccessPath, properties.recordPresenterApiName, revision]);
  // Hydrate only referenced parent fields per row. Duplicate lookup IDs share
  // authorised requests and a concurrency limit; no cross-object first-row fallback.
  const mentionInputs:Record<string,unknown>={...properties};
  if(Array.isArray(properties.filters))properties.filters.forEach((filter,index)=>{
    if(!filter||typeof filter!=='object'||Array.isArray(filter))return;
    const entry=filter as {field?:unknown;value?:unknown};
    mentionInputs['filterField'+index]=entry.field;
    mentionInputs['filterValue'+index]=entry.value&&typeof entry.value==='object'
      ?(entry.value as {key?:unknown}).key:entry.value;
  });
  const mentionKey=JSON.stringify(Object.entries(mentionInputs)
    .filter(([,value])=>typeof value==='string'&&value.includes('@')));
  const currentRecords=recordsForRequest===recordRequestKey?records:[];
  const collectionKey=JSON.stringify([objectApiName,recordRequestKey,currentRecords.map(row=>row.Id),mentionKey]);
  const [collectionMentions,setCollectionMentions]=useState<{key:string;rows:Record<string,unknown>[]} | null>(null);
  useEffect(()=>{
    let active=true;
    setCollectionMentions(null);
    if(!objectApiName||!currentRecords.length||
      !referencedMentionPaths(mentionInputs,objects,objectApiName).length)return()=>{active=false;};
    const getRecord=async(target:string,id:string)=>{
      const result=await apiRequest<{record:Record<string,unknown>}>(
        '/records/'+encodeURIComponent(target)+'/'+encodeURIComponent(id));
      return result.record?.Id===id?result.record:undefined;
    };
    // Batched parent lookup through the same RBAC-enforced Object list API.
    const getRecords=async(target:string,ids:readonly string[])=>(await loadFlowScreenRecordPage(target,{
      limit:100,filters:[{field:'Id',operator:'in',value:[...ids]}]
    })).records;
    void resolveCollectionMentionRows(objects,objectApiName,currentRecords,mentionInputs,getRecord,getRecords)
      .then(rows=>{if(active)setCollectionMentions({key:collectionKey,rows});})
      .catch(()=>{if(active)setCollectionMentions(null);});
    return()=>{active=false;};
  },[collectionKey,currentRecords,objects,objectApiName,apiRequest]);
  const sourceRecords=collectionMentions?.key===collectionKey?collectionMentions.rows:currentRecords;
  const filteredRecords=recordQuery.filters?sourceRecords:filterPageComponentRecords(
    sourceRecords,selectedRecordFilters.filters,filterFields,{pageState,recordId,sessionId},properties.filterLogic==='OR'?'OR':'AND');
  const visibleRecords=relatedField?filterRelatedRecords(filteredRecords,parentId,relatedField):filteredRecords;
  const contextRecords=contextApiName
   ?currentContextRecord?[currentContextRecord]:[]:visibleRecords;
  const namedSource=usePageCollectionFormula(properties.collectionFormula,properties,objects,
    objectApiName,contextRecords,recordTotal,revision,pageState,sessionId,pageSessionKey,component.id);
  // A configured record presenter may enforce additional channel visibility.
  // Never replace its authorised projection with raw formula collection rows.
  const dataCollection=properties.recordPresenterApiName?null:namedSource.collection;
  const dataCollectionRows=dataCollection?namedCollectionRows(dataCollection):null;
  const mentionContext = useRelationshipMentionContext(objects, mentionRootObjectApiName,
    recordId || explicitMentionRecordId(properties), properties, apiRequest, revision);
  const resolvedProperties = bindPageStateProperties(resolveMentionProperties(properties, mentionContext.records, mentionContext.fields, objects, mentionRootObjectApiName),pageState);
  const rowResolvedProperties={...resolvedProperties,...Object.fromEntries(
    Object.entries(properties).filter(([,value])=>typeof value==='string'&&
      /@[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/.test(value)))};
  const categoryFilterKey = typeof properties.filterKey === 'string' ? properties.filterKey : 'category';
  const categorySource = selectedFilterRecords[categoryFilterKey];
  const configuredCategoryField = String(properties.categoryFieldApiName??'').trim();
  const inferredCategoryField = !configuredCategoryField && categorySource?.sourceObjectApiName
    ? fields.find(field=>field.relationship?.targetObject===categorySource.sourceObjectApiName
      || field.dataType==='Lookup('+categorySource.sourceObjectApiName+')')?.apiName
    : undefined;
  const presented = presentPageRecords(properties.recordPresenterApiName, contextRecords, channelAccess, properties);
  // A record page already fetched its exact authorised record by ID. Use it
  // even when the record is beyond the first page of the Object list.
  const boundRecordId=recordId||String(currentContextRecord?.Id??'')||explicitMentionRecordId(properties);
  const currentBoundRecord=mentionContext.records[objectApiName];
  const boundRows=boundRecordId&&currentBoundRecord?.Id===boundRecordId
    ?[currentBoundRecord]:contextRecords;
  const toggleBinding=resolveSmartToggleFieldBinding(definition.apiName,properties,objectApiName,fields,
    boundRows,recordTotal,boundRecordId);
  const toggleCanWrite=Boolean(toggleBinding?.ready&&!disableActions&&
    behaviorAction(properties,'change',behaviorContext??{formFactor})==='enabled');
  const changeBoundToggle=async(next:boolean)=>{
    if(!toggleBinding||!toggleCanWrite)throw new Error('Toggle field is not editable.');
    try{
      await updateSmartToggleField(apiRequest,objectApiName,toggleBinding,next);
      setActionError('');
      window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
        detail:{pageSessionKey,sessionId,objectApiNames:[objectApiName]}
      }));
    }catch(error){setActionError(error instanceof Error?error.message:'Toggle update failed');throw error;}
  };
  const rawActions = properties.actionFlows;
  const actionFlows = rawActions && typeof rawActions === 'object' && !Array.isArray(rawActions)
    ? rawActions as Record<string, unknown> : {};
  const resolveInput = (source: unknown, eventPayload: Record<string, unknown>): unknown => {
    if(source&&typeof source==='object'&&!Array.isArray(source))
      return resolveStructuredFlowInput(source as Record<string,unknown>,
       candidate=>resolveInput(candidate,eventPayload));
    if (source === '$session'||source==='$session.id') return sessionId;
    if (typeof source==='string'&&source.startsWith('$session.')) {
      const resolved=evaluateFieldExpressionDetailed(source,{}, {sessionId,pageState});
      if(resolved.error)throw Error(resolved.error);
      return resolved.value;
    }
    if (typeof source === 'string' && source.startsWith('$state.')) {
      const key=source.slice(7);
      return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ? pageState[key] : undefined;
    }
    if (source === '$event') return eventPayload;
    if (typeof source === 'string' && source.startsWith('$event.')) {
      return source.slice(7).split('.').reduce<unknown>((current, key) =>
        current && typeof current === 'object' && !['__proto__','prototype','constructor'].includes(key)
          ? (current as Record<string, unknown>)[key] : undefined, eventPayload);
    }
    if (typeof source === 'string' && source.startsWith('$record.')) {
      const fieldName = source.slice(8);
      return /^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName) ? mentionContext.records[mentionRootObjectApiName]?.[fieldName] : undefined;
    }
    return source;
  };
  const executeAction = async (action: { event: string; value?: unknown }) => {
    if(disableActions)throw new Error('Page Builder preview is read-only.');
    if(behaviorAction(properties,action.event,behaviorContext??{formFactor})!=='enabled')
      throw new Error('This action is unavailable under the published Page rules.');
    const validationError=behaviorValidation(properties,action.event,behaviorContext??{formFactor});
    if(validationError)throw new Error(validationError);
    window.dispatchEvent(new CustomEvent('metadrive:in-screen-action',{
      detail:{pageSessionKey,componentId:component.id,event:action.event,value:action.value}
    }));
    const interactions=pageBehaviors(properties)?.interactions;
    const hasInteraction=Array.isArray(interactions)&&interactions.some(item=>item?.event===action.event);
    if(hasInteraction)window.dispatchEvent(new CustomEvent('metadrive:page-component-interaction',{
      detail:{pageSessionKey,componentId:component.id,event:action.event,value:action.value}
    }));
    // Every authorised selection can update a named Collection without a Flow.
    const selectionPayload=action.value&&typeof action.value==='object'&&!Array.isArray(action.value)
      ?action.value as Record<string,unknown>:null;
    const selectedCollection=selectionPayload?.collectionName;
    if(action.event==='change'&&typeof selectedCollection==='string'
      &&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(selectedCollection)){
      const record=selectionPayload?.record&&typeof selectionPayload.record==='object'&&!Array.isArray(selectionPayload.record)
        ?selectionPayload.record as Record<string,unknown>:{};
      window.dispatchEvent(new CustomEvent('metadrive:page-collection-selected',{detail:{
        pageSessionKey,name:selectedCollection,
        value:{Id:String(record.Id??selectionPayload?.value??''),Name:String(record.Name??''),
          Value:selectionPayload?.value??null,
          Field:typeof record.Field==='string'?record.Field:'',
          Criteria:typeof record.Criteria==='string'?record.Criteria:''}
      }}));
    }
    const config = actionFlows[action.event];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      if(hasInteraction||selectedCollection)return {updated:true};
      throw new Error('No metadata event action is configured for "' + action.event + '".');
    }
    // $flow formula: IF(..., $flow.A, $flow.B) picks the Flow, then the normal Flow
    // path runs it (same inputs/outputs, server RBAC). Blank result = do nothing.
    const authoredBinding = config as Record<string, unknown>;
    if(authoredBinding.actionType==='Formula'&&isScreenAction(String(authoredBinding.formula))){
      const payload=action.value as {recordId?:unknown}|null;
      return openFormulaScreen(String(authoredBinding.formula),{
        objects,apps,pages,currentAppId,defaultObjectApiName:objectApiName
      },onNavigate,pageSessionKey,sessionId,String(payload?.recordId??pageState.recordId??recordId??''),
      formula=>{
        const result=evaluateFieldExpressionDetailed('='+formula,
          payload&&typeof payload==='object'?payload as Record<string,unknown>:{},{sessionId,pageState});
        if(result.error)throw Error('SCREEN record Id: '+result.error);
        return result.value;
      });
    }
    const formulaFlow = isActionPlan(String(authoredBinding.formula))?undefined:flowActionFormulaTarget(authoredBinding, action.value, pageState, sessionId, availableFlows);
    if (formulaFlow === '') return { skipped: true };
    const binding: Record<string, unknown> = formulaFlow
      ? { ...authoredBinding, actionType: 'Flow', flowApiName: formulaFlow } : authoredBinding;
    if (binding.actionType === 'SetFilter') {
      const filterKey = String(binding.filterKey || 'category');
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(filterKey)) throw new Error('Invalid filter key');
      const value = typeof action.value === 'object' && action.value !== null
        ? String(('value' in action.value ? (action.value as {value:unknown}).value : 'label' in action.value
          ? (action.value as {label:unknown}).label : '') ?? '')
        : String(action.value ?? '');
      const source = action.value && typeof action.value === 'object' ? action.value as Record<string,unknown> : {};
      window.dispatchEvent(new CustomEvent('metadrive:page-filter-selected', {detail:{
        pageSessionKey,filterKey,value,label:String(source.label??value),
        recordId:String(source.recordId??''),sourceObjectApiName:String(source.sourceObjectApiName??'')
      }}));
      return {selected:value};
    }
    if (disableActions) throw new Error('Builder preview permits local filters only. Publish the page to run Flows or navigation.');
    if (binding.actionType==='PageState'){
      const key=String(binding.stateKey??'');
      if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))throw new Error('Page state action requires a valid key');
      const payload=action.value&&typeof action.value==='object'&&!Array.isArray(action.value)
        ?action.value as Record<string,unknown>:{value:action.value};
      const value=resolveInput(binding.value??'$event',payload);
      window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{detail:{pageSessionKey,key,value}}));
      return {updated:true};
    }
    if(binding.actionType==='Formula'){
      const payload=action.value&&typeof action.value==='object'&&!Array.isArray(action.value)
        ?action.value as Record<string,unknown>:{value:action.value};
      const assignment=parseActionFormulaAssignment(String(binding.formula??''));
      if(assignment?.kind==='filter'){
        const value=String(resolveActionFormulaValue(assignment.value,payload,pageState,sessionId)??'');
        window.dispatchEvent(new CustomEvent('metadrive:page-filter-selected',{detail:{
          pageSessionKey,filterKey:assignment.key,value,label:value,
          recordId:String(payload.recordId??''),
          sourceObjectApiName:String(payload.sourceObjectApiName??'')
        }}));
        return {selected:value};
      }
      if(assignment?.kind==='navigate'){
        const result=resolveActionFormulaValue(assignment.value,payload,pageState,sessionId);
        if(typeof result!=='string'||!/^[A-Za-z][A-Za-z0-9_]*(?:\/[A-Za-z][A-Za-z0-9_]*)?$/.test(result))
          throw Error('Formula navigation requires a declared destination.');
        const [first,second]=result.split('/');
        const nextBinding=assignment.key==='page'
          ?{actionType:'Navigate',navigationTargetType:'App Page',
            navigationAppId:first,navigationPageApiName:second??''}
          :assignment.key==='home'
          ?{actionType:'Navigate',navigationTargetType:'App Home',navigationAppId:first}
          :{actionType:'Navigate',navigationTargetType:'Record List',
            navigationAppId:'Records',navigationObjectApiName:first};
        onNavigate(resolvePageActionRoute(nextBinding,{
          objects,apps,pages,currentAppId,defaultObjectApiName:objectApiName
        }));
        return {navigated:true};
      }
      const result=await executePageFormulaAction(apiRequest,binding,payload,
        pageState,objects,objectApiName,sessionId,(template,id)=>previewPrintTemplate(template,id,pageSessionKey,sessionId,currentAppId),
        async(name,target,mode,screenRecordId)=>{
          if(name==='CLOSESCREEN')return closeFormulaScreen(pageSessionKey);
          if(name==='SCREEN')return openFormulaScreen('SCREEN('+target+(mode?','+mode:'')+')',{
            objects,apps,pages,currentAppId,defaultObjectApiName:objectApiName
          },onNavigate,pageSessionKey,sessionId,
          screenRecordId??String(payload.recordId??pageState.recordId??recordId??''));
          return runSequenceFlow(target,availableFlows,apiRequest,onLaunchFlow);
        },undefined,{namedCollections:namedSource.namedCollections,collectionSources:namedSource.formulaSources as never,
          timingName:'formula.'+component.id+'.'+action.event});
      for(const change of result.changes)
        window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
          detail:{pageSessionKey,key:change.key,value:change.value}
        }));
      if(result.recordChanged){
        window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
          detail:{pageSessionKey,sessionId,objectApiNames:result.mutatedObjectApiNames,
            recordChanges:result.recordChanges}
        }));
      }
      return {updated:true,recordChanged:result.recordChanged};
    }
    if (binding.actionType === 'AdjustNumber') {
      const payload=action.value&&typeof action.value==='object'&&!Array.isArray(action.value)
        ?action.value as Record<string,unknown>:{value:action.value};
      const optimistic=binding.optimisticUiEnabled===true
        ?(changes:ReadonlyArray<{key:string;value:unknown}>)=>beginOptimisticNumberChange(
           pageSessionKey,sessionId,String(binding.stateCollectionKey??''),pageState,changes,
           (key,value)=>window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
            detail:{pageSessionKey,key,value}})))
        :undefined;
      const changes=await adjustNumberRecord(apiRequest,binding as unknown as AdjustNumberBinding,
        payload,pageState,objects,objectApiName,optimistic);
      for(const change of changes)
        window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
          detail:{pageSessionKey,key:change.key,value:change.value}
        }));
      window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
        detail:{pageSessionKey,sessionId,objectApiNames:[objectApiName]}
      }));
      return {updated:true};
    }
    if (binding.actionType === 'Navigate') {
      const target = resolvePageActionRoute(binding, {
        objects, apps, pages, currentAppId, defaultObjectApiName: objectApiName
      });
      // Server endpoints enforce the final object and page authorization checks.
      onNavigate(target);
      return { navigated: true };
    }
    const flowApiName = String(binding.flowApiName ?? '');
    const selected = availableFlows.find((flow) => flow.apiName === flowApiName && flow.status === 'Active');
    if (!selected || selected.status !== 'Active') {
      throw new Error('Choose an active Flow for the "' + action.event + '" action in Page Builder.');
    }
    const payload = action.value && typeof action.value === 'object' && !Array.isArray(action.value)
      ? action.value as Record<string, unknown> : { value: action.value };
    const inputs = Object.fromEntries(Object.entries(
      binding.inputs && typeof binding.inputs === 'object' && !Array.isArray(binding.inputs)
        ? binding.inputs as Record<string, unknown> : {}
    ).map(([key, source]) => [key, resolveInput(source, payload)]));
    if(binding.outputs!==undefined&&(!binding.outputs||typeof binding.outputs!=='object'||Array.isArray(binding.outputs)))
      throw new Error('Flow output mappings must be an object.');
    const outputMappings:Record<string,unknown>={};
    if(binding.outputs!==undefined)Object.assign(outputMappings,binding.outputs);
    resolveFlowOutputBindings({},outputMappings);
    setActionError('');
    if (['Screen Flow','In-Screen Flow'].includes(selected.flowType)) {
      const requestId=crypto.randomUUID();
      if(pendingFlowOutputs.current.size>=10)throw new Error('Too many pending Flow output mappings.');
      pendingFlowOutputs.current.set(requestId,{flowApiName,mappings:outputMappings});
      onLaunchFlow(flowApiName, inputs,{requestId});
      return { interviewStarted: true };
    }
    if (selected.flowType !== 'Autolaunched Flow') {
      throw new Error('Component event Flow must be Screen or Autolaunched.');
    }
    try {
      const response = await apiRequest<{ outputs?: Record<string, unknown>; interviewId?: string }>(
        '/flows/' + encodeURIComponent(flowApiName) + '/execute', {
          method: 'POST', body: JSON.stringify(inputs)
        });
      if (response.interviewId) throw new Error('This action was paused by a Flow Wait element.');
      const flowOutputs=response.outputs&&typeof response.outputs==='object'&&!Array.isArray(response.outputs)
        ?response.outputs:{};
      for(const item of resolveFlowOutputBindings(flowOutputs,outputMappings))
        window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
          detail:{pageSessionKey,key:item.key,value:item.value}
        }));
      let completedSessionId = sessionId;
      if (binding.resetSessionOnSuccess === true) {
        const key = 'metadrive-page-session:' + pageSessionKey;
        const newSession = crypto.randomUUID();
        try { window.sessionStorage.setItem(key, newSession); } catch { /* private session */ }
        completedSessionId = newSession;
        setSessionId(newSession);
      }
      window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated', {
        detail: {pageSessionKey,sessionId: completedSessionId}
      }));
      return {
        ...response,
        completed: typeof binding.successOutput === 'string'
          && response.outputs?.[binding.successOutput] === binding.successValue
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Flow action failed';
      setActionError(message);
      throw error;
    }
  };
  const onAction = async (action: {event:string;value?:unknown}) => {
    // Opt-in action trace includes queue wait, execution time and outcome, but
    // never an authored formula, record values, request URLs or user inputs.
    let trace=false;
    try{trace=window.sessionStorage.getItem('metadrive:action-timings')==='1';}
    catch{/* Session storage may be unavailable. */}
    const started=trace?performance.now():0;
    let executingAt=started;
    let outcome:'completed'|'no-record-write'|'failed'='completed';
    let recordWrite:boolean|undefined;
    const traceId=trace?crypto.randomUUID():'';
    setActionPending(count=>count+1);
    try {
      const configured=actionFlows[action.event];
      const dependencyObjects=configured&&typeof configured==='object'&&!Array.isArray(configured)
       ?planReadWriteObjects(configured as Record<string,unknown>,objectApiName,objects):[];
      const execute=()=>{if(trace)executingAt=performance.now();return executeAction(action);};
      const result=dependencyObjects.length
       ?await runSerializedPageAction(pageSessionKey+'|'+sessionId,dependencyObjects,execute)
       :await execute();
      recordWrite=(result as {recordChanged?:boolean}|undefined)?.recordChanged;
      const planned=configured&&typeof configured==='object'&&!Array.isArray(configured)
        ?configured as {actionType?:unknown;formula?:unknown}:null;
      if(recordWrite===false&&planned?.actionType==='Formula'
        &&typeof planned.formula==='string'&&isActionPlan(planned.formula))outcome='no-record-write';
      setActionError('');
      return result;
    } catch(error) {
      outcome='failed';
      if(error instanceof PartialActionError)recordWrite=error.mutatedObjectApiNames.length>0;
      // A prior Record API write may have succeeded before this step failed.
      // Refresh only the confirmed objects. Do not replay the authored action.
      if(error instanceof PartialActionError&&error.mutatedObjectApiNames.length)
       window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
        detail:{pageSessionKey,sessionId,objectApiNames:error.mutatedObjectApiNames}
       }));
      setActionError(error instanceof Error?error.message:'Action failed');
      throw error;
    } finally {
      if(trace){
        const ended=performance.now();
        console.info('[PageActionTiming]',{
          id:traceId,componentId:component.id,event:action.event,outcome,
          recordWrite:recordWrite??null,
          queueWaitMs:Math.max(0,executingAt-started),
          executionMs:Math.max(0,ended-executingAt),
          totalMs:Math.max(0,ended-started)
        });
      }
      setActionPending(count=>Math.max(0,count-1));
    }
  };
  useEffect(() => {
    if (disableActions || !actionFlows.start || initializedSessions.current.has(sessionId)) return;
    initializedSessions.current.add(sessionId);
    void onAction({ event: 'start', value: {} }).catch(() => {
      initializedSessions.current.delete(sessionId);
    });
  }, [sessionId, disableActions]);
  // When the component is placed on a free canvas, its frame owns geometry.
  // The record-binding layer must not introduce another auto-sized visual box.
  const smartCanvas=definition.apiName.startsWith('smart_')&&Boolean(component.position);
  // Data-bound Images need the same full-height wrapper as the unbound image
  // so the selected canvas dimensions also resize the picture itself.
  const imageCanvas=definition.apiName==='ui_image'&&Boolean(component.position);
  // A free-canvas Card Grid has an authored, bounded frame. Fill that frame
  // so the card list, not the page canvas, owns vertical scrolling.
  const boundedCardGrid=definition.apiName==='ui_item_grid'&&Boolean(component.position);
  const compactCanvasNotice=smartCanvas||imageCanvas||boundedCardGrid;
  // Action-only and page-state Smart components do not need an Object source.
  // A general warning before a 24px component previously consumed its entire
  // viewport (the shared records-message has 22px padding), hiding native text
  // and borders even though the authored properties were preserved.
  const needsObjectSource=Object.entries(properties).some(([key,value])=>
    /(?:name|title|price|image|category|vatApplicable|ageRestricted)FieldApiName$/i.test(key)
    &&typeof value==='string'&&value.trim().length>0);
  const notices=[
    !objectApiName&&!properties.collectionFormula&&needsObjectSource
      ?'Select a bound object to load records for this component.':null,
    dataError&&!contextApiName?dataError:null,
    namedSource.error||null,
  ].filter((message):message is string=>typeof message==='string'&&message.length>0);
  return <div className={boundedCardGrid?'md-card-grid-bound':undefined}
    style={smartCanvas||imageCanvas||definition.apiName==='smart_toggle'||boundedCardGrid
    ?{width:'100%',height:'100%',minHeight:0,minWidth:0,position:'relative'}:undefined}>
    {compactCanvasNotice&&notices.length>0
      ?<span role="alert" aria-label={notices.join('; ')} title={notices.join('\n')}
        style={{position:'absolute',right:2,top:2,zIndex:5,display:'grid',placeItems:'center',
          width:16,height:16,borderRadius:4,background:'#fff4db',color:'#9a3412',
          border:'1px solid #f59e0b',fontSize:12,fontWeight:700,pointerEvents:'auto'}}>!</span>
      :notices.map((message,index)=><div key={index} className="records-message" role="alert">{message}</div>)}
    <RegisteredComponent formulaInstanceId={component.id} definition={definition} layoutTransparent={smartCanvas} editorPreview={builderPreview===true&&disableActions} props={{
      ...rowResolvedProperties, ...componentLayoutProps(properties, formFactor),
      ...(smartCanvas?{canvasFrameSized:true}:{}),
      ...(boundedCardGrid?{boundedViewport:true}:{}),
      ...(categoryFilterKey ? {
        selectedCategory:selectedCategories[categoryFilterKey] ?? String(properties.selectedCategory ?? ''),
        selectedCategoryLabel:categorySource?.label ?? '',selectedCategoryRecordId:categorySource?.recordId ?? '',
        categoryFieldApiName:configuredCategoryField||inferredCategoryField||''
      } : {}),
      ...(typeof properties.searchKey === 'string' && properties.searchKey ? {searchQuery:selectedCategories[properties.searchKey] ?? ''} : {}),
      label: Object.prototype.hasOwnProperty.call(rowResolvedProperties,'label')
         ?rowResolvedProperties.label:component.label, properties: rowResolvedProperties, pageState, objects, reports, flows: availableFlows,
      dataCollection,
      formulaCollectionSources:namedSource.formulaSources,namedCollections:namedSource.namedCollections,
      fieldAllowed:(key:string,row:Record<string,unknown>)=>scopedFieldAllows(
        properties.dataFieldFilters,key,row,filterFields,{pageState,recordId,sessionId}),
       pageSessionKey, componentId: component.id,
      device: formFactor, onNavigate, onLaunchFlow, onAction, actionError,
      disabled:behaviorAction(properties,'click',behaviorContext??{formFactor})!=='enabled',
      loadAsset: (id:string) => requestPageMediaAsset<{contentType:string;contentBase64:string}>(apiRequest,id,getAccessToken()??''),
      loadCompanySettings: () => apiRequest('/metadata/currencies'),
      onChange: (value: unknown, dispatch?:{actionHandled?:boolean}) => {
        publishComponentInput(component.id,value);
        if (!dispatch?.actionHandled && (actionFlows.change || (Array.isArray(pageBehaviors(properties)?.interactions)
          &&(pageBehaviors(properties)!.interactions as Array<{event?:unknown}>).some(item=>item?.event==='change'))))
          void onAction({ event: 'change', value }).catch(() => {/* Error displayed by action boundary. */});
      },
      loading: actionPending>0 || (dataLoading && recordsForRequest !== recordRequestKey), sessionId, previewOnly: disableActions, builderPreview: builderPreview===true&&disableActions,
      // Only bind scalar expressions when one authorised record is in scope.
      // Multi-row components resolve their per-row values inside their own renderer.
      ...(contextRecords.length===1 ? {record:contextRecords[0]} : {}),
      ...(objectApiName ? { records: contextRecords } : {}),
      ...presented,
      // A typed collection is the Data Source; presenter defaults must not
      // overwrite its permission-checked, formula-filtered rows.
      ...(dataCollectionRows?{records:dataCollectionRows}:{}),
      ...(!dataCollectionRows&&objectApiName ? {recordPagination:{
        limit:recordPageSize,offset:recordOffset,total:recordTotal,
        hasPrevious:recordOffset>0,hasNext:recordOffset+recordPageSize<recordTotal,
        available:recordQuery.serverFilterable
      }} : {}),
      ...(toggleBinding?{toggleFieldBound:true,toggleFieldReady:toggleCanWrite,
        toggleFieldError:toggleBinding.error??'',
        value:toggleBinding.ready?toggleBinding.value:false,
        onBoundToggleChange:changeBoundToggle}:{})
    }} />
    {objectApiName&&!contextApiName&&recordQuery.serverFilterable&&recordTotal>recordPageSize&&<nav
      className="records-pagination" aria-label={component.label+' record pages'}>
      <button type="button" className="btn" disabled={dataLoading||recordOffset===0}
        onClick={()=>setRecordOffset(offset=>Math.max(0,offset-recordPageSize))}>Previous</button>
      <span>{recordOffset+1}–{Math.min(recordOffset+recordPageSize,recordTotal)} of {recordTotal}</span>
      <button type="button" className="btn" disabled={dataLoading||recordOffset+recordPageSize>=recordTotal}
        onClick={()=>setRecordOffset(offset=>offset+recordPageSize)}>Next</button>
    </nav>}
    {objectApiName&&!contextApiName&&!recordQuery.serverFilterable&&recordTotal>recordPageSize&&<p role="status">
      Results are incomplete: this filter was applied only to the first 100 fetched records. Additional matches may exist; pagination is unavailable for this filter combination.
    </p>}
  </div>;
}
