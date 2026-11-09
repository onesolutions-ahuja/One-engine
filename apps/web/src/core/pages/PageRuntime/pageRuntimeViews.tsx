import {adjustNumberRecord,type AdjustNumberBinding} from '../PageRuntime/adjustNumberRecord';
import {executePageFormulaAction,parseActionFormulaAssignment,resolveActionFormulaValue} from '../PageRuntime/formulaAction';
import {nextAccessibleTabIndex} from '../PageRuntime/tabKeyboardNavigation';
import {usePageCollectionFormula,namedCollectionRows} from '../PageRuntime/usePageCollectionFormula';
import {pageStateDependencies,applyPageSelection,implicitPageStateKeys,changedPageStateNames,
  pageStateChangeIsRelevant} from './pageStateDependencies';
import { useFormFactor } from '../../workspace/Responsive/useFormFactor';
import {resolveMetadataProperties} from '../../metadata/Definitions/metadataReferences';
import {useFlowStateChannel} from '../../automation/FlowScreen/useFlowStateChannel';
import { presentPageRecords, type ChannelGrant } from '../../records/RecordWorkspace/recordPresentationAdapters';
import TemplatePageRuntimeLayout from '../TemplatePageRuntime/TemplatePageRuntimeLayout';
import { loadFlowScreenRecordPage, loadFlowScreenRecords, getAccessToken } from '../../authentication/Client/authClient';
import {shouldInvalidatePageComponent,pageComponentReadObjectNames,applySavedRecordMutations,
  type PageMutationDetail,type LoadedRecordListScope} from './pageMutationScope';
import {requestPageMediaAsset} from './pageMediaAssetCoalescer';
import { pageLayoutForRecord, compactLayoutForRecord, matchesLookupFilterGroup, relatedLookupFilterOperators, type RecordData } from '../../records/RecordWorkspace/recordMetadataUtils';
import { formatRecordValue, parseCsvImport } from '../../records/RecordWorkspace/recordCsvUtils';
import { initialScreenValues, screenFieldIsVisible } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import {resolveFlowOutputBindings,resolveStructuredFlowInput} from '../../automation/FlowScreen/flowInputBindings';
import { objectSettings, parseAppRoute, appRoutePath, type AppRoute } from '../../workspace/Navigation/appRouting';
import { NavigationLoadTime, resolveCurrentAppNavigation } from '../../workspace/Navigation/appNavigationView';
import { isStandalonePagePresentation, pageCanvasPresentationStyle } from './pageRuntimePresentation';
import { insertFlowElementAtPath } from '../../builders/FlowBuilder/flowInsertElement.mjs';
import {resolveSetupNavigation} from '../../platform/Workspace/platformSetupNavigation';
import {readVerifiedMetadata,saveVerifiedMetadata,type MetadataPublicationResponse} from '../../metadata/Cache/verifiedMetadataCache';
import { queueOfflineRecord, listOfflineRecords, markOfflineRecord, removeOfflineRecord,
  synchronizeOfflineRecords, type OfflineQueueOwner, type OfflineRecordItem, type OfflineRecordWrite } from '../../metadata/Cache/offlineRecordQueue';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  ClipboardPaste,
  Command,
  Copy,
  Database,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  FileText,
  Filter,
  GripVertical,
  Grid2X2,
  ListFilter,
  Maximize2,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Puzzle,
  Smartphone,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Scissors,
  Settings2,
  SlidersHorizontal,
  Star,
  Undo2,
  Redo2,
  Trash2,
  Tablet,
  UsersRound,
  X,
  Workflow,
  Wifi,
  WifiOff,
  PanelLeft,
  PanelRight
} from 'lucide-react';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import { findRegisteredComponent } from '../../components/Registry/componentRegistryLookup';
import PageRouteDirectory from '../PageRouteDirectory/PageRouteDirectory';
import { isComponentVisible } from '../../components/Properties/componentVisibility';
import {behaviorValidation,behaviorAction,behaviorAppearance,behaviorInteractions,behaviorTabs,behaviorTabForChild,pageBehaviors} from './pageBehaviorRuntime';
import { canNestComponent, componentVisualStyle, directChildren, isLayoutType, isDescendantOf, layoutTypes } from '../TemplatePageRuntime/pageComponentLayout';
import { isCanvasLocked, wrapCanvasComponent, ungroupCanvasComponent } from '../../builders/PageBuilder/canvasInteractions';
import { filterPageComponentRecords, pageComponentRecordQuery, bindPageStateProperties, needsMetadataComponentRuntime, resolvePageStatePath, activePageRecordFilters,collectionRecordFilterFormula} from './pageComponentBindings';
import {scopedFieldAllows} from './fieldScopedRecordFilters';
import {resolveSmartToggleFieldBinding,updateSmartToggleField} from './smartToggleFieldBinding';
import {usePageComponentRelatedScope} from '../PageRuntime/usePageSessionRelatedQuery';
import {filterRelatedRecords} from './filterRelatedRecords.mjs';
import {resolveMentionProperties} from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';
import { explicitMentionRecordId, useRelationshipMentionContext } from '../../records/RecordFormDialog/useRelationshipMentionContext';
import { childrenOf, canNest, componentLayoutProps, hasPageComponentAppearance, pageAppearanceTarget, pageAppearanceStyleKeys, isLayoutContainer, rawLayoutParentId, reparentComponent, resolvePageComponentStyle, type LayoutDevice } from '../TemplatePageRuntime/pageComponentLayout';
import {GlobalRecordSearch} from '../../../component-libraries/shared/primitives/GlobalRecordSearch/GlobalRecordSearch';
import '../TemplatePageRuntime/pageComponentAppearance.css';
import {RecordObjectPicker} from '../../../component-libraries/shared/primitives/RecordObjectPicker/RecordObjectPicker';
import {useDismissOnOutside} from '../../accessibility/Dismiss/useDismissOnOutside';
import { pageIsAvailableInApp } from './pageActionRouting';
import {executeOpenPageActionNode} from './OpenPageActionNode';
import ApprovalProcessManager from '../../automation/ApprovalProcessManager/ApprovalProcessManager';
import { standardPageComponents } from '../../components/Catalog/index';
import EmbeddedDashboard from '../EmbeddedDashboard/EmbeddedDashboard';
import {StandardRecordList,StandardRichText,StandardFlowLauncher} from './StandardPageBlocks';
import {useViewportWidth} from '../../workspace/Responsive/useViewportWidth';
import ResponsivePageCanvas from './ResponsivePageCanvas';
const EmbeddedScreenFlow=React.lazy(()=>import('./EmbeddedScreenFlow'));
const InScreenFlowHost=React.lazy(()=>import('../../automation/InScreenFlowHost'));
const StandardApprovals=React.lazy(()=>import('./StandardApprovals'));
import { inspectPageDependencies } from './pageDependencies';
import {
  canvasDimensionsForOrientation,
  canvasBoundPosition,
  canvasOrientation,
  canvasScaleToFitWidth,
  canvasUnitsFromScreenDelta
} from './pageCanvas';
import {
  createComponentPreviewProps,
  getPageBuilderComponentCategories,
  pageBuilderPaletteCategories
} from '../../builders/PageBuilder/pageBuilderPalette';
import {
  defaultFlow,
  defaultLightningPage,
  defaultAccessControl,
  objectMetadata,
  setupShortcuts,
  workspaces,
  type ObjectMetadata,
  type FieldMetadata,
  type FieldSetMetadata,
  type PageLayoutMetadata,
  type PageLayoutCustomLinkMetadata,
  type CompactLayoutMetadata,
  type RecordTypeMetadata,
  type RelatedLookupFilterMetadata,
  type ObjectActionMetadata,
  type ObjectSettingsMetadata,
  type ProfileMetadata,
  type PageActivationAssignmentMetadata,
  type FlowDefinitionMetadata,
  type FlowExecutionLogMetadata,
  type FlowInterviewMetadata,
  type FlowElementMetadata,
  type FlowResourceMetadata,
  type FlowValidationMetadata,
  type PlatformEventMetadata,
  type LightningPageTemplate,
  type NamedCredentialMetadata,
  type EmailAlertMetadata,
  type CustomNotificationMetadata,
  type ApprovalRequestMetadata,
  type ApprovalProcessMetadata,
  type ApprovalProcessInput,
  type ConnectorProviderMetadata,
  type IntegrationConnectionMetadata,
  type LightningPageMetadata,
  type PageComponentMetadata,
  type LibraryComponentMetadata,
  type DashboardFilterMetadata,
  type DashboardMetadata,
  type DashboardFolderMetadata,
  type DashboardFolderInput,
  type DashboardTerritoryMetadata,
  type DashboardSubscription,
  type DashboardSubscriptionInput,
  type DashboardSnapshot,
  type ReportMetadata,
  type ReportBucketMetadata,
  type ReportFolderMetadata,
  type ReportFolderInput,
  type ReportRunMetadata,
  type ReportStandardFiltersMetadata,
  type ReportFilterMetadata,
  type ReportDateRange,
  type ReportDateGrouping,
  type ReportSummaryOperation,
  type ReportCrossFilterMetadata,
  type AccessControlMetadata,
  type CurrencySettingsMetadata,
  type LightningAppMetadata,
  type PermissionSetMetadata,
  type PermissionSetGroupMetadata,
  type PublicGroupMetadata,
  type QueueMetadata,
  type SharingRuleMetadata,
  type UserMetadata,
  type WorkspaceId
} from '../../metadata/Definitions/metadata';


export function createPageRuntimeViews(apiRequest: <T>(path:string, init?:RequestInit) => Promise<T>) {
function RuntimeReportChart({ report, objects, recordContext }: {
  report: ReportMetadata | undefined; objects: ObjectMetadata[];
  recordContext?: {objectApiName:string;recordId:string;relationshipFieldApiName?:string};
}) {
  const [run, setRun] = useState<ReportRunMetadata | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!report) {
      setRun(null);
      setError('');
      return;
    }
    let active = true;
    setRun(null);
    setError('');
    void apiRequest<ReportRunMetadata>(`/reports/${encodeURIComponent(report.apiName)}/run`, {
      method: 'POST',
      body: JSON.stringify({ offset: 0, limit: 100, ...(recordContext ? {recordContext} : {}) })
    }).then((result) => {
      if (active) setRun(result);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Unable to run the selected report');
    });
    return () => { active = false; };
  }, [report?.apiName,recordContext?.objectApiName,recordContext?.recordId,recordContext?.relationshipFieldApiName]);
  if (!report) return <div className="records-empty">Choose a saved report in the page component properties.</div>;
  if (error) return <div className="records-message" role="alert">{error}</div>;
  if (!run) return <div className="records-loading">Running {report.label}…</div>;
  const object = objects.find((item) => item.apiName === report.objectApiName);
  const groupedApiName = report.groupByFieldApiNames[0]
    ?? report.fieldApiNames.find((name) => !/^(Number|Currency|Percent)(\(|$)/.test(object?.fields.find((field) => field.apiName === name)?.dataType ?? ''));
  const measureApiName = report.fieldApiNames.find((name) =>
    /^(Number|Currency|Percent)(\(|$)/.test(object?.fields.find((field) => field.apiName === name)?.dataType ?? ''));
  const grouped = new Map<string, number>();
  for (const row of run.rows) {
    const label = groupedApiName ? String(row[groupedApiName] ?? 'No value') : `Row ${grouped.size + 1}`;
    const value = measureApiName ? Number(row[measureApiName]) : 1;
    grouped.set(label, (grouped.get(label) ?? 0) + (Number.isFinite(value) ? value : 0));
  }
  const bars = [...grouped.entries()].slice(0, 12);
  const maximum = Math.max(1, ...bars.map(([, value]) => Math.abs(value)));
  return <div className="runtime-report-chart">
    <div className="runtime-report-chart-heading"><strong>{report.label}</strong><span>{run.totalRows} report row{run.totalRows === 1 ? '' : 's'}</span></div>
    {bars.length === 0 ? <div className="records-empty">The selected report returned no rows.</div>
      : <div className="runtime-report-chart-bars" role="img" aria-label={`${report.label} report chart`}>
        {bars.map(([label, value]) => <div className="runtime-report-chart-bar" key={label} title={`${label}: ${value}`}>
          <span className="runtime-report-chart-value">{new Intl.NumberFormat().format(value)}</span>
          <span className="runtime-report-chart-track"><i style={{ height: `${Math.max(3, Math.abs(value) / maximum * 100)}%` }} /></span>
          <span className="runtime-report-chart-label">{label}</span>
        </div>)}
      </div>}
    {run.truncated && <small className="runtime-report-chart-note">Chart uses the first {run.pageSize} report rows.</small>}
  </div>;
}

function MetadataBoundPageComponent({
  definition, component, objects, apps, pages, currentAppId, pageSessionKey, pageComponents, reports, availableFlows, formFactor, onNavigate, onLaunchFlow, disableActions = false, defaultObjectApiName = '', recordId = '', initialPageState, sessionIdOverride, children
}: {
  definition: LibraryComponentMetadata;
  component: PageComponentMetadata;
  objects: ObjectMetadata[];
  apps: LightningAppMetadata[];
  pages: LightningPageMetadata[];
  currentAppId: string;
  pageSessionKey: string;
  reports: ReportMetadata[];
  availableFlows: Array<Pick<FlowDefinitionMetadata, 'id' | 'apiName' | 'label' | 'flowType' | 'status'>>;
  formFactor: 'Desktop' | 'Tablet' | 'Phone';
  profileId?:string;
  onNavigate: (route: AppRoute) => void;
  onLaunchFlow: (flowApiName: string, inputs?: Record<string, unknown>, context?:{requestId?:string}) => void;
  disableActions?: boolean;
  defaultObjectApiName?: string;
  recordId?: string;
  initialPageState?:Record<string,unknown>;
  pageComponents?:readonly PageComponentMetadata[];
  sessionIdOverride?:string;
  children?: ReactNode;
}) {
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
  // Generic, page-scoped visual state for metadata-configured local actions.
  // Never grants data permissions or persists cross-tenant information.
  const [pageState, setVisiblePageState] = useState<Record<string, unknown>>(()=>initialPageState??{});
  // Every component keeps the full page state, but only redraws when a changed
  // key is one it can read. One unrelated state write used to redraw all
  // components on the page (about 2 s of browser work on a 56-component page).
  const fullPageState=useRef<Record<string,unknown>>(pageState);
  const setPageState=useCallback((next:Record<string,unknown>)=>{
    fullPageState.current=next;setVisiblePageState(next);
  },[]);
  const stateReadText=useMemo(()=>JSON.stringify(component.properties??{}),[component.properties]);
  const implicitStateKeys=useMemo(()=>new Set(implicitPageStateKeys(
    objects.find(item=>item.apiName===String(component.properties.objectApiName||defaultObjectApiName||''))?.fields??[])),
    [objects,component.properties.objectApiName,defaultObjectApiName]);
  const stateRelevance=useRef({stateReadText,implicitStateKeys});
  stateRelevance.current={stateReadText,implicitStateKeys};
  const applyPageStateChange=useCallback((change:Parameters<typeof applyPageSelection>[1],
    dependencies:Parameters<typeof applyPageSelection>[2])=>{
    const previous=fullPageState.current;
    const next=applyPageSelection(previous,change,dependencies);
    if(next===previous)return;
    fullPageState.current=next;
    const {stateReadText:text,implicitStateKeys:implicit}=stateRelevance.current;
    if(pageStateChangeIsRelevant(text,implicit,[change.key,...changedPageStateNames(previous,next)]))
      setVisiblePageState(next);
  },[]);
  const stateDependencies=useMemo(()=>pageStateDependencies(pageComponents??[component]),[pageComponents,component]);
  const pendingFlowOutputs=useRef(new Map<string,{flowApiName:string;mappings:Record<string,unknown>}>());
  useEffect(() => {
    setPageState(initialPageState??{});
    if(sessionIdOverride)setSessionId(sessionIdOverride);
    const sync = (event: Event) => {
      const detail=(event as CustomEvent<{pageSessionKey:string;key:string;value:unknown}>).detail;
      if(detail?.pageSessionKey !== pageSessionKey || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(detail.key))return;
      applyPageStateChange({kind:'state',key:detail.key,value:detail.value},stateDependencies);
    };
    const select=(event:Event)=>{
      const detail=(event as CustomEvent<{pageSessionKey:string;name:string;value:Record<string,unknown>}>).detail;
      if(detail?.pageSessionKey!==pageSessionKey||
        !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(detail.name))return;
      applyPageStateChange({kind:'collection',key:detail.name,value:detail.value},stateDependencies);
    };
    window.addEventListener('metadrive:page-local-state',sync);
    window.addEventListener('metadrive:page-collection-selected',select);
    return ()=>{window.removeEventListener('metadrive:page-local-state',sync);
      window.removeEventListener('metadrive:page-collection-selected',select)};
  },[pageSessionKey,sessionIdOverride,stateDependencies]);
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
  const stateChannel = useFlowStateChannel(properties, sessionId, apiRequest, disableActions === true);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [recordsForQueryKey, setRecordsForQueryKey] = useState('');
  const [recordTotal,setRecordTotal]=useState(0);
  const [recordOffset,setRecordOffset]=useState(0);
  const recordPageSize=100;
  const [contactRecords, setContactRecords] = useState<Record<string, unknown>[]>([]);
  const [dataError, setDataError] = useState('');
  const [dataErrorForQueryKey, setDataErrorForQueryKey] = useState('');
  const [actionError, setActionError] = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [channelAccess, setChannelAccess] = useState<{userId: string;viewAll: boolean;grants: ChannelGrant[];eligibleAssignees: {id: string;name: string;channelAccountId: string}[]}>({
    userId: '', viewAll: false, grants: [], eligibleAssignees: []
  });
  const initializedSessions = useRef<Set<string>>(new Set());
  // Only components that READ a changed Object reload. A write to CartLine must not reload the
  // Product catalogue or categories. Unknown writes and session changes still refresh everything.
  const readObjectApiNames=pageComponentReadObjectNames(objectApiName,properties,objects);
  const readObjectKey=JSON.stringify(readObjectApiNames);
  const loadedListRef=useRef<{rows:Record<string,unknown>[];scope:LoadedRecordListScope}|null>(null);
  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<PageMutationDetail>).detail;
      if (!shouldInvalidatePageComponent(detail,pageSessionKey,sessionId,readObjectApiNames)) return;
      if (detail.sessionId && detail.sessionId !== sessionId) {
        setSessionId(detail.sessionId);
        setPageState({});
        setRevision(value => value + 1);
        return;
      }
      // Till speed: put the saved row straight into a list already on screen
      // (cart lines) instead of re-querying it. Falls back to a refresh whenever
      // the outcome could differ from a fresh server read.
      const loaded=loadedListRef.current;
      const patched=loaded?applySavedRecordMutations(loaded.rows,objectApiName,detail,loaded.scope):null;
      if(patched){
        setRecords(patched.records);
        setRecordTotal(patched.total);
        return;
      }
      setRevision(value => value + 1);
    };
    window.addEventListener('metadrive:page-flow-mutated', sync);
    return () => window.removeEventListener('metadrive:page-flow-mutated', sync);
  }, [pageSessionKey, sessionId, readObjectKey]);
  const fields = objects.find((item) => item.apiName === objectApiName)?.fields ?? [];
  const selectedRecordFilters=activePageRecordFilters(properties);
 const collectionPredicate=collectionRecordFilterFormula(properties,objectApiName,fields);
 const combinedRecordFormula=collectionPredicate
  ?selectedRecordFilters.formula? 'AND('+String(selectedRecordFilters.formula)+','+collectionPredicate+')'
   :collectionPredicate:selectedRecordFilters.formula;
  const recordQuery=pageComponentRecordQuery(selectedRecordFilters.filters,fields,{pageState,recordId,sessionId},properties.filterLogic==='OR'?'OR':'AND',combinedRecordFormula);
  const relatedKey=String(properties.relatedFilterKey??'');
  const {relatedQuery,relatedField,parentId:selectedId}=usePageComponentRelatedScope(
    properties,component.type,fields,objects,pageState,sessionId,revision,
    loadFlowScreenRecordPage,relatedKey?pageState[relatedKey]:undefined,disableActions);
  const recordQueryKey=JSON.stringify([recordQuery,relatedQuery]);
  loadedListRef.current=recordsForQueryKey===recordQueryKey&&!dataLoading?{rows:records,scope:{
    total:recordTotal,offset:recordOffset,pageSize:recordPageSize,readObjectApiNames,
    relatedFilter:relatedQuery.filter,filters:recordQuery.filters,
    hasUnpredictableFilter:Boolean(recordQuery.blocked||relatedQuery.blocked||
      (recordQuery.filter&&!recordQuery.serverFilterable)||
      (recordQuery.filters?.length&&recordQuery.filterLogic&&!/^\(?1\)?$/.test(recordQuery.filterLogic))||
      properties.collectionFormula||properties.recordPresenterApiName||properties.liveRefreshEnabled)
  }}:null;
  useEffect(()=>setRecordOffset(0),[objectApiName,recordQueryKey]);
  const lastRecordRequestKey=useRef('');
  useEffect(() => {
    let active = true;
    let requestId = 0;
    let pending = false;
    // A refresh of the SAME query (a write elsewhere bumped revision) keeps the
    // current rows on screen until the new page arrives: no blank flash, and
    // row formulas are not re-asked for rows that did not change.
    const requestKey=JSON.stringify([objectApiName,recordQueryKey,recordOffset]);
    if(lastRecordRequestKey.current!==requestKey){
      lastRecordRequestKey.current=requestKey;
      setRecords([]);
      setRecordsForQueryKey('');
      setRecordTotal(0);
    }
    setDataError('');
    setDataErrorForQueryKey('');
    if (!objectApiName || recordQuery.blocked || relatedQuery.blocked) {
      setRecords([]);
      setRecordsForQueryKey('');
      setRecordTotal(0);
      setDataLoading(false);
      return () => { active = false; };
    }
    const refresh = async () => {
      if (pending || !active) return;
      pending = true;
      const request = ++requestId;
      try {
        const page=await loadFlowScreenRecordPage(objectApiName,{
          limit:recordPageSize,offset:recordOffset,
          filter:relatedQuery.filter??(recordQuery.serverFilterable?recordQuery.filter:undefined),
          filters:recordQuery.filters,filterLogic:recordQuery.filterLogic
        });
        if (active && request === requestId) {
          setRecords(page.records);
          setRecordTotal(page.total);
          setRecordsForQueryKey(recordQueryKey);
          setDataError('');
          setDataErrorForQueryKey('');
        }
      } catch (reason) {
        if (active && request === requestId) {
          setDataError(reason instanceof Error ? reason.message : 'Unable to load records');
          setDataErrorForQueryKey(recordQueryKey);
        }
      } finally {
        pending = false;
        if (active && request === requestId) setDataLoading(false);
      }
    };
    setDataLoading(true);
    void refresh();
    // The shared Object API remains the RBAC-enforced read source. Poll only
    // live conversation presenters, and only while the document is visible.
    const chatter = Boolean(properties.liveRefreshEnabled) && !disableActions;
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    if (chatter) {
      window.addEventListener('focus', onVisible);
      document.addEventListener('visibilitychange', onVisible);
    }
    const interval = chatter ? window.setInterval(onVisible, 5000) : undefined;
    return () => {
      active = false;
      ++requestId;
      if (interval !== undefined) window.clearInterval(interval);
      if (chatter) {
        window.removeEventListener('focus', onVisible);
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [objectApiName, recordQueryKey, recordOffset, revision, properties.recordPresenterApiName, properties.liveRefreshEnabled, disableActions]);
  useEffect(() => {
    setChannelAccess({userId:'',viewAll:false,grants:[],eligibleAssignees:[]});
    const accessPath=String(properties.channelAccessPath??'');
    if(!/^\/[A-Za-z0-9/_-]+$/.test(accessPath))return;
    let active = true;
    let requestNumber = 0;
    const loadAccess = () => {
      const request = ++requestNumber;
      void apiRequest<{userId:string;viewAll:boolean;grants:ChannelGrant[];eligibleAssignees:{id:string;name:string;channelAccountId:string}[]}>(accessPath)
        .then(value => {if (active && request === requestNumber) setChannelAccess(value);})
        .catch(() => {if (active && request === requestNumber) setChannelAccess({userId:'',viewAll:false,grants:[],eligibleAssignees:[]});});
    };
    loadAccess();
    // A channel assignment may be added while the inbox is open. Re-check on
    // return to this tab without polling or trusting client-supplied grants.
    const onFocus = () => loadAccess();
    const onVisibility = () => {if (document.visibilityState === 'visible') loadAccess();};
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    // Keep an already-open inbox in sync when an administrator assigns a
    // channel while the browser tab remains focused. The authenticated API
    // is the sole source of grants; polling never escalates permissions.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadAccess();
    }, 20000);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [properties.channelAccessPath, properties.recordPresenterApiName, revision]);
  // Contacts are loaded through the same OneEngine record API and its RBAC checks.
  // The bound object is metadata-owned, never supplied by a browser caller.
  const contactsObjectApiName = typeof properties.contactsObjectApiName === 'string' ? properties.contactsObjectApiName : '';
  useEffect(() => {
    let active = true;
    setContactRecords([]);
    if (!contactsObjectApiName) return () => { active = false; };
    void loadFlowScreenRecords(contactsObjectApiName)
      .then(rows => { if (active) setContactRecords(rows); })
      .catch(() => { if (active) setContactRecords([]); });
    return () => { active = false; };
  }, [contactsObjectApiName, revision]);
  const contactChoices = contactRecords.map(row => ({
    id: String(row.Id ?? ''),
    name: String(row[String(properties.contactNameFieldApiName??'')]??''),
    phone: String(row[String(properties.contactPhoneFieldApiName??'')]??'')
  })).filter(contact => contact.id && contact.phone);
  // Data from the previous object/filter must not flash while the new query is pending.
  const currentQueryRecords = recordsForQueryKey === recordQueryKey ? records : [];
  const filteredRecords=recordQuery.filters?currentQueryRecords:filterPageComponentRecords(
    currentQueryRecords,selectedRecordFilters.filters,fields,{pageState,recordId,sessionId},properties.filterLogic==='OR'?'OR':'AND');
  const visibleRecords=relatedField?filterRelatedRecords(filteredRecords,selectedId,relatedField):filteredRecords;
  const namedSource=usePageCollectionFormula(properties.collectionFormula,properties,objects,
    objectApiName,visibleRecords,recordTotal,revision,pageState,sessionId,pageSessionKey,component.id);
  // A configured record presenter may enforce additional channel visibility.
  // Never replace its authorised projection with raw formula collection rows.
  const dataCollection=properties.recordPresenterApiName?null:namedSource.collection;
  const dataCollectionRows=dataCollection?namedCollectionRows(dataCollection):null;
  const mentionContext = useRelationshipMentionContext(objects, mentionRootObjectApiName,
    recordId || explicitMentionRecordId(properties), properties, apiRequest, revision);
  const resolvedProperties = bindPageStateProperties(resolveMentionProperties(properties, mentionContext.records, mentionContext.fields, objects, mentionRootObjectApiName),pageState);
  // Mention resolution strips @Object.Field when no single record is loaded, which
  // turned SUM(@CartLine.Quantity) into SUM(). Keep any string property that still
  // references @Object.Field in its raw form so the formula engine receives it intact
  // (same guard as MetadataBoundPageComponent).
  const rowResolvedProperties = {...resolvedProperties,...Object.fromEntries(
    Object.entries(properties).filter(([,value])=>typeof value==='string'&&
      /@[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/.test(value)))};
  const presented = presentPageRecords(properties.recordPresenterApiName, visibleRecords, channelAccess, properties);
  // A record page already fetched its exact authorised record by ID. Use it
  // even when the record is beyond the first page of the Object list.
  const boundRecordId=recordId||explicitMentionRecordId(properties);
  const currentBoundRecord=mentionContext.records[objectApiName];
  const boundRows=boundRecordId&&currentBoundRecord?.Id===boundRecordId
    ?[currentBoundRecord]:visibleRecords;
  const toggleBinding=resolveSmartToggleFieldBinding(definition.apiName,properties,objectApiName,fields,
    boundRows,recordTotal,boundRecordId);
  const toggleCanWrite=Boolean(toggleBinding?.ready&&!disableActions&&
    behaviorAction(properties,'change',{formFactor})==='enabled');
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
    // Reusable, declarative input formatting. No arbitrary expressions or scripts.
    if (source && typeof source==='object' && !Array.isArray(source)) {
      const option=source as Record<string,unknown>;
      if(option.source==='ToNumber'||option.source==='ProjectRecords')
        return resolveStructuredFlowInput(option,candidate=>resolveInput(candidate,eventPayload));
      if(option.source==='FirstNonEmpty' && Array.isArray(option.values)
        && option.values.length>0 && option.values.length<=5){
        for(const candidate of option.values){
          const result=resolveInput(candidate,eventPayload);
          if(typeof result==='string' && result.trim())return result.trim();
        }
        return '';
      }
      if(option.source==='NormalizePhone'){
        const result=resolveInput(option.value,eventPayload);
        if(typeof result!=='string')return '';
        return result.replace(/[^0-9]/g,'');
      }
      return undefined;
    }
    if (source === '$session') return sessionId;
    if (typeof source === 'string' && source.startsWith('$state.')) {
      return resolvePageStatePath(pageState,source.slice(7));
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
  const onAction = async (action: { event: string; value?: unknown }) => {
    // Actions always see the latest page state, including keys this component
    // did not redraw for.
    const pageState=fullPageState.current;
    if (disableActions) throw new Error('Page Builder preview is read-only. Open the assigned app to test actions.');
    if(behaviorAction(properties,action.event,{formFactor})!=='enabled')
      throw new Error('This action is unavailable under the published Page rules.');
    const validationError=behaviorValidation(properties,action.event,{formFactor});
    if(validationError)throw new Error(validationError);
    window.dispatchEvent(new CustomEvent('metadrive:in-screen-action',{
      detail:{pageSessionKey,componentId:component.id,event:action.event,value:action.value}
    }));
    const hasInteraction=Array.isArray(pageBehaviors(properties)?.interactions)
      &&(pageBehaviors(properties)!.interactions as Array<{event?:unknown}>).some(item=>item?.event===action.event);
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
    const binding = config as Record<string, unknown>;
    setActionError('');
    if(binding.actionType==='SetFilter'){
      const filterKey=String(binding.filterKey||'category');
      if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(filterKey))throw new Error('Invalid filter key');
      const source=action.value&&typeof action.value==='object'&&!Array.isArray(action.value)
        ?action.value as Record<string,unknown>:{value:action.value};
      const value=String(source.value??source.label??'');
      window.dispatchEvent(new CustomEvent('metadrive:page-filter-selected',{detail:{
        pageSessionKey,filterKey,value,label:String(source.label??value),
        recordId:String(source.recordId??''),sourceObjectApiName:String(source.sourceObjectApiName??'')
      }}));return {selected:value};
    }
    if (binding.actionType === 'PageState') {
      const key=String(binding.stateKey??'');
      if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
        throw new Error('Page state action requires a valid metadata state key');
      const payload=action.value && typeof action.value==='object' && !Array.isArray(action.value)
        ? action.value as Record<string,unknown> : {value:action.value};
      const value=resolveInput(binding.value,payload);
      window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
        detail:{pageSessionKey,key,value}
      }));
      return {updated:true};
    }
    if (binding.actionType === 'Formula') {
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
        const name=resolveActionFormulaValue(assignment.value,payload,pageState,sessionId);
        if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*(?:\/[A-Za-z][A-Za-z0-9_]*)?$/.test(name))
          throw Error('Formula navigation requires a declared destination name.');
        const [first,second]=name.split('/');
        const nextBinding=assignment.key==='page'
          ?{actionType:'Navigate',navigationTargetType:'App Page',
             navigationAppId:first,navigationPageApiName:second??''}
          :assignment.key==='home'
          ?{actionType:'Navigate',navigationTargetType:'App Home',
             navigationAppId:first}
          :{actionType:'Navigate',navigationTargetType:'Record List',
             navigationAppId:'Records',navigationObjectApiName:first};
        return executeOpenPageActionNode({binding:nextBinding,context:{
          objects,apps,pages,currentAppId,defaultObjectApiName:objectApiName
        },onNavigate});
      }
      const result=await executePageFormulaAction(apiRequest,binding,payload,
        pageState,objects,objectApiName,sessionId);
      for(const change of result.changes)
        window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
          detail:{pageSessionKey,key:change.key,value:change.value}
        }));
      if(result.recordChanged){
        // Name the written Objects so only components reading them refresh
        // (a CartLine write must not reload Product or MenuCategory).
        window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
          detail:{pageSessionKey,sessionId,
            objectApiNames:result.mutatedObjectApiNames?.length?result.mutatedObjectApiNames:undefined,
            recordChanges:result.recordChanges}
        }));
      }
      return {updated:true};
    }
    if (binding.actionType === 'AdjustNumber') {
      const payload=action.value&&typeof action.value==='object'&&!Array.isArray(action.value)
        ?action.value as Record<string,unknown>:{value:action.value};
      const changes=await adjustNumberRecord(apiRequest,binding as unknown as AdjustNumberBinding,
        payload,pageState,objects,objectApiName);
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
      return executeOpenPageActionNode({binding,context:{
        objects,apps,pages,currentAppId,defaultObjectApiName:objectApiName
      },onNavigate});
    }
    const flowApiName = String(binding.flowApiName ?? '');
    const selected = availableFlows.find((flow) => flow.apiName === flowApiName);
    const flowType = selected?.flowType ?? binding.flowType;
    if (selected && selected.status !== 'Active') {
      throw new Error('Choose an active Flow for the "' + action.event + '" action in Page Builder.');
    }
    if (flowType !== 'Screen Flow' && flowType !== 'In-Screen Flow' && flowType !== 'Autolaunched Flow') {
      throw new Error('Configure an Autolaunched Flow for this standalone app action.');
    }
    const payload = action.value && typeof action.value === 'object' && !Array.isArray(action.value)
      ? action.value as Record<string, unknown> : { value: action.value };
    const inputs = Object.fromEntries(Object.entries(
      binding.inputs && typeof binding.inputs === 'object' && !Array.isArray(binding.inputs)
        ? binding.inputs as Record<string, unknown> : {}
    ).map(([key, source]) => [key, resolveInput(source, payload)]));
    // All validation is metadata-configured; the Flow and server remain authoritative.
    if(binding.inputRules && typeof binding.inputRules==='object' && !Array.isArray(binding.inputRules)){
      const rules=binding.inputRules as Record<string,unknown>;
      for(const [name,rule] of Object.entries(rules)){
        if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))throw Error('Invalid input rule');
        const value=inputs[name];
        if(rule==='NonEmpty' && (typeof value!=='string'||!value.trim())){
          const message='Please provide '+name+'.';
          setActionError(message);throw Error(message);
        }
        if(rule==='E164' && (typeof value!=='string'||!/^[1-9][0-9]{6,14}$/.test(value))){
          const message='Enter a valid international phone number, including country code.';
          setActionError(message);throw Error(message);
        }
      }
    }
    if(binding.outputs!==undefined&&(!binding.outputs||typeof binding.outputs!=='object'||Array.isArray(binding.outputs)))
      throw new Error('Flow output mappings must be an object.');
    const outputMappings:Record<string,unknown>={};
    if(binding.outputs!==undefined)Object.assign(outputMappings,binding.outputs);
    resolveFlowOutputBindings({},outputMappings);
    setActionError('');
    if (['Screen Flow','In-Screen Flow'].includes(flowType)) {
      if (!selected) throw new Error('Screen Flow metadata is unavailable for this action.');
      const requestId=crypto.randomUUID();
      if(pendingFlowOutputs.current.size>=10)throw new Error('Too many pending Flow output mappings.');
      pendingFlowOutputs.current.set(requestId,{flowApiName,mappings:outputMappings});
      onLaunchFlow(flowApiName, inputs,{requestId});
      return { interviewStarted: true };
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
      if(binding.successState && typeof binding.successState==='object'
        && !Array.isArray(binding.successState)){
        for(const [key,value] of Object.entries(binding.successState as Record<string,unknown>)){
          if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || !(
            value===null || ['string','number','boolean'].includes(typeof value)))continue;
          window.dispatchEvent(new CustomEvent('metadrive:page-local-state',{
            detail:{pageSessionKey,key,value}
          }));
        }
      }
      if (binding.mutatesData !== false) {
        setRevision((value) => value + 1);
        window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated', {
        detail: {pageSessionKey,sessionId: completedSessionId}
        }));
      }
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
  // Opt-in, generic Flow-output polling: never creates a second workflow engine or
  // queries unscoped business records. The normal Flow action path enforces RBAC.
  const liveFlowActionRef = useRef(onAction);
  liveFlowActionRef.current = onAction;
  useEffect(() => {
    if (disableActions || properties.liveFlowRefreshEnabled !== true) return;
    const raw = typeof properties.liveFlowRefreshEvents === 'string'
      ? properties.liveFlowRefreshEvents : 'refresh';
    const events = raw.split(',').map(key=>key.trim())
      .filter(key=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && key!=='start'
        && Object.prototype.hasOwnProperty.call(actionFlows,key)).slice(0,3);
    if (!events.length) return;
    const configured=Number(properties.liveFlowRefreshIntervalMs);
    const interval=Number.isFinite(configured) ? Math.max(5000,Math.min(120000,configured)) : 15000;
    let active=true,working=false;
    const refresh=async()=>{
      if(!active || working || document.visibilityState!=='visible')return;
      working=true;
      try { for (const event of events) {
        if(!active || document.visibilityState!=='visible')break;
        await liveFlowActionRef.current({event,value:{}});
      }}catch(e){if(active)setActionError(e instanceof Error?e.message:'Unable to refresh this page');}
      finally{working=false;}
    };
    const timer=window.setInterval(()=>{void refresh();},interval);
    const onVisibility=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',onVisibility);
    const onMutated=(event:Event)=>{
      const detail=(event as CustomEvent<{pageSessionKey?:string}>).detail;
      if(detail?.pageSessionKey===pageSessionKey)void refresh();
    };
    window.addEventListener('metadrive:page-flow-mutated',onMutated);
    return()=>{active=false;window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('metadrive:page-flow-mutated',onMutated);};
  },[pageSessionKey,disableActions,properties.liveFlowRefreshEnabled,
    properties.liveFlowRefreshEvents,properties.liveFlowRefreshIntervalMs]);
  useEffect(() => {
    if (disableActions || !actionFlows.start || initializedSessions.current.has(sessionId)) return;
    initializedSessions.current.add(sessionId);
    void onAction({ event: 'start', value: {} }).catch(() => {
      initializedSessions.current.delete(sessionId);
    });
  }, [sessionId, disableActions]);
  return <div style={definition.apiName==='smart_toggle'||(definition.apiName==='ui_image'&&Boolean(component.position))||(definition.apiName.startsWith('smart_')&&Boolean(component.position))
    ?{width:'100%',height:'100%',minHeight:0,minWidth:0}
    :properties.fillRegion===true?{height:'100%',minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}:undefined}>
    {dataError && dataErrorForQueryKey === recordQueryKey && <div className="records-message" role="alert">{dataError}</div>}
    {actionError && <div className="records-message" role="alert">{actionError}</div>}
    {namedSource.error && <div className="records-message" role="alert">{namedSource.error}</div>}
    <RegisteredComponent definition={definition} layoutTransparent props={{
      ...rowResolvedProperties, ...componentLayoutProps(properties, formFactor),
      ...(definition.apiName.startsWith('smart_') && component.position
        ? {canvasFrameSized:true}:{}),
      label: component.type.startsWith('Custom:smart_') && typeof resolvedProperties.label === 'string'
        ? resolvedProperties.label : component.label,
      properties: rowResolvedProperties, objects, reports, flows: availableFlows, pageState, children,
      dataCollection,
      formulaCollectionSources:namedSource.formulaSources,namedCollections:namedSource.namedCollections,
      fieldAllowed:(key:string,row:Record<string,unknown>)=>scopedFieldAllows(
        properties.dataFieldFilters,key,row,fields,{pageState,recordId,sessionId}),
       pageSessionKey, componentId: component.id,
      device: formFactor, onNavigate, onLaunchFlow, onAction, actionError,
      disabled:behaviorAction(properties,'click',{formFactor})!=='enabled',
      // Shared, bounded, permission-scoped cache: the same image is fetched once, not once per
      // component per refresh.
      loadAsset: (id:string) => requestPageMediaAsset<{contentType:string;contentBase64:string}>(
        apiRequest,id,getAccessToken()??''), viewRevision: revision,
      loadCompanySettings: () => apiRequest('/metadata/currencies'),
      onChange: (value: unknown) => {
        if (actionFlows.change || (Array.isArray(pageBehaviors(properties)?.interactions)
          &&(pageBehaviors(properties)!.interactions as Array<{event?:unknown}>).some(item=>item?.event==='change')))
          void onAction({ event: 'change', value }).catch(() => {});
      },
      // Background refresh of rows already shown is not a loading state (no spinner flash).
      loading: dataLoading && recordsForQueryKey !== recordQueryKey, sessionId, stateChannel,
      // Only bind scalar expressions when one authorised record is in scope.
      // Multi-row components resolve their per-row values inside their own renderer.
      ...(visibleRecords.length===1 ? {record:visibleRecords[0]} : {}),
      ...(objectApiName ? { records: visibleRecords } : {}),
      ...presented,
      // A typed collection is the Data Source; presenter defaults must not
      // overwrite its permission-checked, formula-filtered rows.
      ...(dataCollectionRows?{records:dataCollectionRows}:{}),
      ...(!dataCollectionRows&&objectApiName ? {recordPagination:{
        limit:recordPageSize,offset:recordOffset,total:recordTotal,
        hasPrevious:recordOffset>0,hasNext:recordOffset+recordPageSize<recordTotal,
        available:recordQuery.serverFilterable
      }} : {}),
      ...(contactsObjectApiName ? {contactChoices} : {}),
      ...(toggleBinding?{toggleFieldBound:true,toggleFieldReady:toggleCanWrite,
        toggleFieldError:toggleBinding.error??'',
        value:toggleBinding.ready?toggleBinding.value:false,
        onBoundToggleChange:changeBoundToggle}:{})
    }} />
    {objectApiName&&recordQuery.serverFilterable&&recordTotal>recordPageSize&&<nav
      className="records-pagination" aria-label={component.label+' record pages'}>
      <button type="button" className="btn" disabled={dataLoading||recordOffset===0}
        onClick={()=>setRecordOffset(offset=>Math.max(0,offset-recordPageSize))}>Previous</button>
      <span>{recordOffset+1}–{Math.min(recordOffset+recordPageSize,recordTotal)} of {recordTotal}</span>
      <button type="button" className="btn" disabled={dataLoading||recordOffset+recordPageSize>=recordTotal}
        onClick={()=>setRecordOffset(offset=>offset+recordPageSize)}>Next</button>
    </nav>}
    {objectApiName&&!recordQuery.serverFilterable&&recordTotal>recordPageSize&&<p role="status">
      Results are incomplete: this filter was applied only to the first 100 fetched records. Additional matches may exist; pagination is unavailable for this filter combination.
    </p>}
  </div>;
}

/** Scoped to the authenticated SetupApp instance, with bounded entries and TTL. */
type PageDefinitionCache = Map<string,{page:LightningPageMetadata;fetchedAt:number}>;
const PAGE_DEFINITION_CACHE_TTL_MS=30_000;
const PAGE_DEFINITION_CACHE_MAX=100;
function pageDefinitionCacheKey(appId:string,pageApiName:string|undefined,layout:string,viewportWidth:number,profileId:string|undefined):string{
  // Even Desktop requests can resolve to a width-targeted Custom page.
  return JSON.stringify([appId,pageApiName??'__home__',layout,viewportWidth,profileId??'']);
}
function readPageDefinitionCache(cache:PageDefinitionCache,key:string):LightningPageMetadata|null{
  const hit=cache.get(key);
  return hit&&Date.now()-hit.fetchedAt<PAGE_DEFINITION_CACHE_TTL_MS?hit.page:null;
}
function writePageDefinitionCache(cache:PageDefinitionCache,key:string,page:LightningPageMetadata|null):void{
  if(!page)return;
  cache.delete(key);
  if(cache.size>=PAGE_DEFINITION_CACHE_MAX)cache.delete(cache.keys().next().value!);
  cache.set(key,{page,fetchedAt:Date.now()});
}
function usePageLayoutDevice(): LayoutDevice {
  // Share the shell's phone/portrait/landscape breakpoints. Avoid the old
  // 640/1024 off-by-one boundaries when loading published Tablet variants.
  return useFormFactor();
}

function LightningAppRuntime({
  appId,
  pageApiName,
  objects,
  apps,
  pages,
  reports,
  libraryComponents,
  availableFlows,
  formFactor,
  profileId,
  pageDefinitionCache,
  onNavigate,
  onLaunchFlow,
  onStandaloneModeChange,
  inScreenPage=false,
  inScreenContext,
  previewPage,
  previewLayoutDevice
}: {
  appId: string;
  pageApiName?: string;
  objects: ObjectMetadata[];
  apps: LightningAppMetadata[];
  pages: LightningPageMetadata[];
  reports: ReportMetadata[];
  libraryComponents: LibraryComponentMetadata[];
  availableFlows: Array<Pick<FlowDefinitionMetadata, 'id' | 'apiName' | 'label' | 'flowType' | 'status' | 'startConfig' | 'resources'>>;
  formFactor: 'Desktop' | 'Tablet' | 'Phone';
  profileId?: string;
  pageDefinitionCache: PageDefinitionCache;
  onNavigate: (route: AppRoute) => void;
  onLaunchFlow: (flowApiName: string, inputs?: Record<string, unknown>, context?:{requestId?:string}) => void;
  onStandaloneModeChange: (enabled: boolean) => void;
  inScreenPage?: boolean;
  inScreenContext?: {sessionId?:string;values?:Record<string,unknown>};
  /** Unpublished draft for the Page Builder. Uses this runtime without fetching/caching a published page. */
  previewPage?: LightningPageMetadata;
  /** Match the device selected in the builder instead of the admin window width. */
  previewLayoutDevice?: 'Desktop' | 'Tablet' | 'Phone';
}) {
  const detectedLayoutDevice = usePageLayoutDevice();
  const layoutDevice = previewLayoutDevice ?? detectedLayoutDevice;
  const viewportWidth=useViewportWidth();
  const requestedLayout = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('pageLayout') === 'Custom'
      ? 'Custom' : layoutDevice === 'Tablet' ? 'Tablet' : formFactor === 'Phone' ? 'Mobile' : 'Desktop';
  const cacheKey=pageDefinitionCacheKey(appId,inScreenPage?'window:'+pageApiName:pageApiName,requestedLayout,viewportWidth,profileId);
  const routeKey=cacheKey;
  const [pageLoad,setPageLoad]=useState<{
    routeKey:string;
    appId:string;
    page:LightningPageMetadata|null;
    error:string;
    loading:boolean;
  }>({routeKey:'',appId:'',page:null,error:'',loading:true});
  const routePending=pageLoad.routeKey!==routeKey;
  const cached=routePending?readPageDefinitionCache(pageDefinitionCache,cacheKey):null;
  // Never run components from the previous route while navigating. Cached
  // definitions render immediately; uncached routes show the loading state.
  const page=previewPage??(routePending?cached:pageLoad.page);
  const error=previewPage?'':routePending?'':pageLoad.error;
  const loading=previewPage?false:routePending?!cached:pageLoad.loading;
  const [activeTabs, setActiveTabs] = useState<Record<string,string>>({});
  const [layoutState,setLayoutState]=useState<Record<string,unknown>>(inScreenPage?inScreenContext?.values??{}:{});
  const [interactionOverrides,setInteractionOverrides]=useState<Record<string,Record<string,unknown>>>({});
  useEffect(()=>setInteractionOverrides({}),[appId,page?.apiName]);
  useEffect(()=>{
    if(!page)return;
    const session=appId+':'+page.apiName;
    const targets=page.components.map(item=>{
      const definition=item.type.startsWith('Custom:')
        ?findRegisteredComponent(libraryComponents,item.type.slice('Custom:'.length),'page'):undefined;
      return {id:item.id,propertyDefinitions:definition?.propertyDefinitions,
        componentVersion:definition?.version};
    });
    const onInteraction=(event:Event)=>{
      const detail=(event as CustomEvent<{pageSessionKey:string;componentId:string;event:string;value:unknown}>).detail;
      if(detail?.pageSessionKey!==session||typeof detail.componentId!=='string'||typeof detail.event!=='string')return;
      const source=page.components.find(item=>item.id===detail.componentId);
      if(!source)return;
      const updates=behaviorInteractions(source.properties,detail.event,detail.value,layoutState,targets,
        requestedLayout,source.type.startsWith('Custom:')
          ?findRegisteredComponent(libraryComponents,source.type.slice('Custom:'.length),'page')?.eventDefinitions:undefined);
      if(!updates.length)return;
      setInteractionOverrides(previous=>{
        const next={...previous};
        for(const item of updates)next[item.targetComponentId]={...(next[item.targetComponentId]??{}),[item.targetProperty]:item.value};
        return next;
      });
    };
    window.addEventListener('metadrive:page-component-interaction',onInteraction);
    return()=>window.removeEventListener('metadrive:page-component-interaction',onInteraction);
  },[page,appId,libraryComponents,layoutState,requestedLayout]);
  useEffect(()=>{
    setLayoutState(inScreenPage?inScreenContext?.values??{}:{});
    const listener=(event:Event)=>{
      const detail=(event as CustomEvent<{pageSessionKey:string;key:string;value:unknown}>).detail;
      if(detail?.pageSessionKey!==appId+':'+page?.apiName)return;
      if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(detail.key))return;
      setLayoutState(prev=>({...prev,[detail.key]:detail.value}));
    };
    window.addEventListener('metadrive:page-local-state',listener);
    return()=>window.removeEventListener('metadrive:page-local-state',listener);
  },[appId,page?.apiName]);
  useEffect(() => {
    // Draft previews never fetch the published revision or pollute the tenant-scoped page cache.
    if(previewPage)return;
    let active = true;
    const cachedPage=readPageDefinitionCache(pageDefinitionCache,cacheKey);
    if(cachedPage){
      setPageLoad({routeKey,appId,page:cachedPage,error:'',loading:false});
      return ()=>{active=false;};
    }
    setPageLoad({routeKey,appId,page:null,error:'',loading:true});
    const endpoint = inScreenPage && pageApiName
      ? `/apps/${encodeURIComponent(appId)}/in-screen-pages/${encodeURIComponent(pageApiName)}?formFactor=${requestedLayout}&viewportWidth=${viewportWidth}`
      : pageApiName
        ? `/apps/${encodeURIComponent(appId)}/pages/${encodeURIComponent(pageApiName)}?formFactor=${requestedLayout}&viewportWidth=${viewportWidth}`
        : `/apps/${encodeURIComponent(appId)}/home-page?formFactor=${requestedLayout}&viewportWidth=${viewportWidth}`;
    void apiRequest<{ page: LightningPageMetadata | null }>(endpoint).then((payload) => {
      if(active){
        writePageDefinitionCache(pageDefinitionCache,cacheKey,payload.page);
        setPageLoad({routeKey,appId,page:payload.page,error:'',loading:false});
      }
    }).catch((failure: unknown) => {
      if(active)setPageLoad({
        routeKey,appId,page:null,
        error:failure instanceof Error?failure.message:'Unable to load Lightning page',
        loading:false
      });
    });
    return ()=>{active=false;};
  },[routeKey,appId,pageApiName,inScreenPage,requestedLayout,viewportWidth,pageDefinitionCache,cacheKey,previewPage]);
  useEffect(() => {
    setActiveTabs({});
  }, [page?.apiName]);
  useEffect(() => {
    onStandaloneModeChange(isStandalonePagePresentation(page));
    return () => onStandaloneModeChange(false);
  }, [page?.layoutMode, onStandaloneModeChange]);
  if(error&&!page)return <div className="records-page"><div className="records-message" role="alert">{error}</div></div>;
  if(loading&&!page)return <div className="records-page"><div className="records-loading">Loading Lightning page…</div></div>;
  if (!page) return <main className="records-page"><section className="records-empty records-home-unassigned" aria-labelledby="records-home-empty-heading"><h1 id="records-home-empty-heading">Home page is not configured</h1><p>This app has no active Home Page assigned for your current profile and device.</p><p>Ask an administrator to activate and assign a Home Page in the Lightning App Builder. Existing app pages and records remain available from navigation.</p></section></main>;
  const isStandaloneRuntime = isStandalonePagePresentation(page);
  const regions: Array<'header' | 'main' | 'sidebar'> = ['header', 'main', 'sidebar'];
  const appVisibilityContext = { formFactor,profileId } as const;
  const isAppComponentVisible = (component: PageComponentMetadata) =>
    isComponentVisible(component, appVisibilityContext, false);
  const emitInteraction=(component:PageComponentMetadata,event:string,value:unknown)=>{
    window.dispatchEvent(new CustomEvent('metadrive:page-component-interaction',{
      detail:{pageSessionKey:appId+':'+page.apiName,componentId:component.id,event,value}
    }));
  };
  const renderComponent = (original: PageComponentMetadata): React.ReactNode => {
    const component={...original,properties:{...original.properties,...interactionOverrides[original.id]}};
    if (!isAppComponentVisible(component)) return null;
    if(behaviorAction(component.properties,'click',appVisibilityContext)==='hidden')return null;
    if (isLayoutType(component.type)) return <div key={component.id} className="page-nested-layout" style={{...resolvePageComponentStyle(component.properties, component.type, layoutDevice),...behaviorAppearance(component.properties,appVisibilityContext)}}>{childrenOf(page.components, component.id).map((child) => renderComponent(child))}</div>;
    if (component.type.startsWith('Custom:')) {
      const definition = findRegisteredComponent(libraryComponents, component.type.slice('Custom:'.length), 'page');
      const nestedChildren = isLayoutContainer(component)
        ? childrenOf(page.components, component.id).filter(isAppComponentVisible).map((child) => page.layoutMode === 'free-canvas'
            ? renderCanvasComponent(child, true) : renderComponent(child))
        : undefined;
      if (!definition) return <div className="records-message" role="status" key={component.id}>
        Component is no longer registered: {component.label}
      </div>;
      const content = needsMetadataComponentRuntime(component.properties)
        ? <MetadataBoundPageComponent definition={definition} component={component} defaultObjectApiName={page.targetObject}
            objects={objects} apps={apps} pages={pages} currentAppId={appId} pageSessionKey={appId + ':' + page.apiName} pageComponents={page.components} reports={reports} availableFlows={availableFlows} formFactor={formFactor}
            initialPageState={inScreenPage?inScreenContext?.values:undefined}
            sessionIdOverride={inScreenPage?inScreenContext?.sessionId:undefined}
            children={nestedChildren}
            onNavigate={onNavigate} onLaunchFlow={onLaunchFlow} />
        : <RegisteredComponent definition={definition} layoutTransparent props={{
            ...component.properties, pageState:layoutState,
            ...componentLayoutProps(component.properties, layoutDevice),
            ...(definition.apiName.startsWith('smart_') && component.position
              ? {canvasFrameSized:true}:{}),
            disabled:behaviorAction(component.properties,'click',appVisibilityContext)!=='enabled',
            onAction:(action:{event:string;value?:unknown})=>{
              if(behaviorAction(component.properties,action.event,appVisibilityContext)!=='enabled')return;
              emitInteraction(component,action.event,action.value);
            },
            onChange:(value:unknown)=>{
              if(behaviorAction(component.properties,'change',appVisibilityContext)==='enabled')
                emitInteraction(component,'change',value);
            },
            label: component.type.startsWith('Custom:smart_') && typeof component.properties.label === 'string'
              ? component.properties.label : component.label,
            properties: component.properties,
            pageSessionKey: appId + ':' + page.apiName, componentId: component.id,
            device: layoutDevice, children: nestedChildren
          }} />;
      const rendered = nestedChildren?.length && definition.trustedBundled !== true
        ? <div className="metadata-nested-host" data-nested-host={component.id}>{content}{nestedChildren}</div>
        : content;
      return page.layoutMode === 'free-canvas' ? rendered
        : <div key={component.id} data-page-appearance={pageAppearanceTarget(component.type)} data-page-style={pageAppearanceStyleKeys(resolvePageComponentStyle(component.properties, component.type, layoutDevice))} style={{...resolvePageComponentStyle(component.properties, component.type, layoutDevice),
          ...behaviorAppearance(component.properties,appVisibilityContext),
          ...(component.properties?.fillRegion===true ? {height:'100%',minHeight:0}: {})}}>{rendered}</div>;
    }
    if(component.type==='Items to Approve')
      return <React.Suspense key={component.id} fallback={<p role="status">Loading approvals…</p>}>
        <StandardApprovals request={apiRequest} appId={appId} onNavigate={onNavigate}/>
      </React.Suspense>;
    if(component.type==='Rich Text')
      return <StandardRichText key={component.id} text={String(component.properties.content??'')}/>;
    if(component.type==='List View'){
      const source=objects.find(item=>item.apiName===component.properties.listObjectApiName);
      const columns=Array.isArray(component.properties.columns)
        ?component.properties.columns.filter((name):name is string=>typeof name==='string'):[];
      return <StandardRecordList key={component.id} object={source} request={apiRequest}
        appId={appId} onNavigate={onNavigate} columns={columns}
        pageSize={typeof component.properties.pageSize==='number'?component.properties.pageSize:25} savedViewId={typeof component.properties.savedViewId==='string'?component.properties.savedViewId:undefined}/>;
    }
    if(component.type==='Screen Flow')
      return component.properties.embed===false
        ?<StandardFlowLauncher key={component.id} label={component.label}
            flowApiName={String(component.properties.flowApiName??'')}
            flows={availableFlows} onLaunchFlow={onLaunchFlow}/>
        :<React.Suspense fallback={<p role="status">Loading Flow…</p>} key={component.id}>
            <EmbeddedScreenFlow label={component.label}
              flowApiName={String(component.properties.flowApiName??'')}
              flows={availableFlows} request={apiRequest}
              libraryComponents={libraryComponents}
              onFinished={()=>window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
                detail:{pageSessionKey:appId+':'+page.apiName}}))}/>
          </React.Suspense>;
    if (component.type === 'Dashboard') return <section className="record-fields-card surface" key={component.id}>
      <EmbeddedDashboard dashboardApiName={String(component.properties.dashboardApiName ?? '')}
        request={apiRequest} libraryComponents={libraryComponents} />
    </section>;
    if (component.type === 'Report Chart') {
      const reportApiName = typeof component.properties.reportApiName === 'string' ? component.properties.reportApiName : '';
      return <section className="record-fields-card surface" key={component.id}>
        <div className="record-fields-heading"><h2>{component.label}</h2></div>
        <RuntimeReportChart report={reports.find((report) => report.apiName === reportApiName)} objects={objects} />
      </section>;
    }
    if (component.type === 'Tabs') {
      const configuredTabs=Array.isArray(component.properties.tabs)
        ? component.properties.tabs.filter((tab): tab is string => typeof tab === 'string')
        : [];
      const tabs = behaviorTabs(component.properties,configuredTabs,appVisibilityContext);
      if(!tabs.length)return null;
      const selected = tabs.includes(activeTabs[component.id]) ? activeTabs[component.id] : tabs[0];
      const nested=childrenOf(page.components,component.id);
      const selectedChildren=nested.filter(child=>
        behaviorTabForChild(child.properties.tabLabel,configuredTabs,tabs)===selected);
      // Legacy pages put a sibling with the same label under each tab.
      const legacy = nested.length===0 ? page.components.find((item) =>
        item.id !== component.id && isAppComponentVisible(item)
        && item.label.toLocaleLowerCase() === selected?.toLocaleLowerCase()) : null;
      return <section className="record-fields-card surface" key={component.id}>
        <div className="record-tabs" role="tablist" aria-label={component.label}>
          {tabs.map(tab=><button type="button" role="tab" key={tab} aria-selected={selected===tab}
            className={selected===tab?'active':''} tabIndex={selected===tab?0:-1}
            onKeyDown={event=>{
              const next=nextAccessibleTabIndex(event.key,tabs.indexOf(tab),tabs.length);
              if(next===null)return;
              event.preventDefault();
              setActiveTabs(current=>({...current,[component.id]:tabs[next]}));
              const buttons=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              buttons?.[next]?.focus();
            }}
            onClick={()=>setActiveTabs(current=>({...current,[component.id]:tab}))}>{tab}</button>)}
        </div>
        <div className="record-runtime-tab-panel" role="tabpanel">
          {selectedChildren.length?selectedChildren.map(renderComponent)
            :legacy?renderComponent(legacy)
              :<div className="records-empty">{selected?'No blocks assigned to this tab.':'Configure tabs in page settings.'}</div>}
        </div>
      </section>;
    }
    if (component.type === 'Accordion') {
      const nested=childrenOf(page.components,component.id);
      return <details className="record-fields-card surface app-page-accordion" key={component.id} open>
        <summary>{component.label}</summary>
        {nested.length?nested.map(renderComponent)
          :<p>{typeof component.properties.content === 'string'&&component.properties.content
            ?component.properties.content:'No blocks configured for this accordion.'}</p>}
      </details>;
    }
    return <div className="records-message" role="status" key={component.id}>{component.label} is not supported on app pages.</div>;
  };
  const renderCanvasComponent = (component: PageComponentMetadata, nested = false) => {
    if (!isAppComponentVisible(component)) return null;
    return <div key={component.id} className={nested ? 'free-canvas-runtime-component nested-page-runtime' : 'free-canvas-runtime-component'}
      data-layout-component-id={component.id}
      data-page-appearance={isLayoutType(component.type) ? 'layout' : pageAppearanceTarget(component.type)}
      data-page-style={pageAppearanceStyleKeys(resolvePageComponentStyle(component.properties, component.type, layoutDevice))}
      style={{
        ...(nested
          ? { position: 'relative', left: 'auto', top: 'auto', width: '100%', height: 'auto', minHeight: 40 }
          : {
              left: component.position?.x ?? 0,
              top: component.position?.y ?? 0,
              width: component.position?.width ?? 320,
              height: component.position?.height ?? 180
            }),
        ...(isLayoutType(component.type) ? {} : resolvePageComponentStyle(component.properties, component.type, layoutDevice)),
        ...behaviorAppearance(component.properties,appVisibilityContext),
        ...(isStandaloneRuntime && component.properties?.standalonePresentation === true && !nested
          ? { left: 0, top: 0, width: '100%', height: '100%' } : {})
      } as React.CSSProperties}>
      {renderComponent(component)}
    </div>;
  };
  const inScreenHost=!inScreenPage&&availableFlows.some(flow=>flow.flowType==='In-Screen Flow'&&flow.status==='Active')
    ?<React.Suspense fallback={null}><InScreenFlowHost flows={availableFlows}
      appApiName={appId} pageApiName={page.apiName} onLaunchFlow={onLaunchFlow}
      pageRecordId={typeof layoutState.recordId==='string'?layoutState.recordId:undefined}/></React.Suspense>:null;
  if(page.layoutMode==='free-canvas')return <><ResponsivePageCanvas page={page}>
    {childrenOf(page.components,null).map(component=>renderCanvasComponent(component))}
  </ResponsivePageCanvas>{inScreenHost}</>;
  const renderRegion = (region: 'header' | 'main' | 'sidebar') =>
    childrenOf(page.components, null).filter((component) => isAppComponentVisible(component) && (component.region ?? 'main') === region).map(component => {
      const content = renderComponent(component);
      return content && !component.type.startsWith('Custom:') && !isLayoutType(component.type)
        && (hasPageComponentAppearance(component.properties)||Object.keys(behaviorAppearance(component.properties,appVisibilityContext)).length>0)
        ? <div key={component.id} data-page-appearance={pageAppearanceTarget(component.type)} data-page-style={pageAppearanceStyleKeys(resolvePageComponentStyle(component.properties, component.type, layoutDevice))} style={{...resolvePageComponentStyle(component.properties, component.type, layoutDevice),...behaviorAppearance(component.properties,appVisibilityContext)}}>{content}</div>
        : content;
    });
  return <><TemplatePageRuntimeLayout apiName={page.apiName} label={page.label}
    pageType={page.pageType} template={page.template} canvasFillColor={page.canvasFillColor}
    fullscreen={isStandaloneRuntime && page.layoutMode === 'template'} phone={formFactor === 'Phone'} layoutVariant={page.components.find(component => component.properties?.standalonePresentation === true)?.properties?.presentationLayout as string | undefined}
    overlayOpen={layoutState.basketOpen===true}
    header={renderRegion('header')} main={renderRegion('main')} sidebar={renderRegion('sidebar')} />{inScreenHost}</>;
}


return { RuntimeReportChart, MetadataBoundPageComponent, usePageLayoutDevice, LightningAppRuntime };
}
