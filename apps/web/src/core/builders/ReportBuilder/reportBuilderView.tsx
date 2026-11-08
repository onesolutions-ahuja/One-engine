import {generateMetadataApiName,suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import { cloneReportForEditing } from './reportBuilderSelection';
import '../SharedBuilderFrame/adaptiveBuilder.css';
import { createObjectManager } from '../ObjectManager/objectManagerView';
import { createSetupHome } from '../../settings/SetupHome/setupHomeView';
import { createSettingsViews } from '../../settings/SettingsWorkspace/settingsWorkspaceViews';
import { pageLayoutForRecord, compactLayoutForRecord, matchesLookupFilterGroup, relatedLookupFilterOperators, type RecordData } from '../../records/RecordWorkspace/recordMetadataUtils';
import { formatRecordValue, parseCsvImport } from '../../records/RecordWorkspace/recordCsvUtils';
import { initialScreenValues, screenFieldIsVisible } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import { objectSettings, parseAppRoute, appRoutePath, type AppRoute } from '../../workspace/Navigation/appRouting';
import { NavigationLoadTime, resolveCurrentAppNavigation } from '../../workspace/Navigation/appNavigationView';
import { isStandalonePagePresentation, pageCanvasPresentationStyle } from '../../pages/PageRuntime/pageRuntimePresentation';
import { insertFlowElementAtPath } from '../FlowBuilder/flowInsertElement.mjs';
import AdvancedSharingSettings from '../../security/Permissions/AdvancedSharingSettings';
import {resolveSetupNavigation} from '../../platform/Workspace/platformSetupNavigation';
import {readVerifiedMetadata,saveVerifiedMetadata,type MetadataPublicationResponse} from '../../metadata/Cache/verifiedMetadataCache';
import { queueOfflineRecord, listOfflineRecords, markOfflineRecord, removeOfflineRecord,
  synchronizeOfflineRecords, type OfflineQueueOwner, type OfflineRecordItem, type OfflineRecordWrite } from '../../metadata/Cache/offlineRecordQueue';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import FlowInputBindingEditor from '../FlowInputBindingEditor/FlowInputBindingEditor';
import RecordFilterEditor from '../../../component-libraries/shared/primitives/RecordFilterEditor/RecordFilterEditor';
import ComponentVisibilityEditor from '../ComponentProperties/ComponentVisibilityEditor';
import PageRouteDirectory from '../../pages/PageRouteDirectory/PageRouteDirectory';
import { isComponentVisible } from '../../components/Properties/componentVisibility';
import { canNestComponent, componentVisualStyle, directChildren, isLayoutType, isDescendantOf, layoutTypes } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import { isCanvasLocked, wrapCanvasComponent, ungroupCanvasComponent } from '../PageBuilder/canvasInteractions';
import { filterPageComponentRecords, needsMetadataComponentRuntime } from '../../pages/PageRuntime/pageComponentBindings';
import { childrenOf, canNest, componentLayoutProps, hasPageComponentAppearance, isLayoutContainer, rawLayoutParentId, reparentComponent, resolvePageComponentStyle, type LayoutDevice } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import AppExchange from '../../applications/AppExchange/AppExchange';
import AppManager from '../../applications/AppManager/AppManager';
import PlatformWorkspaceSurface from '../../platform/Workspace/PlatformWorkspaceSurface';
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
import { type ObjectMetadata, type FieldMetadata, type DashboardFilterMetadata, type DashboardMetadata, type ReportMetadata, type ReportBucketMetadata, type ReportFolderMetadata, type ReportFolderInput, type ReportRunMetadata, type ReportStandardFiltersMetadata, type ReportFilterMetadata, type ReportDateRange, type ReportDateGrouping, type ReportSummaryOperation, type ReportCrossFilterMetadata, type AccessControlMetadata } from '../../metadata/Definitions/metadata';


export function ReportBuilder({
  reports, reportFolders, canManageReportFolders, accessControl, objects, onSave, onSaveFolder, onDelete, onRun, onPreview, onNotify
}: {
  reports: ReportMetadata[];
  reportFolders: ReportFolderMetadata[];
  canManageReportFolders: boolean;
  accessControl: AccessControlMetadata;
  objects: ObjectMetadata[];
  onSave: (report: ReportMetadata) => Promise<ReportMetadata>;
  onSaveFolder: (input: ReportFolderInput) => Promise<ReportFolderMetadata>;
  onDelete: (apiName: string) => Promise<void>;
  onRun: (
    apiName: string,
    filters?: DashboardFilterMetadata[],
    offset?: number,
    limit?: number,
    filterLogic?: DashboardMetadata['filterLogic'],
    crossFilters?: DashboardFilterMetadata[],
    dashboardApiName?: string,
    reportFilterOverrides?: Array<{ id: string; value: string; values: string[] }>
  ) => Promise<ReportRunMetadata>;
  onPreview: (
    report: ReportMetadata,
    reportFilterOverrides: Array<{ id: string; value: string; values: string[] }>,
    offset?: number,
    limit?: number
  ) => Promise<ReportRunMetadata>;
  onNotify: (message: string) => void;
}) {
  const availableObjects = objects.filter((item) => item.apiName !== 'User' && item.settings?.allowReports);
  const reportTypeCategoryForObject = (object: ObjectMetadata) => {
    const categories: Record<string, string> = {
      Account: 'Accounts & Contacts',
      Contact: 'Accounts & Contacts',
      Case: 'Customer Support Reports',
      Lead: 'Leads',
      Opportunity: 'Opportunities',
      Asset: 'Products & Assets',
      Product2: 'Products & Assets'
    };
    return categories[object.apiName] ?? (object.kind === 'Custom Object' ? 'Custom Object Reports' : 'Other Reports');
  };
  const reportTypeCategories = [...new Set(availableObjects.map(reportTypeCategoryForObject))];
  const [selectedApiName, setSelectedApiName] = useState('');
  const [draft, setDraft] = useState<ReportMetadata | null>(null);
  const [manualReportApiName,setManualReportApiName]=useState(false);
  const [reportNewDraft,setReportNewDraft]=useState(false);
  const [result, setResult] = useState<ReportRunMetadata | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [fieldQuery, setFieldQuery] = useState('');
  const [reportTypeQuery, setReportTypeQuery] = useState('');
  const [outlineFieldQuery, setOutlineFieldQuery] = useState('');
  const [filterFieldQuery, setFilterFieldQuery] = useState('');
  const [reportTypeCategory, setReportTypeCategory] = useState<string>('All');
  const [selectedReportObjectApiName, setSelectedReportObjectApiName] = useState('');
  const [reportTypeSelectorOpen, setReportTypeSelectorOpen] = useState(false);
  const [builderTab, setBuilderTab] = useState<'Outline' | 'Filters'>('Outline');
  const [fieldsPanelOpen, setFieldsPanelOpen] = useState(false);
  const [tabletOutlineOpen,setTabletOutlineOpen]=useState(false);
  const [runPage, setRunPage] = useState(false);
  const [pageOffset, setPageOffset] = useState(0);
  const [runFilterValues, setRunFilterValues] = useState<Record<string, string>>({});
  const [runFilterSelections, setRunFilterSelections] = useState<Record<string, string[]>>({});
  const [autoPreview, setAutoPreview] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [newReportFolderLabel, setNewReportFolderLabel] = useState('');
  const [newBucketApiName, setNewBucketApiName] = useState('');
  const [newBucketLabel, setNewBucketLabel] = useState('');
  const [newBucketSourceField, setNewBucketSourceField] = useState('');
  const [newBucketRanges, setNewBucketRanges] = useState([
    { label: 'Small', upperBound: '' },
    { label: 'Medium', upperBound: '' },
    { label: 'Large', upperBound: '' }
  ]);
  const [newBucketBlanksAsZero, setNewBucketBlanksAsZero] = useState(false);
  const [newReportFolderVisibility, setNewReportFolderVisibility] = useState<ReportFolderInput['visibility']>('Private');
  const [reportFolderShareType, setReportFolderShareType] = useState<ReportFolderInput['shares'][number]['targetType']>('User');
  const [reportFolderShareTarget, setReportFolderShareTarget] = useState('');
  const [reportFolderShareLevel, setReportFolderShareLevel] = useState<ReportFolderInput['shares'][number]['accessLevel']>('Viewer');
  const previewRequestId = useRef(0);
  const current = draft ?? reports.find((item) => item.apiName === selectedApiName) ?? reports[0] ?? null;
  const reportObject = availableObjects.find((item) => item.apiName === current?.objectApiName);
  const relatedChildObjects = objects.filter((item) => item.apiName !== 'User'
    && item.fields.some((field) => field.relationship?.targetObject === current?.objectApiName));
  const reportDateFields = reportObject?.fields.filter((field) => /^(Date|DateTime)(\(|$)/.test(field.dataType)) ?? [];
  const reportStatusFields = reportObject?.fields.filter((field) =>
    ['Status', 'StageName'].includes(field.apiName) && Boolean(field.picklistValues?.length)) ?? [];
  const outlineFields = reportObject?.fields.filter((field) =>
    `${field.label} ${field.apiName}`.toLocaleLowerCase().includes(outlineFieldQuery.trim().toLocaleLowerCase())) ?? [];
  const orderedOutlineFields = current
    ? [
      ...current.fieldApiNames
        .map((apiName) => outlineFields.find((field) => field.apiName === apiName))
        .filter((field): field is FieldMetadata => Boolean(field)),
      ...outlineFields.filter((field) => !current.fieldApiNames.includes(field.apiName))
    ]
    : outlineFields;
  const filterFields = reportObject?.fields.filter((field) =>
    `${field.label} ${field.apiName}`.toLocaleLowerCase().includes(filterFieldQuery.trim().toLocaleLowerCase())) ?? [];
  const searchableFields = reportObject?.fields.filter((field) =>
    `${field.label} ${field.apiName} ${field.dataType}`.toLocaleLowerCase().includes(fieldQuery.trim().toLocaleLowerCase())) ?? [];
  const searchableReportObjects = availableObjects.filter((object) =>
    (reportTypeCategory === 'All' || reportTypeCategoryForObject(object) === reportTypeCategory)
    && (`${object.label} ${object.apiName} ${object.kind} ${object.fields.map((field) => `${field.label} ${field.apiName}`).join(' ')}`
      .toLocaleLowerCase().includes(reportTypeQuery.trim().toLocaleLowerCase())));
  const reportFilterRestrictionCount = current
    ? current.filters.length
      + current.crossFilters.length
      + current.crossFilters.reduce((total, filter) => total + filter.filters.length, 0)
      + Number(current.standardFilters.showMe === 'My')
      + Number(Boolean(current.standardFilters.dateFieldApiName && current.standardFilters.dateRange !== 'All Time'))
      + Number(current.standardFilters.statusSelection !== 'All')
      + Number(current.rowLimit.limit !== null)
    : 0;
  const operators: ReportFilterMetadata['operator'][] = [
    'Equals', 'Not Equal To', 'Contains', 'Does Not Contain', 'Starts With',
    'Greater Than', 'Greater Than or Equal To', 'Less Than', 'Less Than or Equal To',
    'Includes', 'Excludes', 'Is Null', 'Is Not Null'
  ];

  useEffect(() => {
    if (draft) return;
    const report = reports.find((item) => item.apiName === selectedApiName) ?? reports[0];
    if (report) {
      setReportNewDraft(false);
      setDraft({
        ...report,
        fieldApiNames: [...report.fieldApiNames],
        groupByFieldApiNames: [...report.groupByFieldApiNames],
        filters: report.filters.map((filter) => ({ ...filter, values: [...filter.values] })),
        standardFilters: { ...report.standardFilters },
        crossFilters: report.crossFilters.map((filter) => ({ ...filter, filters: filter.filters.map((subfilter) => ({ ...subfilter, values: [...subfilter.values] })) })),
        rowLimit: { ...report.rowLimit },
        bucketFields: (report.bucketFields ?? []).map((bucket) => ({
          ...bucket,
          ranges: bucket.ranges.map((range) => ({ ...range }))
        }))
      });
      setSelectedApiName(report.apiName);
    }
  }, [selectedApiName, reports, draft]);

  const updateReport = (update: Partial<ReportMetadata>) => {
    setDraft((value) => value ? { ...value, ...update } : value);
  };
  const updateNewBucketRange = (index: number, update: Partial<(typeof newBucketRanges)[number]>) => {
    setNewBucketRanges((ranges) => ranges.map((range, rangeIndex) =>
      rangeIndex === index ? { ...range, ...update } : range));
  };
  const addNewBucketRange = () => {
    setNewBucketRanges((ranges) => [...ranges, { label: `Bucket ${ranges.length + 1}`, upperBound: '' }]);
  };
  const removeNewBucketRange = (index: number) => {
    setNewBucketRanges((ranges) => {
      if (ranges.length <= 2) return ranges;
      const next = ranges.filter((_, rangeIndex) => rangeIndex !== index);
      if (index > 0 && index < ranges.length - 1) {
        next[index - 1] = { ...next[index - 1], upperBound: ranges[index].upperBound };
      } else if (index === ranges.length - 1) {
        next[next.length - 1] = { ...next[next.length - 1], upperBound: '' };
      }
      return next;
    });
  };
  const addBucketField = () => {
    if (!current) return;
    const apiName = newBucketApiName.trim();
    const label = newBucketLabel.trim();
    const labels = newBucketRanges.map((range) => range.label.trim());
    const boundaries = newBucketRanges.slice(0, -1).map((range) =>
      range.upperBound.trim() === '' ? Number.NaN : Number(range.upperBound));
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(apiName) || !label || !newBucketSourceField
      || newBucketRanges.length < 2 || labels.some((rangeLabel) => !rangeLabel)
      || new Set(labels.map((rangeLabel) => rangeLabel.toLocaleLowerCase())).size !== labels.length
      || boundaries.some((boundary) => !Number.isFinite(boundary))
      || boundaries.some((boundary, index) => index > 0 && boundaries[index - 1] >= boundary)) {
      onNotify('Enter a valid bucket name, unique category labels, and increasing range boundaries');
      return;
    }
    if ((current.bucketFields ?? []).some((bucket) => bucket.apiName.toLocaleLowerCase() === apiName.toLocaleLowerCase())) {
      onNotify('A bucket with this API name already exists');
      return;
    }
    const bucket: ReportBucketMetadata = {
      apiName,
      label,
      fieldApiName: newBucketSourceField,
      ranges: newBucketRanges.map((range, index) => ({
        label: range.label.trim(),
        lowerBound: index === 0 ? null : boundaries[index - 1],
        upperBound: index === newBucketRanges.length - 1 ? null : boundaries[index]
      })),
      treatBlanksAsZero: newBucketBlanksAsZero
    };
    updateReport({ bucketFields: [...(current.bucketFields ?? []), bucket] });
    setNewBucketApiName('');
    setNewBucketLabel('');
    setNewBucketRanges([
      { label: 'Small', upperBound: '' },
      { label: 'Medium', upperBound: '' },
      { label: 'Large', upperBound: '' }
    ]);
    setResult(null);
  };
  const refreshPreview = useCallback(async (offset = 0) => {
    if (!current) return;
    const requestId = ++previewRequestId.current;
    setPreviewBusy(true);
    setError('');
    setPageOffset(offset);
    try {
      const preview = await onPreview(current, current.filters.map((filter) => ({
        id: filter.id,
        value: filter.locked ? filter.value : runFilterValues[filter.id] ?? filter.value,
        values: filter.locked ? filter.values : runFilterSelections[filter.id] ?? filter.values
      })), offset, 100);
      if (requestId === previewRequestId.current) setResult(preview);
    } catch (failure) {
      if (requestId === previewRequestId.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (requestId === previewRequestId.current) setPreviewBusy(false);
    }
  }, [current, onPreview, runFilterSelections, runFilterValues]);
  useEffect(() => {
    if (!autoPreview || runPage || busy || !current) {
      return () => {
        previewRequestId.current += 1;
        setPreviewBusy(false);
      };
    }
    const timeout = window.setTimeout(() => { void refreshPreview(0); }, 400);
    return () => {
      window.clearTimeout(timeout);
      previewRequestId.current += 1;
      setPreviewBusy(false);
    };
  }, [autoPreview, busy, current, refreshPreview, runPage]);
  const createReport = (objectApiName = selectedReportObjectApiName || availableObjects[0]?.apiName) => {
    setManualReportApiName(false);
    setReportNewDraft(true);
    const object = availableObjects.find((item) => item.apiName === objectApiName);
    if (!object) {
      onNotify('Enable reporting on an object before creating a report');
      return;
    }
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const firstField = object.fields[0]?.apiName;
    const opportunityDefaultFields = [
      'Name', 'Type', 'LeadSource', 'Amount', 'CloseDate', 'NextStep', 'StageName',
      'Probability', 'Fiscal', 'Age', 'CreatedDate', 'OwnerId', 'OwnerRole', 'AccountId'
    ];
    const caseDefaultFields = ['OwnerId', 'Subject', 'CreatedDate', 'Age', 'IsOpen', 'IsClosed', 'AccountId'];
    const starterFields = object.apiName === 'Opportunity'
      ? opportunityDefaultFields
      : object.apiName === 'Case'
        ? caseDefaultFields
        : null;
    const defaultFields = starterFields
      ? starterFields.filter((fieldApiName) => object.fields.some((field) => field.apiName === fieldApiName))
      : firstField ? [firstField] : [];
    const report: ReportMetadata = {
      reportType: 'Standard',
      apiName: `New_Report_${id}`,
      label: 'New Report',
      description: '',
      objectApiName: object.apiName,
      fieldApiNames: defaultFields,
      groupByFieldApiNames: [],
      filterLogic: 'All',
      format: 'Tabular',
      columnGroupByFieldApiName: null,
      sortFieldApiName: null,
      sortDirection: 'Ascending',
      filters: [],
      standardFilters: {
        showMe: 'All',
        dateFieldApiName: object.fields.some((field) => field.apiName === 'CreatedDate') ? 'CreatedDate' : null,
        dateRange: 'All Time',
        statusFieldApiName: object.fields.find((field) => ['Status', 'StageName'].includes(field.apiName) && field.picklistValues?.length)?.apiName ?? null,
        statusSelection: 'All'
      },
      crossFilters: [],
      rowLimit: { limit: null, sortFieldApiName: null, sortDirection: 'Ascending' },
      summaryOperations: {},
      dateGroupings: {},
      bucketFields: [],
      showDetails: true,
      showChart: false,
      folderName: 'My Reports',
      folderId: null
    };
    setDraft(report);
    setSelectedApiName(report.apiName);
    setResult(null);
    setError('');
    setRunPage(false);
    setReportTypeSelectorOpen(false);
  };
  const save = async () => {
    if (!current) return null;
    setBusy(true);
    setError('');
    try {
      if(reportNewDraft&&reports.some(item=>item.apiName.toLowerCase()===current.apiName.toLowerCase()))
        throw new Error('API Name already exists');
      if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(current.apiName))throw new Error('Invalid API name');
      const saved = await onSave(current);
      setReportNewDraft(false);
      setDraft(saved);
      setSelectedApiName(saved.apiName);
      return saved;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      onNotify(`Unable to save report: ${message}`);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const run = async (offset = 0) => {
    const saved = await save();
    if (!saved) return;
    setPageOffset(offset);
    setBusy(true);
    setError('');
    try {
      const reportResult = await onRun(saved.apiName, [], offset, 100, 'All', [], undefined, saved.filters.map((filter) => ({
        id: filter.id,
        value: runFilterValues[filter.id] ?? filter.value,
        values: runFilterSelections[filter.id] ?? filter.values
      })));
      setResult(reportResult);
      setRunPage(true);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      onNotify(`Unable to run report: ${message}`);
    } finally {
      setBusy(false);
    }
  };
  const cloneCurrent = () => {
    if (!current || !reports.some((item) => item.apiName === current.apiName)) return;
    const cloneId = crypto.randomUUID().replace(/-/g, '');
    const currentFolder = reportFolders.find((folder) => folder.id === current.folderId);
    const canSaveToCurrentFolder = !current.folderId
      || canManageReportFolders
      || currentFolder?.accessLevel === 'Editor'
      || currentFolder?.accessLevel === 'Manager';
    const folderId = canSaveToCurrentFolder ? current.folderId : null;
    const cloned: ReportMetadata = {
      ...current,
      apiName: `New_Report_${cloneId}`,
      label: `Copy of ${current.label}`.slice(0, 80),
      folderId,
      folderName: folderId ? current.folderName : 'My Reports',
      fieldApiNames: [...current.fieldApiNames],
      groupByFieldApiNames: [...current.groupByFieldApiNames],
      filters: current.filters.map((filter) => ({ ...filter, id: crypto.randomUUID(), values: [...filter.values] })),
      standardFilters: { ...current.standardFilters },
      crossFilters: current.crossFilters.map((filter) => ({
        ...filter,
        id: crypto.randomUUID(),
        filters: filter.filters.map((subfilter) => ({ ...subfilter, id: crypto.randomUUID(), values: [...subfilter.values] }))
      })),
      rowLimit: { ...current.rowLimit },
      summaryOperations: Object.fromEntries(Object.entries(current.summaryOperations).map(([fieldApiName, operations]) =>
        [fieldApiName, [...operations]])),
      dateGroupings: { ...current.dateGroupings },
      bucketFields: (current.bucketFields ?? []).map((bucket) => ({
        ...bucket,
        ranges: bucket.ranges.map((range) => ({ ...range }))
      }))
    };
    setReportNewDraft(true);
    setManualReportApiName(false);
    setDraft(cloned);
    setSelectedApiName(cloned.apiName);
    setRunFilterValues({});
    setRunFilterSelections({});
    setResult(null);
    setError('');
    setRunPage(false);
  };
  const deleteCurrent = async () => {
    if (!current || !reports.some((item) => item.apiName === current.apiName)) return;
    if (!window.confirm(`Delete the "${current.label}" report?`)) return;
    setBusy(true);
    setError('');
    try {
      await onDelete(current.apiName);
      setDraft(null);
      setResult(null);
      setSelectedApiName('');
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      onNotify(`Unable to delete report: ${message}`);
    } finally {
      setBusy(false);
    }
  };
  const changeObject = (objectApiName: string) => {
    const object = availableObjects.find((item) => item.apiName === objectApiName);
    const firstField = object?.fields[0]?.apiName;
    updateReport({
      objectApiName,
      fieldApiNames: firstField ? [firstField] : [],
      groupByFieldApiNames: [],
      filterLogic: 'All',
      format: 'Tabular',
      columnGroupByFieldApiName: null,
      sortFieldApiName: null,
      filters: [],
      standardFilters: {
        showMe: 'All',
        dateFieldApiName: object?.fields.some((field) => field.apiName === 'CreatedDate') ? 'CreatedDate' : null,
        dateRange: 'All Time',
        statusFieldApiName: object?.fields.find((field) => ['Status', 'StageName'].includes(field.apiName) && field.picklistValues?.length)?.apiName ?? null,
        statusSelection: 'All'
      },
      crossFilters: [],
      rowLimit: { limit: null, sortFieldApiName: null, sortDirection: 'Ascending' },
      summaryOperations: {},
      dateGroupings: {},
      bucketFields: [],
      showDetails: true,
      showChart: false,
      folderName: 'My Reports',
      folderId: null
    });
    setResult(null);
  };
  const toggleField = (fieldApiName: string, enabled: boolean) => {
    if (!current) return;
    const summaryOperations = { ...current.summaryOperations };
    if (!enabled) delete summaryOperations[fieldApiName];
    updateReport({ fieldApiNames: enabled
      ? [...current.fieldApiNames, fieldApiName]
      : current.fieldApiNames.filter((item) => item !== fieldApiName),
    summaryOperations,
    sortFieldApiName: enabled
      || current.groupByFieldApiNames.includes(fieldApiName)
      || current.sortFieldApiName !== fieldApiName
      ? current.sortFieldApiName
      : null });
    setResult(null);
  };
  const moveField = (fieldApiName: string, offset: -1 | 1) => {
    if (!current) return;
    const sourceIndex = current.fieldApiNames.indexOf(fieldApiName);
    const targetIndex = sourceIndex + offset;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.fieldApiNames.length) return;
    const fieldApiNames = [...current.fieldApiNames];
    [fieldApiNames[sourceIndex], fieldApiNames[targetIndex]] = [fieldApiNames[targetIndex], fieldApiNames[sourceIndex]];
    updateReport({ fieldApiNames });
    setResult(null);
  };
  const updateFilter = (id: string, update: Partial<ReportFilterMetadata>) => {
    if (!current) return;
    updateReport({ filters: current.filters.map((filter) => filter.id === id ? { ...filter, ...update } : filter) });
    if (update.value !== undefined) setRunFilterValues((values) => ({ ...values, [id]: update.value! }));
    if (update.values !== undefined) {
      setRunFilterSelections((selections) => ({ ...selections, [id]: [...update.values!] }));
      setRunFilterValues((values) => ({ ...values, [id]: update.value ?? '' }));
    }
    setResult(null);
  };
  const operatorsForField = (fieldApiName: string, fields: FieldMetadata[] = reportObject?.fields ?? []) => {
    const field = fields.find((item) => item.apiName === fieldApiName);
    const fieldType = field?.formula?.returnType ?? field?.dataType.replace(/\(.*/, '');
    const allowedOperators = fieldType === 'Multi-Select Picklist'
      ? ['Includes', 'Excludes', 'Is Null', 'Is Not Null']
      : fieldType === 'Picklist' || fieldType === 'Checkbox' || fieldType === 'Reference' || fieldType === 'Id'
        ? ['Equals', 'Not Equal To', 'Is Null', 'Is Not Null']
        : /^(Number|Currency|Percent|Date|DateTime)$/.test(fieldType ?? '')
          ? ['Equals', 'Not Equal To', 'Greater Than', 'Greater Than or Equal To', 'Less Than', 'Less Than or Equal To', 'Is Null', 'Is Not Null']
          : ['Equals', 'Not Equal To', 'Contains', 'Does Not Contain', 'Starts With', 'Is Null', 'Is Not Null'];
    return operators.filter((operator) => allowedOperators.includes(operator));
  };
  const addFilter = (fieldApiName = reportObject?.fields[0]?.apiName) => {
    if (!current || !fieldApiName || !reportObject?.fields.some((field) => field.apiName === fieldApiName)) return;
    updateReport({
      filters: [...current.filters, { id: crypto.randomUUID(), fieldApiName, operator: 'Equals', value: '', values: [], locked: false }],
      filterLogic: 'All'
    });
    setBuilderTab('Filters');
    setResult(null);
  };
  const handleFieldDrop = (event: React.DragEvent, target: 'column' | 'filter') => {
    event.preventDefault();
    const fieldApiName = event.dataTransfer.getData('text/report-field');
    if (!reportObject?.fields.some((field) => field.apiName === fieldApiName)) return;
    if (target === 'filter') addFilter(fieldApiName);
    else if (current && !current.fieldApiNames.includes(fieldApiName)) toggleField(fieldApiName, true);
  };
  const openReportTypeSelector = () => {
    setSelectedReportObjectApiName(availableObjects[0]?.apiName ?? '');
    setReportTypeQuery('');
    setReportTypeCategory('All');
    setReportTypeSelectorOpen(true);
  };
  const updateCrossFilter = (id: string, update: Partial<ReportCrossFilterMetadata>) => {
    if (!current) return;
    updateReport({ crossFilters: current.crossFilters.map((filter) => filter.id === id ? { ...filter, ...update } : filter) });
    setResult(null);
  };
  const addCrossFilter = () => {
    if (!current || !relatedChildObjects[0]) return;
    updateReport({
      crossFilters: [...current.crossFilters, {
        id: crypto.randomUUID(),
        childObjectApiName: relatedChildObjects[0].apiName,
        mode: 'With',
        filters: []
      }]
    });
    setResult(null);
  };
  const addCrossSubfilter = (crossFilter: ReportCrossFilterMetadata) => {
    const childObject = objects.find((item) => item.apiName === crossFilter.childObjectApiName);
    const firstField = childObject?.fields[0]?.apiName;
    if (!firstField) return;
    updateCrossFilter(crossFilter.id, {
      filters: [...crossFilter.filters, {
        id: crypto.randomUUID(),
        fieldApiName: firstField,
        operator: 'Equals',
        value: '',
        values: [],
        locked: false
      }]
    });
  };
  const filteredReports = reports.filter((report) => `${report.label} ${report.apiName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // A report must remain discoverable when optional folder metadata is loading,
  // unavailable to this user, or refers to a deleted folder.
  const otherReports = filteredReports.filter(report => !report.folderId || !reportFolders.some(folder => folder.id === report.folderId));
  const openExistingReport = (report: ReportMetadata) => {
    setReportNewDraft(false);
    setDraft(cloneReportForEditing(report)); setSelectedApiName(report.apiName);
    setResult(null); setError(''); setRunPage(false);
  };
  const reportFilterValueControl = (
    fieldApiName: string,
    value: string,
    onChange: (nextValue: string) => void,
    ariaLabel: string,
    disabled = false,
    fields: FieldMetadata[] = reportObject?.fields ?? [],
    selectedValues: string[] = [],
    onValuesChange?: (nextValues: string[]) => void
  ) => {
    const field = fields.find((item) => item.apiName === fieldApiName);
    if (field?.picklistValues?.length) {
      return <select aria-label={ariaLabel} disabled={disabled} multiple={Boolean(onValuesChange)}
        value={onValuesChange ? selectedValues : value}
        onChange={(event) => onValuesChange
          ? onValuesChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
          : onChange(event.target.value)}>
        {!onValuesChange && <option value="">Select a value</option>}
        {field.picklistValues.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>;
    }
    if (field?.dataType === 'Checkbox') {
      return <select aria-label={ariaLabel} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select a value</option><option value="true">True</option><option value="false">False</option>
      </select>;
    }
    const inputType = field?.dataType === 'Date' ? 'date'
      : field?.dataType === 'DateTime' ? 'datetime-local'
        : /^(Number|Currency|Percent)(\(|$)/.test(field?.dataType ?? '') ? 'number' : 'text';
    return <input aria-label={ariaLabel} type={inputType} step={inputType === 'number' ? 'any' : undefined}
      disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Value" />;
  };
  type NumericSummary = {
    sums: Record<string, number>;
    counts: Record<string, number>;
    minimums: Record<string, number>;
    maximums: Record<string, number>;
  };
  const summaryFields = result
    ? result.report.fieldApiNames.filter((fieldApiName) =>
      (result.report.summaryOperations[fieldApiName]?.length ?? 0) > 0)
    : [];
  const summarySpecs = summaryFields.flatMap((fieldApiName) =>
    (result?.report.summaryOperations[fieldApiName] ?? []).map((operation) => ({ fieldApiName, operation })));
  const numericFields = reportObject?.fields.filter((field) =>
    current?.fieldApiNames.includes(field.apiName)
    && (field.formula
      ? /^(Number|Currency|Percent)$/.test(field.formula.returnType)
      : /^(Number|Currency|Percent)(\(|$)/.test(field.dataType))) ?? [];
  const summarizableFields = reportObject?.fields.filter((field) =>
    current?.fieldApiNames.includes(field.apiName)) ?? [];
  const dateGroupFields = reportObject?.fields.filter((field) =>
    (current?.groupByFieldApiNames.includes(field.apiName)
      || current?.columnGroupByFieldApiName === field.apiName)
    && /^(Date|DateTime)(\(|$)/.test(field.dataType)) ?? [];
  const reportFieldLabel = (fieldApiName: string) =>
    reportObject?.fields.find((field) => field.apiName === fieldApiName)?.label
    ?? current?.bucketFields?.find((bucket) => `Bucket_${bucket.apiName}` === fieldApiName)?.label
    ?? fieldApiName;
  const matrixColumnField = result?.report.columnGroupByFieldApiName;
  const matrixColumns = result && matrixColumnField
    ? [...new Set(result.summaryRows.map((group) => group.groupValues[matrixColumnField]))]
      .sort((left, right) => String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' }))
    : [];
  const matrixRowKey = (values: Record<string, unknown>) =>
    JSON.stringify(result?.report.groupByFieldApiNames.map((fieldApiName) => values[fieldApiName]) ?? []);
  const matrixGroupFor = (rowValues: Record<string, unknown>, columnValue: unknown) =>
    result?.summaryRows.find((group) => matrixRowKey(group.groupValues) === matrixRowKey(rowValues)
      && group.groupValues[matrixColumnField ?? ''] === columnValue);
  const summaryNumericValue = (summary: NumericSummary, fieldApiName: string, operation: ReportSummaryOperation) => operation === 'Count'
      ? summary.counts[fieldApiName]
      : operation === 'Sum'
      ? summary.sums[fieldApiName]
      : operation === 'Average'
        ? summary.counts[fieldApiName] ? summary.sums[fieldApiName] / summary.counts[fieldApiName] : undefined
        : operation === 'Minimum'
          ? summary.minimums[fieldApiName]
          : summary.maximums[fieldApiName];
  const formatSummaryValue = (summary: NumericSummary, fieldApiName: string, operation: ReportSummaryOperation) => {
    const value = summaryNumericValue(summary, fieldApiName, operation);
    return value === undefined
      ? '—'
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  };
  const combineNumericSummaries = (summaries: NumericSummary[], fieldApiNames: string[]): NumericSummary => ({
    sums: Object.fromEntries(fieldApiNames.map((fieldApiName) => [
      fieldApiName, summaries.reduce((total, summary) => total + (summary.sums[fieldApiName] ?? 0), 0)
    ])),
    counts: Object.fromEntries(fieldApiNames.map((fieldApiName) => [
      fieldApiName, summaries.reduce((total, summary) => total + (summary.counts[fieldApiName] ?? 0), 0)
    ])),
    minimums: Object.fromEntries(fieldApiNames.flatMap((fieldApiName) => {
      const values = summaries.flatMap((summary) => summary.minimums[fieldApiName] === undefined ? [] : [summary.minimums[fieldApiName]]);
      return values.length ? [[fieldApiName, Math.min(...values)]] : [];
    })),
    maximums: Object.fromEntries(fieldApiNames.flatMap((fieldApiName) => {
      const values = summaries.flatMap((summary) => summary.maximums[fieldApiName] === undefined ? [] : [summary.maximums[fieldApiName]]);
      return values.length ? [[fieldApiName, Math.max(...values)]] : [];
    }))
  });
  const chartOperation = summarySpecs[0];
  const groupedValueLabel = (fieldApiName: string, value: unknown) => {
    if (value === null || value === undefined) return '—';
    const grouping = result?.report.dateGroupings[fieldApiName];
    if (!grouping) return String(value);
    const text = String(value);
    if (grouping === 'Quarter') {
      const match = /^(\d{4})-Q([1-4])$/.exec(text);
      return match ? `Q${match[2]} ${match[1]}` : text;
    }
    if (grouping === 'Year') return text;
    const date = new Date(grouping === 'Month' ? `${text}-01T00:00:00Z`
      : /^\d{4}-\d{2}-\d{2}/.test(text) ? `${text.slice(0, 10)}T00:00:00Z` : text);
    if (!Number.isFinite(date.getTime())) return text;
    return new Intl.DateTimeFormat(undefined, grouping === 'Month'
      ? { month: 'long', year: 'numeric', timeZone: 'UTC' }
      : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
  };
  const chartGroups = result && matrixColumnField
    ? [...new Map(result.summaryRows.map((group) => [matrixRowKey(group.groupValues), group])).values()]
      .map((group) => {
        const cells = result.summaryRows.filter((item) => matrixRowKey(item.groupValues) === matrixRowKey(group.groupValues));
        return {
          groupValues: group.groupValues,
          rowCount: cells.reduce((total, cell) => total + cell.rowCount, 0),
          summary: combineNumericSummaries(cells, summaryFields)
        };
      })
    : result?.summaryRows.map((group) => ({ groupValues: group.groupValues, rowCount: group.rowCount, summary: group })) ?? [];
  const chartBars = result && result.report.showChart
    ? chartGroups.map((group) => ({
      label: groupedValueLabel(result.report.groupByFieldApiNames[0] ?? '', group.groupValues[result.report.groupByFieldApiNames[0] ?? '']),
      value: chartOperation
        ? summaryNumericValue(group.summary, chartOperation.fieldApiName, chartOperation.operation) ?? 0
        : group.rowCount
    }))
    : [];
  const chartMaximum = Math.max(1, ...chartBars.map((bar) => Math.abs(bar.value)));
  const updateSummaryOperation = (fieldApiName: string, operation: ReportSummaryOperation, enabled: boolean) => {
    if (!current) return;
    const operations = current.summaryOperations[fieldApiName] ?? [];
    const nextOperations = enabled
      ? [...operations, operation]
      : operations.filter((item) => item !== operation);
    const summaryOperations = { ...current.summaryOperations };
    if (nextOperations.length) summaryOperations[fieldApiName] = nextOperations;
    else delete summaryOperations[fieldApiName];
    updateReport({ summaryOperations });
    setResult(null);
  };

  return <div className="report-page">
    <div className="report-titlebar">
      <div className="back-title"><div><div className="eyebrow">Analytics / Reports</div><h1>{current?.label ?? 'Reports'}</h1></div></div>
      <div className="toolbar-actions">
        {!runPage && <button type="button" className="btn md-builder-panel-toggle"
          aria-controls="md-report-outline" aria-expanded={tabletOutlineOpen}
          onClick={()=>setTabletOutlineOpen(open=>!open)}>Reports &amp; outline</button>}
        {!runPage && !current && <button type="button" className="btn btn-brand" onClick={openReportTypeSelector}><Plus size={14} />New Report</button>}
        {runPage
          ? <><button className="btn" disabled={busy} onClick={() => setRunPage(false)}>Edit</button><button className="btn btn-brand" disabled={!current || busy} onClick={() => void run(pageOffset)}><Activity size={14} />{busy ? 'Running…' : 'Run'}</button></>
          : current ? <><button className="btn" title={!current ? 'Choose a report type to start' : !current.fieldApiNames.length ? 'Add at least one report column' : undefined} disabled={!current || busy || !current.label.trim() || !current.fieldApiNames.length} onClick={() => void save()}><Save size={14} />Save</button>
            <button className="btn btn-brand" disabled={!current || busy || !current.label.trim() || !current.fieldApiNames.length} onClick={() => void run()}><Activity size={14} />{busy ? 'Working…' : 'Save & Run'}</button></> : null}
        {current && reports.some((item) => item.apiName === current.apiName) && <button className="btn" disabled={busy} onClick={cloneCurrent}>Clone</button>}
        {current && reports.some((item) => item.apiName === current.apiName) && <button className="btn" disabled={busy} onClick={() => void deleteCurrent()}><Trash2 size={14} />Delete</button>}
      </div>
    </div>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <div className={`report-builder-layout md-builder-frame${runPage ? ' report-run-page' : ''}${fieldsPanelOpen && current && !runPage ? ' report-fields-open' : ''}${tabletOutlineOpen&&!runPage?' md-builder-library-open':''}`}>
      <aside className="report-outline" id="md-report-outline">
        <div className="mini-search"><Search size={13} /><input aria-label="Search reports" placeholder="Search reports" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        {!runPage && <button className="btn btn-brand btn-full" onClick={openReportTypeSelector}><Plus size={14} />New Report</button>}
        {reportFolders.map((folder) => {
          const folderReports = filteredReports.filter((report) => report.folderId === folder.id);
          return <div className="report-panel-block" key={folder.id}><h3>{folder.label.toLocaleUpperCase()} <span>{folderReports.length}</span></h3>
            {folderReports.map(report => <button className={`outline-field ${current?.apiName === report.apiName ? 'selected' : ''}`} key={report.apiName}
              onClick={() => openExistingReport(report)}><FileText size={14} />{report.label}</button>)}
            {!folderReports.length && <p className="dashboard-sidebar-empty">No reports in this folder.</p>}
          </div>;
        })}
        {otherReports.length > 0 && <div className="report-panel-block">
          <h3>OTHER REPORTS <span>{otherReports.length}</span></h3>
          {otherReports.map(report => <button className={`outline-field ${current?.apiName === report.apiName ? 'selected' : ''}`} key={report.apiName}
            onClick={() => openExistingReport(report)}><FileText size={14} />{report.label}</button>)}
        </div>}
        {current && !runPage && <div className="report-outline-tabs" role="tablist" aria-label="Report builder sections">
          <button role="tab" aria-selected={builderTab === 'Outline'} className={builderTab === 'Outline' ? 'active' : ''} onClick={() => setBuilderTab('Outline')}>Outline</button>
          <button role="tab" aria-selected={builderTab === 'Filters'} className={builderTab === 'Filters' ? 'active' : ''} onClick={() => setBuilderTab('Filters')}>Filters{reportFilterRestrictionCount ? ` (${reportFilterRestrictionCount})` : ''}</button>
        </div>}
        {current && !runPage && builderTab === 'Outline' && <div className="report-panel-block" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleFieldDrop(event, 'column')}>
          <h3>COLUMNS <span>{current.fieldApiNames.length}</span></h3>
          <div className="mini-search"><Search size={13} /><input aria-label="Search fields to add to outline" placeholder="Search fields" value={outlineFieldQuery} onChange={(event) => setOutlineFieldQuery(event.target.value)} /></div>
          {orderedOutlineFields.map((field) => {
            const columnIndex = current.fieldApiNames.indexOf(field.apiName);
            return <div className="dynamic-field-property-row" key={field.apiName}>
              <label className="checkbox-row property-check">
                <input type="checkbox" checked={columnIndex >= 0} onChange={(event) => toggleField(field.apiName, event.target.checked)} />{field.label}
              </label>
              {columnIndex >= 0 && <div className="property-position-actions">
                <button type="button" className="icon-button" aria-label={`Move ${field.label} column earlier`} title="Move column earlier"
                  disabled={columnIndex === 0} onClick={() => moveField(field.apiName, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="icon-button" aria-label={`Move ${field.label} column later`} title="Move column later"
                  disabled={columnIndex === current.fieldApiNames.length - 1} onClick={() => moveField(field.apiName, 1)}><ArrowDown size={13} /></button>
              </div>}
            </div>;
          })}
        </div>}
        {current && !runPage && builderTab === 'Outline' && <div className="report-panel-block">
          <h3>BUCKET FIELDS</h3>
          {(current.bucketFields ?? []).map((bucket) => {
            const bucketFieldApiName = `Bucket_${bucket.apiName}`;
            return <div className="report-cross-filter" key={bucket.apiName}>
              <div className="report-cross-filter-heading"><strong>{bucket.label}</strong>
                <button className="icon-button" aria-label={`Remove bucket ${bucket.label}`} onClick={() => {
                  const bucketFields = (current.bucketFields ?? []).filter((item) => item.apiName !== bucket.apiName);
                  updateReport({
                    bucketFields,
                    fieldApiNames: current.fieldApiNames.filter((item) => item !== bucketFieldApiName),
                    groupByFieldApiNames: current.groupByFieldApiNames.filter((item) => item !== bucketFieldApiName),
                    columnGroupByFieldApiName: current.columnGroupByFieldApiName === bucketFieldApiName ? null : current.columnGroupByFieldApiName
                  });
                  setResult(null);
                }}><X size={13} /></button>
              </div>
              <small>{reportObject?.fields.find((field) => field.apiName === bucket.fieldApiName)?.label}: {bucket.ranges.map((range) => range.label).join(', ')}</small>
              <label className="checkbox-row property-check"><input type="checkbox" checked={current.fieldApiNames.includes(bucketFieldApiName)}
                onChange={(event) => toggleField(bucketFieldApiName, event.target.checked)} />Add bucket as a report column</label>
            </div>;
          })}
          <label className="form-label" htmlFor="report-bucket-label">Bucket label</label>
          <input id="report-bucket-label" className="form-control" value={newBucketLabel} onChange={(event) => setNewBucketLabel(event.target.value)} />
          <label className="form-label" htmlFor="report-bucket-api-name">Bucket API name</label>
          <input id="report-bucket-api-name" className="form-control" value={newBucketApiName} onChange={(event) => setNewBucketApiName(event.target.value)} />
          <label className="form-label" htmlFor="report-bucket-source">Numeric source field</label>
          <select id="report-bucket-source" className="form-control" value={newBucketSourceField}
            onChange={(event) => setNewBucketSourceField(event.target.value)}>
            <option value="">Select source field</option>
            {reportObject?.fields.filter((field) => field.formula
              ? /^(Number|Currency|Percent)$/.test(field.formula.returnType)
              : /^(Number|Currency|Percent)(\(|$)/.test(field.dataType))
              .map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
          </select>
          {newBucketRanges.map((range, index) => <div className="report-cross-filter" key={`new-bucket-range-${index}`}>
            <label className="form-label" htmlFor={`report-bucket-range-label-${index}`}>Category {index + 1} label</label>
            <input id={`report-bucket-range-label-${index}`} className="form-control" value={range.label}
              onChange={(event) => updateNewBucketRange(index, { label: event.target.value })} />
            {index < newBucketRanges.length - 1 && <>
              <label className="form-label" htmlFor={`report-bucket-range-upper-${index}`}>
                Values below {newBucketRanges[index + 1].label || `Category ${index + 2}`}
              </label>
              <input id={`report-bucket-range-upper-${index}`} className="form-control" type="number" value={range.upperBound}
                onChange={(event) => updateNewBucketRange(index, { upperBound: event.target.value })} />
            </>}
            {newBucketRanges.length > 2 && <button type="button" className="icon-button"
              aria-label={`Remove bucket category ${index + 1}`} onClick={() => removeNewBucketRange(index)}><X size={13} /></button>}
          </div>)}
          <button type="button" className="outline-add" onClick={addNewBucketRange}><Plus size={12} />Add Category</button>
          <label className="checkbox-row property-check"><input type="checkbox" checked={newBucketBlanksAsZero} onChange={(event) => setNewBucketBlanksAsZero(event.target.checked)} />Treat blank values as zero</label>
          <button className="outline-add" onClick={addBucketField}><Plus size={12} />Add Bucket Field</button>
          {(current.bucketFields ?? []).map((bucket) => {
            const apiName = `Bucket_${bucket.apiName}`;
            return <label className="checkbox-row property-check" key={`group-${bucket.apiName}`}>
              <input type="checkbox" disabled={current.format === 'Tabular' || current.format === 'Matrix' && current.groupByFieldApiNames.length === 1 && current.groupByFieldApiNames.includes(apiName)}
                checked={current.groupByFieldApiNames.includes(apiName)} onChange={(event) => {
                  const groupByFieldApiNames = event.target.checked
                    ? [...current.groupByFieldApiNames, apiName].slice(0, 3)
                    : current.groupByFieldApiNames.filter((item) => item !== apiName);
                  updateReport({
                    groupByFieldApiNames,
                    format: groupByFieldApiNames.length && current.format === 'Tabular' ? 'Summary'
                      : !groupByFieldApiNames.length && current.format === 'Summary' ? 'Tabular' : current.format,
                    showDetails: groupByFieldApiNames.length ? current.showDetails : true
                  });
                  setResult(null);
                }} />Group rows by {bucket.label}
            </label>;
          })}
        </div>}
        {current && !runPage && builderTab === 'Outline' && <div className="report-panel-block"><h3>FORMAT</h3>
          <label className="form-label" htmlFor="report-format">Report format</label>
          <select id="report-format" className="form-control" value={current.format} onChange={(event) => {
            const format = event.target.value as ReportMetadata['format'];
            const rowGroups = format !== 'Tabular' && current.groupByFieldApiNames.length === 0
              ? [reportObject?.fields[0]?.apiName].filter((apiName): apiName is string => Boolean(apiName))
              : format === 'Tabular' ? [] : current.groupByFieldApiNames;
            const columnGroup = format === 'Matrix'
              ? current.columnGroupByFieldApiName ?? reportObject?.fields.find((field) => !rowGroups.includes(field.apiName))?.apiName ?? null
              : null;
            updateReport({
              format,
              groupByFieldApiNames: rowGroups,
              columnGroupByFieldApiName: columnGroup,
              summaryOperations: format === 'Tabular' ? {} : current.summaryOperations,
              dateGroupings: format === 'Tabular' ? {} : current.dateGroupings,
              showDetails: format === 'Tabular' ? true : current.showDetails,
              showChart: format === 'Tabular' ? false : current.showChart,
              rowLimit: format === 'Tabular'
                ? current.rowLimit
                : { ...current.rowLimit, limit: null }
            });
            setResult(null);
          }}>
            <option value="Tabular">Tabular</option><option value="Summary">Summary</option><option value="Matrix">Matrix</option>
          </select>
          {current.format === 'Matrix' && <>
            <label className="form-label" htmlFor="report-column-group">Group columns by</label>
            <select id="report-column-group" className="form-control" value={current.columnGroupByFieldApiName ?? ''}
              onChange={(event) => {
                const columnGroupByFieldApiName = event.target.value || null;
                const validDateFields = new Set([...current.groupByFieldApiNames, ...(columnGroupByFieldApiName ? [columnGroupByFieldApiName] : [])]);
                updateReport({
                  columnGroupByFieldApiName,
                  dateGroupings: Object.fromEntries(Object.entries(current.dateGroupings).filter(([apiName]) => validDateFields.has(apiName)))
                });
                setResult(null);
              }}>
              <option value="">Select a column grouping</option>
              {reportObject?.fields.filter((field) => !current.groupByFieldApiNames.includes(field.apiName)).map((field) =>
                <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
              {(current.bucketFields ?? []).filter((bucket) => !current.groupByFieldApiNames.includes(`Bucket_${bucket.apiName}`))
              .map((bucket) => <option key={bucket.apiName} value={`Bucket_${bucket.apiName}`}>{bucket.label}</option>)}
            </select>
          </>}
        </div>}
        {current && !runPage && builderTab === 'Outline' && <div className="report-panel-block"><h3>GROUP ROWS</h3>
          {reportObject?.fields.map((field) => <label className="checkbox-row property-check" key={field.apiName}>
            <input type="checkbox" disabled={current.format === 'Matrix' && current.groupByFieldApiNames.length === 1 && current.groupByFieldApiNames.includes(field.apiName)}
              checked={current.groupByFieldApiNames.includes(field.apiName)} onChange={(event) => {
              const groupByFieldApiNames = event.target.checked
                ? [...current.groupByFieldApiNames, field.apiName].slice(0, 3)
                : current.groupByFieldApiNames.filter((item) => item !== field.apiName);
              const validDateFields = new Set([...groupByFieldApiNames, ...(current.columnGroupByFieldApiName ? [current.columnGroupByFieldApiName] : [])]);
              const clearsSummaryGrouping = current.format === 'Summary' && !groupByFieldApiNames.length;
              updateReport({
                groupByFieldApiNames,
                dateGroupings: Object.fromEntries(Object.entries(current.dateGroupings).filter(([apiName]) => validDateFields.has(apiName))),
                ...(clearsSummaryGrouping ? { format: 'Tabular', summaryOperations: {}, showDetails: true, showChart: false } : {}),
                columnGroupByFieldApiName: groupByFieldApiNames.includes(current.columnGroupByFieldApiName ?? '')
                  ? current.columnGroupByFieldApiName
                  : null,
                sortFieldApiName: current.fieldApiNames.includes(field.apiName)
                  || current.sortFieldApiName !== field.apiName
                  || event.target.checked
                  ? current.sortFieldApiName
                  : null
              });
              setResult(null);
            }} />{field.label}
          </label>)}
        </div>}
        {current && !runPage && builderTab === 'Outline' && current.format !== 'Tabular' && current.groupByFieldApiNames.length > 0 && dateGroupFields.length > 0 && <div className="report-panel-block">
          <h3>DATE GROUPING</h3>
          {dateGroupFields.map((field) => <label className="form-label" key={field.apiName}>
            {field.label}
            <select className="form-control" aria-label={`Date grouping for ${field.label}`}
              value={current.dateGroupings[field.apiName] ?? 'Day'}
              onChange={(event) => {
                updateReport({ dateGroupings: { ...current.dateGroupings, [field.apiName]: event.target.value as ReportDateGrouping } });
                setResult(null);
              }}>
              {(['Day', 'Month', 'Quarter', 'Year'] as const).map((grouping) => <option key={grouping} value={grouping}>{grouping}</option>)}
            </select>
          </label>)}
        </div>}
        {current && !runPage && builderTab === 'Outline' && current.format !== 'Tabular' && current.groupByFieldApiNames.length > 0 && summarizableFields.length > 0 && <div className="report-panel-block">
          <h3>SUMMARIZE COLUMNS</h3>
          {summarizableFields.map((field) => <div key={field.apiName}>
            <strong className="report-summary-field-label">{field.label}</strong>
            {(numericFields.some((numericField) => numericField.apiName === field.apiName)
              ? ['Count', 'Sum', 'Average', 'Minimum', 'Maximum'] as const
              : ['Count'] as const).map((operation) => <label className="checkbox-row property-check" key={operation}>
              <input type="checkbox" checked={current.summaryOperations[field.apiName]?.includes(operation) ?? false}
                onChange={(event) => updateSummaryOperation(field.apiName, operation, event.target.checked)} />{operation}
            </label>)}
          </div>)}
        </div>}
        {current && !runPage && builderTab === 'Outline' && current.format !== 'Tabular' && current.groupByFieldApiNames.length > 0 && <div className="report-panel-block">
          <h3>REPORT DISPLAY</h3>
          <label className="checkbox-row property-check">
            <input type="checkbox" checked={current.showDetails}
              onChange={(event) => { updateReport({ showDetails: event.target.checked }); setResult(null); }} />
            Show Details
          </label>
          <label className="checkbox-row property-check">
            <input type="checkbox" checked={current.showChart}
              onChange={(event) => { updateReport({ showChart: event.target.checked }); setResult(null); }} />
            Show Chart
          </label>
        </div>}
        {current && !runPage && builderTab === 'Outline' && <div className="report-panel-block">
          <h3>FOLDER</h3>
          <label className="form-label" htmlFor="report-folder">Save report in</label>
          <select id="report-folder" className="form-control" value={current.folderId ?? ''}
            onChange={(event) => {
              const folder = reportFolders.find((item) => item.id === event.target.value);
              updateReport({ folderId: folder?.id ?? null, folderName: folder?.label ?? 'My Reports' });
              setResult(null);
            }}>
            <option value="">My Reports (create on save)</option>
            {reportFolders.filter((folder) => folder.accessLevel === 'Editor' || folder.accessLevel === 'Manager')
              .map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
          </select>
          {canManageReportFolders && <div className="report-folder-create">
            <label className="form-label" htmlFor="new-report-folder">New report folder</label>
            <input id="new-report-folder" className="form-control" maxLength={80} value={newReportFolderLabel}
              onChange={(event) => setNewReportFolderLabel(event.target.value)} placeholder="Folder name" />
            <select className="form-control" aria-label="New report folder audience" value={newReportFolderVisibility}
              onChange={(event) => setNewReportFolderVisibility(event.target.value as ReportFolderInput['visibility'])}>
              <option value="Private">Private</option><option value="All Users">All Users</option>
            </select>
            <label className="form-label" htmlFor="report-folder-share-type">Share with</label>
            <select id="report-folder-share-type" className="form-control" value={reportFolderShareType}
              onChange={(event) => {
                setReportFolderShareType(event.target.value as ReportFolderInput['shares'][number]['targetType']);
                setReportFolderShareTarget('');
              }}>
              <option value="User">User</option><option value="PublicGroup">Public group</option>
              <option value="PermissionSetGroup">Permission set group</option><option value="Role">Role</option>
              <option value="RoleAndSubordinates">Role and subordinates</option>
            </select>
            <select className="form-control" aria-label="Report folder share target" value={reportFolderShareTarget}
              onChange={(event) => setReportFolderShareTarget(event.target.value)}>
              <option value="">No additional share</option>
              {(reportFolderShareType === 'User' ? accessControl.users.map((item) => ({ id: item.id, label: item.name }))
                : reportFolderShareType === 'PublicGroup' ? accessControl.publicGroups.map((item) => ({ id: item.id, label: item.label }))
                  : reportFolderShareType === 'PermissionSetGroup' ? accessControl.permissionSetGroups.map((item) => ({ id: item.id, label: item.label }))
                    : accessControl.roles.map((item) => ({ id: item.id, label: item.name })))
                .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <select className="form-control" aria-label="Report folder share access level" value={reportFolderShareLevel}
              onChange={(event) => setReportFolderShareLevel(event.target.value as ReportFolderInput['shares'][number]['accessLevel'])}>
              <option value="Viewer">Viewer</option><option value="Editor">Editor</option><option value="Manager">Manager</option>
            </select>
            <button className="btn btn-full" disabled={!newReportFolderLabel.trim()} onClick={() => {
              void onSaveFolder({
                label: newReportFolderLabel.trim(),
                parentFolderId: null,
                shares: reportFolderShareTarget ? [{
                  targetType: reportFolderShareType,
                  targetId: reportFolderShareTarget,
                  accessLevel: reportFolderShareLevel
                }] : [],
                visibility: newReportFolderVisibility
              }).then((folder) => {
                updateReport({ folderId: folder.id, folderName: folder.label });
                setNewReportFolderLabel('');
                setReportFolderShareTarget('');
                setResult(null);
              }).catch((error) => {
                setError(error instanceof Error ? error.message : String(error));
              });
            }}><Plus size={14} />Create folder</button>
          </div>}
        </div>}
        {current && !runPage && builderTab === 'Outline' && <div className="report-panel-block">
          <h3>SORT ROWS</h3>
          <label className="form-label" htmlFor="report-sort-field">Sort field</label>
          <select id="report-sort-field" className="form-control" value={current.sortFieldApiName ?? ''}
            onChange={(event) => { updateReport({ sortFieldApiName: event.target.value || null }); setResult(null); }}>
            <option value="">Default order</option>
            {[...new Set([...current.fieldApiNames, ...current.groupByFieldApiNames, ...(current.columnGroupByFieldApiName ? [current.columnGroupByFieldApiName] : [])])].map((fieldApiName) => (
              <option key={fieldApiName} value={fieldApiName}>{reportFieldLabel(fieldApiName)}</option>
            ))}
          </select>
          <label className="form-label" htmlFor="report-sort-direction">Direction</label>
          <select id="report-sort-direction" className="form-control" disabled={!current.sortFieldApiName}
            value={current.sortDirection ?? 'Ascending'}
            onChange={(event) => { updateReport({ sortDirection: event.target.value as ReportMetadata['sortDirection'] }); setResult(null); }}>
            <option value="Ascending">Ascending</option><option value="Descending">Descending</option>
          </select>
        </div>}
        {current && !runPage && builderTab === 'Filters' && <div className="report-panel-block" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleFieldDrop(event, 'filter')}>
          <h3>FILTERS <button className="icon-button" aria-label="Add report filter" onClick={() => addFilter()}><Plus size={14} /></button></h3>
          <div className="mini-search"><Search size={13} /><input aria-label="Search fields to add as filters" placeholder="Search fields to add a filter" value={filterFieldQuery} onChange={(event) => setFilterFieldQuery(event.target.value)} /></div>
          {filterFieldQuery.trim() && filterFields.map((field) => <button className="outline-field" key={field.apiName} onClick={() => {
            addFilter(field.apiName);
            setFilterFieldQuery('');
          }}><Plus size={13} />{field.label}</button>)}
          <label className="form-label" htmlFor="report-show-me">Show Me</label>
          <select id="report-show-me" className="form-control" value={current.standardFilters.showMe}
            onChange={(event) => { updateReport({ standardFilters: { ...current.standardFilters, showMe: event.target.value as 'All' | 'My' | 'My Descendants' } }); setResult(null); }}>
            <option value="All">All {reportObject?.pluralLabel ?? 'records'}</option>
            <option value="My" disabled={!reportObject?.fields.some((field) => field.apiName === 'OwnerId')}>My {reportObject?.pluralLabel ?? 'records'}</option>
            <option value="My Descendants">My Descendants (including me)</option>
          </select>
          {reportStatusFields.length > 0 && <>
            <label className="form-label" htmlFor="report-status-field">Status field</label>
            <select id="report-status-field" className="form-control" value={current.standardFilters.statusFieldApiName ?? ''}
              onChange={(event) => { updateReport({ standardFilters: { ...current.standardFilters, statusFieldApiName: event.target.value || null, statusSelection: event.target.value ? current.standardFilters.statusSelection : 'All' } }); setResult(null); }}>
              <option value="">No status filter</option>
              {reportStatusFields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
            </select>
            {current.standardFilters.statusFieldApiName && <select aria-label={`${reportObject?.fields.find((field) => field.apiName === current.standardFilters.statusFieldApiName)?.label ?? 'Status'} filter`}
              className="form-control" value={current.standardFilters.statusSelection}
              onChange={(event) => { updateReport({ standardFilters: { ...current.standardFilters, statusSelection: event.target.value as ReportStandardFiltersMetadata['statusSelection'] } }); setResult(null); }}>
              <option value="All">All statuses</option><option value="Open">Open</option><option value="Closed">Closed</option>
              {reportObject?.fields.find((field) => field.apiName === current.standardFilters.statusFieldApiName)?.picklistValues
                ?.filter((value) => !['All', 'Open', 'Closed'].includes(value))
                .map((value) => <option key={value} value={value}>{value}</option>)}
            </select>}
          </>}
          <label className="form-label" htmlFor="report-date-field">Date field</label>
          <select id="report-date-field" className="form-control" value={current.standardFilters.dateFieldApiName ?? ''}
            onChange={(event) => { updateReport({ standardFilters: { ...current.standardFilters, dateFieldApiName: event.target.value || null, dateRange: event.target.value ? current.standardFilters.dateRange : 'All Time' } }); setResult(null); }}>
            <option value="">No date filter</option>
            {reportDateFields.map((field) => <option key={field.apiName} value={field.apiName}>
              {reportObject?.apiName === 'Case' && field.apiName === 'CreatedDate' ? 'Opened Date' : field.label}
            </option>)}
          </select>
          <label className="form-label" htmlFor="report-date-range">Date range</label>
          <select id="report-date-range" className="form-control"
            value={current.standardFilters.dateFieldApiName ? current.standardFilters.dateRange : 'All Time'}
            onChange={(event) => {
              const dateRange = event.target.value as ReportDateRange;
              updateReport({ standardFilters: {
                ...current.standardFilters,
                dateFieldApiName: current.standardFilters.dateFieldApiName ?? reportDateFields[0]?.apiName ?? null,
                dateRange
              } });
              setResult(null);
            }}>
            {(['All Time', 'Today', 'Yesterday', 'Last 7 Days', 'Next 7 Days', 'Next 30 Days', 'This Week', 'Last Week', 'This Month', 'Last Month', 'This Quarter', 'Last Quarter', 'This Year', 'Last Year'] as ReportDateRange[]).map((range) =>
              <option key={range} value={range}>{range}</option>)}
          </select>
          {current.filters.length > 0 && <>
            <label className="form-label" htmlFor="report-filter-logic">Filter logic</label>
            <input id="report-filter-logic" className="form-control" aria-describedby="report-filter-logic-help"
              value={current.filterLogic} onChange={(event) => { updateReport({ filterLogic: event.target.value }); setResult(null); }} />
            <p className="dashboard-sidebar-empty" id="report-filter-logic-help">Use filter numbers with AND, OR, NOT, and parentheses; for example: (1 OR 2) AND NOT 3.</p>
          </>}
          {current.filters.map((filter, index) => <div className="report-filter-editor" key={filter.id}>
            <span className="report-filter-number">{index + 1}.</span>
            <select aria-label="Report filter field" value={filter.fieldApiName} onChange={(event) => {
              const fieldApiName = event.target.value;
              updateFilter(filter.id, {
                fieldApiName,
                operator: reportObject?.fields.find((field) => field.apiName === fieldApiName)?.dataType === 'Multi-Select Picklist' ? 'Includes' : 'Equals',
                value: '',
                values: []
              });
            }}>
              {reportObject?.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
            </select>
            <select aria-label="Report filter operator" value={filter.operator} onChange={(event) => updateFilter(filter.id, { operator: event.target.value as ReportFilterMetadata['operator'] })}>
              {operatorsForField(filter.fieldApiName).map((operator) => <option key={operator}>{operator}</option>)}
            </select>
            {reportFilterValueControl(filter.fieldApiName, filter.value,
              (value) => updateFilter(filter.id, { value }), 'Report filter value',
              filter.operator === 'Is Null' || filter.operator === 'Is Not Null',
              undefined,
              filter.values.length ? filter.values : filter.value ? [filter.value] : [],
              (values) => updateFilter(filter.id, { value: '', values }))}
            <label className="checkbox-row report-filter-lock"><input type="checkbox" checked={filter.locked} onChange={(event) => updateFilter(filter.id, { locked: event.target.checked })} />Locked</label>
            <button className="icon-button" aria-label="Remove report filter" onClick={() => updateReport({ filters: current.filters.filter((item) => item.id !== filter.id), filterLogic: 'All' })}><X size={13} /></button>
          </div>)}
          {!current.filters.length && <p className="dashboard-sidebar-empty">No filters applied.</p>}
          {current.crossFilters.map((crossFilter) => {
            const childObject = objects.find((item) => item.apiName === crossFilter.childObjectApiName);
            return <div className="report-cross-filter" key={crossFilter.id}>
              <div className="report-cross-filter-heading">
                <strong>Cross filter</strong>
                <button className="icon-button" aria-label="Remove cross filter" onClick={() => updateReport({ crossFilters: current.crossFilters.filter((item) => item.id !== crossFilter.id) })}><X size={13} /></button>
              </div>
              <div className="report-filter-editor">
                <select aria-label="Cross-filter mode" value={crossFilter.mode} onChange={(event) => updateCrossFilter(crossFilter.id, { mode: event.target.value as 'With' | 'Without' })}>
                  <option value="With">with</option><option value="Without">without</option>
                </select>
                <select aria-label="Cross-filter child object" value={crossFilter.childObjectApiName} onChange={(event) => updateCrossFilter(crossFilter.id, { childObjectApiName: event.target.value, filters: [] })}>
                  {relatedChildObjects.map((item) => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
                </select>
              </div>
              {crossFilter.filters.map((filter) => <div className="report-filter-editor report-cross-subfilter" key={filter.id}>
                <select aria-label="Cross-filter field" value={filter.fieldApiName} onChange={(event) => {
                  const fieldApiName = event.target.value;
                  const multiSelect = childObject?.fields.find((field) => field.apiName === fieldApiName)?.dataType === 'Multi-Select Picklist';
                  updateCrossFilter(crossFilter.id, { filters: crossFilter.filters.map((item) => item.id === filter.id
                    ? { ...item, fieldApiName, operator: multiSelect ? 'Includes' : 'Equals', value: '', values: [] }
                    : item) });
                }}>
                  {childObject?.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                </select>
                <select aria-label="Cross-filter operator" value={filter.operator} onChange={(event) => updateCrossFilter(crossFilter.id, { filters: crossFilter.filters.map((item) => item.id === filter.id ? { ...item, operator: event.target.value as ReportFilterMetadata['operator'] } : item) })}>
                  {operatorsForField(filter.fieldApiName, childObject?.fields ?? []).map((operator) => <option key={operator}>{operator}</option>)}
                </select>
                {reportFilterValueControl(filter.fieldApiName, filter.value,
                  (value) => updateCrossFilter(crossFilter.id, { filters: crossFilter.filters.map((item) => item.id === filter.id ? { ...item, value } : item) }),
                  'Cross-filter value', filter.operator === 'Is Null' || filter.operator === 'Is Not Null', childObject?.fields ?? [],
                  filter.values.length ? filter.values : filter.value ? [filter.value] : [],
                  (values) => updateCrossFilter(crossFilter.id, { filters: crossFilter.filters.map((item) => item.id === filter.id ? { ...item, value: '', values } : item) }))}
                <button className="icon-button" aria-label="Remove cross-filter condition" onClick={() => updateCrossFilter(crossFilter.id, { filters: crossFilter.filters.filter((item) => item.id !== filter.id) })}><X size={13} /></button>
              </div>)}
              <button className="outline-add" disabled={!childObject} onClick={() => addCrossSubfilter(crossFilter)}><Plus size={12} />Add {childObject?.label ?? 'child'} filter</button>
            </div>;
          })}
          <button className="outline-add" disabled={!relatedChildObjects.length} onClick={addCrossFilter}><Plus size={12} />Add Cross Filter</button>
          <hr />
          <h3>ROW LIMIT</h3>
          <label className="form-label" htmlFor="report-row-limit">Maximum rows (tabular)</label>
          <input id="report-row-limit" className="form-control" type="number" min="1"
            disabled={current.format !== 'Tabular'}
            value={current.rowLimit.limit ?? ''}
            onChange={(event) => {
              const limit = event.target.value ? Number(event.target.value) : null;
              updateReport({ rowLimit: { ...current.rowLimit, limit, sortFieldApiName: limit === null ? null : current.rowLimit.sortFieldApiName ?? current.fieldApiNames[0] ?? null } });
              setResult(null);
            }} />
          {current.rowLimit.limit !== null && <>
            <label className="form-label" htmlFor="report-row-limit-sort">Sort by</label>
            <select id="report-row-limit-sort" className="form-control" value={current.rowLimit.sortFieldApiName ?? ''}
              onChange={(event) => { updateReport({ rowLimit: { ...current.rowLimit, sortFieldApiName: event.target.value || null } }); setResult(null); }}>
              {current.fieldApiNames.map((fieldApiName) => <option key={fieldApiName} value={fieldApiName}>{reportFieldLabel(fieldApiName)}</option>)}
            </select>
            <select className="form-control" aria-label="Row limit sort direction" value={current.rowLimit.sortDirection}
              onChange={(event) => { updateReport({ rowLimit: { ...current.rowLimit, sortDirection: event.target.value as 'Ascending' | 'Descending' } }); setResult(null); }}>
              <option value="Ascending">Ascending</option><option value="Descending">Descending</option>
            </select>
          </>}
        </div>}
      </aside>
      {current && fieldsPanelOpen && !runPage && <aside className="report-fields-panel">
        <div className="report-panel-block">
          <h3>FIELDS <button className="icon-button" aria-label="Close fields panel" onClick={() => setFieldsPanelOpen(false)}><X size={13} /></button></h3>
          <div className="mini-search"><Search size={13} /><input aria-label="Search fields" placeholder="Search fields" value={fieldQuery} onChange={(event) => setFieldQuery(event.target.value)} /></div>
          {searchableFields.map((field) => <button className="outline-field" key={field.apiName} draggable
            onDragStart={(event) => event.dataTransfer.setData('text/report-field', field.apiName)}
            onClick={() => toggleField(field.apiName, !current.fieldApiNames.includes(field.apiName))}>
            <span>{current.fieldApiNames.includes(field.apiName) ? '✓' : '+'}</span>{field.label}
          </button>)}
          {!searchableFields.length && <p className="dashboard-sidebar-empty">No matching fields.</p>}
        </div>
      </aside>}
      <div className="report-preview" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleFieldDrop(event, 'column')}>
        {!current ? <div className="dashboard-empty-state"><h2>Create a report to get started</h2><p>Choose a report type and add at least one column to enable Save and Save &amp; Run.</p><p>Choose an object, select columns, and run it against records you can access.</p><button className="btn btn-brand" onClick={openReportTypeSelector}><Plus size={14} />New Report</button></div> : <>
          <div className="report-toolbar">{!runPage && <div className="report-type-select"><span>Report source</span><select aria-label="Report object" value={current.objectApiName} onChange={(event) => changeObject(event.target.value)}>
            {availableObjects.map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}
          </select><button className="btn" onClick={() => { setFieldsPanelOpen((open) => !open); setFieldQuery(''); }}>{fieldsPanelOpen ? 'Hide Fields' : 'Show Fields'}</button>
            <button className="btn" disabled={busy || previewBusy} onClick={() => void refreshPreview(0)}><RefreshCw size={14} />{previewBusy ? 'Refreshing…' : 'Refresh Preview'}</button>
            <label className="checkbox-row"><input type="checkbox" checked={autoPreview} onChange={(event) => setAutoPreview(event.target.checked)} />Automatic Preview</label>
          </div>}<span>{result ? `${runPage ? 'Last run' : 'Preview updated'} ${new Date(result.generatedAt).toLocaleString()}` : 'Preview not refreshed'}</span></div>
          {!runPage && <>
            <div className="report-results-header"><label className="form-label" htmlFor="report-name">Report name</label><input id="report-name" className="form-control" maxLength={80} value={current.label} onChange={(event) => {
                const nextLabel=event.target.value;
                const isSaved=!reportNewDraft;
                const nextApiName=generateMetadataApiName(nextLabel)||'New_Report';
                updateReport({label:nextLabel,...(!isSaved&&!manualReportApiName?{apiName:suggestMetadataApiName(nextApiName,reports.map(item=>item.apiName))}: {})});
              }} /></div>
            <details><summary>Advanced: API Name</summary>
              <label className="form-label" htmlFor="report-api-name">API Name</label>
              <input id="report-api-name" className="form-control" value={current.apiName}
                disabled={!reportNewDraft}
                onChange={event=>{setManualReportApiName(true);updateReport({apiName:event.target.value});}} />
            </details>
            {reportNewDraft&&reports.some(item=>item.apiName.toLowerCase()===current.apiName.toLowerCase())&&
              <p role="alert">API Name is already in use.</p>}
            <label className="form-label" htmlFor="report-description">Description</label>
            <textarea id="report-description" className="form-control" rows={2} maxLength={500} value={current.description} onChange={(event) => updateReport({ description: event.target.value })} />
          </>}
          {current.filters.length > 0 && <section className="report-run-filters" aria-label="Report run filters">
            <h2>Filter values for this run</h2>
            {current.filters.map((filter) => <label className="report-run-filter" key={filter.id}>
              <span>{reportObject?.fields.find((field) => field.apiName === filter.fieldApiName)?.label ?? filter.fieldApiName} · {filter.operator}{filter.locked ? ' · Locked' : ''}</span>
              {reportFilterValueControl(filter.fieldApiName, runFilterValues[filter.id] ?? filter.value,
                (value) => setRunFilterValues((values) => ({ ...values, [filter.id]: value })),
                `Run value for ${filter.fieldApiName}`, filter.locked || filter.operator === 'Is Null' || filter.operator === 'Is Not Null',
                undefined,
                runFilterSelections[filter.id] ?? (filter.values.length ? filter.values : filter.value ? [filter.value] : []),
                (values) => {
                  setRunFilterSelections((selections) => ({ ...selections, [filter.id]: values }));
                  setRunFilterValues((runValues) => ({ ...runValues, [filter.id]: '' }));
                })}
            </label>)}
          </section>}
          {result && <div className="report-results-header"><strong>{reportObject?.label ?? current.objectApiName} Records · {result.totalRows.toLocaleString()} rows</strong></div>}
          {result && (result.report.format === 'Matrix' || result.report.groupByFieldApiNames.length > 0 || summaryFields.length > 0) && <section className="report-summary">
            <h2>Summary</h2>
            {result.report.showChart && <div className="report-format-chart" role="img" aria-label={`${result.report.label} summary chart`}>
              {chartBars.length
                ? chartBars.map((bar, index) => <div className="report-format-chart-bar" key={`${bar.label}-${index}`}>
                  <span>{bar.label}</span><i style={{ width: `${Math.max(1, Math.abs(bar.value) / chartMaximum * 100)}%` }} />
                  <strong>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bar.value)}</strong>
                </div>)
                : <p className="dashboard-no-data">No grouped results to chart.</p>}
            </div>}
            {result.subtotalRows.length > 0 && <section className="report-subtotals">
              <h3>Group Subtotals</h3>
              <div className="permission-table-wrap" role="region" aria-label="Report results table" tabIndex={0}><table className="slds-table report-results">
                <thead><tr>
                  {result.report.groupByFieldApiNames.map((fieldApiName) => (
                    <th scope="col" key={fieldApiName}>{reportFieldLabel(fieldApiName)}</th>
                  ))}
                  {result.report.format === 'Matrix' && result.report.columnGroupByFieldApiName && (
                    <th scope="col">{reportObject?.fields.find((field) => field.apiName === result.report.columnGroupByFieldApiName)?.label ?? result.report.columnGroupByFieldApiName}</th>
                  )}
                  <th scope="col">Record Count</th>
                  {summarySpecs.map(({ fieldApiName, operation }) => (
                    <th scope="col" key={`${fieldApiName}-${operation}`}>{operation} of {reportFieldLabel(fieldApiName)}</th>
                  ))}
                </tr></thead>
                <tbody>{result.subtotalRows.map((subtotal) => <tr key={`${subtotal.groupLevel}-${JSON.stringify(subtotal.groupValues)}`}>
                  {result.report.groupByFieldApiNames.map((fieldApiName, index) => (
                    <td key={fieldApiName}>{index === subtotal.groupLevel - 1
                      ? `${reportFieldLabel(fieldApiName)} subtotal`
                      : index < subtotal.groupLevel
                        ? groupedValueLabel(fieldApiName, subtotal.groupValues[fieldApiName])
                        : ''}</td>
                  ))}
                  {result.report.format === 'Matrix' && result.report.columnGroupByFieldApiName && (
                    <td>{groupedValueLabel(result.report.columnGroupByFieldApiName, subtotal.groupValues[result.report.columnGroupByFieldApiName])}</td>
                  )}
                  <td>{subtotal.rowCount.toLocaleString()}</td>
                  {summarySpecs.map(({ fieldApiName, operation }) => (
                    <td key={`${fieldApiName}-${operation}`}>{formatSummaryValue(subtotal, fieldApiName, operation)}</td>
                  ))}
                </tr>)}</tbody>
              </table></div>
            </section>}
            {result.report.format === 'Matrix' && matrixColumnField
              ? <div className="permission-table-wrap" role="region" aria-label="Report results table" tabIndex={0}><table className="slds-table report-results">
                <thead><tr>
                  {result.report.groupByFieldApiNames.map((fieldApiName) => <th scope="col" key={fieldApiName}>{reportFieldLabel(fieldApiName)}</th>)}
                  {matrixColumns.flatMap((columnValue) => [
                    <th scope="col" key={`${String(columnValue)}-count`}>{groupedValueLabel(matrixColumnField, columnValue)} · Count</th>,
                    ...summarySpecs.map(({ fieldApiName, operation }) => <th scope="col" key={`${String(columnValue)}-${fieldApiName}-${operation}`}>
                      {groupedValueLabel(matrixColumnField, columnValue)} · {operation} {reportFieldLabel(fieldApiName)}
                    </th>)
                  ])}
                </tr></thead>
                <tbody>{[...new Map(result.summaryRows.map((group) => [matrixRowKey(group.groupValues), group])).values()].map((group) =>
                  <tr key={matrixRowKey(group.groupValues)}>
                    {result.report.groupByFieldApiNames.map((fieldApiName) => <td key={fieldApiName}>{groupedValueLabel(fieldApiName, group.groupValues[fieldApiName])}</td>)}
                    {matrixColumns.flatMap((columnValue) => {
                      const cell = matrixGroupFor(group.groupValues, columnValue);
                      return [
                        <td key={`${String(columnValue)}-count`}>{cell?.rowCount.toLocaleString() ?? '0'}</td>,
                        ...summarySpecs.map(({ fieldApiName, operation }) => <td key={`${String(columnValue)}-${fieldApiName}-${operation}`}>
                          {cell ? formatSummaryValue(cell, fieldApiName, operation) : '—'}
                        </td>)
                      ];
                    })}
                  </tr>)}</tbody>
                <tfoot><tr><td colSpan={result.report.groupByFieldApiNames.length}>Grand Total</td>
                  {matrixColumns.flatMap((columnValue) => {
                    const cells = result.summaryRows.filter((group) => group.groupValues[matrixColumnField] === columnValue);
                    return [
                      <td key={`${String(columnValue)}-count`}>{cells.reduce((total, cell) => total + cell.rowCount, 0).toLocaleString()}</td>,
                      ...summarySpecs.map(({ fieldApiName, operation }) => <td key={`${String(columnValue)}-${fieldApiName}-${operation}`}>
                        {formatSummaryValue(combineNumericSummaries(cells, summaryFields), fieldApiName, operation)}
                      </td>)
                    ];
                  })}
                </tr></tfoot>
              </table></div>
              : <div className="permission-table-wrap" role="region" aria-label="Report results table" tabIndex={0}><table className="slds-table report-results">
              <thead><tr>
                {result.report.groupByFieldApiNames.map((fieldApiName) => <th scope="col" key={fieldApiName}>{reportFieldLabel(fieldApiName)}</th>)}
                <th scope="col">Record Count</th>
                {summarySpecs.map(({ fieldApiName, operation }) => (
                  <th scope="col" key={`${fieldApiName}-${operation}`}>{operation} of {reportFieldLabel(fieldApiName)}</th>
                ))}
              </tr></thead>
              <tbody>{result.summaryRows.map((group) => <tr key={JSON.stringify(group.groupValues)}>
                {result.report.groupByFieldApiNames.map((fieldApiName) => <td key={fieldApiName}>{groupedValueLabel(fieldApiName, group.groupValues[fieldApiName])}</td>)}
                <td>{group.rowCount.toLocaleString()}</td>
                {summarySpecs.map(({ fieldApiName, operation }) => (
                  <td key={`${fieldApiName}-${operation}`}>{formatSummaryValue(group, fieldApiName, operation)}</td>
                ))}
              </tr>)}</tbody>
              <tfoot><tr>
                {result.report.groupByFieldApiNames.length > 0 && <td colSpan={result.report.groupByFieldApiNames.length}>Grand Total</td>}
                <td>{result.summaryTotals.rowCount.toLocaleString()}</td>
                {summarySpecs.map(({ fieldApiName, operation }) => (
                  <td key={`${fieldApiName}-${operation}`}>{formatSummaryValue(result.summaryTotals, fieldApiName, operation)}</td>
                ))}
              </tr></tfoot>
            </table></div>}
          </section>}
          {result && result.report.showDetails && <div className="permission-table-wrap" role="region" aria-label="Report results table" tabIndex={0}><table className="slds-table report-results"><thead><tr>{result.report.fieldApiNames.map((fieldApiName) => <th scope="col" key={fieldApiName}>{reportFieldLabel(fieldApiName)}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, index) => <tr key={String(row.Id ?? index)}>{result.report.fieldApiNames.map((fieldApiName) => <td key={fieldApiName}>{row[fieldApiName] === null || row[fieldApiName] === undefined ? '—' : String(row[fieldApiName])}</td>)}</tr>)}</tbody>
          </table>{!result.rows.length && <p className="dashboard-no-data">No records match this report.</p>}
            <div className="report-footer"><span>Showing {result.totalRows ? result.offset + 1 : 0}–{result.offset + result.rows.length} of {result.totalRows.toLocaleString()} records</span><span><button className="icon-button subtle" aria-label="Previous report page" disabled={busy || previewBusy || result.offset === 0} onClick={() => void (runPage ? run(Math.max(0, pageOffset - result.pageSize)) : refreshPreview(Math.max(0, pageOffset - result.pageSize)))}><ChevronLeft size={14} /></button><button className="icon-button subtle" aria-label="Next report page" disabled={busy || previewBusy || !result.truncated} onClick={() => void (runPage ? run(pageOffset + result.pageSize) : refreshPreview(pageOffset + result.pageSize))}><ChevronRight size={14} /></button></span></div>
          </div>}
          {current.groupByFieldApiNames.length > 0 && <div className="report-footer">Grouped by {current.groupByFieldApiNames.map(reportFieldLabel).join(', ')}</div>}
        </>}
      </div>
    </div>
    {reportTypeSelectorOpen && <div className="report-type-modal-backdrop" role="presentation">
      <section className="report-type-modal" role="dialog" aria-modal="true" aria-labelledby="report-type-title">
        <div className="report-type-modal-heading"><h2 id="report-type-title">New Report</h2><button className="icon-button" aria-label="Close report type chooser" onClick={() => setReportTypeSelectorOpen(false)}><X size={15} /></button></div>
        <p>Select a report type to start building your report.</p>
        <label className="form-label" htmlFor="report-type-search">Search report types</label>
        <div className="mini-search"><Search size={13} /><input id="report-type-search" placeholder="Search report types, objects, or fields" value={reportTypeQuery} onChange={(event) => setReportTypeQuery(event.target.value)} /></div>
        <div className="report-type-categories" role="group" aria-label="Report type category">
          {(['All', ...reportTypeCategories]).map((category) => <button key={category}
            className={reportTypeCategory === category ? 'active' : ''}
            onClick={() => setReportTypeCategory(category)}>{category === 'All' ? 'All Categories' : category}</button>)}
        </div>
        <div className="report-type-options">
          {searchableReportObjects.map((object) => <label className="report-type-option" key={object.apiName}>
            <input type="radio" name="report-type" value={object.apiName} checked={selectedReportObjectApiName === object.apiName} onChange={() => setSelectedReportObjectApiName(object.apiName)} />
            <span><strong>{object.label}</strong><small>{reportTypeCategoryForObject(object)} · {object.fields.length} fields</small></span>
          </label>)}
          {!searchableReportObjects.length && <p className="dashboard-sidebar-empty">No report types match your search.</p>}
        </div>
        <div className="report-type-modal-actions">
          <button className="btn" onClick={() => setReportTypeSelectorOpen(false)}>Cancel</button>
          <button className="btn btn-brand" disabled={!selectedReportObjectApiName || !searchableReportObjects.some((object) => object.apiName === selectedReportObjectApiName)}
            onClick={() => createReport(selectedReportObjectApiName)}>Start Report</button>
        </div>
      </section>
    </div>}
  </div>;
}


