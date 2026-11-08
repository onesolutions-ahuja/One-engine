import {suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import { useFormFactor } from '../../workspace/Responsive/useFormFactor';
import {confirmDestructiveAction} from '../../components/ConfirmAction/confirmDestructiveAction';
import '../SharedBuilderFrame/adaptiveBuilder.css';
import { uniqueLibraryComponents, libraryComponentLabel } from '../../components/Registry/componentLibraryDiscovery';
import type { RecordData, Aggregation, ComponentType, ActiveCrossFilter } from './dashboardEditorHelpers';
import { defaultComponentTitles, relationshipPaths, downloadCsv, dashboardFilterValueType, dashboardFilterOperatorsFor, dashboardFilterInputType, dashboardFilterInputValue, dashboardFilterStoredValue, chartPalette, chartPaletteFor, dashboardWidthSpans, dashboardHeightSpans, dashboardWidthForSpan, dashboardHeightForSpan, apiNameFor, newDashboard, newComponent, formatValue, formatChartValue, chartAxisRange, chartAxisTicks, aggregate, aggregateReportSummary } from './dashboardEditorHelpers';
import {findRegisteredComponent} from '../../components/Registry/componentRegistryLookup';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Copy, Download, Eye, FileText, GripVertical, Image as ImageIcon, LayoutDashboard, Plus, Printer, Puzzle, RefreshCw, Save, Trash2, X } from 'lucide-react';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import CustomComponentPropertyEditor from '../ComponentProperties/CustomComponentPropertyEditor';
import SmartFieldInput from '../../../component-libraries/shared/primitives/SmartFieldInput/SmartFieldInput';
import { resolveMentionValue, resolveMentionProperties } from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';
import { dashboardMentionContext, htmlSafeMentionContext } from './dashboardMentionContext';
import PageComponentStyleEditor from '../ComponentStyleEditor/PageComponentStyleEditor';
import { componentLayoutProps, resolveLayoutStyle, type LayoutDevice } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import { sourceReportTitleUpdate } from './dashboardComponentTitle';
import { dashboardFilterValue, dashboardFiltersForObject, matchesDashboardFilter, matchesDashboardFilters, toggleDashboardCrossFilter } from '../../pages/EmbeddedDashboard/dashboardFilters';
import type { DashboardComponentMetadata, DashboardFolderInput, DashboardFolderMetadata, DashboardFolderShareMetadata, DashboardTerritoryMetadata, DashboardFilterMetadata, DashboardMetadata, DashboardSnapshot, DashboardSubscription, DashboardSubscriptionInput, AccessControlMetadata, LibraryComponentMetadata, NamedCredentialMetadata, ObjectMetadata, ReportMetadata, ReportRunMetadata } from '../../metadata/Definitions/metadata';
type DashboardBuilderProps = {
  dashboards: DashboardMetadata[];
  dashboardFolders: DashboardFolderMetadata[];
  objects: ObjectMetadata[];
  libraryComponents: LibraryComponentMetadata[];
  reports: ReportMetadata[];
  shareUsers: AccessControlMetadata['users'];
  shareGroups: AccessControlMetadata['permissionSetGroups'];
  folderPublicGroups: AccessControlMetadata['publicGroups'];
  folderPermissionSetGroups: AccessControlMetadata['permissionSetGroups'];
  folderRoles: AccessControlMetadata['roles'];
  dashboardTerritories: DashboardTerritoryMetadata[];
  canManageTerritories: boolean;
  subscriptionUsers: AccessControlMetadata['users'];
  runningUserIds: string[];
  smtpCredentials: NamedCredentialMetadata[];
  canSchedule: boolean;
  userId: string;
  canCreate: boolean;
  canManageAll: boolean;
  viewerMode?: boolean;
  selectedApiName?: string;
  onSelect: (apiName: string) => void;
  onOpenViewer: (apiName: string) => void;
  onExitViewer: (apiName: string) => void;
  onLoadRecords: (dashboardApiName: string, objectApiName: string, runningUserId?: string) => Promise<RecordData[]>;
  onRunReport: (apiName: string, filters?: DashboardFilterMetadata[], offset?: number, limit?: number, filterLogic?: DashboardMetadata['filterLogic'], crossFilters?: DashboardFilterMetadata[], dashboardApiName?: string, reportFilterOverrides?: Array<{ id: string; value: string; values: string[] }>, dashboardRunningUserId?: string) => Promise<ReportRunMetadata>;
  onLoadSnapshots: (apiName: string) => Promise<DashboardSnapshot[]>;
  onCreateSnapshot: (apiName: string, label: string, filters: DashboardFilterMetadata[], crossFilters?: DashboardFilterMetadata[], customComponents?: Array<{ componentId: string; html: string }>, runningUserId?: string) => Promise<DashboardSnapshot>;
  onDeleteSnapshot: (apiName: string, snapshotId: string) => Promise<void>;
  onLoadSubscriptions: (apiName: string) => Promise<DashboardSubscription[]>;
  onSaveSubscription: (apiName: string, input: DashboardSubscriptionInput, subscriptionId?: string) => Promise<DashboardSubscription>;
  onDeleteSubscription: (apiName: string, subscriptionId: string) => Promise<void>;
  onRunSubscription: (apiName: string, subscriptionId: string) => Promise<DashboardSubscription>;
  onSave: (dashboard: DashboardMetadata) => Promise<DashboardMetadata>;
  onDelete: (apiName: string) => Promise<void>;
  onSaveFolder: (input: DashboardFolderInput, folderId?: string) => Promise<DashboardFolderMetadata>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onSaveTerritories: (territories: Array<Pick<DashboardTerritoryMetadata, 'id' | 'label' | 'parentTerritoryId' | 'userIds'>>) => Promise<DashboardTerritoryMetadata[]>;
  onNotify: (message: string) => void;
};
export default function DashboardBuilder({
  dashboards, dashboardFolders, objects, libraryComponents, reports, shareUsers, shareGroups, folderPublicGroups, folderPermissionSetGroups, folderRoles, dashboardTerritories, canManageTerritories, subscriptionUsers, runningUserIds, smtpCredentials, canSchedule, userId, canCreate, canManageAll, viewerMode = false, selectedApiName, onSelect, onOpenViewer, onExitViewer, onLoadRecords, onRunReport, onLoadSnapshots, onCreateSnapshot, onDeleteSnapshot, onLoadSubscriptions, onSaveSubscription, onDeleteSubscription, onRunSubscription, onSave, onDelete, onSaveFolder, onDeleteFolder, onSaveTerritories, onNotify
}: DashboardBuilderProps) {
  const [draft, setDraft] = useState<DashboardMetadata | null>(null);
  const layoutDevice: LayoutDevice = useFormFactor();
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [selectedComponentId, setSelectedComponentId] = useState('');
  const [tabletPanel,setTabletPanel]=useState<'library'|'inspector'|null>(null);
  useEffect(()=>{if(selectedComponentId)setTabletPanel('inspector');},[selectedComponentId]);
  const [previewMode, setPreviewMode] = useState(viewerMode);
  const [selectedRunningUserId, setSelectedRunningUserId] = useState(userId);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recordsByObject, setRecordsByObject] = useState<Record<string, RecordData[]>>({});
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [reportRuns, setReportRuns] = useState<Record<string, ReportRunMetadata>>({});
  const [exportingComponentId, setExportingComponentId] = useState('');
  const [reportRunError, setReportRunError] = useState('');
  const [reportsLoading, setReportsLoading] = useState(false);
  const [tablePageOffsets, setTablePageOffsets] = useState<Record<string, number>>({});
  const [tablePageRows, setTablePageRows] = useState<Record<string, RecordData[]>>({});
  const [loadingTablePageId, setLoadingTablePageId] = useState('');
  const tablePageRequestGeneration = useRef(0);
  const dashboardResizeStart = useRef<{ componentId: string; pointerX: number; pointerY: number; widthSpan: number; heightSpan: number; gridWidth: number } | null>(null);
  const richTextEditorRef = useRef<HTMLTextAreaElement>(null);
  const [viewFilterValues, setViewFilterValues] = useState<Record<string, string>>({});
  const [crossFilters, setCrossFilters] = useState<ActiveCrossFilter[]>([]);
  const [draggedComponentId, setDraggedComponentId] = useState('');
  const [folderFilter, setFolderFilter] = useState('All Folders');
  const [newFolderLabel, setNewFolderLabel] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState('');
  const [folderShareType, setFolderShareType] = useState<DashboardFolderShareMetadata['targetType']>('User');
  const [folderShareTargetId, setFolderShareTargetId] = useState('');
  const [folderShareAccess, setFolderShareAccess] = useState<DashboardFolderShareMetadata['accessLevel']>('Viewer');
  const [folderEditLabel, setFolderEditLabel] = useState('');
  const [folderEditParentId, setFolderEditParentId] = useState('');
  const [managedFolderId, setManagedFolderId] = useState('');
  const [territoryEditId, setTerritoryEditId] = useState('');
  const [territoryLabel, setTerritoryLabel] = useState('');
  const [territoryParentId, setTerritoryParentId] = useState('');
  const [territoryUserIds, setTerritoryUserIds] = useState<string[]>([]);
  const [territoryBusy, setTerritoryBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<DashboardSnapshot[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [snapshotError, setSnapshotError] = useState('');
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [activeSnapshotId, setActiveSnapshotId] = useState('');
  const [subscriptions, setSubscriptions] = useState<DashboardSubscription[]>([]);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [subscriptionDraft, setSubscriptionDraft] = useState<DashboardSubscriptionInput | null>(null);
  const [editingSubscriptionId, setEditingSubscriptionId] = useState('');
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState('');
  const current = draft ?? dashboards.find((dashboard) => dashboard.apiName === selectedApiName)
    ?? (viewerMode ? null : dashboards[0] ?? null);
  const dashboardRunningUserId = current?.allowViewerToSelectRunningUser
    && selectedRunningUserId !== userId ? selectedRunningUserId : undefined;
  useEffect(() => {
    setSelectedRunningUserId(current?.runningUserId ?? userId);
  }, [current?.apiName, current?.runningUserId, userId]);
  useEffect(() => {
    setViewFilterValues({});
    setCrossFilters([]);
  }, [current?.apiName]);
  const selected = current?.components.find((component) => component.id === selectedComponentId);
  const folderPath = (folderId: string | null | undefined): string => {
    if (!folderId) return '';
    const labels: string[] = [];
    const visited = new Set<string>();
    let folder = dashboardFolders.find((item) => item.id === folderId);
    while (folder && !visited.has(folder.id)) {
      visited.add(folder.id);
      labels.unshift(folder.label);
      folder = folder.parentFolderId
        ? dashboardFolders.find((item) => item.id === folder!.parentFolderId)
        : undefined;
    }
    return labels.join('/');
  };
  const folderChoices = dashboardFolders.map((folder) => ({ folder, path: folderPath(folder.id) }));
  const dashboardFolderDisplay = (dashboard: DashboardMetadata) =>
    folderPath(dashboard.folderId) || dashboard.folderName || 'Private Reports';
  const dashboardFolderPaths = [...new Set(dashboards.map(dashboardFolderDisplay))].sort();
  const currentFolder = dashboardFolders.find((folder) => folder.id === managedFolderId);
  const newFolderParent = dashboardFolders.find((folder) => folder.id === newFolderParentId);
  const canCreateInSelectedFolder = canCreate || Boolean(newFolderParent
    && (canManageAll || newFolderParent.ownerUserId === userId || newFolderParent.accessLevel === 'Manager'));
  const folderParentChoices = folderChoices.filter(({ folder, path }) => {
    if (!currentFolder) return true;
    const currentPath = folderPath(currentFolder.id);
    return (canManageAll || folder.ownerUserId === userId || folder.accessLevel === 'Manager')
      && folder.id !== currentFolder.id && !path.startsWith(`${currentPath}/`);
  });
  const folderShareOptions = folderShareType === 'User'
    ? subscriptionUsers.map((user) => ({ id: user.id, label: `${user.name} (${user.username})` }))
    : folderShareType === 'PublicGroup'
      ? folderPublicGroups.map((group) => ({ id: group.id, label: group.label }))
      : folderShareType === 'PermissionSetGroup'
        ? folderPermissionSetGroups.map((group) => ({ id: group.id, label: group.label }))
        : folderShareType === 'Territory'
          ? dashboardTerritories.map((territory) => ({ id: territory.id, label: territory.label }))
          : folderRoles.map((role) => ({ id: role.id, label: role.name }));
  useEffect(() => {
    setManagedFolderId(current?.folderId ?? '');
  }, [current?.apiName, current?.folderId]);
  useEffect(() => {
    setFolderEditLabel(currentFolder?.label ?? '');
    setFolderEditParentId(currentFolder?.parentFolderId ?? '');
  }, [managedFolderId, currentFolder?.label, currentFolder?.parentFolderId]);
  const objectFor = (apiName: string) => objects.find((object) => object.apiName === apiName);
  const fieldsForComponent = (component: DashboardComponentMetadata) => {
    const fields = objectFor(component.objectApiName)?.fields ?? [];
    const report = reports.find((item) => item.apiName === component.reportApiName);
    if (!report) return fields;
    const reportFields = new Set([...report.fieldApiNames, ...report.groupByFieldApiNames, ...(report.columnGroupByFieldApiName ? [report.columnGroupByFieldApiName] : [])]);
    return fields.filter((field) => reportFields.has(field.apiName));
  };
  const groupFieldsForComponent = (component: DashboardComponentMetadata) => {
    const report = reports.find((item) => item.apiName === component.reportApiName);
    return report
      ? (objectFor(component.objectApiName)?.fields ?? []).filter((field) => report.groupByFieldApiNames.includes(field.apiName))
      : objectFor(component.objectApiName)?.fields ?? [];
  };
  const defaultObject = objects.find((object) => object.apiName !== 'User' && object.settings?.allowReports) ?? objects[0];
  const dashboardIsSaved = Boolean(current && dashboards.some((dashboard) => dashboard.apiName === current.apiName));
  const canEditCurrent = Boolean(!viewerMode && current && (dashboardIsSaved
    ? canManageAll || current.ownerUserId === userId || current.folderAccessLevel === 'Editor'
      || current.folderAccessLevel === 'Manager'
    : canCreate));
  const canManageCurrentFolder = Boolean(currentFolder && (canManageAll || currentFolder.ownerUserId === userId
    || currentFolder.accessLevel === 'Manager'));
  const createFolderParents = folderChoices.filter(({ folder }) =>
    canManageAll || folder.ownerUserId === userId || folder.accessLevel === 'Manager');
  const dirty = Boolean(current && dashboardIsSaved
    && JSON.stringify(current) !== JSON.stringify(dashboards.find((item) => item.apiName === current.apiName)));
  const numericFields = (object: ObjectMetadata | undefined) => object?.fields.filter((field) =>
    field.formula
      ? /^(Number|Currency|Percent)$/.test(field.formula.returnType)
      : /^(Number|Currency|Percent)(\(|$)/.test(field.dataType)) ?? [];
  useEffect(() => {
    if (!selectedApiName) {
      if (!draft) setDraft(dashboards[0] ?? null);
      return;
    }
    const selectedDashboard = dashboards.find((dashboard) => dashboard.apiName === selectedApiName);
    if (selectedDashboard) {
      setDraft(selectedDashboard);
      setSelectedComponentId('');
      setPreviewMode(viewerMode);
      setCrossFilters([]);
    }
  }, [selectedApiName, dashboards, viewerMode]);
  useEffect(() => {
    setViewFilterValues(Object.fromEntries((current?.filters ?? []).map((filter) => [filter.id, filter.value])));
  }, [current?.apiName, current?.filters]);
  useEffect(() => {
    let active = true;
    setActiveSnapshotId('');
    setSnapshotError('');
    setSnapshots([]);
    if (typeof onLoadSnapshots !== 'function' || !current || current.status !== 'Deployed' || !dashboardIsSaved) {
      return () => { active = false; };
    }
    void onLoadSnapshots(current.apiName).then((items) => {
      if (active) setSnapshots(items);
    }).catch((error: unknown) => {
      if (active) setSnapshotError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [current?.apiName, current?.status, dashboardIsSaved, refreshKey, onLoadSnapshots]);

  useEffect(() => {
    let active = true;
    setSubscriptions([]);
    setSubscriptionError('');
    if (typeof onLoadSubscriptions !== 'function' || !current || current.status !== 'Deployed' || !dashboardIsSaved) {
      return () => { active = false; };
    }
    void onLoadSubscriptions(current.apiName).then((items) => {
      if (active) setSubscriptions(items);
    }).catch((error: unknown) => {
      if (active) setSubscriptionError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [current?.apiName, current?.status, dashboardIsSaved, refreshKey, onLoadSubscriptions]);

  const startSubscriptionEdit = (subscription?: DashboardSubscription) => {
    const localTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    setEditingSubscriptionId(subscription?.id ?? '');
    setSubscriptionDraft(subscription ? {
      label: subscription.label,
      frequency: subscription.frequency,
      localTime: subscription.localTime,
      timeZone: subscription.timeZone,
      dayOfWeek: subscription.dayOfWeek,
      recipientUserIds: [...subscription.recipientUserIds],
      namedCredentialId: subscription.namedCredentialId,
      fromEmail: subscription.fromEmail,
      active: subscription.active,
      saveSnapshots: subscription.saveSnapshots
    } : {
      label: `${current?.label ?? 'Dashboard'} subscription`.slice(0, 80),
      frequency: 'Daily',
      localTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      dayOfWeek: null,
      recipientUserIds: userId ? [userId] : [],
      namedCredentialId: smtpCredentials[0]?.id ?? '',
      fromEmail: subscriptionUsers.find((user) => user.id === userId)?.username ?? '',
      active: true,
      saveSnapshots: true
    });
    setSubscriptionError('');
  };

  const saveSubscription = async () => {
    if (!current || !subscriptionDraft || subscriptionBusy) return;
    setSubscriptionBusy(true);
    setSubscriptionError('');
    try {
      const saved = await onSaveSubscription(current.apiName, subscriptionDraft, editingSubscriptionId || undefined);
      setSubscriptions((items) => editingSubscriptionId
        ? items.map((item) => item.id === saved.id ? saved : item)
        : [...items, saved]);
      setSubscriptionDraft(null);
      setEditingSubscriptionId('');
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const removeSubscription = async (subscription: DashboardSubscription) => {
    if (!current || subscriptionBusy || !confirmDestructiveAction('Delete', 'Dashboard subscription "'+subscription.label+'"', 'Scheduled deliveries for this subscription will stop.')) return;
    setSubscriptionBusy(true);
    setSubscriptionError('');
    try {
      await onDeleteSubscription(current.apiName, subscription.id);
      setSubscriptions((items) => items.filter((item) => item.id !== subscription.id));
      if (editingSubscriptionId === subscription.id) {
        setEditingSubscriptionId('');
        setSubscriptionDraft(null);
      }
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const runSubscription = async (subscription: DashboardSubscription) => {
    if (!current || subscriptionBusy) return;
    setSubscriptionBusy(true);
    setSubscriptionError('');
    try {
      const updated = await onRunSubscription(current.apiName, subscription.id);
      setSubscriptions((items) => items.map((item) => item.id === updated.id ? updated : item));
      const savedSnapshots = await onLoadSnapshots(current.apiName);
      setSnapshots(savedSnapshots);
      const latestSnapshot = savedSnapshots.find((snapshot) => snapshot.subscriptionId === updated.id);
      if (latestSnapshot) setActiveSnapshotId(latestSnapshot.id);
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : String(error));
      try {
        const items = await onLoadSubscriptions(current.apiName);
        setSubscriptions(items);
      } catch {
        // Preserve the delivery error; the next explicit refresh will retry loading state.
      }
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const createSnapshot = async () => {
    if (!current || dirty || !snapshotLabel.trim() || snapshotBusy) return;
    setSnapshotBusy(true);
    setSnapshotError('');
    try {
      const filters = current.filters.map((filter) => ({
        ...filter,
        value: dashboardFilterValue(filter, previewMode ? viewFilterValues : undefined)
      }));
      const selectedCrossFilters = previewMode
        ? crossFilters.map(({ componentId: _componentId, ...filter }) => filter)
        : [];
      const customComponents = current.components.filter((component) => component.type === 'Custom').map((component) => {
        const element = [...document.querySelectorAll<HTMLElement>('[data-dashboard-custom-component-id]')]
          .find((candidate) => candidate.dataset.dashboardCustomComponentId === component.id);
        if (!element) throw new Error(`Could not capture custom component "${component.title}". Return to the live dashboard and try again.`);
        if (element.innerHTML.length > 50_000) throw new Error(`Custom component "${component.title}" is too large to snapshot (50 KB maximum).`);
        return { componentId: component.id, html: element.innerHTML };
      });
      const created = await onCreateSnapshot(current.apiName, snapshotLabel.trim(), filters, selectedCrossFilters, customComponents, dashboardRunningUserId);
      setSnapshots((items) => [created, ...items]);
      setActiveSnapshotId(created.id);
      setSnapshotLabel('');
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : String(error));
    } finally {
      setSnapshotBusy(false);
    }
  };

  const removeSnapshot = async (snapshot: DashboardSnapshot) => {
    if (!current || snapshotBusy || !confirmDestructiveAction('Delete', 'Dashboard snapshot "'+snapshot.label+'"')) return;
    setSnapshotBusy(true);
    setSnapshotError('');
    try {
      await onDeleteSnapshot(current.apiName, snapshot.id);
      setSnapshots((items) => items.filter((item) => item.id !== snapshot.id));
      if (activeSnapshotId === snapshot.id) setActiveSnapshotId('');
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : String(error));
    } finally {
      setSnapshotBusy(false);
    }
  };
  const activeSnapshot = snapshots.find((snapshot) => snapshot.id === activeSnapshotId);

  useEffect(() => {
    const minutes = current?.refreshIntervalMinutes ?? 0;
    if (!previewMode || current?.status !== 'Deployed' || minutes <= 0) return;
    const interval = window.setInterval(() => setRefreshKey((key) => key + 1), minutes * 60_000);
    return () => window.clearInterval(interval);
  }, [previewMode, current?.apiName, current?.status, current?.refreshIntervalMinutes]);

  const objectNames = useMemo(() => {
    const components = current?.components ?? [];
    const names = new Set(components.map((component) => component.objectApiName));
    for (const source of components) {
      for (const target of components) {
        for (const path of relationshipPaths(objects, source.objectApiName, target.objectApiName)) {
          path.forEach((step) => {
            if (step.sourceObjectApiName !== 'User') names.add(step.sourceObjectApiName);
            if (step.targetObjectApiName !== 'User') names.add(step.targetObjectApiName);
          });
        }
      }
    }
    return [...names];
  }, [current, objects]);
  const reportNames = useMemo(() => [...new Set((current?.components ?? [])
    .map((component) => component.reportApiName)
    .filter((apiName): apiName is string => Boolean(apiName)))], [current]);
  const isCurrentSaved = Boolean(current && dashboards.some((dashboard) => dashboard.apiName === current.apiName));
  useEffect(() => {
    let active = true;
    if (!isCurrentSaved || !objectNames.length) {
      setRecordsByObject({});
      setRecordsError('');
      setRecordsLoading(false);
      return () => { active = false; };
    }
    setRecordsLoading(true);
    setRecordsError('');
    void Promise.all(objectNames.map(async (objectName) =>
      [objectName, await onLoadRecords(current?.apiName ?? '', objectName, dashboardRunningUserId)] as const
    )).then((entries) => {
      if (active) setRecordsByObject(Object.fromEntries(entries));
    }).catch((error: unknown) => {
      if (active) {
        setRecordsError(error instanceof Error ? error.message : String(error));
        setRecordsByObject({});
      }
    }).finally(() => {
      if (active) setRecordsLoading(false);
    });
    return () => { active = false; };
  }, [objectNames.join('|'), current?.apiName, isCurrentSaved, dashboardRunningUserId, refreshKey, onLoadRecords]);

  useEffect(() => {
    let active = true;
    tablePageRequestGeneration.current += 1;
    setTablePageOffsets({});
    setTablePageRows({});
    setLoadingTablePageId('');
    if (!isCurrentSaved || !reportNames.length) {
      setReportRuns({});
      setReportRunError('');
      setReportsLoading(false);
      return () => { active = false; };
    }
    setReportsLoading(true);
    setReportRunError('');
    void Promise.all(reportNames.map(async (apiName) => {
      const report = reports.find((item) => item.apiName === apiName);
      const selectedCrossFilters = crossFilters;
      const filters = dashboardFiltersForObject(
        current?.filters ?? [],
        report?.objectApiName,
        previewMode ? viewFilterValues : undefined
      );
      const activeCrossFilters = previewMode
        ? selectedCrossFilters.map(({ componentId: _componentId, ...filter }) => filter)
        : [];
      return [apiName, await onRunReport(apiName, filters, 0, 5000, current?.filterLogic ?? 'All', activeCrossFilters, current?.apiName, undefined, dashboardRunningUserId)] as const;
    }))
      .then((entries) => {
        if (active) setReportRuns(Object.fromEntries(entries));
      })
      .catch((error: unknown) => {
        if (active) {
          setReportRunError(error instanceof Error ? error.message : String(error));
          setReportRuns({});
        }
      })
      .finally(() => {
        if (active) setReportsLoading(false);
      });
    return () => { active = false; };
  }, [reportNames.join('|'), refreshKey, onRunReport, reports, current?.apiName, isCurrentSaved, current?.filters, current?.filterLogic, dashboardRunningUserId, previewMode, viewFilterValues, crossFilters]);

  const changeTablePage = async (component: DashboardComponentMetadata, offset: number) => {
    const reportApiName = component.reportApiName;
    if (!reportApiName || offset < 0 || loadingTablePageId) return;
    const report = reports.find((item) => item.apiName === reportApiName);
    const filters = dashboardFiltersForObject(
      current?.filters ?? [],
      report?.objectApiName,
      previewMode ? viewFilterValues : undefined
    );
    const activeCrossFilters = previewMode
      ? crossFilters.map(({ componentId: _componentId, ...filter }) => filter)
      : [];
    const requestGeneration = tablePageRequestGeneration.current;
    setLoadingTablePageId(component.id);
    try {
      const result = await onRunReport(
        reportApiName,
        filters,
        offset,
        10,
        current?.filterLogic ?? 'All',
        activeCrossFilters,
        current?.apiName,
        undefined,
        dashboardRunningUserId
      );
      if (requestGeneration === tablePageRequestGeneration.current) {
        setTablePageRows((pages) => ({ ...pages, [component.id]: result.rows }));
        setTablePageOffsets((pages) => ({ ...pages, [component.id]: result.offset }));
      }
    } catch (error) {
      if (requestGeneration === tablePageRequestGeneration.current) {
        onNotify(error instanceof Error ? error.message : 'Unable to load dashboard table page');
      }
    } finally {
      if (requestGeneration === tablePageRequestGeneration.current) setLoadingTablePageId('');
    }
  };

  const changeDraft = (update: (dashboard: DashboardMetadata) => DashboardMetadata) => {
    setDraft((value) => value ? update(value) : value);
  };
  const updateComponent = (id: string, update: Partial<DashboardComponentMetadata>) => {
    changeDraft((dashboard) => ({
      ...dashboard,
      components: dashboard.components.map((component) => component.id === id ? { ...component, ...update } : component)
    }));
  };
  const wrapRichTextSelection = (openTag: string, closeTag: string) => {
    const editor = richTextEditorRef.current;
    if (!editor || !selected) return;
    const content = selected.richTextContent ?? '';
    const selectionStart = editor.selectionStart;
    const selectionEnd = editor.selectionEnd;
    const selectedText = content.slice(selectionStart, selectionEnd) || 'Text';
    const nextContent = `${content.slice(0, selectionStart)}${openTag}${selectedText}${closeTag}${content.slice(selectionEnd)}`;
    updateComponent(selected.id, { richTextContent: nextContent });
    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(selectionStart + openTag.length, selectionStart + openTag.length + selectedText.length);
    });
  };
  const addComponent = (type: ComponentType) => {
    if (!current || !defaultObject) return;
    const initialField = defaultObject.fields.find((field) => field.apiName === 'Name')?.apiName
      ?? defaultObject.fields[0]?.apiName ?? '';
    const component = newComponent(type, defaultObject.apiName, initialField);
    if ((type === 'Metric' || type === 'Chart') && numericFields(defaultObject)[0]) {
      component.aggregation = 'Sum';
      component.measureFieldApiName = numericFields(defaultObject)[0].apiName;
    }
    changeDraft((dashboard) => ({ ...dashboard, components: [...dashboard.components, component] }));
    setSelectedComponentId(component.id);
    setPreviewMode(false);
  };
  const addCustomComponent = (definition: LibraryComponentMetadata) => {
    if (!current || !defaultObject) return;
    const firstField = defaultObject.fields.find((field) => field.apiName === 'Name')?.apiName
      ?? defaultObject.fields[0]?.apiName ?? '';
    const component: DashboardComponentMetadata = {
      ...newComponent('Custom', defaultObject.apiName, firstField),
      title: definition.label,
      customComponentApiName: definition.apiName,
      properties: {}
    };
    changeDraft((dashboard) => ({ ...dashboard, components: [...dashboard.components, component] }));
    setSelectedComponentId(component.id);
    setPreviewMode(false);
  };
  const addFilter = () => {
    if (!current || !defaultObject) return;
    const fieldApiName = defaultObject.fields[0]?.apiName;
    if (!fieldApiName) return;
    const filter: DashboardFilterMetadata = {
      id: crypto.randomUUID(),
      objectApiName: defaultObject.apiName,
      fieldApiName,
      operator: 'Equals',
      value: ''
    };
    changeDraft((dashboard) => ({ ...dashboard, filters: [...dashboard.filters, filter] }));
  };
  const updateFilter = (id: string, update: Partial<DashboardFilterMetadata>) => {
    changeDraft((dashboard) => ({
      ...dashboard,
      filters: dashboard.filters.map((filter) => filter.id === id ? { ...filter, ...update } : filter)
    }));
  };
  const moveComponent = (id: string, direction: -1 | 1) => {
    changeDraft((dashboard) => {
      const index = dashboard.components.findIndex((component) => component.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= dashboard.components.length) return dashboard;
      const components = [...dashboard.components];
      [components[index], components[nextIndex]] = [components[nextIndex], components[index]];
      return { ...dashboard, components };
    });
  };
  const moveComponentBefore = (sourceId: string, targetId: string) => {
    changeDraft((dashboard) => {
      const sourceIndex = dashboard.components.findIndex((component) => component.id === sourceId);
      const targetIndex = dashboard.components.findIndex((component) => component.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return dashboard;
      const components = [...dashboard.components];
      const [component] = components.splice(sourceIndex, 1);
      components.splice(targetIndex - (sourceIndex < targetIndex ? 1 : 0), 0, component);
      return { ...dashboard, components };
    });
  };
  const startDashboardResize = (event: React.PointerEvent<HTMLButtonElement>, component: DashboardComponentMetadata) => {
    if (!canEditCurrent) return;
    const grid = event.currentTarget.closest<HTMLElement>('.dashboard-preview-grid');
    if (!grid) return;
    const width = component.width ?? (component.type === 'Table' ? 'Full' : 'Half');
    const height = component.height ?? 'Medium';
    dashboardResizeStart.current = {
      componentId: component.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      widthSpan: dashboardWidthSpans[width],
      heightSpan: dashboardHeightSpans[height],
      gridWidth: grid.getBoundingClientRect().width
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const updateDashboardResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = dashboardResizeStart.current;
    if (!start) return;
    const widthSpan = Math.max(3, Math.min(12, Math.round((start.widthSpan + (event.clientX - start.pointerX) / start.gridWidth * 12) / 3) * 3));
    const heightSpan = Math.max(1, Math.min(3, Math.round(start.heightSpan + (event.clientY - start.pointerY) / 180)));
    updateComponent(start.componentId, {
      width: dashboardWidthForSpan(widthSpan),
      height: dashboardHeightForSpan(heightSpan)
    });
  };
  const resizeDashboardWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, component: DashboardComponentMetadata) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const width = component.width ?? (component.type === 'Table' ? 'Full' : 'Half');
    const height = component.height ?? 'Medium';
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const next = dashboardWidthSpans[width] + (event.key === 'ArrowRight' ? 3 : -3);
      updateComponent(component.id, { width: dashboardWidthForSpan(Math.max(3, Math.min(12, next))) });
    } else {
      const next = dashboardHeightSpans[height] + (event.key === 'ArrowDown' ? 1 : -1);
      updateComponent(component.id, { height: dashboardHeightForSpan(Math.max(1, Math.min(3, next))) });
    }
  };
  const saveDashboard = async (next: DashboardMetadata) => {
    if (!canEditCurrent) {
      onNotify('You do not have permission to change this dashboard');
      return;
    }
    setBusy(true);
    try {
      const saved = await onSave(next);
      setDraft(saved);
      setCreating(false);
      onSelect(saved.apiName);
      onNotify('Dashboard saved');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to save dashboard');
    } finally {
      setBusy(false);
    }
  };
  const createFolder = async () => {
    const label = newFolderLabel.trim();
    if (!label) return;
    try {
      const folder = await onSaveFolder({
        label,
        parentFolderId: newFolderParentId || null,
        shares: []
      });
      setNewFolderLabel('');
      setNewFolderParentId('');
      onNotify(`Created dashboard folder "${folderPath(folder.id) || folder.label}"`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to create dashboard folder');
    }
  };
  const saveCurrentFolder = async (
    nextShares = currentFolder?.shares ?? [],
    label = folderEditLabel,
    parentFolderId = folderEditParentId
  ) => {
    if (!currentFolder || !canManageCurrentFolder) return;
    try {
      await onSaveFolder({
        label: label.trim(),
        parentFolderId: parentFolderId || null,
        shares: nextShares
      }, currentFolder.id);
      onNotify('Dashboard folder saved');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to save dashboard folder');
    }
  };
  const saveFolderShares = async (nextShares: DashboardFolderShareMetadata[]) => {
    await saveCurrentFolder(nextShares);
  };
  const addFolderShare = () => {
    if (!currentFolder || !folderShareTargetId) return;
    const share = { targetType: folderShareType, targetId: folderShareTargetId, accessLevel: folderShareAccess };
    if (currentFolder.shares.some((item) => item.targetType === share.targetType && item.targetId === share.targetId)) {
      onNotify('This user, group, or role already has folder access');
      return;
    }
    void saveFolderShares([...currentFolder.shares, share]);
  };
  const saveTerritory = async (remove = false) => {
    if (remove && !confirmDestructiveAction('Delete','Dashboard territory "'+territoryLabel+'"', 'Territory-based dashboard assignments may change.')) return;
    const id = territoryEditId || crypto.randomUUID();
    const next = dashboardTerritories
      .filter((territory) => !remove || territory.id !== id)
      .map((territory) => territory.id === id
        ? { id, label: territoryLabel.trim(), parentTerritoryId: territoryParentId || null, userIds: territoryUserIds }
        : { id: territory.id, label: territory.label, parentTerritoryId: territory.parentTerritoryId, userIds: territory.userIds });
    if (!remove && !dashboardTerritories.some((territory) => territory.id === id)) {
      next.push({ id, label: territoryLabel.trim(), parentTerritoryId: territoryParentId || null, userIds: territoryUserIds });
    }
    setTerritoryBusy(true);
    try {
      await onSaveTerritories(next);
      setTerritoryEditId('');
      setTerritoryLabel('');
      setTerritoryParentId('');
      setTerritoryUserIds([]);
      onNotify(remove ? 'Territory deleted' : 'Territory saved');
    } catch (failure) {
      onNotify(`Unable to save territory: ${failure instanceof Error ? failure.message : String(failure)}`);
    } finally {
      setTerritoryBusy(false);
    }
  };
  const deleteCurrentFolder = async () => {
    if (!currentFolder || !canManageCurrentFolder
      || !window.confirm(`Delete the "${currentFolder.label}" folder?`)) return;
    try {
      await onDeleteFolder(currentFolder.id);
      if (managedFolderId === currentFolder.id) setManagedFolderId('');
      onNotify('Dashboard folder deleted');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to delete dashboard folder');
    }
  };
  const createDashboard = () => {
    if (!canCreate) return;
    const label = newLabel.trim();
    if (!label) return;
    const baseName=apiNameFor(label);
    const apiName=suggestMetadataApiName(baseName,dashboards.map(item=>item.apiName));
    if(!apiName){onNotify('Enter a valid dashboard name');return;}
    if(apiName!==baseName)onNotify('Duplicate API Name. Using '+apiName);
    const created = { ...newDashboard(label), apiName, ownerUserId: userId };
    setDraft(created);
    setSelectedComponentId('');
    setCreating(false);
    setNewLabel('');
    setPreviewMode(false);
    onSelect(created.apiName);
  };
  const cloneDashboard = () => {
    if (!current || !canCreate) return;
    const baseLabel = `${current.label} Copy`.slice(0, 80);
    let label = baseLabel;
    let apiName = apiNameFor(label);
    let suffix = 2;
    while (dashboards.some((dashboard) => dashboard.apiName.toLowerCase() === apiName.toLowerCase())) {
      const suffixText = ` ${suffix}`;
      label = `${baseLabel.slice(0, 80 - suffixText.length)}${suffixText}`;
      apiName = apiNameFor(label);
      suffix += 1;
    }
    const clone: DashboardMetadata = {
      ...current,
      apiName,
      label,
      ownerUserId: userId,
      visibility: 'Private',
      sharedUserIds: [],
      sharedPermissionSetGroupIds: [],
      status: 'Draft',
      components: current.components.map((component) => ({ ...component, id: crypto.randomUUID() })),
      filters: current.filters.map((filter) => ({ ...filter, id: crypto.randomUUID() }))
    };
    setDraft(clone);
    setSelectedComponentId('');
    setCreating(false);
    setPreviewMode(false);
    onSelect(clone.apiName);
  };
  const deleteDashboard = async () => {
    if (!current || !dashboardIsSaved || !canEditCurrent || !window.confirm(`Delete the "${current.label}" dashboard?`)) return;
    setBusy(true);
    try {
      await onDelete(current.apiName);
      const remaining = dashboards.filter((dashboard) => dashboard.apiName !== current.apiName);
      setDraft(remaining[0] ?? null);
      setSelectedComponentId('');
      onSelect(remaining[0]?.apiName ?? '');
      onNotify('Dashboard deleted');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to delete dashboard');
    } finally {
      setBusy(false);
    }
  };
  const deployDashboard = () => {
    if (!current) return;
    void saveDashboard({ ...current, status: current.status === 'Deployed' ? 'Draft' : 'Deployed' });
  };

  const filteredRecords = (component: DashboardComponentMetadata) => {
    if (component.reportApiName) return reportRuns[component.reportApiName]?.rows ?? [];
    const records = recordsByObject[component.objectApiName] ?? [];
    const configuredFiltersMatch = (record: RecordData) => matchesDashboardFilters(
      record,
      current?.filters ?? [],
      component.objectApiName,
      current?.filterLogic ?? 'All',
      previewMode ? viewFilterValues : undefined
    );
    const crossFilterMatches = (record: RecordData) => {
      if (!previewMode || !crossFilters.length) return true;
      const groups = new Map<string, ActiveCrossFilter[]>();
      for (const filter of crossFilters) {
        const key = `${filter.objectApiName}\0${filter.fieldApiName}\0${filter.operator}`;
        groups.set(key, [...(groups.get(key) ?? []), filter]);
      }
      return [...groups.values()].every((filters) => {
        const targetObjectApiName = filters[0].objectApiName;
        if (targetObjectApiName === component.objectApiName) {
          return filters.some((filter) => matchesDashboardFilter(record, filter));
        }
        const paths = relationshipPaths(objects, component.objectApiName, targetObjectApiName);
        if (!paths.length) return true;
        return paths.some((path) => {
          let relatedRecords = [record];
          for (const step of path) {
            if (step.direction === 'forward') {
              const relatedIds = new Set(relatedRecords.map((item) => String(item[step.fieldApiName] ?? '')).filter(Boolean));
              relatedRecords = (recordsByObject[step.targetObjectApiName] ?? [])
                .filter((item) => relatedIds.has(String(item.Id)));
            } else {
              const parentIds = new Set(relatedRecords.map((item) => String(item.Id)));
              relatedRecords = (recordsByObject[step.targetObjectApiName] ?? [])
                .filter((item) => parentIds.has(String(item[step.fieldApiName] ?? '')));
            }
            if (!relatedRecords.length) return false;
          }
          return relatedRecords.some((related) => filters.some((filter) => matchesDashboardFilter(related, filter)));
        });
      });
    };
    return records.filter((record) => configuredFiltersMatch(record) && crossFilterMatches(record));
  };
  const exportTable = async (component: DashboardComponentMetadata) => {
    const fields = objectFor(component.objectApiName)?.fields.filter((field) =>
      component.displayFieldApiNames.includes(field.apiName)) ?? [];
    if (!fields.length) {
      onNotify(`No readable columns are available to export for "${component.title}"`);
      return;
    }
    if (exportingComponentId) return;
    setExportingComponentId(component.id);
    try {
      let rows = filteredRecords(component);
      if (component.reportApiName) {
        const initialRun = reportRuns[component.reportApiName];
        if (!initialRun) throw new Error('The report has not finished loading.');
        rows = [...initialRun.rows];
        const filters = dashboardFiltersForObject(
          current?.filters ?? [],
          component.objectApiName,
          previewMode ? viewFilterValues : undefined
        );
        const activeCrossFilters = previewMode
          ? crossFilters.map(({ componentId: _componentId, ...filter }) => filter)
          : [];
        const expectedTotal = initialRun.totalRows;
        let offset = initialRun.rows.length;
        while (offset < expectedTotal) {
          const nextPage = await onRunReport(
            component.reportApiName,
            filters,
            offset,
            5000,
            current?.filterLogic ?? 'All',
            activeCrossFilters,
            current?.apiName,
            undefined,
            dashboardRunningUserId
          );
          if (nextPage.totalRows !== expectedTotal) {
            throw new Error('The report result changed during export. Refresh the dashboard and try again.');
          }
          if (!nextPage.rows.length) throw new Error(`Report export stopped at row ${offset} of ${expectedTotal}.`);
          rows = [...rows, ...nextPage.rows];
          offset += nextPage.rows.length;
        }
      }
      downloadCsv(
        `${(current?.label ?? 'dashboard').replace(/[^A-Za-z0-9_-]+/g, '_')}_${component.title.replace(/[^A-Za-z0-9_-]+/g, '_')}.csv`,
        fields.map((field) => field.label),
        rows,
        fields.map((field) => field.apiName)
      );
    } catch (error) {
      onNotify(`Unable to export "${component.title}": ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExportingComponentId('');
    }
  };
  const toggleCrossFilter = (component: DashboardComponentMetadata, value: string, fieldApiName = component.groupByFieldApiName) => {
    if (!previewMode || !fieldApiName) return;
    setCrossFilters((active) =>
      toggleDashboardCrossFilter(active, component.id, component.objectApiName, fieldApiName, value));
  };
  const crossFilterSelected = (component: DashboardComponentMetadata, fieldApiName: string | null, value: string) =>
    crossFilters.some((filter) => filter.componentId === component.id && filter.fieldApiName === fieldApiName && filter.value === value);
  const crossFilterDimmed = (component: DashboardComponentMetadata, fieldApiName: string | null, value: string) =>
    crossFilters.some((filter) => filter.componentId === component.id && filter.fieldApiName === fieldApiName)
    && !crossFilterSelected(component, fieldApiName, value);
  const availableFilterValues = (filter: DashboardFilterMetadata) => [...new Set(
    (recordsByObject[filter.objectApiName] ?? [])
      .map((record) => record[filter.fieldApiName])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .flatMap((value) => dashboardFilterValueType(
        objectFor(filter.objectApiName)?.fields.find((field) => field.apiName === filter.fieldApiName)
      ) === 'Multi-Select Picklist'
        ? String(value).split(';').filter(Boolean)
        : [String(value)])
  )].sort((left, right) => left.localeCompare(right));
  const filterValueOptions = (filter: DashboardFilterMetadata) => {
    const field = objectFor(filter.objectApiName)?.fields.find((item) => item.apiName === filter.fieldApiName);
    const type = dashboardFilterValueType(field);
    const values = availableFilterValues(filter);
    if (type === 'Checkbox') return ['true', 'false'];
    if (type === 'Picklist') {
      return [...new Set([...(field?.picklistValues ?? []), ...values])]
        .sort((left, right) => left.localeCompare(right));
    }
    return values;
  };
  const displayMentionText = (component: DashboardComponentMetadata, raw: string) => { const data = dashboardMentionContext(objects, component.objectApiName, recordsByObject, { text: raw }, String(component.properties?.recordId ?? '')); return String(resolveMentionValue(raw, data.records, data.fields, objects, component.objectApiName) ?? ''); };
  const renderComponent = (component: DashboardComponentMetadata) => {
    const chartPalette = chartPaletteFor(component.chartColorPalette);
    const records = filteredRecords(component);
    const reportRun = component.reportApiName ? reportRuns[component.reportApiName] : undefined;
    const mentionData = dashboardMentionContext(objects, component.objectApiName, recordsByObject,
      { ...(component.properties ?? {}), imageUrl: component.imageUrl, richTextContent: component.richTextContent },
      String(component.properties?.recordId ?? ''));
    const data = mentionData.records, visibleFields = mentionData.fields;
    const safeHtmlData = htmlSafeMentionContext(mentionData);
    const resolve = (value: string) => resolveMentionValue(value, data, visibleFields, objects, component.objectApiName);
    if (component.type === 'Rich Text') {
      return <iframe
        className="dashboard-rich-text-frame"
        title={component.title}
        sandbox=""
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src https: data:; font-src data:; style-src 'unsafe-inline'"></head><body>${resolveMentionValue(component.richTextContent ?? '', safeHtmlData.records, safeHtmlData.fields, objects, component.objectApiName)}</body></html>`}
      />;
    }
    if (component.type === 'Image') {
      const imageUrl = resolve(component.imageUrl ?? '');
      return typeof imageUrl === 'string' && imageUrl.startsWith('https://')
        ? <img className="dashboard-image-widget" src={imageUrl} alt={component.imageAltText ?? ''} loading="lazy" referrerPolicy="no-referrer" />
        : <p className="dashboard-no-data">Set an HTTPS image URL in component properties.</p>;
    }
    if (component.type === 'Custom') {
      const definition = findRegisteredComponent(libraryComponents,component.customComponentApiName,'dashboard');
      return definition
        ? <div data-dashboard-custom-component-id={component.id}
            style={resolveLayoutStyle(component.properties ?? {}, layoutDevice)}>
            <RegisteredComponent definition={definition} props={{
            ...resolveMentionProperties(component.properties ?? {}, data, visibleFields, objects, component.objectApiName),
            ...componentLayoutProps(component.properties ?? {}, layoutDevice),
            title: component.title,
            properties: resolveMentionProperties(component.properties ?? {}, data, visibleFields, objects, component.objectApiName),
            object: objectFor(component.objectApiName),
            records,
            filters: current?.filters.filter((filter) => filter.objectApiName === component.objectApiName) ?? []
          }} /></div>
        : <div className="dashboard-data-error" role="alert">This custom component is no longer in the global library.</div>;
    }
    const grouped = new Map<string, RecordData[]>();
    if (component.groupByFieldApiName) {
      records.forEach((record) => {
        const label = formatValue(record[component.groupByFieldApiName!]);
        grouped.set(label, [...(grouped.get(label) ?? []), record]);
      });
    }
    type ChartBucket = { label: string; value: number; series?: Record<string, number> };
    const buckets: ChartBucket[] = reportRun && component.groupByFieldApiName
      ? (() => {
          const groupedSummaries = new Map<string, {
            rowCount: number;
            sums: Record<string, number>;
            counts: Record<string, number>;
            minimums: Record<string, number>;
            maximums: Record<string, number>;
          }>();
          reportRun.summaryRows.forEach((summary) => {
            const label = formatValue(summary.groupValues[component.groupByFieldApiName!]);
            const combined = groupedSummaries.get(label) ?? { rowCount: 0, sums: {}, counts: {}, minimums: {}, maximums: {} };
            combined.rowCount += summary.rowCount;
            Object.entries(summary.sums).forEach(([fieldApiName, value]) => {
              combined.sums[fieldApiName] = (combined.sums[fieldApiName] ?? 0) + value;
            });
            Object.entries(summary.counts).forEach(([fieldApiName, value]) => {
              combined.counts[fieldApiName] = (combined.counts[fieldApiName] ?? 0) + value;
            });
            Object.entries(summary.minimums).forEach(([fieldApiName, value]) => {
              combined.minimums[fieldApiName] = fieldApiName in combined.minimums
                ? Math.min(combined.minimums[fieldApiName], value) : value;
            });
            Object.entries(summary.maximums).forEach(([fieldApiName, value]) => {
              combined.maximums[fieldApiName] = fieldApiName in combined.maximums
                ? Math.max(combined.maximums[fieldApiName], value) : value;
            });
            groupedSummaries.set(label, combined);
          });
          return [...groupedSummaries.entries()].map(([label, summary]) => ({
            label,
            value: aggregateReportSummary(summary, component)
          }));
        })()
      : [...grouped.entries()].map(([label, items]) => ({ label, value: aggregate(items, component) }));
    const stackedBuckets = component.groupByFieldApiName && component.seriesFieldApiName
      && ['Stacked Bar', 'Stacked Column', '100% Stacked Bar', '100% Stacked Column'].includes(component.chartType)
      ? (() => {
          const groupedValues = new Map<string, Map<string, number>>();
          if (reportRun) {
            reportRun.summaryRows.forEach((summary) => {
              const label = formatValue(summary.groupValues[component.groupByFieldApiName!]);
              const series = formatValue(summary.groupValues[component.seriesFieldApiName!]);
              const seriesValues = groupedValues.get(label) ?? new Map<string, number>();
              seriesValues.set(series, (seriesValues.get(series) ?? 0) + aggregateReportSummary(summary, component));
              groupedValues.set(label, seriesValues);
            });
          } else {
            const groupedRecords = new Map<string, Map<string, RecordData[]>>();
            records.forEach((record) => {
              const label = formatValue(record[component.groupByFieldApiName!]);
              const series = formatValue(record[component.seriesFieldApiName!]);
              const seriesRecords = groupedRecords.get(label) ?? new Map<string, RecordData[]>();
              seriesRecords.set(series, [...(seriesRecords.get(series) ?? []), record]);
              groupedRecords.set(label, seriesRecords);
            });
            groupedRecords.forEach((seriesRecords, label) => {
              groupedValues.set(label, new Map([...seriesRecords.entries()].map(([series, items]) =>
                [series, aggregate(items, component)])));
            });
          }
          return [...groupedValues.entries()].map(([label, values]) => ({
            label,
            value: [...values.values()].reduce((sum, value) => sum + value, 0),
            series: Object.fromEntries(values)
          })).sort((left, right) => right.value - left.value);
        })()
      : [];
    if (component.type === 'Metric') {
      const value = reportRun
        ? aggregateReportSummary(reportRun.summaryTotals, component)
        : aggregate(records, component);
      return <div className="dashboard-metric-preview">
        <strong>{formatValue(value)}</strong>
        <span>{(reportRun?.totalRows ?? records.length).toLocaleString()} matching records</span>
      </div>;
    }
    if (component.type === 'Table') {
      const fields = objectFor(component.objectApiName)?.fields.filter((field) => component.displayFieldApiNames.includes(field.apiName)) ?? [];
      const pageSize = 10;
      const pageOffset = tablePageOffsets[component.id] ?? 0;
      const totalRows = reportRun?.totalRows ?? records.length;
      const tableRecords = reportRun
        ? (tablePageRows[component.id] ?? reportRun.rows.slice(pageOffset, pageOffset + pageSize))
        : records.slice(pageOffset, pageOffset + pageSize);
      return <div className="dashboard-data-table-wrap"><table className="dashboard-data-table">
        <thead><tr>{fields.map((field) => <th key={field.apiName}>{field.label}</th>)}</tr></thead>
        <tbody>{tableRecords.map((record, index) => <tr key={String(record.Id ?? index)}>
          {fields.map((field) => <td key={field.apiName}>{formatValue(record[field.apiName])}</td>)}
        </tr>)}</tbody>
      </table>{!totalRows && <p className="dashboard-no-data">No records match the dashboard filters.</p>}
        {totalRows > pageSize && <div className="dashboard-table-pagination">
          <span>Showing {pageOffset + 1}–{Math.min(pageOffset + tableRecords.length, totalRows)} of {totalRows.toLocaleString()}</span>
          <div>
            <button type="button" className="icon-button subtle" aria-label={`Previous page for ${component.title}`}
              disabled={pageOffset === 0 || Boolean(loadingTablePageId)}
              onClick={() => component.reportApiName
                ? void changeTablePage(component, Math.max(0, pageOffset - pageSize))
                : setTablePageOffsets((pages) => ({ ...pages, [component.id]: Math.max(0, pageOffset - pageSize) }))}>
              <ChevronLeft size={13} />
            </button>
            <button type="button" className="icon-button subtle" aria-label={`Next page for ${component.title}`}
              disabled={pageOffset + pageSize >= totalRows || Boolean(loadingTablePageId)}
              onClick={() => component.reportApiName
                ? void changeTablePage(component, pageOffset + pageSize)
                : setTablePageOffsets((pages) => ({ ...pages, [component.id]: pageOffset + pageSize }))}>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>}
      </div>;
    }
    if (component.chartType === 'Gauge') {
      const value = reportRun
        ? aggregateReportSummary(reportRun.summaryTotals, component)
        : aggregate(records, component);
      const minimum = component.gaugeMin ?? 0;
      const maximum = component.gaugeMax ?? 100;
      const percent = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
      const angle = Math.PI - percent * Math.PI;
      const range1End = component.gaugeRange1EndPercent ?? 33;
      const range2End = component.gaugeRange2EndPercent ?? 67;
      return <div className="dashboard-chart-preview chart-gauge">
        <svg viewBox="0 0 200 125" role="img" aria-label={`Gauge showing ${formatChartValue(value, component)} from ${formatChartValue(minimum, component)} to ${formatChartValue(maximum, component)}`}>
          {[{ from: 0, to: range1End, color: '#c23934' }, { from: range1End, to: range2End, color: '#fe9339' }, { from: range2End, to: 100, color: '#2e844a' }]
            .filter((range) => range.to > range.from)
            .map((range) => <path key={`${range.from}-${range.to}`} d="M 25 100 A 75 75 0 0 1 175 100" fill="none" stroke={range.color}
              strokeWidth="18" pathLength="100" strokeDasharray={`${range.to - range.from} 100`} strokeDashoffset={`${-range.from}`} />)}
          <line x1="100" y1="100" x2={100 + Math.cos(angle) * 61} y2={100 - Math.sin(angle) * 61} stroke="#181818" strokeWidth="3" />
          <circle cx="100" cy="100" r="5" fill="#181818" />
          {component.showValues !== false && <text x="100" y="121" textAnchor="middle">{formatChartValue(value, component)} / {formatChartValue(minimum, component)}-{formatChartValue(maximum, component)}</text>}
        </svg>
      </div>;
    }
    if (component.chartType === 'Scatter') {
      const xField = component.xAxisFieldApiName ?? '';
      const pointValues = new Map<number, number>();
      if (reportRun) {
        const summaries = new Map<number, { rowCount: number; sums: Record<string, number>; counts: Record<string, number>; minimums: Record<string, number>; maximums: Record<string, number> }>();
        reportRun.summaryRows.forEach((summary) => {
          const x = Number(summary.groupValues[xField]);
          if (!Number.isFinite(x)) return;
          const combined = summaries.get(x) ?? { rowCount: 0, sums: {}, counts: {}, minimums: {}, maximums: {} };
          combined.rowCount += summary.rowCount;
          Object.entries(summary.sums).forEach(([field, value]) => { combined.sums[field] = (combined.sums[field] ?? 0) + value; });
          Object.entries(summary.counts).forEach(([field, value]) => { combined.counts[field] = (combined.counts[field] ?? 0) + value; });
          Object.entries(summary.minimums).forEach(([field, value]) => { combined.minimums[field] = field in combined.minimums ? Math.min(combined.minimums[field], value) : value; });
          Object.entries(summary.maximums).forEach(([field, value]) => { combined.maximums[field] = field in combined.maximums ? Math.max(combined.maximums[field], value) : value; });
          summaries.set(x, combined);
        });
        summaries.forEach((summary, x) => pointValues.set(x, aggregateReportSummary(summary, component)));
      } else {
        const pointRecords = new Map<number, RecordData[]>();
        records.forEach((record) => {
          const x = Number(record[xField]);
          if (Number.isFinite(x)) pointRecords.set(x, [...(pointRecords.get(x) ?? []), record]);
        });
        pointRecords.forEach((items, x) => pointValues.set(x, aggregate(items, component)));
      }
      const points = [...pointValues.entries()].sort(([left], [right]) => left - right)
        .slice(0, component.chartLimit ?? 8);
      if (!points.length) return <p className="dashboard-no-data">No numeric x-axis values are available for this scatter chart.</p>;
      const xDomain = chartAxisRange(points.map(([x]) => x), component.chartXAxisMinimum, component.chartXAxisMaximum);
      const yDomain = chartAxisRange(points.map(([, y]) => y), component.chartYAxisMinimum, component.chartYAxisMaximum);
      if (!xDomain || !yDomain) return <p className="dashboard-data-error" role="alert">Each configured axis maximum must be greater than its minimum.</p>;
      const xRange = xDomain.maximum - xDomain.minimum;
      const yRange = yDomain.maximum - yDomain.minimum;
      return <div className={`dashboard-chart-preview chart-scatter dashboard-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
        <svg viewBox="0 0 600 230" role="img" aria-label={`Scatter chart plotting ${component.yAxisTitle || component.measureFieldApiName || 'record count'} against ${component.xAxisTitle || xField}`} preserveAspectRatio="none">
          {chartAxisTicks(yDomain).map((tick, index) => {
            const y = 174 - index * 142 / 4;
            return <g key={index}>
              {component.showGridlines !== false && <line x1="68" x2="584" y1={y} y2={y} className="chart-grid-line" />}
              <text x="62" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
            </g>;
          })}
          {chartAxisTicks(xDomain).map((tick, index) => {
            const x = 68 + index * 516 / 4;
            return <g key={index}>
              {component.showGridlines !== false && <line x1={x} x2={x} y1="32" y2="174" className="chart-grid-line" />}
              <text x={x} y="190" textAnchor="middle">{formatChartValue(tick, component)}</text>
            </g>;
          })}
          <line x1="68" x2="584" y1="174" y2="174" className="chart-axis-line" />
          <line x1="68" x2="68" y1="32" y2="174" className="chart-axis-line" />
          {points.map(([x, value], index) => {
            const px = 68 + (Math.max(xDomain.minimum, Math.min(xDomain.maximum, x)) - xDomain.minimum) / xRange * 516;
            const py = 174 - (Math.max(yDomain.minimum, Math.min(yDomain.maximum, value)) - yDomain.minimum) / yRange * 142;
            const label = formatChartValue(x, component);
            return <g key={String(x)} role={previewMode ? 'button' : undefined} tabIndex={previewMode ? 0 : undefined}
              aria-label={previewMode ? `Filter dashboard by ${label}` : `Point ${label}: ${formatChartValue(value, component)}`}
              onClick={previewMode ? () => toggleCrossFilter(component, label, xField) : undefined}
              onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCrossFilter(component, label, xField); } } : undefined}>
              <circle cx={px} cy={py} r="5" fill={chartPalette[index % chartPalette.length]} />
              {component.showValues !== false && <text
                x={px} y={component.chartDataLabelPosition === 'Inside' ? Math.min(214, py + 14) : Math.max(14, py - 8)}
                textAnchor="middle">{formatChartValue(value, component)}</text>}
            </g>;
          })}
          {component.xAxisTitle && <text x="326" y="218" textAnchor="middle">{component.xAxisTitle}</text>}
          {component.yAxisTitle && <text transform="translate(14 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
        </svg>
        {component.showLegend !== false && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}
          aria-label="Chart legend"><li><i style={{ backgroundColor: '#0176d3' }} /><span>
            {objectFor(component.objectApiName)?.fields.find((field) => field.apiName === component.measureFieldApiName)?.label ?? component.title}
          </span></li></ul>}
      </div>;
    }
    const chartBuckets = (component.chartType === 'Stacked Bar' || component.chartType === 'Stacked Column'
      || component.chartType === '100% Stacked Bar' || component.chartType === '100% Stacked Column'
      ? stackedBuckets : buckets)
      .sort((left, right) => component.chartSortOrder === 'Ascending'
        ? left.value - right.value : right.value - left.value)
      .slice(0, component.chartLimit ?? 8);
    if (!chartBuckets.length) return <p className="dashboard-no-data">No records match the dashboard filters.</p>;
    const chartLabel = `${component.chartType} chart showing ${chartBuckets.length} ${component.groupByFieldApiName ?? ''} groups`;
    const chartLegend = (items: Array<{ label: string; color: string; value?: number }>) =>
      component.showLegend !== false && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}
        aria-label="Chart legend">{items.map((item) => <li key={item.label}>
        <i style={{ backgroundColor: item.color }} /><span>{item.label}</span>
        {component.showValues !== false && item.value !== undefined && <strong>{formatChartValue(item.value, component)}</strong>}
      </li>)}</ul>;
    if (component.chartType === 'Donut' || component.chartType === 'Pie') {
      const positiveTotal = chartBuckets.reduce((sum, bucket) => sum + Math.max(0, bucket.value), 0);
      if (!positiveTotal) return <p className="dashboard-no-data">A donut chart requires at least one positive value.</p>;
      let offset = 0;
      return <div className={`dashboard-chart-preview chart-donut legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
        <svg viewBox="0 0 180 180" role="img" aria-label={chartLabel}>
          {chartBuckets.map((bucket, index) => {
            const value = Math.max(0, bucket.value);
            const share = value / positiveTotal * 100;
            const circle = <circle key={bucket.label} cx="90" cy="90" r="58" fill="none" stroke={chartPalette[index]} strokeWidth="28"
              pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset}
              opacity={crossFilterDimmed(component, component.groupByFieldApiName, bucket.label) ? 0.3 : 1}
              role={previewMode ? 'button' : undefined} tabIndex={previewMode ? 0 : undefined}
              aria-label={previewMode ? `Filter dashboard by ${bucket.label}` : undefined}
              onClick={previewMode ? () => toggleCrossFilter(component, bucket.label) : undefined}
              onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCrossFilter(component, bucket.label); } } : undefined}
              transform="rotate(-90 90 90)" />;
            offset += share;
            return circle;
          })}
          {component.chartType === 'Donut' && component.showValues !== false && <>
            <circle cx="90" cy="90" r="40" fill="white" />
            <text x="90" y="94" textAnchor="middle">{formatChartValue(positiveTotal, component)}</text>
          </>}
        </svg>
        {component.showLegend !== false && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`} aria-label="Chart values">{chartBuckets.map((bucket, index) =>
          <li key={bucket.label}><button type="button" disabled={!previewMode} aria-pressed={crossFilterSelected(component, component.groupByFieldApiName, bucket.label)} onClick={() => toggleCrossFilter(component, bucket.label)}><i style={{ backgroundColor: chartPalette[index] }} /><span>{bucket.label}</span>{component.showValues !== false && <strong>{formatChartValue(bucket.value, component)}</strong>}</button></li>)}</ul>
        }
      </div>;
    }
    if (component.chartType === 'Line' || component.chartType === 'Area') {
      const yDomain = chartAxisRange(chartBuckets.map((bucket) => bucket.value), component.chartYAxisMinimum, component.chartYAxisMaximum);
      if (!yDomain) return <p className="dashboard-data-error" role="alert">The configured Y-axis maximum must be greater than its minimum.</p>;
      const range = yDomain.maximum - yDomain.minimum;
      const yForValue = (value: number) =>
        154 - (Math.max(yDomain.minimum, Math.min(yDomain.maximum, value)) - yDomain.minimum) / range * 118;
      const baseline = yForValue(0);
      const points = chartBuckets.map((bucket, index) => ({
        x: chartBuckets.length === 1 ? 300 : 36 + index * 528 / (chartBuckets.length - 1),
        y: yForValue(bucket.value)
      }));
      return <div className={`dashboard-chart-preview chart-line dashboard-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
        <svg viewBox="0 0 600 220" role="img" aria-label={chartLabel} preserveAspectRatio="none">
          {chartAxisTicks(yDomain).map((tick, index) => {
            const y = 154 - index * 118 / 4;
            return <g key={index}>
              {component.showGridlines !== false && <line x1="28" x2="590" y1={y} y2={y} className="chart-grid-line" />}
              <text x="24" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
            </g>;
          })}
          <line x1="28" x2="590" y1="154" y2="154" className="chart-axis-line" />
          {component.chartType === 'Area' && <polygon
            points={`${points[0].x},${baseline} ${points.map((point) => `${point.x},${point.y}`).join(' ')} ${points[points.length - 1].x},${baseline}`}
            fill="#0176d3" fillOpacity="0.18" />}
          <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#0176d3" strokeWidth="3" />
          {points.map((point, index) => <g key={chartBuckets[index].label}
            role={previewMode ? 'button' : undefined} tabIndex={previewMode ? 0 : undefined}
            aria-label={previewMode ? `Filter dashboard by ${chartBuckets[index].label}` : undefined}
            onClick={previewMode ? () => toggleCrossFilter(component, chartBuckets[index].label) : undefined}
            onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCrossFilter(component, chartBuckets[index].label); } } : undefined}
            opacity={crossFilterDimmed(component, component.groupByFieldApiName, chartBuckets[index].label) ? 0.35 : 1}>
            <circle cx={point.x} cy={point.y} r="4" fill="#0176d3" />
            <text x={point.x} y="185" textAnchor="middle">{chartBuckets[index].label.slice(0, 12)}</text>
            {component.showValues !== false && <text
              x={point.x} y={component.chartDataLabelPosition === 'Inside' ? Math.min(205, point.y + 14) : Math.max(15, point.y - 9)}
              textAnchor="middle">{formatChartValue(chartBuckets[index].value, component)}</text>}
          </g>)}
          {component.xAxisTitle && <text x="316" y="216" textAnchor="middle">{component.xAxisTitle}</text>}
          {component.yAxisTitle && <text transform="translate(12 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
        </svg>
        {chartLegend([{ label: objectFor(component.objectApiName)?.fields.find((field) => field.apiName === component.measureFieldApiName)?.label
          ?? component.title, color: '#0176d3' }])}
      </div>;
    }
    if (component.chartType === 'Funnel') {
      const max = Math.max(1, ...chartBuckets.map((bucket) => Math.abs(bucket.value)));
      return <div className="dashboard-chart-preview chart-funnel" role="group" aria-label={chartLabel}>
        {chartBuckets.map((bucket, index) => <button type="button" className={`dashboard-funnel-step ${crossFilterSelected(component, component.groupByFieldApiName, bucket.label) ? 'selected' : ''}`} key={bucket.label} disabled={!previewMode} onClick={() => toggleCrossFilter(component, bucket.label)}>
          <span>{bucket.label}</span>{component.showValues !== false && <strong>{formatChartValue(bucket.value, component)}</strong>}
          <i style={{ width: `${Math.max(12, Math.abs(bucket.value) / max * 100)}%`, backgroundColor: chartPalette[index] }} />
        </button>)}
      </div>;
    }
    if (component.chartType === 'Stacked Column' || component.chartType === '100% Stacked Column') {
      const seriesNames = [...new Set(chartBuckets.flatMap((bucket) => Object.keys(bucket.series ?? {})))];
      const percentStacked = component.chartType === '100% Stacked Column';
      const yDomain = percentStacked ? { minimum: 0, maximum: 100 }
        : chartAxisRange(chartBuckets.map((bucket) => bucket.value), component.chartYAxisMinimum, component.chartYAxisMaximum);
      if (!yDomain) return <p className="dashboard-data-error" role="alert">The configured Y-axis maximum must be greater than its minimum.</p>;
      const yRange = yDomain.maximum - yDomain.minimum;
      const yForValue = (value: number) => 174 - (Math.max(yDomain.minimum, Math.min(yDomain.maximum, value)) - yDomain.minimum) / yRange * 130;
      return <div className={`dashboard-chart-preview chart-column dashboard-stacked-column dashboard-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
        <svg viewBox="0 0 600 220" role="img" aria-label={chartLabel} preserveAspectRatio="none">
          {chartAxisTicks(yDomain).map((tick, tickIndex) => {
            const y = yForValue(tick);
            return <g key={tickIndex}>
              {component.showGridlines !== false && <line x1="42" x2="584" y1={y} y2={y} className="chart-grid-line" />}
              <text x="38" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
            </g>;
          })}
          <line x1="42" x2="584" y1={yForValue(0)} y2={yForValue(0)} className="chart-axis-line" />
          {chartBuckets.map((bucket, index) => {
            let y = yForValue(percentStacked ? 100 : 0);
          const stackStartY = y;
          let stackedValue = 0;
            const x = 50 + index * (520 / chartBuckets.length);
            const columnWidth = Math.max(1, Math.min(34, 520 / chartBuckets.length - 10));
            return <g key={bucket.label}>
              {seriesNames.map((series, seriesIndex) => {
                const value = bucket.series?.[series] ?? 0;
                const segmentValue = percentStacked ? value / (bucket.value || 1) * 100 : value;
                stackedValue += segmentValue;
                const nextY = yForValue((percentStacked ? 100 : 0) + stackedValue);
                const segmentY = Math.min(y, nextY);
                const height = Math.abs(y - nextY);
                y = nextY;
                return <rect key={series} x={x} y={segmentY} width={columnWidth} height={height} fill={chartPalette[seriesIndex % chartPalette.length]}
                  role={previewMode ? 'button' : undefined} tabIndex={previewMode ? 0 : undefined}
                  aria-label={previewMode ? `Filter dashboard by series ${series}` : undefined}
                  onClick={previewMode ? (event) => { event.stopPropagation(); toggleCrossFilter(component, series, component.seriesFieldApiName ?? undefined); } : undefined}
                  onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleCrossFilter(component, series, component.seriesFieldApiName ?? undefined); } } : undefined} />;
              })}
              <text x={x + columnWidth / 2} y="194" textAnchor="middle" role={previewMode ? 'button' : undefined}
                tabIndex={previewMode ? 0 : undefined} aria-label={previewMode ? `Filter dashboard by ${bucket.label}` : undefined}
                onClick={previewMode ? () => toggleCrossFilter(component, bucket.label) : undefined}
                onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCrossFilter(component, bucket.label); } } : undefined}>
                {bucket.label.slice(0, 9)}
              </text>
              {component.showValues !== false && <text className={component.chartDataLabelPosition === 'Inside' ? 'chart-data-label-inside' : ''}
                x={x + columnWidth / 2} y={component.chartDataLabelPosition === 'Inside' ? (stackStartY + y) / 2 : Math.max(12, y - 4)} textAnchor="middle">
                {percentStacked ? '100%' : formatChartValue(bucket.value, component)}
              </text>}
            </g>;
          })}
          {component.xAxisTitle && <text x="316" y="216" textAnchor="middle">{component.xAxisTitle}</text>}
          {component.yAxisTitle && <text transform="translate(12 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
        </svg>
        {component.showLegend !== false && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>{seriesNames.map((series, index) =>
          <li key={series}><i style={{ backgroundColor: chartPalette[index % chartPalette.length] }} /><span>{series}</span></li>)}</ul>}
      </div>;
    }
    if (component.chartType === 'Stacked Bar' || component.chartType === '100% Stacked Bar') {
      const seriesNames = [...new Set(chartBuckets.flatMap((bucket) => Object.keys(bucket.series ?? {})))];
      const percentStacked = component.chartType === '100% Stacked Bar';
      const xDomain = percentStacked ? { minimum: 0, maximum: 100 }
        : chartAxisRange(chartBuckets.map((bucket) => bucket.value), component.chartXAxisMinimum, component.chartXAxisMaximum);
      if (!xDomain) return <p className="dashboard-data-error" role="alert">The configured X-axis maximum must be greater than its minimum.</p>;
      const xRange = xDomain.maximum - xDomain.minimum;
      const xForValue = (value: number) => 154 + (Math.max(xDomain.minimum, Math.min(xDomain.maximum, value)) - xDomain.minimum) / xRange * 390;
      const chartHeight = Math.max(180, chartBuckets.length * 34 + 55);
      return <div className={`dashboard-stacked-chart dashboard-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`} role="group" aria-label={chartLabel}>
        <svg viewBox={`0 0 600 ${chartHeight}`} role="img" aria-label={chartLabel} preserveAspectRatio="none">
          {chartAxisTicks(xDomain).map((tick, tickIndex) => {
            const x = xForValue(tick);
            return <g key={tickIndex}>
              {component.showGridlines !== false && <line x1={x} x2={x} y1="8" y2={chartBuckets.length * 34 + 8} className="chart-grid-line" />}
              <text x={x} y={chartBuckets.length * 34 + 22} textAnchor="middle">{formatChartValue(tick, component)}</text>
            </g>;
          })}
          {chartBuckets.map((bucket, index) => {
            let x = xForValue(0);
            const y = index * 34 + 10;
            return <g key={bucket.label}>
              <text x="147" y={y + 17} textAnchor="end" role={previewMode ? 'button' : undefined}
                tabIndex={previewMode ? 0 : undefined} aria-label={previewMode ? `Filter dashboard by ${bucket.label}` : undefined}
                onClick={previewMode ? () => toggleCrossFilter(component, bucket.label) : undefined}
                onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCrossFilter(component, bucket.label); } } : undefined}>
                {bucket.label.slice(0, 18)}
              </text>
              {seriesNames.map((series, seriesIndex) => {
                const value = bucket.series?.[series] ?? 0;
                const segmentValue = percentStacked ? value / (bucket.value || 1) * 100 : value;
                const width = Math.max(0, xForValue(segmentValue) - xForValue(0));
                const rect = <rect key={series} x={x} y={y + 2} width={width} height="18" rx="2" fill={chartPalette[seriesIndex % chartPalette.length]}
                  role={previewMode ? 'button' : undefined} tabIndex={previewMode ? 0 : undefined}
                  aria-label={previewMode ? `Filter dashboard by ${series}` : undefined}
                  onClick={previewMode ? (event) => { event.stopPropagation(); toggleCrossFilter(component, series, component.seriesFieldApiName ?? undefined); } : undefined}
                  onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleCrossFilter(component, series, component.seriesFieldApiName ?? undefined); } } : undefined} />;
                x += width;
                return rect;
              })}
              {component.showValues !== false && <text className={component.chartDataLabelPosition === 'Inside' ? 'chart-data-label-inside' : ''}
                x={component.chartDataLabelPosition === 'Inside' ? Math.max(154, x - 5) : Math.min(580, x + 5)}
                y={y + 17} textAnchor={component.chartDataLabelPosition === 'Inside' ? 'end' : 'start'}>
                {percentStacked ? '100%' : formatChartValue(bucket.value, component)}
              </text>}
            </g>;
          })}
          {component.xAxisTitle && <text x="350" y={chartHeight - 7} textAnchor="middle">{component.xAxisTitle}</text>}
          {component.yAxisTitle && <text transform={`translate(12 ${Math.min(130, chartBuckets.length * 17)}) rotate(-90)`} textAnchor="middle">{component.yAxisTitle}</text>}
        </svg>
        {component.showLegend !== false && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>{seriesNames.map((series, index) =>
          <li key={series}><i style={{ backgroundColor: chartPalette[index % chartPalette.length] }} /><span>{series}</span></li>)}</ul>}
      </div>;
    }
    if (component.chartType === 'Column') {
      const yDomain = chartAxisRange(chartBuckets.map((bucket) => bucket.value), component.chartYAxisMinimum, component.chartYAxisMaximum);
      if (!yDomain) return <p className="dashboard-data-error" role="alert">The configured Y-axis maximum must be greater than its minimum.</p>;
      const yRange = yDomain.maximum - yDomain.minimum;
      const yForValue = (value: number) => 174 - (Math.max(yDomain.minimum, Math.min(yDomain.maximum, value)) - yDomain.minimum) / yRange * 130;
      return <div className={`dashboard-chart-preview chart-column dashboard-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
        <svg viewBox={`0 0 600 220`} role="img" aria-label={chartLabel} preserveAspectRatio="none">
          {chartAxisTicks(yDomain).map((tick, tickIndex) => {
            const y = yForValue(tick);
            return <g key={tickIndex}>
              {component.showGridlines !== false && <line x1="42" x2="584" y1={y} y2={y} className="chart-grid-line" />}
              <text x="38" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
            </g>;
          })}
          <line x1="42" x2="584" y1={yForValue(0)} y2={yForValue(0)} className="chart-axis-line" />
          {chartBuckets.map((bucket, index) => {
            const step = 520 / chartBuckets.length;
            const x = 50 + index * step;
            const columnWidth = Math.min(34, step - 10);
            const valueY = yForValue(bucket.value);
            const baselineY = yForValue(0);
            const y = Math.min(valueY, baselineY);
            const height = Math.max(1, Math.abs(valueY - baselineY));
            return <g key={bucket.label} role={previewMode ? 'button' : undefined} tabIndex={previewMode ? 0 : undefined}
              aria-label={previewMode ? `Filter dashboard by ${bucket.label}` : undefined}
              onClick={previewMode ? () => toggleCrossFilter(component, bucket.label) : undefined}>
              <rect x={x} y={y} width={columnWidth} height={height} rx="3" fill={chartPalette[index % chartPalette.length]} />
              <text x={x + columnWidth / 2} y="194" textAnchor="middle">{bucket.label.slice(0, 9)}</text>
              {component.showValues !== false && <text className={component.chartDataLabelPosition === 'Inside' ? 'chart-data-label-inside' : ''}
                x={x + columnWidth / 2} y={component.chartDataLabelPosition === 'Inside' ? y + 13 : Math.max(12, y - 4)}
                textAnchor="middle">{formatChartValue(bucket.value, component)}</text>}
            </g>;
          })}
          {component.xAxisTitle && <text x="316" y="216" textAnchor="middle">{component.xAxisTitle}</text>}
          {component.yAxisTitle && <text transform="translate(12 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
        </svg>
        {chartLegend(chartBuckets.map((bucket, index) => ({ label: bucket.label, color: chartPalette[index % chartPalette.length], value: bucket.value })))}
      </div>;
    }
    const xDomain = chartAxisRange(chartBuckets.map((bucket) => bucket.value), component.chartXAxisMinimum, component.chartXAxisMaximum);
    if (!xDomain) return <p className="dashboard-data-error" role="alert">The configured X-axis maximum must be greater than its minimum.</p>;
    const xRange = xDomain.maximum - xDomain.minimum;
    const plotLeft = 156;
    const plotWidth = 290;
    const xForValue = (value: number) => plotLeft + (Math.max(xDomain.minimum, Math.min(xDomain.maximum, value)) - xDomain.minimum) / xRange * plotWidth;
    const baseline = xForValue(0);
    const chartHeight = Math.max(190, chartBuckets.length * 30 + 55);
    return <div className={`dashboard-chart-preview chart-bar dashboard-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
      <svg viewBox={`0 0 600 ${chartHeight}`} role="img" aria-label={chartLabel} preserveAspectRatio="none">
        {chartAxisTicks(xDomain).map((tick, tickIndex) => {
          const x = xForValue(tick);
          return <g key={tickIndex}>
            {component.showGridlines !== false && <line x1={x} x2={x} y1="8" y2={chartBuckets.length * 30 + 8} className="chart-grid-line" />}
            <text x={x} y={chartBuckets.length * 30 + 22} textAnchor="middle">{formatChartValue(tick, component)}</text>
          </g>;
        })}
        <line x1={baseline} x2={baseline} y1="8" y2={chartBuckets.length * 30 + 8} className="chart-axis-line" />
        {chartBuckets.map((bucket, index) => {
          const y = index * 30 + 14;
          const valueX = xForValue(bucket.value);
          return <g key={bucket.label}
            role={previewMode ? 'button' : undefined} tabIndex={previewMode ? 0 : undefined}
            aria-label={previewMode ? `Filter dashboard by ${bucket.label}` : undefined}
            onClick={previewMode ? () => toggleCrossFilter(component, bucket.label) : undefined}
            onKeyDown={previewMode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCrossFilter(component, bucket.label); } } : undefined}
            opacity={crossFilterDimmed(component, component.groupByFieldApiName, bucket.label) ? 0.35 : 1}>
            <text x="148" y={y + 4} textAnchor="end">{bucket.label.slice(0, 20)}</text>
            <rect x={Math.min(baseline, valueX)} y={y - 7} width={Math.max(1, Math.abs(valueX - baseline))} height="14" rx="3" fill={chartPalette[index]} />
            {component.showValues !== false && <text className={component.chartDataLabelPosition === 'Inside' ? 'chart-data-label-inside' : ''}
              x={component.chartDataLabelPosition === 'Inside'
                ? bucket.value >= 0 ? valueX - 5 : valueX + 5
                : bucket.value >= 0 ? Math.min(580, valueX + 5) : Math.max(154, valueX - 5)}
              y={y + 4} textAnchor={component.chartDataLabelPosition === 'Inside'
                ? bucket.value >= 0 ? 'end' : 'start' : bucket.value >= 0 ? 'start' : 'end'}>
              {formatChartValue(bucket.value, component)}
            </text>}
          </g>;
        })}
        {component.xAxisTitle && <text x={plotLeft + plotWidth / 2} y={chartHeight - 7} textAnchor="middle">{component.xAxisTitle}</text>}
        {component.yAxisTitle && <text transform={`translate(12 ${chartBuckets.length * 15}) rotate(-90)`} textAnchor="middle">{component.yAxisTitle}</text>}
      </svg>
      {chartLegend(chartBuckets.map((bucket, index) => ({ label: bucket.label, color: chartPalette[index % chartPalette.length], value: bucket.value })))}
    </div>;
  };

  return <div className={`dashboard-builder ${previewMode ? 'preview-mode' : ''} ${viewerMode ? 'dashboard-viewer-mode' : ''}`}>
    <header className="dashboard-builder-header">
      <div className="dashboard-builder-heading">
        <div className="eyebrow">Analytics / Dashboards</div>
        {viewerMode
          ? <h1 className="dashboard-viewer-title">{current?.label ?? 'Dashboard unavailable'}</h1>
          : <><h1 className="audit-visually-hidden">Dashboard Builder</h1><input aria-label="Dashboard name" className="dashboard-name-input" disabled={!current || previewMode}
            value={current?.label ?? ''} placeholder="Choose or create a dashboard"
            onChange={(event) => changeDraft((dashboard) => ({ ...dashboard, label: event.target.value }))} /></>}
        {current && (!viewerMode || current.status === 'Deployed') && <span className={`dashboard-status ${current.status.toLocaleLowerCase()}`}>{current.status}</span>}
        {previewMode && crossFilters.map((filter) => <button key={filter.id} className="text-action dashboard-cross-filter"
          title={`${objectFor(filter.objectApiName)?.label ?? filter.objectApiName}: ${filter.fieldApiName}`}
          onClick={() => setCrossFilters((active) => active.filter((item) => item.id !== filter.id))}>
          {objectFor(filter.objectApiName)?.label ?? filter.objectApiName}: {filter.value} <X size={13} />
        </button>)}
        {previewMode && crossFilters.length > 0 && <button className="text-action dashboard-cross-filter"
          onClick={() => setCrossFilters([])}>Clear all</button>}
      </div>
      <div className="dashboard-heading-actions">
        {!previewMode && !viewerMode && <>
          <button type="button" className="btn md-builder-panel-toggle"
            aria-controls="md-dashboard-library" aria-expanded={tabletPanel==='library'}
            onClick={()=>setTabletPanel(current=>current==='library'?null:'library')}>Library</button>
          <button type="button" className="btn md-builder-panel-toggle"
            aria-controls="md-dashboard-inspector" aria-expanded={tabletPanel==='inspector'}
            onClick={()=>setTabletPanel(current=>current==='inspector'?null:'inspector')}>Inspector</button>
        </>}
        {previewMode && current?.allowViewerToSelectRunningUser && runningUserIds.length > 1 && <label className="dashboard-running-user-choice">
          View as
          <select aria-label="Choose dashboard running user" className="form-control"
            value={selectedRunningUserId} onChange={(event) => {
              setSelectedRunningUserId(event.target.value);
            }}>
            <option value={userId}>Logged-in viewer</option>
            {subscriptionUsers.filter((user) => user.id !== userId && runningUserIds.includes(user.id)).map((user) =>
              <option value={user.id} key={user.id}>{user.name} ({user.username})</option>)}
          </select>
        </label>}
        <button className="btn" disabled={!current || current.status !== 'Deployed'} onClick={() => setRefreshKey((key) => key + 1)}><RefreshCw size={14} />Refresh</button>
        {viewerMode
          ? <button className="btn" onClick={() => current && window.print()} disabled={!current}><Printer size={14} />Print</button>
          : <button className="btn" disabled={!current} onClick={() => {
            if (!previewMode) {
              setViewFilterValues({});
              setCrossFilters([]);
            }
            setPreviewMode((mode) => !mode);
          }}><Eye size={14} />{previewMode ? 'Edit' : 'Preview'}</button>}
        {!viewerMode && previewMode && current?.status === 'Deployed' && <button className="btn" onClick={() => onOpenViewer(current.apiName)}><Eye size={14} />Open Viewer</button>}
        {viewerMode && current && <button className="btn" onClick={() => onExitViewer(current.apiName)}>Back to Setup</button>}
        {!viewerMode && <button className="btn" disabled={!current || !canCreate || busy} onClick={cloneDashboard}><Copy size={14} />Clone</button>}
        {!viewerMode && dashboardIsSaved && <button className="btn" disabled={!canEditCurrent || busy || !current || (current.status === 'Draft' && !current.components.length)} onClick={deployDashboard}>
          {current?.status === 'Deployed' ? <X size={14} /> : <Check size={14} />}{current?.status === 'Deployed' ? 'Unpublish' : 'Publish'}
        </button>}
        {!viewerMode && <button className="btn btn-brand" disabled={!canEditCurrent || !current || busy || !current.label.trim()} onClick={() => current && void saveDashboard(current)}>
          <Save size={14} />{busy ? 'Saving…' : dirty || !dashboardIsSaved ? 'Save' : 'Saved'}
        </button>}
      </div>
    </header>
    <div className={`dashboard-builder-layout md-builder-frame ${previewMode ? 'dashboard-preview-layout' : ''} ${tabletPanel==='library'?'md-builder-library-open':''} ${tabletPanel==='inspector'?'md-builder-inspector-open':''}`}>
      {!previewMode && <aside className="dashboard-builder-sidebar" id="md-dashboard-library">
        <div className="dashboard-sidebar-section">
          <div className="dashboard-panel-heading"><strong>Dashboards</strong><button className="icon-button" aria-label="Create dashboard" disabled={!canCreate} onClick={() => setCreating(true)}><Plus size={16} /></button></div>
          <label className="dashboard-select-label" htmlFor="dashboard-folder-filter">Folder</label>
          <div className="dashboard-select-wrap"><select id="dashboard-folder-filter" value={folderFilter} onChange={(event) => {
            const nextFolder = event.target.value;
            setFolderFilter(nextFolder);
            if (nextFolder !== 'All Folders') {
              const firstInFolder = dashboards.find((dashboard) => dashboardFolderDisplay(dashboard) === nextFolder);
              if (firstInFolder) onSelect(firstInFolder.apiName);
            }
          }}>
            <option>All Folders</option>{dashboardFolderPaths.map((folder) => <option key={folder}>{folder}</option>)}
          </select><ChevronDown size={13} /></div>
          <label className="dashboard-select-label" htmlFor="dashboard-select">Select dashboard</label>
          <div className="dashboard-select-wrap"><LayoutDashboard size={14} /><select id="dashboard-select" value={current?.apiName ?? ''} onChange={(event) => onSelect(event.target.value)}>
            {!dashboards.length && <option value="">No saved dashboards</option>}
            {[...new Set(dashboards.filter((dashboard) => folderFilter === 'All Folders' || dashboardFolderDisplay(dashboard) === folderFilter).map(dashboardFolderDisplay))].sort().map((folder) =>
              <optgroup key={folder} label={folder}>{dashboards.filter((dashboard) => dashboardFolderDisplay(dashboard) === folder && (folderFilter === 'All Folders' || folder === folderFilter)).map((dashboard) =>
                <option key={dashboard.apiName} value={dashboard.apiName}>{dashboard.label}{dashboard.visibility === 'Private' ? ' · Private' : ''}</option>)}</optgroup>)}
            {current && !dashboards.some((item) => item.apiName === current.apiName) && <option value={current.apiName}>{current.label} (unsaved)</option>}
          </select><ChevronDown size={13} /></div>
          <button className="btn btn-full" disabled={!canCreate} onClick={() => setCreating(true)}><Plus size={14} />New Dashboard</button>
          <div className="dashboard-folder-create">
            <label className="dashboard-select-label" htmlFor="dashboard-new-folder">Create folder</label>
            <input id="dashboard-new-folder" className="form-control" maxLength={80} value={newFolderLabel}
              onChange={(event) => setNewFolderLabel(event.target.value)} placeholder="Folder name" />
            <select className="form-control" aria-label="Parent dashboard folder" value={newFolderParentId}
              onChange={(event) => setNewFolderParentId(event.target.value)}>
              <option value="">Top-level folder</option>
              {createFolderParents.map(({ folder, path }) => <option key={folder.id} value={folder.id}>{path}</option>)}
            </select>
            <button className="btn btn-full" disabled={!canCreateInSelectedFolder || !newFolderLabel.trim()} onClick={() => void createFolder()}>
              <Plus size={14} />Create Folder
            </button>
          </div>
        </div>
        <div className="dashboard-sidebar-section">
          <div className="dashboard-panel-heading"><strong>Components</strong><CircleHelp size={14} /></div>
          <p className="palette-note" role="note">Select a component to add it to the dashboard. Changes are not published until you publish.</p>
          <div className="dashboard-component-tools">
            <button disabled={!canEditCurrent || previewMode} onClick={() => addComponent('Metric')}><span className="dashboard-tool-icon metric-tool">#</span><span><b>Metric</b><small>Summarize a value</small></span><Plus size={14} /></button>
            <button disabled={!canEditCurrent || previewMode} onClick={() => addComponent('Chart')}><span className="dashboard-tool-icon chart-tool"><BarChart3 size={15} /></span><span><b>Chart</b><small>Visualize grouped data</small></span><Plus size={14} /></button>
            <button disabled={!canEditCurrent || previewMode} onClick={() => addComponent('Table')}><span className="dashboard-tool-icon table-tool"><FileText size={15} /></span><span><b>Table</b><small>Show record details</small></span><Plus size={14} /></button>
            <button disabled={!canEditCurrent || previewMode} onClick={() => addComponent('Rich Text')}><span className="dashboard-tool-icon table-tool"><FileText size={15} /></span><span><b>Rich Text</b><small>Add formatted content</small></span><Plus size={14} /></button>
            <button disabled={!canEditCurrent || previewMode} onClick={() => addComponent('Image')}><span className="dashboard-tool-icon table-tool"><ImageIcon size={15} /></span><span><b>Image</b><small>Show an HTTPS image</small></span><Plus size={14} /></button>
            {current && uniqueLibraryComponents(libraryComponents, 'dashboard').map((component) => <button key={component.apiName} disabled={!canEditCurrent || previewMode} title={component.description} onClick={() => addCustomComponent(component)}><span className="dashboard-tool-icon custom-tool-icon"><Puzzle size={15} /></span><span><b>{libraryComponentLabel(component)}</b><small>{component.scope === 'platform-system' ? 'Core component' : 'One- component'}</small></span><Plus size={14} /></button>)}
          </div>
        </div>
        {current && <div className="dashboard-sidebar-section dashboard-component-list-section">
          <div className="dashboard-panel-heading"><strong>On this dashboard</strong><span>{current.components.length}</span></div>
          {!current.components.length && <p className="dashboard-sidebar-empty">Add a component to get started.</p>}
          {current.components.map((component, index) => <div className={`dashboard-outline-item ${selectedComponentId === component.id ? 'selected' : ''}`} key={component.id}>
            <button className="dashboard-outline-select" disabled={!canEditCurrent || previewMode} onClick={() => setSelectedComponentId(component.id)}><GripVertical size={14} /><span>{component.title}</span></button>
            <button className="dashboard-outline-action" aria-label={`Move ${component.title} up`} disabled={!canEditCurrent || index === 0 || previewMode} onClick={() => moveComponent(component.id, -1)}><ArrowUp size={13} /></button>
            <button className="dashboard-outline-action" aria-label={`Move ${component.title} down`} disabled={!canEditCurrent || index === current.components.length - 1 || previewMode} onClick={() => moveComponent(component.id, 1)}><ArrowDown size={13} /></button>
            <button className="dashboard-outline-action" aria-label={`Remove ${component.title}`} disabled={!canEditCurrent || previewMode} onClick={() => {
              if (!confirmDestructiveAction('Remove', 'Dashboard component "'+component.title+'"', 'This component will be removed from the current dashboard draft.')) return;
              changeDraft((dashboard) => ({ ...dashboard, components: dashboard.components.filter((item) => item.id !== component.id) }));
              if (selectedComponentId === component.id) setSelectedComponentId('');
            }}><Trash2 size={13} /></button>
          </div>)}
        </div>}
      </aside>}

      <main className="dashboard-builder-canvas">
        {!current || (viewerMode && current.status !== 'Deployed') ? <div className="dashboard-empty-state surface">
          <span className="dashboard-empty-icon"><LayoutDashboard size={25} /></span>
          <h2>{viewerMode ? 'Dashboard unavailable' : 'Build a dashboard'}</h2><p>{viewerMode ? 'This dashboard does not exist or you do not have permission to view it.' : 'Bring metrics, charts, and record tables together in one view.'}</p>
          {!viewerMode && <><button className="btn btn-brand" disabled={!canCreate} onClick={() => setCreating(true)}><Plus size={14} />Create dashboard</button>{!canCreate && <p role="status">Ask an administrator for dashboard creation access in your Profile or Permission Set.</p>}</>}
        </div> : <>
          {previewMode && snapshotsOpen && current.status === 'Deployed' && <section className="dashboard-snapshots surface" aria-label="Dashboard snapshots">
            <div className="dashboard-snapshots-heading"><div><strong>Point-in-time snapshots</strong><p>Snapshots preserve data visible to you when captured. Other dashboard viewers cannot access your saved snapshots.</p></div>
              <button type="button" className="icon-button" aria-label="Close snapshots" onClick={() => setSnapshotsOpen(false)}><X size={14} /></button>
            </div>
            <div className="dashboard-snapshot-create">
              <input aria-label="Snapshot name" maxLength={80} value={snapshotLabel} placeholder="Snapshot name"
                onChange={(event) => setSnapshotLabel(event.target.value)} />
              <button type="button" className="btn btn-brand" disabled={snapshotBusy || dirty || !snapshotLabel.trim()} onClick={() => void createSnapshot()}>
                <Save size={13} />{snapshotBusy ? 'Saving…' : 'Capture'}
              </button>
            </div>
            {dirty && <p className="dashboard-filter-empty">Save dashboard changes before capturing a snapshot.</p>}
            {snapshotError && <div className="dashboard-data-error" role="alert">{snapshotError}</div>}
            {!snapshots.length ? <p className="dashboard-filter-empty">No snapshots saved yet.</p> : <ul className="dashboard-snapshot-list">
              {snapshots.map((snapshot) => <li key={snapshot.id}>
                <button type="button" className={activeSnapshotId === snapshot.id ? 'selected' : ''}
                  onClick={() => setActiveSnapshotId(snapshot.id)}>
                  <strong>{snapshot.label}</strong><small>{new Date(snapshot.createdAt).toLocaleString()}</small>
                </button>
                <button type="button" className="icon-button" aria-label={`Delete snapshot ${snapshot.label}`}
                  disabled={snapshotBusy} onClick={() => void removeSnapshot(snapshot)}><Trash2 size={13} /></button>
              </li>)}
            </ul>}
          </section>}
          {previewMode && subscriptionsOpen && current.status === 'Deployed' && <section className="dashboard-snapshots surface" aria-label="Dashboard subscriptions">
            <div className="dashboard-snapshots-heading"><div><strong>Scheduled email subscriptions</strong><p>Each recipient receives results evaluated with their own record and field access.</p></div>
              <button type="button" className="icon-button" aria-label="Close subscriptions" onClick={() => setSubscriptionsOpen(false)}><X size={14} /></button>
            </div>
            {!canSchedule && <div className="info-callout">The email:send permission is required to manage scheduled delivery.</div>}
            {canSchedule && <button type="button" className="btn btn-brand" disabled={!smtpCredentials.length || !subscriptionUsers.length || dirty}
              title={dirty ? 'Save dashboard changes before scheduling delivery.' : undefined}
              onClick={() => startSubscriptionEdit()}><Plus size={13} />New subscription</button>}
            {!smtpCredentials.length && canSchedule && <p className="dashboard-filter-empty">Configure an SMTP Named Credential in Setup before scheduling email.</p>}
            {subscriptionError && <div className="dashboard-data-error" role="alert">{subscriptionError}</div>}
            {subscriptionDraft && <div className="dashboard-subscription-form">
              <label className="form-label">Subscription name<input className="form-control" maxLength={80} value={subscriptionDraft.label}
                onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, label: event.target.value })} /></label>
              <div className="dashboard-subscription-schedule">
                <label className="form-label">Frequency<select className="form-control" value={subscriptionDraft.frequency}
                  onChange={(event) => setSubscriptionDraft({
                    ...subscriptionDraft,
                    frequency: event.target.value as DashboardSubscriptionInput['frequency'],
                    dayOfWeek: event.target.value === 'Weekly' ? 1 : null
                  })}><option>Daily</option><option>Weekly</option></select></label>
                {subscriptionDraft.frequency === 'Weekly' && <label className="form-label">Day<select className="form-control" value={subscriptionDraft.dayOfWeek ?? 1}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, dayOfWeek: Number(event.target.value) })}>
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => <option value={index} key={day}>{day}</option>)}
                </select></label>}
                <label className="form-label">Local time<input className="form-control" type="time" value={subscriptionDraft.localTime}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, localTime: event.target.value })} /></label>
              </div>
              <label className="form-label">IANA time zone<input className="form-control" maxLength={100} value={subscriptionDraft.timeZone}
                onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, timeZone: event.target.value })} placeholder="Europe/London" /></label>
              <label className="form-label">SMTP credential<select className="form-control" value={subscriptionDraft.namedCredentialId}
                onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, namedCredentialId: event.target.value })}>
                <option value="">Select SMTP credential</option>{smtpCredentials.map((credential) =>
                  <option value={credential.id} key={credential.id}>{credential.label}</option>)}
              </select></label>
              <label className="form-label">From email<input className="form-control" type="email" maxLength={254} value={subscriptionDraft.fromEmail}
                onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, fromEmail: event.target.value })} /></label>
              <label className="checkbox-row"><input type="checkbox" checked={subscriptionDraft.saveSnapshots}
                onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, saveSnapshots: event.target.checked })} />
                Save a private point-in-time snapshot for each recipient (last 30 runs per recipient)</label>
              <fieldset className="dashboard-subscription-recipients"><legend>Recipients</legend>
                {subscriptionUsers.map((user) => <label className="checkbox-row" key={user.id}>
                  <input type="checkbox" checked={subscriptionDraft.recipientUserIds.includes(user.id)}
                    onChange={(event) => setSubscriptionDraft({
                      ...subscriptionDraft,
                      recipientUserIds: event.target.checked
                        ? [...subscriptionDraft.recipientUserIds, user.id]
                        : subscriptionDraft.recipientUserIds.filter((id) => id !== user.id)
                    })} />{user.name} ({user.username})
                </label>)}
              </fieldset>
              {editingSubscriptionId && <label className="checkbox-row"><input type="checkbox" checked={subscriptionDraft.active}
                onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, active: event.target.checked })} />Subscription active</label>}
              <div className="dashboard-subscription-actions">
                <button type="button" className="btn btn-brand" disabled={subscriptionBusy || !subscriptionDraft.label.trim()
                  || !subscriptionDraft.namedCredentialId || !subscriptionDraft.recipientUserIds.length
                  || !subscriptionDraft.fromEmail.trim()} onClick={() => void saveSubscription()}>
                  <Save size={13} />{subscriptionBusy ? 'Saving…' : editingSubscriptionId ? 'Save changes' : 'Create subscription'}
                </button>
                <button type="button" className="btn" disabled={subscriptionBusy} onClick={() => {
                  setSubscriptionDraft(null);
                  setEditingSubscriptionId('');
                }}>Cancel</button>
              </div>
            </div>}
            {!subscriptions.length && <p className="dashboard-filter-empty">No subscriptions configured.</p>}
            {!!subscriptions.length && <ul className="dashboard-subscription-list">
              {subscriptions.map((subscription) => <li key={subscription.id}>
                <div className="dashboard-subscription-summary">
                  <strong>{subscription.label}{subscription.active ? '' : ' · Paused'}</strong>
                  <small>{subscription.frequency}{subscription.frequency === 'Weekly'
                    ? ` · ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][subscription.dayOfWeek ?? 0]}` : ''}
                    {' · '}{subscription.localTime} {subscription.timeZone}</small>
                  <small>Next: {new Date(subscription.nextRunAt).toLocaleString()}</small>
                  <small>Last run: {subscription.lastRunAt ? `${subscription.lastRunStatus} · ${new Date(subscription.lastRunAt).toLocaleString()}` : 'Never'}</small>
                  {subscription.lastRunError && <small className="dashboard-subscription-error">{subscription.lastRunError}</small>}
                </div>
                {canSchedule && <div className="dashboard-subscription-actions">
                  <button type="button" className="btn" disabled={subscriptionBusy} onClick={() => startSubscriptionEdit(subscription)}>Edit</button>
                  <button type="button" className="btn" disabled={subscriptionBusy} onClick={() => void runSubscription(subscription)}>Run now</button>
                  <button type="button" className="icon-button" aria-label={`Delete subscription ${subscription.label}`}
                    disabled={subscriptionBusy} onClick={() => void removeSubscription(subscription)}><Trash2 size={13} /></button>
                </div>}
              </li>)}
            </ul>}
          </section>}
          <section className="dashboard-global-filters surface">
            <div className="dashboard-filter-heading"><strong>{previewMode ? 'Filters' : 'Dashboard filters'}</strong>{!previewMode && <div className="dashboard-filter-actions">
              {current.filters.length > 1 && <label>Match
                <select aria-label="Dashboard filter logic" disabled={!canEditCurrent} value={current.filterLogic ?? 'All'} onChange={(event) => changeDraft((dashboard) => ({ ...dashboard, filterLogic: event.target.value as DashboardMetadata['filterLogic'] }))}>
                  <option value="All">All conditions</option><option value="Any">Any condition</option>
                </select>
              </label>}
              <button className="text-action" disabled={!canEditCurrent} onClick={addFilter}><Plus size={13} />Add Filter</button>
            </div>}</div>
            {!current.filters.length && <span className="dashboard-filter-empty">No filters applied</span>}
            {previewMode && current.filters.length > 0 && <div className="dashboard-view-filters">
              {current.filters.map((filter) => {
                const field = objectFor(filter.objectApiName)?.fields.find((item) => item.apiName === filter.fieldApiName);
                const inputType = dashboardFilterInputType(field);
                const filterValue = dashboardFilterValue(filter, viewFilterValues);
                const multiSelectFilter = dashboardFilterValueType(field) === 'Multi-Select Picklist'
                  && ['Includes', 'Excludes'].includes(filter.operator);
                return <label key={filter.id} className="dashboard-view-filter">
                  <span>{field?.label ?? filter.fieldApiName}</span>
                  {multiSelectFilter
                    ? <select aria-label={`View filter ${field?.label ?? filter.fieldApiName}`} multiple value={filterValue.split(';').filter(Boolean)}
                      onChange={(event) => setViewFilterValues((values) => ({
                        ...values,
                        [filter.id]: Array.from(event.target.selectedOptions, (option) => option.value).join(';')
                      }))}>
                      {filterValueOptions(filter).map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    : ['Picklist', 'Checkbox'].includes(dashboardFilterValueType(field))
                    ? <select aria-label={`View filter ${field?.label ?? filter.fieldApiName}`} value={filterValue}
                      onChange={(event) => setViewFilterValues((values) => ({ ...values, [filter.id]: event.target.value }))}>
                      <option value="">All values</option>
                      {filterValueOptions(filter).map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    : <input aria-label={`View filter ${field?.label ?? filter.fieldApiName}`} type={inputType}
                      step={inputType === 'number' ? 'any' : undefined}
                      value={dashboardFilterInputValue(field, filterValue)}
                      onChange={(event) => setViewFilterValues((values) => ({
                        ...values,
                        [filter.id]: dashboardFilterStoredValue(field, event.target.value)
                      }))}
                      placeholder="All values" />}
                </label>;
              })}
              <button className="text-action dashboard-filter-reset" onClick={() => setViewFilterValues({})}>Reset filters</button>
            </div>}
            {!previewMode && current.filters.map((filter) => {
              const object = objectFor(filter.objectApiName);
              const field = object?.fields.find((item) => item.apiName === filter.fieldApiName);
              const inputType = dashboardFilterInputType(field);
              const multiSelectFilter = dashboardFilterValueType(field) === 'Multi-Select Picklist'
                && ['Includes', 'Excludes'].includes(filter.operator);
              const validOperators = dashboardFilterOperatorsFor(field);
              const displayedOperators = validOperators.includes(filter.operator)
                ? validOperators : [filter.operator, ...validOperators];
              return <div className="dashboard-filter-row" key={filter.id}>
                <select aria-label="Filter object" disabled={!canEditCurrent} value={filter.objectApiName} onChange={(event) => {
                  const nextObject = objectFor(event.target.value);
                  updateFilter(filter.id, {
                    objectApiName: event.target.value,
                    fieldApiName: nextObject?.fields[0]?.apiName ?? '',
                    operator: 'Equals',
                    value: ''
                  });
                }}>{objects.filter((item) => item.apiName !== 'User' && item.settings?.allowReports).map((item) => <option value={item.apiName} key={item.apiName}>{item.label}</option>)}</select>
                <select aria-label="Filter field" disabled={!canEditCurrent} value={filter.fieldApiName} onChange={(event) => updateFilter(filter.id, {
                  fieldApiName: event.target.value,
                  operator: 'Equals',
                  value: ''
                })}>
                  {object?.fields.map((field) => <option value={field.apiName} key={field.apiName}>{field.label}</option>)}
                </select>
                <select aria-label="Filter operator" disabled={!canEditCurrent} value={filter.operator} onChange={(event) => updateFilter(filter.id, { operator: event.target.value as DashboardFilterMetadata['operator'] })}>
                  {displayedOperators.map((operator) => <option key={operator}>{operator}</option>)}
                </select>
                {multiSelectFilter
                  ? <select aria-label="Filter value" disabled={!canEditCurrent} multiple
                    value={filter.value.split(';').filter(Boolean)}
                    onChange={(event) => updateFilter(filter.id, {
                      value: Array.from(event.target.selectedOptions, (option) => option.value).join(';')
                    })}>
                    {filterValueOptions({ ...filter, value: '' }).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  : ['Picklist', 'Checkbox'].includes(dashboardFilterValueType(field))
                  ? <select aria-label="Filter value" disabled={!canEditCurrent || filter.operator === 'Is Null' || filter.operator === 'Is Not Null'}
                    value={filter.value} onChange={(event) => updateFilter(filter.id, { value: event.target.value })}>
                    <option value="">Select a value</option>
                    {filterValueOptions(filter).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  : <input aria-label="Filter value" type={inputType}
                    step={inputType === 'number' ? 'any' : undefined}
                    disabled={!canEditCurrent || filter.operator === 'Is Null' || filter.operator === 'Is Not Null'}
                    maxLength={500} value={dashboardFilterInputValue(field, filter.value)}
                    onChange={(event) => updateFilter(filter.id, {
                      value: dashboardFilterStoredValue(field, event.target.value)
                    })} placeholder="Default value (optional)" />}
                <button className="icon-button" aria-label="Remove filter" disabled={!canEditCurrent} onClick={() => changeDraft((dashboard) => ({ ...dashboard, filters: dashboard.filters.filter((item) => item.id !== filter.id) }))}><X size={14} /></button>
              </div>;
            })}
          </section>
          {recordsError && <div className="dashboard-data-error" role="alert">{recordsError}</div>}
          {reportRunError && <div className="dashboard-data-error" role="alert">{reportRunError}</div>}
          {(recordsLoading || reportsLoading) && <div className="dashboard-loading">Loading dashboard data…</div>}
          {activeSnapshot ? <section className="dashboard-snapshot-view">
            <div className="dashboard-snapshot-view-heading">
              <div><strong>{activeSnapshot.label}</strong><span>Captured {new Date(activeSnapshot.createdAt).toLocaleString()}</span></div>
              <button type="button" className="text-action" onClick={() => setActiveSnapshotId('')}>Return to live dashboard</button>
            </div>
            <div className="dashboard-preview-grid">
              {activeSnapshot.components.map((component) => {
                const chartPalette = chartPaletteFor(component.chartColorPalette);
                return <section className={`dashboard-preview-card surface ${component.type.toLocaleLowerCase().replace(/\s+/g, '-')} dashboard-width-${(component.width ?? (component.type === 'Table' ? 'Full' : 'Half')).toLocaleLowerCase()} dashboard-height-${(component.height ?? 'Medium').toLocaleLowerCase()}`} key={component.componentId}>
                <header><div><h2>{component.title}</h2><p>{component.subtitle || `${component.objectApiName} · Snapshot`}</p></div></header>
                {component.unavailableReason && <p className="dashboard-snapshot-unavailable" role="status">{component.unavailableReason}</p>}
                {component.type === 'Rich Text' && !component.unavailableReason && <iframe
                  className="dashboard-rich-text-frame"
                  title={`Snapshot of ${component.title}`}
                  sandbox=""
                  srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src https: data:; font-src data:; style-src 'unsafe-inline'"></head><body>${component.richTextContent ?? ''}</body></html>`}
                />}
                {component.type === 'Image' && component.imageUrl?.startsWith('https://') && !component.unavailableReason && <img
                  className="dashboard-image-widget" src={component.imageUrl} alt={component.imageAltText ?? ''}
                  loading="lazy" referrerPolicy="no-referrer" />}
                {component.type === 'Custom' && component.customHtml && !component.unavailableReason && <iframe
                  className="dashboard-custom-snapshot"
                  title={`Snapshot of ${component.title}`}
                  sandbox=""
                  srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"></head><body>${component.customHtml ?? ''}</body></html>`}
                />}
                {component.type === 'Metric' && !component.unavailableReason && <div className="dashboard-metric-preview"><strong>{formatValue(component.metricValue)}</strong><span>{component.totalRows.toLocaleString()} matching records at capture time</span></div>}
                {component.type === 'Chart' && !component.unavailableReason && <div className="dashboard-snapshot-chart">
                  <p>{component.chartType} · {component.groupByLabel ?? ''}</p>
                  {component.chartType === 'Gauge' && (() => {
                    const value = component.buckets[0]?.value ?? 0;
                    const minimum = component.gaugeMin ?? 0;
                    const percent = Math.max(0, Math.min(1, (value - minimum) / (component.gaugeMax - minimum)));
                    const angle = Math.PI - percent * Math.PI;
                    const range1End = component.gaugeRange1EndPercent ?? 33;
                    const range2End = component.gaugeRange2EndPercent ?? 67;
                    return <svg className="dashboard-snapshot-gauge" viewBox="0 0 200 125" role="img"                     aria-label={`Snapshot gauge: ${formatChartValue(value, component)} from ${formatChartValue(minimum, component)} to ${formatChartValue(component.gaugeMax, component)}`}>
                      {[{ from: 0, to: range1End, color: '#c23934' }, { from: range1End, to: range2End, color: '#fe9339' }, { from: range2End, to: 100, color: '#2e844a' }]
                        .filter((range) => range.to > range.from)
                        .map((range) => <path key={`${range.from}-${range.to}`} d="M 25 100 A 75 75 0 0 1 175 100" fill="none" stroke={range.color}
                          strokeWidth="18" pathLength="100" strokeDasharray={`${range.to - range.from} 100`} strokeDashoffset={`${-range.from}`} />)}
                      <line x1="100" y1="100" x2={100 + Math.cos(angle) * 61} y2={100 - Math.sin(angle) * 61} stroke="#181818" strokeWidth="3" />
                      {component.showValues && <text x="100" y="121" textAnchor="middle">{formatChartValue(value, component)} / {formatChartValue(minimum, component)}-{formatChartValue(component.gaugeMax, component)}</text>}
                    </svg>;
                  })()}
                  {(component.chartType === 'Pie' || component.chartType === 'Donut') && <div className={`chart-donut dashboard-snapshot-pie legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                    <svg viewBox="0 0 180 180" role="img" aria-label={`Snapshot ${component.chartType} chart`}>
                      {(() => {
                        const positiveTotal = component.buckets.reduce((total, bucket) => total + Math.max(0, bucket.value), 0);
                        let offset = 0;
                        return component.buckets.map((bucket, index) => {
                          const value = Math.max(0, bucket.value);
                          const share = positiveTotal ? value / positiveTotal * 100 : 0;
                          const segment = <circle key={bucket.label} cx="90" cy="90" r="58" fill="none" stroke={chartPalette[index % chartPalette.length]} strokeWidth="28"
                            pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)" />;
                          offset += share;
                          return segment;
                        });
                      })()}
                      {component.chartType === 'Donut' && component.showValues && <circle cx="90" cy="90" r="40" fill="white" />}
                      {component.chartType === 'Donut' && component.showValues && <text x="90" y="94" textAnchor="middle">
                        {formatChartValue(component.buckets.reduce((total, bucket) => total + Math.max(0, bucket.value), 0), component)}
                      </text>}
                    </svg>
                    {component.showLegend && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>{component.buckets.map((bucket, index) =>
                      <li key={bucket.label}><i style={{ backgroundColor: chartPalette[index % chartPalette.length] }} /><span>{bucket.label}</span>
                        {component.showValues && <strong>{formatChartValue(bucket.value, component)}</strong>}</li>)}</ul>}
                  </div>}
                  {(component.chartType === 'Line' || component.chartType === 'Area') && <div className={`dashboard-chart-frame dashboard-snapshot-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                    <svg className="dashboard-snapshot-line" viewBox="0 0 600 230" role="img" aria-label={`Snapshot ${component.chartType} chart`}>
                    {(() => {
                      const domain = chartAxisRange(component.buckets.map((bucket) => bucket.value), component.chartYAxisMinimum, component.chartYAxisMaximum);
                      if (!domain) return <text role="alert" x="300" y="110" textAnchor="middle">Invalid Y-axis bounds</text>;
                      const range = domain.maximum - domain.minimum;
                      const yForValue = (value: number) =>
                        154 - (Math.max(domain.minimum, Math.min(domain.maximum, value)) - domain.minimum) / range * 118;
                      const baseline = yForValue(0);
                      const points = component.buckets.map((bucket, index) => ({
                        x: component.buckets.length === 1 ? 300 : 36 + index * 528 / (component.buckets.length - 1),
                        y: yForValue(bucket.value)
                      }));
                      return <>
                        {chartAxisTicks(domain).map((tick, index) => {
                          const y = 154 - index * 118 / 4;
                          return <g key={index}>
                            {component.showGridlines && <line x1="28" x2="590" y1={y} y2={y} className="chart-grid-line" />}
                            <text x="24" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
                          </g>;
                        })}
                        <line x1="28" x2="590" y1="154" y2="154" className="chart-axis-line" />
                        {component.chartType === 'Area' && <polygon
                          points={`${points[0]?.x ?? 36},${baseline} ${points.map((point) => `${point.x},${point.y}`).join(' ')} ${points[points.length - 1]?.x ?? 564},${baseline}`}
                          fill="#0176d3" fillOpacity="0.18" />}
                        <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#0176d3" strokeWidth="3" />
                        {points.map((point, index) => <g key={component.buckets[index].label}>
                          <circle cx={point.x} cy={point.y} r="4" fill="#0176d3" />
                          <text x={point.x} y="185" textAnchor="middle">{component.buckets[index].label.slice(0, 12)}</text>
                          {component.showValues && <text
                            x={point.x} y={component.chartDataLabelPosition === 'Inside' ? Math.min(205, point.y + 14) : Math.max(15, point.y - 9)}
                            textAnchor="middle">{formatChartValue(component.buckets[index].value, component)}</text>}
                        </g>)}
                      </>;
                    })()}
                    {component.xAxisTitle && <text x="316" y="226" textAnchor="middle">{component.xAxisTitle}</text>}
                    {component.yAxisTitle && <text transform="translate(14 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
                    </svg>
                    {component.showLegend && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                      <li><i style={{ backgroundColor: '#0176d3' }} /><span>{component.title}</span></li>
                    </ul>}
                  </div>}
                  {component.chartType === 'Scatter' && <div className={`dashboard-chart-frame dashboard-snapshot-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                    <svg className="dashboard-snapshot-line" viewBox="0 0 600 230" role="img" aria-label="Snapshot scatter chart">
                    {(() => {
                      const points = component.buckets.map((bucket) => ({
                        bucket,
                        xValue: Number(bucket.label),
                        yValue: bucket.value
                      })).filter((point) => Number.isFinite(point.xValue));
                      const xDomain = chartAxisRange(points.map((point) => point.xValue), component.chartXAxisMinimum, component.chartXAxisMaximum);
                      const yDomain = chartAxisRange(points.map((point) => point.yValue), component.chartYAxisMinimum, component.chartYAxisMaximum);
                      if (!xDomain || !yDomain) return <text role="alert" x="300" y="110" textAnchor="middle">Invalid axis bounds</text>;
                      const xRange = xDomain.maximum - xDomain.minimum;
                      const yRange = yDomain.maximum - yDomain.minimum;
                      return <>
                        {chartAxisTicks(yDomain).map((tick, index) => {
                          const y = 174 - index * 142 / 4;
                          return <g key={`y-${index}`}>
                            {component.showGridlines && <line x1="68" x2="584" y1={y} y2={y} className="chart-grid-line" />}
                            <text x="62" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
                          </g>;
                        })}
                        {chartAxisTicks(xDomain).map((tick, index) => {
                          const x = 68 + index * 516 / 4;
                          return <g key={`x-${index}`}>
                            {component.showGridlines && <line x1={x} x2={x} y1="32" y2="174" className="chart-grid-line" />}
                            <text x={x} y="190" textAnchor="middle">{formatChartValue(tick, component)}</text>
                          </g>;
                        })}
                        <line x1="68" x2="584" y1="174" y2="174" className="chart-axis-line" />
                        <line x1="68" x2="68" y1="32" y2="174" className="chart-axis-line" />
                        {points.map(({ bucket, xValue, yValue }, index) => {
                          const x = 68 + (Math.max(xDomain.minimum, Math.min(xDomain.maximum, xValue)) - xDomain.minimum) / xRange * 516;
                          const y = 174 - (Math.max(yDomain.minimum, Math.min(yDomain.maximum, yValue)) - yDomain.minimum) / yRange * 142;
                          return <g key={bucket.label}>
                            <circle cx={x} cy={y} r="5" fill={chartPalette[index % chartPalette.length]} />
                            {component.showValues && <text
                              x={x} y={component.chartDataLabelPosition === 'Inside' ? Math.min(214, y + 14) : Math.max(14, y - 8)}
                              textAnchor="middle">{formatChartValue(yValue, component)}</text>}
                          </g>;
                        })}
                        {component.xAxisTitle && <text x="316" y="226" textAnchor="middle">{component.xAxisTitle}</text>}
                        {component.yAxisTitle && <text transform="translate(14 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
                      </>;
                    })()}
                    </svg>
                    {component.showLegend && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                      <li><i style={{ backgroundColor: '#0176d3' }} /><span>{component.title}</span></li>
                    </ul>}
                  </div>}
                  {component.chartType === 'Column' && <div className={`dashboard-chart-frame dashboard-snapshot-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                    <svg className="dashboard-snapshot-line" viewBox="0 0 600 220" role="img" aria-label="Snapshot column chart">
                      {(() => {
                        const domain = chartAxisRange(component.buckets.map((bucket) => bucket.value), component.chartYAxisMinimum, component.chartYAxisMaximum);
                        if (!domain) return <text role="alert" x="300" y="110" textAnchor="middle">Invalid Y-axis bounds</text>;
                        const yForValue = (value: number) => 174 - (Math.max(domain.minimum, Math.min(domain.maximum, value)) - domain.minimum) / (domain.maximum - domain.minimum) * 130;
                        return <>
                          {chartAxisTicks(domain).map((tick, index) => {
                            const y = yForValue(tick);
                            return <g key={index}>
                              {component.showGridlines && <line x1="42" x2="584" y1={y} y2={y} className="chart-grid-line" />}
                              <text x="38" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
                            </g>;
                          })}
                          <line x1="42" x2="584" y1={yForValue(0)} y2={yForValue(0)} className="chart-axis-line" />
                          {component.buckets.map((bucket, index) => {
                            const step = 520 / component.buckets.length;
                            const x = 50 + index * step;
                            const width = Math.max(1, Math.min(34, step - 10));
                            const valueY = yForValue(bucket.value);
                            const baselineY = yForValue(0);
                            const y = Math.min(valueY, baselineY);
                            return <g key={bucket.label}>
                              <rect x={x} y={y} width={width} height={Math.max(1, Math.abs(valueY - baselineY))} rx="3"
                                fill={chartPalette[index % chartPalette.length]} />
                              <text x={x + width / 2} y="194" textAnchor="middle">{bucket.label.slice(0, 9)}</text>
                              {component.showValues && <text className={component.chartDataLabelPosition === 'Inside' ? 'chart-data-label-inside' : ''}
                                x={x + width / 2} y={component.chartDataLabelPosition === 'Inside' ? y + 13 : Math.max(12, y - 4)}
                                textAnchor="middle">{formatChartValue(bucket.value, component)}</text>}
                            </g>;
                          })}
                          {component.xAxisTitle && <text x="316" y="216" textAnchor="middle">{component.xAxisTitle}</text>}
                          {component.yAxisTitle && <text transform="translate(12 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
                        </>;
                      })()}
                    </svg>
                    {component.showLegend && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                      {component.buckets.map((bucket, index) => <li key={bucket.label}><i style={{ backgroundColor: chartPalette[index % chartPalette.length] }} />
                        <span>{bucket.label}</span>{component.showValues && <strong>{formatChartValue(bucket.value, component)}</strong>}</li>)}
                    </ul>}
                  </div>}
                  {(component.chartType === 'Stacked Column' || component.chartType === '100% Stacked Column') && <div className={`dashboard-chart-frame dashboard-snapshot-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                    <svg className="dashboard-snapshot-line" viewBox="0 0 600 220" role="img" aria-label="Snapshot stacked column chart">
                    {(() => {
                      const percentStacked = component.chartType === '100% Stacked Column';
                      const domain = percentStacked ? { minimum: 0, maximum: 100 }
                        : chartAxisRange(component.buckets.map((bucket) => bucket.value), component.chartYAxisMinimum, component.chartYAxisMaximum);
                      if (!domain) return <text role="alert" x="300" y="110" textAnchor="middle">Invalid Y-axis bounds</text>;
                      const yForValue = (value: number) => 174 - (Math.max(domain.minimum, Math.min(domain.maximum, value)) - domain.minimum) / (domain.maximum - domain.minimum) * 130;
                      return <>
                        {chartAxisTicks(domain).map((tick, tickIndex) => {
                          const y = yForValue(tick);
                          return <g key={`tick-${tickIndex}`}>
                            {component.showGridlines && <line x1="42" x2="584" y1={y} y2={y} className="chart-grid-line" />}
                            <text x="38" y={y + 3} textAnchor="end">{formatChartValue(tick, component)}</text>
                          </g>;
                        })}
                        <line x1="42" x2="584" y1={yForValue(0)} y2={yForValue(0)} className="chart-axis-line" />
                        {component.buckets.map((bucket, index) => {
                        let y = yForValue(percentStacked ? 100 : 0);
                        const stackStartY = y;
                        let stackedValue = 0;
                        const x = 50 + index * (520 / component.buckets.length);
                        const columnWidth = Math.max(1, Math.min(34, 520 / component.buckets.length - 10));
                        const bars = Object.entries(bucket.series ?? {}).map(([series, value], seriesIndex) => {
                          stackedValue += percentStacked ? value / (bucket.value || 1) * 100 : value;
                          const nextY = yForValue((percentStacked ? 100 : 0) + stackedValue);
                          const rectY = Math.min(y, nextY);
                          const height = Math.abs(y - nextY);
                          y = nextY;
                          return <rect key={series} x={x} y={rectY} width={columnWidth} height={height}
                            fill={chartPalette[seriesIndex % chartPalette.length]} />;
                        });
                        return <g key={bucket.label}>
                          {bars}
                          <text x={x + columnWidth / 2} y="194" textAnchor="middle">{bucket.label.slice(0, 9)}</text>
                          {component.showValues && <text className={component.chartDataLabelPosition === 'Inside' ? 'chart-data-label-inside' : ''}
                            x={x + columnWidth / 2} y={component.chartDataLabelPosition === 'Inside' ? (stackStartY + y) / 2 : Math.max(12, y - 4)} textAnchor="middle">
                            {percentStacked ? '100%' : formatChartValue(bucket.value, component)}
                          </text>}
                        </g>;
                        })}
                        {component.xAxisTitle && <text x="316" y="216" textAnchor="middle">{component.xAxisTitle}</text>}
                        {component.yAxisTitle && <text transform="translate(12 108) rotate(-90)" textAnchor="middle">{component.yAxisTitle}</text>}
                      </>;
                    })()}
                    </svg>
                    {component.showLegend && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                      {[...new Set(component.buckets.flatMap((bucket) => Object.keys(bucket.series ?? {})))].map((series, index) =>
                        <li key={series}><i style={{ backgroundColor: chartPalette[index % chartPalette.length] }} /><span>{series}</span></li>)}
                    </ul>}
                  </div>}
                  {['Bar', 'Horizontal Bar', 'Stacked Bar', '100% Stacked Bar'].includes(component.chartType ?? '') && (() => {
                    const stacked = component.chartType === 'Stacked Bar' || component.chartType === '100% Stacked Bar';
                    const percentStacked = component.chartType === '100% Stacked Bar';
                    const domain = percentStacked ? { minimum: 0, maximum: 100 }
                      : chartAxisRange(component.buckets.map((bucket) => bucket.value), component.chartXAxisMinimum, component.chartXAxisMaximum);
                    if (!domain) return <p className="dashboard-data-error" role="alert">Invalid X-axis bounds</p>;
                    const xForValue = (value: number) => 156
                      + (Math.max(domain.minimum, Math.min(domain.maximum, value)) - domain.minimum)
                      / (domain.maximum - domain.minimum) * 390;
                    const chartHeight = Math.max(190, component.buckets.length * 30 + 55);
                    const seriesNames = [...new Set(component.buckets.flatMap((bucket) => Object.keys(bucket.series ?? {})))];
                    return <div className={`dashboard-chart-frame dashboard-snapshot-chart-frame legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                      <svg className="dashboard-snapshot-line" viewBox={`0 0 600 ${chartHeight}`} role="img" aria-label={`Snapshot ${component.chartType} chart`}>
                        {chartAxisTicks(domain).map((tick, index) => {
                          const x = xForValue(tick);
                          return <g key={`tick-${index}`}>
                            {component.showGridlines && <line x1={x} x2={x} y1="8" y2={component.buckets.length * 30 + 8} className="chart-grid-line" />}
                            <text x={x} y={component.buckets.length * 30 + 22} textAnchor="middle">{formatChartValue(tick, component)}</text>
                          </g>;
                        })}
                        <line x1={xForValue(0)} x2={xForValue(0)} y1="8" y2={component.buckets.length * 30 + 8} className="chart-axis-line" />
                        {component.buckets.map((bucket, index) => {
                          const y = index * 30 + 14;
                          const baseline = xForValue(0);
                          let end = baseline;
                          const bars = stacked
                            ? Object.entries(bucket.series ?? {}).map(([series, value], seriesIndex) => {
                              const segment = percentStacked ? value / (bucket.value || 1) * 100 : value;
                              const next = xForValue(segment);
                              const width = Math.max(0, next - xForValue(0));
                              const bar = <rect key={series} x={end} y={y - 7} width={width} height="14" rx="2"
                                fill={chartPalette[seriesIndex % chartPalette.length]} />;
                              end += width;
                              return bar;
                            })
                            : [<rect key={bucket.label} x={Math.min(baseline, xForValue(bucket.value))} y={y - 7}
                              width={Math.max(1, Math.abs(xForValue(bucket.value) - baseline))} height="14" rx="2"
                              fill={chartPalette[index % chartPalette.length]} />];
                          const valueLabel = percentStacked ? '100%' : formatChartValue(bucket.value, component);
                          const labelInside = component.chartDataLabelPosition === 'Inside';
                          const labelX = labelInside
                            ? bucket.value >= 0 ? Math.max(160, end - 5) : xForValue(bucket.value) + 5
                            : bucket.value >= 0 ? Math.min(580, end + 5) : Math.max(154, xForValue(bucket.value) - 5);
                          return <g key={bucket.label}>
                            <text x="148" y={y + 4} textAnchor="end">{bucket.label.slice(0, 20)}</text>
                            {bars}
                            {component.showValues && <text className={labelInside ? 'chart-data-label-inside' : ''}
                              x={labelX} y={y + 4} textAnchor={labelInside
                                ? bucket.value >= 0 ? 'end' : 'start' : bucket.value >= 0 ? 'start' : 'end'}>{valueLabel}</text>}
                          </g>;
                        })}
                        {component.xAxisTitle && <text x="350" y={chartHeight - 7} textAnchor="middle">{component.xAxisTitle}</text>}
                        {component.yAxisTitle && <text transform={`translate(12 ${component.buckets.length * 15}) rotate(-90)`} textAnchor="middle">{component.yAxisTitle}</text>}
                      </svg>
                      {component.showLegend && <ul className={`dashboard-chart-legend legend-${(component.legendPosition ?? 'Bottom').toLocaleLowerCase()}`}>
                        {(stacked ? seriesNames : component.buckets.map((bucket) => bucket.label)).map((label, index) =>
                          <li key={label}><i style={{ backgroundColor: chartPalette[index % chartPalette.length] }} /><span>{label}</span>
                            {component.showValues && !stacked && <strong>{formatChartValue(component.buckets[index].value, component)}</strong>}</li>)}
                      </ul>}
                    </div>;
                  })()}
                </div>}
                {component.type === 'Table' && !component.unavailableReason && <div className="dashboard-data-table-wrap"><table className="dashboard-data-table">
                  <thead><tr>{component.columns.map((column) => <th key={column.apiName}>{column.label}</th>)}</tr></thead>
                  <tbody>{component.rows.map((row, index) => <tr key={String(row.Id ?? index)}>
                    {component.columns.map((column) => <td key={column.apiName}>{formatValue(row[column.apiName])}</td>)}
                  </tr>)}</tbody>
                </table><p className="dashboard-snapshot-table-count">First {component.rows.length} of {component.totalRows.toLocaleString()} matching records captured.</p></div>}
                {component.footer && <p className="dashboard-widget-footer">{component.footer}</p>}
                </section>;
              })}
            </div>
          </section> : !current.components.length ? <div className="dashboard-canvas-empty">
            <h2>This dashboard is empty</h2><p>Add a metric, chart, table, rich-text, image, or registered custom component from the Components panel.</p>
            {!previewMode && <div><button className="btn" onClick={() => addComponent('Metric')}><Plus size={14} />Add a metric</button><button className="btn" onClick={() => addComponent('Chart')}><Plus size={14} />Add a chart</button></div>}
          </div> : <div className="dashboard-preview-grid">
            {current.components.map((component) => <section className={`dashboard-preview-card surface ${component.type.toLocaleLowerCase().replace(/\s+/g, '-')} dashboard-width-${(component.width ?? (component.type === 'Table' ? 'Full' : 'Half')).toLocaleLowerCase()} dashboard-height-${(component.height ?? 'Medium').toLocaleLowerCase()} ${selectedComponentId === component.id && !previewMode ? 'active' : ''}`} key={component.id}
              draggable={!previewMode && canEditCurrent}
              onDragStart={(event) => { event.dataTransfer.setData('text/plain', component.id); setDraggedComponentId(component.id); }}
              onDragOver={(event) => { if (draggedComponentId) event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedComponentId; moveComponentBefore(sourceId, component.id); setDraggedComponentId(''); }}
              onDragEnd={() => setDraggedComponentId('')}
              onClick={() => { if (!previewMode) setSelectedComponentId(component.id); }}>
              <header><div><h2>{displayMentionText(component, component.title)}</h2><p>{(component.subtitle && displayMentionText(component, component.subtitle)) || `${['Metric', 'Chart', 'Table'].includes(component.type) ? objectFor(component.objectApiName)?.label ?? component.objectApiName : 'Content'} · ${component.type}`}</p></div>
                {previewMode && component.type === 'Table' && <button className="btn btn-small dashboard-export-button" disabled={Boolean(exportingComponentId)} onClick={(event) => { event.stopPropagation(); void exportTable(component); }}><Download size={13} />{exportingComponentId === component.id ? 'Exporting…' : 'Export CSV'}</button>}
                {!previewMode && <button className="icon-button" aria-label={`Select ${component.title}`}><GripVertical size={15} /></button>}
              </header>
              {!recordsError && renderComponent(component)}
              {component.footer && <p className="dashboard-widget-footer">{displayMentionText(component, component.footer)}</p>}
              {!previewMode && canEditCurrent && <button type="button" className="dashboard-resize-handle"
                aria-label={`Resize ${component.title}`} title="Drag to resize; use arrow keys to adjust size"
                onPointerDown={(event) => startDashboardResize(event, component)}
                onPointerMove={updateDashboardResize}
                onPointerUp={(event) => { dashboardResizeStart.current = null; event.currentTarget.releasePointerCapture(event.pointerId); event.stopPropagation(); }}
                onPointerCancel={() => { dashboardResizeStart.current = null; }}
                onKeyDown={(event) => resizeDashboardWithKeyboard(event, component)}
                onClick={(event) => event.stopPropagation()}>
                <GripVertical size={15} />
              </button>}
            </section>)}
          </div>}
        </>}
      </main>

      {!previewMode && current && <aside className="dashboard-properties" id="md-dashboard-inspector">
        <div className="dashboard-panel-heading"><strong>{selected ? 'Component Properties' : 'Dashboard Properties'}</strong></div>
        {selected ? <>
          <label className="form-label" htmlFor="dashboard-component-title">Title</label>
          <SmartFieldInput id="dashboard-component-title" disabled={!canEditCurrent} maxLength={80} value={selected.title} objects={objects} primaryObjectApiName={selected.objectApiName} onChange={next => updateComponent(selected.id, { title: next })} />
          <label className="form-label" htmlFor="dashboard-component-subtitle">Subtitle</label>
          <SmartFieldInput id="dashboard-component-subtitle" disabled={!canEditCurrent} maxLength={250} value={selected.subtitle ?? ''} objects={objects} primaryObjectApiName={selected.objectApiName} onChange={next => updateComponent(selected.id, { subtitle: next })} />
          <label className="form-label" htmlFor="dashboard-component-footer">Footer</label>
          <SmartFieldInput id="dashboard-component-footer" disabled={!canEditCurrent} maxLength={250} value={selected.footer ?? ''} objects={objects} primaryObjectApiName={selected.objectApiName} onChange={next => updateComponent(selected.id, { footer: next })} />
          <label className="form-label" htmlFor="dashboard-component-width">Width</label>
          <select id="dashboard-component-width" className="form-control" disabled={!canEditCurrent} value={selected.width ?? (selected.type === 'Table' ? 'Full' : 'Half')} onChange={(event) => updateComponent(selected.id, { width: event.target.value as DashboardComponentMetadata['width'] })}>
            <option>Quarter</option><option>Half</option><option>ThreeQuarter</option><option>Full</option>
          </select>
          <label className="form-label" htmlFor="dashboard-component-height">Height</label>
          <select id="dashboard-component-height" className="form-control" disabled={!canEditCurrent} value={selected.height ?? 'Medium'} onChange={(event) => updateComponent(selected.id, { height: event.target.value as DashboardComponentMetadata['height'] })}>
            <option>Short</option><option>Medium</option><option>Tall</option>
          </select>
          {['Metric', 'Chart', 'Table'].includes(selected.type) && <>
            <label className="form-label" htmlFor="dashboard-component-report">Report source</label>
            <select id="dashboard-component-report" className="form-control" disabled={!canEditCurrent} value={selected.reportApiName ?? ''} onChange={(event) => {
              const previousReport = reports.find((item) => item.apiName === selected.reportApiName);
              const report = reports.find((item) => item.apiName === event.target.value);
              const titleUpdate = sourceReportTitleUpdate(
                selected.title,
                defaultComponentTitles[selected.type],
                previousReport?.label,
                report?.label
              );
              if (!report) {
                updateComponent(selected.id, {
                  reportApiName: undefined,
                  ...(titleUpdate !== undefined ? { title: titleUpdate } : {})
                });
                return;
              }
              const object = objectFor(report.objectApiName);
              const reportNumericField = report.fieldApiNames.find((apiName) => numericFields(object).some((field) => field.apiName === apiName));
              updateComponent(selected.id, {
                reportApiName: report.apiName,
                ...(titleUpdate !== undefined ? { title: titleUpdate } : {}),
                objectApiName: report.objectApiName,
                groupByFieldApiName: ['Gauge', 'Scatter'].includes(selected.chartType) ? null : report.groupByFieldApiNames[0] ?? null,
                seriesFieldApiName: report.groupByFieldApiNames[1] ?? null,
                xAxisFieldApiName: report.groupByFieldApiNames.find((apiName) => numericFields(object).some((field) => field.apiName === apiName)) ?? null,
                measureFieldApiName: reportNumericField ?? null,
                displayFieldApiNames: [...report.fieldApiNames]
              });
            }}>
              <option value="">Direct object records</option>
              {reports.map((report) => <option key={report.apiName} value={report.apiName}>{report.label}</option>)}
            </select>
          </>}
          {selected.type !== 'Custom' && <>
            <label className="form-label" htmlFor="dashboard-component-type">Display as</label>
            <select id="dashboard-component-type" className="form-control" disabled={!canEditCurrent} value={selected.type} onChange={(event) => {
              const type = event.target.value as ComponentType;
              updateComponent(selected.id, {
                type,
                ...(['Rich Text', 'Image'].includes(type) ? { reportApiName: undefined } : {}),
                ...(type === 'Rich Text' ? { imageUrl: '' } : {}),
                ...(type === 'Image' ? { richTextContent: '' } : {})
              });
            }}>
              <option>Metric</option><option>Chart</option><option>Table</option><option>Rich Text</option><option>Image</option>
            </select>
          </>}
          {selected.type === 'Rich Text' && <>
            <span className="form-label">Rich text content</span>
            <div className="dashboard-rich-text-toolbar" role="toolbar" aria-label="Rich text formatting">
              <button type="button" className="btn btn-small" disabled={!canEditCurrent} onClick={() => wrapRichTextSelection('<strong>', '</strong>')}><b>B</b></button>
              <button type="button" className="btn btn-small" disabled={!canEditCurrent} onClick={() => wrapRichTextSelection('<em>', '</em>')}><i>I</i></button>
              <button type="button" className="btn btn-small" disabled={!canEditCurrent} onClick={() => wrapRichTextSelection('<h2>', '</h2>')}>Heading</button>
              <button type="button" className="btn btn-small" disabled={!canEditCurrent} onClick={() => wrapRichTextSelection('<ul><li>', '</li></ul>')}>List</button>
            </div>
            <SmartFieldInput multiline rows={6} ariaLabel="Rich text HTML content" textareaRef={richTextEditorRef} objects={objects} primaryObjectApiName={selected.objectApiName} disabled={!canEditCurrent} maxLength={20_000} value={selected.richTextContent ?? ''} onChange={next => updateComponent(selected.id, { richTextContent: next })} placeholder="Add formatted text using safe HTML." />
            <small>Basic formatting is supported. Scripts, forms, and embedded content are removed when saved.</small>
          </>}
          {selected.type === 'Image' && <>
            <label className="form-label" htmlFor="dashboard-image-url">Image URL</label>
            <SmartFieldInput id="dashboard-image-url" kind="image" objects={objects} primaryObjectApiName={selected.objectApiName} disabled={!canEditCurrent} maxLength={2048} value={selected.imageUrl ?? ''} onChange={next => updateComponent(selected.id, { imageUrl: next })} placeholder="https://example.com/image.png" />
            <label className="form-label" htmlFor="dashboard-image-alt">Alternative text</label>
            <input id="dashboard-image-alt" className="form-control" maxLength={500}
              disabled={!canEditCurrent} value={selected.imageAltText ?? ''}
              onChange={(event) => updateComponent(selected.id, { imageAltText: event.target.value })}
              placeholder="Describe the image" />
          </>}
          {selected.type === 'Custom' && <>
            <PageComponentStyleEditor
              properties={selected.properties ?? {}}
              disabled={!canEditCurrent}
              onChange={(properties) => updateComponent(selected.id, { properties })}
            />
            <CustomComponentPropertyEditor definitions={libraryComponents.find(component => component.apiName === selected.customComponentApiName && component.status !== 'Draft')?.propertyDefinitions} properties={selected.properties ?? {}}
              objects={objects} primaryObjectApiName={selected.objectApiName}
              disabled={!canEditCurrent}
              onChange={(properties) => updateComponent(selected.id, { properties })}
            />
          </>}
          {['Metric', 'Chart', 'Table'].includes(selected.type) && <>
            <label className="form-label" htmlFor="dashboard-component-object">{selected.reportApiName ? 'Report object' : 'Source object'}</label>
            <select id="dashboard-component-object" className="form-control" disabled={!canEditCurrent || Boolean(selected.reportApiName)} value={selected.objectApiName} onChange={(event) => {
            const object = objectFor(event.target.value);
            const firstField = object?.fields[0]?.apiName ?? '';
            const firstNumeric = numericFields(object)[0]?.apiName ?? null;
            updateComponent(selected.id, {
              objectApiName: event.target.value,
              groupByFieldApiName: firstField || null,
              seriesFieldApiName: null,
              measureFieldApiName: firstNumeric,
              displayFieldApiNames: firstField ? [firstField] : []
            });
            }}>{objects.filter((object) => object.apiName !== 'User' && object.settings?.allowReports).map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select>
          </>}
          {(selected.type === 'Metric' || selected.type === 'Chart') && <>
            <label className="form-label" htmlFor="dashboard-aggregation">Aggregation</label>
            <select id="dashboard-aggregation" className="form-control" disabled={!canEditCurrent} value={selected.aggregation} onChange={(event) => updateComponent(selected.id, { aggregation: event.target.value as Aggregation })}>
              <option>Count</option><option>Sum</option><option>Average</option><option>Minimum</option><option>Maximum</option>
            </select>
            {selected.aggregation !== 'Count' && <><label className="form-label" htmlFor="dashboard-measure">Measure field</label>
              <select id="dashboard-measure" className="form-control" disabled={!canEditCurrent} value={selected.measureFieldApiName ?? ''} onChange={(event) => updateComponent(selected.id, { measureFieldApiName: event.target.value || null })}>
                <option value="">Select a field</option>{numericFields(objectFor(selected.objectApiName)).filter((field) => fieldsForComponent(selected).some((available) => available.apiName === field.apiName)).map((field) => <option value={field.apiName} key={field.apiName}>{field.label}</option>)}
              </select></>}
          </>}
          {selected.type === 'Chart' && <>
            <label className="form-label" htmlFor="dashboard-chart-type">Chart type</label>
            <select id="dashboard-chart-type" className="form-control" disabled={!canEditCurrent} value={selected.chartType} onChange={(event) => {
              const chartType = event.target.value as DashboardComponentMetadata['chartType'];
              const groupByFieldApiName = ['Gauge', 'Scatter'].includes(chartType)
                ? null
                : selected.groupByFieldApiName ?? groupFieldsForComponent(selected)[0]?.apiName ?? null;
              const stacked = ['Stacked Bar', 'Stacked Column', '100% Stacked Bar', '100% Stacked Column'].includes(chartType);
              updateComponent(selected.id, {
                chartType,
                groupByFieldApiName,
                xAxisFieldApiName: chartType === 'Scatter'
                  ? selected.xAxisFieldApiName ?? numericFields(objectFor(selected.objectApiName))
                    .find((field) => groupFieldsForComponent(selected).some((groupField) => groupField.apiName === field.apiName))?.apiName ?? null
                  : selected.xAxisFieldApiName,
                seriesFieldApiName: stacked
                  ? selected.seriesFieldApiName !== groupByFieldApiName
                    ? selected.seriesFieldApiName
                    : groupFieldsForComponent(selected).find((field) => field.apiName !== groupByFieldApiName)?.apiName ?? null
                  : null
              });
            }}>
              <option>Bar</option><option>Column</option><option>Horizontal Bar</option>
              <option>Stacked Bar</option><option>Stacked Column</option><option>100% Stacked Bar</option><option>100% Stacked Column</option>
              <option>Line</option><option>Area</option><option>Scatter</option><option>Donut</option><option>Pie</option><option>Funnel</option><option>Gauge</option>
            </select>
            {selected.chartType === 'Scatter' && <>
              <label className="form-label" htmlFor="dashboard-x-axis-field">X-axis field</label>
              <select id="dashboard-x-axis-field" className="form-control" disabled={!canEditCurrent} value={selected.xAxisFieldApiName ?? ''}
                onChange={(event) => updateComponent(selected.id, { xAxisFieldApiName: event.target.value || null })}>
                <option value="">Select numeric field</option>
                {numericFields(objectFor(selected.objectApiName)).filter((field) =>
                  groupFieldsForComponent(selected).some((groupField) => groupField.apiName === field.apiName))
                  .map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
              </select>
            </>}
            {!['Gauge', 'Scatter'].includes(selected.chartType) && <>
              <label className="form-label" htmlFor="dashboard-group-by">Group by</label>
              <select id="dashboard-group-by" className="form-control" disabled={!canEditCurrent} value={selected.groupByFieldApiName ?? ''} onChange={(event) => {
                const groupByFieldApiName = event.target.value || null;
                updateComponent(selected.id, {
                  groupByFieldApiName,
                  seriesFieldApiName: ['Stacked Bar', 'Stacked Column', '100% Stacked Bar', '100% Stacked Column'].includes(selected.chartType)
                    && selected.seriesFieldApiName === groupByFieldApiName
                    ? groupFieldsForComponent(selected).find((field) => field.apiName !== groupByFieldApiName)?.apiName ?? null
                    : selected.seriesFieldApiName
                });
              }}>
                <option value="">Select a field</option>{groupFieldsForComponent(selected).map((field) => <option value={field.apiName} key={field.apiName}>{field.label}</option>)}
              </select>
            </>}
            {['Stacked Bar', 'Stacked Column', '100% Stacked Bar', '100% Stacked Column'].includes(selected.chartType) && <>
              <label className="form-label" htmlFor="dashboard-series-field">Stack series</label>
              <select id="dashboard-series-field" className="form-control" disabled={!canEditCurrent} value={selected.seriesFieldApiName ?? ''} onChange={(event) => updateComponent(selected.id, { seriesFieldApiName: event.target.value || null })}>
                <option value="">Select a series field</option>{groupFieldsForComponent(selected).filter((field) => field.apiName !== selected.groupByFieldApiName).map((field) => <option value={field.apiName} key={field.apiName}>{field.label}</option>)}
              </select>
            </>}
            {selected.chartType === 'Gauge' && <>
              <label className="form-label" htmlFor="dashboard-gauge-min">Gauge minimum</label>
              <input id="dashboard-gauge-min" className="form-control" type="number" step="any" disabled={!canEditCurrent}
                value={selected.gaugeMin ?? 0} onChange={(event) => updateComponent(selected.id, { gaugeMin: Number(event.target.value) })} />
              <label className="form-label" htmlFor="dashboard-gauge-max">Gauge maximum</label>
              <input id="dashboard-gauge-max" className="form-control" type="number" step="any" disabled={!canEditCurrent}
                value={selected.gaugeMax ?? 100} onChange={(event) => updateComponent(selected.id, { gaugeMax: Number(event.target.value) })} />
              <label className="form-label" htmlFor="dashboard-gauge-range-one">First range boundary (%)</label>
              <input id="dashboard-gauge-range-one" className="form-control" type="number" min="0" max="100" step="any" disabled={!canEditCurrent}
                value={selected.gaugeRange1EndPercent ?? 33} onChange={(event) => updateComponent(selected.id, { gaugeRange1EndPercent: Number(event.target.value) })} />
              <label className="form-label" htmlFor="dashboard-gauge-range-two">Second range boundary (%)</label>
              <input id="dashboard-gauge-range-two" className="form-control" type="number" min="0" max="100" step="any" disabled={!canEditCurrent}
                value={selected.gaugeRange2EndPercent ?? 67} onChange={(event) => updateComponent(selected.id, { gaugeRange2EndPercent: Number(event.target.value) })} />
            </>}
            <label className="checkbox-row property-check"><input type="checkbox" disabled={!canEditCurrent} checked={selected.showLegend !== false}
              onChange={(event) => updateComponent(selected.id, { showLegend: event.target.checked })} />Show legend</label>
            <label className="checkbox-row property-check"><input type="checkbox" disabled={!canEditCurrent} checked={selected.showValues !== false}
              onChange={(event) => updateComponent(selected.id, { showValues: event.target.checked })} />Show values</label>
            {['Bar', 'Column', 'Horizontal Bar', 'Stacked Bar', 'Stacked Column', '100% Stacked Bar', '100% Stacked Column', 'Line', 'Area', 'Scatter'].includes(selected.chartType) && <>
              <label className="form-label" htmlFor="dashboard-data-label-position">Data label position</label>
              <select id="dashboard-data-label-position" className="form-control" disabled={!canEditCurrent || selected.showValues === false}
                value={selected.chartDataLabelPosition ?? 'Auto'}
                onChange={(event) => updateComponent(selected.id, { chartDataLabelPosition: event.target.value as DashboardComponentMetadata['chartDataLabelPosition'] })}>
                <option value="Auto">Automatic</option><option value="Inside">Inside</option><option value="Outside">Outside</option>
              </select>
            </>}
            {['Bar', 'Column', 'Horizontal Bar', 'Stacked Bar', 'Stacked Column', '100% Stacked Bar', '100% Stacked Column', 'Line', 'Area', 'Scatter'].includes(selected.chartType) && <>
              <label className="form-label" htmlFor="dashboard-x-axis-title">X-axis title</label>
              <input id="dashboard-x-axis-title" className="form-control" maxLength={80} disabled={!canEditCurrent}
                value={selected.xAxisTitle ?? ''} onChange={(event) => updateComponent(selected.id, { xAxisTitle: event.target.value })} />
              <label className="form-label" htmlFor="dashboard-y-axis-title">Y-axis title</label>
              <input id="dashboard-y-axis-title" className="form-control" maxLength={80} disabled={!canEditCurrent}
                value={selected.yAxisTitle ?? ''} onChange={(event) => updateComponent(selected.id, { yAxisTitle: event.target.value })} />
              {['Scatter', 'Bar', 'Horizontal Bar', 'Stacked Bar'].includes(selected.chartType) && <div className="dashboard-axis-bounds">
                <label className="form-label">X-axis minimum<input className="form-control" type="number" step="any"
                  value={selected.chartXAxisMinimum ?? ''} disabled={!canEditCurrent}
                  onChange={(event) => updateComponent(selected.id, { chartXAxisMinimum: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                <label className="form-label">X-axis maximum<input className="form-control" type="number" step="any"
                  value={selected.chartXAxisMaximum ?? ''} disabled={!canEditCurrent}
                  onChange={(event) => updateComponent(selected.id, { chartXAxisMaximum: event.target.value === '' ? null : Number(event.target.value) })} /></label>
              </div>}
              {['Scatter', 'Column', 'Stacked Column', 'Line', 'Area'].includes(selected.chartType) && <div className="dashboard-axis-bounds">
                <label className="form-label">Y-axis minimum<input className="form-control" type="number" step="any"
                  value={selected.chartYAxisMinimum ?? ''} disabled={!canEditCurrent}
                  onChange={(event) => updateComponent(selected.id, { chartYAxisMinimum: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                <label className="form-label">Y-axis maximum<input className="form-control" type="number" step="any"
                  value={selected.chartYAxisMaximum ?? ''} disabled={!canEditCurrent}
                  onChange={(event) => updateComponent(selected.id, { chartYAxisMaximum: event.target.value === '' ? null : Number(event.target.value) })} /></label>
              </div>}
              <label className="checkbox-row property-check"><input type="checkbox" disabled={!canEditCurrent} checked={selected.showGridlines !== false}
                onChange={(event) => updateComponent(selected.id, { showGridlines: event.target.checked })} />Show gridlines</label>
            </>}
            <label className="form-label" htmlFor="dashboard-value-format">Value format</label>
            <select id="dashboard-value-format" className="form-control" disabled={!canEditCurrent}
              value={selected.chartValueFormat ?? 'Number'}
              onChange={(event) => updateComponent(selected.id, { chartValueFormat: event.target.value as DashboardComponentMetadata['chartValueFormat'] })}>
              <option>Number</option><option>Currency</option><option>Percent</option>
            </select>
            {selected.chartValueFormat === 'Currency' && <label className="form-label" htmlFor="dashboard-currency-code">Currency code</label>}
            {selected.chartValueFormat === 'Currency' && <input id="dashboard-currency-code" className="form-control" maxLength={3}
              disabled={!canEditCurrent} value={selected.chartCurrencyCode ?? 'USD'}
              onChange={(event) => updateComponent(selected.id, { chartCurrencyCode: event.target.value.toUpperCase() })} />}
            <label className="form-label" htmlFor="dashboard-decimal-places">Decimal places</label>
            <select id="dashboard-decimal-places" className="form-control" disabled={!canEditCurrent}
              value={selected.chartDecimalPlaces ?? 2}
              onChange={(event) => updateComponent(selected.id, { chartDecimalPlaces: Number(event.target.value) })}>
              {[0, 1, 2, 3, 4].map((places) => <option key={places} value={places}>{places}</option>)}
            </select>
            <label className="form-label" htmlFor="dashboard-legend-position">Legend position</label>
            <select id="dashboard-legend-position" className="form-control" disabled={!canEditCurrent || selected.showLegend === false}
              value={selected.legendPosition ?? 'Bottom'} onChange={(event) => updateComponent(selected.id, { legendPosition: event.target.value as DashboardComponentMetadata['legendPosition'] })}>
              <option>Bottom</option><option>Right</option><option>Top</option>
            </select>
            <label className="form-label" htmlFor="dashboard-chart-sort">Sort categories</label>
            <select id="dashboard-chart-sort" className="form-control" disabled={!canEditCurrent} value={selected.chartSortOrder ?? 'Descending'}
              onChange={(event) => updateComponent(selected.id, { chartSortOrder: event.target.value as DashboardComponentMetadata['chartSortOrder'] })}>
              <option value="Descending">Highest value first</option><option value="Ascending">Lowest value first</option>
            </select>
            <label className="form-label" htmlFor="dashboard-chart-palette">Color palette</label>
            <select id="dashboard-chart-palette" className="form-control" disabled={!canEditCurrent}
              value={selected.chartColorPalette ?? 'Salesforce'}
              onChange={(event) => updateComponent(selected.id, { chartColorPalette: event.target.value as DashboardComponentMetadata['chartColorPalette'] })}>
              <option>Salesforce</option><option>Colorblind Safe</option><option>Monochrome</option>
            </select>
            <label className="form-label" htmlFor="dashboard-chart-limit">Visible categories</label>
            <input id="dashboard-chart-limit" className="form-control" type="number" min={1}
              disabled={!canEditCurrent} value={selected.chartLimit ?? 8}
              onChange={(event) => updateComponent(selected.id, { chartLimit: Math.max(1, Number(event.target.value)) })} />
          </>}
          {selected.type === 'Table' && <div className="dashboard-field-picker">
            <div className="properties-section-title">Displayed Fields</div>
            {fieldsForComponent(selected).map((field) => <label className="checkbox-row property-check" key={field.apiName}>
              <input type="checkbox" disabled={!canEditCurrent} checked={selected.displayFieldApiNames.includes(field.apiName)} onChange={(event) => updateComponent(selected.id, {
                displayFieldApiNames: event.target.checked
                  ? [...selected.displayFieldApiNames, field.apiName]
                  : selected.displayFieldApiNames.filter((name) => name !== field.apiName)
              })} />{field.label}
            </label>)}
          </div>}
          <div className="dashboard-property-meta"><span>{filteredRecords(selected).length.toLocaleString()} {selected.reportApiName ? 'report' : 'preview'} records</span></div>
        </> : <>
          <p className="properties-help">Dashboard definitions are saved as tenant metadata. Data visibility still follows each user's record and field permissions.</p>
          {!canEditCurrent && <div className="info-callout">You can view this dashboard, but only its owner or a dashboard administrator can edit it.</div>}
          <label className="checkbox-row property-check">
            <input type="checkbox" disabled={!canEditCurrent || !canManageAll}
              checked={current.allowViewerToSelectRunningUser ?? false}
              onChange={(event) => changeDraft((dashboard) => ({
                ...dashboard,
                allowViewerToSelectRunningUser: event.target.checked,
                runningUserId: event.target.checked ? null : dashboard.runningUserId
              }))} />
            Allow dashboard administrators to choose whom they view the dashboard as
          </label>
          <label className="form-label" htmlFor="dashboard-running-user">View dashboard as</label>
          <select id="dashboard-running-user" className="form-control" disabled={!canEditCurrent || !canManageAll || current.allowViewerToSelectRunningUser}
            value={current.runningUserId ?? ''} onChange={(event) => changeDraft((dashboard) => ({
              ...dashboard,
              runningUserId: event.target.value || null
            }))}>
            <option value="">Logged-in viewer</option>
            {subscriptionUsers.map((user) => <option value={user.id} key={user.id}>{user.name} ({user.username})</option>)}
          </select>
          <div className="dashboard-sharing-help">{current.allowViewerToSelectRunningUser
            ? 'Dashboard administrators can preview as another active user in this tenant. Every request is checked against the selected user’s permissions.'
            : current.runningUserId
            ? 'Dashboard data uses this active user’s object, field, and record access. Dashboard administrators control this setting.'
            : 'Each viewer sees records allowed by their permissions and sharing, including hierarchy access to subordinate-owned records when enabled.'}</div>
          <label className="form-label" htmlFor="dashboard-folder-name">Dashboard folder</label>
          <select id="dashboard-folder-name" className="form-control" disabled={!canEditCurrent}
            value={current.folderId ?? ''}
            onChange={(event) => {
              const folder = dashboardFolders.find((item) => item.id === event.target.value);
              changeDraft((dashboard) => ({
                ...dashboard,
                folderId: folder?.id ?? null,
                folderName: folder ? folderPath(folder.id) : 'Private Reports'
              }));
            }}>
            <option value="">Private Reports (no shared folder)</option>
            {folderChoices.map(({ folder, path }) => <option key={folder.id} value={folder.id}>{path}</option>)}
          </select>
          {folderChoices.length > 0 && <div className="dashboard-folder-settings">
            <h3>Manage dashboard folders</h3>
            <label className="form-label" htmlFor="dashboard-folder-manage-select">Folder</label>
            <select id="dashboard-folder-manage-select" className="form-control" value={managedFolderId}
              onChange={(event) => setManagedFolderId(event.target.value)}>
              <option value="">Select a folder</option>
              {folderChoices.map(({ folder, path }) => <option key={folder.id} value={folder.id}>{path}</option>)}
            </select>
            {currentFolder && <>
              <h4>{folderPath(currentFolder.id)}</h4>
              {canManageCurrentFolder ? <>
                <label className="form-label" htmlFor="dashboard-folder-label">Folder name</label>
                <input id="dashboard-folder-label" className="form-control" maxLength={80} value={folderEditLabel}
                  onChange={(event) => setFolderEditLabel(event.target.value)} />
                <label className="form-label" htmlFor="dashboard-folder-parent">Parent folder</label>
                <select id="dashboard-folder-parent" className="form-control" value={folderEditParentId}
                  onChange={(event) => setFolderEditParentId(event.target.value)}>
                  <option value="">Top-level folder</option>
                  {folderParentChoices.map(({ folder, path }) => <option key={folder.id} value={folder.id}>{path}</option>)}
                </select>
                <button className="btn btn-full" disabled={!folderEditLabel.trim()}
                  onClick={() => void saveCurrentFolder(currentFolder.shares)}>
                  <Save size={14} />Save folder
                </button>
                <h4>Folder access grants</h4>
                {currentFolder.shares.map((share) => {
                  const targetName = share.targetType === 'User'
                    ? subscriptionUsers.find((user) => user.id === share.targetId)?.name ?? share.targetId
                    : share.targetType === 'PublicGroup'
                      ? folderPublicGroups.find((group) => group.id === share.targetId)?.label ?? share.targetId
                      : share.targetType === 'PermissionSetGroup'
                        ? folderPermissionSetGroups.find((group) => group.id === share.targetId)?.label ?? share.targetId
                        : share.targetType === 'Territory'
                          ? dashboardTerritories.find((territory) => territory.id === share.targetId)?.label ?? share.targetId
                          : folderRoles.find((role) => role.id === share.targetId)?.name ?? share.targetId;
                  return <div className="dashboard-folder-grant" key={`${share.targetType}-${share.targetId}`}>
                    <span>{targetName}<small>{share.targetType}</small></span>
                    <select className="form-control compact-select" aria-label={`Folder access for ${targetName}`}
                      value={share.accessLevel}
                      onChange={(event) => void saveFolderShares(currentFolder.shares.map((item) =>
                        item.targetId === share.targetId && item.targetType === share.targetType
                          ? { ...item, accessLevel: event.target.value as DashboardFolderShareMetadata['accessLevel'] }
                          : item))}>
                      <option>Viewer</option><option>Editor</option><option>Manager</option>
                    </select>
                    <button className="row-menu" aria-label={`Remove folder access for ${targetName}`}
                      onClick={() => void saveFolderShares(currentFolder.shares.filter((item) =>
                        item.targetId !== share.targetId || item.targetType !== share.targetType))}><X size={14} /></button>
                  </div>;
                })}
                <div className="dashboard-folder-grant-create">
                  <select className="form-control" aria-label="Folder share target type" value={folderShareType}
                    onChange={(event) => {
                      setFolderShareType(event.target.value as DashboardFolderShareMetadata['targetType']);
                      setFolderShareTargetId('');
                    }}>
                    <option value="User">User</option><option value="PublicGroup">Public Group</option>
                    <option value="PermissionSetGroup">Permission Set Group</option><option value="Territory">Territory</option>
                    <option value="Role">Role</option><option value="RoleAndSubordinates">Role and Subordinates</option>
                  </select>
                  <select className="form-control" aria-label="Folder share target" value={folderShareTargetId}
                    onChange={(event) => setFolderShareTargetId(event.target.value)}>
                    <option value="">Select a target</option>
                    {folderShareOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                  </select>
                  <select className="form-control" aria-label="Folder share access level" value={folderShareAccess}
                    onChange={(event) => setFolderShareAccess(event.target.value as DashboardFolderShareMetadata['accessLevel'])}>
                    <option>Viewer</option><option>Editor</option><option>Manager</option>
                  </select>
                  <button className="btn" disabled={!folderShareTargetId} onClick={addFolderShare}><Plus size={14} />Grant access</button>
                </div>
                <button className="btn btn-full dashboard-delete-button" onClick={() => void deleteCurrentFolder()}>
                  <Trash2 size={14} />Delete empty folder
                </button>
                {canManageTerritories && <div className="dashboard-folder-settings">
                  <h4>Territory audiences</h4>
                  <label className="form-label" htmlFor="dashboard-territory-edit">Territory</label>
                  <select id="dashboard-territory-edit" className="form-control" value={territoryEditId} onChange={(event) => {
                    const territory = dashboardTerritories.find((item) => item.id === event.target.value);
                    setTerritoryEditId(event.target.value);
                    setTerritoryLabel(territory?.label ?? '');
                    setTerritoryParentId(territory?.parentTerritoryId ?? '');
                    setTerritoryUserIds(territory ? [...territory.userIds] : []);
                  }}>
                    <option value="">New territory</option>
                    {dashboardTerritories.map((territory) => <option key={territory.id} value={territory.id}>{territory.label}</option>)}
                  </select>
                  <label className="form-label" htmlFor="dashboard-territory-label">Name</label>
                  <input id="dashboard-territory-label" className="form-control" maxLength={80} value={territoryLabel}
                    onChange={(event) => setTerritoryLabel(event.target.value)} />
                  <label className="form-label" htmlFor="dashboard-territory-parent">Parent territory</label>
                  <select id="dashboard-territory-parent" className="form-control" value={territoryParentId}
                    onChange={(event) => setTerritoryParentId(event.target.value)}>
                    <option value="">No parent</option>
                    {dashboardTerritories.filter((territory) => territory.id !== territoryEditId).map((territory) =>
                      <option key={territory.id} value={territory.id}>{territory.label}</option>)}
                  </select>
                  <div className="form-label">Assigned users (subterritories inherit access)</div>
                  {subscriptionUsers.map((user) => <label className="checkbox-row property-check" key={user.id}>
                    <input type="checkbox" checked={territoryUserIds.includes(user.id)} onChange={(event) => setTerritoryUserIds((currentIds) =>
                      event.target.checked ? [...currentIds, user.id] : currentIds.filter((id) => id !== user.id))} />
                    {user.name}
                  </label>)}
                  <button className="btn btn-full" disabled={territoryBusy || !territoryLabel.trim()}
                    onClick={() => void saveTerritory()}><Save size={14} />Save territory</button>
                  {territoryEditId && <button className="btn btn-full dashboard-delete-button" disabled={territoryBusy}
                    onClick={() => void saveTerritory(true)}><Trash2 size={14} />Delete territory</button>}
                </div>}
              </> : <div className="dashboard-sharing-help">You have {currentFolder.accessLevel ?? 'viewer'} access. Folder grants and structure can be changed only by a folder manager.</div>}
            </>}
          </div>}
          <label className="form-label" htmlFor="dashboard-refresh-interval">Automatic refresh</label>
          <select id="dashboard-refresh-interval" className="form-control" disabled={!canEditCurrent}
            value={current.refreshIntervalMinutes ?? 0}
            onChange={(event) => changeDraft((dashboard) => ({
              ...dashboard,
              refreshIntervalMinutes: Number(event.target.value) as DashboardMetadata['refreshIntervalMinutes']
            }))}>
            <option value={0}>Off</option><option value={1}>Every minute</option><option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option><option value={60}>Every hour</option>
          </select>
          <label className="form-label" htmlFor="dashboard-visibility">View access</label>
          <select id="dashboard-visibility" className="form-control" disabled={!canEditCurrent} value={current.visibility} onChange={(event) => changeDraft((dashboard) => ({ ...dashboard, visibility: event.target.value as DashboardMetadata['visibility'] }))}>
            <option>Private</option><option>All Users</option>
          </select>
          <div className="dashboard-sharing-help">{current.status === 'Draft'
            ? 'Draft dashboards are visible only to you and dashboard administrators. Publish to grant the selected audience access.'
            : current.visibility === 'Private'
              ? 'Published dashboards are visible to you, selected users or groups, and dashboard administrators.'
              : 'Published dashboards are visible to every user in this tenant with dashboard read access.'}</div>
          {current.visibility === 'Private' && <section className="dashboard-explicit-sharing" aria-label="Private dashboard access">
            <h3>Share privately</h3>
            {!shareUsers.length && !shareGroups.length
              ? <p>Recipient details require security read access.</p>
              : <>
                {!!shareUsers.length && <div className="dashboard-share-list">
                  <strong>Users</strong>
                  {shareUsers.map((user) => <label key={user.id}><input type="checkbox" disabled={!canEditCurrent} checked={current.sharedUserIds.includes(user.id)}
                    onChange={(event) => changeDraft((dashboard) => ({ ...dashboard, sharedUserIds: event.target.checked
                      ? [...dashboard.sharedUserIds, user.id]
                      : dashboard.sharedUserIds.filter((id) => id !== user.id) }))} />
                    <span>{user.name}<small>{user.username}</small></span></label>)}
                </div>}
                {!!shareGroups.length && <div className="dashboard-share-list">
                  <strong>Permission Set Groups</strong>
                  {shareGroups.map((group) => <label key={group.id}><input type="checkbox" disabled={!canEditCurrent} checked={current.sharedPermissionSetGroupIds.includes(group.id)}
                    onChange={(event) => changeDraft((dashboard) => ({ ...dashboard, sharedPermissionSetGroupIds: event.target.checked
                      ? [...dashboard.sharedPermissionSetGroupIds, group.id]
                      : dashboard.sharedPermissionSetGroupIds.filter((id) => id !== group.id) }))} />
                    <span>{group.label}<small>{group.apiName}</small></span></label>)}
                </div>}
              </>}
          </section>}
          <label className="form-label" htmlFor="dashboard-description">Description</label>
          <textarea id="dashboard-description" className="form-control" disabled={!canEditCurrent} rows={4} maxLength={500} value={current.description} onChange={(event) => changeDraft((dashboard) => ({ ...dashboard, description: event.target.value }))} />
          <div className="dashboard-property-meta"><span>API Name</span><code>{current.apiName}</code></div>
          <div className="dashboard-property-meta"><span>Components</span><strong>{current.components.length}</strong></div>
          {dashboardIsSaved && <button className="btn btn-full dashboard-delete-button" disabled={!canEditCurrent || busy} onClick={() => void deleteDashboard()}><Trash2 size={14} />Delete dashboard</button>}
        </>}
      </aside>}
    </div>
    {creating && canCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-dashboard-title">
        <div className="modal-header"><h2 id="create-dashboard-title">Create a dashboard</h2><button className="icon-button dark" onClick={() => setCreating(false)} aria-label="Close"><X size={18} /></button></div>
        <p className="modal-copy">Create a metadata-backed dashboard, then add metrics, charts, and record tables.</p>
        <label className="form-label" htmlFor="new-dashboard-label">Dashboard name</label>
        <input id="new-dashboard-label" className="form-control" autoFocus maxLength={80} value={newLabel} onChange={(event) => setNewLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createDashboard(); }} placeholder="For example, Sales Performance" />
        <div className="modal-actions"><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn btn-brand" disabled={!newLabel.trim()} onClick={createDashboard}><Plus size={14} />Create dashboard</button></div>
      </section>
    </div>}
  </div>;
}

