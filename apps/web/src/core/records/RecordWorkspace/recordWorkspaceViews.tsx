import {PageFormulaScope} from '../../components/RegisteredComponent/PageFormulaScope';
import CrossObjectRecordField from './CrossObjectRecordField';
import {resolveHighlightFields} from './highlightFieldSelection';
import {behaviorAppearanceLabel} from '../../pages/PageRuntime/pageBehaviorRuntime';
import {nextAccessibleTabIndex} from '../../pages/PageRuntime/tabKeyboardNavigation';
import {visibleRelatedListQuickLinks} from './relatedQuickLinks';
import { useFormFactor, useRuntimeFormFactor } from '../../workspace/Responsive/useFormFactor';
import {useViewportWidth} from '../../workspace/Responsive/useViewportWidth';
import './recordsListToolbar.css';
import './recordSplit.css';
import ContextMenu from '../../../component-libraries/shared/ContextMenu';
import { resolvePhoneColumns } from '../ResponsiveDataList/phoneColumns.mjs';
import { RecordFormDialog } from '../RecordFormDialog/recordFormDialogView';
import InlineRecordField from './InlineRecordField';
import {recordEditPageLayout} from './recordEditPageLayout';
import {recordInlineFieldRules,validateInlineFieldValue} from './recordInlineFieldRules';
import {filterLayoutWritableValues,missingLayoutRequiredFields,applyRequiredLayoutDefaults} from './layoutWritableValues';
import {behaviorAction,behaviorRecordAction,behaviorAppearance,behaviorField,behaviorTabs,behaviorTabForChild,behaviorInteractions} from '../../pages/PageRuntime/pageBehaviorRuntime';
import {recordPagePresentationLayout} from './recordPageLayoutMigration';
import {actionVisibleInArea} from './recordActionPlacement';
import RichTextContent from './RichTextContent';
import FormulaImageContent from './FormulaImageContent';
import {resolveRecordCustomLink} from './recordCustomLinks';
import { pageLayoutForRecord, compactLayoutForRecord, type RecordData } from './recordMetadataUtils';
import { formatRecordValue, parseCsvImport } from './recordCsvUtils';
import { initialScreenValues, screenFieldIsVisible } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import { appRoutePath, type AppRoute } from '../../workspace/Navigation/appRouting';
import { NavigationLoadTime, resolveCurrentAppNavigation } from '../../workspace/Navigation/appNavigationView';
import { isStandalonePagePresentation, pageCanvasPresentationStyle } from '../../pages/PageRuntime/pageRuntimePresentation';
import { insertFlowElementAtPath } from '../../builders/FlowBuilder/flowInsertElement.mjs';
import {resolveSetupNavigation} from '../../platform/Workspace/platformSetupNavigation';
import {readVerifiedMetadata,saveVerifiedMetadata,type MetadataPublicationResponse} from '../../metadata/Cache/verifiedMetadataCache';
import { queueOfflineRecord, listOfflineRecords, markOfflineRecord, removeOfflineRecord, synchronizeOfflineRecords, type OfflineQueueOwner, type OfflineRecordItem } from '../../metadata/Cache/offlineRecordQueue';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronRight, Copy, Database, Ellipsis, Filter, Pencil, Plus, Smartphone, RefreshCw, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import FlowScreenContent from '../../automation/FlowScreen/FlowScreenContent';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import { RecordsListPageHeading, RecordsListSearchControls } from '../../../component-libraries/shared/primitives/RecordsListNavigation/RecordsListNavigation';
import PageRouteDirectory from '../../pages/PageRouteDirectory/PageRouteDirectory';
import { isComponentVisible } from '../../components/Properties/componentVisibility';
import { canNestComponent, componentVisualStyle, directChildren, isLayoutType, isDescendantOf, layoutTypes } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import { isCanvasLocked, wrapCanvasComponent, ungroupCanvasComponent } from '../../builders/PageBuilder/canvasInteractions';
import { needsMetadataComponentRuntime } from '../../pages/PageRuntime/pageComponentBindings';
import { childrenOf, componentLayoutProps, hasPageComponentAppearance, isLayoutContainer, resolvePageComponentStyle, type LayoutDevice } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import {GlobalRecordSearch} from '../../../component-libraries/shared/primitives/GlobalRecordSearch/GlobalRecordSearch';
import {useDismissOnOutside} from '../../accessibility/Dismiss/useDismissOnOutside';

import { pageIsAvailableInApp, resolvePageActionRoute } from '../../pages/PageRuntime/pageActionRouting';
import ApprovalProcessManager from '../../automation/ApprovalProcessManager/ApprovalProcessManager';
import { standardPageComponents } from '../../components/Catalog/index';
import EmbeddedDashboard from '../../pages/EmbeddedDashboard/EmbeddedDashboard';
import {StandardRecordList,StandardRichText,StandardRecordPath,StandardFlowLauncher} from '../../pages/PageRuntime/StandardPageBlocks';
import ResponsivePageCanvas from '../../pages/PageRuntime/ResponsivePageCanvas';
const EmbeddedScreenFlow=React.lazy(()=>import('../../pages/PageRuntime/EmbeddedScreenFlow'));
const StandardApprovals=React.lazy(()=>import('../../pages/PageRuntime/StandardApprovals'));
import { inspectPageDependencies } from '../../pages/PageRuntime/pageDependencies';
import {
  canvasDimensionsForOrientation,
  canvasBoundPosition,
  canvasOrientation,
  canvasScaleToFitWidth,
  canvasUnitsFromScreenDelta
} from '../../pages/PageRuntime/pageCanvas';
import {
  createComponentPreviewProps,
  getPageBuilderComponentCategories,
  pageBuilderPaletteCategories
} from '../../builders/PageBuilder/pageBuilderPalette';
import { type ObjectMetadata, type FieldMetadata, type ObjectActionMetadata, type FlowDefinitionMetadata, type LightningPageMetadata, type PageComponentMetadata, type LibraryComponentMetadata, type ReportMetadata, type LightningAppMetadata } from '../../metadata/Definitions/metadata';
type RecordActivity = {
  id: string;
  objectApiName: string;
  recordId: string;
  kind: 'Task' | 'Call' | 'Event';
  subject: string;
  description: string;
  status: 'Open' | 'Completed';
  dueAt: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
};
type ChatterComment = { id: string; body: string; createdBy: string; createdByName: string; createdAt: string };
type ChatterPost = {
  id: string;
  objectApiName: string;
  recordId: string;
  body: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  comments: ChatterComment[];
};
type SavedRecordListView = {
  id:string;label:string;visibility:'private'|'all'|'groups';scope:'my'|'all'|'my_team'|'queue';
  columns:string[];phoneRoles?:Record<string,'title'|'subtitle'|'badge'|'trailing'|'hidden'>;
  filters:Array<{field:string;operator:string;value:string|string[]}>;
  filter_logic:string;sort_field:string|null;sort_direction:'asc'|'desc';pinned:boolean;owner_id:string;
  groupIds:string[];
};

const QuickActionComponentOverlay=React.lazy(()=>import('../QuickActionComponentOverlay'));

export function createRecordWorkspaceViews(apiRequest: <T>(path: string, init?: RequestInit) => Promise<T>, usePageLayoutDevice: () => LayoutDevice, ApiRequestError: new (...args: any[]) => Error & { status: number }, getAccessToken: () => string | undefined, RuntimeReportChart: React.ComponentType<any>, MetadataBoundPageComponent: React.ComponentType<any>) {
const dateFilterPresets = [
  {value: '@yesterday', label: 'Yesterday'},
  {value: '@today', label: 'Today'},
  {value: '@tomorrow', label: 'Tomorrow'},
  {value: '@last_week', label: 'Last week'},
  {value: '@this_week', label: 'This week'},
  {value: '@next_week', label: 'Next week'},
  {value: '@last_month', label: 'Last month'},
  {value: '@this_month', label: 'This month'},
  {value: '@next_month', label: 'Next month'},
  {value: '@last_year', label: 'Last year'},
  {value: '@this_year', label: 'This year'},
  {value: '@next_year', label: 'Next year'},
];
const recordFilterOperatorLabels: Record<string, string> = {
  eq: 'Equals', ne: 'Does not equal', lt: 'Before / less than',
  lte: 'On or before / at most', gt: 'After / greater than',
  gte: 'On or after / at least', contains: 'Contains',
  startsWith: 'Starts with', includes: 'Includes', excludes: 'Excludes', in: 'Any of',
};
const isRecordDateField = (field?: FieldMetadata) =>
  /^(date|datetime)$/i.test((field?.dataType ?? '').replace(/[\s/]/g, ''));

function SavedRecordListViewPicker({objectApi,defaultColumns,selected,onSelect,onColumnsChange,onPhoneRolesChange,pendingColumns,legacyFilter,fields}:{
  objectApi:string;defaultColumns:string[];selected:SavedRecordListView|null;
  onSelect:(view:SavedRecordListView|null)=>void;
  onColumnsChange:(columns:string[]|null)=>void;
  onPhoneRolesChange:(mapping:SavedRecordListView['phoneRoles']|null)=>void;
  pendingColumns?:string[]|null;
  legacyFilter?:ObjectMetadata['listViewFilter'];
  fields:FieldMetadata[];
}) {
  const [views,setViews]=useState<SavedRecordListView[]>([]);
  const [scope,setScope]=useState<SavedRecordListView['scope']>('all');
  const [visibility,setVisibility]=useState<SavedRecordListView['visibility']>('private');
  const [groups,setGroups]=useState<Array<{id:string;label:string}>>([]);
  const [groupIds,setGroupIds]=useState<string[]>([]);
  const [viewColumns,setViewColumns]=useState(defaultColumns);
  useEffect(()=>{if(pendingColumns)setViewColumns(pendingColumns);},[pendingColumns]);
  const [phoneRoles,setPhoneRoles]=useState<NonNullable<SavedRecordListView['phoneRoles']>>({});
  const [filters,setFilters]=useState<Array<{field:string;operator:string;value:string}>>(
    legacyFilter?[{field:legacyFilter.fieldApiName??'',operator:legacyFilter.operator==='Includes'?'includes'
      :legacyFilter.operator==='Excludes'?'excludes':'eq',value:legacyFilter.value??''}]:[]);
  const [filterLogic,setFilterLogic]=useState('');
  const [error,setError]=useState('');
  const popoverRootRef=useRef<HTMLDivElement>(null);
  const dismissViewPopovers=()=>popoverRootRef.current?.querySelectorAll<HTMLDetailsElement>('details.records-view-popover[open]')
    .forEach(details=>{details.open=false;});
  const filterableFields=fields.filter(field=>!field.formula
    &&!['geolocation','address','encryptedtext'].includes(field.dataType.toLowerCase()));
  useEffect(()=>{
    let active=true;
    void apiRequest<{views:SavedRecordListView[]}>(`/records/${encodeURIComponent(objectApi)}/list-views`)
      .then(result=>{if(active)setViews(result.views);})
      .catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Unable to load saved views');});
    return ()=>{active=false;};
  },[objectApi]);
  useEffect(()=>{
    setViewColumns(defaultColumns);
    setPhoneRoles({});
    onPhoneRolesChange(null);
    onColumnsChange(null);
    setFilters(legacyFilter?[{field:legacyFilter.fieldApiName??'',operator:legacyFilter.operator==='Includes'?'includes'
      :legacyFilter.operator==='Excludes'?'excludes':'eq',value:legacyFilter.value??''}]:[]);
    setFilterLogic('');
  },[objectApi]);
  useEffect(()=>{
    if(visibility!=='groups')return;
    let active=true;
    void apiRequest<{groups:Array<{id:string;label:string}>}>(`/records/${encodeURIComponent(objectApi)}/list-view-groups`)
      .then(result=>{if(active)setGroups(result.groups);})
      .catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Unable to load sharing groups');});
    return ()=>{active=false;};
  },[objectApi,visibility]);
  const save=async(update=false)=>{
    const label=update&&selected?selected.label:window.prompt('Name this list view');
    if(!label?.trim())return;
    setError('');
    try{
      const payload={label,visibility,scope,columns:viewColumns,
        phoneRoles:Object.fromEntries(Object.entries(phoneRoles).filter(([field])=>viewColumns.includes(field))),
        groupIds:visibility==='groups'?groupIds:[],
        filters:filters.map(filter=>({...filter,
          value:filter.operator==='in'?filter.value.split(',').map(value=>value.trim()).filter(Boolean):filter.value})),
        filterLogic,sortField:selected?.sort_field??undefined,sortDirection:selected?.sort_direction??'asc'};
      const path=`/records/${encodeURIComponent(objectApi)}/list-views${update&&selected
        ?`/${encodeURIComponent(selected.id)}`:''}`;
      const result=await apiRequest<{view:SavedRecordListView}>(path,{
        method:update?'PUT':'POST',body:JSON.stringify(payload)
      });
      setViews(current=>update
        ?current.map(view=>view.id===result.view.id?result.view:view)
        :[...current,result.view]);
      onSelect(result.view);
      dismissViewPopovers();
    }catch(failure){setError(failure instanceof Error?failure.message:'Unable to save list view');}
  };
  const setPinned=async()=>{
    if(!selected)return;
    setError('');
    try{
      await apiRequest(`/records/${encodeURIComponent(objectApi)}/list-views/${encodeURIComponent(selected.id)}/pin`,{
        method:'PUT',body:JSON.stringify({pinned:!selected.pinned})
      });
      const next={...selected,pinned:!selected.pinned};
      setViews(current=>current.map(view=>view.id===next.id?next:view));
      onSelect(next);
      dismissViewPopovers();
    }catch(failure){setError(failure instanceof Error?failure.message:'Unable to pin list view');}
  };
  const remove=async()=>{
    if(!selected||selected.visibility!=='private'||!window.confirm(`Delete “${selected.label}”?`))return;
    setError('');
    try{
      await apiRequest(`/records/${encodeURIComponent(objectApi)}/list-views/${encodeURIComponent(selected.id)}`,{method:'DELETE'});
      setViews(current=>current.filter(view=>view.id!==selected.id));
      setViewColumns(defaultColumns);
      setPhoneRoles({});onPhoneRolesChange(null);
      onColumnsChange(null);
      setFilters(legacyFilter?[{field:legacyFilter.fieldApiName??'',operator:legacyFilter.operator==='Includes'?'includes'
        :legacyFilter.operator==='Excludes'?'excludes':'eq',value:legacyFilter.value??''}]:[]);
      setFilterLogic('');
      onSelect(null);
      dismissViewPopovers();
    }catch(failure){setError(failure instanceof Error?failure.message:'Unable to delete list view');}
  };
  return <div className="records-list-view-picker" ref={popoverRootRef} aria-label="Saved list views">
    <label className="records-view-select"><span className="records-visually-hidden">Saved view</span>
    <select aria-label="Saved list view" value={selected?.id??''} onChange={event=>{
      const view=views.find(item=>item.id===event.target.value)??null;
      setScope(view?.scope??'all');setVisibility(view?.visibility??'private');
      setGroupIds(view?.groupIds??[]);setViewColumns(view?.columns??defaultColumns);onColumnsChange(view?.columns??null);
      setPhoneRoles(view?.phoneRoles??{});onPhoneRolesChange(view?.phoneRoles??null);
      setFilters(view?.filters.map(filter=>({...filter,value:Array.isArray(filter.value)?filter.value.join(', '):filter.value}))
        ??(legacyFilter?[{field:legacyFilter.fieldApiName??'',operator:legacyFilter.operator==='Includes'?'includes'
          :legacyFilter.operator==='Excludes'?'excludes':'eq',value:legacyFilter.value??''}]:[]));
      setFilterLogic(view?.filter_logic??'');onSelect(view);dismissViewPopovers();
    }}>
      <option value="">Default list</option>
      {views.map(view=><option key={view.id} value={view.id}>{view.pinned?'★ ':''}{view.label}</option>)}
    </select>
    </label>
    <div className="records-view-options">
      <details className="records-view-popover">
        <summary><Settings2 size={15}/>View settings</summary>
        <div className="records-view-popover-panel records-view-settings-panel">
    <select aria-label="Saved view record scope" value={scope} onChange={event=>setScope(event.target.value as SavedRecordListView['scope'])}>
      <option value="all">All accessible</option><option value="my">My records</option>
      <option value="my_team">My team</option><option value="queue">Queues</option>
    </select>
    <select aria-label="Saved view visibility" value={visibility} onChange={event=>{
      setVisibility(event.target.value as SavedRecordListView['visibility']);
      if(event.target.value!=='groups')setGroupIds([]);
    }}>
      <option value="private">Only me</option><option value="all">Everyone</option><option value="groups">Selected groups</option>
    </select>
    {visibility==='groups'&&<div className="records-view-checkbox-list" role="group" aria-label="Visible to groups">
      {groups.map(group=><label key={group.id}><input type="checkbox" checked={groupIds.includes(group.id)}
        onChange={()=>setGroupIds(current=>current.includes(group.id)
          ?current.filter(id=>id!==group.id):[...current,group.id])}/>{group.label}</label>)}
    </div>}
          <div className="records-view-menu-actions">
    <button type="button" className="btn btn-brand" onClick={()=>void save()}>Save view</button>
    {selected&&<button type="button" className="btn" onClick={()=>void save(true)}>Update view</button>}
    {selected&&<button type="button" className="btn" aria-label={selected.pinned?'Unpin view':'Pin view'} onClick={()=>void setPinned()}>
      {selected.pinned?'Unpin':'Pin'}
    </button>}
    {selected?.visibility==='private'&&<button type="button" className="btn" onClick={()=>void remove()}>Delete view</button>}
          </div>
        </div>
      </details>
      <details className="records-view-popover">
        <summary><SlidersHorizontal size={15}/>Columns <span className="records-tool-count">{viewColumns.length}</span></summary>
        <div className="records-view-popover-panel records-columns-panel">
          <div className="records-view-panel-heading"><strong>Visible columns</strong>
            <button type="button" className="text-action" onClick={()=>{setViewColumns(defaultColumns);onColumnsChange(null);}}>Reset</button>
          </div>
    <div className="records-view-checkbox-list" role="group" aria-label="View columns">
      {fields.map(field=><label key={field.apiName}><input type="checkbox" checked={viewColumns.includes(field.apiName)}
        onChange={()=>setViewColumns(current=>{
          const next=current.includes(field.apiName)
            ?current.filter(name=>name!==field.apiName):[...current,field.apiName];
          onColumnsChange(next);return next;
        })}/>{field.label}
        {viewColumns.includes(field.apiName) && <span className="records-column-order-controls">
          <button type="button" aria-label={`Move ${field.label} column earlier`} disabled={viewColumns.indexOf(field.apiName)===0}
            onClick={()=>setViewColumns(current=>{
              const index=current.indexOf(field.apiName);if(index<=0)return current;
              const next=[...current];[next[index-1],next[index]]=[next[index],next[index-1]];
              onColumnsChange(next);return next;
            })}>↑</button>
          <button type="button" aria-label={`Move ${field.label} column later`} disabled={viewColumns.indexOf(field.apiName)===viewColumns.length-1}
            onClick={()=>setViewColumns(current=>{
              const index=current.indexOf(field.apiName);if(index<0||index>=current.length-1)return current;
              const next=[...current];[next[index+1],next[index]]=[next[index],next[index+1]];
              onColumnsChange(next);return next;
            })}>↓</button>
        </span>}
      </label>)}
    </div>
        </div>
      </details>
      <details className="records-view-popover records-phone-column-editor">
        <summary><Smartphone size={15}/>Phone columns</summary>
        <div className="records-view-popover-panel records-columns-panel">
          <strong>Phone layout (up to four fields)</strong>
          <p className="records-view-hint">Choose title, subtitle, badge or trailing value. Hidden fields remain on desktop. Save or update the view to publish this layout.</p>
          <div className="records-phone-role-list" role="group" aria-label="Phone column roles">
            {viewColumns.map(apiName=>{
              const field=fields.find(item=>item.apiName===apiName);
              if(!field)return null;
              const value=phoneRoles[apiName]??'auto';
              return <label key={apiName}><span>{field.label}</span>
                <select aria-label={field.label+' phone role'} value={value} onChange={event=>{
                  const role=event.target.value as 'auto'|'title'|'subtitle'|'badge'|'trailing'|'hidden';
                  const next={...phoneRoles};
                  delete next[apiName];
                  if(role!=='auto'){
                    if(role!=='hidden')for(const key of Object.keys(next))if(next[key]===role)delete next[key];
                    next[apiName]=role;
                  }
                  setPhoneRoles(next);onPhoneRolesChange(next);
                }}>
                  <option value="auto">Automatic</option>
                  <option value="title">Title</option>
                  <option value="subtitle">Subtitle</option>
                  <option value="badge">Badge</option>
                  <option value="trailing">Trailing</option>
                  <option value="hidden">Hidden on phone</option>
                </select>
              </label>;
            })}
          </div>
        </div>
      </details>
      <details className="records-view-popover">
        <summary><Filter size={15}/>Filters {filters.length>0&&<span className="records-tool-count">{filters.length}</span>}</summary>
        <div className="records-view-popover-panel records-filters-panel">
          <strong>View filters</strong>
          <p className="records-view-hint">Save or update a view to apply filter changes.</p>
    <div className="records-filter-editor" role="group" aria-label="Filters">
      {filters.map((filter,index)=>{
        const field=filterableFields.find(candidate=>candidate.apiName===filter.field);
        const isDate=isRecordDateField(field);
        const useDatePicker=isDate && filter.operator!=='in';
        return <div key={index}>
        <select aria-label={`Filter ${index+1} field`} value={filter.field}
          onChange={event=>setFilters(current=>current.map((item,itemIndex)=>itemIndex===index
            ?{...item,field:event.target.value,operator:'eq',value:''}:item))}>
          <option value="">Select field</option>
          {filterableFields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
        </select>
        <select aria-label={`Filter ${index+1} operator`} value={filter.operator}
          onChange={event=>setFilters(current=>current.map((item,itemIndex)=>itemIndex===index
            ?{...item,operator:event.target.value}:item))}>
          {(isDate ? ['eq','ne','lt','lte','gt','gte','in']
            : ['eq','ne','lt','lte','gt','gte','contains','startsWith','includes','excludes','in']).map(operator=>
            <option key={operator} value={operator}>{recordFilterOperatorLabels[operator]}</option>)}
        </select>
        {useDatePicker ? <span className="records-filter-date-value">
          <select aria-label={`Filter ${index+1} date range`}
            value={filter.value.startsWith('@') ? filter.value : 'custom'}
            onChange={event=>setFilters(current=>current.map((item,itemIndex)=>itemIndex===index
              ?{...item,value:event.target.value==='custom'?'':event.target.value}:item))}>
            <option value="custom">Choose date…</option>
            {dateFilterPresets.map(preset=><option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </select>
          {!filter.value.startsWith('@') && <input type="date"
            aria-label={`Filter ${index+1} date`} value={filter.value.slice(0,10)}
            onChange={event=>setFilters(current=>current.map((item,itemIndex)=>itemIndex===index
              ?{...item,value:event.target.value}:item))}/>}
        </span> : <input aria-label={`Filter ${index+1} value`} value={filter.value}
          placeholder={filter.operator==='in'?'Comma-separated values':'Value'}
          onChange={event=>setFilters(current=>current.map((item,itemIndex)=>itemIndex===index
            ?{...item,value:event.target.value}:item))}/>}
        <button type="button" className="btn" aria-label={`Remove filter ${index+1}`}
          onClick={()=>{setFilters(current=>current.filter((_,itemIndex)=>itemIndex!==index));setFilterLogic('');}}>Remove</button>
      </div>;})}
      <button type="button" className="btn" disabled={filters.length>=20||filterableFields.length===0}
        onClick={()=>{setFilters(current=>[...current,{field:filterableFields[0].apiName,operator:'eq',value:''}]);setFilterLogic('');}}>
        Add filter
      </button>
      {filters.length>1&&<label>Filter logic
        <input aria-label="Filter logic" value={filterLogic}
          placeholder="1 AND (2 OR 3)" onChange={event=>setFilterLogic(event.target.value)}/>
      </label>}
    </div>
          <div className="records-view-menu-actions">
            <button className="btn btn-brand" type="button" onClick={()=>void save(Boolean(selected))}>
              {selected?'Save filters':'Save as new view'}
            </button>
          </div>
        </div>
      </details>
    </div>
    {error&&<span className="records-list-view-error" role="alert">{error}</span>}
  </div>;
}

function RecordWorkspace({
  route,
  objects,
  apps,
  pages,
  availableFlows,
  onLaunchFlow,
  reports,
  metadataLoaded,
  profileId,
  canManageUserIdentities,
  userRoles,
  fieldAccess,
  recordTypeAccess,
  libraryComponents,
  headerSearch,
  onSearchChange,
  navigableObjects,
  onNavigate
}: {
  route: Extract<AppRoute, { kind: 'record-list' | 'record-detail' }>;
  objects: ObjectMetadata[];
  apps: LightningAppMetadata[];
  pages: LightningPageMetadata[];
  availableFlows: Array<Pick<FlowDefinitionMetadata, 'id' | 'apiName' | 'label' | 'flowType' | 'status'>>;
  onLaunchFlow: (flowApiName: string, inputs?: Record<string, unknown>, context?:{requestId?:string}) => void;
  reports: ReportMetadata[];
  metadataLoaded: boolean;
  profileId: string;
  canManageUserIdentities: boolean;
  userRoles: Array<{id:string;name:string}>;
  fieldAccess: Record<string, { read: boolean; edit: boolean }>;
  recordTypeAccess: Record<string, boolean>;
  libraryComponents: LibraryComponentMetadata[];
  headerSearch: string;
  onSearchChange: (search: string) => void;
  navigableObjects: ObjectMetadata[];
  onNavigate: (route: AppRoute) => void;
}) {
  const object = objects.find((item) => item.apiName === route.objectApiName);
  const layoutDevice = usePageLayoutDevice();
  const [records, setRecords] = useState<RecordData[]>([]);
  const [record, setRecord] = useState<RecordData | null>(null);
  // Server-issued Object grants for page condition evaluation. Presentation
  // hints and Object action metadata cannot substitute for OneEngine RBAC.
  const [recordGrants,setRecordGrants]=useState<{
    objectApi:string;Create:boolean;Edit:boolean;Delete:boolean
  }|null>(null);
  const [overlayRecordId, setOverlayRecordId] = useState<string | null>(null);
  const [contextRecord,setContextRecord]=useState<{item:RecordData;x:number;y:number}|null>(null);
  const [listPaneWidth, setListPaneWidth] = useState<number | null>(null);
  const [columnWidths,setColumnWidths]=useState<Record<string,number>>({});
  const columnWidthsRef=useRef<Record<string,number>>({});
  const columnResize=useRef<{field:string;startX:number;startWidth:number}|null>(null);
  const splitResizeActive = useRef(false);
  const saveViewWidths=useCallback(async(splitWidthPx:number,widths:Record<string,number>)=>{
    if(!object?.apiName)return;
    try{
      await apiRequest(`/records/${encodeURIComponent(object.apiName)}/view-preferences`,{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({splitWidthPx:Math.max(320,Math.min(800,Math.round(splitWidthPx))),columnWidths:widths})
      });
    }catch{setListNotice('Could not save view widths. Your adjustments remain visible until refresh.');}
  },[object?.apiName]);
  useEffect(()=>{
    let active=true;
    setListPaneWidth(null);setColumnWidths({});columnWidthsRef.current={};
    if(route.kind!=='record-list'||!object?.apiName)return;
    void apiRequest<{splitWidthPx:number;columnWidths:Record<string,number>}>(`/records/${encodeURIComponent(object.apiName)}/view-preferences`)
      .then(result=>{
        if(!active)return;
        setListPaneWidth(result.splitWidthPx);
        setColumnWidths(result.columnWidths);
        columnWidthsRef.current=result.columnWidths;
      }).catch(()=>{}); // Existing Record API remains usable without optional layout preferences.
    return()=>{active=false};
  },[route.kind,object?.apiName]);
  const [swipedRowId,setSwipedRowId]=useState<string|null>(null);
  const touchRow=useRef<{id:string;x:number;y:number;timer:number|null;selected:boolean}|null>(null);
  useEffect(()=>()=>{if(touchRow.current?.timer!==null&&touchRow.current?.timer!==undefined)
    window.clearTimeout(touchRow.current.timer);},[]);
  const [duplicateMatches,setDuplicateMatches]=useState<Array<{ruleApi:string;recordId:string}>>([]);
  const [activeLightningPage, setActiveLightningPage] = useState<LightningPageMetadata | null>(null);
  const [activeEditLightningPage,setActiveEditLightningPage]=useState<LightningPageMetadata|null>(null);
  const [editPageLoading,setEditPageLoading]=useState(false);
  const [editPageError,setEditPageError]=useState('');
  const [editPageResolvedRecordId,setEditPageResolvedRecordId]=useState<string|null>(null);
  const [createPageResolvedTypeId,setCreatePageResolvedTypeId]=useState<string|null>(null);
  const [activeRuntimeTabs, setActiveRuntimeTabs] = useState<Record<string,string>>({});
  const [recordActivities, setRecordActivities] = useState<RecordActivity[]>([]);
  const [activityError, setActivityError] = useState('');
  const [activityKind, setActivityKind] = useState<RecordActivity['kind']>('Task');
  const [activitySubject, setActivitySubject] = useState('');
  const [activityDescription, setActivityDescription] = useState('');
  const [activityDueAt, setActivityDueAt] = useState('');
  const [activitySaving, setActivitySaving] = useState(false);
  const [chatterPosts, setChatterPosts] = useState<ChatterPost[]>([]);
  const [chatterError, setChatterError] = useState('');
  const [chatterDraft, setChatterDraft] = useState('');
  const [chatterSaving, setChatterSaving] = useState(false);
  const [chatterCommentDrafts, setChatterCommentDrafts] = useState<Record<string, string>>({});
  const formFactor = useRuntimeFormFactor();
  const viewportFactor = useFormFactor();
  const viewportWidth=useViewportWidth();
  const [recordInteractionOverrides,setRecordInteractionOverrides]=useState<Record<string,Record<string,unknown>>>({});
  const [recordPageState,setRecordPageState]=useState<Record<string,unknown>>({});
  const recordSessionKey=route.kind==='record-detail'?'record:'+route.objectApiName+':'+route.recordId:'';
  useEffect(()=>{
    setRecordInteractionOverrides({});setRecordPageState({});
    const sync=(event:Event)=>{
      const detail=(event as CustomEvent<{pageSessionKey:string;key:string;value:unknown}>).detail;
      if(detail?.pageSessionKey!==recordSessionKey||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(detail.key))return;
      setRecordPageState(previous=>({...previous,[detail.key]:detail.value}));
    };
    window.addEventListener('metadrive:page-local-state',sync);
    return()=>window.removeEventListener('metadrive:page-local-state',sync);
  },[recordSessionKey]);
  useEffect(()=>{
    if(!recordSessionKey||!activeLightningPage)return;
    const targets=activeLightningPage.components.map(item=>{
      const definition=item.type.startsWith('Custom:')
        ?libraryComponents.find(c=>c.apiName===item.type.slice('Custom:'.length)):undefined;
      return {id:item.id,propertyDefinitions:definition?.propertyDefinitions,
        componentVersion:definition?.version};
    });
    const onInteraction=(event:Event)=>{
      const detail=(event as CustomEvent<{pageSessionKey:string;componentId:string;event:string;value:unknown}>).detail;
      if(detail?.pageSessionKey!==recordSessionKey||typeof detail.componentId!=='string')return;
      const source=activeLightningPage.components.find(item=>item.id===detail.componentId);
      if(!source)return;
      const updates=behaviorInteractions(source.properties,detail.event,detail.value,recordPageState,targets,
        formFactor==='Phone'?'Mobile':formFactor,source.type.startsWith('Custom:')
          ?libraryComponents.find(c=>c.apiName===source.type.slice('Custom:'.length))?.eventDefinitions:undefined);
      if(updates.length)setRecordInteractionOverrides(previous=>{
        const next={...previous};
        for(const item of updates)next[item.targetComponentId]={...(next[item.targetComponentId]??{}),[item.targetProperty]:item.value};
        return next;
      });
    };
    window.addEventListener('metadrive:page-component-interaction',onInteraction);
    return()=>window.removeEventListener('metadrive:page-component-interaction',onInteraction);
  },[recordSessionKey,activeLightningPage,libraryComponents,formFactor,recordPageState]);
  const [selectedFieldSetApiName, setSelectedFieldSetApiName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const search = headerSearch;
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [listOffset, setListOffset] = useState(0);
  const listCursors=useRef<Record<number,string>>({});
  const phoneLoadMoreRef=useRef<HTMLDivElement|null>(null);
  const [listTotal, setListTotal] = useState(0);
  const [listSort, setListSort] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);
  const [activeListView,setActiveListView]=useState<SavedRecordListView|null>(null);
  const [previewListColumns,setPreviewListColumns]=useState<string[]|null>(null);
  const draggedListColumn=useRef<string|null>(null);
  const [previewPhoneRoles,setPreviewPhoneRoles]=useState<SavedRecordListView['phoneRoles']|null>(null);
  const [recordListLayout,setRecordListLayout]=useState<'table'|'cards'|'checklist'|'compact'>(()=>
    route.objectApiName==='Product'&&typeof window!=='undefined'&&window.innerWidth<=1200?'cards':'table');
  useEffect(()=>{setPreviewListColumns(null);setPreviewPhoneRoles(null);
    setRecordListLayout(route.objectApiName==='Product'&&viewportWidth<=1200?'cards':'table');
  },[route.objectApiName]);
  const listPageSize = 50;
  const [refreshKey, setRefreshKey] = useState(0);
  const [fieldHistory, setFieldHistory] = useState<Array<Record<string, unknown>>>([]);
  const [relatedRecords, setRelatedRecords] = useState<Record<string, { objectApiName: string; fieldApiName: string; records: RecordData[]; total: number }>>({});
  const [relatedError, setRelatedError] = useState('');
  const [relatedOffsets, setRelatedOffsets] = useState<Record<string, number>>({});
  const changeRelatedPage = (name: string, offset: number) =>
    setRelatedOffsets((current) => ({ ...current, [name]: Math.max(0, offset) }));
  const renderRelatedPagination = (name: string, total: number, loaded: number) => {
    const offset = relatedOffsets[name] ?? 0;
    const pageSize = object&&record
      ? pageLayoutForRecord(object,String(record.RecordTypeId??defaultRecordTypeId),profileId)
        ?.relatedListSettings?.[name]?.pageSize??50
      : 50;
    if (total === 0) return null;
    return <nav aria-label={`${name} pagination`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: 12 }}>
      <span>{loaded === 0 ? `0–0 of ${total}` : `${offset + 1}–${Math.min(offset + loaded, total)} of ${total}`}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="btn" disabled={offset === 0} onClick={() => changeRelatedPage(name, 0)}>First</button>
        <button className="btn" disabled={offset === 0} onClick={() => changeRelatedPage(name, offset - pageSize)}>Previous</button>
        <span>Page {Math.floor(offset / pageSize) + 1} of {Math.ceil(total / pageSize)}</span>
        <button className="btn" disabled={offset + pageSize >= total} onClick={() => changeRelatedPage(name, offset + pageSize)}>Next</button>
        <button className="btn" disabled={offset + pageSize >= total} onClick={() => changeRelatedPage(name, Math.floor((total - 1) / pageSize) * pageSize)}>Last</button>
      </div>
    </nav>;
  };
  const [componentAction,setComponentAction]=useState<{label:string;presentation:'Modal'|'Side Panel';
    definition:LibraryComponentMetadata;inputs:Record<string,unknown>}|null>(null);
  const launchActionComponent=async(endpoint:string,label:string)=>{
    const result=await apiRequest<{componentApiName:string;presentation:'Modal'|'Side Panel';
      inputs:Record<string,unknown>;definition?:LibraryComponentMetadata|null}>(endpoint);
    const definition=result.definition??libraryComponents.find(c=>
      c.apiName===result.componentApiName&&c.status!=='Draft');
    if(!definition)throw Error('Published Component is not loaded or available for this tenant');
    setComponentAction({label,presentation:result.presentation,definition,inputs:result.inputs});
  };
  const renderActionComponent=()=>componentAction?<React.Suspense fallback={<div role="status">Loading action…</div>}>
    <QuickActionComponentOverlay {...componentAction} onClose={()=>{
      setComponentAction(null);setRefreshKey(current=>current+1);
    }} onLaunchFlow={onLaunchFlow}/>
  </React.Suspense>:null;
  const [customActionPendingId, setCustomActionPendingId] = useState('');
  const [allowedActionIds,setAllowedActionIds] = useState<string[]>([]);
  const [customActionMessage, setCustomActionMessage] = useState('');
  const [emailAction,setEmailAction]=useState<ObjectActionMetadata|null>(null);
  const [emailDraft,setEmailDraft]=useState({to:'',subject:'',body:''});
  const [emailSaving,setEmailSaving]=useState(false);
  useEffect(()=>{
    let mounted=true;
    setAllowedActionIds([]);
    if(route.kind!=='record-detail'||!record||record.Id!==route.recordId||!object)return;
    void apiRequest<{actionIds:string[]}>(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}/actions`)
      .then(result=>{if(mounted)setAllowedActionIds(result.actionIds);})
      .catch(()=>{if(mounted)setAllowedActionIds([]);});
    return ()=>{mounted=false;};
  },[route.kind,route.kind==='record-detail'?route.recordId:'',object?.apiName,record?.Id,refreshKey]);
  useEffect(()=>{
    let active=true;
    setDuplicateMatches([]);
    if(route.kind!=='record-detail'||!record||!object
      ||record.Id!==route.recordId||object.apiName==='User')return;
    void apiRequest<{duplicates:Array<{ruleApi:string;recordId:string}>}>(
      `/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}/duplicates`)
      .then(result=>{if(active)setDuplicateMatches(result.duplicates);})
      .catch(()=>{if(active)setDuplicateMatches([]);});
    return ()=>{active=false};
  },[route.kind,route.kind==='record-detail'?route.recordId:'',object?.apiName,record?.Id,refreshKey]);
  // Reset nested workspace scroll when navigating to a different record.
  // Workspace route changes don't remount this component, so old scroll offsets survive.
  useEffect(() => {
    if (route.kind !== 'record-detail') return;
    const reset = () => {
      for (const selector of ['.workspace-records', '.workspace-content', '.setup-content', '.record-detail-overlay']) {
        document.querySelectorAll(selector).forEach(node => {
          if (node instanceof HTMLElement) node.scrollTop = 0;
        });
      }
      window.scrollTo(0, 0);
    };
    reset();
    requestAnimationFrame(reset);
  }, [route.kind, route.kind === 'record-detail' ? route.recordId : '']);
  const [formOpen, setFormOpen] = useState(false);
  // Switching from a scrolled record list to its editor must start at the top.
  // Otherwise the editor header remains hidden above the sticky workspace bar.
  useEffect(() => {
    if (!formOpen) return;
    const container = document.querySelector('.workspace-records');
    if (container instanceof HTMLElement) container.scrollTop = 0;
    window.scrollTo({top: 0, behavior: 'instant'});
  }, [formOpen]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTimestamp, setEditingTimestamp] = useState('');
  // Edit layouts are published metadata resolved for the current actor, app,
  // profile, record type and device; list-row edits use the same endpoint.
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const editLayoutKey=[editingId,String(formValues.RecordTypeId??''),profileId,
    object?.apiName??'',route.kind==='record-detail'||route.kind==='record-list'
      ?route.appId??'Records':'Records',formFactor,viewportFactor].join('|');
  useEffect(()=>{
    if(!formOpen||!editingId||!object)return;
    let active=true;
    setEditPageLoading(true);setEditPageError('');setActiveEditLightningPage(null);
    setEditPageResolvedRecordId(null);
    const params=new URLSearchParams({
      appId:route.kind==='record-detail'||route.kind==='record-list'?route.appId??'Records':'Records',
      formFactor:typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('pageLayout')==='Custom'
        ? 'Custom' : viewportFactor==='Tablet'?'Tablet':formFactor==='Phone'?'Mobile':'Desktop',
      editRecordTypeId:String(formValues.RecordTypeId??'')
    });
    void apiRequest<{editLightningPage?:LightningPageMetadata;recordPermissions?:{Create:boolean;Edit:boolean;Delete:boolean}}>(
      `/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(editingId)}?${params}`)
      .then(payload=>{if(active){setActiveEditLightningPage(payload.editLightningPage??null);
        setEditPageResolvedRecordId(editLayoutKey);
        if(payload.recordPermissions)setRecordGrants({objectApi:object.apiName,...payload.recordPermissions});}})
      .catch(error=>{if(active)setEditPageError(error instanceof Error?error.message:'Unable to resolve Record Edit Page');})
      .finally(()=>{if(active)setEditPageLoading(false);});
    return()=>{active=false;};
  },[formOpen,editingId,object?.apiName,formFactor,viewportFactor,route.kind,route.appId,profileId,formValues.RecordTypeId]);
  // Creation uses the published Edit-page field contract too, not the legacy
  // Object layout alone. Changes to RecordTypeId resolve the correct assignment.
  useEffect(()=>{
    if(!formOpen||editingId||!object)return;
    let active=true;
    setEditPageLoading(true);setEditPageError('');setActiveEditLightningPage(null);
    setCreatePageResolvedTypeId(null);
    const params=new URLSearchParams({
      appId:route.kind==='record-detail'||route.kind==='record-list'?route.appId??'Records':'Records',
      formFactor:typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('pageLayout')==='Custom'
        ?'Custom':viewportFactor==='Tablet'?'Tablet':formFactor==='Phone'?'Mobile':'Desktop',
      recordTypeId:String(formValues.RecordTypeId??object.recordTypes?.find(item=>item.active&&item.isDefault&&recordTypeAccess[`${object.apiName}.${item.id}`]!==false)?.id??object.recordTypes?.find(item=>item.active&&recordTypeAccess[`${object.apiName}.${item.id}`]!==false)?.id??'')
    });
    void apiRequest<{editLightningPage?:LightningPageMetadata;recordPermissions?:{Create:boolean;Edit:boolean;Delete:boolean}}>(
      `/records/${encodeURIComponent(object.apiName)}/create-layout?${params}`
    ).then(payload=>{if(active){setActiveEditLightningPage(payload.editLightningPage??null);
      setCreatePageResolvedTypeId([object.apiName,String(formValues.RecordTypeId??''),route.kind==='record-detail'||route.kind==='record-list'?route.appId??'Records':'Records',formFactor,viewportFactor,profileId].join('|'));
      if(payload.recordPermissions)setRecordGrants({objectApi:object.apiName,...payload.recordPermissions});}})
      .catch(error=>{if(active)setEditPageError(error instanceof Error?error.message:'Unable to resolve create form');})
      .finally(()=>{if(active)setEditPageLoading(false);});
    return()=>{active=false;};
  },[formOpen,editingId,object?.apiName,formFactor,viewportFactor,route.kind,route.appId,
    formValues.RecordTypeId,profileId]);

  const [lookupRecords, setLookupRecords] = useState<Record<string, RecordData[]>>({});
  const [lookupError, setLookupError] = useState('');
  const [reportingUsers, setReportingUsers] = useState<Array<{id:string;name:string;email:string}>>([]);
  const [reportingRootId, setReportingRootId] = useState<string|null>(null);
  useEffect(() => {
    if (!formOpen || object?.apiName !== 'User' || !canManageUserIdentities) return;
    let active = true;
    void apiRequest<{users:Array<{id:string;name:string;email:string}>;rootUserId:string|null}>(
      '/records/User/reporting-options').then(result => {
      if (!active) return;
      setReportingUsers(result.users);
      setReportingRootId(result.rootUserId);
      if (!editingId && result.rootUserId)
        setFormValues(current => ({...current, ReportsToId: current.ReportsToId ?? result.rootUserId}));
    }).catch(error => {
      if (active) setFormError(error instanceof Error ? error.message : 'Unable to load reporting users');
    });
    return () => {active = false;};
  }, [formOpen,object?.apiName,canManageUserIdentities,editingId]);
  const searchLookupRecords=useCallback(async(targetObject:string,term:string)=>{
    const params=new URLSearchParams({search:term,limit:'20',offset:'0'});
    const result=await apiRequest<{records:RecordData[]}>(`/records/${encodeURIComponent(targetObject)}?${params}`);
    return result.records;
  },[]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [massDeleting, setMassDeleting] = useState(false);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkFieldApiName, setBulkFieldApiName] = useState('');
  const [bulkFieldValue, setBulkFieldValue] = useState('');
  const [bulkFieldBoolean, setBulkFieldBoolean] = useState(false);
  const [bulkUpdateError, setBulkUpdateError] = useState('');
  const [ownerDialogRecord, setOwnerDialogRecord] = useState<RecordData | null>(null);
  const [ownerRecords, setOwnerRecords] = useState<RecordData[]>([]);
  const [ownerValue, setOwnerValue] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [bulkOwnerDialogOpen, setBulkOwnerDialogOpen] = useState(false);
  const [bulkOwnerValue, setBulkOwnerValue] = useState('');
  const [bulkOwnerError, setBulkOwnerError] = useState('');
  const [bulkOwnerSaving, setBulkOwnerSaving] = useState(false);
  const [importRows, setImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState('');
  const [importSaving, setImportSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const [listNotice, setListNotice] = useState('');
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [recycleBusy, setRecycleBusy] = useState(false);
  const [recycleError, setRecycleError] = useState('');
  const [recycleRows, setRecycleRows] = useState<Array<{Id:string;DeletedAt:string;DeletedBy:string}>>([]);
  const [recycleTotal, setRecycleTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState(15);
  const [automaticPurgeEnabled, setAutomaticPurgeEnabled] = useState(false);
  const [canConfigureRetention, setCanConfigureRetention] = useState(false);
  const [recycleOffset, setRecycleOffset] = useState(0);
  const loadRecycleBin = async (offset=0) => {
    if(!object || object.apiName==='User') return;
    setRecycleOpen(true);setRecycleBusy(true);setRecycleError('');
    try {
      const policy=await apiRequest<{retentionDays:number;automaticPurgeEnabled:boolean}>('/recycle-bin/retention');
      setRetentionDays(policy.retentionDays);setAutomaticPurgeEnabled(policy.automaticPurgeEnabled);
      setCanConfigureRetention(true);
    }catch{setCanConfigureRetention(false);}
    try {
      const data=await apiRequest<{records:Array<{Id:string;DeletedAt:string;DeletedBy:string}>;total:number}>(
        '/recycle-bin/records/'+encodeURIComponent(object.apiName)+'?limit=25&offset='+offset);
      setRecycleRows(data.records);setRecycleTotal(data.total);setRecycleOffset(offset);
    } catch(error){
      setRecycleError(error instanceof Error ? error.message : 'Unable to load Recycle Bin');
    } finally {setRecycleBusy(false);}
  };
  const restoreRecord = async (id:string) => {
    if(!object || !window.confirm('Restore this deleted record and its dependent detail records?'))return;
    setRecycleBusy(true);setRecycleError('');
    try {
      const recovered=await apiRequest<{restored:number;unresolvedLookupLinks:number}>('/recycle-bin/records/'+encodeURIComponent(object.apiName)+'/'+encodeURIComponent(id)+'/restore',
        {method:'POST'});
      await loadRecycleBin(recycleOffset);
      setRefreshKey(value=>value+1);
      setListNotice(recovered.unresolvedLookupLinks>0
        ? `Record restored. ${recovered.unresolvedLookupLinks} lookup link(s) require permission or field review.`
        : 'Record restored from the Recycle Bin.');
    } catch(error){
      setRecycleError(error instanceof Error ? error.message : 'Unable to restore record');
    } finally {setRecycleBusy(false);}
  };

  const saveRetention = async () => {
    if(!window.confirm('Update tenant-wide record retention? Automatic purge permanently deletes expired records, their activities, Chatter and completed approvals.'))return;
    setRecycleBusy(true);setRecycleError('');
    try {
      await apiRequest('/recycle-bin/retention',{method:'PUT',
        body:JSON.stringify({retentionDays,automaticPurgeEnabled})});
      setListNotice('Tenant record retention policy saved and audited.');
    }catch(error){setRecycleError(error instanceof Error?error.message:'Unable to update retention');}
    finally{setRecycleBusy(false);}
  };
  const permanentlyPurge = async (id:string) => {
    if(!object||!window.confirm('PERMANENTLY delete this expired record, its detail records and associated activities, Chatter and completed approvals? This cannot be undone.'))return;
    setRecycleBusy(true);setRecycleError('');
    try{
      await apiRequest('/recycle-bin/records/'+encodeURIComponent(object.apiName)+'/'+encodeURIComponent(id)+'/purge',
        {method:'DELETE'});
      await loadRecycleBin(recycleOffset);
      setListNotice('Expired record and its deletion group permanently purged.');
    }catch(error){setRecycleError(error instanceof Error?error.message:'Unable to purge record');}
    finally{setRecycleBusy(false);}
  };

  const [offlineOwner, setOfflineOwner] = useState<OfflineQueueOwner | null>(null);
  const [offlineItems, setOfflineItems] = useState<OfflineRecordItem[]>([]);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState('');
  const offlineSyncGuard = useRef(false);
  const reloadOfflineItems = useCallback(async (owner: OfflineQueueOwner) => {
    setOfflineItems(await listOfflineRecords(owner));
  }, []);
  // Require a freshly authenticated identity before displaying or synchronising
  // local data. Never take tenant/user IDs from the queued payload.
  useEffect(() => {
    let mounted = true;
    void apiRequest<{user:{id:string;tenantId:string}}>('/auth/me')
      .then(({user}) => {
        if (mounted && user.id && user.tenantId) setOfflineOwner({userId:user.id,tenantId:user.tenantId});
      }).catch(() => { /* Offline mode is available after this session was verified online. */ });
    return () => { mounted = false; };
  }, []);
  const syncPendingOfflineItems = useCallback(async (owner: OfflineQueueOwner) => {
    if (offlineSyncGuard.current || !navigator.onLine || !getAccessToken()) return;
    offlineSyncGuard.current = true;
    setOfflineSyncing(true);
    setOfflineMessage('');
    try {
      const counts = await synchronizeOfflineRecords(owner, async write => {
        try {
          await apiRequest<{record:RecordData}>(
            '/records/' + encodeURIComponent(write.objectApiName)
              + (write.recordId ? '/' + encodeURIComponent(write.recordId) : ''),
            {
              method: write.method,
              headers: {
                ...(write.originalModifiedAt ? {'If-Unmodified-Since':write.originalModifiedAt} : {}),
                'X-MetaDrive-Offline-Sync': '1'
              },
              body: JSON.stringify(write.values)
            }
          );
          return {outcome:'saved' as const};
        } catch (error) {
          // 401 means this client has no usable identity: stop, keep queued data.
          if (error instanceof ApiRequestError && error.status===401)
            return {outcome:'unavailable' as const};
          // Never automatically replay an ambiguous write after transport/5xx
          // failure: the first request may have committed on the server.
          const reason = error instanceof Error ? error.message : 'Synchronisation failed';
          if (error instanceof ApiRequestError && [400,403,404,409,412,422].includes(error.status))
            return {outcome:'rejected' as const,reason};
          return {outcome:'needs-review' as const,
            reason:'Save result could not be confirmed. Check the server before retrying. ' + reason};
        }
      });
      await reloadOfflineItems(owner);
      if (counts.saved) setRefreshKey(value=>value+1);
      if (counts.saved || counts.rejected || counts.review)
        setOfflineMessage(`${counts.saved} synced; ${counts.rejected} rejected; ${counts.review} need review.`);
    } catch (error) {
      setOfflineMessage(error instanceof Error ? error.message : 'Unable to read local offline data');
    } finally {
      offlineSyncGuard.current = false;
      setOfflineSyncing(false);
    }
  }, [reloadOfflineItems]);
  useEffect(() => {
    if (!offlineOwner) return;
    void reloadOfflineItems(offlineOwner).catch(error => {
      setOfflineMessage(error instanceof Error ? error.message : 'Offline queue unavailable');
    });
    const sync = () => { void syncPendingOfflineItems(offlineOwner); };
    window.addEventListener('online', sync);
    if (navigator.onLine) sync();
    return () => window.removeEventListener('online', sync);
  }, [offlineOwner, reloadOfflineItems, syncPendingOfflineItems]);
  const queueRecordLocally = async (
    values: Record<string, unknown>, status: OfflineRecordItem['status'], reason?: string
  ) => {
    if (!offlineOwner) throw Error('Offline identity has not been verified. Reconnect and sign in once before saving offline.');
    if (object?.apiName==='User') throw Error('User records cannot be saved offline.');
    await queueOfflineRecord(offlineOwner, {
      id:crypto.randomUUID(), objectApiName:object!.apiName, method:editingId?'PUT':'POST',
      ...(editingId ? {recordId:editingId} : {}),
      ...(editingTimestamp ? {originalModifiedAt:editingTimestamp} : {}),
      values, createdAt:new Date().toISOString()
    },status,reason);
    await reloadOfflineItems(offlineOwner);
    setFormOpen(false);
    setFormValues({});
    setEditingTimestamp('');
    setListNotice(status==='pending'
      ? 'Saved securely on this device. This is provisional until permissions are checked during sync.'
      : 'Outcome uncertain. Your local change was retained for review, not automatically retried.');
  };
  const renderOfflineQueue = () => (
    <section className="surface" aria-label="Offline record changes" style={{marginBlock:12,padding:12}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
        <strong>Offline changes ({offlineItems.length})</strong>
        <button type="button" className="btn" disabled={!offlineOwner || offlineSyncing || !navigator.onLine}
          onClick={() => { if(offlineOwner) void syncPendingOfflineItems(offlineOwner); }}>
          {offlineSyncing?'Syncing…':'Sync pending'}
        </button>
      </div>
      <small>Local changes are provisional; the server checks your current permissions before saving.</small>
      {offlineMessage && <p role="status">{offlineMessage}</p>}
      {offlineItems.map(item => <div key={item.id} style={{paddingBlock:8,borderTop:'1px solid var(--border-color, #ddd)'}}>
        <strong>{item.objectApiName} · {item.method==='POST'?'Create':'Edit'}</strong>
        <span> — {item.status==='pending'?'Pending sync':item.status==='rejected'?'Sync rejected':'Needs review'}</span>
        {item.reason && <p role="alert">{item.reason}</p>}
        {item.status!=='pending' && <button className="btn" type="button"
          onClick={() => { if(!offlineOwner) return;
            if(item.status==='needs-review' && !window.confirm('Confirm that this change was NOT saved on the server. Retrying an uncertain create can make a duplicate.'))return;
            void markOfflineRecord(offlineOwner,item.id,'pending').then(()=>syncPendingOfflineItems(offlineOwner))
              .catch(error=>setOfflineMessage(error instanceof Error?error.message:'Unable to retry'));
          }}>Retry after review</button>}
        <button className="btn" type="button" onClick={() => {
          if(!offlineOwner || !window.confirm('Discard this local change? It cannot be recovered.'))return;
          void removeOfflineRecord(offlineOwner,item.id).then(()=>reloadOfflineItems(offlineOwner))
            .catch(error=>setOfflineMessage(error instanceof Error?error.message:'Unable to discard'));
        }}>Discard locally</button>
      </div>)}
    </section>
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setListOffset(0);
    setSelectedRecordIds([]);
  }, [route.objectApiName, debouncedSearch]);
  useEffect(() => { setListSort(null); }, [route.objectApiName]);
  // Selection belongs to the visible authorised page, never an earlier
  // offset or sort order after a list navigation.
  useEffect(() => { setSelectedRecordIds([]); }, [listOffset, listSort?.field, listSort?.direction]);
  useEffect(() => {
    setSelectedFieldSetApiName(object?.fieldSets?.[0]?.apiName ?? '');
  }, [object?.apiName]);
  useEffect(() => {
    setSelectedRecordIds([]);
    setListNotice('');
  }, [object?.apiName]);
  useEffect(()=>{setActiveListView(null);setListOffset(0);},[object?.apiName]);
  useEffect(()=>{
    listCursors.current={};
  },[route.objectApiName,debouncedSearch,listSort?.field,listSort?.direction,activeListView?.id,refreshKey]);
  useEffect(() => {
    if(formFactor!=='Phone'||route.kind!=='record-list'||loading||error
      ||records.length===0||records.length>=listTotal||typeof IntersectionObserver==='undefined')return;
    const marker=phoneLoadMoreRef.current;
    if(!marker)return;
    const observer=new IntersectionObserver(entries=>{
      if(entries[0]?.isIntersecting)setListOffset(current=>current+listPageSize);
    },{rootMargin:'180px 0px'});
    observer.observe(marker);
    return ()=>observer.disconnect();
  },[formFactor,route.kind,loading,error,records.length,listTotal]);

  useEffect(() => {
    let active = true;
    const loadRecords = async () => {
      setLoading(true);
      setError('');
      if (route.kind === 'record-list') {
        // Append subsequent phone pages; other form factors retain their existing paging.
        if (formFactor !== 'Phone' || listOffset === 0) setRecords([]);
      }
      else {
        setRecord(null);
        setActiveLightningPage(null);
        setFieldHistory([]);
      }
      try {
        if (route.kind === 'record-list') {
          const params = new URLSearchParams({
            limit: String(listPageSize),
            offset: String(listOffset),
            ...(listCursors.current[listOffset]?{cursor:listCursors.current[listOffset]}:{}),
            ...(activeListView?{viewId:activeListView.id}:{}),
            ...(listSort ? { sortField: listSort.field, sortDirection: listSort.direction } : {}),
            ...(debouncedSearch ? { search: debouncedSearch } : {}),
            ...(object?.listViewFilter ? {
              filterField: object.listViewFilter.fieldApiName,
              filterValue: object.listViewFilter.value,
              ...(object.listViewFilter.operator ? { filterOperator: object.listViewFilter.operator } : {})
            } : {})
          });
          const payload = await apiRequest<{ records: RecordData[]; total: number; nextCursor?:string }>(
            `/records/${encodeURIComponent(route.objectApiName)}?${params.toString()}`);
          if (active) {
            setRecords(current => formFactor === 'Phone' && listOffset > 0
              ? [...current,...payload.records.filter(row=>!current.some(existing=>existing.Id===row.Id))]
              : payload.records);
            setListTotal(payload.total);
            if(payload.nextCursor)listCursors.current[listOffset+listPageSize]=payload.nextCursor;
          }
        } else {
          const recordQuery = new URLSearchParams({
            appId: route.appId ?? 'Records',
            viewportWidth:String(viewportWidth),
            formFactor: typeof window !== 'undefined'
              && new URLSearchParams(window.location.search).get('pageLayout') === 'Custom'
              ? 'Custom' : viewportFactor === 'Tablet' ? 'Tablet' : formFactor === 'Phone' ? 'Mobile' : 'Desktop'
          });
          const payload = await apiRequest<{ record: RecordData; lightningPage?: LightningPageMetadata; editLightningPage?:LightningPageMetadata;recordPermissions?:{Create:boolean;Edit:boolean;Delete:boolean} }>(
            `/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}?${recordQuery.toString()}`);
          const history = route.objectApiName === 'User'
            ? { history: [] as Array<Record<string, unknown>> }
            : await apiRequest<{ history: Array<Record<string, unknown>> }>(`/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/history`);
          if (active) {
            setRecord(payload.record);
            if(payload.recordPermissions)setRecordGrants({objectApi:route.objectApiName,...payload.recordPermissions});
            setActiveLightningPage(payload.lightningPage ?? null);
            setActiveEditLightningPage(payload.editLightningPage??null);
            setFieldHistory(history.history);
          }
        }
      } catch (failure) {
        if (active) {
          const detail=failure instanceof Error?failure.message:String(failure);
          setError(/SQL service unavailable|non-JSON|HTTP 50[0234]|database connection|ECONNRESET/i.test(detail)
            ?'Records are temporarily unavailable. Retry loading to restore the latest authorised data.'
            :detail||'Unable to load records');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadRecords();
    return () => { active = false; };
  }, [route.kind, route.objectApiName, route.kind === 'record-detail' ? route.recordId : '', route.kind === 'record-detail' ? route.appId : '', formFactor, viewportWidth, refreshKey, listOffset, debouncedSearch, listSort?.field, listSort?.direction,activeListView?.id]);
  useEffect(() => {
    if (route.kind !== 'record-detail' || !object || !record || record.Id !== route.recordId) {
      setRelatedRecords({});
      setRelatedError('');
      return;
    }
    let active = true;
    const recordTypeId = String(record.RecordTypeId ?? defaultRecordTypeId);
    const layout = pageLayoutForRecord(object, recordTypeId, profileId);
    const pageRelatedLists = (activeLightningPage?.components ?? []).flatMap((component) =>
      component.type === 'Related List' && Array.isArray(component.properties.relatedLists)
        ? component.properties.relatedLists.filter((name): name is string => typeof name === 'string')
        : []);
    const configuredLists = new Set([...(layout?.relatedLists ?? []), ...pageRelatedLists].map((name) => name.toLocaleLowerCase()));
    const relations = objects.flatMap((childObject) => childObject.fields.flatMap((field) => {
      if (field.relationship?.targetObject !== object.apiName) return [];
      const relationshipName = field.relationship.childRelationshipName;
      if (!configuredLists.has(relationshipName.toLocaleLowerCase()) && !configuredLists.has(childObject.pluralLabel.toLocaleLowerCase())) return [];
      return [{ childObject, fieldApiName: field.apiName, relationshipName }];
    }));
    setRelatedError('');
    setRelatedRecords({});
    const loadRelatedRecords = async () => {
      const results = await Promise.allSettled(relations.map(async ({ childObject, fieldApiName, relationshipName }) => {
          const pageConfig=(activeLightningPage?.components??[])
            .filter(component=>component.type==='Related List'
              &&Array.isArray(component.properties.relatedLists)
              &&component.properties.relatedLists.includes(relationshipName))
            .map(component=>(component.properties.relatedListSettings??{}) as Record<string,Record<string,unknown>>)
            .find(config=>config[relationshipName]);
          const settings={...(layout?.relatedListSettings?.[relationshipName]??{}),
            ...(pageConfig?.[relationshipName]??{})} as {
              pageSize?:number;sortField?:string;sortDirection?:'asc'|'desc';
              filterField?:string;filterValue?:string;filterOperator?:'Equals'|'Includes'|'Excludes';
            };
          const params = new URLSearchParams({
            limit: String(settings?.pageSize??50), offset: String(relatedOffsets[relationshipName] ?? 0),
            relatedField: fieldApiName, relatedId: record.Id,
            ...(settings?.sortField?{sortField:settings.sortField,
              sortDirection:settings.sortDirection??'asc'}:{}),
            ...(settings?.filterField&&settings.filterValue!==undefined
              ?{filterField:settings.filterField,filterValue:settings.filterValue,
                filterOperator:settings.filterOperator??'Equals'}:{})
          });
          const payload = await apiRequest<{ records: RecordData[]; total: number }>(
            `/records/${encodeURIComponent(childObject.apiName)}?${params.toString()}`);
          return [relationshipName, {
            objectApiName: childObject.apiName, fieldApiName, records: payload.records, total: payload.total
          }] as const;
      }));
      if (!active) return;
      const values = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const failures = results.flatMap((result) => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : 'Unable to load a related list']
        : []);
      setRelatedRecords(Object.fromEntries(values));
      setRelatedError(failures.length ? `Some related lists could not be loaded: ${failures.join('; ')}` : '');
    };
    void loadRelatedRecords();
    return () => { active = false; };
  }, [route.kind, route.objectApiName, route.kind === 'record-detail' ? route.recordId : '', object?.apiName, objects, record?.Id, record?.RecordTypeId, activeLightningPage, refreshKey, relatedOffsets]);
  useEffect(() => {
    const pageComponents = activeLightningPage?.components ?? [];
    const needsActivities = pageComponents.some((component) => component.visible && component.type === 'Activities');
    const needsChatter = pageComponents.some((component) => component.visible && component.type === 'Chatter');
    if (route.kind !== 'record-detail' || !record || record.Id !== route.recordId || (!needsActivities && !needsChatter)) {
      setRecordActivities([]);
      setChatterPosts([]);
      setActivityError('');
      setChatterError('');
      return;
    }
    let active = true;
    const loadInteractions = async () => {
      const [activitiesResult, chatterResult] = await Promise.allSettled([
        needsActivities
          ? apiRequest<{ activities: RecordActivity[] }>(`/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/activities`)
          : Promise.resolve({ activities: [] }),
        needsChatter
          ? apiRequest<{ posts: ChatterPost[] }>(`/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/chatter`)
          : Promise.resolve({ posts: [] })
      ]);
      if (!active) return;
      if (activitiesResult.status === 'fulfilled') {
        setRecordActivities(activitiesResult.value.activities);
        setActivityError('');
      } else {
        setRecordActivities([]);
        setActivityError(activitiesResult.reason instanceof Error ? activitiesResult.reason.message : 'Unable to load activities');
      }
      if (chatterResult.status === 'fulfilled') {
        setChatterPosts(chatterResult.value.posts);
        setChatterError('');
      } else {
        setChatterPosts([]);
        setChatterError(chatterResult.reason instanceof Error ? chatterResult.reason.message : 'Unable to load Chatter');
      }
    };
    void loadInteractions();
    return () => { active = false; };
  }, [route.kind, route.objectApiName, route.kind === 'record-detail' ? route.recordId : '', record?.Id, activeLightningPage, refreshKey]);
  useEffect(() => {
    if (!object) return;
    let active = true;
    const loadLookups = async () => {
      setLookupError('');
      try {
        const relationships = [...new Set(object.fields.flatMap((field) => field.relationship ? [field.relationship.targetObject] : []))];
        const results = await Promise.allSettled(relationships.map(async (targetObject) => {
          const payload = await apiRequest<{ records: RecordData[] }>(
            `/records/${encodeURIComponent(targetObject)}?limit=50&offset=0`);
          return [targetObject, payload.records] as const;
        }));
        const pairs = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        const failures = results.flatMap((result) => result.status === 'rejected'
          ? [result.reason instanceof Error ? result.reason.message : 'Unable to load a lookup target']
          : []);
        if (active) {
          setLookupRecords(Object.fromEntries(pairs));
          // The signed-in tenant is the only available User.Tenant reference.
          // Display its real SQL ID, while the identity API still enforces scope.
          if(object.apiName==='User'&&formOpen){
            const tenantId=pairs.find(([api])=>api==='Tenant')?.[1]?.[0]?.Id;
            if(tenantId)setFormValues(current=>({...current,Tenant:current.Tenant??tenantId}));
          }
          const message = failures.join('; ');
          setLookupError(message);
          if (formOpen) setFormError(message);
        }
      } catch (failure) {
        if (active) {
          const message = failure instanceof Error ? failure.message : 'Unable to load lookup records';
          setLookupError(message);
          if (formOpen) setFormError(message);
        }
      }
    };
    void loadLookups();
    return () => { active = false; };
  }, [formOpen, object?.apiName]);
  useEffect(() => {
    if (!ownerDialogRecord && !bulkOwnerDialogOpen) return;
    let active = true;
    const loadOwners = async () => {
      setOwnerError('');
      try {
        const payload = await apiRequest<{ records: RecordData[] }>('/records/User');
        if (active) setOwnerRecords(payload.records);
      } catch (failure) {
        if (active) setOwnerError(failure instanceof Error ? failure.message : 'Unable to load users');
      }
    };
    void loadOwners();
    return () => { active = false; };
  }, [ownerDialogRecord?.Id, bulkOwnerDialogOpen]);
  const navigateLink = (event: React.MouseEvent<HTMLAnchorElement>, nextRoute: AppRoute) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(nextRoute);
  };
  const openList = () => onNavigate({ kind: 'record-list', objectApiName: route.objectApiName });
  const formatFieldValue = (field: FieldMetadata, value: unknown) => {
    if(field.formula&&value&&typeof value==='object'&&!Array.isArray(value)
      &&(value as {__formulaImage?:unknown}).__formulaImage==='MetaDriveFormulaImage')
      return <FormulaImageContent value={value as {
        __formulaImage:'MetaDriveFormulaImage';url:string;alt:string;height:number|null;width:number|null
      }}/>;
    if(field.dataType==='Rich Text Area'&&typeof value==='string'&&value)
      return <RichTextContent html={value}/>;
    if (typeof value === 'string' && ['URL','Text','Long Text Area'].includes(field.dataType) && /^https:\/\//i.test(value) && /(?:image|photo|thumbnail|picture)/i.test(field.apiName+' '+field.label) && /\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)|images\.unsplash\.com\//i.test(value)) return <img className="record-image-thumbnail" src={value} alt={field.label} loading="lazy" referrerPolicy="no-referrer" />; if (field.relationship && typeof value === 'string') {
      const related = lookupRecords[field.relationship.targetObject]?.find((item) => item.Id === value);
      if (related) return String(related.Name ?? related.Email ?? value);
    }
    if (field.dataType === 'Date/Time' && typeof value === 'string' && value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        // Persist timestamps in UTC; display using the viewer's actual local clock,
        // including daylight-saving transitions.
        if(object?.apiName==='Communication'){
          const parts=new Intl.DateTimeFormat('en-US',{
            day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',
            minute:'2-digit',second:'2-digit',hour12:true,
            timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone
          }).formatToParts(date);
          const value=(type:string)=>parts.find(part=>part.type===type)?.value??'';
          return `${value('day')}-${value('month')}-${value('year')} ${value('hour')}:${value('minute')}:${value('second')} ${value('dayPeriod').toUpperCase()}`;
        }
        return new Intl.DateTimeFormat(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }).format(date);
      }
    }
    return formatRecordValue(value);
  };
  const activeRecordTypes = object?.recordTypes?.filter((item) =>
    item.active && recordTypeAccess[`${object.apiName}.${item.id}`] !== false
  ) ?? [];
  const defaultRecordTypeId = activeRecordTypes.find((item) => item.isDefault)?.id ?? activeRecordTypes[0]?.id ?? '';
  const selectedRecordTypeId = String(formValues.RecordTypeId ?? defaultRecordTypeId);
  const sourceLayout = object ? pageLayoutForRecord(object, selectedRecordTypeId, profileId) : undefined;
  // Preserve authored components until the layout resolver evaluates their
  // conditions. Pre-filtering would erase evidence of intentionally hidden
  // Dynamic Forms sections and could reintroduce legacy fallback fields.
  const visibleEditPage=activeEditLightningPage;
  // Use the same action availability source for conditional form visibility.
  // Backend Record API permissions remain authoritative for every mutation.
  const formRecordPermissions=new Set<'Create'|'Edit'|'Delete'>(
    (['Create','Edit','Delete'] as const).filter(key=>
      recordGrants!=null&&recordGrants.objectApi===object?.apiName&&recordGrants[key]===true)
  );
  const authoredDynamicFields=Boolean(visibleEditPage?.status==='Active'
    &&visibleEditPage.pageType==='Record Page'&&visibleEditPage.recordMode==='Edit'
    &&visibleEditPage.components.some(component=>
      component.type==='Record Field'||component.type==='Field Section'));
  const selectedLayout = recordEditPageLayout(visibleEditPage,sourceLayout,{
    formFactor,record:formValues,fields:object?.fields??[],profileId,
    recordPermissions:formRecordPermissions,
    readableFieldApiNames:new Set(object?.fields.filter(field=>fieldAccess[`${object.apiName}.${field.apiName}`]?.read)
      .map(field=>field.apiName)??[])
  });
  // Standard CRUD is universal: missing layout buttons must not silently disable
  // record operations. Explicitly disabled metadata actions still opt out.
  // The shared Record API remains the mandatory tenant/RBAC/FLS enforcement point.
  // Identity creation additionally requires the existing Security management gate.
  const identityAllowed = object?.apiName !== 'User' || canManageUserIdentities;
  const actionEnabled = (label: string) => object?.actions?.find(action => action.label === label)?.enabled !== false;
  const canCreate = Boolean(object && identityAllowed && actionEnabled('New'));
  const canShowListNew=canCreate && (object?.listViewButtons?.includes('New')??true);
  const canEdit = Boolean(object && identityAllowed && actionEnabled('Edit'));
  const canDelete = Boolean(object && identityAllowed && actionEnabled('Delete'));
  const canMassDelete = false;
  const deleteListRecord = async (item: RecordData) => {
    if (!object || !canDelete || !window.confirm(`Delete ${String(item.Name ?? item.Id)}? The record may be recoverable from the Recycle Bin.`)) return;
    try {
      await apiRequest<void>(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(item.Id)}`, { method: 'DELETE', ...(typeof item.LastModifiedDate === 'string' ? { headers: { 'If-Unmodified-Since': item.LastModifiedDate } } : {}) });
      setListNotice('Record deleted.');
      setRefreshKey(current => current + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to delete record');
    }
  };
  const bulkEditableFields = (object?.fields ?? []).filter((field) =>
    fieldAccess[`${object?.apiName}.${field.apiName}`]?.edit === true
    && !field.relationship && !field.formula
    && !['Id', 'RecordTypeId', 'OwnerId', 'CreatedById', 'LastModifiedById', 'CreatedDate',
      'LastModifiedDate', 'SystemModstamp', 'IsDeleted'].includes(field.apiName)
    && /^(?:Text(?:\(|$)|Text Area|Long Text Area|Email|Phone|URL|Picklist|Number(?:\(|$)|Currency(?:\(|$)|Percent(?:\(|$)|Checkbox|Boolean|Date(?:\/Time)?$|DateTime$)/i.test(field.dataType)
  );
  const canBulkUpdate = false;
  const bulkSelectedField = bulkEditableFields.find((field) => field.apiName === bulkFieldApiName);
  const ownerField = object?.fields.find((field) => field.apiName === 'OwnerId' && field.relationship?.targetObject === 'User');
  const canChangeOwner = Boolean(ownerField && canEdit && fieldAccess[`${object?.apiName}.OwnerId`]?.edit && object?.listViewButtons?.includes('Change Owner'));
  const canImport = Boolean(object && identityAllowed && canCreate && object.listViewButtons?.includes('Import'));
  const openCreateForm = useCallback(() => {
    setEditingId(null);
    setEditingTimestamp('');
    setFormValues(object?.apiName === 'User' ? { RecordTypeId: defaultRecordTypeId, IsActive: true, UserRoleId: '', Tenant: lookupRecords.Tenant?.[0]?.Id, LandingApp: 'Setup' } : { RecordTypeId: defaultRecordTypeId });
    setFormError('');
    setFormOpen(true);
  },[object?.apiName,defaultRecordTypeId,lookupRecords.Tenant?.[0]?.Id]);
  useEffect(()=>{
    if(route.kind!=='record-list'||!canCreate)return;
    const requestNew=()=>openCreateForm();
    window.addEventListener('metadrive:new-record',requestNew);
    return()=>window.removeEventListener('metadrive:new-record',requestNew);
  },[route.kind,canCreate,openCreateForm]);
  const handledRelatedCreation=useRef('');
  useEffect(()=>{
    if(route.kind!=='record-list'||(!route.relatedCreation&&!route.globalCreation)||!object){
      handledRelatedCreation.current='';return;
    }
    const ctx=route.relatedCreation;
    const key=ctx?[object.apiName,ctx.sourceObjectApi,ctx.sourceRecordId,ctx.actionId].join(':')
      :[object.apiName,'global',route.globalCreation?.actionId].join(':');
    if(handledRelatedCreation.current===key)return;
    handledRelatedCreation.current=key;
    setEditingId(null);setEditingTimestamp('');
    setFormValues({RecordTypeId:defaultRecordTypeId});
    setFormError('');setFormOpen(true);
  },[route.kind,route.kind==='record-list'?route.relatedCreation?.actionId:'',
    route.kind==='record-list'?route.relatedCreation?.sourceRecordId:'',
    route.kind==='record-list'?route.globalCreation?.actionId:'',object?.apiName,defaultRecordTypeId]);

  const openEditForm = (item: RecordData) => {
    if (!object || !canEdit) return;
    const editableFieldNames = new Set(object.fields.map((field) => field.apiName));
    const editableValues = Object.fromEntries(Object.entries(item).filter(([apiName]) =>
      editableFieldNames.has(apiName) || apiName === 'RecordTypeId' || object.apiName === 'User' && ['LandingApp','ReportsToId'].includes(apiName)));
    setEditingId(item.Id);
    setEditingTimestamp(typeof item.LastModifiedDate === 'string' ? item.LastModifiedDate : '');
    setFormValues(editableValues);
    setFormError('');
    setFormOpen(true);
  };
  const openChangeOwner = (item: RecordData) => {
    setOwnerDialogRecord(item);
    setOwnerValue(String(item.OwnerId ?? ''));
    setOwnerError('');
  };
  const saveRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!object) return;
    // A successful form layout lookup carries the current OneEngine object
    // grant. Do not submit with a stale grant or after the operation was revoked.
    const permission:'Edit'|'Create'=editingId?'Edit':'Create';
    if(recordGrants?.objectApi!==object.apiName||recordGrants[permission]!==true){
      setFormError('You do not have permission to save this record.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const path = `/records/${encodeURIComponent(object.apiName)}${editingId ? `/${encodeURIComponent(editingId)}` : ''}`;
      const writableValues = Object.fromEntries(Object.entries(formValues).filter(([apiName]) =>
        apiName !== 'OwnerId' && !(editingId
          && object.fields.some((field) => field.apiName === apiName
            && field.dataType === 'Text (Encrypted)')
          && formValues[apiName] === '********') && (object.apiName === 'User'
          ? ['Name', 'Email', 'Username', 'IsActive', 'Password', 'Tenant', 'LandingApp', 'ReportsToId'].includes(apiName)
            && (fieldAccess[`${object.apiName}.${apiName}`]?.edit !== false)
          : (apiName === 'RecordTypeId' || fieldAccess[`${object.apiName}.${apiName}`]?.edit))
      ));
      const effectiveValues=editingId?writableValues:applyRequiredLayoutDefaults(writableValues,selectedLayout,
        object.fields,new Set(object.fields.filter(field=>
          fieldAccess[`${object.apiName}.${field.apiName}`]?.edit===true).map(field=>field.apiName)));
      Object.assign(writableValues,effectiveValues);
      const layoutWritable=filterLayoutWritableValues(writableValues,selectedLayout,
        new Set(object.fields.filter(field=>field.required).map(field=>field.apiName)),
        authoredDynamicFields);
      Object.keys(writableValues).forEach(name=>{if(!(name in layoutWritable))delete writableValues[name];});
      const missingLayoutFields=missingLayoutRequiredFields(writableValues,selectedLayout,
        new Set(object.fields.filter(field=>
          fieldAccess[`${object.apiName}.${field.apiName}`]?.edit===true)
          .map(field=>field.apiName)));
      if(missingLayoutFields.length){
        throw new Error('Complete required fields: '+missingLayoutFields.map(name=>
          object.fields.find(field=>field.apiName===name)?.label??name).join(', '));
      }
      // A record without an assigned type must not submit an empty type ID:
      // the generic API treats an explicitly supplied ID as an assignment request.
      if (writableValues.RecordTypeId == null || writableValues.RecordTypeId === '') delete writableValues.RecordTypeId;
      if (object.apiName === 'User') {
        if (!editingId) {
          if (typeof formValues.Password !== 'string' || formValues.Password.length < 12) throw new Error('Set an initial password of at least 12 characters.');
          writableValues.Password = formValues.Password;
        }
        // The identity API accepts only these explicit fields. No arbitrary metadata fields or password edits.
        const allowed = new Set(['Name', 'Email', 'Username', 'IsActive', 'Password', 'Tenant', 'LandingApp', 'ReportsToId']);
        Object.keys(writableValues).forEach((name) => { if (!allowed.has(name)) delete writableValues[name]; });
      }
      const relatedCreation=route.kind==='record-list'&&!editingId?route.relatedCreation:undefined;
      const globalCreation=route.kind==='record-list'&&!editingId?route.globalCreation:undefined;
      if (!navigator.onLine) {
        if(relatedCreation||globalCreation)throw new Error('Creating related records requires an active connection for relationship and Action permission checks.');
        await queueRecordLocally(writableValues, 'pending');
        return;
      }
      let response: {record: RecordData};
      try {
        if(relatedCreation){
          const saved=await apiRequest<{recordId:string;objectApiName:string}>(`/records/${encodeURIComponent(relatedCreation.sourceObjectApi)}/${encodeURIComponent(relatedCreation.sourceRecordId)}/actions/${encodeURIComponent(relatedCreation.actionId)}/execute`,{
            method:'POST',body:JSON.stringify(writableValues)});
          response={record:{Id:saved.recordId} as RecordData};
        }else if(globalCreation){
          const saved=await apiRequest<{recordId:string;objectApiName:string}>(
            `/actions/global/${encodeURIComponent(globalCreation.actionId)}/execute`,{
              method:'POST',body:JSON.stringify(writableValues)});
          if(saved.objectApiName!==object.apiName)throw new Error('Global action target changed; reload');
          response={record:{Id:saved.recordId} as RecordData};
        } else response=await apiRequest<{ record: RecordData }>(path, {
          method: editingId ? 'PUT' : 'POST',
          ...(editingId && editingTimestamp ? { headers: { 'If-Unmodified-Since': editingTimestamp } } : {}),
          body: JSON.stringify(writableValues)
        });
      } catch (failure) {
        if (failure instanceof TypeError) {
          await queueRecordLocally(writableValues,'needs-review',
            'No server response was received. Confirm whether the change saved before retrying.');
          return;
        }
        throw failure;
      }
      setFormOpen(false);
      setFormValues({});
      setEditingTimestamp('');
      if (editingId) setRefreshKey((current) => current + 1);
      else onNavigate({ kind: 'record-detail', objectApiName: object.apiName, recordId: response.record.Id });
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Unable to save record');
    } finally {
      setSaving(false);
    }
  };
  const runCustomObjectAction = async (action: ObjectActionMetadata) => {
    if(!object||!record||!action.behavior)return;
    // Re-resolve against current Object metadata; never dispatch a stale,
    // disabled, or removed action even if an old button callback still exists.
    const currentAction=object.actions?.find(item=>item.id===action.id
      &&item.enabled!==false&&item.type==='Custom');
    if(!currentAction){
      setCustomActionMessage('This action is no longer available.');
      return;
    }
    // Execute the current action definition, not the stale callback snapshot.
    action=currentAction;
    if((currentAction.behavior==='Set Field Value'||currentAction.behavior==='Log Call')
      &&(recordGrants?.objectApi!==object.apiName||!recordGrants.Edit
        ||(currentAction.behavior==='Set Field Value'&&
          (!currentAction.fieldApiName||
            fieldAccess[`${object.apiName}.${currentAction.fieldApiName}`]?.edit!==true)))){
      setCustomActionMessage('Edit permission is required for this action.');
      return;
    }
    // UI state is never a grant, but programmatic action invocation must still
    // obey the same published conditional state as its Header/Publisher buttons.
    const actionsBlock=activeLightningPage?.components.find(component=>
      component.type==='Record Actions'&&component.visible!==false);
    const actionLayout=recordPagePresentationLayout(activeLightningPage,
      pageLayoutForRecord(object,String(record.RecordTypeId??defaultRecordTypeId),profileId));
    const actionState=behaviorRecordAction(actionsBlock?.properties??{},action.id,{
      formFactor,record,profileId,fields:object.fields,
      readableFieldApiNames:new Set(object.fields.filter(field=>
        fieldAccess[`${object.apiName}.${field.apiName}`]?.read).map(field=>field.apiName)),
      recordPermissions:new Set<'Create'|'Edit'|'Delete'>(
        (['Create','Edit','Delete'] as const).filter(key=>
          recordGrants?.objectApi===object.apiName&&recordGrants[key]===true))
    },actionLayout?.actionVisibility?.[action.id]);
    if(actionState!=='enabled'||(actionsBlock&&actionLayout&&!actionLayout.actions.includes(action.id))){
      setCustomActionMessage('This action is unavailable for the current record.');
      return;
    }
    if(action.behavior==='Send Email'){
      setEmailAction(action);
      setEmailDraft({to:'',subject:'',body:''});
      setCustomActionMessage('');
      return;
    }
    if(action.behavior==='Create Related'){
      if(!action.targetObjectApi||!action.relationshipFieldApi)return;
      onNavigate({kind:'record-list',objectApiName:action.targetObjectApi,
        appId:route.kind==='record-detail'?route.appId:undefined,
        relatedCreation:{sourceObjectApi:object.apiName,sourceRecordId:record.Id,actionId:action.id}});
      return;
    }
    setCustomActionPendingId(action.id);
    setCustomActionMessage('');
    try {
      if(action.behavior==='Open Component'){
        await launchActionComponent(
          `/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}/actions/${encodeURIComponent(action.id)}/component-launch`,
          action.label);
        return;
      }
      if(action.behavior==='Run Flow'){
        const launch=await apiRequest<{flowApiName:string;inputs:Record<string,unknown>}>(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}/actions/${encodeURIComponent(action.id)}/flow-launch`);
        onLaunchFlow(launch.flowApiName,launch.inputs);
        return;
      }
      const payload=action.behavior==='Log Call'
        ?{subject:action.value?.trim()||action.label}:{}; 
      await apiRequest<{status:string}>(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}/actions/${encodeURIComponent(action.id)}/execute`,{
        method:'POST',body:JSON.stringify(payload)
      });
      setCustomActionMessage(`${action.label} completed.`);
      setRefreshKey(current=>current+1);
    } catch (failure) {
      setCustomActionMessage(failure instanceof Error ? failure.message : `Unable to run ${action.label}`);
    } finally {
      setCustomActionPendingId('');
    }
  };
  const deleteCurrentRecord = async () => {
    if (!object) return;
    if (route.kind !== 'record-detail' || !record || !window.confirm(object.apiName === 'User' ? `Deactivate ${String(record.Name ?? record.Id)} and revoke their sessions? Identity and audit records are retained.` : `Delete ${String(record.Name ?? record.Id)}? This cannot be undone.`)) return;
    setError('');
    try {
      await apiRequest<void>(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}`, {
        method: 'DELETE',
        ...(typeof record.LastModifiedDate === 'string' ? { headers: { 'If-Unmodified-Since': record.LastModifiedDate } } : {})
      });
      openList();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to delete record');
    }
  };
  // Clone opens the same published create form instead of immediately creating
  // a record. The actor may edit the copy before the normal Record API validates it.
  const cloneCurrentRecord=async()=>{
    if(!object||!record||object.apiName==='User'||!canCreate)return;
    const writable=new Set(object.fields.filter(field=>
      fieldAccess[`${object.apiName}.${field.apiName}`]?.read &&
      fieldAccess[`${object.apiName}.${field.apiName}`]?.edit &&
      !field.formula && field.dataType !== 'Text (Encrypted)' &&
      !field.dataType.toLowerCase().startsWith('auto number')
    ).map(field=>field.apiName));
    const excluded=new Set(['Id','OwnerId','CreatedById','LastModifiedById',
      'CreatedDate','LastModifiedDate','SystemModstamp','IsDeleted']);
    const values=Object.fromEntries(Object.entries(record).filter(([name])=>
      writable.has(name)&&!excluded.has(name)));
    if(typeof record.RecordTypeId==='string')values.RecordTypeId=record.RecordTypeId;
    setEditingId(null);
    setEditingTimestamp('');
    setFormValues(values);
    setFormError('');
    setFormOpen(true);
  };
  const deleteSelectedRecords = async () => {
    if (!object) return;
    const ids = selectedRecordIds.filter((id) => {
      const item = records.find((candidate) => candidate.Id === id);
      if (!item) return false;
      const recordTypeId = String(item.RecordTypeId ?? defaultRecordTypeId);
      const recordLayout = pageLayoutForRecord(object, recordTypeId, profileId);
      return canMassDelete && (!recordLayout || recordLayout.actions.includes('Delete'));
    });
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected record${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setMassDeleting(true);
    setError('');
    try {
      const results = await Promise.allSettled(ids.map((id) =>
        apiRequest<void>(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      ));
      const failedIds = results.flatMap((result, index) => result.status === 'rejected' ? [ids[index]] : []);
      const deletedCount = results.length - failedIds.length;
      setSelectedRecordIds(failedIds);
      if (failedIds.length) setError(`${deletedCount} record${deletedCount === 1 ? '' : 's'} deleted; ${failedIds.length} could not be deleted: ${results.filter((result) => result.status === 'rejected').map((result) => result.reason instanceof Error ? result.reason.message : 'Unknown error').join('; ')}`);
      setRefreshKey((current) => current + 1);
    } finally {
      setMassDeleting(false);
    }
  };
  const updateSelectedRecords = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!object || !canBulkUpdate || !bulkSelectedField) return;
    const items = selectedRecordIds.flatMap((id) => {
      const item = records.find((candidate) => candidate.Id === id);
      if (!item) return [];
      const layout = pageLayoutForRecord(object, String(item.RecordTypeId ?? defaultRecordTypeId), profileId);
      return !layout || layout.actions.includes('Edit') ? [item] : [];
    });
    if (!items.length) return;
    let value: string | number | boolean = bulkFieldValue;
    const kind = bulkSelectedField.dataType;
    if (/^(?:Number|Currency|Percent)(?:\(|$)/i.test(kind)) {
      if (!bulkFieldValue.trim() || !Number.isFinite(Number(bulkFieldValue))) {
        setBulkUpdateError('Enter a valid numeric value.');
        return;
      }
      value = Number(bulkFieldValue);
    } else if (/^(?:Checkbox|Boolean)$/i.test(kind)) value = bulkFieldBoolean;
    else if (/^(?:Date\/Time|DateTime)$/i.test(kind)) {
      const timestamp = new Date(bulkFieldValue);
      if (!Number.isFinite(timestamp.getTime())) {
        setBulkUpdateError('Enter a valid date and time.');
        return;
      }
      value = timestamp.toISOString();
    }
    setBulkUpdating(true);
    setBulkUpdateError('');
    const failed: string[] = [];
    const failures: string[] = [];
    // Preserve the platform's durable SQL revision ordering. A bounded,
    // sequential update avoids concurrent writes against one tenant snapshot.
    for (const item of items) {
      try {
        await apiRequest(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(item.Id)}`, {
          method: 'PUT',
          ...(typeof item.LastModifiedDate === 'string' ? {
            headers: { 'If-Unmodified-Since': item.LastModifiedDate }
          } : {}),
          body: JSON.stringify({ [bulkSelectedField.apiName]: value })
        });
      } catch (error) {
        failed.push(item.Id);
        failures.push(error instanceof Error ? error.message : 'Record update rejected');
      }
    }
    setBulkUpdating(false);
    setSelectedRecordIds(failed);
    setRefreshKey((current) => current + 1);
    const updated = items.length - failed.length;
    setListNotice(`${updated} of ${items.length} selected record${items.length === 1 ? '' : 's'} updated.`);
    if (failed.length) setBulkUpdateError(`${failed.length} update(s) rejected: ${failures.join('; ')}`);
    else { setBulkUpdateOpen(false); setBulkFieldValue(''); setBulkFieldApiName(''); }
  };
  const saveBulkRecordOwner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!object || !canChangeOwner || !bulkOwnerValue) return;
    const items = selectedRecordIds.flatMap((id) => {
      const item = records.find((candidate) => candidate.Id === id);
      if (!item) return [];
      const layout = pageLayoutForRecord(object, String(item.RecordTypeId ?? defaultRecordTypeId), profileId);
      return !layout || layout.actions.includes('Edit') ? [item] : [];
    });
    setBulkOwnerSaving(true); setBulkOwnerError('');
    const failed: string[] = [], messages: string[] = [];
    for (const item of items) {
      try {
        await apiRequest(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(item.Id)}/owner`, {
          method: 'PUT',
          ...(typeof item.LastModifiedDate === 'string' ? {
            headers: { 'If-Unmodified-Since': item.LastModifiedDate }
          } : {}),
          body: JSON.stringify({ ownerId: bulkOwnerValue })
        });
      } catch (reason) {
        failed.push(item.Id);
        messages.push(reason instanceof Error ? reason.message : 'Owner change was rejected');
      }
    }
    setBulkOwnerSaving(false);
    setSelectedRecordIds(failed);
    setRefreshKey((current) => current + 1);
    setListNotice(`${items.length - failed.length} of ${items.length} record owner(s) changed.`);
    if (failed.length) setBulkOwnerError(messages.join('; '));
    else { setBulkOwnerDialogOpen(false); setBulkOwnerValue(''); }
  };
  const saveRecordOwner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!object || !ownerDialogRecord || !ownerField || !ownerValue) return;
    setOwnerSaving(true);
    setOwnerError('');
    try {
      await apiRequest<{ record: RecordData }>(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(ownerDialogRecord.Id)}/owner`, {
        method: 'PUT',
        ...(typeof ownerDialogRecord.LastModifiedDate === 'string' ? { headers: { 'If-Unmodified-Since': ownerDialogRecord.LastModifiedDate } } : {}),
        body: JSON.stringify({ ownerId: ownerValue })
      });
      setOwnerDialogRecord(null);
      setRefreshKey((current) => current + 1);
    } catch (failure) {
      setOwnerError(failure instanceof Error ? failure.message : 'Unable to change record owner');
    } finally {
      setOwnerSaving(false);
    }
  };
  const saveActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (route.kind !== 'record-detail' || !activitySubject.trim()) return;
    setActivitySaving(true);
    setActivityError('');
    try {
      await apiRequest<{ activity: RecordActivity }>(`/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          kind: activityKind,
          subject: activitySubject,
          description: activityDescription,
          status: 'Open',
          dueAt: activityDueAt ? new Date(activityDueAt).toISOString() : null
        })
      });
      setActivitySubject('');
      setActivityDescription('');
      setActivityDueAt('');
      setRefreshKey((current) => current + 1);
    } catch (failure) {
      setActivityError(failure instanceof Error ? failure.message : 'Unable to save activity');
    } finally {
      setActivitySaving(false);
    }
  };
  const updateActivityStatus = async (activity: RecordActivity, status: RecordActivity['status']) => {
    if (route.kind !== 'record-detail') return;
    setActivityError('');
    try {
      const result = await apiRequest<{ activity: RecordActivity }>(
        `/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/activities/${encodeURIComponent(activity.id)}`,
        { method: 'PATCH', body: JSON.stringify({ status }) }
      );
      setRecordActivities((current) => current.map((item) => item.id === result.activity.id ? result.activity : item));
    } catch (failure) {
      setActivityError(failure instanceof Error ? failure.message : 'Unable to update activity');
    }
  };
  const saveChatterPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (route.kind !== 'record-detail' || !chatterDraft.trim()) return;
    setChatterSaving(true);
    setChatterError('');
    try {
      const result = await apiRequest<{ post: ChatterPost }>(
        `/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/chatter`,
        { method: 'POST', body: JSON.stringify({ body: chatterDraft }) }
      );
      setChatterPosts((current) => [result.post, ...current]);
      setChatterDraft('');
    } catch (failure) {
      setChatterError(failure instanceof Error ? failure.message : 'Unable to publish Chatter post');
    } finally {
      setChatterSaving(false);
    }
  };
  const saveChatterComment = async (post: ChatterPost, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (route.kind !== 'record-detail') return;
    const body = chatterCommentDrafts[post.id]?.trim();
    if (!body) return;
    setChatterError('');
    try {
      const result = await apiRequest<{ post: ChatterPost }>(
        `/records/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/chatter/${encodeURIComponent(post.id)}/comments`,
        { method: 'POST', body: JSON.stringify({ body }) }
      );
      setChatterPosts((current) => current.map((item) => item.id === post.id ? result.post : item));
      setChatterCommentDrafts((current) => ({ ...current, [post.id]: '' }));
    } catch (failure) {
      setChatterError(failure instanceof Error ? failure.message : 'Unable to comment on Chatter post');
    }
  };
  const readImportFile = async (file: File) => {
    if (!object) return;
    setImportFileName(file.name);
    setImportError('');
    try {
      const rows = parseCsvImport(await file.text(), object);
      setImportRows(rows);
      setImportFileName(file.name);
    } catch (failure) {
      setImportRows([]);
      setImportError(failure instanceof Error ? failure.message : 'Unable to read this CSV file');
    }
  };
  const runImport = async () => {
    if (!object || !importRows.length) return;
    setImportSaving(true);
    setImportError('');
    try {
      const result = await apiRequest<{ count: number; mode: 'create' | 'update' }>(`/records/${encodeURIComponent(object.apiName)}/import`, {
        method: 'POST',
        body: JSON.stringify({ records: importRows })
      });
      setImportRows([]);
      setImportFileName('');
      setListNotice(`${result.count} ${object.label.toLocaleLowerCase()} record${result.count === 1 ? '' : 's'} ${result.mode === 'update' ? 'updated' : 'created'}.`);
      setRefreshKey((current) => current + 1);
    } catch (failure) {
      setImportError(failure instanceof Error ? failure.message : 'Import failed; no records were saved');
    } finally {
      setImportSaving(false);
    }
  };
  const exportFilteredRecords = async () => {
    if (!object || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      // Use the same authorised, metadata-filtered Records API as the list.
      // Fetch in bounded pages; never bypass field/record RBAC or hydrate the
      // entire table into the live list view.
      const fields = object.fields.filter((field) => fieldAccess[object.apiName+'.'+field.apiName]?.read
        && (!activeListView||activeListView.columns.includes(field.apiName)));
      const columns = ['Id', ...fields.map((field) => field.apiName).filter((name) => name !== 'Id')];
      const csvCell = (value: unknown): string => {
        let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        // Neutralise spreadsheet formulas without changing stored source data.
        if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(value)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      };
      const rows: string[] = [columns.map(csvCell).join(',')];
      let offset = 0;
      let total: number | null = null;
      do {
        const params = new URLSearchParams({
          limit: '200', offset: String(offset),
          ...(activeListView?{viewId:activeListView.id}:{}),
          ...(listSort ? { sortField: listSort.field, sortDirection: listSort.direction } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(object.listViewFilter ? { filterField: object.listViewFilter.fieldApiName,
            filterValue: object.listViewFilter.value,
            ...(object.listViewFilter.operator ? { filterOperator: object.listViewFilter.operator } : {}) } : {})
        });
        const page = await apiRequest<{ records: RecordData[]; total: number }>(
          '/records/' + encodeURIComponent(object.apiName) + '?' + params.toString());
        if (!Array.isArray(page.records) || !Number.isSafeInteger(page.total) || page.total < 0)
          throw new Error('Unexpected record export response');
        if (total !== null && total !== page.total)
          throw new Error('Records changed during export. Please retry for a consistent result.');
        total = page.total;
        if (page.records.length === 0 && offset < total)
          throw new Error('Export stopped before all records were returned');
        for (const item of page.records) rows.push(columns.map((name) => csvCell(item[name])).join(','));
        offset += page.records.length;
      } while (total !== null && offset < total);
      const blob = new Blob(['\uFEFF', rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = object.apiName + '-records.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setListNotice('Exported ' + offset + ' records to CSV.');
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Unable to export records');
    } finally {
      setExporting(false);
    }
  };
  if (!object && !metadataLoaded) return <div className="records-loading">Loading object metadata…</div>;
  if (!object) return <div className="records-page"><div className="records-message" role="alert">Object “{route.objectApiName}” was not found.</div></div>;
  if (formOpen && !editingId && (createPageResolvedTypeId!==[object.apiName,String(formValues.RecordTypeId??''),route.kind==='record-detail'||route.kind==='record-list'?route.appId??'Records':'Records',formFactor,viewportFactor,profileId].join('|')||editPageLoading||editPageError)) return <main className="records-page record-editor-page">
    <button className="text-action" type="button" onClick={()=>setFormOpen(false)}>Back to records</button>
    {!editPageError?<div className="records-loading" role="status">Loading published creation layout…</div>
      :<div className="records-message" role="alert">Unable to load creation layout: {editPageError}</div>}
  </main>;
  if (formOpen && editingId && (editPageResolvedRecordId!==editLayoutKey||editPageLoading||editPageError)) return <main className="records-page record-editor-page">
    <button className="text-action" type="button" onClick={()=>setFormOpen(false)}>Back to record</button>
    {!editPageError?<div className="records-loading" role="status">Loading published Record Edit layout…</div>
      :<div className="records-message" role="alert">Unable to load Record Edit layout: {editPageError}</div>}
  </main>;
  if (formOpen) return <main className="records-page record-editor-page">
    <div className="record-detail-top">
      <button type="button" className="text-action" disabled={saving} onClick={() => setFormOpen(false)}>
        <ArrowLeft size={14} />Back to {editingId ? object.label : object.pluralLabel}
      </button>
    </div>
    <RecordFormDialog embedded object={object} objects={objects} activeRecordTypes={activeRecordTypes} selectedRecordTypeId={selectedRecordTypeId} profileId={profileId} selectedLayout={selectedLayout} authoredDynamicFields={authoredDynamicFields}
        fieldAccess={fieldAccess} userRoles={userRoles}
        formValues={formValues} recordId={editingId} lookupRecords={lookupRecords}
        searchLookupRecords={searchLookupRecords} formError={formError} saving={saving} editing={Boolean(editingId)}
        actionAllowed={!selectedLayout || selectedLayout.actions.includes(editingId ? 'Edit' : 'New')}
        extraFields={object.apiName==='User'&&canManageUserIdentities?<><label className="form-label">Reports To
          <select className="form-control" value={String(formValues.ReportsToId??reportingRootId??'')}
            disabled={saving || Boolean(editingId && editingId===reportingRootId)}
            onChange={event=>setFormValues(current=>({...current,ReportsToId:event.target.value||reportingRootId}))}>
            <option value="">Tenant Developer (default)</option>
            {reportingUsers.filter(u=>u.id!==editingId).map(u=><option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>)}
          </select>
          <small>Managers define ancestors and descendants; roles never determine this tree.</small>
        </label><label className="form-label">Default landing page
          <select className="form-control" value={String(formValues.LandingApp??'Setup')} disabled={saving}
            onChange={event=>setFormValues(current=>({...current,LandingApp:event.target.value}))}>
            <option value="Setup">Setup Home</option>
            {apps.map(app=><option key={app.apiName} value={app.apiName}>{app.label}</option>)}
            {typeof formValues.LandingApp==='string'&&formValues.LandingApp!=='Setup'
              &&!apps.some(app=>app.apiName===formValues.LandingApp)
              &&<option value={formValues.LandingApp}>{formValues.LandingApp} (unavailable)</option>}
          </select>
          <small>This sets where the user lands after sign-in. It does not grant app access.</small>
        </label></>:undefined}
        onChange={(apiName, value) => setFormValues((current) => ({ ...current, [apiName]: value, ...(object.apiName === 'User' && apiName === 'Email' ? { Username: value } : {}) }))}
        onClose={() => setFormOpen(false)} onSubmit={(event) => void saveRecord(event)} />
  </main>;
  if (route.kind === 'record-detail') {
    if (!record) return <div className="records-page">
      {(offlineItems.length>0 || !navigator.onLine) && renderOfflineQueue()}
      <div className="record-detail-top">
        <button className="text-action" onClick={openList}><ArrowLeft size={14} />Back to {object.pluralLabel}</button>
        <div className="record-breadcrumb">{object.label} <ChevronRight size={13} /> {route.recordId}</div>
      </div>
      {loading && <div className="records-loading">Loading record…</div>}
      {!loading && error && <div className="records-message" role="alert">{error}
        <button type="button" className="btn" onClick={()=>setRefreshKey(current=>current+1)}>Retry loading</button>
      </div>}
    </div>;
    const recordName = String(record?.Name ?? record?.Id ?? route.recordId);
    const recordTypeId = String(record?.RecordTypeId ?? defaultRecordTypeId);
    const recordLayout = recordPagePresentationLayout(activeLightningPage,
      pageLayoutForRecord(object, recordTypeId, profileId));
    const recordPageActionOverride=Boolean(activeLightningPage?.components.some(component=>
      component.type==='Record Actions' && component.visible!==false));
    const actionBlock=activeLightningPage?.components.find(component=>component.type==='Record Actions'&&component.visible!==false);
    const actionContext={formFactor,record,profileId,fields:object.fields,
      recordPermissions:new Set<'Create'|'Edit'|'Delete'>(
        (['Create','Edit','Delete'] as const).filter(key=>
          recordGrants?.objectApi===object.apiName&&recordGrants[key]===true)
      ),
      readableFieldApiNames:new Set(object.fields.filter(field=>fieldAccess[`${object.apiName}.${field.apiName}`]?.read)
        .map(field=>field.apiName))};
    const pageActionState=(name:string)=>behaviorRecordAction(
      actionBlock?.properties??{},name,actionContext,recordLayout?.actionVisibility?.[name]);
    const showRecordAction=(name:string)=>{
      if(recordPageActionOverride&&recordLayout&&!recordLayout.actions.includes(name))return false;
      return pageActionState(name)!=='hidden';
    };
    // A configured override without current Action permission is hidden, not
    // silently downgraded to the native button (especially for Delete).
    const standardOverride=(name:'Edit'|'Clone'|'Delete')=>{
      const id=recordLayout?.actionOverrides?.[name];
      if(!id)return null;
      return (object.actions??[]).find(action=>action.id===id
        &&action.type==='Custom'&&action.enabled&&allowedActionIds.includes(id))??undefined;
    };
    const canShowStandard=(name:'Edit'|'Clone'|'Delete')=>
      !recordLayout?.actionOverrides?.[name]||Boolean(standardOverride(name));
    const detailFieldNames = recordLayout?.sections.flatMap((section) => section.fieldApiNames);
    const readableRecordFields = object.fields.filter((field) => fieldAccess[`${object.apiName}.${field.apiName}`]?.read
      && field.apiName in (record ?? {}));
    const fields = readableRecordFields.filter((field) => !detailFieldNames || detailFieldNames.includes(field.apiName));
    const activeFieldSet = object.fieldSets?.find((fieldSet) => fieldSet.apiName === selectedFieldSetApiName)
      ?? object.fieldSets?.[0];
    const fieldSetFields = activeFieldSet?.fieldApiNames
      .map((name) => object.fields.find((field) => field.apiName === name))
      .filter((field): field is FieldMetadata => Boolean(field
        && fieldAccess[`${object.apiName}.${field.apiName}`]?.read
        && record && field.apiName in record)) ?? [];
    const historyEnabled = object.settings?.trackFieldHistory === true && object.fields.some((field) => field.trackHistory);
    const activeCompactLayout = compactLayoutForRecord(object, recordTypeId, profileId);
    const compactFields = (activeCompactLayout?.fieldApiNames ?? []).map((name) => object.fields.find((field) => field.apiName === name))
      .filter((field): field is FieldMetadata => Boolean(field && fieldAccess[`${object.apiName}.${field.apiName}`]?.read && record && field.apiName in record));
    const assignedPage = activeLightningPage?.targetObject === object.apiName ? activeLightningPage : null;
    const renderRelatedList = (relationshipName: string,component?:PageComponentMetadata) => {
      const relatedEntry = Object.entries(relatedRecords).find(([name, value]) => {
        const childObject = objects.find((item) => item.apiName === value.objectApiName);
        return name.toLocaleLowerCase() === relationshipName.toLocaleLowerCase()
          || childObject?.pluralLabel.toLocaleLowerCase() === relationshipName.toLocaleLowerCase();
      });
      const related=relatedEntry?.[1];
      if (!related) return <section className="record-fields-card surface" key={relationshipName}><div className="record-fields-heading"><h2>{relationshipName}</h2></div><div className="records-empty">This related list is unavailable for this record.</div></section>;
      const childObject = objects.find((item) => item.apiName === related.objectApiName);
      const overrides=(component?.properties.relatedListSettings??{}) as Record<string,Record<string,unknown>>;
      const settings={...(recordLayout?.relatedListSettings?.[relationshipName]??{}),
        ...(overrides[relationshipName]??{})} as {
        columns?:string[];pageSize?:number;sortField?:string;sortDirection?:'asc'|'desc';
        filterField?:string;filterValue?:string;filterOperator?:'Equals'|'Includes'|'Excludes';
        showNewAction?:boolean;showRowActions?:boolean;
      };
      const availableFields=childObject?.fields.filter(field=>field.apiName!==related.fieldApiName
        && fieldAccess[`${childObject.apiName}.${field.apiName}`]?.read)??[];
      const displayFields=settings?.columns
        ?settings.columns.flatMap(name=>availableFields.find(field=>field.apiName===name)
          ?[availableFields.find(field=>field.apiName===name)!]:[])
        :availableFields.filter(field=>related.records.some(item=>field.apiName in item)).slice(0,4);
      const newAction=(object.actions??[]).find(action=>action.enabled&&action.behavior==='Create Related'
        &&action.targetObjectApi===childObject?.apiName&&action.relationshipFieldApi===related.fieldApiName
        &&allowedActionIds.includes(action.id)
        &&(!recordLayout||recordLayout.actions.includes(action.id)));
      if(component?.properties.serverPaged===true&&childObject&&settings.showRowActions!==true)
        return <section className="record-fields-card surface related-records-card"
          id={'related-'+relatedEntry![0]} key={relationshipName}>
          <div className="record-fields-heading"><h2>{relationshipName}</h2>
            {settings.showNewAction!==false&&newAction&&<button type="button" className="btn"
              onClick={()=>onNavigate({kind:'record-list',objectApiName:childObject.apiName,appId:route.appId,
                relatedCreation:{sourceObjectApi:object.apiName,sourceRecordId:record.Id,actionId:newAction.id}})}>New</button>}
          </div>
          <StandardRecordList object={childObject} request={apiRequest}
            appId={route.appId??''} onNavigate={onNavigate}
            columns={settings.columns??displayFields.map(item=>item.apiName)}
            pageSize={settings.pageSize??25} initialSort={settings.sortField}
            initialDirection={settings.sortDirection}
            extraFilter={settings.filterField&&settings.filterValue!==undefined
              ?{field:settings.filterField,value:settings.filterValue,operator:settings.filterOperator??'Equals'}
              :undefined}
            recordFilter={{field:related.fieldApiName,recordId:String(record.Id)}}/>
        </section>;
      return <section className="record-fields-card surface related-records-card" id={'related-'+relatedEntry![0]} key={relationshipName}>
        <div className="record-fields-heading"><h2>{relationshipName}</h2><span>{related.total} record{related.total === 1 ? '' : 's'}</span>
          {settings?.showNewAction!==false&&newAction&&childObject&&<button type="button" className="btn"
            onClick={()=>onNavigate({kind:'record-list',objectApiName:childObject.apiName,appId:route.appId,
              relatedCreation:{sourceObjectApi:object.apiName,sourceRecordId:record.Id,actionId:newAction.id}})}>New</button>}
        </div>
        {related.records.length === 0 ? <div className="records-empty">No related {childObject?.pluralLabel.toLocaleLowerCase() ?? 'records'}.</div>
          : <div className="records-table-wrap" style={{ maxHeight: "65vh", overflow: "auto" }}><table className="slds-table records-table"><thead><tr>{displayFields.map((field) => <th key={field.apiName}>{field.label}</th>)}{settings?.showRowActions&&<th>Actions</th>}</tr></thead>
            <tbody>{related.records.map((child) => <tr key={child.Id}>{displayFields.map((field, index) => <td key={field.apiName}>
              {index === 0 && childObject
                ? <a href={appRoutePath({ kind: 'record-detail', objectApiName: childObject.apiName, recordId: child.Id, appId: route.appId })} onClick={(event) => navigateLink(event, { kind: 'record-detail', objectApiName: childObject.apiName, recordId: child.Id, appId: route.appId })}>{formatRecordValue(child[field.apiName] ?? child.Id)}</a>
                : formatRecordValue(child[field.apiName])}
            </td>)}{settings?.showRowActions&&childObject&&<td>
              <button type="button" className="btn" onClick={()=>onNavigate({
                kind:'record-detail',objectApiName:childObject.apiName,recordId:child.Id,appId:route.appId
              })}>View / Edit</button>
              <button type="button" className="btn btn-danger" onClick={()=>void(async()=>{
                if(!window.confirm('Delete this related record? It can be restored from the Recycle Bin.'))return;
                try{await apiRequest(`/records/${encodeURIComponent(childObject.apiName)}/${encodeURIComponent(child.Id)}`,{
                  method:'DELETE'});setRefreshKey(current=>current+1);}
                catch(error){setRelatedError(error instanceof Error?error.message:'Delete was not permitted');}
              })()}>Delete</button>
            </td>}</tr>)}</tbody></table></div>}
        {renderRelatedPagination(relationshipName, related.total, related.records.length)}
      </section>;
    };
    const runtimeBehaviorContext={formFactor,record,fields:object.fields,profileId,
      readableFieldApiNames:new Set(readableRecordFields.map(field=>field.apiName)),
      recordPermissions:new Set<'Create'|'Edit'|'Delete'>([
        ...(canCreate?['Create' as const]:[]),...(canEdit?['Edit' as const]:[]),
        ...(canDelete?['Delete' as const]:[])])};
    const renderPageField=(field:FieldMetadata,componentProperties?:Record<string,unknown>)=>{
      const layoutRules=recordInlineFieldRules(field.apiName,componentProperties,runtimeBehaviorContext);
      if(!layoutRules.visible)return null;
      const layoutReadOnly=layoutRules.readOnly;
      return <InlineRecordField
        field={field} value={record[field.apiName]} display={formatFieldValue(field,record[field.apiName])}
        editable={!layoutReadOnly&&canEdit&&fieldAccess[`${object.apiName}.${field.apiName}`]?.edit===true}
        onEditFull={()=>openEditForm(record)}
        onSave={async(value)=>{
          if(!canEdit||!fieldAccess[`${object.apiName}.${field.apiName}`]?.edit||layoutReadOnly)
            throw new Error('Field editing is not permitted');
          validateInlineFieldValue({...field,required:field.required||layoutRules.required},value,layoutReadOnly);
          await apiRequest(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}`,{
            method:'PUT',
            ...(typeof record.LastModifiedDate==='string'
              ?{headers:{'If-Unmodified-Since':record.LastModifiedDate}}:{}),
            body:JSON.stringify({[field.apiName]:value})
          });
          setRefreshKey(previous=>previous+1);
        }}/>;
    };
    const renderRuntimeComponent = (original: PageComponentMetadata) => {
      const component={...original,properties:{...original.properties,...recordInteractionOverrides[original.id]}};
      if (!isComponentVisible(component, {
        formFactor, record, fields: object.fields, profileId,
        recordPermissions:new Set<'Create'|'Edit'|'Delete'>([
          ...(canCreate?['Create' as const]:[]),
          ...(canEdit?['Edit' as const]:[]),
          ...(canDelete?['Delete' as const]:[])
        ]),
        readableFieldApiNames: new Set(readableRecordFields.map(field => field.apiName))
      }, true)) return null;
      if (component.type === 'Record Actions') return null;
      if (component.type === 'Custom:smart_textbox') {
        // A restricted field must disappear as a whole two-part textbox,
        // not leave an empty label or a gap in the reflowing record grid.
        // The Record API has already removed unreadable field values.
        const source=component.properties.textSource;
        if(typeof source==='string'){
          const available=new Set(object.fields.map(field=>field.apiName));
          const readable=new Set(readableRecordFields.map(field=>field.apiName));
          const referenced=[...source.matchAll(/@([A-Za-z][A-Za-z0-9_]*)/g)].map(match=>match[1]);
          if(referenced.some(field=>available.has(field)&&!readable.has(field)))return null;
        }
      }
      if (component.type.startsWith('Custom:')) {
        const definition = libraryComponents.find((item) => item.apiName === component.type.slice('Custom:'.length) && item.surfaces.includes('page'));
        const children = isLayoutContainer(component)
          ? childrenOf(assignedPage?.components ?? [], component.id).map(renderRuntimeComponent)
          : undefined;
        return definition
          ? <div key={component.id} data-layout-component-id={component.id}
              style={{...resolvePageComponentStyle(component.properties, component.type, layoutDevice),
                ...behaviorAppearance(component.properties,runtimeBehaviorContext)}}>
              {!isLayoutContainer(component) && needsMetadataComponentRuntime(component.properties)
                ? <MetadataBoundPageComponent definition={definition} component={component} recordId={String(record.Id)} defaultObjectApiName={object.apiName}
                    objects={objects} apps={apps} pages={pages} currentAppId="Records"
                    pageSessionKey={'record:' + object.apiName + ':' + String(record.Id)}
                    pageComponents={assignedPage?.components} reports={reports} availableFlows={availableFlows} formFactor={formFactor}
                    onNavigate={onNavigate} onLaunchFlow={onLaunchFlow} behaviorContext={runtimeBehaviorContext} />
                : <RegisteredComponent formulaInstanceId={component.id} definition={definition} props={{
                    ...component.properties, ...componentLayoutProps(component.properties, layoutDevice),
                    label: component.label, properties: component.properties,
                    record, recordId: record.Id, object, formFactor, children,
                    disabled:behaviorAction(component.properties,'click',runtimeBehaviorContext)!=='enabled',
                    onAction:(action:{event:string;value?:unknown})=>{
                      if(behaviorAction(component.properties,action.event,runtimeBehaviorContext)!=='enabled')return;
                      window.dispatchEvent(new CustomEvent('metadrive:page-component-interaction',{
                        detail:{pageSessionKey:recordSessionKey,componentId:component.id,event:action.event,value:action.value}
                      }));
                    },
                    onChange:(value:unknown)=>{
                      if(behaviorAction(component.properties,'change',runtimeBehaviorContext)!=='enabled')return;
                      window.dispatchEvent(new CustomEvent('metadrive:page-component-interaction',{
                        detail:{pageSessionKey:recordSessionKey,componentId:component.id,event:'change',value}
                      }));
                    }
                  }} />}
            </div>
          : <div className="records-message" role="status" key={component.id}>Component “{component.type.slice('Custom:'.length)}” is not available in the component library.</div>;
      }
      if(component.type==='Related List Quick Links'){
        const names=Array.isArray(component.properties.relatedLists)
          ?component.properties.relatedLists.filter((name):name is string=>typeof name==='string'):[];
        // Links are navigational only: never reveal a relation that the
        // authorised related-record response did not provide.
        const available=visibleRelatedListQuickLinks(names,relatedRecords,objects);
        if(!available.length)return null;
        return <nav key={component.id} className="record-fields-card surface" aria-label={component.label}>
          {available.map(name=>{
            const entry=Object.entries(relatedRecords).find(([key,value])=>
              key.toLowerCase()===name.toLowerCase()||objects.find(item=>item.apiName===value.objectApiName)?.pluralLabel.toLowerCase()===name.toLowerCase());
            const anchor='related-'+entry![0];
            return <a key={name} href={'#'+encodeURIComponent(anchor)}
            onClick={event=>{
              const target=document.getElementById(anchor);
              if(target){event.preventDefault();target.scrollIntoView({behavior:'smooth'});}
            }}>{name}</a>})}
        </nav>;
      }
      if(component.type==='Items to Approve')
        return <React.Suspense key={component.id} fallback={<p role="status">Loading approvals…</p>}>
          <StandardApprovals request={apiRequest} appId={route.appId??''} onNavigate={onNavigate}/>
        </React.Suspense>;
      if(component.type==='Rich Text')return <StandardRichText key={component.id}
        text={String(component.properties.content??'')}/>;
      if(component.type==='List View'){
        const source=objects.find(item=>item.apiName===component.properties.listObjectApiName);
        const columns=Array.isArray(component.properties.columns)
          ?component.properties.columns.filter((name):name is string=>typeof name==='string'):[];
        return <StandardRecordList key={component.id} object={source} request={apiRequest}
          appId={route.appId??''} onNavigate={onNavigate} columns={columns}
          pageSize={typeof component.properties.pageSize==='number'?component.properties.pageSize:25} savedViewId={typeof component.properties.savedViewId==='string'?component.properties.savedViewId:undefined}/>;
      }
      if(component.type==='Screen Flow'){
        const props={
          label:component.label,flowApiName:String(component.properties.flowApiName??''),
          flows:availableFlows,recordId:String(record.Id),
          inputRecordIdAs:typeof component.properties.inputRecordIdAs==='string'
            ?component.properties.inputRecordIdAs:undefined
        };
        return component.properties.embed===false
          ?<StandardFlowLauncher key={component.id} {...props} onLaunchFlow={onLaunchFlow}/>
          :<React.Suspense key={component.id} fallback={<p role="status">Loading Flow…</p>}>
            <EmbeddedScreenFlow {...props} request={apiRequest}
              libraryComponents={libraryComponents}
              onFinished={()=>setRefreshKey(current=>current+1)}/>
          </React.Suspense>;
      }
      if(component.type==='Path'){
        const apiName=String(component.properties.stageFieldApiName??'');
        const field=readableRecordFields.find(item=>item.apiName===apiName);
        if(!field||field.dataType!=='Picklist')return <p key={component.id} role="status">Choose a readable Picklist field for Path.</p>;
        const recordType=object.recordTypes?.find(item=>item.id===record.RecordTypeId);
        const allowedStages=recordType?.picklistValues?.[apiName]??field.picklistValues??[];
        return <StandardRecordPath key={component.id} label={component.label}
          values={allowedStages} value={record[apiName]}
          record={record} readableFields={readableRecordFields}
          guidanceByStage={component.properties.guidanceByStage as Record<string,string>|undefined}
          keyFieldsByStage={component.properties.keyFieldsByStage as Record<string,string[]>|undefined}
          canEdit={canEdit&&fieldAccess[`${object.apiName}.${apiName}`]?.edit===true}
          onAdvance={async(nextValue)=>{
            if(!canEdit||!fieldAccess[`${object.apiName}.${apiName}`]?.edit)
              throw new Error('Stage change is not permitted');
            if(!allowedStages.includes(nextValue))throw new Error('Stage is not allowed for this record type');
            await apiRequest(`/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}`,{
              method:'PUT',...(typeof record.LastModifiedDate==='string'
                ?{headers:{'If-Unmodified-Since':record.LastModifiedDate}}:{}),
              body:JSON.stringify({[apiName]:nextValue})
            });
            setRefreshKey(current=>current+1);
          }}/>;
      }
      if (component.type === 'Highlights Panel') return <section className="record-highlights surface" key={component.id} aria-label="Record highlights">
        {resolveHighlightFields(
          Array.isArray(component.properties.primaryFieldApiNames)
            ?component.properties.primaryFieldApiNames.filter((x):x is string=>typeof x==='string')
            :undefined,compactFields,readableRecordFields
        ).map(field=><div key={field.apiName}><span>{field.label}</span>
          <strong>{formatFieldValue(field, record[field.apiName])}</strong></div>)}
        {resolveHighlightFields(
          Array.isArray(component.properties.secondaryFieldApiNames)
            ?component.properties.secondaryFieldApiNames.filter((x):x is string=>typeof x==='string')
            :[],[],readableRecordFields
        ).map(field=><div key={'secondary-'+field.apiName}><span>{field.label}</span>
          <strong>{formatFieldValue(field, record[field.apiName])}</strong></div>)}
        <div className="record-highlight-actions">
          {canEdit&&component.properties.showEditAction===true&&showRecordAction('Edit')&&behaviorAction(component.properties,'Edit',runtimeBehaviorContext)!=='hidden'&&<button type="button" className="btn"
            disabled={pageActionState('Edit')==='disabled'||behaviorAction(component.properties,'Edit',runtimeBehaviorContext)==='disabled'}
            onClick={()=>openEditForm(record)}>Edit</button>}
          {canCreate&&component.properties.showCloneAction===true&&object.apiName!=='User'
            &&showRecordAction('Clone')&&behaviorAction(component.properties,'Clone',runtimeBehaviorContext)!=='hidden'&&
            <button type="button" className="btn" disabled={pageActionState('Clone')==='disabled'||behaviorAction(component.properties,'Clone',runtimeBehaviorContext)==='disabled'} onClick={()=>void cloneCurrentRecord()}>Clone</button>}
          {(object.actions??[]).filter(action=>action.enabled&&action.type==='Custom'
            &&actionVisibleInArea(action,'Highlights')
            &&Array.isArray(component.properties.actionIds)&&component.properties.actionIds.includes(action.id)
            &&allowedActionIds.includes(action.id)&&showRecordAction(action.id)
            &&behaviorAction(component.properties,action.id,runtimeBehaviorContext)!=='hidden'
            &&(!recordLayout||recordLayout.actions.includes(action.id))
            &&(['Run Flow','Open Component','Create Related','Send Email'].includes(action.behavior??'')
              ||canEdit&&(action.behavior==='Log Call'
                ||action.behavior==='Set Field Value'&&Boolean(action.fieldApiName
                  &&fieldAccess[`${object.apiName}.${action.fieldApiName}`]?.edit))))
            .map(action=><button type="button" className="btn" key={action.id}
              disabled={Boolean(customActionPendingId)||pageActionState(action.id)==='disabled'||behaviorAction(component.properties,action.id,runtimeBehaviorContext)==='disabled'}
              onClick={()=>void runCustomObjectAction(action)}>
              {customActionPendingId===action.id?'Running…':action.label}
            </button>)}
        </div>
      </section>;
      if (component.type === 'Record Detail') {
        const componentFields = Array.isArray(component.properties.fields)
          ? component.properties.fields.filter((name): name is string => typeof name === 'string')
          : readableRecordFields.map((field) => field.apiName);
        const visibleFields = componentFields.map((name) => readableRecordFields.find((field) => field.apiName === name))
          .filter((field): field is FieldMetadata => Boolean(field));
        return <section className="record-fields-card surface" key={component.id}>
          <div className="record-fields-heading"><h2>{component.label}</h2></div>
          <dl className="record-fields-grid">{visibleFields.map((field) =>
            <div className="record-field" key={field.apiName}><dt>{field.label}</dt><dd>{renderPageField(field,component.properties)}</dd></div>)}</dl>
        </section>;
      }
      if (component.type === 'Field Section') {
        const sectionFieldNames = Array.isArray(component.properties.fieldApiNames)
          ? component.properties.fieldApiNames.filter((name): name is string => typeof name === 'string')
          : [];
        const visibleFields = sectionFieldNames.map((name) => readableRecordFields.find((field) => field.apiName === name))
          .filter((field): field is FieldMetadata => Boolean(field))
          .filter(field=>behaviorField(component.properties,field.apiName,runtimeBehaviorContext)?.visible!==false);
        return <section className="record-fields-card surface" key={component.id}>
          <div className="record-fields-heading"><h2>{component.label}</h2></div>
          {visibleFields.length
            ? <dl className={`record-fields-grid columns-${component.properties.columns === 1 ? 1 : 2}`}>{visibleFields.map((field) =>
              <div className="record-field" key={field.apiName} style={behaviorAppearance(component.properties,runtimeBehaviorContext,field.apiName)}><dt>{field.label}</dt><dd>{renderPageField(field,component.properties)}</dd></div>)}</dl>
            : <div className="records-empty">No readable fields are configured in this section.</div>}
        </section>;
      }
      if (component.type === 'Record Field' &&
          typeof component.properties.relatedLookupFieldApiName==='string' &&
          component.properties.relatedLookupFieldApiName &&
          typeof component.properties.relatedFieldApiName==='string' &&
          component.properties.relatedFieldApiName){
        const lookup=readableRecordFields.find(item=>
          item.apiName===component.properties.relatedLookupFieldApiName);
        const targetObject=lookup?.relationship?.targetObject;
        const targetField=objects.find(item=>item.apiName===targetObject)?.fields
          .find(item=>item.apiName===component.properties.relatedFieldApiName);
        const targetReadable=Boolean(targetObject&&targetField&&
          fieldAccess[targetObject+'.'+targetField.apiName]?.read===true);
        const relatedId=lookup?record[lookup.apiName]:undefined;
        if(!targetReadable||typeof relatedId!=='string'||!relatedId)return <p
          className="records-empty" role="status" key={component.id}>Related field is unavailable.</p>;
        return <CrossObjectRecordField key={component.id} objectApi={targetObject!}
          recordId={relatedId} fieldApi={targetField!.apiName}
          label={component.label||targetField!.label} request={apiRequest}/>;
      }
      if (component.type === 'Record Field') {
        const fieldApiName = typeof component.properties.fieldApiName === 'string' ? component.properties.fieldApiName : '';
        const field = readableRecordFields.find((item) => item.apiName === fieldApiName);
        return field && behaviorField(component.properties,fieldApiName,runtimeBehaviorContext)?.visible!==false
          ? <section className="record-fields-card surface record-single-field" key={component.id}
              style={behaviorAppearance(component.properties,runtimeBehaviorContext,fieldApiName)}>
            <div className="record-fields-heading"><h2>{component.label}</h2></div>
            {behaviorAppearanceLabel(component.properties,runtimeBehaviorContext,fieldApiName)&&<p className="records-message" role="status">{behaviorAppearanceLabel(component.properties,runtimeBehaviorContext,fieldApiName)}</p>}
            <dl className="record-fields-grid columns-1"><div className="record-field"><dt>{field.label}</dt><dd>{renderPageField(field,component.properties)}</dd></div></dl>
          </section>
          : <div className="records-empty" role="status" key={component.id}>This field is unavailable or not readable.</div>;
      }
      if (component.type === 'Related List') {
        const names = Array.isArray(component.properties.relatedLists)
          ? component.properties.relatedLists.filter((name): name is string => typeof name === 'string')
          : [];
        return <div key={component.id}>{names.map(name=>renderRelatedList(name,component))}</div>;
      }
      if (component.type === 'Tabs') {
        const configuredTabs=Array.isArray(component.properties.tabs)
          ? component.properties.tabs.filter((tab): tab is string => typeof tab === 'string')
          : ['Related', 'Details'];
        const tabs = behaviorTabs(component.properties,configuredTabs,runtimeBehaviorContext);
        const selectedTab = tabs.includes(activeRuntimeTabs[component.id])
          ? activeRuntimeTabs[component.id] : tabs[0];
        const nested=childrenOf(assignedPage?.components??[],component.id);
        if(!tabs.length)return null;
        return <div className="record-runtime-tabs" key={component.id}>
          <div className="record-tabs" role="tablist" aria-label={component.label}>
            {tabs.map((tab) => <button type="button" role="tab" aria-selected={selectedTab === tab} className={selectedTab === tab ? 'active' : ''}
              key={tab} tabIndex={selectedTab===tab?0:-1}
              onKeyDown={event=>{
                const next=nextAccessibleTabIndex(event.key,tabs.indexOf(tab),tabs.length);
                if(next===null)return;
                event.preventDefault();
                setActiveRuntimeTabs(current=>({...current,[component.id]:tabs[next]}));
                const buttons=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons?.[next]?.focus();
              }}
              onClick={() => setActiveRuntimeTabs(current=>({...current,[component.id]:tab}))}>{tab}</button>)}
          </div>
          <div role="tabpanel" className="record-runtime-tab-panel">
            {nested.length
              ? nested.filter(child=>behaviorTabForChild(
                child.properties.tabLabel,configuredTabs,tabs)===selectedTab)
                .map(renderRuntimeComponent)
              : selectedTab?.toLocaleLowerCase() === 'details'
              ? assignedPage?.components.some((item) => item.visible && ['Field Section', 'Record Field'].includes(item.type))
                ? assignedPage.components.filter((item) => item.visible && ['Field Section', 'Record Field'].includes(item.type)).map(renderRuntimeComponent)
                : <section className="record-fields-card surface"><div className="record-fields-heading"><h2>Details</h2></div>
                  <dl className="record-fields-grid">{readableRecordFields.map((field) => <div className="record-field" key={field.apiName}><dt>{field.label}</dt><dd>{renderPageField(field)}</dd></div>)}</dl>
                </section>
              : selectedTab?.toLocaleLowerCase() === 'related'
                ? assignedPage?.components.some((item) => item.visible && item.type === 'Related List')
                  ? <div className="records-empty">Related records are shown in the page’s Related List components.</div>
                  : <div>{Object.keys(relatedRecords).map(name=>renderRelatedList(name))}</div>
                : ['activity', 'activities'].includes(selectedTab?.toLocaleLowerCase() ?? '')
                  ? assignedPage?.components.filter((item) => item.visible && item.type === 'Activities').map(renderRuntimeComponent)
                    ?? <div className="records-empty">Add an Activities component to this page to show the activity timeline.</div>
                  : selectedTab?.toLocaleLowerCase() === 'chatter'
                    ? assignedPage?.components.filter((item) => item.visible && item.type === 'Chatter').map(renderRuntimeComponent)
                      ?? <div className="records-empty">Add a Chatter component to this page to show the record feed.</div>
                    : (() => {
                      const tabComponent = assignedPage?.components.find((item) => item.visible
                        && item.type !== 'Tabs'
                        && item.label.toLocaleLowerCase() === selectedTab?.toLocaleLowerCase());
                      return tabComponent
                        ? renderRuntimeComponent(tabComponent)
                        : <div className="records-empty">{selectedTab} content is not configured for this record.</div>;
                    })()}
          </div>
        </div>;
      }
      if (component.type === 'Accordion') {
        const nested=childrenOf(assignedPage?.components??[],component.id);
        const content=typeof component.properties.content==='string'?component.properties.content:'';
        return <section className="record-fields-card surface" key={component.id}>
          <div className="record-fields-heading"><h2>{component.label}</h2></div>
          {nested.length
            ? <details className="record-layout-section" open><summary>{component.label}</summary>{nested.map(renderRuntimeComponent)}</details>
            : content
              ? <details className="record-layout-section" open><summary>{component.label}</summary><p>{content}</p></details>
              : (recordLayout?.sections??[{id:'record-details',label:'Record Details',columns:2,
                  fieldApiNames:readableRecordFields.map(field=>field.apiName)}]).map(section=>
                <details className="record-layout-section" key={section.id} open>
                  <summary>{section.label}</summary>
                  <dl className={`record-fields-grid columns-${section.columns}`}>
                    {section.fieldApiNames.map(name=>readableRecordFields.find(field=>field.apiName===name))
                      .filter((field):field is FieldMetadata=>Boolean(field))
                      .map(field=><div className="record-field" key={field.apiName}>
                        <dt>{field.label}</dt><dd>{renderPageField(field)}</dd>
                      </div>)}
                  </dl>
                </details>)}
        </section>;
      }
      if (component.type === 'Activities') return <section className="record-fields-card surface record-activities" key={component.id}>
        <div className="record-fields-heading"><h2>{component.label}</h2><span>{recordActivities.length} item{recordActivities.length === 1 ? '' : 's'}</span></div>
        <form className="record-interaction-form" onSubmit={(event) => void saveActivity(event)}>
          <div className="record-interaction-form-row">
            <label className="form-label">Type<select className="form-control" value={activityKind} onChange={(event) => setActivityKind(event.target.value as RecordActivity['kind'])}>
              <option>Task</option><option>Call</option><option>Event</option>
            </select></label>
            <label className="form-label">Subject<input className="form-control" maxLength={160} required value={activitySubject} onChange={(event) => setActivitySubject(event.target.value)} /></label>
            <label className="form-label">{activityKind === 'Event' ? 'Start date and time' : 'Due date and time'}<input className="form-control" type="datetime-local" value={activityDueAt} onChange={(event) => setActivityDueAt(event.target.value)} /></label>
          </div>
          <label className="form-label">Comments<textarea className="form-control" rows={2} maxLength={4000} value={activityDescription} onChange={(event) => setActivityDescription(event.target.value)} /></label>
          <button className="btn btn-brand" type="submit" disabled={activitySaving || !activitySubject.trim()}>{activitySaving ? 'Saving…' : `Add ${activityKind}`}</button>
        </form>
        {activityError && <div className="records-message" role="alert">{activityError}</div>}
        {recordActivities.length === 0 ? <div className="records-empty">No activities yet.</div>
          : <ol className="record-activity-list">{recordActivities.map((activity) => <li key={activity.id}>
            <div className="record-activity-heading"><strong>{activity.subject}</strong><span>{activity.kind} · {activity.status}</span></div>
            <p>{activity.description || 'No comments'}</p>
            <small>{activity.dueAt ? `${activity.kind === 'Event' ? 'Starts' : 'Due'} ${formatRecordValue(activity.dueAt)} · ` : ''}{activity.createdByName} · {formatRecordValue(activity.createdAt)}</small>
            {activity.status === 'Open' && <button className="text-action" type="button" onClick={() => void updateActivityStatus(activity, 'Completed')}>Mark complete</button>}
          </li>)}</ol>}
      </section>;
      if (component.type === 'Chatter') return <section className="record-fields-card surface record-chatter" key={component.id}>
        <div className="record-fields-heading"><h2>{component.label}</h2><span>{chatterPosts.length} post{chatterPosts.length === 1 ? '' : 's'}</span></div>
        <form className="record-interaction-form" onSubmit={(event) => void saveChatterPost(event)}>
          <label className="form-label" htmlFor={`chatter-post-${component.id}`}>Share an update<textarea id={`chatter-post-${component.id}`} className="form-control" rows={3} maxLength={4000} value={chatterDraft} onChange={(event) => setChatterDraft(event.target.value)} required /></label>
          <button className="btn btn-brand" type="submit" disabled={chatterSaving || !chatterDraft.trim()}>{chatterSaving ? 'Posting…' : 'Share'}</button>
        </form>
        {chatterError && <div className="records-message" role="alert">{chatterError}</div>}
        {chatterPosts.length === 0 ? <div className="records-empty">No posts yet. Start the conversation.</div>
          : <ol className="record-chatter-posts">{chatterPosts.map((post) => <li key={post.id}>
            <div className="record-chatter-author"><strong>{post.createdByName}</strong><small>{formatRecordValue(post.createdAt)}</small></div>
            <p>{post.body}</p>
            {post.comments.map((comment) => <div className="record-chatter-comment" key={comment.id}>
              <strong>{comment.createdByName}</strong><small>{formatRecordValue(comment.createdAt)}</small><p>{comment.body}</p>
            </div>)}
            <form className="record-interaction-form-row" onSubmit={(event) => void saveChatterComment(post, event)}>
              <label className="form-label"><span className="visually-hidden">Comment on post by {post.createdByName}</span>
                <input className="form-control" maxLength={4000} placeholder="Write a comment…" value={chatterCommentDrafts[post.id] ?? ''}
                  onChange={(event) => setChatterCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} /></label>
              <button className="btn" type="submit" disabled={!chatterCommentDrafts[post.id]?.trim()}>Comment</button>
            </form>
          </li>)}</ol>}
      </section>;
      if (component.type === 'Dashboard') return <section className="record-fields-card surface" key={component.id}>
        <EmbeddedDashboard dashboardApiName={String(component.properties.dashboardApiName ?? '')}
          request={apiRequest} libraryComponents={libraryComponents}/>
      </section>;
      if (component.type === 'Report Chart') return <section className="record-fields-card surface" key={component.id}>
        <div className="record-fields-heading"><h2>{component.label}</h2></div>
        <RuntimeReportChart report={reports.find((report) => report.apiName === component.properties.reportApiName)}
          objects={objects}
          recordContext={component.properties.filterByCurrentRecord===false?undefined:{
            objectApiName:object.apiName,recordId:String(record.Id),
            ...(typeof component.properties.recordFilterFieldApiName==='string'
              &&component.properties.recordFilterFieldApiName
              ?{relationshipFieldApiName:component.properties.recordFilterFieldApiName}:{})
          }} />
      </section>;
      return <div className="records-message" role="status" key={component.id}>{component.label} is not supported in record runtime.</div>;
    };
    const renderRuntimeRegion = (region: 'header' | 'main' | 'sidebar') =>
      childrenOf(assignedPage?.components ?? [], null).filter((component) => (component.region ?? 'main') === region).map(component => {
        const content = renderRuntimeComponent(component);
        return content && !component.type.startsWith('Custom:')
          &&(hasPageComponentAppearance(component.properties)||Object.keys(behaviorAppearance(component.properties,runtimeBehaviorContext)).length>0)
          ? <div key={component.id} style={{...resolvePageComponentStyle(component.properties, component.type, layoutDevice),
            ...behaviorAppearance(component.properties,runtimeBehaviorContext)}}>{content}</div>
          : content;
      });
    const publisherActions=(object.actions??[]).filter(action=>{
      if(action.type!=='Custom'||!action.enabled
        ||!actionVisibleInArea(action,'Publisher')
        ||!allowedActionIds.includes(action.id)||!showRecordAction(action.id))return false;
      if(['Run Flow','Open Component','Create Related','Send Email'].includes(action.behavior??''))return true;
      if(!canEdit||(recordLayout&&!recordLayout.actions.includes('Edit')))return false;
      return action.behavior==='Log Call'||action.behavior==='Set Field Value'
        &&Boolean(action.fieldApiName&&fieldAccess[`${object.apiName}.${action.fieldApiName}`]?.edit);
    });
    return <PageFormulaScope key={recordSessionKey} components={assignedPage?.components} catalog={libraryComponents}><div className="records-page">
      {(offlineItems.length>0 || !navigator.onLine) && renderOfflineQueue()}
      <div className="record-detail-top">
        <button className="text-action" onClick={openList}><ArrowLeft size={14} />Back to {object.pluralLabel}</button>
        <div className="record-breadcrumb">{object.label} <ChevronRight size={13} /> {recordName}</div>
      </div>
      {loading && <div className="records-loading">Loading record…</div>}
      {!loading && error && <div className="records-message" role="alert">{error}
        <button type="button" className="btn" onClick={()=>setRefreshKey(current=>current+1)}>Retry loading</button>
      </div>}
      {!loading && !error && record && <>
        <section className="record-detail-heading surface">
          <div className="record-object-icon"><Database size={18} /></div>
          <div><div className="eyebrow">{object.label}</div><h1>{recordName}</h1><p>Record ID: <code>{record.Id}</code></p></div>
          <div className="record-detail-actions">
            {canEdit && showRecordAction('Edit') && canShowStandard('Edit') &&
              <button className="btn btn-brand" disabled={Boolean(customActionPendingId)||pageActionState('Edit')==='disabled'}
               onClick={()=>{const action=standardOverride('Edit');
                if(action)void runCustomObjectAction(action);else openEditForm(record);}}>
               <Pencil size={14}/>{standardOverride('Edit')?.label??'Edit'}</button>}
            {canCreate&&object.apiName!=='User'&&showRecordAction('Clone')&&canShowStandard('Clone')&&
              <button className="btn" disabled={Boolean(customActionPendingId)||pageActionState('Clone')==='disabled'}
               onClick={()=>{const action=standardOverride('Clone');
                if(action)void runCustomObjectAction(action);else void cloneCurrentRecord();}}>
               <Copy size={14}/>{standardOverride('Clone')?.label??'Clone'}</button>}
            {canDelete && showRecordAction('Delete') && canShowStandard('Delete') &&
              <button className="btn btn-danger" disabled={Boolean(customActionPendingId)||pageActionState('Delete')==='disabled'}
               onClick={()=>{const action=standardOverride('Delete');
                if(action)void runCustomObjectAction(action);else void deleteCurrentRecord();}}>
               <Trash2 size={14}/>{standardOverride('Delete')?.label??
                (object.apiName === 'User' ? 'Deactivate' : 'Delete')}</button>}
            {(recordLayout?.customLinks ?? []).flatMap(link=>{
              const readable=new Set(object.fields.filter(field=>
                fieldAccess[`${object.apiName}.${field.apiName}`]?.read).map(field=>field.apiName));
              const href=resolveRecordCustomLink(link.url,record,readable,
                {field:link.visibleWhenField,value:link.visibleWhenValue});
              return href?[<a key={link.id} className="btn" href={href}
                target={link.openInNewWindow?'_blank':undefined}
                rel={link.openInNewWindow?'noopener noreferrer':undefined}>{link.label}</a>]:[];
            })}
            {(object.actions ?? []).filter((action) => {
              if (!actionVisibleInArea(action,'Header'))return false;
              if (action.type !== 'Custom' || !action.enabled || !allowedActionIds.includes(action.id)) return false;
              if (!showRecordAction(action.id)) return false;
              if (['Run Flow', 'Open Component', 'Create Related','Send Email'].includes(action.behavior ?? '')) return true;
              if (!canEdit || (recordLayout && !recordLayout.actions.includes('Edit'))) return false;
              if (action.behavior === 'Log Call') return true;
              return action.behavior === 'Set Field Value' && Boolean(action.fieldApiName
                && fieldAccess[`${object.apiName}.${action.fieldApiName}`]?.edit);
            }).map((action) => <button className="btn" key={action.id}
              disabled={Boolean(customActionPendingId)||pageActionState(action.id)==='disabled'}
              onClick={() => void runCustomObjectAction(action)}>
                {customActionPendingId === action.id ? 'Running…' : action.label}
              </button>)}
          </div>
        </section>
        {publisherActions.length>0&&<section className="surface record-action-publisher" aria-label="Record publisher">
          <h2>Actions</h2>
          <div className="record-highlight-actions">{publisherActions.map(action=>
            <button className="btn" type="button" key={action.id}
              disabled={Boolean(customActionPendingId)||pageActionState(action.id)==='disabled'}
              onClick={()=>void runCustomObjectAction(action)}>
              {customActionPendingId===action.id?'Running…':action.label}
            </button>)}</div>
        </section>}
        {renderActionComponent()}
        {emailAction && <div className="modal-backdrop" role="presentation">
          <form className="modal" role="dialog" aria-modal="true" aria-label="Send email"
            onSubmit={async event=>{
              event.preventDefault();
              if(!object||!record||emailSaving)return;
              setEmailSaving(true);
              setCustomActionMessage('');
              try{
                await apiRequest<{status:string}>(
                  `/records/${encodeURIComponent(object.apiName)}/${encodeURIComponent(record.Id)}/actions/${encodeURIComponent(emailAction.id)}/execute`,{
                    method:'POST',body:JSON.stringify(emailDraft)
                  });
                setEmailAction(null);
                setCustomActionMessage('Email delivery Flow started.');
              }catch(error){
                setCustomActionMessage(error instanceof Error?error.message:'Email action failed');
              }finally{setEmailSaving(false);}
            }}>
            <h2>{emailAction.label}</h2>
            <p>Send using the configured HTTPS delivery Flow.</p>
            <label className="form-label">Recipient
              <input className="form-control" type="email" required value={emailDraft.to}
                onChange={event=>setEmailDraft(current=>({...current,to:event.target.value}))}/>
            </label>
            <label className="form-label">Subject
              <input className="form-control" required maxLength={255} value={emailDraft.subject}
                onChange={event=>setEmailDraft(current=>({...current,subject:event.target.value}))}/>
            </label>
            <label className="form-label">Message
              <textarea className="form-control" required maxLength={20000} rows={6} value={emailDraft.body}
                onChange={event=>setEmailDraft(current=>({...current,body:event.target.value}))}/>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" disabled={emailSaving}
                onClick={()=>{setEmailAction(null);setCustomActionMessage('');}}>Cancel</button>
              <button type="submit" className="btn btn-brand" disabled={emailSaving}>
                {emailSaving?'Sending…':'Send Email'}
              </button>
            </div>
          </form>
        </div>}
        {customActionMessage && <div className="records-message surface" role="status">{customActionMessage}</div>}
        {duplicateMatches.length>0 && <section className="records-message" role="status" aria-label="Potential duplicate records">
          <strong>Potential duplicate records detected.</strong>
          {duplicateMatches.map(match=><a key={match.ruleApi+':'+match.recordId}
            href={appRoutePath({kind:'record-detail',objectApiName:object.apiName,recordId:match.recordId,appId:route.appId})}
            onClick={event=>{event.preventDefault();onNavigate({kind:'record-detail',objectApiName:object.apiName,recordId:match.recordId,appId:route.appId});}}>
            View matched record ({match.ruleApi})
          </a>)}
        </section>}
        {/* Full-field view supplements metadata layouts without altering their sections.
            Only server-readable fields are included; it never bypasses FLS. */}
        {!assignedPage && <details className="record-fields-card surface record-all-fields" open>
          <summary className="record-fields-heading">All readable fields ({readableRecordFields.length})</summary>
          <dl className="record-fields-grid">
            {readableRecordFields.map(field =>
              <div className="record-field" key={field.apiName}>
                <dt>{field.label}</dt>
                <dd>{formatFieldValue(field, record[field.apiName])}</dd>
              </div>)}
          </dl>
        </details>}
        {assignedPage?.layoutMode==='free-canvas'&&
          <ResponsivePageCanvas page={assignedPage}>
            {childrenOf(assignedPage.components,null).map(component=>{
              return <div key={component.id} className="free-canvas-runtime-component"
                data-layout-component-id={component.id}
                style={{position:component.position?'absolute':'relative',
                  left:component.position?.x??0,top:component.position?.y??0,
                  width:component.position?.width??'100%',height:component.position?.height??'auto',
                  ...resolvePageComponentStyle(component.properties,component.type,layoutDevice)}}>
                {renderRuntimeComponent(component)}
              </div>;
            })}
          </ResponsivePageCanvas>}
        {assignedPage?.layoutMode!=='free-canvas'&&assignedPage && <div className="record-runtime-page" data-lightning-page={assignedPage.apiName}>
          {renderRuntimeRegion('header')}
          <div className={assignedPage.template === 'main-sidebar' || assignedPage.template === 'header-main-sidebar' ? 'record-runtime-layout has-sidebar' : 'record-runtime-layout'}>
            <main className="record-runtime-main">{renderRuntimeRegion('main')}</main>
            {assignedPage.template === 'main-sidebar' || assignedPage.template === 'header-main-sidebar'
              ? <aside className="record-runtime-sidebar">{renderRuntimeRegion('sidebar')}</aside>
              : null}
          </div>
        </div>}
        {!assignedPage && compactFields.length > 0 && <section className="record-highlights surface" aria-label="Record highlights">
          {compactFields.map((field) => <div key={field.apiName}><span>{field.label}</span><strong>{formatFieldValue(field, record[field.apiName])}</strong></div>)}
        </section>}
        {!assignedPage && <section className="record-fields-card surface">
          <div className="record-fields-heading"><h2>{recordLayout?.label ?? 'Details'}</h2><button className="icon-button" aria-label="Refresh record" onClick={() => setRefreshKey((current) => current + 1)}><RefreshCw size={15} /></button></div>
          {recordLayout?.sections.length ? recordLayout.sections.map((section) => {
            const sectionFields = section.fieldApiNames.map((name) => fields.find((field) => field.apiName === name)).filter((field): field is FieldMetadata => Boolean(field));
            return <div className="record-layout-section" key={section.id}>
              <h3>{section.label}</h3>
              <dl className={`record-fields-grid columns-${section.columns}`}>
                {sectionFields.map((field) => <div className="record-field" key={field.apiName}><dt>{field.label}</dt><dd>{formatFieldValue(field, record[field.apiName])}{canEdit && (!recordLayout || recordLayout.actions.includes('Edit')) && fieldAccess[`${object.apiName}.${field.apiName}`]?.edit && !field.formula && <button className="icon-button" type="button" aria-label={`Edit ${field.label}`} onClick={() => openEditForm(record)}><Pencil size={13} /></button>}</dd></div>)}
              </dl>
            </div>;
          }) : <dl className="record-fields-grid">
            {fields.map((field) => <div className="record-field" key={field.apiName}><dt>{field.label}</dt><dd>{formatFieldValue(field, record[field.apiName])}{canEdit && fieldAccess[`${object.apiName}.${field.apiName}`]?.edit && !field.formula && <button className="icon-button" type="button" aria-label={`Edit ${field.label}`} onClick={() => openEditForm(record)}><Pencil size={13} /></button>}</dd></div>)}
          </dl>}
          <dl className="record-fields-grid"><div className="record-field"><dt>Record ID</dt><dd><code>{record.Id}</code></dd></div></dl>
        </section>}
        {!assignedPage && object.fieldSets?.length ? <section className="record-fields-card surface">
          <div className="record-fields-heading">
            <h2>Field Set</h2>
            <select className="form-control compact-select" aria-label="Choose field set" value={activeFieldSet?.apiName ?? ''}
              onChange={(event) => setSelectedFieldSetApiName(event.target.value)}>
              {object.fieldSets.map((fieldSet) => <option key={fieldSet.apiName} value={fieldSet.apiName}>{fieldSet.label}</option>)}
            </select>
          </div>
          {fieldSetFields.length
            ? <dl className="record-fields-grid">{fieldSetFields.map((field) =>
              <div className="record-field" key={field.apiName}><dt>{field.label}</dt><dd>{formatFieldValue(field, record[field.apiName])}</dd></div>)}</dl>
            : <div className="records-empty">This field set has no readable fields on this record.</div>}
        </section> : null}
        {!assignedPage && historyEnabled && <section className="record-fields-card surface">
          <div className="record-fields-heading"><h2>Field History</h2><span>{fieldHistory.length} change{fieldHistory.length === 1 ? '' : 's'}</span></div>
          {fieldHistory.length ? <div className="records-table-wrap"><table className="slds-table records-table"><thead><tr><th>Field</th><th>Changed</th><th>Changed By</th><th>Original Value</th><th>New Value</th></tr></thead>
            <tbody>{fieldHistory.map((entry, index) => <tr key={`${String(entry.id ?? entry.changedAt)}-${index}`}>
              <td>{String(entry.fieldLabel ?? entry.fieldApiName ?? '')}</td><td>{formatRecordValue(entry.changedAt)}</td><td>{String(entry.changedByName ?? '')}</td>
              <td>{formatRecordValue(entry.oldValue)}</td><td>{formatRecordValue(entry.newValue)}</td>
            </tr>)}</tbody></table></div> : <div className="records-empty">No tracked field changes yet.</div>}
        </section>}
        {!assignedPage && Object.keys(relatedRecords).map(name=>renderRelatedList(name))}
        {relatedError && <div className="records-message surface" role="alert">{relatedError}</div>}
        {lookupError && <div className="records-message surface" role="alert">Some related record names could not be resolved: {lookupError}</div>}
      </>}
      
    </div></PageFormulaScope>;
  }
  const readableFields = object.fields.filter((field) => fieldAccess[`${object.apiName}.${field.apiName}`]?.read);
  const hasConfiguredSearchResults = object.searchLayouts?.searchResults !== undefined;
  const visibleRecords = records; // Search and pagination are applied by the API.
  const configuredListFields = object.searchLayouts?.searchResults?.map((name) => object.fields.find((field) => field.apiName === name))
    .filter((field): field is FieldMetadata => Boolean(field && fieldAccess[`${object.apiName}.${field.apiName}`]?.read));
  const defaultListFields = hasConfiguredSearchResults
    ? configuredListFields ?? []
    : [...readableFields].sort((left, right) => Number(right.apiName === 'Name') - Number(left.apiName === 'Name'))
      .filter((field) => records.length === 0 || records.some((item) => field.apiName in item));
  const configuredListColumns=previewListColumns ?? activeListView?.columns
    ?? defaultListFields.map(field=>field.apiName);
  const listFieldsBase=configuredListColumns
    .map(name=>object.fields.find(field=>field.apiName===name))
    .filter((field):field is FieldMetadata=>Boolean(field&&fieldAccess[`${object.apiName}.${field.apiName}`]?.read));
  // A record's Id is universally readable with the record itself. The SQL
  // Communication Search Results metadata places the remaining fields in order.
  const listFields=object.apiName==='Communication' && !previewListColumns && !activeListView
    && listFieldsBase.length>=5
    ?[...listFieldsBase.slice(0,5),{apiName:'Id',label:'Id',dataType:'Text'} as FieldMetadata,...listFieldsBase.slice(5)]
    :listFieldsBase;
  const phoneColumns = resolvePhoneColumns(listFields,previewPhoneRoles ?? activeListView?.phoneRoles ?? {});
  const tableFields=(viewportFactor==='Tablet'||(viewportWidth>0&&viewportWidth<=1200))?listFields.slice(0,5):listFields;
  const selectableRecordIds = (canMassDelete || canBulkUpdate || canChangeOwner) ? visibleRecords.flatMap((item) => {
    const recordTypeId = String(item.RecordTypeId ?? defaultRecordTypeId);
    const recordLayout = pageLayoutForRecord(object, recordTypeId, profileId);
    return canMassDelete && (!recordLayout || recordLayout.actions.includes('Delete'))
      || (canBulkUpdate || canChangeOwner) && (!recordLayout || recordLayout.actions.includes('Edit'))
      ? [item.Id] : [];
  }) : [];
  const selectedOwnerChangeIds = selectedRecordIds.filter((id) => {
    if (!canChangeOwner) return false;
    const item = records.find((candidate) => candidate.Id === id);
    if (!item) return false;
    const layout = pageLayoutForRecord(object, String(item.RecordTypeId ?? defaultRecordTypeId), profileId);
    return !layout || layout.actions.includes('Edit');
  });
  const selectedEditableRecordIds = selectedRecordIds.filter((id) => {
    if (!canBulkUpdate) return false;
    const item = records.find((candidate) => candidate.Id === id);
    if (!item) return false;
    const layout = pageLayoutForRecord(object, String(item.RecordTypeId ?? defaultRecordTypeId), profileId);
    return !layout || layout.actions.includes('Edit');
  });
  const selectedDeletableRecordIds = selectedRecordIds.filter((id) => selectableRecordIds.includes(id)
    && canMassDelete
    && (() => {
      const item = records.find((candidate) => candidate.Id === id);
      if (!item) return false;
      const layout = pageLayoutForRecord(object, String(item.RecordTypeId ?? defaultRecordTypeId), profileId);
      return !layout || layout.actions.includes('Delete');
    })());
  return <div className="records-page">
    {(offlineItems.length>0 || !navigator.onLine) && renderOfflineQueue()}
    <RecordsListPageHeading label={object.pluralLabel}
      objects={navigableObjects} selected={object.apiName}
      onObjectSelect={(objectApiName) => onNavigate({kind:'record-list',objectApiName,appId:route.appId})}
      onRefresh={() => setRefreshKey((current) => current + 1)} />
    {renderActionComponent()}
    {recycleOpen && <section className="records-list-card surface" aria-label="Record Recycle Bin" style={{padding:16,marginBottom:12}}>
      <div className="records-list-toolbar">
        <div><h2>{object.label} Recycle Bin</h2><span>{recycleTotal} deleted root record(s)</span></div>
        <div className="records-list-actions">
          <button type="button" className="btn" disabled={recycleBusy} onClick={() => void loadRecycleBin(recycleOffset)}>Refresh</button>
          <button type="button" className="btn" onClick={() => setRecycleOpen(false)}>Close</button>
        </div>
      </div>
      {canConfigureRetention && <div className="records-list-actions" style={{padding:'10px 0',gap:12,flexWrap:'wrap'}}>
        <label>Keep records (days) <input className="form-control" type="number" min={1} max={3650}
          value={retentionDays} onChange={event=>setRetentionDays(Number(event.target.value))}
          aria-label="Record retention days" /></label>
        <label className="checkbox-row"><input type="checkbox" checked={automaticPurgeEnabled}
          onChange={event=>setAutomaticPurgeEnabled(event.target.checked)} />Automatic permanent purge (irreversible)</label>
        <button className="btn" disabled={recycleBusy||retentionDays<1||retentionDays>3650||!Number.isInteger(retentionDays)}
          onClick={() => void saveRetention()}>Save Retention</button>
      </div>}
      <small>Deleted records remain recoverable until permanently purged. Automatic purge is off by default.</small>
      {recycleError && <div className="records-message" role="alert">{recycleError}</div>}
      {recycleBusy && <div className="records-message" role="status">Loading Recycle Bin…</div>}
      {!recycleBusy && recycleRows.length===0 && !recycleError && <div className="records-empty">No deleted records.</div>}
      {recycleRows.length>0 && <div className="records-table-wrap"><table className="slds-table records-table">
        <thead><tr><th>Record ID</th><th>Deleted at</th><th>Deleted by</th><th>Action</th></tr></thead>
        <tbody>{recycleRows.map(item=><tr key={item.Id}><td><code>{item.Id}</code></td>
          <td>{new Date(item.DeletedAt).toLocaleString()}</td><td>{item.DeletedBy}</td>
          <td><button className="btn" type="button" disabled={recycleBusy} onClick={() => void restoreRecord(item.Id)}>Restore</button>
          {canConfigureRetention && Date.now()-new Date(item.DeletedAt).getTime()>=retentionDays*86400000
            && <button className="btn btn-danger" type="button" disabled={recycleBusy}
              onClick={() => void permanentlyPurge(item.Id)}>Purge expired</button>}</td>
        </tr>)}</tbody></table></div>}
      {recycleTotal>25 && <nav aria-label="Recycle Bin pagination" className="records-list-actions" style={{padding:12}}>
        <button className="btn" disabled={recycleBusy||recycleOffset===0} onClick={() => void loadRecycleBin(Math.max(0,recycleOffset-25))}>Previous</button>
        <span>{recycleRows.length === 0 ? `0–0 of ${recycleTotal}` : `${recycleOffset+1}–${Math.min(recycleOffset+recycleRows.length,recycleTotal)} of ${recycleTotal}`}</span>
        <button className="btn" disabled={recycleBusy||recycleOffset+25>=recycleTotal} onClick={() => void loadRecycleBin(recycleOffset+25)}>Next</button>
      </nav>}
    </section>}
    <div className={'md-records-split'+(overlayRecordId && viewportFactor === 'Desktop' ? ' md-records-split-open' : '')}
      style={listPaneWidth === null ? undefined : {'--md-list-pane-width': listPaneWidth+'px'} as React.CSSProperties}>
    <section className="records-list-card surface" data-md-new-record={canShowListNew ? 'true' : undefined}>
      <div className="records-list-toolbar records-main-toolbar">
        <div className="records-phone-title-line"><div><h2>{object.pluralLabel}</h2><span>{loading ? 'Loading records…' : `${listTotal} record${listTotal === 1 ? '' : 's'}`}</span></div>
          {formFactor === 'Phone' && <div className="records-phone-title-actions">
            {canShowListNew && <button type="button" className="records-phone-new" aria-label={'New ' + object.label} onClick={openCreateForm}><Plus size={22} aria-hidden="true" /></button>}
            <details className="records-phone-overflow"><summary aria-label="More record list actions"><Ellipsis size={22} aria-hidden="true" /></summary>
              <div className="records-phone-action-list">
                <strong>List actions</strong>
                {canDelete && object.apiName !== 'User' && <button type="button" onClick={() => void loadRecycleBin(0)}>Recycle Bin</button>}
                {canImport && <button type="button" onClick={() => importInputRef.current?.click()}>Import CSV</button>}
                {listFields.length > 0 && <button type="button" disabled={exporting} onClick={() => void exportFilteredRecords()}>{exporting ? 'Exporting…' : 'Export CSV'}</button>}
                {object.listViewButtons?.includes('Printable View') && <button type="button" onClick={() => window.print()}>Printable View</button>}
                <button type="button" onClick={() => setRecordListLayout(current => current === 'cards' ? 'table' : 'cards')}>
                  {recordListLayout === 'cards' ? 'List view' : 'Cards view'}
                </button>
                <label htmlFor="records-phone-sort">Sort by
                  <select id="records-phone-sort" value={listSort?.field ?? ''} onChange={event => {
                    setListOffset(0); setListSort(event.target.value ? {field:event.target.value,direction:'asc'} : null);
                  }}>
                    <option value="">Default order</option>
                    {listFields.map(field => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                  </select>
                </label>
                {listSort && <button type="button" onClick={() => {setListOffset(0);setListSort(current => current && ({...current,direction:current.direction==='asc'?'desc':'asc'}));}}>
                  {listSort.direction === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
                </button>}
              </div>
            </details>
          </div>}
        </div>
        <RecordsListSearchControls label={object.pluralLabel} search={headerSearch} onSearchChange={(value) => {setListOffset(0);onSearchChange(value);}} />
        <SavedRecordListViewPicker objectApi={object.apiName}
          defaultColumns={defaultListFields.map(field=>field.apiName)}
          fields={object.fields.filter(field=>fieldAccess[`${object.apiName}.${field.apiName}`]?.read)}
          selected={activeListView} legacyFilter={object.listViewFilter}
          onColumnsChange={setPreviewListColumns} pendingColumns={previewListColumns}
          onPhoneRolesChange={setPreviewPhoneRoles}
          onSelect={view=>{setActiveListView(view);setPreviewPhoneRoles(view?.phoneRoles??null);setListSort(null);setListOffset(0);}} />
        {formFactor !== 'Phone' && <div className="records-layout-switcher" role="group" aria-label="Record list layout">
          {(['table','cards','checklist','compact'] as const).map(layout=>
            <button type="button" key={layout} aria-pressed={recordListLayout===layout}
              className={recordListLayout===layout?'active':''}
              onClick={()=>setRecordListLayout(layout)}>
              {layout==='table'?'Table':layout==='cards'?'Cards':layout==='checklist'?'Checklist':'Compact'}
            </button>)}
        </div>}
        {formFactor !== 'Phone' && <div className="records-list-actions">
          {canShowListNew && <button className="btn btn-brand" onClick={openCreateForm}><Plus size={14} />New</button>}
          {canDelete && object.apiName!=='User' && <button className="btn" onClick={() => void loadRecycleBin(0)}><Trash2 size={14}/>Recycle Bin</button>}
          {canImport && <button className="btn" onClick={() => importInputRef.current?.click()}>Import</button>}
          {listFields.length > 0 && <button className="btn" disabled={exporting} onClick={() => void exportFilteredRecords()}>{exporting ? 'Exporting…' : 'Export CSV'}</button>}
          {object.listViewButtons?.includes('Printable View') && <button className="btn" onClick={() => window.print()}>Printable View</button>}
          {canChangeOwner && selectedOwnerChangeIds.length > 0 && <button type="button" className="btn"
            onClick={() => { setBulkOwnerError(''); setBulkOwnerValue(''); setBulkOwnerDialogOpen(true); }}>
            Change Owner ({selectedOwnerChangeIds.length})
          </button>}
          {canBulkUpdate && selectedEditableRecordIds.length > 0 && <button type="button" className="btn"
            onClick={() => { setBulkFieldApiName(bulkEditableFields[0]?.apiName ?? ''); setBulkFieldValue(''); setBulkFieldBoolean(false); setBulkUpdateError(''); setBulkUpdateOpen(true); }}>
            Bulk Update ({selectedEditableRecordIds.length})
          </button>}
          {canMassDelete && selectedDeletableRecordIds.length > 0 && <button className="btn btn-danger" onClick={() => void deleteSelectedRecords()} disabled={massDeleting}>{massDeleting ? 'Deleting…' : `Delete (${selectedDeletableRecordIds.length})`}</button>}
        </div>}
        <input ref={importInputRef} type="file" accept=".csv,text/csv" hidden aria-label={`Choose ${object.label} CSV file`}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void readImportFile(file);
          }} />
      </div>
      {(Boolean(headerSearch) || activeListView) && <div className="records-active-filters" aria-label="Active list filters">
        {Boolean(headerSearch) && <button type="button" className="records-filter-chip" aria-label="Clear search filter"
          onClick={() => { setListOffset(0); onSearchChange(''); }}>Search: {headerSearch} ×</button>}
        {activeListView && <button type="button" className="records-filter-chip" aria-label="Clear saved view"
          onClick={() => { setActiveListView(null); setListOffset(0); setListSort(null); }}>View: {activeListView.label} ×</button>}
      </div>}
      {selectedRecordIds.length > 0 && <div className="records-selection-notice" role="status">
        <strong>{selectedRecordIds.length} selected</strong>
        <button type="button" className="btn" onClick={() => setSelectedRecordIds([])}>Clear selection</button>
      </div>}
      {formFactor === 'Phone' && selectedRecordIds.length > 0 && <div className="records-phone-selection-actions" role="group" aria-label="Selected record actions">
        <strong>{selectedRecordIds.length} selected</strong>
        {canChangeOwner && selectedOwnerChangeIds.length > 0 && <button type="button" onClick={() => {
          setBulkOwnerError(''); setBulkOwnerValue(''); setBulkOwnerDialogOpen(true);
        }}>Change Owner</button>}
        {canBulkUpdate && selectedEditableRecordIds.length > 0 && <button type="button" onClick={() => {
          setBulkFieldApiName(bulkEditableFields[0]?.apiName ?? ''); setBulkFieldValue('');
          setBulkFieldBoolean(false); setBulkUpdateError(''); setBulkUpdateOpen(true);
        }}>Bulk Update</button>}
        {canMassDelete && selectedDeletableRecordIds.length > 0 && <button type="button" className="danger"
          disabled={massDeleting} onClick={() => void deleteSelectedRecords()}>Delete</button>}
      </div>}
      {listNotice && <div className="records-notice" role="status">{listNotice}</div>}
      {exportError && <div className="records-message" role="alert">{exportError}</div>}
      {error && <div className="records-message" role="alert">{error}
        <button type="button" className="btn" onClick={()=>setRefreshKey(current=>current+1)}>Retry loading</button>
      </div>}
      {!error && !loading && listTotal === 0 && !debouncedSearch && <div className="records-empty records-empty-action"><strong>No {object.pluralLabel.toLocaleLowerCase()} found.</strong>{canCreate && <button className="btn btn-brand" type="button" onClick={openCreateForm}>New {object.label}</button>}</div>}
      {!error && !loading && records.length === 0 && Boolean(debouncedSearch) && <div className="records-empty">No records match “{search}”.</div>}
      {!error && formFactor !== 'Phone' && (loading || records.length > 0) && (recordListLayout==='table'||recordListLayout==='compact') && <div className={`records-table-wrap records-responsive-list ${recordListLayout==='compact'?'records-table-compact':''}`} data-row-density={object.apiName==='Communication'?'80':'100'} role="region" aria-label={`${object.pluralLabel} records`} tabIndex={0} style={{ maxHeight: viewportFactor==='Tablet'?undefined:'65vh', overflowX: 'auto', overflowY: viewportFactor==='Tablet'?'visible':'auto', maxWidth: '100%' }}><table className="slds-table records-table records-data-table" style={{ minWidth: 'max-content' }}>
        <thead><tr>{(canMassDelete || canBulkUpdate || canChangeOwner) && <th><input type="checkbox" aria-label="Select all selectable records" checked={selectableRecordIds.length > 0 && selectableRecordIds.every((id) => selectedRecordIds.includes(id))} onChange={(event) => setSelectedRecordIds(event.target.checked ? selectableRecordIds : [])} /></th>}{tableFields.map((field) => <th key={field.apiName} draggable
          style={columnWidths[field.apiName] ? {width:columnWidths[field.apiName],minWidth:columnWidths[field.apiName],maxWidth:columnWidths[field.apiName]} : undefined}
          title="Drag to reorder column, or use Columns for keyboard ordering"
          onDragStart={event=>{
            draggedListColumn.current=field.apiName;
            event.dataTransfer.setData('text/x-metadrive-list-column',field.apiName);
            event.dataTransfer.effectAllowed='move';
          }}
          onDragOver={event=>{if(draggedListColumn.current)event.preventDefault();}}
          onDrop={event=>{
            event.preventDefault();
            const source=draggedListColumn.current;
            draggedListColumn.current=null;
            if(!source||source===field.apiName||!configuredListColumns.includes(source))return;
            const columns=configuredListColumns.filter(value=>value!==source);
            const index=columns.indexOf(field.apiName);
            if(index<0)return;
            columns.splice(index,0,source);
            setPreviewListColumns(columns);
            setListNotice('Column order updated. Save or update the list view to keep it.');
          }}
          onDragEnd={()=>{draggedListColumn.current=null;}}
          aria-sort={listSort?.field === field.apiName ? (listSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
          <button type="button" className="text-action" aria-label={`Sort by ${field.label}${listSort?.field === field.apiName ? ', currently ' + listSort.direction : ''}`}
            onClick={() => { setListOffset(0); setListSort((current) => ({ field: field.apiName, direction: current?.field === field.apiName && current.direction === 'asc' ? 'desc' : 'asc' })); }}>
            {field.label} {listSort?.field === field.apiName ? (listSort.direction === 'asc' ? '▲' : '▼') : '↕'}
          </button>
          {field.apiName!=='Id' && <span className="md-record-column-resize" role="separator"
            tabIndex={0} aria-label={`Resize ${field.label} column`}
            aria-orientation="vertical" aria-valuemin={80} aria-valuemax={800}
            aria-valuenow={columnWidths[field.apiName]??160}
            onKeyDown={event=>{
              if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
              event.preventDefault();event.stopPropagation();
              const next=Math.max(80,Math.min(800,(columnWidthsRef.current[field.apiName]??160)+(event.key==='ArrowRight'?16:-16)));
              const widths={...columnWidthsRef.current,[field.apiName]:next};
              columnWidthsRef.current=widths;setColumnWidths(widths);void saveViewWidths(listPaneWidth??440,widths);
            }}
            onPointerDown={event=>{
              event.preventDefault();event.stopPropagation();
              columnResize.current={field:field.apiName,startX:event.clientX,
                startWidth:event.currentTarget.parentElement?.getBoundingClientRect().width??160};
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event=>{
              if(columnResize.current?.field!==field.apiName)return;
              const next=Math.max(80,Math.min(800,Math.round(columnResize.current.startWidth+event.clientX-columnResize.current.startX)));
              const widths={...columnWidthsRef.current,[field.apiName]:next};
              columnWidthsRef.current=widths;setColumnWidths(widths);
            }}
            onPointerUp={event=>{
              columnResize.current=null;
              if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
              void saveViewWidths(listPaneWidth??440,columnWidthsRef.current);
            }}
            onPointerCancel={()=>{columnResize.current=null;}} />}
          </th>)}{(canEdit || canDelete || canChangeOwner) && <th>Actions</th>}</tr></thead>
        <tbody>{visibleRecords.map((item) => {
          const recordTypeId = String(item.RecordTypeId ?? defaultRecordTypeId);
          const rowLayout = pageLayoutForRecord(object, recordTypeId, profileId);
          const rowAllowsEdit = true; // Shared CRUD is not removed by page-layout action placement.
          const rowAllowsDelete = true; // Server RBAC and record permissions remain authoritative.
          const selectable = canMassDelete && rowAllowsDelete || (canBulkUpdate || canChangeOwner) && rowAllowsEdit;
          return <tr key={item.Id} onContextMenu={event=>{
            if(viewportFactor==='Phone')return;
            event.preventDefault();setContextRecord({item,x:event.clientX,y:event.clientY});
          }}>{(canMassDelete || canBulkUpdate || canChangeOwner) && <td>{selectable && <input type="checkbox" aria-label={`Select ${String(item.Name ?? item.Id)}`} checked={selectedRecordIds.includes(item.Id)} onChange={() => setSelectedRecordIds((current) => current.includes(item.Id) ? current.filter((id) => id !== item.Id) : [...current, item.Id])} />}</td>}{tableFields.map((field, index) => <td key={field.apiName} data-label={field.label}
            style={columnWidths[field.apiName] ? {width:columnWidths[field.apiName],minWidth:columnWidths[field.apiName],maxWidth:columnWidths[field.apiName]} : undefined}>
            <span className="records-table-cell-value" title={typeof item[field.apiName] === 'string' && field.dataType !== 'Rich Text Area' ? String(item[field.apiName]) : undefined}>
              {index === 0
                ? <a href={appRoutePath({ kind: 'record-detail', objectApiName: object.apiName, recordId: item.Id, appId: route.appId })} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); if (viewportWidth<=1200) onNavigate({kind:'record-detail',objectApiName:object.apiName,recordId:item.Id,appId:route.appId}); else setOverlayRecordId(item.Id); }}>{formatFieldValue(field, item[field.apiName] ?? item.Id)}</a>
                : formatFieldValue(field, item[field.apiName])}
            </span>
          </td>)}{(canEdit || canDelete || canChangeOwner) && <td data-label="Actions">{viewportWidth>0&&viewportWidth<=1200
            ?<details className="record-row-actions-menu">
              <summary aria-label={`Actions for ${String(item.Name ?? item.Id)}`}><Ellipsis size={18} aria-hidden="true"/> Actions</summary>
              <div>
                {canEdit && rowAllowsEdit && <button type="button" onClick={() => openEditForm(item)}>Edit</button>}
                {canDelete && rowAllowsDelete && <button type="button" onClick={() => void deleteListRecord(item)}>Delete</button>}
                {canChangeOwner && rowAllowsEdit && <button type="button" onClick={() => openChangeOwner(item)}>Change Owner</button>}
              </div>
            </details>
            :<div className="record-row-actions">
              {canEdit && rowAllowsEdit && <button className="text-action" onClick={() => openEditForm(item)}><Pencil size={13} />Edit</button>}
              {canDelete && rowAllowsDelete && <button className="text-action" aria-label={`Delete ${String(item.Name ?? item.Id)}`} onClick={() => void deleteListRecord(item)}><Trash2 size={13} />Delete</button>}
              {canChangeOwner && rowAllowsEdit && <button className="text-action" onClick={() => openChangeOwner(item)}>Change Owner</button>}
            </div>}</td>}</tr>;
        })}</tbody>
      </table></div>}
      {(!error || records.length > 0) && formFactor === 'Phone' && (recordListLayout === 'table' || recordListLayout === 'compact') &&
        <div className="records-phone-rows" role="list" aria-label={object.pluralLabel + ' records'}>
          {loading && records.length===0 ? Array.from({length:6}, (_, i) =>
            <div key={i} className="records-phone-skeleton" aria-hidden="true"><i /><span><i /><i /></span></div>) :
            visibleRecords.map(item => {
              const headlineField = phoneColumns.title;
              const phoneFields = [phoneColumns.subtitle,phoneColumns.badge,phoneColumns.trailing] as Array<FieldMetadata|null>;
              const url = appRoutePath({kind:'record-detail',objectApiName:object.apiName,recordId:item.Id,appId:route.appId});
              return <article key={item.Id} role="listitem" className={'records-phone-row'+(swipedRowId===item.Id?' swipe-open':'')}
                onTouchStart={event=>{
                  const touch=event.touches[0];if(!touch)return;
                  const selectable=selectableRecordIds.includes(item.Id);
                  const timer=selectable?window.setTimeout(()=>{
                    if(touchRow.current?.id!==item.Id)return;
                    touchRow.current.selected=true;
                    setSwipedRowId(null);
                    setSelectedRecordIds(current=>current.includes(item.Id)
                      ?current.filter(id=>id!==item.Id):[...current,item.Id]);
                  },550):null;
                  touchRow.current={id:item.Id,x:touch.clientX,y:touch.clientY,timer,selected:false};
                }}
                onTouchMove={event=>{
                  const current=touchRow.current,touch=event.touches[0];
                  if(!current||current.id!==item.Id||!touch)return;
                  if(Math.abs(touch.clientX-current.x)>12||Math.abs(touch.clientY-current.y)>12){
                    if(current.timer!==null)window.clearTimeout(current.timer);
                    current.timer=null;
                  }
                }}
                onTouchEnd={event=>{
                  const current=touchRow.current,touch=event.changedTouches[0];
                  if(!current||current.id!==item.Id||!touch)return;
                  if(current.timer!==null)window.clearTimeout(current.timer);
                  const dx=touch.clientX-current.x,dy=touch.clientY-current.y;
                  if(current.selected||(Math.abs(dx)>65&&Math.abs(dy)<42)){
                    event.preventDefault();setSwipedRowId(dx<0?item.Id:null);
                  }
                  touchRow.current=null;
                }}
                onTouchCancel={()=>{if(touchRow.current?.timer!==null&&touchRow.current?.timer!==undefined)
                  window.clearTimeout(touchRow.current.timer);touchRow.current=null;}}>
                {(canMassDelete || canBulkUpdate || canChangeOwner) && selectableRecordIds.includes(item.Id) &&
                  <input type="checkbox" aria-label={'Select ' + String(item.Name ?? item.Id)}
                    checked={selectedRecordIds.includes(item.Id)}
                    onChange={() => setSelectedRecordIds(current => current.includes(item.Id)
                      ? current.filter(id => id !== item.Id) : [...current, item.Id])} />}
                <a className="records-phone-row-link" href={url}
                  onClick={event => {
                    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    if(swipedRowId===item.Id){setSwipedRowId(null);return;}
                    onNavigate({kind:'record-detail',objectApiName:object.apiName,recordId:item.Id,appId:route.appId});
                  }}>
                  <div className="records-phone-row-main">
                    <strong>{headlineField ? formatFieldValue(headlineField,item[headlineField.apiName] ?? item.Id) : String(item.Name ?? item.Id)}</strong>
                    {phoneFields[0] && <span>{phoneFields[0].label}: {formatFieldValue(phoneFields[0], item[phoneFields[0].apiName])}</span>}
                    {phoneFields[1] && <small className="records-phone-row-badge">{phoneFields[1].label}: {formatFieldValue(phoneFields[1],item[phoneFields[1].apiName])}</small>}
                  </div>
                  {phoneFields[2] && <span className="records-phone-row-trailing">{formatFieldValue(phoneFields[2],item[phoneFields[2].apiName])}</span>}
                  <ChevronRight size={19} className="records-phone-chevron" aria-hidden="true" />
                </a>
                {swipedRowId===item.Id && (canEdit||canDelete) && <div className="records-phone-swipe-actions">
                  {canEdit && <button type="button" className="edit" onClick={()=>{setSwipedRowId(null);openEditForm(item);}}>Edit</button>}
                  {canDelete && <button type="button" className="danger" onClick={()=>{setSwipedRowId(null);void deleteListRecord(item);}}>Delete</button>}
                </div>}
                {(canEdit || canDelete || canChangeOwner) && <details className="records-phone-row-menu">
                  <summary aria-label={'Actions for ' + String(item.Name ?? item.Id)}><Ellipsis size={18} aria-hidden="true" /></summary>
                  <div>
                    {canEdit && <button type="button" onClick={() => openEditForm(item)}>Edit</button>}
                    {canChangeOwner && <button type="button" onClick={() => openChangeOwner(item)}>Change Owner</button>}
                    {canDelete && <button type="button" className="danger" onClick={() => void deleteListRecord(item)}>Delete</button>}
                  </div>
                </details>}
              </article>;
            })}
        </div>}
      {!error && !loading && records.length>0 && (recordListLayout==='cards'||recordListLayout==='checklist') && <div
        className={'records-alternative-list '+(recordListLayout==='checklist'?'records-checklist-view':'records-cards-view')}
        role="list" aria-label={object.pluralLabel+' '+recordListLayout}>
        {visibleRecords.map(item=>{
          const recordTypeId=String(item.RecordTypeId??defaultRecordTypeId);
          const rowLayout=pageLayoutForRecord(object,recordTypeId,profileId);
          const canRowEdit=canEdit&&(!rowLayout||rowLayout.actions.includes('Edit'));
          const canRowDelete=canDelete&&(!rowLayout||rowLayout.actions.includes('Delete'));
          const canSelect=selectableRecordIds.includes(item.Id);
          return <article role="listitem" className="records-record-card" key={item.Id}
            onContextMenu={event=>{
              if(viewportFactor==='Phone')return;
              event.preventDefault();setContextRecord({item,x:event.clientX,y:event.clientY});
            }}>
            <header className="records-card-header">
              {canSelect&&<input type="checkbox" aria-label={'Select '+String(item.Name??item.Id)}
                checked={selectedRecordIds.includes(item.Id)}
                onChange={()=>setSelectedRecordIds(current=>current.includes(item.Id)
                  ?current.filter(id=>id!==item.Id):[...current,item.Id])}/>}
              <a className="records-card-title" href={appRoutePath({kind:'record-detail',objectApiName:object.apiName,recordId:item.Id,appId:route.appId})}
                onClick={event=>{
                  if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
                  event.preventDefault();
                  if (viewportWidth<=1200) onNavigate({kind:'record-detail',objectApiName:object.apiName,recordId:item.Id,appId:route.appId});
                  else setOverlayRecordId(item.Id);
                }}>{String(item.Name??item[listFields[0]?.apiName]??item.Id)}</a>
            </header>
            <dl className="records-card-fields">
              {listFields.filter(field=>field.apiName!=='Name').slice(0,3)
                .map(field=><div key={field.apiName}>
                  <dt>{field.label}</dt><dd>{formatFieldValue(field,item[field.apiName])}</dd>
                </div>)}
            </dl>
            {(canRowEdit||canRowDelete||(canChangeOwner&&(!rowLayout||rowLayout.actions.includes('Edit'))))&&
              <footer className="records-card-actions">
                {canRowEdit&&<button type="button" className="text-action" onClick={()=>openEditForm(item)}><Pencil size={13}/>Edit</button>}
                {canRowDelete&&<button type="button" className="text-action" onClick={()=>void deleteListRecord(item)}><Trash2 size={13}/>Delete</button>}
                {canChangeOwner&&(!rowLayout||rowLayout.actions.includes('Edit'))&&<button type="button" className="text-action" onClick={()=>openChangeOwner(item)}>Change owner</button>}
              </footer>}
          </article>;
        })}
      </div>}
      {!error && formFactor !== 'Phone' && listTotal > 0 && <nav aria-label="Record list pagination" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px' }}>
        <span>{loading ? 'Loading records…' : records.length===0 ? `0–0 of ${listTotal}` : `${listOffset+1}–${Math.min(listOffset+records.length,listTotal)} of ${listTotal}`}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn" aria-label="First page" disabled={loading || listOffset === 0} onClick={() => setListOffset(0)}>First</button>
          <button className="btn" aria-label="Previous page" disabled={loading || listOffset === 0} onClick={() => setListOffset((v) => Math.max(0, v - listPageSize))}>Previous</button>
          <span>Page {Math.floor(listOffset / listPageSize) + 1} of {Math.max(1, Math.ceil(listTotal / listPageSize))}</span>
          <button className="btn" aria-label="Next page" disabled={loading || listOffset + listPageSize >= listTotal} onClick={() => setListOffset((v) => v + listPageSize)}>Next</button>
          <button className="btn" aria-label="Last page" disabled={loading || listOffset + listPageSize >= listTotal} onClick={() => setListOffset(Math.floor((listTotal - 1) / listPageSize) * listPageSize)}>Last</button>
        </div>
      </nav>}
      {formFactor === 'Phone' && listTotal > 0 && <nav className="records-phone-pagination" aria-label="Record list pagination">
        <span>{records.length} of {listTotal} records loaded</span>
        {records.length < listTotal && !error && <div ref={phoneLoadMoreRef} className="records-phone-load-sentinel">
          <button type="button" disabled={loading} onClick={() => setListOffset(current => current + listPageSize)}>
            {loading ? 'Loading more…' : 'Load more'}
          </button>
        </div>}
      </nav>}
    </section>
    {overlayRecordId && viewportFactor === 'Desktop' && <div className="md-records-split-handle"
      role="separator" tabIndex={0} aria-label="Resize record list pane" aria-orientation="vertical"
      aria-valuemin={320} aria-valuemax={800} aria-valuenow={listPaneWidth ?? 440}
      onKeyDown={event=>{
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
          event.preventDefault();
          const next=Math.max(320,Math.min(800,(listPaneWidth??440)+(event.key==='ArrowRight'?24:-24)));
          setListPaneWidth(next);void saveViewWidths(next,columnWidthsRef.current);
        }
      }}
      onPointerDown={event=>{
        splitResizeActive.current=true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event=>{
        if(!splitResizeActive.current)return;
        const root=event.currentTarget.parentElement;
        if(!root)return;
        const bounds=root.getBoundingClientRect();
        setListPaneWidth(Math.max(320,Math.min(800,bounds.width-360,event.clientX-bounds.left)));
      }}
      onPointerUp={event=>{
        splitResizeActive.current=false;
        if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
        void saveViewWidths(listPaneWidth??440,columnWidthsRef.current);
      }}
      onPointerCancel={()=>{splitResizeActive.current=false;}} />}
    {overlayRecordId && <div className={viewportFactor === 'Desktop' ? 'md-records-detail-pane' : 'record-form-backdrop'}
      role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && viewportFactor !== 'Desktop') { setOverlayRecordId(null); setRefreshKey(current => current + 1); } }}>
      <section role={viewportFactor === 'Desktop' ? 'region' : 'dialog'} aria-modal={viewportFactor === 'Desktop' ? undefined : true}
        aria-label={`${object.label} record details`} className="surface md-records-detail-content"
        style={viewportFactor === 'Desktop' ? undefined : {width:'min(680px,96vw)',maxHeight:'92vh',overflow:'auto',padding:16,borderRadius:14}}>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginBottom:8}}>
          <a className="btn" href={appRoutePath({kind:'record-detail',objectApiName:object.apiName,recordId:overlayRecordId,appId:route.appId})}>Open full page</a>
          <button className="icon-button" type="button" aria-label="Close record" onClick={() => { setOverlayRecordId(null); setRefreshKey(current => current + 1); }}><X size={18}/></button>
        </div>
        <RecordWorkspace route={{kind:'record-detail',objectApiName:object.apiName,recordId:overlayRecordId,appId:route.appId}} objects={objects} apps={apps} pages={pages} availableFlows={availableFlows} onLaunchFlow={onLaunchFlow} reports={reports} metadataLoaded={metadataLoaded} profileId={profileId} canManageUserIdentities={canManageUserIdentities} userRoles={userRoles} fieldAccess={fieldAccess} recordTypeAccess={recordTypeAccess} libraryComponents={libraryComponents} headerSearch={headerSearch} onSearchChange={onSearchChange} navigableObjects={navigableObjects} onNavigate={next => { if (next.kind === 'record-list' && next.objectApiName === object.apiName) { setOverlayRecordId(null); setRefreshKey(current => current + 1); } else if (next.kind === 'record-detail' && next.objectApiName === object.apiName) setOverlayRecordId(next.recordId); else onNavigate(next); }}/>
      </section>
    </div>}
    </div>
    {contextRecord && <ContextMenu x={contextRecord.x} y={contextRecord.y}
      label={`${object.label} actions`} onClose={()=>setContextRecord(null)}
      actions={[
        {id:'open',label:'Open record',onSelect:()=>{
          if(viewportWidth>1200)setOverlayRecordId(contextRecord.item.Id);
          else onNavigate({kind:'record-detail',objectApiName:object.apiName,recordId:contextRecord.item.Id,appId:route.appId});
        }},
        {id:'copy',label:'Copy record link',onSelect:()=>{
          const href=appRoutePath({kind:'record-detail',objectApiName:object.apiName,recordId:contextRecord.item.Id,appId:route.appId});
          void navigator.clipboard.writeText(new URL(href,window.location.origin).toString()).catch(()=>setListNotice('Copy link unavailable in this browser.'));
        }},
        ...(canEdit?[{id:'edit',label:'Edit record',onSelect:()=>openEditForm(contextRecord.item)}]:[]),
        ...(canDelete?[{id:'delete',label:'Delete record',destructive:true,onSelect:()=>void deleteListRecord(contextRecord.item)}]:[])
      ]} />}
    {bulkOwnerDialogOpen && <div className="record-form-backdrop" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !bulkOwnerSaving) setBulkOwnerDialogOpen(false); }}>
      <section className="record-form-dialog surface" role="dialog" aria-modal="true" aria-labelledby="bulk-owner-title">
        <header><div><div className="eyebrow">{object.label}</div><h2 id="bulk-owner-title">Change Owners</h2></div>
          <button className="icon-button" aria-label="Close" disabled={bulkOwnerSaving} onClick={() => setBulkOwnerDialogOpen(false)}><X size={16} /></button>
        </header>
        <form onSubmit={(event) => void saveBulkRecordOwner(event)}>
          <p className="modal-copy">Assign {selectedOwnerChangeIds.length} selected record(s) to a tenant user. Each change checks object permissions and record concurrency.</p>
          <label className="form-label" htmlFor="bulk-owner-select">New owner
            <select id="bulk-owner-select" className="form-control" value={bulkOwnerValue}
              onChange={(event) => setBulkOwnerValue(event.target.value)} disabled={bulkOwnerSaving} required>
              <option value="">Select user…</option>
              {ownerRecords.map((owner) => <option key={owner.Id} value={owner.Id}>{String(owner.Name ?? owner.Email ?? owner.Id)}</option>)}
            </select>
          </label>
          {bulkOwnerError && <div className="records-message" role="alert">{bulkOwnerError}</div>}
          <footer><button className="btn" type="button" disabled={bulkOwnerSaving} onClick={() => setBulkOwnerDialogOpen(false)}>Cancel</button>
            <button className="btn btn-brand" type="submit" disabled={bulkOwnerSaving || !bulkOwnerValue || !selectedOwnerChangeIds.length}>
              {bulkOwnerSaving ? 'Updating…' : 'Assign Selected'}
            </button></footer>
        </form>
      </section>
    </div>}
    {bulkUpdateOpen && <div className="record-form-backdrop" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !bulkUpdating) setBulkUpdateOpen(false); }}>
      <section className="record-form-dialog surface" role="dialog" aria-modal="true" aria-labelledby="bulk-update-title">
        <header><div><div className="eyebrow">{object.label}</div><h2 id="bulk-update-title">Bulk Update</h2></div>
          <button className="icon-button" aria-label="Close" disabled={bulkUpdating} onClick={() => setBulkUpdateOpen(false)}><X size={16} /></button>
        </header>
        <form onSubmit={(event) => void updateSelectedRecords(event)}>
          <p className="modal-copy">Update one metadata field on {selectedEditableRecordIds.length} selected record(s) from this page. Each record is validated independently and existing values on other fields are preserved.</p>
          <label className="form-label" htmlFor="bulk-field">Field
            <select id="bulk-field" className="form-control" value={bulkFieldApiName} disabled={bulkUpdating} required
              onChange={(event) => { setBulkFieldApiName(event.target.value); setBulkFieldValue(''); setBulkFieldBoolean(false); }}>
              {bulkEditableFields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
            </select>
          </label>
          {bulkSelectedField && <label className="form-label" htmlFor="bulk-value">New value
            {/^(?:Checkbox|Boolean)$/i.test(bulkSelectedField.dataType)
              ? <select id="bulk-value" className="form-control" value={String(bulkFieldBoolean)} disabled={bulkUpdating}
                  onChange={(event) => setBulkFieldBoolean(event.target.value === 'true')}>
                  <option value="false">False</option><option value="true">True</option>
                </select>
              : bulkSelectedField.picklistValues?.length && /Picklist/i.test(bulkSelectedField.dataType)
              ? <select id="bulk-value" className="form-control" value={bulkFieldValue} disabled={bulkUpdating}
                  onChange={(event) => setBulkFieldValue(event.target.value)} required>
                  <option value="">Select value…</option>
                  {bulkSelectedField.picklistValues.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              : <input id="bulk-value" className="form-control" disabled={bulkUpdating} value={bulkFieldValue}
                  type={/^(?:Number|Currency|Percent)(?:\(|$)/i.test(bulkSelectedField.dataType) ? 'number'
                    : /^(?:Date\/Time|DateTime)$/i.test(bulkSelectedField.dataType) ? 'datetime-local'
                    : /^Date$/i.test(bulkSelectedField.dataType) ? 'date' : 'text'}
                  step={/^(?:Number|Currency|Percent)(?:\(|$)/i.test(bulkSelectedField.dataType) ? 'any' : undefined}
                  onChange={(event) => setBulkFieldValue(event.target.value)} required />}
          </label>}
          {bulkUpdateError && <div className="records-message" role="alert">{bulkUpdateError}</div>}
          <footer><button type="button" className="btn" disabled={bulkUpdating} onClick={() => setBulkUpdateOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-brand" disabled={bulkUpdating || !selectedEditableRecordIds.length || !bulkSelectedField ||
              (!/^(?:Checkbox|Boolean)$/i.test(bulkSelectedField.dataType) && !bulkFieldValue)}>
              {bulkUpdating ? 'Updating…' : 'Update Selected'}
            </button>
          </footer>
        </form>
      </section>
    </div>}
    {importFileName && <div className="record-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !importSaving) { setImportFileName(''); setImportRows([]); setImportError(''); } }}>
      <section className="record-form-dialog surface" role="dialog" aria-modal="true" aria-labelledby="import-records-title">
        <header><div><div className="eyebrow">{object.label}</div><h2 id="import-records-title">Import Records</h2></div><button className="icon-button" aria-label="Close" disabled={importSaving} onClick={() => { setImportFileName(''); setImportRows([]); setImportError(''); }}><X size={16} /></button></header>
        <form onSubmit={(event) => { event.preventDefault(); void runImport(); }}>
          <p className="modal-copy">{importFileName}: ready to import {importRows.length} record{importRows.length === 1 ? '' : 's'}. CSV headers may use field API names or labels. Include an Id column to update existing records atomically; omit Id to create new records. Review all values before submitting.</p>
          {importRows.length > 0 && <div className="records-table-wrap"><table className="slds-table records-table">
            <thead><tr>{Object.keys(importRows[0]).map((name) => <th key={name}>{object.fields.find((field) => field.apiName === name)?.label ?? name}</th>)}</tr></thead>
            <tbody>{importRows.slice(0, 3).map((row, index) => <tr key={index}>{Object.values(row).map((value, column) => <td key={`${index}-${column}`}>{String(value)}</td>)}</tr>)}</tbody>
          </table></div>}
          {importError && <div className="records-message" role="alert">{importError}</div>}
          <footer><button type="button" className="btn" disabled={importSaving} onClick={() => { setImportFileName(''); setImportRows([]); setImportError(''); }}>Cancel</button><button type="submit" className="btn btn-brand" disabled={importSaving || !importRows.length}>{importSaving ? 'Importing…' : `${Object.hasOwn(importRows[0], 'Id') ? 'Update' : 'Create'} ${importRows.length} Records`}</button></footer>
        </form>
      </section>
    </div>}
    {ownerDialogRecord && ownerField && <div className="record-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !ownerSaving) setOwnerDialogRecord(null); }}>
      <section className="record-form-dialog surface" role="dialog" aria-modal="true" aria-labelledby="change-owner-title">
        <header><div><div className="eyebrow">{object.label}</div><h2 id="change-owner-title">Change Owner</h2></div><button className="icon-button" aria-label="Close" onClick={() => setOwnerDialogRecord(null)} disabled={ownerSaving}><X size={16} /></button></header>
        <form onSubmit={(event) => void saveRecordOwner(event)}>
          <p className="modal-copy">Select a new owner for {String(ownerDialogRecord.Name ?? ownerDialogRecord.Id)}.</p>
          <label className="form-label" htmlFor="change-record-owner">Owner<select className="form-control" id="change-record-owner" value={ownerValue} required disabled={ownerSaving} onChange={(event) => setOwnerValue(event.target.value)}>
            <option value="">Select a user…</option>
            {ownerValue && !ownerRecords.some((user) => user.Id === ownerValue) && <option value={ownerValue}>{ownerValue}</option>}
            {ownerRecords.map((user) => <option key={user.Id} value={user.Id}>{String(user.Name ?? user.Email ?? user.Id)}</option>)}
          </select></label>
          {ownerError && <div className="records-message" role="alert">{ownerError}</div>}
          <footer><button type="button" className="btn" onClick={() => setOwnerDialogRecord(null)} disabled={ownerSaving}>Cancel</button><button type="submit" className="btn btn-brand" disabled={ownerSaving || !ownerValue}>{ownerSaving ? 'Saving…' : 'Change Owner'}</button></footer>
        </form>
      </section>
    </div>}
    
  </div>;
}
return { RecordWorkspace, RecordFormDialog };
}
