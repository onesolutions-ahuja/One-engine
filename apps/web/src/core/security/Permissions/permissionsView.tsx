import {ObjectPermissionPhoneList} from './ObjectPermissionPhoneList';
import {useViewportWidth} from '../../workspace/Responsive/useViewportWidth';
import { createObjectManager } from '../../builders/ObjectManager/objectManagerView';
import { createSetupHome } from '../../settings/SetupHome/setupHomeView';
import { createSettingsViews } from '../../settings/SettingsWorkspace/settingsWorkspaceViews';
import { pageLayoutForRecord, compactLayoutForRecord, matchesLookupFilterGroup, relatedLookupFilterOperators, type RecordData } from '../../records/RecordWorkspace/recordMetadataUtils';
import { formatRecordValue, parseCsvImport } from '../../records/RecordWorkspace/recordCsvUtils';
import { initialScreenValues, screenFieldIsVisible } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import { objectSettings, parseAppRoute, appRoutePath, type AppRoute } from '../../workspace/Navigation/appRouting';
import { NavigationLoadTime, resolveCurrentAppNavigation } from '../../workspace/Navigation/appNavigationView';
import { isStandalonePagePresentation, pageCanvasPresentationStyle } from '../../pages/PageRuntime/pageRuntimePresentation';
import { insertFlowElementAtPath } from '../../builders/FlowBuilder/flowInsertElement.mjs';
import AdvancedPermissionRules from './AdvancedPermissionRules';
import AdvancedSharingSettings from './AdvancedSharingSettings';
import FieldSecurityWizard from './FieldSecurityWizardPanel';
import {resolveSetupNavigation} from '../../platform/Workspace/platformSetupNavigation';
import {readVerifiedMetadata,saveVerifiedMetadata,type MetadataPublicationResponse} from '../../metadata/Cache/verifiedMetadataCache';
import { queueOfflineRecord, listOfflineRecords, markOfflineRecord, removeOfflineRecord,
  synchronizeOfflineRecords, type OfflineQueueOwner, type OfflineRecordItem, type OfflineRecordWrite } from '../../metadata/Cache/offlineRecordQueue';
import SchemaBuilder from '../../builders/SchemaBuilder/SchemaBuilder';
import * as React from 'react';
import {confirmDestructiveAction} from '../../components/ConfirmAction/confirmDestructiveAction';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Save, Search, ShieldCheck, Trash2 } from 'lucide-react';
import FlowBuilderWorkspace from '../../builders/FlowBuilder/FlowBuilder';
import FlowScreenContent from '../../automation/FlowScreen/FlowScreenContent';
import FlowLogs from '../../automation/FlowLogs/FlowLogs';
import FlowInterviews from '../../automation/FlowInterviews/FlowInterviews';
import ScheduledFlows from '../../automation/ScheduledFlows/ScheduledFlows';
import DashboardBuilder from '../../builders/DashboardBuilder/DashboardBuilder';
import ComponentLibrary from '../../components/ComponentLibrary/ComponentLibrary';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import CustomComponentPropertyEditor from '../../builders/ComponentProperties/CustomComponentPropertyEditor';
import FlowInputBindingEditor from '../../builders/FlowInputBindingEditor/FlowInputBindingEditor';
import RecordFilterEditor from '../../../component-libraries/shared/primitives/RecordFilterEditor/RecordFilterEditor';
import ComponentVisibilityEditor from '../../builders/ComponentProperties/ComponentVisibilityEditor';
import PageRouteDirectory from '../../pages/PageRouteDirectory/PageRouteDirectory';
import { isComponentVisible } from '../../components/Properties/componentVisibility';
import PageComponentVisualEditor from '../../builders/ComponentStyleEditor/PageComponentVisualEditor';
import { canNestComponent, componentVisualStyle, directChildren, isLayoutType, isDescendantOf, layoutTypes } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import PageComponentStyleEditor from '../../builders/ComponentStyleEditor/PageComponentStyleEditor';
import { isCanvasLocked, wrapCanvasComponent, ungroupCanvasComponent } from '../../builders/PageBuilder/canvasInteractions';
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
} from '../../builders/PageBuilder/pageBuilderPalette';
import { type ObjectMetadata, type AccessControlMetadata, type PermissionSetMetadata, type PermissionSetGroupMetadata, type PublicGroupMetadata, type QueueMetadata, type SharingRuleMetadata } from '../../metadata/Definitions/metadata';


export function createPermissions(apiRequest: <T>(path: string, init?: RequestInit) => Promise<T>, PageHeading: (props: {eyebrow?:string;title:string;description?:string;actions?:React.ReactNode}) => React.ReactNode) {
function Permissions({
  accessControl,
  accessControlError,
  objects,
  routeResourceApiName,
  routeResourceId,
  onRouteResourceChange,
  onOpenUserRecords,
  onSave,
  onNotify
}: {
  accessControl: AccessControlMetadata;
  accessControlError: string;
  objects: ObjectMetadata[];
  routeResourceApiName?: string;
  routeResourceId?: string;
  onRouteResourceChange: (resourceApiName: string, resourceId?: string) => void;
  onOpenUserRecords: () => void;
  onSave: (accessControl: AccessControlMetadata) => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const viewportWidth=useViewportWidth();
  const permissionSectionsExpanded=false;
  const [draft, setDraft] = useState(accessControl);
  const [savedDraft, setSavedDraft] = useState(accessControl);
  const permissionDirty=useMemo(()=>JSON.stringify(draft)!==JSON.stringify(savedDraft),[draft,savedDraft]);
  const [mobilePermissionDetail, setMobilePermissionDetail] = useState(Boolean(routeResourceId));
  useEffect(()=>{
    if(routeResourceApiName==='PermissionSets'||routeResourceApiName==='Users')
      setMobilePermissionDetail(Boolean(routeResourceId));
  },[routeResourceApiName,routeResourceId]);
  const [permissionListPage,setPermissionListPage]=useState(0);
  const permissionListPageSize=25;
  const [newRoleId, setNewRoleId] = useState<string | null>(null);
  const [tab, setTab] = useState<'profiles' | 'sets' | 'groups' | 'users' | 'sharing' | 'roles' | 'publicGroups' | 'queues' | 'sharingRules'>(() =>
    routeResourceApiName === 'Users' ? 'users'
      : routeResourceApiName === 'Roles' ? 'roles'
      : routeResourceApiName === 'PublicGroups' ? 'publicGroups'
      : routeResourceApiName === 'Queues' ? 'queues'
      : routeResourceApiName === 'SharingRules' ? 'sharingRules'
      : routeResourceApiName === 'PermissionSetGroups' ? 'groups'
        : routeResourceApiName === 'Profiles' ? 'profiles'
          : routeResourceApiName === 'SharingSettings' ? 'sharing' : 'sets'
  );
  const [selectedId, setSelectedId] = useState(accessControl.permissionSets[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(()=>{
    if(tab!=='roles'||!newRoleId)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.querySelector<HTMLElement>('.permission-role-dialog input:not([disabled])')?.focus();
    return()=>previous?.focus();
  },[tab,newRoleId]);
  const [navigationApps, setNavigationApps] = useState<Array<{ apiName: string; label: string }>>([]);
  const [actionPermissionOptions,setActionPermissionOptions] = useState<Array<{resource:string;label:string}>>([]);
  useEffect(()=>{
    let active=true;
    void apiRequest<{actions:Array<{resource:string;label:string}>}>('/metadata/action-permission-options')
      .then(result=>{if(active)setActionPermissionOptions(result.actions);})
      .catch(()=>{if(active)setActionPermissionOptions([]);});
    return ()=>{active=false;};
  },[]);
  useEffect(() => {
    let active = true;
    void apiRequest<{ apps: Array<{ apiName: string; label: string }> }>('/metadata/apps')
      .then((result) => { if (active) setNavigationApps(result.apps); })
      .catch(() => { if (active) setNavigationApps([]); });
    return () => { active = false; };
  }, []);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(accessControl);
    setSavedDraft(accessControl);
    if (!accessControl.permissionSets.some((item) => item.id === selectedId)
      && !accessControl.permissionSetGroups.some((item) => item.id === selectedId)
      && !accessControl.profiles.some((item) => item.id === selectedId)
      && !accessControl.users.some((item) => item.id === selectedId)
      && !accessControl.roles.some((item) => item.id === selectedId)
      && !accessControl.publicGroups.some((item) => item.id === selectedId)
      && !accessControl.queues.some((item) => item.id === selectedId)
      && !accessControl.sharingRules.some((item) => item.id === selectedId)
      && !Object.hasOwn(accessControl.sharingSettings, selectedId)) {
      setSelectedId(accessControl.profiles[0]?.id ?? accessControl.permissionSets[0]?.id ?? accessControl.permissionSetGroups[0]?.id ?? '');
    }
  }, [accessControl]);

  useEffect(() => {
    const resourceTab = routeResourceApiName === 'Users'
      ? 'users'
      : routeResourceApiName === 'PermissionSetGroups' ? 'groups'
        : routeResourceApiName === 'Profiles' ? 'profiles'
          : routeResourceApiName === 'SharingSettings' ? 'sharing'
              : routeResourceApiName === 'Roles' ? 'roles'
                : routeResourceApiName === 'PublicGroups' ? 'publicGroups'
                  : routeResourceApiName === 'Queues' ? 'queues'
                  : routeResourceApiName === 'SharingRules' ? 'sharingRules' : 'sets';
    setTab(resourceTab);
    if (!routeResourceId) return;
    if (resourceTab === 'sharing') {
      if (selectedId !== routeResourceId) setSelectedId(routeResourceId);
      return;
    }
    if (resourceTab === 'roles') {
      const selectedRole = draft.roles.find((item) => item.id === routeResourceId
        || item.apiName.toLowerCase() === routeResourceId.toLowerCase()
        || item.name.toLowerCase() === routeResourceId.toLowerCase());
      if (selectedRole && selectedId !== selectedRole.id) setSelectedId(selectedRole.id);
      return;
    }
    if (resourceTab === 'publicGroups' || resourceTab === 'queues' || resourceTab === 'sharingRules') {
      const items = resourceTab === 'publicGroups' ? draft.publicGroups
        : resourceTab === 'queues' ? draft.queues : draft.sharingRules;
      const selected = items.find((item) => item.id === routeResourceId || item.apiName === routeResourceId);
      if (selected && selectedId !== selected.id) setSelectedId(selected.id);
      return;
    }
    const selectedProfile = draft.profiles.find((item) => item.apiName === routeResourceId || item.id === routeResourceId);
    const selectedSet = draft.permissionSets.find((item) => item.apiName === routeResourceId || item.id === routeResourceId);
    const selectedGroup = draft.permissionSetGroups.find((item) => item.apiName === routeResourceId || item.id === routeResourceId);
    const selectedUser = draft.users.find((item) => item.id === routeResourceId);
    const selectedItem = resourceTab === 'profiles' ? selectedProfile : resourceTab === 'groups' ? selectedGroup : resourceTab === 'users' ? selectedUser : selectedSet;
    if (selectedItem && selectedId !== selectedItem.id) setSelectedId(selectedItem.id);
  }, [routeResourceApiName, routeResourceId, draft, selectedId]);

  const changeTab = (nextTab: 'profiles' | 'sets' | 'groups' | 'users' | 'sharing' | 'roles' | 'publicGroups' | 'queues' | 'sharingRules') => {
    setTab(nextTab);
    setMobilePermissionDetail(false);
    setPermissionListPage(0);
    const resourceApiName = nextTab === 'profiles' ? 'Profiles' : nextTab === 'sets' ? 'PermissionSets'
      : nextTab === 'groups' ? 'PermissionSetGroups' : nextTab === 'sharing' ? 'SharingSettings'
        : nextTab === 'roles' ? 'Roles' : nextTab === 'publicGroups' ? 'PublicGroups' : nextTab === 'queues' ? 'Queues'
          : nextTab === 'sharingRules' ? 'SharingRules' : 'Users';
    const initialId = nextTab === 'profiles' ? draft.profiles[0]?.id
      : nextTab === 'sets'
      ? draft.permissionSets[0]?.apiName
      : nextTab === 'groups' ? draft.permissionSetGroups[0]?.apiName
        : nextTab === 'sharing' ? objects[0]?.apiName
          : nextTab === 'roles' ? draft.roles[0]?.id
            : nextTab === 'publicGroups' ? draft.publicGroups[0]?.id
              : nextTab === 'queues' ? draft.queues[0]?.id
              : nextTab === 'sharingRules' ? draft.sharingRules[0]?.id : draft.users[0]?.id;
    onRouteResourceChange(resourceApiName, viewportWidth < 1024 && (nextTab==='sets'||nextTab==='users') ? undefined : initialId);
    if (nextTab === 'profiles') setSelectedId(draft.profiles[0]?.id ?? '');
    else if (nextTab === 'sets') setSelectedId(draft.permissionSets[0]?.id ?? '');
    else if (nextTab === 'groups') setSelectedId(draft.permissionSetGroups[0]?.id ?? '');
    else if (nextTab === 'sharing') setSelectedId(objects[0]?.apiName ?? '');
    else if (nextTab === 'roles') setSelectedId(draft.roles[0]?.id ?? '');
    else if (nextTab === 'publicGroups') setSelectedId(draft.publicGroups[0]?.id ?? '');
    else if (nextTab === 'queues') setSelectedId(draft.queues[0]?.id ?? '');
    else if (nextTab === 'sharingRules') setSelectedId(draft.sharingRules[0]?.id ?? '');
    else setSelectedId(draft.users[0]?.id ?? '');
  };
  const selectedProfile = draft.profiles.find((item) => item.id === selectedId);
  const selectedSet = draft.permissionSets.find((item) => item.id === selectedId);
  const selectedGroup = draft.permissionSetGroups.find((item) => item.id === selectedId);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProfiles = draft.profiles.filter((item) => `${item.label} ${item.apiName}`.toLowerCase().includes(normalizedQuery));
  const visibleSets = draft.permissionSets.filter((item) => `${item.label} ${item.apiName}`.toLowerCase().includes(normalizedQuery));
  const totalSetPages=Math.max(1,Math.ceil(visibleSets.length/permissionListPageSize));
  const currentSetPage=Math.min(permissionListPage,totalSetPages-1);
  const pagedSets=visibleSets.slice(currentSetPage*permissionListPageSize,(currentSetPage+1)*permissionListPageSize);
  const visibleGroups = draft.permissionSetGroups.filter((item) => `${item.label} ${item.apiName}`.toLowerCase().includes(normalizedQuery));
  const visibleSharingObjects = objects.filter((item) => `${item.label} ${item.apiName}`.toLowerCase().includes(normalizedQuery));
  const visibleRoles = draft.roles.filter((item) => `${item.name} ${item.apiName}`.toLowerCase().includes(normalizedQuery));
  const visiblePublicGroups = draft.publicGroups.filter((item) => `${item.label} ${item.apiName}`.toLowerCase().includes(normalizedQuery));
  const visibleQueues = draft.queues.filter((item) => `${item.label} ${item.apiName}`.toLowerCase().includes(normalizedQuery));
  const visibleSharingRules = draft.sharingRules.filter((item) => `${item.label} ${item.apiName} ${item.objectApiName}`.toLowerCase().includes(normalizedQuery));
  const createProfile = () => {
    const id = crypto.randomUUID();
    const profile = {
      id,
      label: 'New Profile',
      apiName: `New_Profile_${id.slice(0, 8).replace(/-/g, '')}`,
      license: 'MetaDrive',
      description: '',
      isStandard: false,
      systemPermissions: [],
      objectPermissions: Object.fromEntries(objects.map((object) => [object.apiName, {
        read: false, create: false, edit: false, delete: false, viewAll: false, modifyAll: false
      }])),
      recordTypePermissions: Object.fromEntries(objects.flatMap((object) =>
        (object.recordTypes ?? []).filter((recordType) => recordType.active)
          .map((recordType) => [`${object.apiName}.${recordType.id}`, false]))),
      fieldPermissions: Object.fromEntries(objects.flatMap((object) => object.fields.map((field) => [`${object.apiName}.${field.apiName}`, { read: false, edit: false } as const])))
    };
    setDraft((current) => ({ ...current, profiles: [...current.profiles, profile] }));
    setSelectedId(id);
    onRouteResourceChange('Profiles', profile.apiName);
  };
  const createRole = () => {
    if (newRoleId) { setSelectedId(newRoleId); return; }
    const id = crypto.randomUUID();
    const role = {
      id,
      name: 'New Role',
      apiName: `New_Role_${id.slice(0, 8).replace(/-/g, '')}`,
      parentRoleId: null
    };
    setDraft((current) => ({ ...current, roles: [...current.roles, role] }));
    setNewRoleId(id);
    setSelectedId(id);
    onRouteResourceChange('Roles', id);
  };
  const discardRoleDraft=()=>{
    if(!newRoleId||saving)return;
    setDraft(current=>({...current,roles:current.roles.filter(role=>role.id!==newRoleId)}));
    setNewRoleId(null);setSelectedId('');onRouteResourceChange('Roles');
  };
  const createPublicGroup = () => {
    const id = crypto.randomUUID();
    const group: PublicGroupMetadata = {
      id,
      label: 'New Public Group',
      apiName: `New_Public_Group_${id.slice(0, 8).replace(/-/g, '')}`,
      description: '',
      userIds: [],
      roleIds: [],
      roleAndSubordinateIds: [],
      groupIds: []
    };
    setDraft((current) => ({ ...current, publicGroups: [...current.publicGroups, group] }));
    setSelectedId(id);
    onRouteResourceChange('PublicGroups', id);
  };
  const createQueue = () => {
    const id = crypto.randomUUID();
    const queue: QueueMetadata = {
      id,
      label: 'New Queue',
      apiName: `New_Queue_${id.slice(0, 8).replace(/-/g, '')}`,
      description: '',
      supportedObjectApiNames: objects.filter((object) => object.fields.some((field) => field.apiName === 'OwnerId')).slice(0, 1).map((object) => object.apiName),
      userIds: [],
      roleIds: [],
      roleAndSubordinateIds: [],
      publicGroupIds: []
    };
    setDraft((current) => ({ ...current, queues: [...current.queues, queue] }));
    setSelectedId(id);
    onRouteResourceChange('Queues', id);
  };
  const createSharingRule = () => {
    const id = crypto.randomUUID();
    const object = objects.find((item) => item.apiName !== 'User') ?? objects[0];
    if (!object) return;
    const rule: SharingRuleMetadata = {
      id,
      label: 'New Sharing Rule',
      apiName: `New_Sharing_Rule_${id.slice(0, 8).replace(/-/g, '')}`,
      objectApiName: object.apiName,
      active: false,
      type: 'OwnerBased',
      ownerRoleIds: draft.roles[0] ? [draft.roles[0].id] : [],
      criteria: [],
      filterLogic: 'All',
      targetType: 'PublicGroup',
      targetId: draft.publicGroups[0]?.id ?? '',
      accessLevel: 'Read'
    };
    setDraft((current) => ({ ...current, sharingRules: [...current.sharingRules, rule] }));
    setSelectedId(id);
    onRouteResourceChange('SharingRules', id);
  };
  const createSet = () => {
    const id = crypto.randomUUID();
    const permissionSet: PermissionSetMetadata = {
      id,
      label: 'New Permission Set',
      apiName: `New_Permission_Set_${id.slice(0, 8).replace(/-/g, '')}`,
      license: 'MetaDrive',
      description: '',
      systemPermissions: [],
      objectPermissions: Object.fromEntries(objects.map((object) => [object.apiName, {
        read: false, create: false, edit: false, delete: false, viewAll: false, modifyAll: false
      }])),
      recordTypePermissions: Object.fromEntries(objects.flatMap((object) =>
        (object.recordTypes ?? []).filter((recordType) => recordType.active)
          .map((recordType) => [`${object.apiName}.${recordType.id}`, false]))),
      fieldPermissions: Object.fromEntries(objects.flatMap((object) => object.fields.map((field) => [`${object.apiName}.${field.apiName}`, { read: false, edit: false } as const])))
    };
    setDraft((current) => ({ ...current, permissionSets: [...current.permissionSets, permissionSet] }));
    setSelectedId(id);
    setMobilePermissionDetail(true);
    onRouteResourceChange('PermissionSets', permissionSet.apiName);
  };
  const createGroup = () => {
    const id = crypto.randomUUID();
    const group: PermissionSetGroupMetadata = {
      id,
      label: 'New Permission Set Group',
      apiName: `New_Permission_Set_Group_${id.slice(0, 8).replace(/-/g, '')}`,
      description: '',
      permissionSetIds: [],
      calculationStatus: 'Updated',
      lastCalculatedAt: null,
      mutedSystemPermissions: [],
      mutedObjectPermissions: {},
      mutedRecordTypePermissions: {},
      mutedFieldPermissions: {}
    };
    setDraft((current) => ({ ...current, permissionSetGroups: [...current.permissionSetGroups, group] }));
    setSelectedId(id);
    onRouteResourceChange('PermissionSetGroups', group.apiName);
  };
  const saveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(draft);
      setSavedDraft(draft);
      setNewRoleId(null);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      onNotify(`Unable to save access control: ${message}`);
    } finally {
      setSaving(false);
    }
  };
  const patchSet = (id: string, update: Partial<PermissionSetMetadata>) => {
    setDraft((current) => ({ ...current, permissionSets: current.permissionSets.map((item) => item.id === id ? { ...item, ...update } : item) }));
  };
  const patchGroup = (id: string, update: Partial<PermissionSetGroupMetadata>) => {
    setDraft((current) => ({ ...current, permissionSetGroups: current.permissionSetGroups.map((item) => item.id === id ? { ...item, ...update } : item) }));
  };
  const patchProfile = (id: string, update: Partial<AccessControlMetadata['profiles'][number]>) => {
    setDraft((current) => ({ ...current, profiles: current.profiles.map((item) => item.id === id ? { ...item, ...update } : item) }));
  };
  const patchUser = (id: string, update: Partial<AccessControlMetadata['users'][number]>) => {
    setDraft((current) => ({ ...current, users: current.users.map((item) => item.id === id ? { ...item, ...update } : item) }));
  };
  const patchPublicGroup = (id: string, update: Partial<PublicGroupMetadata>) => {
    setDraft((current) => ({ ...current, publicGroups: current.publicGroups.map((item) => item.id === id ? { ...item, ...update } : item) }));
  };
  const patchQueue = (id: string, update: Partial<QueueMetadata>) => {
    setDraft((current) => ({ ...current, queues: current.queues.map((item) => item.id === id ? { ...item, ...update } : item) }));
  };
  const patchSharingRule = (id: string, update: Partial<SharingRuleMetadata>) => {
    setDraft((current) => ({ ...current, sharingRules: current.sharingRules.map((item) => item.id === id ? { ...item, ...update } : item) }));
  };
  const toggleString = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  const toggleObjectPermission = (set: PermissionSetMetadata, objectName: string, permission: keyof PermissionSetMetadata['objectPermissions'][string]) => {
    const current = set.objectPermissions[objectName] ?? { read: false, create: false, edit: false, delete: false, viewAll: false, modifyAll: false };
    patchSet(set.id, { objectPermissions: { ...set.objectPermissions, [objectName]: { ...current, [permission]: !current[permission] } } });
  };
  const toggleFieldPermission = (set: PermissionSetMetadata, fieldName: string, permission: 'read' | 'edit' | 'create' | 'delete') => {
    const current = set.fieldPermissions[fieldName] ?? { read: false, edit: false };
    patchSet(set.id, { fieldPermissions: { ...set.fieldPermissions, [fieldName]: { ...current, [permission]: !current[permission] } } });
  };
  const [allSystemPermissions,setSystemPermissions]=useState<string[][]>([]);
  useEffect(()=>{void apiRequest<{permissions:Array<{permission_key:string;label:string}>}>('/security/permissions')
    .then(r=>setSystemPermissions(r.permissions.map(p=>[p.permission_key,p.label])))
    .catch(e=>setError('Permission catalogue: '+String(e)));},[]);
  const tabLabel = tab === 'profiles' ? 'Profiles' : tab === 'sets' ? 'Permission Sets'
    : tab === 'groups' ? 'Permission Set Groups' : tab === 'sharing' ? 'Sharing Settings'
      : tab === 'roles' ? 'Roles' : tab === 'publicGroups' ? 'Public Groups'
        : tab === 'sharingRules' ? 'Sharing Rules' : 'Users';

  return <PlatformPageSlot slotKey="permissions"><div className="permissions-page">
    <PageHeading eyebrow={`Setup / ${tabLabel}`} title={tabLabel} description={{profiles: 'Configure baseline permissions and field access for users.', sets: 'Build reusable permission grants and assign them to users.', groups: 'Combine permission sets and configure muted permissions.', users: 'Manage users, profiles, roles and permission assignments.', roles: 'Configure the role hierarchy and inherited record access.', publicGroups: 'Group users and roles for shared record access.', queues: 'Configure shared work queues and their members.', sharing: 'Configure default record visibility and hierarchy access for each object.', sharingRules: 'Grant additional record access through owner-based or criteria-based rules.'}[tab]} actions={<>
      {tab === 'sets' && <button className="btn btn-brand" onClick={createSet} disabled={Boolean(accessControlError)}><Plus size={14} />New Permission Set</button>}
      {tab === 'groups' && <button className="btn btn-brand" onClick={createGroup} disabled={Boolean(accessControlError)}><Plus size={14} />New Permission Set Group</button>}
      {tab === 'profiles' && <button className="btn btn-brand" onClick={createProfile} disabled={Boolean(accessControlError)}><Plus size={14} />New Profile</button>}
      {tab === 'roles' && <button className="btn btn-brand" onClick={createRole} disabled={Boolean(accessControlError)}><Plus size={14} />New Role</button>}
      {tab === 'publicGroups' && <button className="btn btn-brand" onClick={createPublicGroup} disabled={Boolean(accessControlError)}><Plus size={14} />New Public Group</button>}
      {tab === 'queues' && <button className="btn btn-brand" onClick={createQueue} disabled={Boolean(accessControlError) || !objects.some((object) => object.fields.some((field) => field.apiName === 'OwnerId'))}><Plus size={14} />New Queue</button>}
      {tab === 'sharingRules' && <button className="btn btn-brand" onClick={createSharingRule} disabled={Boolean(accessControlError) || (!draft.publicGroups.length || !objects.length)}><Plus size={14} />New Sharing Rule</button>}
      <button className="btn" onClick={() => void saveDraft()} disabled={saving || !permissionDirty || Boolean(accessControlError)}><Save size={14} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </>} />
    {tab === 'sharingRules' && !draft.publicGroups.length && <p className="info-callout">Create a Public Group first to provide a sharing-rule recipient. <button type="button" className="text-action" onClick={() => changeTab('publicGroups')}>Open Public Groups</button></p>}
    {accessControlError && <div className="auth-error" role="alert">Unable to load access-control metadata: {accessControlError}</div>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    <PlatformPageSlot slotKey="rbac-tabs"><>
    <label className="permission-area-select form-label">Permission area
      <select className="form-control" aria-label="Permission area" value={tab} onChange={event=>changeTab(event.target.value as typeof tab)}>
        <optgroup label="Users and identity"><option value="users">Users &amp; Assignments</option><option value="roles">Roles</option><option value="profiles">Profiles</option></optgroup>
        <optgroup label="Access grants"><option value="sets">Permission Sets</option><option value="groups">Permission Set Groups</option></optgroup>
        <optgroup label="Sharing"><option value="sharing">Sharing Settings</option><option value="publicGroups">Public Groups</option><option value="queues">Queues</option><option value="sharingRules">Sharing Rules</option></optgroup>
      </select>
    </label>
    <div className="permission-tabs">
      <button className={tab === 'profiles' ? 'active' : ''} onClick={() => changeTab('profiles')}>Profiles</button>
      <button className={tab === 'sets' ? 'active' : ''} onClick={() => changeTab('sets')}>Permission Sets</button>
      <button className={tab === 'groups' ? 'active' : ''} onClick={() => changeTab('groups')}>Permission Set Groups</button>
      <button className={tab === 'users' ? 'active' : ''} onClick={() => changeTab('users')}>Users & Assignments</button>
      <button className={tab === 'roles' ? 'active' : ''} onClick={() => changeTab('roles')}>Roles</button>
      <button className={tab === 'sharing' ? 'active' : ''} onClick={() => changeTab('sharing')}>Sharing Settings</button>
      <button className={tab === 'publicGroups' ? 'active' : ''} onClick={() => changeTab('publicGroups')}>Public Groups</button>
      <button className={tab === 'queues' ? 'active' : ''} onClick={() => changeTab('queues')}>Queues</button>
      <button className={tab === 'sharingRules' ? 'active' : ''} onClick={() => changeTab('sharingRules')}>Sharing Rules</button>
    </div></></PlatformPageSlot>
    <section className={`surface permission-workspace${tab === 'sharing' ? ' sharing-full-width' : ''}${(tab === 'sets'||tab==='users') ? mobilePermissionDetail ? ' md-permission-sets-detail-mode' : ' md-permission-sets-list-mode' : ''}`} style={tab === 'sharing' ? {gridTemplateColumns: 'minmax(0, 1fr)'} : undefined}>
      {tab !== 'sharing' && <PlatformPageSlot slotKey="rbac-list"><aside className="permission-list">
        <div className="mini-search"><Search size={13} /><input placeholder={`Search ${tabLabel.toLowerCase()}…`} aria-label={`Search ${tabLabel}`} value={query} onChange={(event) => {setQuery(event.target.value);setPermissionListPage(0);}} /></div>
        {tab === 'profiles' && visibleProfiles.map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); onRouteResourceChange('Profiles', item.apiName); }}><strong>{item.label}</strong><small>{item.apiName} · {item.license}</small></button>)}
        {tab === 'sets' && pagedSets.map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setMobilePermissionDetail(true); onRouteResourceChange('PermissionSets', item.apiName); }}><strong>{item.label}</strong><small>{item.apiName}</small></button>)}
        {tab === 'sets' && visibleSets.length>permissionListPageSize && <nav className="md-permission-list-pagination" aria-label="Permission set pages">
          <button type="button" className="btn" disabled={currentSetPage===0} onClick={()=>setPermissionListPage(p=>Math.max(0,p-1))}>Previous</button>
          <span>Page {currentSetPage+1} of {totalSetPages}</span>
          <button type="button" className="btn" disabled={currentSetPage>=totalSetPages-1} onClick={()=>setPermissionListPage(p=>Math.min(totalSetPages-1,p+1))}>Next</button>
        </nav>}
        {tab === 'groups' && visibleGroups.map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); onRouteResourceChange('PermissionSetGroups', item.apiName); }}><strong>{item.label}</strong><small>{item.apiName} · {item.permissionSetIds.length} sets</small></button>)}
        {tab === 'users' && draft.users.filter((item) => `${item.name} ${item.username} ${item.role}`.toLowerCase().includes(normalizedQuery)).map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setMobilePermissionDetail(true); onRouteResourceChange('Users', item.id); }}><strong>{item.name?.trim() || item.username}</strong><small>{item.name?.trim() !== item.username ? item.username : 'Display name not set'}</small><span className="md-user-role-label">Role: {draft.roles.find(role=>role.id===item.roleId)?.name??item.role??'None'}</span></button>)}
        {tab === 'roles' && visibleRoles.map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); onRouteResourceChange('Roles', item.id); }}><strong>{item.name}{item.id === newRoleId ? ' · Unsaved draft' : ''}</strong><small>{item.apiName} · {item.parentRoleId ? draft.roles.find((role) => role.id === item.parentRoleId)?.name ?? 'Unknown parent' : 'Top level'}</small></button>)}
        {tab === 'publicGroups' && visiblePublicGroups.map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); onRouteResourceChange('PublicGroups', item.id); }}><strong>{item.label}</strong><small>{item.apiName} · {item.userIds.length + item.roleIds.length + item.roleAndSubordinateIds.length + item.groupIds.length} members</small></button>)}
        {tab === 'queues' && visibleQueues.map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); onRouteResourceChange('Queues', item.id); }}><strong>{item.label}</strong><small>{item.apiName} · {item.supportedObjectApiNames.length} object types</small></button>)}
        {tab === 'sharingRules' && visibleSharingRules.map((item) => <button key={item.id} className={`permission-list-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); onRouteResourceChange('SharingRules', item.id); }}><strong>{item.label}</strong><small>{item.objectApiName} · {item.type === 'OwnerBased' ? 'Owner-based' : 'Criteria-based'}</small></button>)}
        {tab === 'profiles' && visibleProfiles.length === 0 && <div className="empty-state">No profiles found.</div>}
        {tab === 'sets' && visibleSets.length === 0 && <div className="empty-state">No permission sets found.</div>}
        {tab === 'groups' && visibleGroups.length === 0 && <div className="empty-state">No permission set groups found. Use New Permission Set Group to create one.</div>}
        {tab === 'users' && draft.users.length === 0 && <div className="empty-state">No users are available for assignment.</div>}
        {tab === 'roles' && visibleRoles.length === 0 && <div className="empty-state">No roles found.</div>}
        {tab === 'publicGroups' && visiblePublicGroups.length === 0 && <div className="empty-state">No public groups found.</div>}
        {tab === 'queues' && visibleQueues.length === 0 && <div className="empty-state">No queues found.</div>}
        {tab === 'sharingRules' && visibleSharingRules.length === 0 && <div className="empty-state">No sharing rules found.</div>}
      </aside></PlatformPageSlot>}
      <PlatformPageSlot slotKey="rbac-editor"><div className="permission-editor">
        {(tab === 'sets'||tab==='users') && <button type="button" className="btn md-permission-sets-mobile-back" onClick={() => {setMobilePermissionDetail(false);onRouteResourceChange(tab==='sets'?'PermissionSets':'Users');}}>← All {tab==='sets'?'permission sets':'users'}</button>}
        {tab === 'sharing' && <>
          <div className="md-sharing-mobile-heading">
            <label className="form-label">Configure sharing for object
             <select className="form-control" aria-label="Select object for advanced sharing" value={selectedId&&objects.some(item=>item.apiName===selectedId)?selectedId:''}
              onChange={event=>{setSelectedId(event.target.value);onRouteResourceChange('SharingSettings',event.target.value);}}>
              <option value="">Choose an object</option>{objects.map(object=><option key={object.apiName} value={object.apiName}>{object.label}</option>)}
             </select>
            </label>
          </div>
          <details className="md-sharing-defaults" open={viewportWidth>=1024}>
          <summary>Organisation-wide sharing defaults</summary>
          <div className="section-toolbar"><div><h2>Organization-Wide Defaults</h2><p>Set baseline record visibility per object. Inherited defaults are private until configured; Profiles and Permission Sets control object and field permissions.</p></div><div className="mini-search"><Search size={13}/><input aria-label="Search sharing settings" placeholder="Search objects…" value={query} onChange={event=>setQuery(event.target.value)}/></div></div>
          <div className="permission-table-wrap" role="region" aria-label="Record and field access settings" tabIndex={0}><table className="slds-table permission-matrix"><thead><tr><th scope="col">Object</th><th scope="col">API Name</th><th scope="col">Policy status</th><th scope="col">Default Internal Access</th><th scope="col">Grant Access Using Hierarchies</th></tr></thead><tbody>{visibleSharingObjects.map((object) => {
            const setting = draft.sharingSettings[object.apiName] ?? { defaultAccess: 'Private' as const, grantAccessUsingHierarchies: true };
            return <tr key={object.apiName}><td><button type="button" className="field-link" onClick={()=>{setSelectedId(object.apiName);onRouteResourceChange("SharingSettings",object.apiName);}} aria-label={`Configure advanced sharing for ${object.label}`}><strong>{object.label}</strong></button></td><td title={object.apiName}><code>{object.apiName}</code></td><td>{draft.sharingSettings[object.apiName] ? "Configured" : "Inherited default (Private)"}</td><td><select className="form-control" aria-label={`${object.label} default internal access`} value={setting.defaultAccess} onChange={(event) => {
              const defaultAccess = event.target.value as typeof setting.defaultAccess;
              setDraft((current) => ({ ...current, sharingSettings: {
                ...current.sharingSettings,
                [object.apiName]: { ...setting, defaultAccess }
              } }));
            }}><option value="Private">Private</option><option value="Public Read Only">Public Read Only</option><option value="Public Read/Write">Public Read/Write</option></select></td><td><input type="checkbox" aria-label={`${object.label} grant access using hierarchies`} checked={setting.grantAccessUsingHierarchies} onChange={(event) => setDraft((current) => ({
              ...current,
              sharingSettings: { ...current.sharingSettings, [object.apiName]: { ...setting, grantAccessUsingHierarchies: event.target.checked } }
            }))} /></td></tr>;
          })}</tbody></table></div>
          </details>
          <p className="permission-help">Select an object name to configure advanced sharing rules. Changing a fallback value creates an explicit setting when saved. Private records are visible to their owner and users with explicit sharing or View All/Modify All access. Object and field permissions still apply.</p>
          {visibleSharingObjects.length > 0 && selectedId && visibleSharingObjects.some(item=>item.apiName===selectedId) && (() => {
            const object = visibleSharingObjects.find((item) => item.apiName === selectedId)!;
            const setting = draft.sharingSettings[object.apiName] ?? {
              defaultAccess: 'Private' as const, grantAccessUsingHierarchies: true
            };
            return <details className="md-sharing-advanced" open={viewportWidth>=1024}>
              <summary>Advanced sharing for {object.label}</summary>
              <AdvancedSharingSettings tenantId={draft.tenantId ?? ''} object={object}
               setting={setting} users={draft.users} roles={draft.roles}
               onChange={(next) => setDraft((current) => ({
                 ...current, sharingSettings: { ...current.sharingSettings, [object.apiName]: next }
               }))} />
             </details>;
          })()}
        </>}
        {tab === 'publicGroups' && (() => {
          const selected = draft.publicGroups.find((item) => item.id === selectedId);
          if (!selected) return <div className="empty-state">Select a public group or create one to get started.</div>;
          const patchMembers = (key: 'userIds' | 'roleIds' | 'roleAndSubordinateIds' | 'groupIds', id: string) =>
            patchPublicGroup(selected.id, { [key]: toggleString(selected[key], id) });
          return <>
            <div className="section-toolbar"><div><h2>{selected.label}</h2><p>Public groups can contain users, roles, role hierarchies, and other public groups.</p></div><button className="btn" onClick={() => {
              if (draft.sharingRules.some((rule) => rule.targetType === 'PublicGroup' && rule.targetId === selected.id)
                || draft.publicGroups.some((group) => group.groupIds.includes(selected.id))) return;
              if (!confirmDestructiveAction('Delete', 'Public Group "'+selected.label+'"', 'Saving this change will remove this group from permission metadata.')) return;
              setDraft((current) => ({ ...current, publicGroups: current.publicGroups.filter((item) => item.id !== selected.id) }));
              setSelectedId('');
            }} disabled={draft.sharingRules.some((rule) => rule.targetType === 'PublicGroup' && rule.targetId === selected.id)
              || draft.publicGroups.some((group) => group.groupIds.includes(selected.id))}><Trash2 size={14} />Delete</button></div>
            <div className="permission-form-grid">
              <PlatformPageSlot slotKey="field-rbac-01"><label className="form-label">Label<input className="form-control" value={selected.label} onChange={(event) => patchPublicGroup(selected.id, { label: event.target.value })} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-02"><label className="form-label">API Name<input className="form-control" value={selected.apiName} onChange={(event) => patchPublicGroup(selected.id, { apiName: event.target.value })} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-03"><label className="form-label">Description<input className="form-control" value={selected.description} onChange={(event) => patchPublicGroup(selected.id, { description: event.target.value })} /></label></PlatformPageSlot>
            </div>
            <h3 className="permission-section-heading">Users</h3>
            <div className="permission-check-grid">{draft.users.map((user) => <label className="checkbox-row" key={user.id}><input type="checkbox" checked={selected.userIds.includes(user.id)} onChange={() => patchMembers('userIds', user.id)} />{user.name} · {user.username}</label>)}</div>
            <h3 className="permission-section-heading">Roles</h3>
            <div className="permission-check-grid">{draft.roles.map((role) => <label className="checkbox-row" key={role.id}><input type="checkbox" checked={selected.roleIds.includes(role.id)} onChange={() => patchMembers('roleIds', role.id)} />{role.name}</label>)}</div>
            <h3 className="permission-section-heading">Roles and Subordinates</h3>
            <div className="permission-check-grid">{draft.roles.map((role) => <label className="checkbox-row" key={role.id}><input type="checkbox" checked={selected.roleAndSubordinateIds.includes(role.id)} onChange={() => patchMembers('roleAndSubordinateIds', role.id)} />{role.name} and subordinate roles</label>)}</div>
            <h3 className="permission-section-heading">Nested Public Groups</h3>
            <div className="permission-check-grid">{draft.publicGroups.filter((group) => group.id !== selected.id).map((group) => <label className="checkbox-row" key={group.id}><input type="checkbox" checked={selected.groupIds.includes(group.id)} onChange={() => patchMembers('groupIds', group.id)} />{group.label}</label>)}</div>
          </>;
        })()}
        {tab === 'sharingRules' && (() => {
          const selected = draft.sharingRules.find((item) => item.id === selectedId);
          if (!selected) return <div className="empty-state">Select a sharing rule or create one to get started.</div>;
          const object = objects.find((item) => item.apiName === selected.objectApiName);
          const targetOptions = selected.targetType === 'User' ? draft.users.map((item) => [item.id, item.name] as const)
            : selected.targetType === 'PublicGroup' ? draft.publicGroups.map((item) => [item.id, item.label] as const)
              : draft.roles.map((item) => [item.id, item.name] as const);
          const toggleOwnerRole = (roleId: string) => patchSharingRule(selected.id, {
            ownerRoleIds: toggleString(selected.ownerRoleIds, roleId)
          });
          return <>
            <div className="section-toolbar"><div><h2>{selected.label}</h2><p>Automated record access is evaluated dynamically and never bypasses object or field permissions.</p></div><button className="btn" onClick={() => {
              if (!confirmDestructiveAction('Delete', 'Sharing Rule "'+selected.label+'"', 'Saving this change will stop granting access through this rule.')) return;
              setDraft((current) => ({ ...current, sharingRules: current.sharingRules.filter((item) => item.id !== selected.id) }));
              setSelectedId('');
            }}><Trash2 size={14} />Delete</button></div>
            <div className="permission-form-grid">
              <PlatformPageSlot slotKey="field-rbac-04"><label className="form-label">Label<input className="form-control" value={selected.label} onChange={(event) => patchSharingRule(selected.id, { label: event.target.value })} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-05"><label className="form-label">API Name<input className="form-control" value={selected.apiName} onChange={(event) => patchSharingRule(selected.id, { apiName: event.target.value })} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-06"><label className="form-label">Object<select className="form-control" value={selected.objectApiName} onChange={(event) => patchSharingRule(selected.id, { objectApiName: event.target.value, criteria: [] })}>{objects.filter((item) => item.apiName !== 'User').map((item) => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}</select></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-07"><label className="form-label">Rule Type<select className="form-control" value={selected.type} onChange={(event) => patchSharingRule(selected.id, { type: event.target.value as SharingRuleMetadata['type'] })}><option value="OwnerBased">Owner-based</option><option value="CriteriaBased">Criteria-based</option></select></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-08"><label className="form-label">Share With<select className="form-control" value={selected.targetType} onChange={(event) => {
                const targetType = event.target.value as SharingRuleMetadata['targetType'];
                const initialTarget = targetType === 'User' ? draft.users[0]?.id
                  : targetType === 'PublicGroup' ? draft.publicGroups[0]?.id : draft.roles[0]?.id;
                patchSharingRule(selected.id, { targetType, targetId: initialTarget ?? '' });
              }}><option value="PublicGroup">Public Group</option><option value="Role">Role</option><option value="RoleAndSubordinates">Role and Subordinates</option><option value="User">User</option></select></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-09"><label className="form-label">Target<select className="form-control" value={selected.targetId} onChange={(event) => patchSharingRule(selected.id, { targetId: event.target.value })}>{targetOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-10"><label className="form-label">Access Level<select className="form-control" value={selected.accessLevel} onChange={(event) => patchSharingRule(selected.id, { accessLevel: event.target.value as SharingRuleMetadata['accessLevel'] })}><option value="Read">Read Only</option><option value="Edit">Read/Write</option></select></label></PlatformPageSlot>
              <label className="checkbox-row"><input type="checkbox" checked={selected.active} onChange={(event) => patchSharingRule(selected.id, { active: event.target.checked })} />Active</label>
            </div>
            {selected.type === 'OwnerBased' ? <>
              <h3 className="permission-section-heading">Records Owned By Roles</h3>
              <div className="permission-check-grid">{draft.roles.map((role) => <label className="checkbox-row" key={role.id}><input type="checkbox" checked={selected.ownerRoleIds.includes(role.id)} onChange={() => toggleOwnerRole(role.id)} />{role.name} and subordinate roles</label>)}</div>
            </> : <>
              <h3 className="permission-section-heading">Criteria</h3>
              <PlatformPageSlot slotKey="field-rbac-11"><label className="form-label">Condition Logic<select className="form-control" value={selected.filterLogic} onChange={(event) => patchSharingRule(selected.id, { filterLogic: event.target.value as 'All' | 'Any' })}><option value="All">All conditions are met</option><option value="Any">Any condition is met</option></select></label></PlatformPageSlot>
              {selected.criteria.map((criterion, index) => <div className="permission-form-grid" key={`${selected.id}-criterion-${index}`}>
                <PlatformPageSlot slotKey="field-rbac-12"><label className="form-label">Field<select className="form-control" value={criterion.fieldApiName} onChange={(event) => {
                  const criteria = selected.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, fieldApiName: event.target.value } : item);
                  patchSharingRule(selected.id, { criteria });
                }}>{(object?.fields ?? []).map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select></label></PlatformPageSlot>
                <PlatformPageSlot slotKey="field-rbac-13"><label className="form-label">Operator<select className="form-control" value={criterion.operator} onChange={(event) => {
                  const operator = event.target.value as SharingRuleMetadata['criteria'][number]['operator'];
                  const criteria = selected.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, operator, value: operator === 'Is Null' ? '' : item.value } : item);
                  patchSharingRule(selected.id, { criteria });
                }}>{['Equals', 'Not Equals', 'Contains', 'Starts With', 'Greater Than', 'Less Than', 'Is Null'].map((operator) => <option key={operator}>{operator}</option>)}</select></label></PlatformPageSlot>
                {criterion.operator !== 'Is Null' && <PlatformPageSlot slotKey="field-rbac-14"><label className="form-label">Value<input className="form-control" value={criterion.value} onChange={(event) => {
                  const criteria = selected.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item);
                  patchSharingRule(selected.id, { criteria });
                }} /></label></PlatformPageSlot>}
                <button className="btn" onClick={() => patchSharingRule(selected.id, { criteria: selected.criteria.filter((_item, itemIndex) => itemIndex !== index) })}><Trash2 size={14} />Remove condition</button>
              </div>)}
              <button className="btn" onClick={() => {
                const fieldApiName = object?.fields[0]?.apiName;
                if (fieldApiName) patchSharingRule(selected.id, { criteria: [...selected.criteria, { fieldApiName, operator: 'Equals', value: '' }] });
              }} disabled={!object?.fields.length}><Plus size={14} />Add Condition</button>
            </>}
          </>;
        })()}
        {tab === 'roles' && (() => {
          const selectedRole = draft.roles.find((role) => role.id === selectedId);
          if (!selectedRole) return <div className="empty-state">Select a role or create one to get started.</div>;
          const assignedUsers = draft.users.filter((user) => user.roleId === selectedRole.id);
          const childRoles = draft.roles.filter((role) => role.parentRoleId === selectedRole.id);
          const roleContent = <>
            <div className="section-toolbar"><div><h2>{selectedRole.name}</h2><p>Role hierarchy · {assignedUsers.length} assigned users · {childRoles.length} child roles</p></div><button className="btn" onClick={() => {
              if (assignedUsers.length || childRoles.length) return;
              if (!confirmDestructiveAction('Delete', 'Role "'+selectedRole.name+'"')) return;
              setDraft((current) => ({ ...current, roles: current.roles.filter((role) => role.id !== selectedRole.id) }));
              setSelectedId('');
            }} disabled={Boolean(assignedUsers.length || childRoles.length)}><Trash2 size={14} />Delete</button></div>
            <div className="permission-form-grid">
              <PlatformPageSlot slotKey="field-rbac-15"><label className="form-label">Role Name<input className="form-control" autoFocus={selectedRole.id===newRoleId} value={selectedRole.name} onChange={(event) => setDraft((current) => ({ ...current, roles: current.roles.map((role) => role.id === selectedRole.id ? { ...role, name: event.target.value } : role) }))} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-16"><label className="form-label">Role API Name<input className="form-control" value={selectedRole.apiName} onChange={(event) => setDraft((current) => ({ ...current, roles: current.roles.map((role) => role.id === selectedRole.id ? { ...role, apiName: event.target.value } : role) }))} /></label></PlatformPageSlot>
              <PlatformPageSlot slotKey="field-rbac-17"><label className="form-label">Parent Role (permission structure, not reporting manager)<select className="form-control" value={selectedRole.parentRoleId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, roles: current.roles.map((role) => role.id === selectedRole.id ? { ...role, parentRoleId: event.target.value || null } : role) }))}><option value="">No parent role</option>{draft.roles.filter((role) => role.id !== selectedRole.id).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label></PlatformPageSlot>
            </div>
            {selectedRole.id === newRoleId && <div className="setup-draft-footer"><span role="status">Unsaved role draft</span><button className="btn" disabled={saving} onClick={discardRoleDraft}>Discard draft</button><button className="btn btn-brand" disabled={saving || !selectedRole.name.trim() || !selectedRole.apiName.trim()} onClick={() => void saveDraft()}>{saving ? 'Saving…' : 'Save role'}</button></div>}
            <h3 className="permission-section-heading">Assigned Users</h3>
            {assignedUsers.length ? <ul>{assignedUsers.map((user) => <li key={user.id}>{user.name} · {user.username}</li>)}</ul> : <p className="permission-help">Assign users to this role in Users & Assignments.</p>}
          </>;
          if(selectedRole.id!==newRoleId)return roleContent;
          return createPortal(<div className="permission-role-backdrop" role="presentation">
            <section className="permission-role-dialog" role="dialog" aria-modal="true" aria-label="Create role"
              onKeyDown={event=>{
                if(event.key==='Escape'){event.preventDefault();discardRoleDraft();return;}
                if(event.key!=='Tab')return;
                const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
                ));
                if(!controls.length){event.preventDefault();return;}
                const first=controls[0],last=controls[controls.length-1];
                if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
                else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
              }}>{roleContent}</section>
          </div>,document.body);
        })()}
        {tab === 'profiles' && selectedProfile && <>
          <details className="md-permission-collapsible md-profile-advanced"><summary>Advanced permission rules</summary><AdvancedPermissionRules actionOptions={actionPermissionOptions} systemPermissionKeys={allSystemPermissions.map(([key])=>key)} policy={selectedProfile} onChange={patch=>patchProfile(selectedProfile.id,patch)}/></details>
          <div className="section-toolbar"><div><h2>{selectedProfile.label}</h2><p>Profile · {selectedProfile.apiName}{selectedProfile.isStandard ? ' · Standard' : ''}</p></div><button className="btn" onClick={() => {
            if (selectedProfile.isStandard || draft.users.some((user) => user.profileId === selectedProfile.id)) return;
            if (!confirmDestructiveAction('Delete', 'Profile "'+selectedProfile.label+'"')) return;
            setDraft((current) => ({ ...current, profiles: current.profiles.filter((item) => item.id !== selectedProfile.id) }));
            setSelectedId('');
          }} disabled={selectedProfile.isStandard || draft.users.some((user) => user.profileId === selectedProfile.id)}><Trash2 size={14} />Delete</button></div>
          <div className="permission-form-grid">
            <PlatformPageSlot slotKey="field-rbac-18"><label className="form-label">Label<input className="form-control" value={selectedProfile.label} onChange={(event) => patchProfile(selectedProfile.id, { label: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-19"><label className="form-label">API Name<input className="form-control" value={selectedProfile.apiName} onChange={(event) => patchProfile(selectedProfile.id, { apiName: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-20"><label className="form-label">License<input className="form-control" value={selectedProfile.license} onChange={(event) => patchProfile(selectedProfile.id, { license: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-21"><label className="form-label">Description<input className="form-control" value={selectedProfile.description} onChange={(event) => patchProfile(selectedProfile.id, { description: event.target.value })} /></label></PlatformPageSlot>
          </div>
          <p className="permission-help">Inherited permission sets: {(selectedProfile.inheritedPermissionSetIds??[]).map(id=>draft.permissionSets.find(s=>s.id===id)?.label??id).join(', ')||'None'}</p>
          <details className="md-permission-collapsible md-profile-advanced"><summary>System Permissions</summary>
          <div className="permission-check-grid">{allSystemPermissions.map(([key, label]) => <label className="checkbox-row" key={key}><input type="checkbox" checked={selectedProfile.systemPermissions.includes(key)} onChange={() => patchProfile(selectedProfile.id, { systemPermissions: toggleString(selectedProfile.systemPermissions, key) })} />{label}</label>)}</div>
          
          </details>
          <details className="md-permission-collapsible md-profile-advanced"><summary>Application Access</summary>
          <p className="permission-help">Navigation access does not grant underlying data permissions.</p>
          <div className="permission-check-grid">{navigationApps.map((app) => <label className="checkbox-row" key={app.apiName}>
            <input type="checkbox" checked={Boolean(selectedProfile.appPermissions?.[app.apiName])}
              onChange={(event) => patchProfile(selectedProfile.id, { appPermissions: { ...selectedProfile.appPermissions, [app.apiName]: event.target.checked } })} />
            {app.label}
          </label>)}</div>
          </details>
          <details className="md-permission-collapsible md-profile-advanced"><summary>Tab Visibility</summary>
          <div className="permission-check-grid">{objects.map((object) => <label className="checkbox-row" key={object.apiName}>
            <input type="checkbox" checked={Boolean(selectedProfile.tabPermissions?.[object.apiName])}
              onChange={(event) => patchProfile(selectedProfile.id, { tabPermissions: { ...selectedProfile.tabPermissions, [object.apiName]: event.target.checked } })} />
            {object.label}
          </label>)}</div>
          </details>
          <details className="md-permission-collapsible md-profile-advanced"><summary>Object Permissions</summary>
          <ObjectPermissionPhoneList objects={objects} values={selectedProfile.objectPermissions}
            subject={selectedProfile.label} onToggle={(objectApi,permission)=>{
              const current=selectedProfile.objectPermissions[objectApi]??{read:false,create:false,edit:false,delete:false,viewAll:false,modifyAll:false};
              patchProfile(selectedProfile.id,{objectPermissions:{...selectedProfile.objectPermissions,
                [objectApi]:{...current,[permission]:!current[permission]}}});
            }}/>
          <div className="permission-table-wrap permission-desktop-matrix" role="region" aria-label="Object permission matrix" tabIndex={0}><table className="slds-table permission-matrix"><thead><tr><th scope="col">Object</th><th scope="col">API Name</th>{(['read', 'create', 'edit', 'delete', 'viewAll', 'modifyAll'] as const).map((permission) => <th scope="col" key={permission}>{permission === 'viewAll' ? 'View All' : permission === 'modifyAll' ? 'Modify All' : permission[0].toUpperCase() + permission.slice(1)}</th>)}</tr></thead><tbody>{objects.map((object) => <tr key={object.apiName}><td><strong>{object.label}</strong></td><td title={object.apiName}><code>{object.apiName}</code></td>{(['read', 'create', 'edit', 'delete', 'viewAll', 'modifyAll'] as const).map((permission) => <td key={permission}><input type="checkbox" aria-label={`${selectedProfile.label} ${object.label} ${permission}`} checked={Boolean(selectedProfile.objectPermissions[object.apiName]?.[permission])} onChange={() => {
            const current = selectedProfile.objectPermissions[object.apiName] ?? { read: false, create: false, edit: false, delete: false, viewAll: false, modifyAll: false };
            patchProfile(selectedProfile.id, { objectPermissions: { ...selectedProfile.objectPermissions, [object.apiName]: { ...current, [permission]: !current[permission] } } });
          }} /></td>)}</tr>)}</tbody></table></div>
          </details>
          <details className="md-permission-collapsible md-profile-advanced"><summary>Record Type Access</summary>
          {objects.filter((object) => object.recordTypes?.length).map((object) => <div className="permission-table-wrap" role="region" aria-label={`Record type permissions for ${object.label}`} tabIndex={0} key={object.apiName}><table className="slds-table permission-matrix"><thead><tr><th scope="col">{object.label}</th><th scope="col">Developer Name</th><th scope="col">Available</th></tr></thead><tbody>{object.recordTypes?.filter((recordType) => recordType.active).map((recordType) => {
            const key = `${object.apiName}.${recordType.id}`;
            return <tr key={key}><td><strong>{recordType.label}</strong></td><td title={recordType.developerName}><code>{recordType.developerName}</code></td><td><input type="checkbox" aria-label={`${selectedProfile.label} ${object.label} ${recordType.label} available`} checked={selectedProfile.recordTypePermissions[key] !== false} onChange={() => patchProfile(selectedProfile.id, { recordTypePermissions: { ...selectedProfile.recordTypePermissions, [key]: selectedProfile.recordTypePermissions[key] === false } })} /></td></tr>;
          })}</tbody></table></div>)}
          </details>
          <details className="md-permission-collapsible md-profile-advanced"><summary>Field Permissions</summary>
          <FieldSecurityWizard objects={objects} policyName={selectedProfile.label}
           fieldPermissions={selectedProfile.fieldPermissions}
           onApply={fieldPermissions=>patchProfile(selectedProfile.id,{fieldPermissions})}/>
          {objects.map((object) => <details className="permission-field-group" key={object.apiName}><summary>{object.label} ({object.fields.length} fields)</summary><div className="permission-table-wrap" role="region" aria-label="Record and field access settings" tabIndex={0}><table className="slds-table permission-matrix"><thead><tr><th scope="col">Field</th><th scope="col">API Name</th><th scope="col">Create</th><th scope="col">Read</th><th scope="col">Edit</th><th scope="col">Delete</th></tr></thead><tbody>{object.fields.map((field) => {
            const fieldName = `${object.apiName}.${field.apiName}`;
            const permissions = selectedProfile.fieldPermissions[fieldName] ?? { read: false, edit: false };
            return <tr key={fieldName}><td><strong>{field.label}</strong></td><td title={field.apiName}><code>{field.apiName}</code></td>{(['create', 'read', 'edit', 'delete'] as const).map((permission) => <td key={permission}><input type="checkbox" aria-label={`${selectedProfile.label} ${object.label}.${field.label} ${permission}`} checked={Boolean(permissions[permission])} onChange={() => patchProfile(selectedProfile.id, { fieldPermissions: { ...selectedProfile.fieldPermissions, [fieldName]: { ...permissions, [permission]: !permissions[permission] } } })} /></td>)}</tr>;
          })}</tbody></table></div></details>)}
          </details>
        </>}
        {tab === 'sets' && selectedSet && <>
          <details className="md-permission-collapsible" open={permissionSectionsExpanded}><summary>Advanced permission rules</summary>
           <AdvancedPermissionRules actionOptions={actionPermissionOptions} systemPermissionKeys={allSystemPermissions.map(([key])=>key)} policy={selectedSet} onChange={patch=>patchSet(selectedSet.id,patch)}/></details>
          <div className="section-toolbar"><div><h2>{selectedSet.label}</h2><p>Permission Set · {selectedSet.apiName}</p></div><button className="btn" onClick={() => {
            if (selectedSet.id === 'system-administrator'
              || draft.users.some((user) => user.permissionSetIds.includes(selectedSet.id))
              || draft.permissionSetGroups.some((group) => group.permissionSetIds.includes(selectedSet.id))) return;
            if (!confirmDestructiveAction('Delete', 'Permission Set "'+selectedSet.label+'"')) return;
            setDraft((current) => ({ ...current, permissionSets: current.permissionSets.filter((item) => item.id !== selectedSet.id) }));
            setSelectedId('');
          }} disabled={selectedSet.id === 'system-administrator' || draft.users.some((user) => user.permissionSetIds.includes(selectedSet.id)) || draft.permissionSetGroups.some((group) => group.permissionSetIds.includes(selectedSet.id))}><Trash2 size={14} />Delete</button></div>
          <div className="permission-form-grid">
            <PlatformPageSlot slotKey="field-rbac-22"><label className="form-label">Label<input className="form-control" value={selectedSet.label} onChange={(event) => patchSet(selectedSet.id, { label: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-23"><label className="form-label">API Name<input className="form-control" value={selectedSet.apiName} onChange={(event) => patchSet(selectedSet.id, { apiName: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-24"><label className="form-label">License<input className="form-control" value={selectedSet.license} onChange={(event) => patchSet(selectedSet.id, { license: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-25"><label className="form-label">Description<input className="form-control" value={selectedSet.description} onChange={(event) => patchSet(selectedSet.id, { description: event.target.value })} /></label></PlatformPageSlot>
          </div>
          <details className="md-permission-collapsible" open={permissionSectionsExpanded}><summary>System Permissions</summary>

          <div className="permission-check-grid">{allSystemPermissions.map(([key, label]) => <label className="checkbox-row" key={key}><input type="checkbox" checked={selectedSet.systemPermissions.includes(key)} onChange={() => patchSet(selectedSet.id, { systemPermissions: toggleString(selectedSet.systemPermissions, key) })} />{label}</label>)}</div>
          </details>
          <details className="md-permission-collapsible" open={permissionSectionsExpanded}><summary>Application Access</summary>

          <p className="permission-help">Navigation access does not grant underlying data permissions.</p>
          <div className="permission-check-grid">{navigationApps.map((app) => <label className="checkbox-row" key={app.apiName}>
            <input type="checkbox" checked={Boolean(selectedSet.appPermissions?.[app.apiName])}
              onChange={(event) => patchSet(selectedSet.id, { appPermissions: { ...selectedSet.appPermissions, [app.apiName]: event.target.checked } })} />
            {app.label}
          </label>)}</div>
          </details>
          <details className="md-permission-collapsible" open={permissionSectionsExpanded}><summary>Tab Visibility</summary>

          <div className="permission-check-grid">{objects.map((object) => <label className="checkbox-row" key={object.apiName}>
            <input type="checkbox" checked={Boolean(selectedSet.tabPermissions?.[object.apiName])}
              onChange={(event) => patchSet(selectedSet.id, { tabPermissions: { ...selectedSet.tabPermissions, [object.apiName]: event.target.checked } })} />
            {object.label}
          </label>)}</div>
          </details>
          <details className="md-permission-collapsible" open={permissionSectionsExpanded}><summary>Object Permissions</summary>

          <ObjectPermissionPhoneList objects={objects} values={selectedSet.objectPermissions}
            subject={selectedSet.label} onToggle={(objectApi,permission)=>toggleObjectPermission(selectedSet,objectApi,permission)}/>
          <div className="permission-table-wrap permission-desktop-matrix" role="region" aria-label="Object permission matrix" tabIndex={0}><table className="slds-table permission-matrix"><thead><tr><th scope="col">Object</th><th scope="col">API Name</th>{(['read', 'create', 'edit', 'delete', 'viewAll', 'modifyAll'] as const).map((permission) => <th scope="col" key={permission}>{permission === 'viewAll' ? 'View All' : permission === 'modifyAll' ? 'Modify All' : permission[0].toUpperCase() + permission.slice(1)}</th>)}</tr></thead><tbody>{objects.map((object) => <tr key={object.apiName}><td><strong>{object.label}</strong></td><td title={object.apiName}><code>{object.apiName}</code></td>{(['read', 'create', 'edit', 'delete', 'viewAll', 'modifyAll'] as const).map((permission) => <td key={permission}><input type="checkbox" aria-label={`${object.label} ${permission}`} checked={Boolean(selectedSet.objectPermissions[object.apiName]?.[permission])} onChange={() => toggleObjectPermission(selectedSet, object.apiName, permission)} /></td>)}</tr>)}</tbody></table></div>
          </details>
          <details className="md-permission-collapsible" open={permissionSectionsExpanded}><summary>User reporting data scopes</summary>

          <p className="permission-help">For each Object, decide whether this permission set can access own records, descendants' records or all users' records. The tree follows Reports To, never role or job title. All scopes still require Object permissions and honour explicit denials.</p>
          <div className="permission-form-grid">{objects.map(object => <label key={object.apiName} className="form-label">{object.label}
            <select className="form-control" value={selectedSet.recordDataScopes?.[object.apiName]??''}
              onChange={event => {
                const scopes = {...(selectedSet.recordDataScopes??{})};
                if (!event.target.value) delete scopes[object.apiName];
                else scopes[object.apiName] = event.target.value as 'all'|'descendants'|'own';
                patchSet(selectedSet.id,{recordDataScopes:scopes});
              }}>
              <option value="">Default record sharing</option>
              <option value="own">My Records</option>
              <option value="descendants">My Descendants (including me)</option>
              <option value="all">All Users (tenant-wide)</option>
            </select>
          </label>)}</div>
          </details>
          <details className="md-permission-collapsible" open={permissionSectionsExpanded}><summary>Record Type Access</summary>

          {objects.filter((object) => object.recordTypes?.length).map((object) => <div className="permission-table-wrap" role="region" aria-label={`Record type permissions for ${object.label}`} tabIndex={0} key={object.apiName}><table className="slds-table permission-matrix"><thead><tr><th scope="col">{object.label}</th><th scope="col">Developer Name</th><th scope="col">Available</th></tr></thead><tbody>{object.recordTypes?.filter((recordType) => recordType.active).map((recordType) => {
            const key = `${object.apiName}.${recordType.id}`;
            return <tr key={key}><td><strong>{recordType.label}</strong></td><td title={recordType.developerName}><code>{recordType.developerName}</code></td><td><input type="checkbox" aria-label={`${selectedSet.label} ${object.label} ${recordType.label} available`} checked={selectedSet.recordTypePermissions[key] === true} onChange={() => patchSet(selectedSet.id, { recordTypePermissions: { ...selectedSet.recordTypePermissions, [key]: selectedSet.recordTypePermissions[key] !== true } })} /></td></tr>;
          })}</tbody></table></div>)}
          </details>
          <h3 className="permission-section-heading">Field Permissions</h3>
          <FieldSecurityWizard objects={objects} policyName={selectedSet.label}
           fieldPermissions={selectedSet.fieldPermissions}
           onApply={fieldPermissions=>patchSet(selectedSet.id,{fieldPermissions})}/>
          {objects.map((object) => <details className="permission-field-group" key={object.apiName}><summary>{object.label} ({object.fields.length} fields)</summary><div className="permission-table-wrap" role="region" aria-label="Record and field access settings" tabIndex={0}><table className="slds-table permission-matrix"><thead><tr><th scope="col">Field</th><th scope="col">API Name</th><th scope="col">Create</th><th scope="col">Read</th><th scope="col">Edit</th><th scope="col">Delete</th></tr></thead><tbody>{object.fields.map((field) => {
            const fieldName = `${object.apiName}.${field.apiName}`;
            const permissions = selectedSet.fieldPermissions[fieldName] ?? { read: false, edit: false };
            return <tr key={fieldName}><td><strong>{field.label}</strong></td><td title={field.apiName}><code>{field.apiName}</code></td>{(['create', 'read', 'edit', 'delete'] as const).map((permission) => <td key={permission}><input type="checkbox" aria-label={`${object.label}.${field.label} ${permission}`} checked={Boolean(permissions[permission])} onChange={() => toggleFieldPermission(selectedSet, fieldName, permission)} /></td>)}</tr>;
          })}</tbody></table></div></details>)}
        </>}
        {tab === 'groups' && selectedGroup && <>
          <div className="section-toolbar"><div><h2>{selectedGroup.label}</h2><p>Permission Set Group · {selectedGroup.apiName}</p></div><button className="btn" onClick={() => {
            if (draft.users.some((user) => user.permissionSetGroupIds.includes(selectedGroup.id))) return;
            if (!confirmDestructiveAction('Delete', 'Permission Set Group "'+selectedGroup.label+'"')) return;
            setDraft((current) => ({ ...current, permissionSetGroups: current.permissionSetGroups.filter((item) => item.id !== selectedGroup.id) }));
            setSelectedId('');
          }} disabled={draft.users.some((user) => user.permissionSetGroupIds.includes(selectedGroup.id))}><Trash2 size={14} />Delete</button></div>
          <div className="permission-form-grid">
            <PlatformPageSlot slotKey="field-rbac-26"><label className="form-label">Label<input className="form-control" value={selectedGroup.label} onChange={(event) => patchGroup(selectedGroup.id, { label: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-27"><label className="form-label">API Name<input className="form-control" value={selectedGroup.apiName} onChange={(event) => patchGroup(selectedGroup.id, { apiName: event.target.value })} /></label></PlatformPageSlot>
            <PlatformPageSlot slotKey="field-rbac-28"><label className="form-label">Description<input className="form-control" value={selectedGroup.description} onChange={(event) => patchGroup(selectedGroup.id, { description: event.target.value })} /></label></PlatformPageSlot>
          </div>
          <h3 className="permission-section-heading">Permission Sets in Group</h3>
          <div className="permission-check-grid">{draft.permissionSets.map((permissionSet) => <label className="checkbox-row" key={permissionSet.id}><input type="checkbox" checked={selectedGroup.permissionSetIds.includes(permissionSet.id)} onChange={() => patchGroup(selectedGroup.id, { permissionSetIds: toggleString(selectedGroup.permissionSetIds, permissionSet.id) })} />{permissionSet.label}</label>)}</div>
          <details className="md-permission-collapsible md-permission-group-advanced"><summary>Muted System Permissions</summary>
          <p className="permission-help">Muted permissions remove grants contributed by this group; direct permission-set assignments remain in effect.</p>
          <div className="permission-check-grid">{allSystemPermissions.map(([key, label]) => <label className="checkbox-row" key={key}><input type="checkbox" checked={selectedGroup.mutedSystemPermissions.includes(key)} onChange={() => patchGroup(selectedGroup.id, { mutedSystemPermissions: toggleString(selectedGroup.mutedSystemPermissions, key) })} />{label}</label>)}</div>
          
          </details>
          <details className="md-permission-collapsible md-permission-group-advanced"><summary>Muted Application Access</summary>
          <div className="permission-check-grid">{navigationApps.map((app) => <label className="checkbox-row" key={app.apiName}>
            <input type="checkbox" checked={Boolean(selectedGroup.mutedAppPermissions?.[app.apiName])}
              onChange={(event) => patchGroup(selectedGroup.id, { mutedAppPermissions: { ...selectedGroup.mutedAppPermissions, [app.apiName]: event.target.checked } })} />
            {app.label}
          </label>)}</div>
          </details>
          <details className="md-permission-collapsible md-permission-group-advanced"><summary>Muted Tab Visibility</summary>
          <div className="permission-check-grid">{objects.map((object) => <label className="checkbox-row" key={object.apiName}>
            <input type="checkbox" checked={Boolean(selectedGroup.mutedTabPermissions?.[object.apiName])}
              onChange={(event) => patchGroup(selectedGroup.id, { mutedTabPermissions: { ...selectedGroup.mutedTabPermissions, [object.apiName]: event.target.checked } })} />
            {object.label}
          </label>)}</div>
          </details>
          <details className="md-permission-collapsible md-permission-group-advanced"><summary>Muted Object Permissions</summary>
          <ObjectPermissionPhoneList objects={objects} values={selectedGroup.mutedObjectPermissions}
            subject={'Muted '+selectedGroup.label} onToggle={(objectApi,permission)=>{
              patchGroup(selectedGroup.id,{mutedObjectPermissions:{...selectedGroup.mutedObjectPermissions,
                [objectApi]:{...selectedGroup.mutedObjectPermissions[objectApi],
                  [permission]:!selectedGroup.mutedObjectPermissions[objectApi]?.[permission]}}});
            }}/>
          <div className="permission-table-wrap permission-desktop-matrix" role="region" aria-label="Object permission matrix" tabIndex={0}><table className="slds-table permission-matrix"><thead><tr><th scope="col">Object</th><th scope="col">API Name</th>{(['read', 'create', 'edit', 'delete', 'viewAll', 'modifyAll'] as const).map((permission) => <th scope="col" key={permission}>{permission === 'viewAll' ? 'View All' : permission === 'modifyAll' ? 'Modify All' : permission[0].toUpperCase() + permission.slice(1)}</th>)}</tr></thead><tbody>{objects.map((object) => <tr key={object.apiName}><td><strong>{object.label}</strong></td><td title={object.apiName}><code>{object.apiName}</code></td>{(['read', 'create', 'edit', 'delete', 'viewAll', 'modifyAll'] as const).map((permission) => <td key={permission}><input type="checkbox" aria-label={`Mute ${object.label} ${permission}`} checked={Boolean(selectedGroup.mutedObjectPermissions[object.apiName]?.[permission])} onChange={() => patchGroup(selectedGroup.id, { mutedObjectPermissions: { ...selectedGroup.mutedObjectPermissions, [object.apiName]: { ...selectedGroup.mutedObjectPermissions[object.apiName], [permission]: !selectedGroup.mutedObjectPermissions[object.apiName]?.[permission] } } })} /></td>)}</tr>)}</tbody></table></div>
          </details>
          <details className="md-permission-collapsible md-permission-group-advanced"><summary>Muted Record Type Access</summary>
          {objects.filter((object) => object.recordTypes?.length).map((object) => <div className="permission-table-wrap" role="region" aria-label={`Record type permissions for ${object.label}`} tabIndex={0} key={object.apiName}><table className="slds-table permission-matrix"><thead><tr><th scope="col">{object.label}</th><th scope="col">Developer Name</th><th scope="col">Mute Access</th></tr></thead><tbody>{object.recordTypes?.filter((recordType) => recordType.active).map((recordType) => {
            const key = `${object.apiName}.${recordType.id}`;
            return <tr key={key}><td><strong>{recordType.label}</strong></td><td title={recordType.developerName}><code>{recordType.developerName}</code></td><td><input type="checkbox" aria-label={`Mute ${object.label} ${recordType.label}`} checked={Boolean(selectedGroup.mutedRecordTypePermissions[key])} onChange={() => patchGroup(selectedGroup.id, { mutedRecordTypePermissions: { ...selectedGroup.mutedRecordTypePermissions, [key]: !selectedGroup.mutedRecordTypePermissions[key] } })} /></td></tr>;
          })}</tbody></table></div>)}
          </details>
          <details className="md-permission-collapsible md-permission-group-advanced"><summary>Muted Field Permissions</summary>
          {objects.map((object) => <details className="permission-field-group" key={object.apiName}><summary>{object.label} ({object.fields.length} fields)</summary><div className="permission-table-wrap" role="region" aria-label="Record and field access settings" tabIndex={0}><table className="slds-table permission-matrix"><thead><tr><th scope="col">Field</th><th scope="col">API Name</th><th scope="col">Mute Create</th><th scope="col">Mute Read</th><th scope="col">Mute Edit</th><th scope="col">Mute Delete</th></tr></thead><tbody>{object.fields.map((field) => {
            const fieldName = `${object.apiName}.${field.apiName}`;
            const permissions = selectedGroup.mutedFieldPermissions[fieldName] ?? {};
            return <tr key={fieldName}><td><strong>{field.label}</strong></td><td title={field.apiName}><code>{field.apiName}</code></td>{(['create', 'read', 'edit', 'delete'] as const).map((permission) => <td key={permission}><input type="checkbox" aria-label={`Mute ${object.label}.${field.label} ${permission}`} checked={Boolean(permissions[permission])} onChange={() => patchGroup(selectedGroup.id, { mutedFieldPermissions: { ...selectedGroup.mutedFieldPermissions, [fieldName]: { ...permissions, [permission]: !permissions[permission] } } })} /></td>)}</tr>;
          })}</tbody></table></div></details>)}
          </details>
        </>}
        {tab === 'users' && <>
          <div className="section-toolbar"><div><h2>User Assignments</h2><p>Direct permission-set and permission-set-group memberships for this tenant.</p></div><button className="btn btn-brand" onClick={onOpenUserRecords}>Manage Users (CRUD)</button></div>
          {draft.users.filter(user=>viewportWidth>=1024||user.id===selectedId).map((user) => <details className="permission-user-card" key={user.id}><summary><strong>{user.name}</strong><span>{user.username}</span><span>{draft.roles.find((role) => role.id === user.roleId)?.name ?? user.role}</span></summary><PlatformPageSlot slotKey="field-rbac-29"><label className="form-label">Role<select className="form-control" value={user.roleId} onChange={(event) => patchUser(user.id, { roleId: event.target.value, role: draft.roles.find((role) => role.id === event.target.value)?.name ?? user.role })}><option value="">No role</option>{draft.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label></PlatformPageSlot><PlatformPageSlot slotKey="field-rbac-30"><label className="form-label">Profile<select className="form-control" value={user.profileId} onChange={(event) => patchUser(user.id, { profileId: event.target.value })}><option value="">No profile</option>{draft.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.license}</option>)}</select></label></PlatformPageSlot><PlatformPageSlot slotKey="field-rbac-31"><label className="form-label">Time Zone (IANA)<input className="form-control" value={user.timeZone} onChange={(event) => patchUser(user.id, { timeZone: event.target.value })} placeholder="America/Los_Angeles" /></label></PlatformPageSlot><PlatformPageSlot slotKey="field-rbac-32"><label className="form-label">Locale (BCP 47)<input className="form-control" value={user.locale} onChange={(event) => patchUser(user.id, { locale: event.target.value })} placeholder="en-US" /></label></PlatformPageSlot><PlatformPageSlot slotKey="field-rbac-33"><label className="form-label">Currency (ISO 4217)<input className="form-control" value={user.currencyIsoCode ?? ''} onChange={(event) => patchUser(user.id, { currencyIsoCode: event.target.value.toUpperCase() || undefined })} placeholder="USD" /></label></PlatformPageSlot><PlatformPageSlot slotKey="field-rbac-34"><label className="form-label">User Type
          <select className="form-control" value={user.userType ?? 'internal'}
            onChange={(event) => patchUser(user.id, {
              userType: event.target.value as 'internal' | 'external',
              externalAccountId: event.target.value === 'external' ? user.externalAccountId : undefined
            })}>
            <option value="internal">Internal</option><option value="external">External portal</option>
          </select></label></PlatformPageSlot>
          {user.userType === 'external' && <PlatformPageSlot slotKey="field-rbac-35"><label className="form-label">Verified tenant Account ID
            <input className="form-control" value={user.externalAccountId ?? ''}
              onChange={(event) => patchUser(user.id, { externalAccountId: event.target.value })}
              placeholder="Tenant account record ID" />
          </label></PlatformPageSlot>}<h3 className="permission-section-heading">Permission Sets</h3><div className="permission-check-grid">{draft.permissionSets.map((permissionSet) => <label className="checkbox-row" key={permissionSet.id}><input type="checkbox" checked={user.permissionSetIds.includes(permissionSet.id)} onChange={() => patchUser(user.id, { permissionSetIds: toggleString(user.permissionSetIds, permissionSet.id) })} />{permissionSet.label}</label>)}</div><h3 className="permission-section-heading">Permission Set Groups</h3><div className="permission-check-grid">{draft.permissionSetGroups.map((group) => <label className="checkbox-row" key={group.id}><input type="checkbox" checked={user.permissionSetGroupIds.includes(group.id)} onChange={() => patchUser(user.id, { permissionSetGroupIds: toggleString(user.permissionSetGroupIds, group.id) })} />{group.label}</label>)}</div></details>)}
        </>}
        {tab === 'profiles' && !selectedProfile && <div className="empty-state">Select a profile or create one to get started.</div>}
        {tab === 'sets' && !selectedSet && <div className="empty-state">Select a permission set or create one to get started.</div>}
        {tab === 'groups' && !selectedGroup && visibleGroups.length>0 && <div className="empty-state">Select a permission set group to edit it.</div>}
        {(tab === 'sharing' || tab==='users'||tab==='roles'||tab==='profiles'||tab==='groups'||tab==='publicGroups'||tab==='queues'||tab==='sharingRules'||(tab==='sets'&&!!selectedSet)) && <div className="md-permission-mobile-save"><span className="md-permission-save-state">{!permissionDirty?'No unsaved changes':'Unsaved permission changes'}</span><button type="button" className="btn btn-brand" onClick={()=>void saveDraft()} disabled={saving || !permissionDirty || Boolean(accessControlError)}><Save size={14}/>{saving?'Saving…':'Save Changes'}</button></div>}
      </div></PlatformPageSlot>
    </section>
    <PlatformPageSlot slotKey="rbac-help"><div className="permission-info"><ShieldCheck size={17} /><span>Tenant-scoped grants are evaluated by the API. Permission-set groups combine their member grants and can mute group-contributed system and object permissions; direct assignments are unaffected by group muting.</span></div></PlatformPageSlot>
  </div></PlatformPageSlot>;
}


return Permissions;
}
