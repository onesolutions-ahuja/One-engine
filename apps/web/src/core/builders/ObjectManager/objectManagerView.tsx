import {generateMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import { PicklistValueRows } from './PicklistValueRows';
import {confirmDestructiveAction} from '../../components/ConfirmAction/confirmDestructiveAction';
import '../SharedBuilderFrame/adaptiveBuilder.css';
import '../SchemaBuilder/schemaBuilderUsability.css';
import { createSetupHome } from '../../settings/SetupHome/setupHomeView';
import { relatedListRelationships } from '../PageBuilder/relatedListRelationships';
import { createSettingsViews } from '../../settings/SettingsWorkspace/settingsWorkspaceViews';
import { relatedLookupFilterOperators } from '../../records/RecordWorkspace/recordMetadataUtils';
import { formatRecordValue, parseCsvImport } from '../../records/RecordWorkspace/recordCsvUtils';
import { initialScreenValues, screenFieldIsVisible } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import { objectSettings, recordPageLayoutVariants } from '../../workspace/Navigation/appRouting';
import { NavigationLoadTime, resolveCurrentAppNavigation } from '../../workspace/Navigation/appNavigationView';
import { isStandalonePagePresentation, pageCanvasPresentationStyle } from '../../pages/PageRuntime/pageRuntimePresentation';
import { insertFlowElementAtPath } from '../FlowBuilder/flowInsertElement.mjs';
import AdvancedSharingSettings from '../../security/Permissions/AdvancedSharingSettings';
import {resolveSetupNavigation} from '../../platform/Workspace/platformSetupNavigation';
import {readVerifiedMetadata,saveVerifiedMetadata,type MetadataPublicationResponse} from '../../metadata/Cache/verifiedMetadataCache';
import { queueOfflineRecord, listOfflineRecords, markOfflineRecord, removeOfflineRecord,
  synchronizeOfflineRecords, type OfflineQueueOwner, type OfflineRecordItem, type OfflineRecordWrite } from '../../metadata/Cache/offlineRecordQueue';
import SchemaBuilder from '../SchemaBuilder/SchemaBuilder';
import GlobalValueSetManager from './GlobalValueSetManager';
import QuickActionBindingsEditor from './QuickActionBindingsEditor';
// Global Quick Actions editor is builder-only; load it on its settings tab.
import CustomMetadataManager from './CustomMetadataManager';
import * as React from 'react';
const MatchingRulesPanel = React.lazy(() => import('./MatchingRulesPanel'));
const FieldExactIndexesPanel=React.lazy(()=>import('./FieldExactIndexesPanel'));

const ObjectChangeHistory = React.lazy(() => import('./ObjectChangeHistory'));
const BusinessProcessesPanel=React.lazy(()=>import('./BusinessProcessesPanel'));
const ObjectLabelsPanel=React.lazy(()=>import('./ObjectLabelsPanel'));
const GlobalQuickActionsEditor = React.lazy(() => import('./GlobalQuickActionsEditor'));
const BusinessAutomationsPanel=React.lazy(()=>import('./BusinessAutomationsPanel'));
const DeclarativeRulesPanel=React.lazy(()=>import('./DeclarativeRulesPanel'));
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Database, ExternalLink, Monitor, MoreHorizontal, Pencil, Plus, Smartphone, RefreshCw, Save, Search, SlidersHorizontal, Upload, Trash2, Tablet, X } from 'lucide-react';
import FlowBuilderWorkspace from '../FlowBuilder/FlowBuilder';
import FlowScreenContent from '../../automation/FlowScreen/FlowScreenContent';
import FlowLogs from '../../automation/FlowLogs/FlowLogs';
import FlowInterviews from '../../automation/FlowInterviews/FlowInterviews';
import ScheduledFlows from '../../automation/ScheduledFlows/ScheduledFlows';
import DashboardBuilder from '../DashboardBuilder/DashboardBuilder';
import ComponentLibrary from '../../components/ComponentLibrary/ComponentLibrary';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import CustomComponentPropertyEditor from '../ComponentProperties/CustomComponentPropertyEditor';
import SmartFieldInput from '../../../component-libraries/shared/primitives/SmartFieldInput/SmartFieldInput';
import FlowInputBindingEditor from '../FlowInputBindingEditor/FlowInputBindingEditor';
import RecordFilterEditor from '../../../component-libraries/shared/primitives/RecordFilterEditor/RecordFilterEditor';
import ComponentVisibilityEditor from '../ComponentProperties/ComponentVisibilityEditor';
import PageRouteDirectory from '../../pages/PageRouteDirectory/PageRouteDirectory';
import { isComponentVisible } from '../../components/Properties/componentVisibility';
import PageComponentVisualEditor from '../ComponentStyleEditor/PageComponentVisualEditor';
import { canNestComponent, componentVisualStyle, directChildren, isLayoutType, isDescendantOf, layoutTypes } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import PageComponentStyleEditor from '../ComponentStyleEditor/PageComponentStyleEditor';
import { isCanvasLocked, wrapCanvasComponent, ungroupCanvasComponent } from '../PageBuilder/canvasInteractions';
import { filterPageComponentRecords, needsMetadataComponentRuntime } from '../../pages/PageRuntime/pageComponentBindings';
import { childrenOf, canNest, componentLayoutProps, hasPageComponentAppearance, isLayoutContainer, rawLayoutParentId, reparentComponent, resolvePageComponentStyle, type LayoutDevice } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import AppExchange from '../../applications/AppExchange/AppExchange';
import AppManager from '../../applications/AppManager/AppManager';
import PlatformWorkspaceSurface from '../../platform/Workspace/PlatformWorkspaceSurface'; import {PlatformPageSlot} from '../../platform/Workspace/PlatformPageSlot';
import {GlobalRecordSearch} from '../../../component-libraries/shared/primitives/GlobalRecordSearch/GlobalRecordSearch';
import {RecordObjectPicker} from '../../../component-libraries/shared/primitives/RecordObjectPicker/RecordObjectPicker';
import {useDismissOnOutside} from '../../accessibility/Dismiss/useDismissOnOutside';
import { pageIsAvailableInApp, resolvePageActionRoute } from '../../pages/PageRuntime/pageActionRouting';
import NamedCredentials from '../../integrations/NamedCredentials/NamedCredentials';
import TenantManagement from '../../platform/TenantManagement/TenantManagement';
import TenantDomains from '../../platform/TenantDomains/TenantDomains';
import TenantRecoveryPanel from '../../platform/TenantRecoveryPanel/TenantRecoveryPanel';
import TenantUsagePanel from '../../platform/TenantUsagePanel/TenantUsagePanel';
import DeveloperAccountSettings from '../../settings/DeveloperAccountSettings/DeveloperAccountSettings';
import SettingsViewRow from '../../settings/SettingsViewRow/SettingsViewRow';
import ApprovalProcessManager from '../../automation/ApprovalProcessManager/ApprovalProcessManager';
import { standardPageComponents } from '../../components/Catalog/index';
import EmbeddedDashboard from '../../pages/EmbeddedDashboard/EmbeddedDashboard';
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
} from '../PageBuilder/pageBuilderPalette';
import { defaultLightningPage, type ObjectMetadata, type FieldMetadata, type PageLayoutMetadata, type PageLayoutCustomLinkMetadata, type CompactLayoutMetadata, type RecordTypeMetadata, type RelatedLookupFilterMetadata, type ObjectActionMetadata, type ObjectSettingsMetadata, type ProfileMetadata, type PageActivationAssignmentMetadata, type FlowDefinitionMetadata, type LightningPageMetadata, type PageLayoutVariant, type DashboardMetadata, type ReportMetadata } from '../../metadata/Definitions/metadata';
type FieldTypeMigrationMetadata = {
  id: string;
  fromDataType: string;
  toDataType: string;
  status: 'applied' | 'rolled_back';
  recordsMigrated: number;
  createdAt: string;
  rolledBackAt: string | null;
};
const migrationTypeChoices = [
  'Text(255)', 'Text Area', 'Long Text Area', 'Email', 'Phone', 'URL',
  'Rich Text Area', 'Text (Encrypted)', 'Picklist', 'Multi-Select Picklist',
  'Number(18,0)', 'Currency(18,2)', 'Percent(5,2)', 'Checkbox', 'Date', 'Date/Time',
  'Time', 'Address', 'Geolocation', 'Auto Number', 'Roll-Up Summary',
  'Formula(Text)', 'Formula(Number)', 'Formula(Currency)', 'Formula(Percent)',
  'Formula(Date)', 'Formula(DateTime)', 'Formula(Time)', 'Formula(Checkbox)'
];
function migrationFieldTypeFamily(dataType: string, relationship?: FieldMetadata['relationship']) {
  if (relationship) return 'reference';
  const formula = /^Formula\((Text|Number|Currency|Percent|Date|DateTime|Time|Checkbox)\)$/i.exec(dataType);
  if (formula) return /^(Number|Currency|Percent)$/i.test(formula[1]) ? 'number'
    : formula[1].toLowerCase() === 'checkbox' ? 'boolean' : formula[1].toLowerCase();
  if (/^(Text(?:\(\d+\))?|Text Area|Long Text Area|Rich Text Area|Text \(Encrypted\)|Encrypted Text|Email|Phone|URL|Picklist|Multi-Select Picklist|Auto ?Number)$/i.test(dataType)) return 'text';
  if (/^(Number|Currency|Percent)\(/i.test(dataType) || dataType === 'Roll-Up Summary') return 'number';
  if (dataType === 'Checkbox') return 'boolean';
  if (dataType === 'Date') return 'date';
  if (dataType === 'Date/Time') return 'datetime';
  if (dataType === 'Time') return 'time';
  if (/^(Lookup|Master-Detail|Hierarchical)\([A-Za-z][A-Za-z0-9_]*\)$/i.test(dataType)) return 'reference';
  if (dataType === 'Address') return 'address';
  if (dataType === 'Geolocation') return 'geolocation';
  return null;
}
function fieldTypeMigrationChoices(currentType: string, objects: ObjectMetadata[],
  relationship?: FieldMetadata['relationship']) {
  const source = migrationFieldTypeFamily(currentType, relationship);
  if (!source) return [currentType];
  const relationshipChoices = objects.flatMap((item) => [
    `Lookup(${item.apiName})`, `Master-Detail(${item.apiName})`
  ]);
  const targets = [...migrationTypeChoices, ...relationshipChoices].filter((type) => {
    const target = migrationFieldTypeFamily(type);
    return (target === source
      || (source === 'text' && ['number', 'boolean', 'date', 'datetime', 'time', 'reference', 'address', 'geolocation'].includes(target ?? ''))
      || (target === 'text' && ['number', 'boolean', 'date', 'datetime', 'time', 'reference', 'address', 'geolocation'].includes(source)));
  });
  return [currentType, ...targets.filter((type) => type !== currentType
    && !(/^Auto ?Number$/i.test(type) && /^Auto ?Number$/i.test(currentType)))];
}
export function createObjectManager(apiRequest: <T>(path: string, init?: RequestInit) => Promise<T>) {
function ObjectManager({
  object, objects, flows, pages, reports, dashboards, profiles, activationAppIds, selectedSetting, selectedFieldApiName, search, onSearch, onObjectSelect, onSettingSelect, onOpenDependency, onNewField, onCreateObject, onSaveObject, onRefreshObject, onDeleteObject, onRestoreObject, onSaveField, onDeleteField, onSavePage, onDeleteRecordPage, onOpenRecordPage, onOpenPageBuilder, onOpenRecords, page, onNotify
}: {
  object: ObjectMetadata;
  objects: ObjectMetadata[];
  flows: FlowDefinitionMetadata[];
  pages: LightningPageMetadata[];
  reports: ReportMetadata[];
  dashboards: DashboardMetadata[];
  onOpenDependency: (target: {
    setting?: string;
    objectApiName?: string;
    workspace?: 'flow-builder' | 'page-builder' | 'report-builder' | 'dashboard-builder';
    resourceApiName?: string;
  }) => void;
  profiles: ProfileMetadata[];
  activationAppIds: string[];
  selectedSetting: string;
  selectedFieldApiName?: string;
  search: string;
  onSearch: (value: string) => void;
  onObjectSelect: (object: ObjectMetadata) => void;
  onSettingSelect: (setting: string) => void;
  onNewField: (target?: ObjectMetadata, relatedObjectApi?: string, relationshipType?: 'Lookup Relationship' | 'Master-Detail Relationship') => void;
  onCreateObject: () => void;
  onSaveObject: (object: ObjectMetadata) => Promise<void>;
  onRefreshObject: (apiName: string) => Promise<ObjectMetadata>;
  onDeleteObject: (apiName: string) => Promise<void>;
  onRestoreObject: (apiName: string) => Promise<ObjectMetadata>;
  onSaveField: (field: FieldMetadata) => Promise<ObjectMetadata>;
  onDeleteField: (apiName: string) => Promise<ObjectMetadata>;
  onSavePage: (page: LightningPageMetadata) => Promise<void>;
  onDeleteRecordPage: (pageApiName:string) => Promise<void>;
  onOpenRecordPage: (pageApiName:string, variant:PageLayoutVariant) => void;
  onOpenPageBuilder: () => void;
  onOpenRecords: () => void;
  page: LightningPageMetadata | null;
  onNotify: (message: string) => void;
}) {
  const [viewMode, setViewMode] = useState<'All Objects' | 'Standard Objects' | 'Custom Objects'>('All Objects');
  const [objectListPage,setObjectListPage]=useState(0);
  const [objectSortKey,setObjectSortKey]=useState<'label'|'apiName'|'kind'|'fields'>('label');
  const [objectSortDescending,setObjectSortDescending]=useState(false);
  const objectListScrollRef=useRef<HTMLDivElement>(null);
  const resetObjectListScroll=()=>{
    const list=objectListScrollRef.current;
    if(list)list.scrollTop=0;
    // UX-0034: desktop tables now use the workspace scroller, not an inner
    // overflow host. Clear whichever real scroll container is active.
    const workspace=list?.closest<HTMLElement>('.workspace');
    if(workspace)workspace.scrollTop=0;
    else if(typeof window!=='undefined')window.scrollTo(0,0);
  };
  const changeObjectSort=(key:typeof objectSortKey)=>{if(key===objectSortKey)setObjectSortDescending(value=>!value);else{setObjectSortKey(key);setObjectSortDescending(false);}setObjectListPage(0);resetObjectListScroll();};
  const changeObjectPage=(page:number)=>{setObjectListPage(page);resetObjectListScroll();};
  const objectPageSize=20;
  useEffect(()=>setObjectListPage(0),[viewMode,search]);
  const [sectionMode, setSectionMode] = useState<'list' | 'view' | 'edit'>('list');
  const [selectedMetadataId, setSelectedMetadataId] = useState('');
  const [previewFieldApiName, setPreviewFieldApiName] = useState('');
  useEffect(() => {
    setSectionMode(selectedSetting === 'Details' ? 'view' : 'list');
    setSelectedMetadataId('');
    setPreviewFieldApiName(selectedSetting === 'Fields & Relationships' && object.fields.some(field=>field.apiName===selectedFieldApiName) ? selectedFieldApiName! : '');
    setEditingField(null);
  }, [object.apiName, selectedSetting, selectedFieldApiName]);
  const [showObjectActionsMenu, setShowObjectActionsMenu] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const [draft, setDraft] = useState(object);
  const [selectedLayoutId, setSelectedLayoutId] = useState('');
  const [selectedCompactLayoutId, setSelectedCompactLayoutId] = useState('');
  const [selectedRecordTypeId, setSelectedRecordTypeId] = useState('');
  const [layoutProfileId, setLayoutProfileId] = useState('*');
  const [assignedLayoutId, setAssignedLayoutId] = useState('');
  const [fieldSetLabel, setFieldSetLabel] = useState('');
  const [fieldSetApiName, setFieldSetApiName] = useState('');
  const [recordTypeLabel, setRecordTypeLabel] = useState('');
  const [persistedFieldDependencies, setPersistedFieldDependencies] = useState<Array<{ fieldApiName: string; dependencies: string[] }>>([]);
  const [persistedObjectDependencies, setPersistedObjectDependencies] = useState<string[]>([]);
  const [fieldDependenciesLoading, setFieldDependenciesLoading] = useState(false);
  const [customLinkLabel, setCustomLinkLabel] = useState('');
  const [customLinkUrl, setCustomLinkUrl] = useState('');
  const [customLinkNewWindow, setCustomLinkNewWindow] = useState(false);
  const [customActionLabel, setCustomActionLabel] = useState('');
  const [customActionBehavior, setCustomActionBehavior] = useState<NonNullable<ObjectActionMetadata['behavior']>>('Set Field Value');
  const [newRecordPageName,setNewRecordPageName]=useState('');
  const [newRecordPageMode,setNewRecordPageMode]=useState<'View'|'Edit'>('View');
  const [creatingRecordPage,setCreatingRecordPage]=useState(false);
  const createRecordPage=async()=>{
    const label=newRecordPageName.trim();
    if(!label){onNotify('Enter a Record Page name');return;}
    const prefix=label.replace(/[^A-Za-z0-9_]/g,'_').replace(/^_+|_+$/g,'');
    const stem=prefix&&/^[A-Za-z]/.test(prefix)?prefix.slice(0,60):'Record_'+(prefix||'Page').slice(0,53);
    const apiName=pages.some(candidate=>candidate.apiName===stem)
      ? stem.slice(0,55)+'_'+crypto.randomUUID().replace(/-/g,'').slice(0,12) : stem;
    const template=defaultLightningPage.components.map(component=>({
      ...component,properties:{...component.properties}
    }));
    setCreatingRecordPage(true);
    try{
      await onSavePage({...defaultLightningPage,apiName,label,
        targetObject:draft.apiName,pageType:'Record Page',recordMode:newRecordPageMode,
        status:'Draft',activationAssignments:[],layoutVariant:'Desktop',
        components:template});
      setNewRecordPageName('');
      onNotify('Record Page draft created. Select it to edit and publish its device layouts.');
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to create Record Page');}
    finally{setCreatingRecordPage(false);}
  };
  const [customActionTargetObject, setCustomActionTargetObject] = useState('');
  const [customActionRelationshipField, setCustomActionRelationshipField] = useState('');
  const [customActionFlow, setCustomActionFlow] = useState('');
  const [customActionComponent,setCustomActionComponent] = useState('');
  const [customActionPresentation,setCustomActionPresentation] = useState<'Modal'|'Side Panel'>('Modal');
  const [customActionBindings,setCustomActionBindings] =
    useState<NonNullable<ObjectActionMetadata['componentBindings']>>([]);
  const [actionFlows,setActionFlows] = useState<FlowDefinitionMetadata[]>([]);
  const [actionComponents,setActionComponents] = useState<Array<{apiName:string;label:string}>>([]);
  const [actionFlowError,setActionFlowError] = useState('');
  const [actionComponentError,setActionComponentError] = useState('');
  const [actionOptionsLoading,setActionOptionsLoading] = useState(false);
  useEffect(()=>{
    if(selectedSetting!=='Buttons, Links, and Actions')return;
    let alive=true;setActionOptionsLoading(true);setActionFlowError('');setActionComponentError('');
    void Promise.allSettled([
      apiRequest<{flows:FlowDefinitionMetadata[]}>('/metadata/flows'),
      apiRequest<{components:Array<{apiName:string;label:string;status?:string;surfaces?:string[]}>;
        registered:Array<{apiName:string}>}>('/component-library')
    ]).then(([flowResult,componentResult])=>{
      if(!alive)return;
      if(flowResult.status==='fulfilled')setActionFlows(flowResult.value.flows??[]);
      else setActionFlowError('Unable to load Flows. Check Flow metadata permissions or retry.');
      if(componentResult.status==='fulfilled'){
        const custom=(componentResult.value.components??[]).filter(c=>
          (c.status==='Published'||Boolean((c as typeof c&{publishedVersion?:number}).publishedVersion))
          &&(!c.surfaces||c.surfaces.includes('platform')||c.surfaces.includes('page')));
        const names=new Set(custom.map(c=>c.apiName));
        setActionComponents([...custom.map(c=>({apiName:c.apiName,label:c.label})),
          ...(componentResult.value.registered??[]).filter(c=>!names.has(c.apiName))
            .map(c=>({apiName:c.apiName,label:c.apiName}))]);
      }else setActionComponentError('Unable to load Components. Check Component metadata permissions.');
      setActionOptionsLoading(false);
    });
    return ()=>{alive=false;};
  },[selectedSetting]);
  const [customActionFieldApiName, setCustomActionFieldApiName] = useState('');
  const [customActionValue, setCustomActionValue] = useState('');
  const [recordTypePicklistDrafts, setRecordTypePicklistDrafts] = useState<Record<string, string>>({});
  const [filterField, setFilterField] = useState('');
  const [filterRelatedField, setFilterRelatedField] = useState('');
  const [filterOperator, setFilterOperator] = useState<RelatedLookupFilterMetadata['operator']>('Equals');
  const [filterValue, setFilterValue] = useState('');
  const [filterValueMode, setFilterValueMode] = useState<'Value' | 'Field'>('Value');
  const [filterValueFieldApiName, setFilterValueFieldApiName] = useState('');
  const [filterRelatedObject, setFilterRelatedObject] = useState('');
  const [editingField, setEditingField] = useState<FieldMetadata | null>(null);
  const [fieldTypeMigrations, setFieldTypeMigrations] = useState<FieldTypeMigrationMetadata[]>([]);
  const [fieldTypeMigrationsLoading, setFieldTypeMigrationsLoading] = useState(false);
  const [showDependencies, setShowDependencies] = useState(false);
  const [deletedFields, setDeletedFields] = useState<Array<{
    apiName: string; label: string; dataType: string; deletedAt: string; expiresAt: string;
  }>>([]);
  const [deletedFieldsOpen, setDeletedFieldsOpen] = useState(false);
  const [deletedFieldsLoading, setDeletedFieldsLoading] = useState(false);
  const [activationScope, setActivationScope] = useState<PageActivationAssignmentMetadata['scope']>('Org Default');
  const [activationAppId, setActivationAppId] = useState('');
  const [activationProfileId, setActivationProfileId] = useState('');
  const [activationFormFactors, setActivationFormFactors] = useState<Array<'Desktop' | 'Phone' | 'Tablet' | 'Custom'>>(['Desktop']);
  const [showDeleteObjectConfirmation, setShowDeleteObjectConfirmation] = useState(false);
  const [deleteImpact,setDeleteImpact]=useState<Array<{kind:string;count:number}>|null>(null);
  const [deleteRecordCount,setDeleteRecordCount]=useState(0);
  const [deletedObjects,setDeletedObjects]=useState<Array<{apiName:string;label:string;deletedAt:string}>>([]);
  const [deletedObjectsOpen,setDeletedObjectsOpen]=useState(false);
  const [deletedObjectsBusy,setDeletedObjectsBusy]=useState(false);
  const showDeletedObjects=async()=>{
    if(deletedObjectsOpen){setDeletedObjectsOpen(false);return;}
    setDeletedObjectsBusy(true);
    try{
      const result=await apiRequest<{objects:typeof deletedObjects}>('/metadata/objects/deleted');
      setDeletedObjects(result.objects);
      setDeletedObjectsOpen(true);
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to list deleted objects');}
    finally{setDeletedObjectsBusy(false);}
  };
  const openDeleteObject=async()=>{
    try{
      const impact=await apiRequest<{blockers:Array<{kind:string;count:number}>;recordCount:number}>(
        `/metadata/objects/${encodeURIComponent(draft.apiName)}/impact`);
      setDeleteImpact(impact.blockers);
      setDeleteRecordCount(impact.recordCount);
      setShowDeleteObjectConfirmation(true);
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to inspect object deletion impact');}
  };
  const [showDeleteFieldConfirmation, setShowDeleteFieldConfirmation] = useState(false);
  const validateDraft = async () => {
    try {
      const result = await apiRequest<{ valid: boolean; errors: string[] }>(
        `/metadata/objects/${encodeURIComponent(object.apiName)}/validate`,
        { method: 'POST', headers: { 'If-Match': `"${draft.revision ?? 0}"` }, body: JSON.stringify(draft) }
      );
      onNotify(result.valid ? 'Draft metadata validation passed' : result.errors.join('; '));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Draft metadata validation failed');
    }
  };
  useEffect(() => {
    setDraft(object);
    setDeletedFields([]);
    setDeletedFieldsOpen(false);
    setRecordTypePicklistDrafts(Object.fromEntries((object.recordTypes ?? []).flatMap((recordType) =>
      object.fields.filter((field) => field.dataType === 'Picklist' || field.dataType === 'Multi-Select Picklist').map((field) => [
        `${recordType.id}.${field.apiName}`,
        (recordType.picklistValues?.[field.apiName] ?? field.picklistValues ?? []).join('\n')
      ])
    )));
    setSelectedLayoutId(object.pageLayouts?.[0]?.id ?? '');
    setSelectedCompactLayoutId(object.compactLayouts?.[0]?.id ?? `${object.apiName}-compact-default`);
    setSelectedRecordTypeId(object.recordTypes?.find((item) => item.isDefault)?.id ?? object.recordTypes?.[0]?.id ?? '');
    setLayoutProfileId(object.pageLayoutAssignments?.[0]?.profileId ?? '*');
    setAssignedLayoutId(object.pageLayoutAssignments?.[0]?.pageLayoutId ?? object.pageLayouts?.[0]?.id ?? '');
    setFilterField('');
    setFilterRelatedField('');
    setFilterRelatedObject('');
    setFilterOperator('Equals');
    setFilterValue('');
    setFilterValueMode('Value');
    setFilterValueFieldApiName('');
  }, [object]);
  useEffect(() => {
    if (!editingField) {
      setFieldTypeMigrations([]);
      return;
    }
    let active = true;
    setFieldTypeMigrationsLoading(true);
    void apiRequest<{ migrations: FieldTypeMigrationMetadata[] }>(
      `/metadata/objects/${encodeURIComponent(object.apiName)}/fields/${encodeURIComponent(editingField.apiName)}/migrations`
    ).then((result) => {
      if (active) setFieldTypeMigrations(result.migrations);
    }).catch((error: unknown) => {
      if (active) onNotify(error instanceof Error ? error.message : 'Field migration history could not be loaded');
    }).finally(() => {
      if (active) setFieldTypeMigrationsLoading(false);
    });
    return () => { active = false; };
  }, [editingField?.apiName, object.apiName]);
  const rollbackFieldMigration = async (migrationId: string) => {
    if (!editingField) return;
    try {
      const result = await apiRequest<{ object: ObjectMetadata }>(
        `/metadata/objects/${encodeURIComponent(object.apiName)}/fields/${encodeURIComponent(editingField.apiName)}/migrations/${encodeURIComponent(migrationId)}/rollback`,
        { method: 'POST' }
      );
      const refreshed = await onRefreshObject(object.apiName);
      const field = refreshed.fields.find((candidate) => candidate.apiName === editingField.apiName);
      if (field) setEditingField(field);
      setDraft(result.object);
      const history = await apiRequest<{ migrations: FieldTypeMigrationMetadata[] }>(
        `/metadata/objects/${encodeURIComponent(object.apiName)}/fields/${encodeURIComponent(editingField.apiName)}/migrations`
      );
      setFieldTypeMigrations(history.migrations);
      onNotify('Field type migration rolled back');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Field type migration could not be rolled back');
    }
  };
  useEffect(() => {
    if (layoutProfileId !== '*' && !profiles.some((profile) => profile.id === layoutProfileId)) setLayoutProfileId('*');
  }, [layoutProfileId, profiles]);
  const visibleObjects = objects.filter((item) => (viewMode === 'All Objects'
    || (viewMode === 'Custom Objects' ? item.kind === 'Custom Object' : item.kind === 'Standard Object'))
    && `${item.label} ${item.apiName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const sortedVisibleObjects = [...visibleObjects].sort((a, b) => {
    const result=objectSortKey==='fields'?a.fields.length-b.fields.length:objectSortKey==='kind'?a.kind.localeCompare(b.kind):objectSortKey==='apiName'?a.apiName.localeCompare(b.apiName):a.label.localeCompare(b.label);
    return objectSortDescending?-result:result;
  });
  const showDescriptionColumn=sortedVisibleObjects.some(item=>Boolean(item.description?.trim()));
  const showDeploymentColumn=sortedVisibleObjects.some(item=>Boolean(item.settings?.deploymentStatus&&item.settings.deploymentStatus!=='Deployed'));
  const objectPageCount=Math.max(1,Math.ceil(sortedVisibleObjects.length/objectPageSize));
  const currentObjectPage=Math.min(objectListPage,objectPageCount-1);
  const paginatedObjects=sortedVisibleObjects.slice(currentObjectPage*objectPageSize,(currentObjectPage+1)*objectPageSize);
  const loadDeletedFields = async () => {
    setDeletedFieldsLoading(true);
    try {
      const result = await apiRequest<{ fields: typeof deletedFields }>(
        `/metadata/objects/${encodeURIComponent(object.apiName)}/deleted-fields`
      );
      setDeletedFields(result.fields);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Deleted fields could not be loaded');
    } finally {
      setDeletedFieldsLoading(false);
    }
  };
  const restoreDeletedField = async (apiName: string) => {
    try {
      await apiRequest<{ object: ObjectMetadata }>(
        `/metadata/objects/${encodeURIComponent(object.apiName)}/fields/${encodeURIComponent(apiName)}/restore`,
        { method: 'POST' }
      );
      await onRefreshObject(object.apiName);
      await loadDeletedFields();
      onNotify(`${apiName} restored`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Field could not be restored');
    }
  };
  const fields = draft.fields
    .filter((field) => `${field.label} ${field.apiName} ${field.dataType}`.toLowerCase().includes(fieldSearch.toLowerCase()))
    .sort((left, right) => left.label.localeCompare(right.label));
  const editingNumericFormat = editingField?.dataType.match(/^(?:Number|Currency|Percent)\((\d+),\s*(\d+)\)$/);
  const editingNumericMaximum = editingNumericFormat
    ? 10 ** (Number(editingNumericFormat[1]) - Number(editingNumericFormat[2])) - 10 ** -Number(editingNumericFormat[2])
    : undefined;
  const editingTextMaximum = editingField?.dataType.match(/^Text\((\d+)\)$/)?.[1];
  const hasFieldReference = (value: unknown, apiName: string): boolean => {
    if (typeof value === 'string') return new RegExp(`(^|[^A-Za-z0-9_])${apiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`).test(value);
    if (Array.isArray(value)) return value.some((item) => hasFieldReference(item, apiName));
    if (value && typeof value === 'object') return Object.values(value).some((item) => hasFieldReference(item, apiName));
    return false;
  };
  type DependencyTarget = {
    setting?: string;
    objectApiName?: string;
    workspace?: 'flow-builder' | 'page-builder' | 'report-builder' | 'dashboard-builder';
    resourceApiName?: string;
  };
  type FieldDependency = {
    dependent: string;
    dependency: string;
    kind: string;
    target?: DependencyTarget;
  };
  const dependencies: FieldDependency[] = [];
  const addDependency = (dependent: string, dependency: string, kind: string, target?: DependencyTarget) => {
    if (dependencies.some((item) => item.dependent === dependent
      && item.dependency === dependency && item.kind === kind)) return;
    dependencies.push({ dependent, dependency, kind, target });
  };
  for (const field of draft.fields) {
    if (field.formula) {
      for (const candidate of draft.fields.filter((candidate) =>
        candidate.apiName !== field.apiName && hasFieldReference(field.formula?.expression, candidate.apiName))) {
        addDependency(field.label, candidate.apiName, 'Formula', { setting: 'Fields & Relationships' });
      }
    }
    if (field.controllerFieldApiName) {
      addDependency(field.label, field.controllerFieldApiName, 'Picklist Dependency', { setting: 'Fields & Relationships' });
    }
    if (field.relationship) {
      addDependency(field.label, field.relationship.targetObject, field.relationship.type, {
        setting: 'Fields & Relationships',
        objectApiName: field.relationship.targetObject
      });
    }
  }
  for (const layout of draft.pageLayouts ?? []) {
    for (const section of layout.sections) {
      for (const fieldApiName of section.fieldApiNames) {
        if (draft.fields.some((field) => field.apiName === fieldApiName)) {
          addDependency(layout.label, fieldApiName, 'Page Layout', { setting: 'Page Layouts' });
        }
      }
    }
  }
  for (const parentObject of objects) {
    for (const layout of parentObject.pageLayouts ?? []) {
      for (const relatedList of layout.relatedLists) {
        const relationshipField = draft.fields.find((field) =>
          field.relationship?.targetObject === parentObject.apiName
          && field.relationship.childRelationshipName === relatedList);
        if (relationshipField) {
          addDependency(`${parentObject.label}: ${layout.label}`, relationshipField.apiName, 'Related List', {
            setting: 'Page Layouts',
            objectApiName: parentObject.apiName
          });
        }
      }
    }
  }
  for (const fieldApiName of draft.compactLayout?.fieldApiNames ?? []) {
    addDependency('System Default Compact Layout', fieldApiName, 'Compact Layout', { setting: 'Compact Layouts' });
  }
  for (const compactLayout of draft.compactLayouts ?? []) {
    for (const fieldApiName of compactLayout.fieldApiNames) {
      addDependency(compactLayout.label, fieldApiName, 'Compact Layout', { setting: 'Compact Layouts' });
    }
  }
  for (const fieldSet of draft.fieldSets ?? []) {
    for (const fieldApiName of fieldSet.fieldApiNames) {
      addDependency(fieldSet.label, fieldApiName, 'Field Set', { setting: 'Field Sets' });
    }
  }
  for (const recordType of draft.recordTypes ?? []) {
    for (const fieldApiName of Object.keys(recordType.picklistValues ?? {})) {
      addDependency(recordType.label, fieldApiName, 'Record Type Picklist Values', { setting: 'Record Types' });
    }
  }
  for (const [layoutKey, fieldApiNames] of Object.entries(draft.searchLayouts ?? {})) {
    if (!Array.isArray(fieldApiNames)) continue;
    for (const item of fieldApiNames) {
      const fieldApiName=typeof item==='string'?item
        :item&&typeof item==='object'&&'fieldApiName' in item&&typeof item.fieldApiName==='string'
          ?item.fieldApiName:undefined;
      if(fieldApiName)addDependency(layoutKey, fieldApiName, 'Search Layout', { setting: 'Search Layouts' });
    }
  }
  for (const action of draft.actions ?? []) {
    if (action.type === 'Custom' && action.fieldApiName) {
      addDependency(action.label, action.fieldApiName, 'Custom Object Action', { setting: 'Buttons, Links, and Actions' });
    }
  }
  for (const candidate of objects) {
    for (const filter of candidate.relatedLookupFilters ?? []) {
      if (candidate.apiName === draft.apiName && filter.fieldApiName
        && draft.fields.some((field) => field.apiName === filter.fieldApiName)) {
        addDependency(`Lookup filter on ${candidate.label}`, filter.fieldApiName, 'Related Lookup Filter', {
          setting: 'Related Lookup Filters',
          objectApiName: candidate.apiName
        });
      }
      if (candidate.apiName === draft.apiName && filter.valueFieldApiName
        && draft.fields.some((field) => field.apiName === filter.valueFieldApiName)) {
        addDependency(`Lookup filter on ${candidate.label}`, filter.valueFieldApiName, 'Related Lookup Filter', {
          setting: 'Related Lookup Filters',
          objectApiName: candidate.apiName
        });
      }
      if (filter.relatedObject === draft.apiName
        && draft.fields.some((field) => field.apiName === filter.relatedFieldApiName)) {
        addDependency(`Lookup filter on ${candidate.label}`, filter.relatedFieldApiName, 'Related Lookup Filter', {
          setting: 'Related Lookup Filters',
          objectApiName: candidate.apiName
        });
      }
    }
  }
  for (const flow of flows) {
    const referencesObject = flow.triggerObject === draft.apiName
      || hasFieldReference([flow.startConfig, flow.elements.map((element) => element.config)], draft.apiName)
      || flow.resources.some((resource) => resource.dataType === draft.apiName);
    if (referencesObject) {
      for (const field of draft.fields.filter((candidate) =>
        hasFieldReference([flow.startConfig, flow.elements.map((element) => element.config), flow.resources], candidate.apiName))) {
        addDependency(flow.label, field.apiName, 'Flow', { workspace: 'flow-builder', resourceApiName: flow.apiName });
      }
    }
  }
  for (const candidate of pages) {
    for (const field of draft.fields) {
      if (candidate.targetObject === draft.apiName
        && candidate.components.some((component) => hasFieldReference(component.properties, field.apiName))) {
        addDependency(candidate.label, field.apiName, 'Lightning Page', {
          workspace: 'page-builder',
          resourceApiName: candidate.apiName
        });
      }
    }
  }
  for (const report of reports) {
    for (const field of draft.fields) {
      const referencesBaseField = report.objectApiName === draft.apiName && (
        report.fieldApiNames.includes(field.apiName)
        || report.groupByFieldApiNames.includes(field.apiName)
        || report.columnGroupByFieldApiName === field.apiName
        || report.sortFieldApiName === field.apiName
        || report.rowLimit.sortFieldApiName === field.apiName
        || report.filters.some((filter) => filter.fieldApiName === field.apiName)
        || report.standardFilters.dateFieldApiName === field.apiName
      );
      const referencesCrossFilter = report.crossFilters.some((crossFilter) =>
        crossFilter.childObjectApiName === draft.apiName
        && crossFilter.filters.some((filter) => filter.fieldApiName === field.apiName));
      if (referencesBaseField || referencesCrossFilter) {
        addDependency(report.label, field.apiName, 'Report', { workspace: 'report-builder', resourceApiName: report.apiName });
      }
    }
  }
  for (const dashboard of dashboards) {
    for (const filter of dashboard.filters) {
      if (filter.objectApiName === draft.apiName && draft.fields.some((field) => field.apiName === filter.fieldApiName)) {
        addDependency(dashboard.label, filter.fieldApiName, 'Dashboard Filter', {
          workspace: 'dashboard-builder',
          resourceApiName: dashboard.apiName
        });
      }
    }
    for (const component of dashboard.components) {
      for (const field of draft.fields) {
        if (component.objectApiName === draft.apiName
          && (component.measureFieldApiName === field.apiName
            || component.groupByFieldApiName === field.apiName
            || component.xAxisFieldApiName === field.apiName
            || component.displayFieldApiNames.includes(field.apiName)
            || hasFieldReference(component.properties, field.apiName))) {
          addDependency(dashboard.label, field.apiName, 'Dashboard Component', {
            workspace: 'dashboard-builder',
            resourceApiName: dashboard.apiName
          });
        }
      }
    }
  }
  const layouts = draft.pageLayouts ?? [];
  const compactLayouts = draft.compactLayouts ?? [];
  const relatedListOptions = relatedListRelationships(objects, draft.apiName).map((item) => ({
    value: item.childRelationshipName,
    alias: item.pluralLabel,
    label: `${item.pluralLabel} (${item.childRelationshipName})`
  })).filter((option, index, options) =>
    options.findIndex((candidate) => candidate.value.toLocaleLowerCase() === option.value.toLocaleLowerCase()) === index);
  const normalizeRelatedLists = (selected: string[]) => selected.map((name) =>
    relatedListOptions.find((option) => option.value.toLocaleLowerCase() === name.toLocaleLowerCase()
      || option.alias.toLocaleLowerCase() === name.toLocaleLowerCase())?.value ?? name
  );
  const recordTypes = draft.recordTypes ?? [];
  const selectedLayout = layouts.find((layout) => layout.id === selectedLayoutId) ?? layouts[0];
  const updateDraft = (update: Partial<ObjectMetadata>) => setDraft((current) => ({ ...current, ...update }));
  const updateObjectSettings = (update: Partial<ObjectSettingsMetadata>) => updateDraft({
    fields: update.trackFieldHistory === false
      ? draft.fields.map((field) => ({ ...field, trackHistory: false }))
      : draft.fields,
    settings: {
      allowReports: true,
      allowActivities: true,
      trackFieldHistory: false,
      allowInChatter: false,
      allowSearch: true,
      deploymentStatus: 'Deployed',
      recordNameType: 'Text',
      recordNameFormat: '',
      ...draft.settings,
      ...update
    }
  });
  const persistDraft = () => {
    void onSaveObject(draft).then(() => {
      setSectionMode(selectedMetadataId ? 'view' : selectedSetting === 'Details' ? 'view' : 'list');
    }).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to save object configuration'));
  };
  const refreshObject = () => {
    void onRefreshObject(draft.apiName).then(setDraft).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to refresh object metadata'));
  };
  const toggleFieldDependencies = async () => {
    if (showDependencies) {
      setShowDependencies(false);
      return;
    }
    setShowDependencies(true);
    setFieldDependenciesLoading(true);
    try {
      const [fieldPayload, objectPayload] = await Promise.all([
        apiRequest<{ fields: Array<{ fieldApiName: string; dependencies: string[] }> }>(
          `/metadata/objects/${encodeURIComponent(draft.apiName)}/field-dependencies`
        ),
        apiRequest<{ dependencies: string[] }>(
          `/metadata/objects/${encodeURIComponent(draft.apiName)}/dependencies`
        )
      ]);
      setPersistedFieldDependencies(fieldPayload.fields);
      setPersistedObjectDependencies(objectPayload.dependencies);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to load field dependencies');
    } finally {
      setFieldDependenciesLoading(false);
    }
  };
  const confirmDeleteObject = async () => {
    if(deleteImpact===null||deleteImpact.length>0)return;
    try {
      await onDeleteObject(draft.apiName);
      setShowDeleteObjectConfirmation(false);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to delete object');
    }
  };
  const updateLayout = (id: string, update: Partial<PageLayoutMetadata>) => updateDraft({
    pageLayouts: layouts.map((layout) => layout.id === id ? { ...layout, ...update } : layout)
  });
  const updateCompactLayout = (id: string, update: Partial<CompactLayoutMetadata>) => updateDraft({
    compactLayouts: compactLayouts.map((layout) => layout.id === id ? { ...layout, ...update } : layout)
  });
  const addCompactLayout = () => {
    const id = crypto.randomUUID();
    const compactLayout = { id, label: 'New Compact Layout', fieldApiNames: [] };
    updateDraft({ compactLayouts: [...compactLayouts, compactLayout] });
    setSelectedCompactLayoutId(id);
  };
  const removeCompactLayout = (id: string) => {
    if (compactLayouts.length <= 1) {
      onNotify('Each object must keep at least one compact layout');
      return;
    }
    const remaining = compactLayouts.filter((layout) => layout.id !== id);
    updateDraft({
      compactLayouts: remaining,
      compactLayoutAssignments: (draft.compactLayoutAssignments ?? []).filter((assignment) => assignment.compactLayoutId !== id)
    });
    if (selectedCompactLayoutId === id) setSelectedCompactLayoutId(remaining[0]?.id ?? '');
  };
  const saveCompactLayoutAssignment = () => {
    if (!selectedRecordTypeId || !selectedCompactLayoutId) return;
    const profileId = layoutProfileId.trim() || '*';
    const assignment = { profileId, recordTypeId: selectedRecordTypeId, compactLayoutId: selectedCompactLayoutId };
    updateDraft({
      compactLayoutAssignments: [
        ...(draft.compactLayoutAssignments ?? []).filter((item) => item.recordTypeId !== selectedRecordTypeId || item.profileId !== profileId),
        assignment
      ]
    });
  };
  const toggleRelatedList = (layout: PageLayoutMetadata, value: string) => {
    const selected = normalizeRelatedLists(layout.relatedLists);
    updateLayout(layout.id, {
      relatedLists: selected.includes(value) ? selected.filter((name) => name !== value) : [...selected, value]
    });
  };
  const updateRelatedListSettings=(layout:PageLayoutMetadata,name:string,
    update:NonNullable<PageLayoutMetadata['relatedListSettings']>[string])=>{
    const existing=layout.relatedListSettings??{};
    updateLayout(layout.id,{relatedListSettings:{...existing,[name]:{...existing[name],...update}}});
  };
  const updateCustomLink = (layout: PageLayoutMetadata, linkId: string, update: Partial<PageLayoutCustomLinkMetadata>) => {
    updateLayout(layout.id, {
      customLinks: (layout.customLinks ?? []).map((link) => link.id === linkId ? { ...link, ...update } : link)
    });
  };
  const addCustomLink = (layout: PageLayoutMetadata) => {
    if (!customLinkLabel.trim() || !customLinkUrl.trim()) {
      onNotify('Enter a label and URL for the custom link');
      return;
    }
    const link: PageLayoutCustomLinkMetadata = {
      id: crypto.randomUUID(),
      label: customLinkLabel.trim(),
      url: customLinkUrl.trim(),
      openInNewWindow: customLinkNewWindow
    };
    updateLayout(layout.id, { customLinks: [...(layout.customLinks ?? []), link] });
    setCustomLinkLabel('');
    setCustomLinkUrl('');
    setCustomLinkNewWindow(false);
  };
  const saveLayoutAssignment = () => {
    if (!selectedRecordTypeId || !assignedLayoutId) return;
    const profileId = layoutProfileId.trim() || '*';
    const assignments = draft.pageLayoutAssignments ?? [];
    const assignment = { profileId, recordTypeId: selectedRecordTypeId, pageLayoutId: assignedLayoutId };
    updateDraft({
      pageLayoutAssignments: [...assignments.filter((item) => item.recordTypeId !== selectedRecordTypeId || item.profileId !== profileId), assignment]
    });
  };
  const addLayout = () => {
    const id = `${draft.apiName}-layout-${Date.now()}`;
    const nameField = draft.fields.find((field) => field.apiName === 'Name')?.apiName ?? draft.fields[0]?.apiName;
    const layout: PageLayoutMetadata = {
      id, label: 'New Page Layout', sections: [{ id: `${id}-section`, label: 'Record Information', columns: 2, fieldApiNames: nameField ? [nameField] : [] }],
      relatedLists: [], actions: ['New', 'Edit', 'Delete'], customLinks: []
    };
    updateDraft({ pageLayouts: [...layouts, layout] });
    setSelectedLayoutId(id);
  };
  const removeLayout = (id: string) => {
    if (layouts.length <= 1) {
      onNotify('Each object must keep at least one page layout');
      return;
    }
    const remaining = layouts.filter((layout) => layout.id !== id);
    updateDraft({
      pageLayouts: remaining,
      pageLayoutAssignments: (draft.pageLayoutAssignments ?? []).filter((assignment) => assignment.pageLayoutId !== id)
    });
    if (selectedLayoutId === id) setSelectedLayoutId(remaining[0]?.id ?? '');
  };
  const removeRecordType = (id: string) => {
    if (recordTypes.length <= 1) {
      onNotify('Each object must keep at least one record type');
      return;
    }
    const assignedPageLayout = draft.pageLayoutAssignments?.find((assignment) => assignment.recordTypeId === id);
    if (assignedPageLayout) {
      onNotify('Remove this record type’s page layout assignment before deleting it');
      return;
    }
    const assignedCompactLayout = draft.compactLayoutAssignments?.find((assignment) => assignment.recordTypeId === id);
    if (assignedCompactLayout) {
      onNotify('Remove this record type’s compact layout assignment before deleting it');
      return;
    }
    const remaining = recordTypes.filter((recordType) => recordType.id !== id);
    const removedDefault = recordTypes.find((recordType) => recordType.id === id)?.isDefault;
    updateDraft({
      recordTypes: removedDefault ? remaining.map((recordType, index) => ({ ...recordType, isDefault: index === 0 })) : remaining
    });
    if (selectedRecordTypeId === id) setSelectedRecordTypeId(remaining[0]?.id ?? '');
  };
  const addRecordType = () => {
    const label = recordTypeLabel.trim();
    if (!label) return;
    const id = `${draft.apiName}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (recordTypes.some((recordType) => recordType.id === id)) {
      onNotify('A record type with this name already exists');
      return;
    }
    const developerName = generateMetadataApiName(label) || 'RecordType';
    if (recordTypes.some((item) => item.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase()
      || item.developerName.toLocaleLowerCase() === developerName.toLocaleLowerCase())) {
      onNotify('A record type with this label or developer name already exists');
      return;
    }
    const recordType: RecordTypeMetadata = { id, label, developerName, description: '', active: true, isDefault: recordTypes.length === 0 };
    updateDraft({ recordTypes: [...recordTypes, recordType] });
    setSelectedRecordTypeId(id);
    setRecordTypeLabel('');
  };
  const toggleField = (selected: string[], apiName: string) => selected.includes(apiName)
    ? selected.filter((name) => name !== apiName)
    : [...selected, apiName];
  const renderDetails = () => (
    <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Edit Details</h2><p>Update the object definition.</p></div><div className="toolbar-actions">
        <button className="btn" type="button" onClick={() => {setDraft(object);setSectionMode('view');}}>Cancel</button>
        {draft.kind === 'Custom Object' && <button className="btn" onClick={() => void openDeleteObject()}><Trash2 size={14} />Delete</button>}
        <button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div></div>
      <div className="object-edit-form">
        <PlatformPageSlot slotKey="field-object-01"><label className="form-label">Label<input className="form-control" value={draft.label} onChange={(event) => updateDraft({ label: event.target.value })} /></label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-object-02"><label className="form-label">Plural Label<input className="form-control" value={draft.pluralLabel} onChange={(event) => updateDraft({ pluralLabel: event.target.value })} /></label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-object-03"><label className="form-label">Object Name<div className="form-display">{draft.apiName}</div></label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-object-04"><label className="form-label">Description<textarea className="form-control" rows={4} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} /></label></PlatformPageSlot>
        <label className="form-label">Help Text<textarea className="form-control" rows={3} maxLength={1000} value={draft.helpText ?? ''} onChange={(event) => updateDraft({ helpText: event.target.value })} /></label>
        <div className="form-display">Object Type: {draft.kind}</div>
        <div className="metadata-card"><h3>Object Features</h3>{([
          ['allowReports', 'Allow Reports'],
          ['allowActivities', 'Allow Activities'],
          ['trackFieldHistory', 'Track Field History'],
          ['allowInChatter', 'Allow in Chatter'],
          ['allowSearch', 'Allow Search']
        ] as const).map(([key, label]) => <label className="metadata-row" key={key}><span>{label}</span><input type="checkbox" checked={draft.settings?.[key] ?? false} onChange={(event) => updateObjectSettings({ [key]: event.target.checked })} /></label>)}
          <PlatformPageSlot slotKey="field-object-05"><label className="form-label">Deployment Status<select className="form-control" value={draft.settings?.deploymentStatus ?? 'Deployed'} onChange={(event) => updateObjectSettings({ deploymentStatus: event.target.value as ObjectSettingsMetadata['deploymentStatus'] })}><option>In Development</option><option>Deployed</option></select></label></PlatformPageSlot>
          <label className="form-label">Record Name Type<select className="form-control"
            value={draft.settings?.recordNameType ?? 'Text'}
            onChange={(event) => updateObjectSettings({
              recordNameType: event.target.value as ObjectSettingsMetadata['recordNameType'],
              recordNameFormat: event.target.value === 'Auto Number' ? draft.settings?.recordNameFormat ?? '{0000}' : ''
            })}>
            <option value="Text">Text</option>
            {['AutoNumber','Auto Number'].includes(draft.fields.find((field) => field.apiName === 'Name')?.dataType ?? '')
              && <option value="Auto Number">Auto Number</option>}
          </select></label>
          {draft.settings?.recordNameType === 'Auto Number' && <label className="form-label">Auto Number Format
            <input className="form-control" maxLength={80} value={draft.settings.recordNameFormat ?? '{0000}'}
              onChange={(event) => updateObjectSettings({ recordNameFormat: event.target.value })} />
          </label>}
          <div className="info-callout">Record name: {draft.fields.find((field) => field.apiName === 'Name')?.label ?? 'Name'} · {draft.settings?.recordNameType ?? 'Text'}{draft.settings?.recordNameFormat ? ` · ${draft.settings.recordNameFormat}` : ''}</div>
        </div>
      </div>
      <React.Suspense fallback={<p>Loading translations…</p>}>
        <ObjectLabelsPanel object={draft}/>
      </React.Suspense>
      {showDeleteObjectConfirmation && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDeleteObjectConfirmation(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-object-title">
          <div className="modal-header"><h2 id="delete-object-title">Delete {draft.label}?</h2><button className="icon-button dark" onClick={() => setShowDeleteObjectConfirmation(false)} aria-label="Close"><X size={18} /></button></div>
          <p className="modal-copy">The object will be hidden but its metadata and records preserved for restoration. Cross-object dependencies still block deletion.</p>
          {deleteImpact===null?<p>Checking dependencies…</p>:deleteImpact.length>0
            ?<div role="alert"><strong>Deletion blocked by dependencies:</strong><ul>{deleteImpact.map(item=>
              <li key={item.kind}>{item.kind}: {item.count}</li>)}</ul></div>
            :<p>No blocking references found. {deleteRecordCount} existing record(s) will remain stored and will be accessible again when the object is restored.</p>}
          <div className="modal-actions"><button className="btn" onClick={() => setShowDeleteObjectConfirmation(false)}>Cancel</button><button className="btn btn-brand" disabled={deleteImpact===null||deleteImpact.length>0} onClick={() => void confirmDeleteObject()}>Delete Object</button></div>
        </section>
      </div>}
    </section>
  );
  const renderFields = () => (
    <>
      <div className="section-toolbar"><div><h2>Fields & Relationships</h2><p>Typed fields, formulas, and object relationships for {draft.label} records.</p></div><div className="toolbar-actions"><button className="btn" onClick={() => void toggleFieldDependencies()}><SlidersHorizontal size={14} />Metadata Dependencies</button><button className="btn btn-brand" onClick={() => onNewField()}><Plus size={15} />New</button></div></div>
      {previewFieldApiName && (() => {
        const field = draft.fields.find(candidate => candidate.apiName === previewFieldApiName);
        return field ? <section className="surface metadata-card" aria-label="Field details">
          <div className="section-toolbar"><div><h2>{field.label}</h2><p>{field.apiName}</p></div>
            <div className="toolbar-actions">
              <button type="button" className="btn" onClick={() => setPreviewFieldApiName('')}>Back to fields</button>
              <button type="button" className="btn btn-brand" onClick={() => setEditingField(field)}><Pencil size={14}/>Edit</button>
            </div>
          </div>
          <div className="metadata-row"><span>Data type</span><strong>{field.dataType}</strong></div>
          <div className="metadata-row"><span>Required</span><strong>{field.required ? 'Yes' : 'No'}</strong></div>
          <div className="metadata-row"><span>Unique</span><strong>{field.unique ? 'Yes' : 'No'}</strong></div>
          <div className="metadata-row"><span>History tracking</span><strong>{field.trackHistory ? 'Yes' : 'No'}</strong></div>
          {field.relationship && <div className="metadata-row"><span>Relationship</span><strong>{field.relationship.type} to {field.relationship.targetObject}</strong></div>}
        </section> : null;
      })()}
      <section className="surface metadata-card">
        <div className="metadata-card-header">
          <div><h3>Deleted Fields</h3><p className="permission-help">Deleted fields can be restored for 15 days.</p></div>
          <button className="btn" type="button" onClick={() => {
            const opening = !deletedFieldsOpen;
            setDeletedFieldsOpen(opening);
            if (opening) void loadDeletedFields();
          }}>{deletedFieldsOpen ? 'Hide' : 'View Deleted Fields'}</button>
        </div>
        {deletedFieldsOpen && (deletedFieldsLoading ? <div className="empty-state">Loading deleted fields…</div>
          : deletedFields.length ? <div className="table-scroll"><table className="slds-table">
            <thead><tr><th>Field Label</th><th>Field Name</th><th>Data Type</th><th>Recovery Expires</th><th></th></tr></thead>
            <tbody>{deletedFields.map((field) => <tr key={field.apiName}>
              <td>{field.label}</td><td className="api-name">{field.apiName}</td><td>{field.dataType}</td>
              <td>{new Date(field.expiresAt).toLocaleString()}</td>
              <td><button className="btn" type="button" onClick={() => void restoreDeletedField(field.apiName)}>Restore</button></td>
            </tr>)}</tbody>
          </table></div> : <div className="empty-state">No fields are available to restore.</div>)}
      </section>
      {showDependencies && <section className="surface metadata-card"><div className="metadata-card-header"><h3>Metadata Dependencies</h3><button className="row-menu" aria-label="Close metadata dependencies" onClick={() => setShowDependencies(false)}><X size={14} /></button></div>
        {fieldDependenciesLoading ? <div className="empty-state">Checking saved metadata dependencies…</div>
          : <>{persistedObjectDependencies.length > 0 && <div className="table-scroll"><table className="slds-table"><thead><tr><th>Object</th><th>Deletion Blocker</th></tr></thead><tbody>{persistedObjectDependencies.map((dependency) => <tr key={dependency}><td className="api-name">{draft.apiName}</td><td>{dependency}</td></tr>)}</tbody></table></div>}
            {persistedFieldDependencies.length ? <div className="table-scroll"><table className="slds-table"><thead><tr><th>Field</th><th>Persisted Consumer / Deletion Blocker</th></tr></thead><tbody>{persistedFieldDependencies.flatMap((field) => field.dependencies.map((dependency) => <tr key={`${field.fieldApiName}-${dependency}`}><td className="api-name">{field.fieldApiName}</td><td>{dependency}</td></tr>))}</tbody></table></div>
              : persistedObjectDependencies.length === 0 && <div className="empty-state">No persisted consumers currently reference this object or its fields.</div>}</>}
        {dependencies.length > 0 && <div className="table-scroll"><h4>Open supported configuration</h4><table className="slds-table"><thead><tr><th>Used By</th><th>Depends On</th><th>Dependency Type</th></tr></thead><tbody>{dependencies.map((dependency, index) => <tr key={`${dependency.dependent}-${dependency.dependency}-${dependency.kind}-${index}`}><td>{dependency.target ? <button className="field-link" type="button" onClick={() => { if (dependency.target) onOpenDependency(dependency.target); }}>{dependency.dependent}</button> : dependency.dependent}</td><td className="api-name">{dependency.dependency}</td><td>{dependency.kind}</td></tr>)}</tbody></table></div>}
      </section>}
      <div className="surface field-surface">
        <div className="field-list-toolbar"><div className="results-count">{fields.length} of {draft.fields.length} fields · Sorted by Field Label</div><div className="field-list-actions"><div className="mini-search"><Search size={13} /><input aria-label="Search fields" placeholder="Search this list..." value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} /></div><button className="icon-button subtle" aria-label="Refresh fields" onClick={refreshObject}><RefreshCw size={15} /></button></div></div>
        <div className="table-scroll"><table className="slds-table"><thead><tr><th>Field Label</th><th>Field Name</th><th>Data Type</th><th>Relationship / Formula</th><th>Required</th><th>Unique</th><th>Track History</th></tr></thead>
          <tbody>{fields.map((field) => <tr key={field.apiName}><td><button className="field-link" onClick={() => setPreviewFieldApiName(field.apiName)}>{field.label}</button>{field.required && <span className="required-dot" title="Required">*</span>}</td><td className="api-name">{field.apiName}</td><td>{field.dataType}</td><td>{field.relationship ? `${field.relationship.type} → ${field.relationship.targetObject}` : field.formula?.expression ?? '—'}</td><td>{field.required ? 'Yes' : 'No'}</td><td>{field.unique ? 'Yes' : '—'}</td><td>{field.trackHistory ? 'Yes' : '—'}</td></tr>)}</tbody>
        </table></div>
        {fields.length === 0 && <div className="empty-state">No fields match your search.</div>}
        <div className="table-pagination"><span>1–{fields.length} of {fields.length}</span></div>
      </div>
    </>
  );
  const renderPageLayouts = () => (
    <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Page Layouts</h2><p>Arrange fields, related lists, and actions. Layout assignment is separate from Lightning page device activation.</p></div><div className="toolbar-actions"><button className="btn" onClick={addLayout}><Plus size={14} />New Layout</button><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div></div>
      <div className="object-editor-grid">
        <div className="object-editor-main">
          <PlatformPageSlot slotKey="field-object-06"><label className="form-label">Page Layout<select className="form-control" value={selectedLayout?.id ?? ''} onChange={(event) => setSelectedLayoutId(event.target.value)}>{layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.label}</option>)}</select></label></PlatformPageSlot>
          {selectedLayout && <>
            <div className="metadata-card-header"><PlatformPageSlot slotKey="field-object-07"><label className="form-label">Layout Label<input className="form-control" value={selectedLayout.label} onChange={(event) => updateLayout(selectedLayout.id, { label: event.target.value })} /></label></PlatformPageSlot><button className="btn" onClick={() => removeLayout(selectedLayout.id)}><X size={14} />Delete Layout</button></div>
            {selectedLayout.sections.map((section) => <div className="metadata-card" key={section.id}>
              <div className="metadata-card-header"><input className="form-control" aria-label="Section name" value={section.label} onChange={(event) => updateLayout(selectedLayout.id, { sections: selectedLayout.sections.map((item) => item.id === section.id ? { ...item, label: event.target.value } : item) })} /><select className="form-control compact-select" aria-label="Section columns" value={section.columns} onChange={(event) => updateLayout(selectedLayout.id, { sections: selectedLayout.sections.map((item) => item.id === section.id ? { ...item, columns: Number(event.target.value) as 1 | 2 } : item) })}><option value={1}>1 column</option><option value={2}>2 columns</option></select><button className="row-menu" aria-label={`Remove ${section.label} section`} disabled={selectedLayout.sections.length <= 1} onClick={() => updateLayout(selectedLayout.id, { sections: selectedLayout.sections.filter((item) => item.id !== section.id) })}><X size={14} /></button></div>
              <FieldSelectorList fields={draft.fields} selected={section.fieldApiNames}
                onToggle={(apiName) => updateLayout(selectedLayout.id, { sections: selectedLayout.sections.map((item) => {
                  const placedHere = item.id === section.id && item.fieldApiNames.includes(apiName);
                  return { ...item, fieldApiNames: item.id === section.id
                    ? placedHere ? item.fieldApiNames.filter(name => name !== apiName) : [...item.fieldApiNames, apiName]
                    : item.fieldApiNames.filter(name => name !== apiName) };
                }) })}
                onMove={(apiName, direction) => updateLayout(selectedLayout.id, { sections: selectedLayout.sections.map(item => {
                  if (item.id !== section.id) return item;
                  const names = [...item.fieldApiNames];
                  const index = names.indexOf(apiName);
                  const target = index + direction;
                  if (index >= 0 && target >= 0 && target < names.length) {
                    [names[index], names[target]] = [names[target], names[index]];
                  }
                  return {...item,fieldApiNames:names};
                }) })} />
            </div>)}
            <button className="text-action" onClick={() => updateLayout(selectedLayout.id, { sections: [...selectedLayout.sections, { id: `${selectedLayout.id}-section-${Date.now()}`, label: 'New Section', columns: 2, fieldApiNames: [] }] })}><Plus size={14} />Add Section</button>
            <div className="metadata-card"><h3>Related Lists</h3>
              {relatedListOptions.map((option) => <label className="metadata-row" key={option.value}><span>{option.label}</span><input type="checkbox" checked={normalizeRelatedLists(selectedLayout.relatedLists).includes(option.value)} onChange={() => toggleRelatedList(selectedLayout, option.value)} /></label>)}
              {selectedLayout.relatedLists.filter((name) => !relatedListOptions.some((option) =>
                option.value.toLocaleLowerCase() === name.toLocaleLowerCase() || option.alias.toLocaleLowerCase() === name.toLocaleLowerCase()
              )).map((name) => <label className="metadata-row" key={`unknown-${name}`}><span>Unavailable related list: {name}</span><input type="checkbox" checked onChange={() => updateLayout(selectedLayout.id, { relatedLists: selectedLayout.relatedLists.filter((item) => item !== name) })} /></label>)}
              {relatedListOptions.length === 0 && <p className="permission-help">No objects currently have a relationship to this object.</p>}
              {normalizeRelatedLists(selectedLayout.relatedLists).map(name=>{
                const child=objects.find(item=>item.fields.some(field=>field.relationship?.targetObject===draft.apiName
                  &&field.relationship.childRelationshipName.toLocaleLowerCase()===name.toLocaleLowerCase()));
                if(!child)return null;
                const settings=selectedLayout.relatedListSettings?.[name]??{};
                const columns=settings.columns??child.fields.filter(field=>
                  !field.relationship||field.relationship.targetObject!==draft.apiName).slice(0,4).map(field=>field.apiName);
                const set=(change:Parameters<typeof updateRelatedListSettings>[2])=>updateRelatedListSettings(selectedLayout,name,change);
                return <div className="metadata-card" key={name}>
                  <h4>{name} — Display &amp; Actions</h4>
                  <label className="form-label">Visible columns</label>
                  <FieldSelectorList fields={child.fields} selected={columns}
                    onToggle={apiName=>set({columns:columns.includes(apiName)?columns.filter(x=>x!==apiName):[...columns,apiName].slice(0,12)})}
                    onMove={(apiName,direction)=>{
                      const list=[...columns],i=list.indexOf(apiName),j=i+direction;
                      if(i>=0&&j>=0&&j<list.length){[list[i],list[j]]=[list[j],list[i]];set({columns:list});}
                    }}/>
                  <label className="form-label">Sort field
                    <select className="form-control" aria-label={`Sort field for ${name}`}
                      value={settings.sortField??''} onChange={event=>set({sortField:event.target.value||undefined})}>
                      <option value="">Default order</option>
                      {child.fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                    </select></label>
                  <label className="form-label">Sort direction
                    <select className="form-control" value={settings.sortDirection??'asc'}
                      onChange={event=>set({sortDirection:event.target.value as 'asc'|'desc'})}>
                      <option value="asc">Ascending</option><option value="desc">Descending</option>
                    </select></label>
                  <label className="form-label">Filter field
                    <select className="form-control" aria-label={`Filter field for ${name}`}
                      value={settings.filterField??''} onChange={event=>set({
                        filterField:event.target.value||undefined,
                        filterValue:event.target.value?(settings.filterValue??''):undefined
                      })}>
                      <option value="">No additional filter</option>
                      {child.fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                    </select></label>
                  {settings.filterField&&<>
                    <label className="form-label">Filter operator
                      <select className="form-control" value={settings.filterOperator??'Equals'}
                        onChange={event=>set({filterOperator:event.target.value as 'Equals'|'Includes'|'Excludes'})}>
                        <option value="Equals">Equals</option>
                        <option value="Includes">Includes (multi-select)</option>
                        <option value="Excludes">Excludes (multi-select)</option>
                      </select></label>
                    <label className="form-label">Filter value
                      <input className="form-control" maxLength={256} value={settings.filterValue??''}
                        onChange={event=>set({filterValue:event.target.value})}/>
                    </label>
                  </>}
                  <label className="form-label">Rows per page
                    <select className="form-control" value={settings.pageSize??50}
                      onChange={event=>set({pageSize:Number(event.target.value) as 10|25|50})}>
                      <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
                    </select></label>
                  <label className="checkbox-row"><input type="checkbox"
                    checked={settings.showNewAction!==false}
                    onChange={event=>set({showNewAction:event.target.checked})}/>Show related New action</label>
                  <label className="checkbox-row"><input type="checkbox"
                    checked={settings.showRowActions===true}
                    onChange={event=>set({showRowActions:event.target.checked})}/>Show row Edit/Delete actions</label>
                </div>;
              })}
            </div>
            <div className="metadata-card"><h3>Page Actions</h3>{(['New', 'Edit', 'Delete'] as const).map((action) => <label className="metadata-row" key={action}><span>{action}</span><input type="checkbox" checked={selectedLayout.actions.includes(action)} onChange={() => updateLayout(selectedLayout.id, { actions: toggleField(selectedLayout.actions, action) })} /></label>)}
              {(draft.actions??[]).filter(action=>action.type==='Custom').map(action=><label className="metadata-row" key={action.id}>
                <span>{action.label}<small>Record Quick Action · {action.behavior}</small></span>
                <input type="checkbox" aria-label={`Place ${action.label} on ${selectedLayout.label}`} checked={selectedLayout.actions.includes(action.id)}
                  onChange={()=>updateLayout(selectedLayout.id,{actions:toggleField(selectedLayout.actions,action.id)})}/>
              </label>)}
            </div>
            <div className="metadata-card">
              <h3>Custom Links</h3>
              {(selectedLayout.customLinks ?? []).map((link) => <div className="metadata-card" key={link.id}>
                <div className="metadata-card-header">
                  <PlatformPageSlot slotKey="field-object-08"><label className="form-label">Link Label<input className="form-control" value={link.label} onChange={(event) => updateCustomLink(selectedLayout, link.id, { label: event.target.value })} /></label></PlatformPageSlot>
                  <button type="button" className="row-menu" aria-label={`Remove ${link.label} custom link`} onClick={() => updateLayout(selectedLayout.id, { customLinks: (selectedLayout.customLinks ?? []).filter((item) => item.id !== link.id) })}><X size={14} /></button>
                </div>
                <PlatformPageSlot slotKey="field-object-09"><label className="form-label">URL<input className="form-control" value={link.url} onChange={(event) => updateCustomLink(selectedLayout, link.id, { url: event.target.value })} placeholder="https://example.com/{!Record.Id}" /></label></PlatformPageSlot>
                <label className="checkbox-row"><input type="checkbox" checked={link.openInNewWindow} onChange={(event) => updateCustomLink(selectedLayout, link.id, { openInNewWindow: event.target.checked })} />Open in new window</label>
                <label className="form-label">Show only when record field equals
                  <select className="form-control" aria-label={`Visibility field for ${link.label}`}
                    value={link.visibleWhenField??''} onChange={event=>updateCustomLink(selectedLayout,link.id,{
                      visibleWhenField:event.target.value||undefined,
                      visibleWhenValue:event.target.value?(link.visibleWhenValue??''):undefined
                    })}>
                    <option value="">Always visible (subject to field permissions)</option>
                    {draft.fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                  </select></label>
                {link.visibleWhenField&&<label className="form-label">Equals value
                  <input className="form-control" maxLength={256} value={link.visibleWhenValue??''}
                    onChange={event=>updateCustomLink(selectedLayout,link.id,{visibleWhenValue:event.target.value})}/>
                </label>}
              </div>)}
              <PlatformPageSlot slotKey="field-object-10"><label className="form-label">New Link Label<input className="form-control" value={customLinkLabel} onChange={(event) => setCustomLinkLabel(event.target.value)} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-object-11"><label className="form-label">URL<input className="form-control" value={customLinkUrl} onChange={(event) => setCustomLinkUrl(event.target.value)} placeholder="https://example.com/{!Record.Id}" /></label></PlatformPageSlot>
              <label className="checkbox-row"><input type="checkbox" checked={customLinkNewWindow} onChange={(event) => setCustomLinkNewWindow(event.target.checked)} />Open in new window</label>
              <button type="button" className="btn" onClick={() => addCustomLink(selectedLayout)} disabled={!customLinkLabel.trim() || !customLinkUrl.trim()}><Plus size={14} />Add Custom Link</button>
              <p className="permission-help">Use <code>{'{!Record.Id}'}</code> or <code>{'{!Record.FieldApiName}'}</code> to include record values in a link.</p>
            </div>
          </>}
        </div>
        <div className="object-editor-side">
          <h3>Page Layout Assignment</h3><p>Assignments resolve by profile and record type.</p>
          <PlatformPageSlot slotKey="field-object-12"><label className="form-label">Record Type<select className="form-control" value={selectedRecordTypeId} onChange={(event) => setSelectedRecordTypeId(event.target.value)}>{recordTypes.map((recordType) => <option key={recordType.id} value={recordType.id}>{recordType.label}</option>)}</select></label></PlatformPageSlot>
          <PlatformPageSlot slotKey="field-object-13"><label className="form-label">Profile<select className="form-control" aria-label="Profile for page layout assignment" value={layoutProfileId} onChange={(event) => setLayoutProfileId(event.target.value)}>
            <option value="*">All Profiles</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select></label></PlatformPageSlot>
          <PlatformPageSlot slotKey="field-object-14"><label className="form-label">Assigned Layout<select className="form-control" value={assignedLayoutId} onChange={(event) => setAssignedLayoutId(event.target.value)}>{layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.label}</option>)}</select></label></PlatformPageSlot>
          <button className="btn" onClick={saveLayoutAssignment} disabled={!selectedRecordTypeId || !assignedLayoutId}><Plus size={14} />Add / Update Assignment</button>
          <div className="assignment-list">{(draft.pageLayoutAssignments ?? []).map((assignment) => <div className="metadata-row" key={`${assignment.profileId}-${assignment.recordTypeId}`}><span><strong>{assignment.profileId === '*' ? 'All Profiles' : profiles.find((profile) => profile.id === assignment.profileId)?.label ?? assignment.profileId}</strong><small>{recordTypes.find((recordType) => recordType.id === assignment.recordTypeId)?.label ?? assignment.recordTypeId} · {layouts.find((layout) => layout.id === assignment.pageLayoutId)?.label ?? assignment.pageLayoutId}</small></span><button className="row-menu" aria-label="Remove page layout assignment" onClick={() => updateDraft({ pageLayoutAssignments: (draft.pageLayoutAssignments ?? []).filter((item) => item !== assignment) })}><X size={14} /></button></div>)}</div>
          <div className="info-callout">Phone and desktop Lightning Record Page activation is managed separately in Lightning App Builder. Tablet uses responsive page rendering.</div>
        </div>
      </div>
    </section>
  );
  const renderRecordTypes = () => (
    <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Record Types</h2><p>Define record variations and choose their default page layout.</p></div><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div>
      <div className="record-type-create"><input className="form-control" aria-label="New record type label" placeholder="New record type label" value={recordTypeLabel} onChange={(event) => setRecordTypeLabel(event.target.value)} /><button className="btn" onClick={addRecordType} disabled={!recordTypeLabel.trim()}><Plus size={14} />Add Record Type</button></div>
      <table className="slds-table"><thead><tr><th>Label</th><th>Developer Name</th><th>Active</th><th>Default</th><th /></tr></thead><tbody>{recordTypes.map((recordType) => <tr key={recordType.id}><td><input className="form-control" maxLength={80} value={recordType.label} onChange={(event) => updateDraft({ recordTypes: recordTypes.map((item) => item.id === recordType.id ? { ...item, label: event.target.value } : item) })} /></td><td><input className="form-control api-name" maxLength={80} value={recordType.developerName} onChange={(event) => updateDraft({ recordTypes: recordTypes.map((item) => item.id === recordType.id ? { ...item, developerName: event.target.value.replace(/[^A-Za-z0-9_]/g, '_') } : item) })} /></td><td><input aria-label={`Active ${recordType.label}`} type="checkbox" disabled={recordType.isDefault} checked={recordType.active} onChange={(event) => updateDraft({ recordTypes: recordTypes.map((item) => item.id === recordType.id ? { ...item, active: event.target.checked } : item) })} /></td><td><input aria-label={`Default ${recordType.label}`} type="radio" name="default-record-type" checked={recordType.isDefault} disabled={!recordType.active} onChange={() => updateDraft({ recordTypes: recordTypes.map((item) => ({ ...item, isDefault: item.id === recordType.id })) })} /></td><td><button className="row-menu" aria-label={`Delete ${recordType.label}`} disabled={recordTypes.length <= 1} onClick={() => {
        if (!window.confirm(`Delete record type "${recordType.label}"? Existing records, permission assignments, and page assignments must be removed first.`)) return;
        removeRecordType(recordType.id);
      }}><X size={14} /></button></td></tr>)}</tbody></table>
      {recordTypes.map((recordType) => <PlatformPageSlot slotKey="field-object-15"><label className="form-label" key={`${recordType.id}-description`}>{recordType.label} Description
        <textarea className="form-control" rows={2} maxLength={1000} value={recordType.description ?? ''}
          onChange={(event) => updateDraft({ recordTypes: recordTypes.map((item) => item.id === recordType.id ? { ...item, description: event.target.value } : item) })} />
      </label></PlatformPageSlot>)}
      <React.Suspense fallback={<p>Loading business processes…</p>}>
        <BusinessProcessesPanel object={draft} onApply={(process,recordTypeId)=>{
          updateDraft({recordTypes:recordTypes.map(recordType=>recordType.id===recordTypeId
            ?{...recordType,businessProcessApiName:process.apiName,
              picklistValues:{...recordType.picklistValues,[process.statusField]:[...process.values]}}
            :recordType)});
          setRecordTypePicklistDrafts(current=>({
            ...current,[recordTypeId+'.'+process.statusField]:process.values.join('\n')
          }));
          onNotify('Business process applied to Record Type draft. Save to publish.');
        }}/>
      </React.Suspense>
      <p className="permission-help">Picklist values below act as the available process options for each record type. Defaults must be included in every applicable record type.</p>
      {recordTypes.map((recordType) => <details className="permission-field-group" key={`${recordType.id}-picklists`}>
        <summary>{recordType.label} picklist values</summary>
        {draft.fields.filter((field) => field.dataType === 'Picklist' || field.dataType === 'Multi-Select Picklist').map((field) => {
          const key = `${recordType.id}.${field.apiName}`;
          return <PlatformPageSlot slotKey="field-object-16"><label className="form-label" key={key}>{field.label}
            <textarea className="form-control" rows={3} aria-label={`${recordType.label} ${field.label} values`}
              value={recordTypePicklistDrafts[key] ?? ''}
              placeholder={(field.picklistValues ?? []).join('\n')}
              onChange={(event) => setRecordTypePicklistDrafts((current) => ({ ...current, [key]: event.target.value }))}
              onBlur={() => {
                const values = (recordTypePicklistDrafts[key] ?? '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
                updateDraft({ recordTypes: recordTypes.map((item) => item.id === recordType.id ? {
                  ...item,
                  picklistValues: { ...item.picklistValues, [field.apiName]: [...new Set(values)] }
                } : item) });
              }} />
            <small>Enter one allowed value per line. Leave blank to allow no values for this record type.</small>
          </label></PlatformPageSlot>;
        })}
        {!draft.fields.some((field) => field.dataType === 'Picklist' || field.dataType === 'Multi-Select Picklist') && <p className="permission-help">Add a picklist field to configure record-type-specific values.</p>}
      </details>)}
    </section>
  );
  const renderCompactLayout = () => (
    <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Compact Layouts</h2><p>Choose highlights fields and assign a compact layout by profile and record type.</p></div><div className="toolbar-actions"><button className="btn" onClick={addCompactLayout}><Plus size={14} />New Compact Layout</button><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div></div>
      <div className="object-editor-grid">
        <div className="object-editor-main">
          <PlatformPageSlot slotKey="field-object-17"><label className="form-label">Compact Layout<select className="form-control" value={selectedCompactLayoutId} onChange={(event) => setSelectedCompactLayoutId(event.target.value)}>
            {compactLayouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.label}</option>)}
          </select></label></PlatformPageSlot>
          {compactLayouts.map((layout) => layout.id === selectedCompactLayoutId && <div key={layout.id}>
            <div className="metadata-card-header">
              <PlatformPageSlot slotKey="field-object-18"><label className="form-label">Compact Layout Label<input className="form-control" value={layout.label} onChange={(event) => updateCompactLayout(layout.id, { label: event.target.value })} /></label></PlatformPageSlot>
              <button type="button" className="btn" disabled={compactLayouts.length <= 1} onClick={() => { if (confirmDestructiveAction('Delete','Compact Layout "'+layout.label+'"','Save Object settings to apply this removal.')) removeCompactLayout(layout.id); }}><X size={14} />Delete</button>
            </div>
            <FieldSelectorList fields={draft.fields} selected={layout.fieldApiNames} onToggle={(apiName) => updateCompactLayout(layout.id, { fieldApiNames: toggleField(layout.fieldApiNames, apiName) })} />
          </div>)}
        </div>
        <div className="object-editor-side">
          <h3>Compact Layout Assignment</h3>
          <PlatformPageSlot slotKey="field-object-19"><label className="form-label">Record Type<select className="form-control" value={selectedRecordTypeId} onChange={(event) => setSelectedRecordTypeId(event.target.value)}>
            {recordTypes.filter((recordType) => recordType.active).map((recordType) => <option key={recordType.id} value={recordType.id}>{recordType.label}</option>)}
          </select></label></PlatformPageSlot>
          <PlatformPageSlot slotKey="field-object-20"><label className="form-label">Profile<select className="form-control" aria-label="Profile for compact layout assignment" value={layoutProfileId} onChange={(event) => setLayoutProfileId(event.target.value)}>
            <option value="*">All Profiles</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select></label></PlatformPageSlot>
          <button className="btn" onClick={saveCompactLayoutAssignment} disabled={!selectedRecordTypeId || !selectedCompactLayoutId}><Plus size={14} />Add / Update Assignment</button>
          <div className="assignment-list">{(draft.compactLayoutAssignments ?? []).map((assignment) => <div className="metadata-row" key={`${assignment.profileId}-${assignment.recordTypeId}`}>
            <span><strong>{assignment.profileId === '*' ? 'All Profiles' : profiles.find((profile) => profile.id === assignment.profileId)?.label ?? assignment.profileId}</strong>
              <small>{recordTypes.find((recordType) => recordType.id === assignment.recordTypeId)?.label ?? assignment.recordTypeId} · {compactLayouts.find((layout) => layout.id === assignment.compactLayoutId)?.label ?? assignment.compactLayoutId}</small></span>
            <button className="row-menu" aria-label="Remove compact layout assignment" onClick={() => updateDraft({ compactLayoutAssignments: (draft.compactLayoutAssignments ?? []).filter((item) => item !== assignment) })}><X size={14} /></button>
          </div>)}</div>
        </div>
      </div>
    </section>
  );
  const renderFieldSets = () => {
    const fieldSets = draft.fieldSets ?? [];
    const moveField = (fieldSetApiName: string, fieldApiName: string, offset: -1 | 1) => {
      const fieldSet = fieldSets.find((item) => item.apiName === fieldSetApiName);
      if (!fieldSet) return;
      const currentIndex = fieldSet.fieldApiNames.indexOf(fieldApiName);
      const nextIndex = currentIndex + offset;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= fieldSet.fieldApiNames.length) return;
      const fieldApiNames = [...fieldSet.fieldApiNames];
      fieldApiNames.splice(currentIndex, 1);
      fieldApiNames.splice(nextIndex, 0, fieldApiName);
      updateDraft({ fieldSets: fieldSets.map((item) => item.apiName === fieldSetApiName ? { ...item, fieldApiNames } : item) });
    };
    return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Field Sets</h2><p>Reusable field groups for configurable views and integrations.</p></div><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div>
      <div className="record-type-create"><input className="form-control" aria-label="New field set label" placeholder="New field set label" maxLength={80} value={fieldSetLabel} onChange={(event) => {
        const label = event.target.value;
        setFieldSetLabel(label);
        setFieldSetApiName(generateMetadataApiName(label,255));
      }} /><input className="form-control api-name" aria-label="New field set API name" placeholder="API name" maxLength={255} value={fieldSetApiName} onChange={(event) => setFieldSetApiName(event.target.value)} /><button className="btn" onClick={() => {
        const label = fieldSetLabel.trim();
        const apiName = fieldSetApiName.trim();
        if (!label || !/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(apiName)) { onNotify('Enter a valid field set label and API name'); return; }
        if (fieldSets.some((item) => item.apiName.toLocaleLowerCase() === apiName.toLocaleLowerCase()
          || item.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) { onNotify('A field set with this label or API name already exists'); return; }
        updateDraft({ fieldSets: [...fieldSets, { apiName, label, fieldApiNames: [] }] });
        setFieldSetLabel('');
        setFieldSetApiName('');
      }} disabled={!fieldSetLabel.trim() || !/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(fieldSetApiName.trim())}><Plus size={14} />New Field Set</button></div>
      {fieldSets.map((fieldSet, fieldSetIndex) => <div className="metadata-card" key={`field-set-${fieldSetIndex}`}>
        <div className="metadata-card-header"><PlatformPageSlot slotKey="field-object-21"><label className="form-label">Field Set Label<input className="form-control" maxLength={80} value={fieldSet.label} onChange={(event) => updateDraft({ fieldSets: fieldSets.map((item) => item.apiName === fieldSet.apiName ? { ...item, label: event.target.value } : item) })} /></label></PlatformPageSlot>
          <PlatformPageSlot slotKey="field-object-22"><label className="form-label">API Name<input className="form-control api-name" maxLength={255} value={fieldSet.apiName} onChange={(event) => updateDraft({ fieldSets: fieldSets.map((item) => item.apiName === fieldSet.apiName ? { ...item, apiName: event.target.value } : item) })} /></label></PlatformPageSlot>
          <button className="row-menu" aria-label={`Delete field set ${fieldSet.label}`} onClick={() => {
            if (!window.confirm(`Delete field set "${fieldSet.label}"? Record-detail field-set views will no longer offer it.`)) return;
            updateDraft({ fieldSets: fieldSets.filter((item) => item.apiName !== fieldSet.apiName) });
          }}><X size={14} /></button></div>
        <FieldSelectorList fields={draft.fields} selected={fieldSet.fieldApiNames} onToggle={(apiName) => updateDraft({ fieldSets: fieldSets.map((item) => item.apiName === fieldSet.apiName ? { ...item, fieldApiNames: toggleField(item.fieldApiNames, apiName) } : item) })} />
        <div className="assignment-list" aria-label={`${fieldSet.label} field order`}>{fieldSet.fieldApiNames.map((apiName, index) => <div className="metadata-row" key={apiName}>
          <span><strong>{index + 1}. {draft.fields.find((field) => field.apiName === apiName)?.label ?? apiName}</strong><small>{apiName}</small></span>
          <div className="toolbar-actions"><button type="button" className="icon-button subtle" aria-label={`Move ${apiName} up in ${fieldSet.label}`} disabled={index === 0} onClick={() => moveField(fieldSet.apiName, apiName, -1)}><ArrowUp size={13} /></button>
            <button type="button" className="icon-button subtle" aria-label={`Move ${apiName} down in ${fieldSet.label}`} disabled={index === fieldSet.fieldApiNames.length - 1} onClick={() => moveField(fieldSet.apiName, apiName, 1)}><ArrowDown size={13} /></button></div>
        </div>)}</div>
        {!fieldSet.fieldApiNames.length && <div className="empty-state">This field set is empty; its runtime consumer will show an empty-state message.</div>}
      </div>)}
      {fieldSets.length === 0 && <div className="empty-state">No field sets are defined.</div>}
    </section>;
  };
  const renderSearchLayouts = () => {
    const searchLayouts = draft.searchLayouts ?? {};
    const options = ['searchResults', 'lookupDialog', 'lookupPhoneDialog'] as const;
    const searchable=searchLayouts.searchableFields??[];
    const eligibleFields=draft.fields.filter(field=>
      ['text','email','phone','url','picklist'].includes(field.dataType.toLocaleLowerCase()));
    const updateSearchable=(fieldApiName:string,weight?:'A'|'B'|'C'|'D')=>{
      const next=weight
        ?searchable.map(field=>field.fieldApiName===fieldApiName?{...field,weight}:field)
        :searchable.some(field=>field.fieldApiName===fieldApiName)
          ?searchable.filter(field=>field.fieldApiName!==fieldApiName)
          :[...searchable,{fieldApiName,weight:'C' as const}];
      updateDraft({searchLayouts:{...searchLayouts,searchableFields:next}});
    };
    return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Search Layouts</h2><p>Configure result columns, lookup columns and weighted server-search fields.</p></div><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div>
      {options.map((name) => <div className="metadata-card" key={name}><h3>{name === 'searchResults' ? 'Search Results' : name === 'lookupDialog' ? 'Lookup Dialog' : 'Lookup Phone Dialog'}</h3><FieldSelectorList fields={draft.fields} selected={searchLayouts[name] ?? []} onToggle={(apiName) => updateDraft({ searchLayouts: { ...searchLayouts, [name]: toggleField(searchLayouts[name] ?? [], apiName) } })} /></div>)}
      <div className="metadata-card"><h3>Searchable Fields</h3>
        <p>Only configured fields are indexed. Field-level access is still enforced for every search.</p>
        {eligibleFields.map(field=>{
          const selected=searchable.find(item=>item.fieldApiName===field.apiName);
          return <div className="metadata-list-row" key={field.apiName}>
            <label><input type="checkbox" checked={Boolean(selected)}
              onChange={()=>updateSearchable(field.apiName)} /> {field.label}</label>
            {selected&&<label>Search weight
              <select aria-label={`Search weight for ${field.label}`} value={selected.weight}
                onChange={event=>updateSearchable(field.apiName,event.target.value as 'A'|'B'|'C'|'D')}>
                <option value="A">Highest</option><option value="B">High</option>
                <option value="C">Normal</option><option value="D">Low</option>
              </select>
            </label>}
          </div>;
        })}
      </div>
      <React.Suspense fallback={<p>Loading exact-match index settings…</p>}>
       <FieldExactIndexesPanel objectApi={object.apiName}/>
      </React.Suspense>
    </section>;
  };
  const renderActions = () => {
    const actions = draft.actions ?? [];
    const eligibleFlows = actionFlows.filter(f=>f.status==='Active'
      &&(f.flowType==='Screen Flow'||f.flowType==='Autolaunched Flow'));
    const writableFields = draft.fields.filter((field) => !field.formula && !field.relationship
      && field.dataType !== 'AutoNumber' && field.dataType !== 'Auto Number');
    const relationsFor = (targetApi:string) => objects.find(item=>item.apiName===targetApi)
      ?.fields.filter(field=>field.relationship?.targetObject===draft.apiName)??[];
    const updateAction = (id:string,changes:Partial<ObjectActionMetadata>) =>
      updateDraft({actions:actions.map(item=>item.id===id?{...item,...changes}:item)});
    const addCustomAction = () => {
      const label=customActionLabel.trim();
      if(!label||actions.some(action=>action.label.toLowerCase()===label.toLowerCase())
        ||['new','edit','delete'].includes(label.toLowerCase())){
        onNotify('Choose a unique quick action label that does not match a standard action');
        return;
      }
      if(customActionBehavior==='Set Field Value'&&!customActionFieldApiName)return;
      if(customActionBehavior==='Run Flow'&&!customActionFlow)return;
      if(customActionBehavior==='Open Component'&&!customActionComponent)return;
      if(customActionBehavior==='Send Email'&&!customActionFlow)return;
      if(customActionBehavior==='Create Related'
        &&(!customActionTargetObject||!customActionRelationshipField))return;
      const action:ObjectActionMetadata={
        id:`custom-${crypto.randomUUID()}`,label,type:'Custom',enabled:true,
        behavior:customActionBehavior,
        ...(customActionBehavior==='Set Field Value'?{fieldApiName:customActionFieldApiName,
          value:customActionValue}:{}),
        ...(customActionBehavior==='Log Call'?{value:customActionValue}:{}),
        ...(customActionBehavior==='Run Flow'?{flowApiName:customActionFlow}:{}),
        ...(customActionBehavior==='Open Component'?{componentApiName:customActionComponent,
          presentation:customActionPresentation,componentBindings:customActionBindings}:{}),
        ...(customActionBehavior==='Send Email'?{flowApiName:customActionFlow}:{}),
        ...(customActionBehavior==='Create Related'?{targetObjectApi:customActionTargetObject,
          relationshipFieldApi:customActionRelationshipField}:{})
      };
      updateDraft({actions:[...actions,action]});
      setCustomActionLabel('');setCustomActionValue('');setCustomActionBindings([]);
    };
    return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Buttons, Links, and Actions</h2>
        <p>Configure reusable record Quick Actions. Execution uses shared CRUD, Activity, Flow and Component engines with server-side permissions.</p></div>
        <button className="btn btn-brand" onClick={persistDraft}><Save size={14}/>Save</button></div>
      {actionOptionsLoading&&<p role="status">Loading available Flows and Components…</p>}
      {actionFlowError&&<p role="alert">{actionFlowError}</p>}
      {actionComponentError&&<p role="alert">{actionComponentError}</p>}
      <div className="metadata-card"><h3>Object Actions</h3>
        {actions.map(action=><div className="metadata-card" key={action.id}>
          <div className="metadata-row"><span><strong>{action.label}</strong>
            <small>{action.type==='Standard'?'Standard record action':action.behavior??'Custom action'}</small></span>
            <input aria-label={`Enable ${action.label} action`} type="checkbox" checked={action.enabled}
              onChange={event=>updateAction(action.id,{enabled:event.target.checked})}/>
            {action.type==='Custom'&&<button className="row-menu" aria-label={`Delete ${action.label} action`}
              onClick={()=>updateDraft({actions:actions.filter(item=>item.id!==action.id)})}><X size={14}/></button>}
          </div>
          {action.type==='Custom'&&<div className="record-type-create">
            <label className="form-label">Show action in
              <select className="form-control" aria-label={`Placement for ${action.label}`}
                value={action.placement??'Default'}
                onChange={event=>updateAction(action.id,{
                  placement:event.target.value as NonNullable<ObjectActionMetadata['placement']>})}>
                <option value="Default">Existing record header and selected highlights</option>
                <option value="Header">Record header only</option>
                <option value="Highlights">Selected highlights panels only</option>
                <option value="Publisher">Record publisher only</option>
                <option value="Everywhere">Header, highlights and publisher</option>
              </select>
            </label>
            <label>Action behavior
              <select className="form-control" aria-label={`Behavior for ${action.label}`}
                value={action.behavior??'Set Field Value'} onChange={event=>updateAction(action.id,{
                  behavior:event.target.value as NonNullable<ObjectActionMetadata['behavior']>,
                  fieldApiName:undefined,value:undefined,targetObjectApi:undefined,
                  relationshipFieldApi:undefined,flowApiName:undefined,componentApiName:undefined,
                  presentation:undefined,componentBindings:undefined,credentialId:undefined,fromEmail:undefined})}>
                <option value="Set Field Value">Update a field</option>
                <option value="Log Call">Log a call</option>
                <option value="Run Flow">Run Flow</option>
                <option value="Open Component">Open Component</option>
                <option value="Create Related">Create related record</option>
                <option value="Send Email">Send Email</option>
              </select>
            </label>
            {action.behavior==='Set Field Value'&&<>
              <select className="form-control" aria-label={`Target field for ${action.label}`}
                value={action.fieldApiName??''} onChange={event=>updateAction(action.id,{fieldApiName:event.target.value})}>
                <option value="">Choose field</option>
                {writableFields.map(field=><option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}
              </select>
              <input className="form-control" aria-label={`Value for ${action.label}`}
                value={action.value??''} onChange={event=>updateAction(action.id,{value:event.target.value})}/>
            </>}
            {action.behavior==='Log Call'&&<input className="form-control"
              aria-label={`Default call subject for ${action.label}`} maxLength={200}
              placeholder="Default subject (optional)" value={action.value??''}
              onChange={event=>updateAction(action.id,{value:event.target.value})}/>}
            {action.behavior==='Run Flow'&&<select className="form-control"
              aria-label={`Flow for ${action.label}`} value={action.flowApiName??''}
              onChange={event=>updateAction(action.id,{flowApiName:event.target.value})}>
              <option value="">Choose a Flow</option>
              {eligibleFlows.map(flow=><option key={flow.apiName} value={flow.apiName}>{flow.label} ({flow.flowType})</option>)}
              {!actionOptionsLoading&&eligibleFlows.length===0&&<option disabled>No active Screen or Autolaunched Flows</option>}
            </select>}
            {action.behavior==='Open Component'&&<>
              <select className="form-control" aria-label={`Component for ${action.label}`}
                value={action.componentApiName??''} onChange={event=>updateAction(action.id,{componentApiName:event.target.value})}>
                <option value="">Choose published Component</option>
                {actionComponents.map(c=><option key={c.apiName} value={c.apiName}>{c.label}</option>)}
              </select>
              <select className="form-control" aria-label={`Presentation for ${action.label}`}
                value={action.presentation??'Modal'} onChange={event=>updateAction(action.id,{presentation:event.target.value as 'Modal'|'Side Panel'})}>
                <option value="Modal">Modal</option><option value="Side Panel">Side Panel</option>
              </select>
              <QuickActionBindingsEditor scope="object" fields={draft.fields}
                bindings={action.componentBindings??[]}
                onChange={bindings=>updateAction(action.id,{componentBindings:bindings})}/>
            </>}
            {action.behavior==='Send Email'&&<label className="form-label">Delivery Flow (HTTPS Callout)
              <select className="form-control" aria-label={`Email Flow for ${action.label}`}
                value={action.flowApiName??''}
                onChange={event=>updateAction(action.id,{flowApiName:event.target.value})}>
                <option value="">Choose active Email Flow</option>
                {actionFlows.filter(flow=>flow.status==='Active').map(flow=><option key={flow.apiName} value={flow.apiName}>{flow.label}</option>)}
              </select>
              <small>The Flow receives to, subject, body, recordId and objectApiName and handles credentials with a Named HTTPS Callout.</small>
            </label>}
            {action.behavior==='Create Related'&&<>
              <select className="form-control" aria-label={`Related object for ${action.label}`}
                value={action.targetObjectApi??''} onChange={event=>updateAction(action.id,{
                  targetObjectApi:event.target.value,relationshipFieldApi:undefined})}>
                <option value="">Choose child object</option>
                {objects.filter(item=>relationsFor(item.apiName).length>0).map(item=>
                  <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
              </select>
              <select className="form-control" aria-label={`Relationship field for ${action.label}`}
                value={action.relationshipFieldApi??''} onChange={event=>updateAction(action.id,{relationshipFieldApi:event.target.value})}>
                <option value="">Choose relationship</option>
                {relationsFor(action.targetObjectApi??'').map(field=>
                  <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
              </select>
            </>}
          </div>}
        </div>)}
        <div className="record-type-create">
          <input className="form-control" aria-label="New custom action" maxLength={80}
            placeholder="Quick action label" value={customActionLabel}
            onChange={event=>setCustomActionLabel(event.target.value)}/>
          <select className="form-control" aria-label="New quick action behavior" value={customActionBehavior}
            onChange={event=>setCustomActionBehavior(event.target.value as NonNullable<ObjectActionMetadata['behavior']>)}>
            <option value="Set Field Value">Update a field</option>
            <option value="Log Call">Log a call</option>
            <option value="Run Flow">Run Flow</option>
            <option value="Open Component">Open Component</option>
            <option value="Create Related">Create related record</option>
            <option value="Send Email">Send Email</option>
          </select>
          {customActionBehavior==='Set Field Value'&&<>
            <select className="form-control" aria-label="Custom action target field"
              value={customActionFieldApiName} onChange={event=>setCustomActionFieldApiName(event.target.value)}>
              <option value="">Choose field</option>
              {writableFields.map(field=><option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}
            </select>
            <input className="form-control" aria-label="Custom action field value"
              placeholder="Value to set" maxLength={10000} value={customActionValue}
              onChange={event=>setCustomActionValue(event.target.value)}/>
          </>}
          {customActionBehavior==='Log Call'&&<input className="form-control" aria-label="Default call subject"
            maxLength={200} placeholder="Default call subject" value={customActionValue}
            onChange={event=>setCustomActionValue(event.target.value)}/>}
          {customActionBehavior==='Run Flow'&&<select className="form-control" aria-label="Quick action Flow"
            value={customActionFlow} onChange={event=>setCustomActionFlow(event.target.value)}>
            <option value="">Choose a Flow</option>
            {eligibleFlows.map(flow=>
              <option key={flow.apiName} value={flow.apiName}>{flow.label} ({flow.flowType})</option>)}
            {!actionOptionsLoading&&eligibleFlows.length===0&&<option disabled>No active Screen or Autolaunched Flows</option>}
          </select>}
          {customActionBehavior==='Open Component'&&<>
            <select className="form-control" aria-label="Quick action Component"
              value={customActionComponent} onChange={event=>setCustomActionComponent(event.target.value)}>
              <option value="">Choose published Component</option>
              {actionComponents.map(c=><option key={c.apiName} value={c.apiName}>{c.label}</option>)}
            </select>
            <select className="form-control" aria-label="Quick action presentation"
              value={customActionPresentation} onChange={event=>setCustomActionPresentation(event.target.value as 'Modal'|'Side Panel')}>
              <option value="Modal">Modal</option><option value="Side Panel">Side Panel</option>
            </select>
            <QuickActionBindingsEditor scope="object" fields={draft.fields}
              bindings={customActionBindings} onChange={setCustomActionBindings}/>
          </>}
          {customActionBehavior==='Send Email'&&<label className="form-label">Delivery Flow
             <select className="form-control" aria-label="Quick action email Flow"
               value={customActionFlow} onChange={event=>setCustomActionFlow(event.target.value)}>
               <option value="">Choose active Email Flow</option>
               {actionFlows.filter(flow=>flow.status==='Active').map(flow=>
                 <option key={flow.apiName} value={flow.apiName}>{flow.label}</option>)}
             </select>
           </label>}
           {customActionBehavior==='Create Related'&&<>
            <select className="form-control" aria-label="Quick action related object"
              value={customActionTargetObject} onChange={event=>{setCustomActionTargetObject(event.target.value);
                setCustomActionRelationshipField('');}}>
              <option value="">Choose child object</option>
              {objects.filter(item=>relationsFor(item.apiName).length>0).map(item=>
                <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
            </select>
            <select className="form-control" aria-label="Quick action relationship field"
              value={customActionRelationshipField}
              onChange={event=>setCustomActionRelationshipField(event.target.value)}>
              <option value="">Choose relationship</option>
              {relationsFor(customActionTargetObject).map(field=>
                <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
            </select>
          </>}
          <button className="btn" onClick={addCustomAction}
            disabled={!customActionLabel.trim()||customActionLabel.length>80
              ||(customActionBehavior==='Set Field Value'&&!customActionFieldApiName)
              ||(customActionBehavior==='Run Flow'&&!customActionFlow)
              ||(customActionBehavior==='Open Component'&&!customActionComponent)
              ||(customActionBehavior==='Send Email'&&!customActionFlow)
              ||(customActionBehavior==='Create Related'&&(!customActionTargetObject||!customActionRelationshipField))}>
            <Plus size={14}/>Add Action</button>
        </div>
      </div>
      <p className="permission-help">After saving an Object action, add it to the desired Page Layout action list to display it on records.</p>
      <React.Suspense fallback={<p>Loading global Quick Actions…</p>}><GlobalQuickActionsEditor apiRequest={apiRequest} objects={objects} flows={eligibleFlows} components={actionComponents} onNotify={onNotify}/></React.Suspense>
    </section>;
  };
  const renderLightningRecordPages = () => {
    const pageMatches = Boolean(page && page.targetObject === draft.apiName && page.pageType === 'Record Page');
    const assignments = pageMatches ? page?.activationAssignments ?? [] : [];
    const addActivation = () => {
      if (!pageMatches || !page) {
        onNotify('Create and save a record page for this object in Lightning App Builder first');
        return;
      }
      if (!activationFormFactors.length) {
        onNotify('Select at least one form factor');
        return;
      }
      const assignment: PageActivationAssignmentMetadata = {
        id: `activation-${crypto.randomUUID()}`,
        scope: activationScope,
        appId: activationScope === 'Org Default' ? null : activationAppId.trim() || null,
        profileId: activationScope === 'App and Profile' || activationScope === 'App, Record Type, and Profile' ? activationProfileId.trim() || null : null,
        recordTypeId: activationScope === 'App, Record Type, and Profile' ? selectedRecordTypeId || null : null,
        formFactors: activationFormFactors
      };
      if (assignment.scope !== 'Org Default' && !assignment.appId) {
        onNotify('An app name is required for this activation scope');
        return;
      }
      if (assignment.appId && !/^[A-Za-z][A-Za-z0-9_]*$/.test(assignment.appId)) {
        onNotify('App API Name must start with a letter and contain only letters, numbers, and underscores');
        return;
      }
      if (assignment.scope === 'App and Profile' && !assignment.profileId) {
        onNotify('Select a profile for this activation scope');
        return;
      }
      if (assignment.scope === 'App, Record Type, and Profile' && (!assignment.profileId || !assignment.recordTypeId)) {
        onNotify('Select a record type and profile for this activation scope');
        return;
      }
      void onSavePage({ ...page, activationAssignments: [...assignments, assignment] }).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to save page activation'));
    };
    return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Record Pages</h2><p>Configure Record View and Record Edit independently for mobile, tablet, desktop and custom layouts. Activation uses app, profile, record type and device.</p></div><button className="btn btn-brand" onClick={onOpenPageBuilder}><ExternalLink size={14} />Edit Record Page</button></div>
      {!pageMatches || !page ? <div className="empty-state">No saved Lightning Record Page is selected for {draft.label}.</div> : <>
        <div className="metadata-card"><h3>{page.label}</h3><p>{page.status} · {page.components.length} components</p></div>
        <div className="metadata-card">
          <h3>Activation Assignment</h3>
          <PlatformPageSlot slotKey="field-object-23"><label className="form-label">Assign as<select className="form-control" value={activationScope} onChange={(event) => setActivationScope(event.target.value as PageActivationAssignmentMetadata['scope'])}><option>Org Default</option><option>App Default</option><option>App and Profile</option><option>App, Record Type, and Profile</option></select></label></PlatformPageSlot>
          {activationScope !== 'Org Default' && <PlatformPageSlot slotKey="field-object-24"><label className="form-label">App API Name<input className="form-control" list={`lightning-page-apps-${object.apiName}`} value={activationAppId} onChange={(event) => setActivationAppId(event.target.value)} placeholder="For example, Sales" /><datalist id={`lightning-page-apps-${object.apiName}`}>{activationAppIds.map((appId) => <option key={appId} value={appId} />)}</datalist></label></PlatformPageSlot>}
          {activationScope === 'App and Profile' && <PlatformPageSlot slotKey="field-object-25"><label className="form-label">Profile<select className="form-control" value={activationProfileId} onChange={(event) => setActivationProfileId(event.target.value)}><option value="">Select a profile…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label></PlatformPageSlot>}
          {activationScope === 'App, Record Type, and Profile' && <>
            <PlatformPageSlot slotKey="field-object-26"><label className="form-label">Record Type<select className="form-control" value={selectedRecordTypeId} onChange={(event) => setSelectedRecordTypeId(event.target.value)}>{recordTypes.filter((recordType) => recordType.active).map((recordType) => <option key={recordType.id} value={recordType.id}>{recordType.label}</option>)}</select></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-object-27"><label className="form-label">Profile<select className="form-control" value={activationProfileId} onChange={(event) => setActivationProfileId(event.target.value)}><option value="">Select a profile…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label></PlatformPageSlot>
          </>}
          <div className="form-label">Form Factors</div>
          <div className="form-options">{(['Desktop', 'Phone', 'Tablet', 'Custom'] as const).map((formFactor) => <label className="checkbox-row" key={formFactor}><input type="checkbox" disabled={(formFactor==='Desktop'||formFactor==='Phone')&&!page.devices.includes(formFactor)} checked={activationFormFactors.includes(formFactor)} onChange={() => setActivationFormFactors((current) => current.includes(formFactor) ? current.filter((item) => item !== formFactor) : [...current, formFactor])} />{formFactor}</label>)}</div>
          <div className="info-callout">MetaDrive supports independent Tablet and Custom assignments alongside Desktop and Mobile. Each published variant retains its own layout and activation history.</div>
          <button className="btn btn-brand" onClick={addActivation}><Plus size={14} />Add Assignment</button>
        </div>
        {assignments.map((assignment) => <div className="metadata-row" key={assignment.id}><span><strong>{assignment.scope}</strong><small>{assignment.appId ?? 'All apps'} · {recordTypes.find((item) => item.id === assignment.recordTypeId)?.label ?? 'All record types'} · {profiles.find((item) => item.id === assignment.profileId)?.label ?? 'All profiles'} · {assignment.formFactors.join(', ')}</small></span><button className="row-menu" aria-label="Remove page assignment" onClick={() => {
          const activationAssignments = assignments.filter((item) => item.id !== assignment.id);
          void onSavePage({ ...page, status: activationAssignments.length ? page.status : 'Draft', activationAssignments })
            .catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to remove activation assignment'));
        }}><X size={14} /></button></div>)}
        {assignments.length === 0 && <div className="empty-state">This page has no activation assignments yet.</div>}
      </>}
    </section>;
  };
  const renderLookupFilters = () => {
    const filters = draft.relatedLookupFilters ?? [];
    const relationshipFields = draft.fields.filter((field) => field.relationship);
    const valueNotRequired = filterOperator === 'Is Null' || filterOperator === 'Is Not Null';
    const addFilter = () => {
      if (!filterField || !filterRelatedObject || !filterRelatedField || (filterValueMode === 'Field' && !valueNotRequired && !filterValueFieldApiName)) return;
      const filter: RelatedLookupFilterMetadata = {
        id: `lookup-filter-${crypto.randomUUID()}`,
        fieldApiName: filterField,
        relatedObject: filterRelatedObject,
        relatedFieldApiName: filterRelatedField,
        operator: filterOperator,
        value: valueNotRequired || filterValueMode === 'Field' ? '' : filterValue,
        ...(filterValueMode === 'Field' && !valueNotRequired ? { valueFieldApiName: filterValueFieldApiName } : {}),
        required: false
      };
      updateDraft({ relatedLookupFilters: [...filters, filter] });
      setFilterValue('');
      setFilterValueFieldApiName('');
    };
    return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Related Lookup Filters</h2><p>Restrict the records users can select in relationship fields.</p></div><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div>
      <div className="record-type-create">
        <select className="form-control" aria-label="Relationship field" value={filterField} onChange={(event) => {
          const field = relationshipFields.find((item) => item.apiName === event.target.value);
          setFilterField(event.target.value);
          setFilterRelatedObject(field?.relationship?.targetObject ?? '');
          setFilterRelatedField('');
        }}><option value="">Relationship field</option>{relationshipFields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select>
        <select className="form-control" aria-label="Related field" value={filterRelatedField} onChange={(event) => setFilterRelatedField(event.target.value)}><option value="">Related field</option>{(objects.find((item) => item.apiName === filterRelatedObject)?.fields ?? []).map((field) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}</select>
        <select className="form-control" aria-label="Filter operator" value={filterOperator} onChange={(event) => {
          const operator = event.target.value as RelatedLookupFilterMetadata['operator'];
          setFilterOperator(operator);
          if (operator === 'Is Null' || operator === 'Is Not Null') setFilterValue('');
        }}>{relatedLookupFilterOperators.map((operator) => <option key={operator}>{operator}</option>)}</select>
        {!valueNotRequired && <>
          <select className="form-control" aria-label="Compare against" value={filterValueMode} onChange={(event) => setFilterValueMode(event.target.value as 'Value' | 'Field')}><option value="Value">A value</option><option value="Field">A field on this object</option></select>
          {filterValueMode === 'Field'
            ? <select className="form-control" aria-label="Source field" value={filterValueFieldApiName} onChange={(event) => setFilterValueFieldApiName(event.target.value)}><option value="">Source field</option>{draft.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}</select>
            : <input className="form-control" aria-label="Filter value" placeholder="Value" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} />}
        </>}
        <button className="btn" onClick={addFilter} disabled={!filterField || !filterRelatedObject || !filterRelatedField || (filterValueMode === 'Field' && !valueNotRequired && !filterValueFieldApiName)}><Plus size={14} />Add Filter</button>
      </div>
      {filters.map((filter) => <div className="metadata-row" key={filter.id}><span><strong>{filter.fieldApiName}</strong><small>{filter.relatedObject}.{filter.relatedFieldApiName} {filter.operator}{filter.valueFieldApiName ? ` ${filter.valueFieldApiName}` : filter.operator === 'Is Null' || filter.operator === 'Is Not Null' ? '' : ` ${filter.value}`}</small><select className="form-control compact-select" aria-label={`Operator for ${filter.fieldApiName}`} value={filter.operator} onChange={(event) => {
        const operator = event.target.value as RelatedLookupFilterMetadata['operator'];
        const valueNotRequired = operator === 'Is Null' || operator === 'Is Not Null';
        updateDraft({ relatedLookupFilters: filters.map((item) => item.id === filter.id ? { ...item, operator, value: valueNotRequired ? '' : item.value, ...(valueNotRequired ? { valueFieldApiName: undefined } : {}) } : item) });
      }}>{relatedLookupFilterOperators.map((operator) => <option key={operator}>{operator}</option>)}</select>
      <select className="form-control compact-select" aria-label={`Comparison source for ${filter.fieldApiName}`} value={filter.valueFieldApiName ? 'Field' : 'Value'} disabled={filter.operator === 'Is Null' || filter.operator === 'Is Not Null'} onChange={(event) => updateDraft({ relatedLookupFilters: filters.map((item) => item.id === filter.id ? { ...item, value: '', valueFieldApiName: event.target.value === 'Field' ? draft.fields[0]?.apiName : undefined } : item) })}><option value="Value">Value</option><option value="Field">Field</option></select>
      {filter.valueFieldApiName
        ? <select className="form-control compact-select" aria-label={`Source field for ${filter.fieldApiName}`} value={filter.valueFieldApiName} onChange={(event) => updateDraft({ relatedLookupFilters: filters.map((item) => item.id === filter.id ? { ...item, valueFieldApiName: event.target.value } : item) })}>{draft.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select>
        : <input className="form-control compact-select" aria-label={`Value for ${filter.fieldApiName}`} value={filter.value} disabled={filter.operator === 'Is Null' || filter.operator === 'Is Not Null'} onChange={(event) => updateDraft({ relatedLookupFilters: filters.map((item) => item.id === filter.id ? { ...item, value: event.target.value } : item) })} />}
      </span><label className="checkbox-row"><input type="checkbox" checked={filter.required} onChange={(event) => updateDraft({ relatedLookupFilters: filters.map((item) => item.id === filter.id ? { ...item, required: event.target.checked } : item) })} />Required</label><button className="row-menu" aria-label="Remove lookup filter" onClick={() => {
        const remainingFilters = filters.filter((item) => item.id !== filter.id);
        const remainingLogic = { ...draft.relatedLookupFilterLogic };
        if (!remainingFilters.some((item) => item.fieldApiName === filter.fieldApiName)) delete remainingLogic[filter.fieldApiName];
        updateDraft({ relatedLookupFilters: remainingFilters, relatedLookupFilterLogic: remainingLogic });
      }}><X size={14} /></button></div>)}
      {relationshipFields.map((field) => {
        const fieldFilters = filters.filter((filter) => filter.fieldApiName === field.apiName);
        if (fieldFilters.length < 2) return null;
        return <PlatformPageSlot slotKey="field-object-28"><label className="form-label" key={`logic-${field.apiName}`}>Required criteria match for {field.label}
          <select className="form-control" aria-label={`Lookup filter logic for ${field.label}`} value={draft.relatedLookupFilterLogic?.[field.apiName] ?? 'All'} onChange={(event) => {
            const relatedLookupFilterLogic = { ...draft.relatedLookupFilterLogic };
            if (event.target.value === 'All') delete relatedLookupFilterLogic[field.apiName];
            else relatedLookupFilterLogic[field.apiName] = event.target.value as 'Any';
            updateDraft({ relatedLookupFilterLogic });
          }}>
            <option value="All">All criteria</option><option value="Any">Any criterion</option>
          </select>
        </label></PlatformPageSlot>;
      })}
      {relationshipFields.length === 0 && <div className="empty-state">Create a lookup or master-detail field to configure a related lookup filter.</div>}
    </section>;
  };
  const renderListViewButtons = () => {
    const supportsOwnership = draft.fields.some((field) =>
      field.apiName === 'OwnerId' && field.relationship?.targetObject === 'User');
    const standard = [
      ...(draft.apiName === 'User' ? [] : ['New']),
      ...(supportsOwnership ? ['Change Owner'] : []),
      'Import',
      'Printable View',
    ];
    const selected = draft.listViewButtons ?? [];
    return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>List View Button Layout</h2><p>Select buttons available in this object’s list views.</p></div><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div>
      {standard.map((label) => <label className="metadata-row" key={label}><span>{label}</span><input type="checkbox" checked={selected.includes(label)} onChange={() => updateDraft({ listViewButtons: toggleField(selected, label) })} /></label>)}
    </section>;
  };

  // Object settings share one read-only list/detail/edit interaction. The existing
  // metadata editors remain the only writers; browsing never mutates metadata.
  const collectionSettings = [
    'Page Layouts', 'Compact Layouts', 'Record Types', 'Field Sets',
    'Buttons, Links, and Actions', 'Lightning Record Pages',
    'Search Layouts', 'Related Lookup Filters', 'List View Button Layout'
  ];
  type BrowserItem = { id: string; label: string; summary: string; details: Array<[string, string]> };
  const browserItems: BrowserItem[] = (() => {
    const item = (id: string, label: string, summary: string, details: Array<[string,string]> = []): BrowserItem =>
      ({ id, label, summary, details });
    switch (selectedSetting) {
      case 'Page Layouts': return (draft.pageLayouts ?? []).map(layout =>
        item(layout.id, layout.label, layout.sections.length + ' sections',
          [['API / ID', layout.id], ['Sections', layout.sections.map(s => s.label).join(', ') || 'None'],
          ['Related lists', layout.relatedLists.join(', ') || 'None']]));
      case 'Compact Layouts': return (draft.compactLayouts ?? []).map(layout =>
        item(layout.id, layout.label, layout.fieldApiNames.length + ' fields',
          [['Fields', layout.fieldApiNames.join(', ') || 'None']]));
      case 'Record Types': return (draft.recordTypes ?? []).map(type =>
        item(type.id, type.label, type.active ? 'Active' : 'Inactive',
          [['Developer name', type.developerName], ['Default', type.isDefault ? 'Yes' : 'No']]));
      case 'Field Sets': return (draft.fieldSets ?? []).map(set =>
        item(set.apiName, set.label, set.fieldApiNames.length + ' fields',
          [['API name', set.apiName], ['Fields', set.fieldApiNames.join(', ') || 'None']]));
      case 'Buttons, Links, and Actions': return (draft.actions ?? []).map(action =>
        item(action.id, action.label, action.behavior || 'Action',
          [['Behaviour', action.behavior || 'Standard action']]));
      case 'Lightning Record Pages': return pages.filter(p =>
        p.targetObject === draft.apiName && p.pageType === 'Record Page').map(p =>
        item(p.apiName, p.label, `${p.recordMode ?? 'View'} · ${p.status}`, [['Record mode', p.recordMode ?? 'View'], ['Available layouts', 'Mobile, Desktop, Tablet, Custom'], ['Status', p.status]]));
      case 'Search Layouts': return [
        item('searchResults', 'Search Results', (draft.searchLayouts?.searchResults ?? []).length + ' fields'),
        item('lookupDialog', 'Lookup Dialog', (draft.searchLayouts?.lookupDialog ?? []).length + ' fields'),
        item('lookupPhoneDialog', 'Phone Lookup', (draft.searchLayouts?.lookupPhoneDialog ?? []).length + ' fields')
      ];
      case 'Related Lookup Filters': return [
        item('lookup-filters', 'Related Lookup Filters', 'Object relationship criteria')
      ];
      case 'List View Button Layout': return [
        item('list-buttons', 'List View Buttons', (draft.listViewButtons ?? []).length + ' enabled',
          [['Enabled buttons', (draft.listViewButtons ?? []).join(', ') || 'None']])
      ];
      default: return [];
    }
  })();
  const selectedMetadata = browserItems.find(item => item.id === selectedMetadataId);
  const openBrowserItem = (item: BrowserItem) => {
    if (selectedSetting === 'Lightning Record Pages') {
      onOpenRecordPage(item.id, 'Desktop');
      return;
    }
    setSelectedMetadataId(item.id);
    if (selectedSetting === 'Page Layouts') setSelectedLayoutId(item.id);
    if (selectedSetting === 'Compact Layouts') setSelectedCompactLayoutId(item.id);
    if (selectedSetting === 'Record Types') setSelectedRecordTypeId(item.id);
    setSectionMode('view');
  };
  const renderBrowseSetting = () => {
    if (selectedSetting === 'Details') return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Details</h2><p>Object definition · Read only</p></div>
        <button className="btn btn-brand" type="button" onClick={() => setSectionMode('edit')}><Pencil size={14}/>Edit</button></div>
      {([['Label', draft.label], ['Plural label', draft.pluralLabel], ['Object name', draft.apiName],
        ['Object type', draft.kind], ['Description', draft.description || '—'],
        ['Help text', draft.helpText || '—'], ['Deployment status', draft.settings?.deploymentStatus || 'Deployed'],
        ['Search enabled', draft.settings?.allowSearch ? 'Yes' : 'No'],
        ['Reports enabled', draft.settings?.allowReports ? 'Yes' : 'No']] as Array<[string,string]>)
        .map(([label, value]) => <div className="metadata-row" key={label}>
          <span>{label}</span><strong>{value}</strong></div>)}
      </section>;
    if (sectionMode === 'view' && selectedMetadata && selectedSetting !== 'Lightning Record Pages') return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>{selectedMetadata.label}</h2><p>{selectedSetting} · Read only</p></div>
        <div className="toolbar-actions">
          <button className="btn" type="button" onClick={() => {setSectionMode('list');setSelectedMetadataId('');}}>Back to list</button>
          <button className="btn btn-brand" type="button" onClick={() => {
            if (selectedSetting === 'Lightning Record Pages') {
              const target = pages.find(candidate => candidate.apiName === selectedMetadata.id);
              if (target) onOpenDependency({workspace:'page-builder',resourceApiName:target.apiName});
            } else setSectionMode('edit');
          }}><Pencil size={14}/>Edit</button>
        </div>
      </div>
      <div className="metadata-row"><span>Name</span><strong>{selectedMetadata.label}</strong></div>
      <div className="metadata-row"><span>Summary</span><strong>{selectedMetadata.summary}</strong></div>
      {selectedMetadata.details.map(([label, value]) => <div className="metadata-row" key={label}>
        <span>{label}</span><strong>{value}</strong></div>)}
    </section>;
    return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>{selectedSetting}</h2><p>{selectedSetting === 'Lightning Record Pages' ? 'Record View and Record Edit are owned by Object Manager. Select a page or choose its Mobile, Desktop, Tablet or Custom layout. Each page has independent Mobile, Desktop, Tablet and Custom drafts, publishing and assignments.' : 'Select an item to view its configuration.'}</p></div>
        {selectedSetting !== 'Lightning Record Pages' && <button className="btn btn-brand" type="button"
          onClick={() => {setSelectedMetadataId('');setSectionMode('edit');}}><Plus size={14}/>New / Configure</button>}
      </div>
      <div className="table-scroll"><table className="slds-table">
        <thead><tr><th>Name</th><th>Details</th><th>{selectedSetting === 'Lightning Record Pages' ? 'Edit layout' : 'Action'}</th></tr></thead>
        <tbody>{browserItems.map(item => <tr key={item.id}>
          <td><button type="button" className="field-link" onClick={() => openBrowserItem(item)}>{item.label}</button></td>
          <td>{item.summary}</td>
          <td>{selectedSetting === 'Lightning Record Pages'
            ? <div className="toolbar-actions" role="group" aria-label={`Edit device layouts for ${item.label}`}>
              {recordPageLayoutVariants.map(variant => {
                const DeviceIcon = variant === 'Mobile' ? Smartphone : variant === 'Desktop' ? Monitor
                  : variant === 'Tablet' ? Tablet : SlidersHorizontal;
                return <button key={variant} type="button" className="btn btn-small"
                  aria-label={`Edit ${variant} layout for ${item.label}`} title={`Edit ${variant} layout`}
                  onClick={() => onOpenRecordPage(item.id, variant)}>
                  <DeviceIcon size={16} aria-hidden="true"/><span>{variant}</span>
                </button>;
              })}
              <button type="button" className="btn btn-small"
                aria-label={`Archive ${item.label}`} onClick={() => {
                  if(!window.confirm('Archive this Record Page? Published pages and version history are preserved.'))return;
                  void onDeleteRecordPage(item.id).catch(error=>onNotify(error instanceof Error?error.message:'Unable to archive Record Page'));
                }}>Archive</button>
            </div>
            : <button type="button" className="btn" onClick={() => openBrowserItem(item)}>View</button>}</td>
        </tr>)}</tbody></table></div>
      {!browserItems.length && <div className="empty-state">No {selectedSetting.toLowerCase()} configured yet.</div>}
      {selectedSetting === 'Lightning Record Pages' && <section aria-label="Create Record Page" className="metadata-card">
        <h3>New Record Page</h3>
        <p>Create an Object-owned draft. Every new Record Page has independently saved and published Mobile, Desktop, Tablet and Custom layouts.</p>
        <div className="toolbar-actions">
          <label className="form-label">Page name
            <input className="form-control" maxLength={100} value={newRecordPageName}
              onChange={event=>setNewRecordPageName(event.target.value)} placeholder="For example, Account Sales View"/>
          </label>
          <label className="form-label">Record operation
            <select className="form-control" value={newRecordPageMode}
              onChange={event=>setNewRecordPageMode(event.target.value as 'View'|'Edit')}>
              <option value="View">Record View</option><option value="Edit">Record Edit</option>
            </select>
          </label>
          <button className="btn btn-brand" type="button" disabled={creatingRecordPage||!newRecordPageName.trim()}
            onClick={()=>void createRecordPage()}><Plus size={14}/>{creatingRecordPage?'Creating…':'Create Draft'}</button>
        </div>
      </section>}
    </section>;
  };
  const renderSetting = () => {
    if (selectedSetting === 'Details' && sectionMode !== 'edit' && !showDeleteObjectConfirmation) return renderBrowseSetting();
    if (collectionSettings.includes(selectedSetting) && sectionMode !== 'edit') return renderBrowseSetting();
    if (selectedSetting === 'Schema Builder') return <SchemaBuilder objects={objects} selectedObjectApiName={object.apiName} onOpenObject={onObjectSelect} onOpenField={(target,fieldApiName)=>onOpenDependency({objectApiName:target.apiName,setting:'Fields & Relationships',resourceApiName:fieldApiName})} onCreateObject={onCreateObject} onNewField={onNewField} />;
    if (selectedSetting === 'Global Value Sets') return <GlobalValueSetManager />;
    if (['Custom Labels','Custom Metadata Types','Custom Settings'].includes(selectedSetting))
      return <CustomMetadataManager setting={selectedSetting} />;
    if (selectedSetting === 'Change History') return <React.Suspense fallback={<p>Loading object history…</p>}>
      <ObjectChangeHistory object={object} onNotify={onNotify}
       onRestored={async()=>{const refreshed=await onRefreshObject(object.apiName);setDraft(refreshed);}} />
     </React.Suspense>;
    if (selectedSetting === 'Details') return renderDetails();
    if (selectedSetting === 'Fields & Relationships') return renderFields();
    if (selectedSetting === 'Validation Rules') return <React.Suspense fallback={<p>Loading rules…</p>}><DeclarativeRulesPanel objectApi={object.apiName} fields={draft.fields} objects={objects} /></React.Suspense>;
    if (selectedSetting === 'Business Automations') return <React.Suspense fallback={<p>Loading automations…</p>}><BusinessAutomationsPanel object={draft} /></React.Suspense>;
    if (selectedSetting === 'Matching Rules') return <React.Suspense fallback={<p>Loading matching rules…</p>}><MatchingRulesPanel object={draft} objects={objects} /></React.Suspense>;
    if (selectedSetting === 'Page Layouts') return renderPageLayouts();
    if (selectedSetting === 'Record Types') return renderRecordTypes();
    if (selectedSetting === 'Compact Layouts') return renderCompactLayout();
    if (selectedSetting === 'Custom Tab') return <section className="surface object-setting-surface">
      <div className="section-toolbar"><div><h2>Custom Tab</h2>
        <p>Configure the icon and colour used for this object in Records navigation.</p></div>
        <button className="btn btn-brand" onClick={persistDraft}>Save</button>
      </div>
      <label className="form-label">Tab Style
        <select className="form-control" value={draft.customTab?.style ?? ''}
          onChange={event=>updateDraft({customTab:event.target.value
            ?{style:event.target.value as NonNullable<ObjectMetadata['customTab']>['style']}:null})}>
          <option value="">No custom tab style</option>
          {(['Blue','Green','Orange','Purple','Red','Teal','Yellow'] as const).map(name=>
            <option value={name} key={name}>{name}</option>)}
        </select>
      </label>
    </section>;
    if (selectedSetting === 'Field Sets') return renderFieldSets();
    if (selectedSetting === 'Search Layouts') return renderSearchLayouts();
    if (selectedSetting === 'Buttons, Links, and Actions') return renderActions();
    if (selectedSetting === 'Related Lookup Filters') return renderLookupFilters();
    if (selectedSetting === 'List View Button Layout') return renderListViewButtons();
    if (selectedSetting === 'Lightning Record Pages') return renderLightningRecordPages();
    if (selectedSetting === 'Object Limits') {
      const usage=[
        {key:'fields' as const,label:'Fields',count:draft.fields.length},
        {key:'pageLayouts' as const,label:'Page Layouts',count:draft.pageLayouts?.length??0},
        {key:'recordTypes' as const,label:'Record Types',count:draft.recordTypes?.length??0},
        {key:'fieldSets' as const,label:'Field Sets',count:draft.fieldSets?.length??0}
      ];
      return <section className="surface object-setting-surface">
        <div className="section-toolbar"><div><h2>Object Limits</h2>
          <p>Tenant-scoped metadata limits are enforced by SQL for all object changes, including APIs and builders.
            Leave a limit blank when no cap is configured.</p></div>
          <button className="btn btn-brand" onClick={persistDraft}><Save size={14}/>Save</button>
        </div>
        <div className="limit-grid">{usage.map(item=><label className="form-label" key={item.key}>
          {item.label} <strong>{item.count} in use</strong>
          <input className="form-control" aria-label={item.label+' maximum'} type="number"
            min={1} max={100000} step={1} placeholder="No limit"
            value={draft.limits?.[item.key]??''}
            onChange={event=>{
              const value=event.target.value.trim();
              updateDraft({limits:{
                fields:null,pageLayouts:null,recordTypes:null,fieldSets:null,
                ...draft.limits,[item.key]:value===''?null:Number(value)
              }});
            }}/>
        </label>)}</div>
      </section>;
    }
    return <section className="surface object-setting-surface"><div className="section-toolbar"><div><h2>{selectedSetting}</h2><p>Configure {selectedSetting.toLowerCase()} for the {draft.label} object.</p></div><button className="btn btn-brand" onClick={persistDraft}><Save size={14} />Save</button></div><div className="empty-state">No {selectedSetting.toLowerCase()} metadata is defined yet.</div></section>;
  };
  if (selectedSetting === 'Objects') return (
    <PlatformPageSlot slotKey="object-workspace"><section className="object-manager surface object-setting-surface" aria-label="Object Manager">
      <div className="section-toolbar"><div><h1>Object Manager</h1><p>Browse object definitions. Select an object to view its details.</p></div>
        <div className="toolbar-actions">
          <button className="btn btn-brand" type="button" aria-label="Create new object" onClick={onCreateObject}><Plus size={14}/>New Object</button>
          <button className="btn" type="button" onClick={()=>void showDeletedObjects()} disabled={deletedObjectsBusy}
            aria-label={deletedObjectsOpen?'Hide Deleted Objects':'Deleted Objects'}>
            <span className="object-action-long">{deletedObjectsOpen?'Hide Deleted Objects':'Deleted Objects'}</span>
            <span className="object-action-short" aria-hidden="true">{deletedObjectsOpen?'Hide Deleted':'Deleted'}</span></button>
          <a className="btn" href="/une/setup/data-loader" aria-label="Universal Data Loader"><Upload size={14}/>
            <span className="object-action-long">Universal Data Loader</span><span className="object-action-short" aria-hidden="true">Data Loader</span></a>
        </div></div>
      {deletedObjectsOpen&&<section className="metadata-card" aria-label="Deleted objects">
        <h2>Deleted Objects</h2>
        {!deletedObjects.length?<p>No deleted custom objects.</p>:<div className="table-scroll"><table className="slds-table">
          <thead><tr><th>Label</th><th>API name</th><th>Deleted</th><th>Action</th></tr></thead>
          <tbody>{deletedObjects.map(item=><tr key={item.apiName}>
            <td>{item.label}</td><td className="api-name">{item.apiName}</td>
            <td>{new Date(item.deletedAt).toLocaleString()}</td>
            <td><button className="btn" type="button" onClick={()=>void onRestoreObject(item.apiName).then(()=>
              setDeletedObjects(current=>current.filter(row=>row.apiName!==item.apiName))).catch(error=>
              onNotify(error instanceof Error?error.message:'Unable to restore object'))}>Restore</button></td>
          </tr>)}</tbody></table></div>}
      </section>}
      <div className="field-list-toolbar">
        <div className="results-count" role="status">{visibleObjects.length} {visibleObjects.length===1?"object":"objects"}</div>
        <div className="field-list-actions"><div className="mini-search"><Search size={14}/>
          <input aria-label="Search objects" value={search} placeholder="Search objects…" onChange={event => onSearch(event.target.value)}/>
        </div><select className="form-control" aria-label="Filter object types" value={viewMode}
          onChange={event => setViewMode(event.target.value as typeof viewMode)}>
          <option>All Objects</option><option>Standard Objects</option><option>Custom Objects</option>
        </select></div>
      </div>
      {visibleObjects.length>0&&<div ref={objectListScrollRef} className="table-scroll object-manager-desktop-list"><table className="slds-table">
        <thead><tr>
          {([['label','Object label'],['apiName','API name'],['kind','Type']] as const).map(([key,label])=>
            <th key={key} aria-sort={objectSortKey===key?(objectSortDescending?'descending':'ascending'):undefined}><button type="button" onClick={()=>changeObjectSort(key)}>{label} {objectSortKey===key&&<span className="md-sort-indicator" aria-hidden="true">{objectSortDescending?'↓':'↑'}</span>}</button></th>)}
          {showDescriptionColumn&&<th>Description</th>}{showDeploymentColumn&&<th>Deployment</th>}
          <th aria-sort={objectSortKey==='fields'?(objectSortDescending?'descending':'ascending'):undefined}><button type="button" onClick={()=>changeObjectSort('fields')}>Fields {objectSortKey==='fields'&&<span className="md-sort-indicator" aria-hidden="true">{objectSortDescending?'↓':'↑'}</span>}</button></th>
        </tr></thead>
        <tbody>{paginatedObjects.map(item => <tr key={item.apiName}>
          <td><a className="field-link" href={'/une/setup/object-manager/'+encodeURIComponent(item.apiName)+'/Details'}
            onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey)return;event.preventDefault();onObjectSelect(item);}}>{item.label}</a></td>
          <td className="api-name">{item.apiName}</td><td>{item.kind}</td>
          {showDescriptionColumn&&<td>{item.description || "—"}</td>}
          {showDeploymentColumn&&<td>{item.settings?.deploymentStatus ?? "Deployed"}</td>}
          <td>{item.fields.length}</td>
        </tr>)}</tbody></table></div>}
      <div className="object-manager-mobile-sort"><label htmlFor="object-mobile-sort">Sort objects</label><select id="object-mobile-sort" value={objectSortKey} onChange={event=>{const key=event.target.value as typeof objectSortKey;if(key!==objectSortKey)changeObjectSort(key);}}><option value="label">Label</option><option value="apiName">API name</option><option value="kind">Type</option><option value="fields">Field count</option></select><button type="button" className="btn object-manager-sort-direction" onClick={()=>{setObjectSortDescending(value=>!value);setObjectListPage(0);resetObjectListScroll();}} aria-label={'Sort '+(objectSortDescending?'ascending':'descending')} title={'Sort '+(objectSortDescending?'ascending':'descending')}>{objectSortDescending?'↓ Descending':'↑ Ascending'}</button></div>
      <div className="object-manager-mobile-list" role="list" aria-label="Objects">
        {paginatedObjects.map(item => <div role="listitem" key={item.apiName}>
          <button type="button" className="object-manager-mobile-row" onClick={() => onObjectSelect(item)}>
            <span className="object-manager-mobile-row-labels"><strong>{item.label}</strong><small>{item.apiName}</small></span>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>)}
      </div>
      {!visibleObjects.length && <div className="empty-state" role="status">
        <p>No objects match the search or selected type.</p>
        <button className="btn" type="button" onClick={()=>{onSearch('');setViewMode('All Objects');}}>Clear filters</button>
      </div>}
      {visibleObjects.length>0&&<nav className="object-manager-pagination" aria-label="Object Manager pages">
        <span role="status" aria-live="polite">{sortedVisibleObjects.length?currentObjectPage*objectPageSize+1:0}–{Math.min((currentObjectPage+1)*objectPageSize,sortedVisibleObjects.length)} of {sortedVisibleObjects.length} {sortedVisibleObjects.length===1?"object":"objects"}</span>
        <button type="button" className="btn" disabled={currentObjectPage===0} onClick={()=>changeObjectPage(Math.max(0,currentObjectPage-1))}>Previous</button>
        <span>Page {currentObjectPage+1} of {objectPageCount}</span>
        <button type="button" className="btn" disabled={currentObjectPage>=objectPageCount-1} onClick={()=>changeObjectPage(Math.min(objectPageCount-1,currentObjectPage+1))}>Next</button>
      </nav>}
    </section></PlatformPageSlot>
  );
  return (
    <PlatformPageSlot slotKey="object-workspace"><div className="object-manager">
      <div className="object-topline"><div className="object-breadcrumb"><button onClick={() => onSettingSelect('Objects')}>Object Manager</button><ChevronRight size={14} /><span>{object.label}</span></div><button className="icon-button subtle" aria-label="Object actions" aria-expanded={showObjectActionsMenu} onClick={() => setShowObjectActionsMenu((current) => !current)}><MoreHorizontal size={18} /></button>
        {showObjectActionsMenu && <div className="object-manager-menu">
          <button type="button" onClick={() => { setShowObjectActionsMenu(false); refreshObject(); }}>Refresh Metadata</button>
          <button type="button" onClick={() => { setShowObjectActionsMenu(false); onNewField(); }}>New Field</button>
          {draft.kind === 'Custom Object' && <button type="button" className="danger-action" onClick={() => { setShowObjectActionsMenu(false); void openDeleteObject(); }}>Delete Object</button>}
        </div>}
      </div>
      <div className="object-manager-layout">
        <div className="object-details">
          <PlatformPageSlot slotKey="object-heading"><div className="object-titlebar"><div className="object-title-icon">{object.label.charAt(0)}</div><div><div className="eyebrow">{object.kind}</div><h1>{object.label}</h1></div>
            <div className="object-title-actions"><button type="button" className="btn" onClick={() => void validateDraft()}>Validate Draft</button><button type="button" className="btn" onClick={onOpenRecords}><Database size={14} />View Records</button></div></div></PlatformPageSlot>
          <div className="md-object-editor-split md-builder-frame">
            <PlatformPageSlot slotKey="object-subnav"><nav className="object-subnav" aria-label="Object settings">
              {objectSettings.map((setting) => <button type="button" key={setting}
                className={selectedSetting === setting ? 'active' : ''}
                aria-current={selectedSetting === setting ? 'page' : undefined}
                onClick={() => onSettingSelect(setting)}>{setting}</button>)}
            </nav>
            <label className="md-object-settings-picker">Object settings
              <select aria-label="Choose object setting" value={selectedSetting}
                onChange={event => onSettingSelect(event.target.value)}>
                {objectSettings.map(setting=><option value={setting} key={setting}>{setting}</option>)}
              </select>
            </label></PlatformPageSlot>
            <div className="md-object-editor-main"><PlatformPageSlot slotKey="object-setting">
              {sectionMode === 'edit' && selectedSetting !== 'Details' && collectionSettings.includes(selectedSetting) &&
                <div className="section-toolbar"><button type="button" className="btn" onClick={() => {
                  setDraft(object);
                  setSectionMode(selectedMetadataId ? 'view' : 'list');
                }}>Cancel / Back</button><span>Editing {selectedSetting}</span></div>}
              {renderSetting()}
            </PlatformPageSlot></div>
          </div>
        </div>
      </div>
      {editingField && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingField(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="field-details-title">
          <div className="modal-header"><h2 id="field-details-title">Field Details</h2><button className="icon-button dark" onClick={() => setEditingField(null)} aria-label="Close"><X size={18} /></button></div>
          <p className="modal-copy">Edit the field label and help metadata. The API name remains stable for existing references.</p>
          <PlatformPageSlot slotKey="field-object-29"><label className="form-label">Field Label<input className="form-control" value={editingField.label} onChange={(event) => setEditingField({ ...editingField, label: event.target.value })} /></label></PlatformPageSlot>
          <PlatformPageSlot slotKey="field-object-30"><label className="form-label">Field Name<div className="form-display">{editingField.apiName}</div></label></PlatformPageSlot>
          <PlatformPageSlot slotKey="field-object-31"><label className="form-label">Data Type<select className="form-control" value={editingField.dataType}
            disabled={!migrationFieldTypeFamily(editingField.dataType, editingField.relationship)}
            onChange={(event) => {
              const dataType = event.target.value;
              const relationshipType = /^(Lookup|Master-Detail|Hierarchical)\(([^)]+)\)$/i.exec(dataType);
              const formulaType = /^Formula\(([^)]+)\)$/i.exec(dataType);
              const isAutoNumber = /^Auto ?Number$/i.test(dataType);
              const isEncrypted = /^(Text \(Encrypted\)|Encrypted Text)$/i.test(dataType);
              const isRollup = dataType === 'Roll-Up Summary';
              const noUniqueConstraint = ['Rich Text Area', 'Multi-Select Picklist', 'Address', 'Geolocation',
                'Text (Encrypted)', 'Roll-Up Summary']
                .includes(dataType) || Boolean(relationshipType) || Boolean(formulaType);
              const next: FieldMetadata = { ...editingField, dataType,
                required: isAutoNumber ? true : isRollup || isEncrypted || formulaType ? false : editingField.required,
                unique: isAutoNumber ? true : noUniqueConstraint || isEncrypted || formulaType ? false : editingField.unique,
                ...(noUniqueConstraint
                  ? { unique: false, externalId: false } : {}),
                ...(isAutoNumber ? { externalId: false } : {}),
                ...(relationshipType ? {
                  required: relationshipType[1].toLowerCase() === 'master-detail' ? true : editingField.required,
                  relationship: {
                    type: relationshipType[1] === 'Hierarchical' ? 'Hierarchical'
                      : relationshipType[1] === 'Master-Detail' ? 'Master-Detail' : 'Lookup',
                    targetObject: relationshipType[2],
                    relationshipName: editingField.relationship?.relationshipName ?? editingField.apiName.replace(/Id$/, ''),
                    childRelationshipName: editingField.relationship?.childRelationshipName
                      ?? `${draft.apiName.replace(/__c$/, '')}Records`,
                    ...(relationshipType[1] === 'Lookup' ? {
                      deleteBehavior: editingField.relationship?.deleteBehavior ?? 'Clear' as const
                    } : {}),
                    ...(relationshipType[1] === 'Master-Detail' ? {
                      allowReparenting: editingField.relationship?.allowReparenting ?? false
                    } : {})
                  }
                } : {})
              };
              if (formulaType) {
                const returnType = formulaType[1].toLowerCase() === 'datetime'
                  ? 'DateTime' : formulaType[1][0].toUpperCase() + formulaType[1].slice(1);
                next.formula = { expression: editingField.formula?.expression ?? '', returnType };
                delete next.defaultValue;
              } else {
                delete next.formula;
              }
              if (isRollup) {
                next.rollup = editingField.rollup ?? {
                  childObject: '', relationshipField: '', operation: 'COUNT', filterLogic: 'All', filters: []
                };
                delete next.defaultValue;
              } else {
                delete next.rollup;
              }
              if (isAutoNumber) {
                next.autoNumberFormat = editingField.autoNumberFormat ?? '{0000}';
                delete next.defaultValue;
              } else {
                delete next.autoNumberFormat;
              }
              if (isEncrypted) delete next.defaultValue;
              if (!relationshipType) delete next.relationship;
              setEditingField(next);
            }}>
            {fieldTypeMigrationChoices(editingField.dataType, objects, editingField.relationship)
              .map((type) => <option value={type} key={type}>{type}</option>)}
          </select></label></PlatformPageSlot>
          {editingField.dataType.startsWith('Text(') && <PlatformPageSlot slotKey="field-object-32"><label className="form-label">Length<input className="form-control" type="number" min={1} max={1000000} step={1} value={editingField.dataType.match(/^Text\((\d+)\)$/)?.[1] ?? ''} onChange={(event) => setEditingField({ ...editingField, dataType: `Text(${event.target.value})` })} /></label></PlatformPageSlot>}
          {/^(Number|Currency|Percent)\(/.test(editingField.dataType) && (() => {
            const [, type = 'Number', precisionText = '18', scaleText = '0'] = editingField.dataType.match(/^(Number|Currency|Percent)\((\d+),\s*(\d+)\)$/) ?? [];
            const precision = Number(precisionText);
            const scale = Number(scaleText);
            return <div className="form-options">
              <PlatformPageSlot slotKey="field-object-33"><label className="form-label">Length (Precision)<input className="form-control" type="number" min={1} max={18} step={1} value={precision} onChange={(event) => {
                const nextPrecision = Number(event.target.value);
                setEditingField({ ...editingField, dataType: `${type}(${event.target.value}, ${Math.min(scale, nextPrecision)})` });
              }} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-object-34"><label className="form-label">Decimal Places (Scale)<input className="form-control" type="number" min={0} max={precision} step={1} value={scale} onChange={(event) => setEditingField({ ...editingField, dataType: `${type}(${precision}, ${event.target.value})` })} /></label></PlatformPageSlot>
            </div>;
          })()}
          {/^Auto ?Number$/i.test(editingField.dataType) && <label className="form-label">Auto Number Format
            <input className="form-control" maxLength={80} value={editingField.autoNumberFormat ?? '{0000}'}
              onChange={(event) => setEditingField({ ...editingField, autoNumberFormat: event.target.value })} />
          </label>}
          {editingField.dataType === 'Roll-Up Summary' && (() => {
            const rollup = editingField.rollup ?? {
              childObject: '', relationshipField: '', operation: 'COUNT' as const,
              filterLogic: 'All' as const, filters: []
            };
            const children = objects.filter((candidate) => candidate.fields.some((field) =>
              field.relationship?.type === 'Master-Detail' && field.relationship.targetObject === draft.apiName));
            const child = children.find((candidate) => candidate.apiName === rollup.childObject);
            const relationFields = child?.fields.filter((field) =>
              field.relationship?.type === 'Master-Detail' && field.relationship.targetObject === draft.apiName) ?? [];
            const sourceFields = child?.fields.filter((field) => {
              const numeric = /^(Number|Currency|Percent)(?:\(|$)/i.test(field.dataType);
              const temporal = /^(Date|Date\/Time|DateTime)$/i.test(field.dataType);
              return numeric || (rollup.operation !== 'SUM' && temporal);
            }) ?? [];
            const filterFields = child?.fields.filter((field) =>
              !/^Formula(?:\(|$)/i.test(field.dataType)
                && !['Roll-Up Summary', 'Geolocation', 'Address', 'Text (Encrypted)'].includes(field.dataType)) ?? [];
            const updateRollup = (next: NonNullable<FieldMetadata['rollup']>) =>
              setEditingField({ ...editingField, rollup: next });
            return <div className="metadata-card">
              <h3>Roll-Up Summary</h3>
              <label className="form-label">Child Object<select className="form-control" value={rollup.childObject}
                onChange={(event) => {
                  const nextChild = children.find((candidate) => candidate.apiName === event.target.value);
                  const relation = nextChild?.fields.find((field) =>
                    field.relationship?.type === 'Master-Detail' && field.relationship.targetObject === draft.apiName);
                  updateRollup({ ...rollup, childObject: nextChild?.apiName ?? '',
                    relationshipField: relation?.apiName ?? '', sourceField: undefined, filters: [] });
                }}>
                <option value="">Select child object</option>{children.map((candidate) =>
                  <option key={candidate.apiName} value={candidate.apiName}>{candidate.label}</option>)}
              </select></label>
              <label className="form-label">Master-Detail Field<select className="form-control"
                value={rollup.relationshipField} onChange={(event) =>
                  updateRollup({ ...rollup, relationshipField: event.target.value })}>
                <option value="">Select relationship</option>{relationFields.map((field) =>
                  <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
              </select></label>
              <label className="form-label">Operation<select className="form-control" value={rollup.operation}
                onChange={(event) => {
                  const operation = event.target.value as NonNullable<FieldMetadata['rollup']>['operation'];
                  updateRollup({ ...rollup, operation,
                    sourceField: operation === 'COUNT' ? undefined
                      : sourceFields.some((field) => field.apiName === rollup.sourceField
                        && (operation !== 'SUM' || /^(Number|Currency|Percent)(?:\(|$)/i.test(field.dataType)))
                        ? rollup.sourceField : undefined });
                }}>
                {(['COUNT', 'SUM', 'MIN', 'MAX'] as const).map((operation) =>
                  <option key={operation} value={operation}>{operation}</option>)}
              </select></label>
              {rollup.operation !== 'COUNT' && <label className="form-label">Summary Field<select className="form-control"
                value={rollup.sourceField ?? ''} onChange={(event) =>
                  updateRollup({ ...rollup, sourceField: event.target.value })}>
                <option value="">Select compatible field</option>{sourceFields.map((field) =>
                  <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
              </select></label>}
              <label className="form-label">Filter Logic<select className="form-control"
                value={rollup.filterLogic ?? 'All'} onChange={(event) =>
                  updateRollup({ ...rollup, filterLogic: event.target.value as 'All' | 'Any' })}>
                <option value="All">All filters</option><option value="Any">Any filter</option>
              </select></label>
              {(rollup.filters ?? []).map((filter, index) => <div className="metadata-card" key={`${filter.fieldApiName}-${index}`}>
                <label className="form-label">Filter Field<select className="form-control"
                  value={filter.fieldApiName} onChange={(event) => updateRollup({ ...rollup,
                    filters: rollup.filters?.map((item, itemIndex) => itemIndex === index
                      ? { ...item, fieldApiName: event.target.value } : item) })}>
                  {filterFields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                </select></label>
                <label className="form-label">Operator<select className="form-control" value={filter.operator}
                  onChange={(event) => updateRollup({ ...rollup, filters: rollup.filters?.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, operator: event.target.value,
                      value: ['Is Null', 'Is Not Null'].includes(event.target.value) ? '' : item.value } : item) })}>
                  {['Equals', 'Not Equal To', 'Greater Than', 'Less Than', 'Contains', 'Is Null', 'Is Not Null']
                    .map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                </select></label>
                {!['Is Null', 'Is Not Null'].includes(filter.operator) && <label className="form-label">Value
                  <input className="form-control" value={filter.value} onChange={(event) =>
                    updateRollup({ ...rollup, filters: rollup.filters?.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, value: event.target.value } : item) })} />
                </label>}
                <button type="button" className="btn" onClick={() => updateRollup({ ...rollup,
                  filters: rollup.filters?.filter((_, itemIndex) => itemIndex !== index) })}>Remove Filter</button>
              </div>)}
              <button type="button" className="btn" disabled={!filterFields.length}
                onClick={() => {
                  const first = filterFields[0];
                  if (first) updateRollup({ ...rollup, filters: [...(rollup.filters ?? []), {
                    fieldApiName: first.apiName, operator: 'Equals', value: ''
                  }] });
                }}>Add Filter</button>
            </div>;
          })()}
          <PlatformPageSlot slotKey="field-object-35"><label className="form-label">Description<input className="form-control" value={editingField.description ?? ''} onChange={(event) => setEditingField({ ...editingField, description: event.target.value })} /></label></PlatformPageSlot>
          <PlatformPageSlot slotKey="field-object-36"><label className="form-label">Help Text<textarea className="form-control" value={editingField.helpText ?? ''} onChange={(event) => setEditingField({ ...editingField, helpText: event.target.value })} maxLength={255} rows={2} /></label></PlatformPageSlot>
          {editingField.dataType !== draft.fields.find((field) => field.apiName === editingField.apiName)?.dataType
            && <div className="info-callout">Saving this change validates and converts every existing value transactionally; invalid values, target picklist mismatches, relationship IDs outside the selected target, and uniqueness conflicts are rejected without partial changes. Text-to-Address requires a JSON component object, and text-to-Geolocation requires latitude,longitude. A before-value snapshot is retained for rollback.</div>}
          <div className="metadata-card">
            <h3>Field Type Migration History</h3>
            {fieldTypeMigrationsLoading && <p className="permission-help">Loading migration history…</p>}
            {!fieldTypeMigrationsLoading && fieldTypeMigrations.length === 0 && <p className="permission-help">No type migrations have been recorded.</p>}
            {fieldTypeMigrations.map((migration) => {
              const latestApplied = migration.status === 'applied'
                && fieldTypeMigrations.find((item) => item.status === 'applied')?.id === migration.id;
              return <div className="metadata-row" key={migration.id}>
                <span><strong>{migration.fromDataType} → {migration.toDataType}</strong>
                  <small>{migration.recordsMigrated} record values · {new Date(migration.createdAt).toLocaleString()} · {migration.status}</small>
                </span>
                {latestApplied && <button type="button" className="btn" onClick={() => void rollbackFieldMigration(migration.id)}>Rollback</button>}
              </div>;
            })}
            {fieldTypeMigrations.length > 0 && <p className="permission-help">Rollback is allowed only in reverse migration order and only when migrated values have not changed or been added since the migration.</p>}
          </div>
          <div className="form-options">
            <label className="checkbox-row"><input type="checkbox" checked={editingField.required}
              disabled={/^Master-Detail\(/i.test(editingField.dataType) || Boolean(editingField.formula)
                || ['Roll-Up Summary', 'Auto Number', 'AutoNumber'].includes(editingField.dataType)}
              onChange={(event) => setEditingField({ ...editingField, required: event.target.checked })} />Required</label>
            <label className="checkbox-row"><input type="checkbox" checked={editingField.unique} disabled={['Long Text Area', 'Rich Text Area', 'Multi-Select Picklist', 'Text (Encrypted)', 'Roll-Up Summary', 'Auto Number', 'AutoNumber'].includes(editingField.dataType) || Boolean(editingField.relationship) || Boolean(editingField.formula)}
              onChange={(event) => {
                const next = { ...editingField, unique: event.target.checked };
                if (!event.target.checked) delete next.caseSensitive;
                setEditingField(next);
              }} />Unique</label>
            {/^(Text(?:\(\d+\))?|Number(?:\(\d+,\s*\d+\))?|Email|Phone|AutoNumber|Auto Number)$/.test(editingField.dataType)
              && <label className="checkbox-row"><input type="checkbox" checked={editingField.externalId ?? false} onChange={(event) => setEditingField({ ...editingField, externalId: event.target.checked })} />External ID</label>}
            {editingField.unique && /^(Text(?:\(\d+\))?|Email|Phone)$/.test(editingField.dataType)
              && <label className="checkbox-row"><input type="checkbox" checked={editingField.caseSensitive ?? false} onChange={(event) => setEditingField({ ...editingField, caseSensitive: event.target.checked })} />Treat uppercase and lowercase values as different</label>}
          </div>
          {!editingField.formula && !editingField.relationship
            && !['AutoNumber', 'Auto Number', 'Roll-Up Summary', 'Text (Encrypted)'].includes(editingField.dataType)
            && (editingField.dataType === 'Checkbox'
            ? <div className="form-options"><label className="checkbox-row"><input type="checkbox" checked={editingField.defaultValue !== undefined} onChange={(event) => { if (event.target.checked) setEditingField({ ...editingField, defaultValue: false }); else { const next = { ...editingField }; delete next.defaultValue; setEditingField(next); } }} />Set a default value</label><label className="checkbox-row"><input type="checkbox" disabled={editingField.defaultValue === undefined} checked={editingField.defaultValue === true} onChange={(event) => setEditingField({ ...editingField, defaultValue: event.target.checked })} />Default to checked</label></div>
            : (editingField.dataType === 'Picklist' || editingField.dataType === 'Multi-Select Picklist')
              ? <PlatformPageSlot slotKey="field-object-37"><label className="form-label">Default Value<select className="form-control" multiple={editingField.dataType === 'Multi-Select Picklist'} value={editingField.dataType === 'Multi-Select Picklist' ? String(editingField.defaultValue ?? '').split(';').filter(Boolean) : String(editingField.defaultValue ?? '')} onChange={(event) => {
                const values = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
                const value = editingField.dataType === 'Multi-Select Picklist' ? values.join(';') : values[0] ?? '';
                if (!value) {
                  const next = { ...editingField };
                  delete next.defaultValue;
                  setEditingField(next);
                } else setEditingField({ ...editingField, defaultValue: value });
              }}><option value="">— None —</option>{(editingField.picklistValues ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label></PlatformPageSlot>
              : <PlatformPageSlot slotKey="field-object-38"><label className="form-label">Default Value<input className="form-control" type={/^(Number|Currency|Percent)(\(|$)/.test(editingField.dataType) ? 'number' : editingField.dataType === 'Date' ? 'date' : ['Date/Time', 'DateTime'].includes(editingField.dataType) ? 'datetime-local' : editingField.dataType === 'Time' ? 'time' : editingField.dataType === 'Email' ? 'email' : editingField.dataType === 'URL' ? 'url' : 'text'}
                min={editingNumericMaximum === undefined ? undefined : -editingNumericMaximum}
                max={editingNumericMaximum}
                step={editingNumericFormat ? (Number(editingNumericFormat[2]) ? 10 ** -Number(editingNumericFormat[2]) : 1) : editingField.dataType === 'Time' ? 1 : undefined}
                maxLength={editingTextMaximum ? Number(editingTextMaximum) : editingField.dataType === 'Text' ? 255 : undefined}
                value={editingField.defaultValue === undefined ? '' : String(editingField.defaultValue)} onChange={(event) => { const value = event.target.value; if (!value) { const next = { ...editingField }; delete next.defaultValue; setEditingField(next); } else setEditingField({ ...editingField, defaultValue: /^(Number|Currency|Percent)(\(|$)/.test(editingField.dataType) ? Number(value) : value }); }} /></label></PlatformPageSlot>)}
          {(editingField.dataType === 'Picklist' || editingField.dataType === 'Multi-Select Picklist') && <>
            <PlatformPageSlot slotKey="field-object-39"><PicklistValueRows key={editingField.apiName + ':' + (editingField.globalValueSetApiName ?? '')} values={editingField.picklistValues ?? []} disabled={Boolean(editingField.globalValueSetApiName)} onChange={(picklistValues, previous, replacement) => {
              const valueSettings = editingField.valueSettings
                ? Object.fromEntries(Object.entries(editingField.valueSettings).map(([key, values]) =>
                  [key, values.map((value) => value === previous ? replacement ?? '' : value).filter((value) => picklistValues.includes(value))]))
                : undefined;
              const nextField: FieldMetadata = { ...editingField, picklistValues, valueSettings };
              if (typeof nextField.defaultValue === 'string') {
                const current = nextField.defaultValue.split(';');
                const updated = current.map((value) => value === previous ? replacement ?? '' : value).filter((value) => picklistValues.includes(value));
                if (updated.length) nextField.defaultValue = updated.join(';');
                else delete nextField.defaultValue;
              }
              setEditingField(nextField);
            }} /></PlatformPageSlot>
            {editingField.globalValueSetApiName&&<p className="permission-help">Values are managed by Global Value Set {editingField.globalValueSetApiName}.</p>}
            <label className="checkbox-row"><input type="checkbox" checked={editingField.picklistRestricted ?? false} onChange={(event) => setEditingField({ ...editingField, picklistRestricted: event.target.checked })} />Restrict to the values defined in the value set</label>
            <><PlatformPageSlot slotKey="field-object-40"><label className="form-label">Controlling Field<select className="form-control" value={editingField.controllerFieldApiName ?? ''} onChange={(event) => {
              const controllerField = draft.fields.find((field) => field.apiName === event.target.value);
              const controllerValues = controllerField?.dataType === 'Checkbox' ? ['true', 'false'] : controllerField?.picklistValues ?? [];
              const nextField: FieldMetadata = { ...editingField };
              if (controllerField) {
                nextField.controllerFieldApiName = controllerField.apiName;
                nextField.valueSettings = Object.fromEntries(controllerValues.map((value) => [value, editingField.valueSettings?.[value] ?? []]));
              } else {
                delete nextField.controllerFieldApiName;
                delete nextField.valueSettings;
              }
              setEditingField(nextField);
            }}>
              <option value="">None</option>{draft.fields.filter((field) => field.apiName !== editingField.apiName && (field.dataType === 'Picklist' || field.dataType === 'Checkbox')).map((field) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.dataType})</option>)}
            </select></label></PlatformPageSlot>
            {editingField.controllerFieldApiName && (() => {
              const controllerField = draft.fields.find((field) => field.apiName === editingField.controllerFieldApiName);
              const controllerValues = controllerField?.dataType === 'Checkbox' ? ['true', 'false'] : controllerField?.picklistValues ?? [];
              return <div className="metadata-card"><h3>Dependent Values</h3><p className="permission-help">Choose the values available for each controlling value.</p>{controllerValues.map((controllerValue) => <div className="metadata-card" key={controllerValue}><strong>{controllerValue}</strong><div className="field-selector-list">{(editingField.picklistValues ?? []).map((value) => <label className="checkbox-row" key={value}><input type="checkbox" checked={(editingField.valueSettings?.[controllerValue] ?? []).includes(value)} onChange={() => {
                const selectedValues = editingField.valueSettings?.[controllerValue] ?? [];
                const nextValues = selectedValues.includes(value) ? selectedValues.filter((item) => item !== value) : [...selectedValues, value];
                setEditingField({ ...editingField, valueSettings: { ...editingField.valueSettings, [controllerValue]: nextValues } });
              }} />{value}</label>)}</div></div>)}</div>;
            })()}</>
          </>}
          <label className="checkbox-row"><input type="checkbox" checked={editingField.trackHistory ?? false} disabled={!draft.settings?.trackFieldHistory || Boolean(editingField.formula)} onChange={(event) => setEditingField({ ...editingField, trackHistory: event.target.checked })} />Track field history</label>
          {!draft.settings?.trackFieldHistory && <div className="info-callout">Enable Track Field History in object Details before selecting fields.</div>}
          {editingField.formula && <>
            <PlatformPageSlot slotKey="field-object-41"><label className="form-label">Formula Return Type<div className="form-display">{editingField.formula.returnType}</div></label></PlatformPageSlot>             <PlatformPageSlot slotKey="field-object-42"><div className="form-label">Formula<SmartFieldInput multiline rows={4} kind="formula" objects={objects} primaryObjectApiName={draft.apiName} value={editingField.formula.expression} onChange={next => setEditingField({ ...editingField, formula: { ...editingField.formula!, expression: next } })} /></div></PlatformPageSlot>
          </>}
          {editingField.dataType === 'Text (Encrypted)' && <div className="info-callout">Values are encrypted at rest and masked in record views. Existing values are re-encrypted during this migration.</div>}
          {editingField.relationship && <div className="info-callout">{editingField.relationship.type} relationship to {editingField.relationship.targetObject}. Changing its type or target validates and migrates every existing record link transactionally.</div>}
          {!editingField.formula && editingField.dataType !== 'Roll-Up Summary' && <div className="form-options"><label className="checkbox-row"><input type="checkbox" checked={editingField.required} disabled={editingField.relationship?.type === 'Master-Detail' || ['Auto Number', 'AutoNumber'].includes(editingField.dataType)} onChange={(event) => setEditingField({ ...editingField, required: event.target.checked })} />Required</label><label className="checkbox-row"><input type="checkbox" checked={editingField.unique} disabled={Boolean(editingField.relationship) || ['Long Text Area', 'Multi-Select Picklist', 'Text (Encrypted)', 'Auto Number', 'AutoNumber'].includes(editingField.dataType)} onChange={(event) => setEditingField({ ...editingField, unique: event.target.checked })} />Unique</label></div>}
          <div className="modal-actions">{editingField.apiName.endsWith('__c') && <button className="btn" onClick={() => setShowDeleteFieldConfirmation(true)}><Trash2 size={14} />Delete</button>}<button className="btn" onClick={() => setEditingField(null)}>Cancel</button><button className="btn btn-brand" onClick={() => {
            void onSaveField(editingField).then((updatedObject) => { setDraft(updatedObject); setEditingField(null); }).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to save field'));
          }} disabled={!editingField.label.trim()
            || (editingField.formula !== undefined && !editingField.formula.expression.trim())
            || (/^Auto ?Number$/i.test(editingField.dataType)
              && !(/\{0+\}/.test(editingField.autoNumberFormat ?? '')
                || /\{YYYY\}/.test(editingField.autoNumberFormat ?? '')))
            || (editingField.dataType === 'Roll-Up Summary' && (!editingField.rollup?.childObject
              || !editingField.rollup.relationshipField
              || (editingField.rollup.operation !== 'COUNT' && !editingField.rollup.sourceField)))} >Save</button></div>
        </section>
      </div>}
      {showDeleteFieldConfirmation && editingField && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDeleteFieldConfirmation(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-field-title">
          <div className="modal-header"><h2 id="delete-field-title">Delete {editingField.label}?</h2><button className="icon-button dark" onClick={() => setShowDeleteFieldConfirmation(false)} aria-label="Close"><X size={18} /></button></div>
          <p className="modal-copy">This permanently deletes the custom field and its values from records. Fields referenced by formulas, dependent picklists, layouts, flows, or pages cannot be deleted.</p>
          <div className="modal-actions"><button className="btn" onClick={() => setShowDeleteFieldConfirmation(false)}>Cancel</button><button className="btn btn-brand" onClick={() => {
            void onDeleteField(editingField.apiName).then((updatedObject) => {
              setDraft(updatedObject);
              setEditingField(null);
              setShowDeleteFieldConfirmation(false);
            }).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to delete field'));
          }}>Delete Field</button></div>
        </section>
      </div>}
    </div></PlatformPageSlot>
  );
}
function FieldSelectorList({ fields, selected, onToggle, onMove }: {
  fields: FieldMetadata[]; selected: string[];
  onToggle: (apiName: string) => void;
  onMove?: (apiName: string, direction: -1 | 1) => void;
}) {
  const ordered = [...selected.flatMap(name => fields.filter(field => field.apiName === name)),
    ...fields.filter(field => !selected.includes(field.apiName))];
  return <div className="field-selector-list">{ordered.map(field => {
    const index = selected.indexOf(field.apiName);
    return <div className="field-selector-row" key={field.apiName}>
      <label className="checkbox-row"><input type="checkbox" checked={index >= 0}
        onChange={() => onToggle(field.apiName)} />{field.label}<small className="api-name">{field.apiName}</small></label>
      {onMove && index >= 0 && <div className="field-selector-sort">
        <button type="button" className="icon-button" aria-label={`Move ${field.label} up`} disabled={index === 0}
          onClick={() => onMove(field.apiName, -1)}>↑</button>
        <button type="button" className="icon-button" aria-label={`Move ${field.label} down`} disabled={index === selected.length - 1}
          onClick={() => onMove(field.apiName, 1)}>↓</button>
      </div>}
    </div>;
  })}</div>;
}
return ObjectManager;
}
