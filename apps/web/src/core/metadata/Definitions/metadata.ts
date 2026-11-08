import type {PermissionPolicyExtras,ProfilePolicyExtras} from './rbacPolicyMetadata';
import {
  BarChart3,
  Building2,
  Database,
  FileText,
  LayoutTemplate,
  Store,
  ShieldCheck,
  Workflow,
  type LucideIcon
} from 'lucide-react';
export type WorkspaceId =
  | 'home'
  | 'object-manager'
  | 'data-loader'
  | 'page-builder'
  | 'dashboard-builder'
  | 'report-builder'
  | 'flow-builder'
  | 'flow-interviews'
  | 'scheduled-actions'
  | 'scheduled-flows'
  | 'flow-logs'
  | 'automation-settings'
  | 'app-manager'
  | 'app-exchange'
  | 'named-credentials'
  | 'company-settings'
  | 'tenant-management'
  | 'rbac';

export type FieldMetadata = {
  id?: string;
  apiName: string;
  label: string;
  dataType: string;
  required: boolean;
  unique: boolean;
  externalId?: boolean;
  caseSensitive?: boolean;
  description?: string;
  helpText?: string;
  picklistValues?: string[];
  picklistRestricted?: boolean;
  globalValueSetApiName?: string;
  controllerFieldApiName?: string;
  valueSettings?: Record<string, string[]>;
  trackHistory?: boolean;
  defaultValue?: string | number | boolean;
  autoNumberFormat?: string;
  formula?: { expression: string; returnType: string };
  rollup?: {
    childObject: string;
    relationshipField: string;
    operation: 'COUNT' | 'SUM' | 'MIN' | 'MAX';
    sourceField?: string;
    filterLogic?: 'All' | 'Any';
    filters?: Array<{ fieldApiName: string; operator: string; value: string }>;
  };
  relationship?: {
    type: 'Lookup' | 'Master-Detail' | 'Hierarchical';
    targetObject: string;
    relationshipName: string;
    childRelationshipName: string;
    deleteBehavior?: 'Clear' | 'Restrict' | 'Cascade';
    allowReparenting?: boolean;
  };
};

export type PageLayoutSectionMetadata = {
  id: string;
  label: string;
  columns: 1 | 2;
  fieldApiNames: string[];
  /** Layout-only presentation rules never bypass server Field RBAC. */
  requiredFieldApiNames?: string[];
  readOnlyFieldApiNames?: string[];
};

export type PageLayoutCustomLinkMetadata = {
  id: string;
  label: string;
  url: string;
  openInNewWindow: boolean;
  visibleWhenField?: string;
  visibleWhenValue?: string;
};

export type RelatedListSettingsMetadata = {
  columns?: string[];
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  filterField?: string;
  filterValue?: string;
  filterOperator?: 'Equals' | 'Includes' | 'Excludes';
  pageSize?: 10 | 25 | 50;
  showNewAction?: boolean;
  showRowActions?: boolean;
};

export type PageLayoutMetadata = {
  id: string;
  label: string;
  sections: PageLayoutSectionMetadata[];
  relatedLists: string[];
  relatedListSettings?: Record<string,RelatedListSettingsMetadata>;
  actions: string[];
  /** Conditions affect visibility only; OneEngine continues to enforce action permissions. */
  actionVisibility?: Record<string,{fieldApiName:string;equalsValue:string;operator?:'Equals'|'NotEquals'|'Contains'|'IsBlank'|'IsNotBlank'|'Never'}>;
  /** Published per-device UI overrides; permission checks stay on the server. */
  actionOverrides?: Partial<Record<'Edit'|'Clone'|'Delete',string>>;
  customLinks?: PageLayoutCustomLinkMetadata[];
};

export type PageLayoutAssignmentMetadata = {
  profileId: string;
  recordTypeId: string;
  pageLayoutId: string;
};

export type CompactLayoutMetadata = {
  id: string;
  label: string;
  fieldApiNames: string[];
};

export type CompactLayoutAssignmentMetadata = {
  profileId: string;
  recordTypeId: string;
  compactLayoutId: string;
};

export type RecordTypeMetadata = {
  id: string;
  label: string;
  developerName: string;
  description?: string;
  active: boolean;
  isDefault: boolean;
  businessProcessApiName?: string;
  picklistValues?: Record<string, string[]>;
};

export type FieldSetMetadata = {
  apiName: string;
  label: string;
  fieldApiNames: string[];
};

export type RelatedLookupFilterMetadata = {
  id: string;
  fieldApiName: string;
  relatedObject: string;
  relatedFieldApiName: string;
  operator: 'Equals' | 'Not Equal To' | 'Contains' | 'Starts With' | 'Greater Than' | 'Less Than' | 'Is Null' | 'Is Not Null';
  value: string;
  valueFieldApiName?: string;
  required: boolean;
};

export type QuickActionComponentBinding = {
  property: string;
  source: 'Literal' | 'Record ID' | 'Object API' | 'Record Field';
  fieldApiName?: string;
  value?: string;
};

export type ObjectActionMetadata = {
  id: string;
  label: string;
  type: 'Standard' | 'Custom';
  enabled: boolean;
  behavior?: 'Set Field Value' | 'Log Call' | 'Run Flow' | 'Open Component' | 'Create Related' | 'Send Email';
  credentialId?: string;
  fromEmail?: string;
  fieldApiName?: string;
  value?: string;
  targetObjectApi?: string;
  relationshipFieldApi?: string;
  flowApiName?: string;
  componentApiName?: string;
  presentation?: 'Modal' | 'Side Panel';
  componentBindings?: QuickActionComponentBinding[];
  placement?: 'Default' | 'Header' | 'Highlights' | 'Publisher' | 'Everywhere';
};
 
export type ObjectSettingsMetadata = {
  allowReports: boolean;
  allowActivities: boolean;
  trackFieldHistory: boolean;
  allowInChatter: boolean;
  allowSearch?: boolean;
  deploymentStatus: 'In Development' | 'Deployed';
  recordNameType: 'Text' | 'Auto Number';
  recordNameFormat: string;
};

export type ObjectMetadata = {
  id?: string;
  apiName: string;
  label: string;
  pluralLabel: string;
  kind: 'Standard Object' | 'Custom Object';
  description: string;
  helpText?: string;
  fields: FieldMetadata[];
  revision?: number;
  pageLayouts?: PageLayoutMetadata[];
  pageLayoutAssignments?: PageLayoutAssignmentMetadata[];
  recordTypes?: RecordTypeMetadata[];
  compactLayouts?: CompactLayoutMetadata[];
  compactLayoutAssignments?: CompactLayoutAssignmentMetadata[];
  compactLayout?: { label: string; fieldApiNames: string[] };
  fieldSets?: FieldSetMetadata[];
  searchLayouts?: {
    searchResults?: string[];
    lookupDialog?: string[];
    lookupPhoneDialog?: string[];
    searchableFields?: Array<{fieldApiName:string;weight:'A'|'B'|'C'|'D'}>;
  };
  relatedLookupFilters?: RelatedLookupFilterMetadata[];
  relatedLookupFilterLogic?: Record<string, 'All' | 'Any'>;
  listViewFilter?: { fieldApiName: string; value: string; operator?: 'Equals' | 'Includes' | 'Excludes' };
  listViewButtons?: string[];
  limits?: { fields: number | null; pageLayouts: number | null; recordTypes: number | null; fieldSets: number | null };
  actions?: ObjectActionMetadata[];
  customTab?: { style: 'Blue' | 'Green' | 'Orange' | 'Purple' | 'Red' | 'Teal' | 'Yellow' } | null;
  settings?: ObjectSettingsMetadata;
};

export type FlowElementMetadata = {
  id: number;
  type: string;
  label: string;
  config: Record<string, unknown>;
};

export type NamedCredentialMetadata = {
  id: string;
  name: string;
  label: string;
  protocol: 'HTTPS' | 'SMTP';
  baseUrl: string;
  authType: 'None' | 'Bearer' | 'Basic' | 'API Key' | 'OAuth Client Credentials' | 'OAuth Authorization Code' | 'Authorization Scheme';
  headerName: string;
  hasSecret: boolean;
  webhookId?: string | null;
  webhookEnabled?: boolean;
  webhookCallbackUrl?: string | null;
  enabled?: boolean;
  configuration?: Record<string, string>;
  configurationLabels?: Record<string, string>;
  keyId: string;
  updatedAt: string;
};

export type EmailAlertMetadata = {
  id: string;
  name: string;
  label: string;
  objectApiName: string;
  namedCredentialId: string;
  fromEmail: string;
  recipients: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomNotificationMetadata = {
  id: string;
  recipientId: string;
  title: string;
  body: string;
  flowApiName: string;
  sentBy: string;
  createdAt: string;
  readAt: string | null;
};

export type ApprovalRequestMetadata = {
  id: string;
  groupId: string;
  objectApiName: string;
  objectLabel: string;
  recordId: string;
  recordName: string;
  flowApiName: string;
  submittedBy: string;
  submittedByName: string;
  approverId: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Canceled';
  comments: string;
  decisionComments: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
};

export type ApprovalProcessMetadata = {
  apiName: string;
  label: string;
  objectApiName: string;
  approverUserIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalProcessInput = Omit<ApprovalProcessMetadata, 'createdAt' | 'updatedAt'>;

export type FlowConnectorMetadata = {
  id: string;
  from: number;
  to: number;
  label: string;
  kind: 'normal' | 'fault' | 'scheduled' | 'async';
  scheduledPath?: {
    timeSourceFieldApiName: string;
    offsetAmount: number;
    offsetUnit: 'Minutes' | 'Hours' | 'Days';
  };
};

export type FlowResourceMetadata = {
  name: string;
  label: string;
  type: 'Variable' | 'Record' | 'Record Collection' | 'Formula' | 'Constant' | 'Choice' | 'Choice Set' | 'Text Template';
  dataType: string;
  isCollection: boolean;
  availableForInput: boolean;
  availableForOutput: boolean;
  value?: unknown;
};

export type FlowVersionMetadata = {
  versionNumber: number;
  status: 'Draft' | 'Active' | 'Obsolete';
  savedAt: string;
  label?: string;
  description?: string;
  flowType?: 'Record-Triggered Flow' | 'Screen Flow' | 'In-Screen Flow' | 'Autolaunched Flow' | 'Flow Orchestration' | 'Schedule-Triggered Flow' | 'Platform Event-Triggered Flow';
  triggerObject?: string | null;
  startConfig?: Record<string, unknown>;
  elements: FlowElementMetadata[];
  connectors: FlowConnectorMetadata[];
  resources: FlowResourceMetadata[];
  tests?: FlowTestCaseMetadata[];
};

export type FlowValidationMetadata = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type FlowExecutionLogMetadata = {
  id: string;
  flowApiName: string;
  flowLabel: string;
  trigger: 'Manual' | 'Scheduled' | 'Record-Triggered' | 'Scheduled Path' | 'Async Path' | 'Wait Interview';
  failedAt: string;
  error: string;
  userId: string | null;
  status?: 'pending' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  flowType?: string;
  versionNumber?: number;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
};

export type FlowInterviewMetadata = {
  id: string;
  flowApiName: string;
  flowLabel: string;
  versionNumber: number;
  kind: 'screen' | 'wait' | 'scheduled' | 'async' | 'orchestration';
  userId: string;
  userName: string;
  screenLabel: string | null;
  recordId: string | null;
  createdAt: string;
  expiresAt: string;
  waitUntil: string | null;
  retryAt: string | null;
  attempts: number;
};

export type FlowTestCaseMetadata = {
  id: string;
  label: string;
  input: Record<string, unknown>;
  event?: 'created' | 'updated' | 'deleted';
  record?: Record<string, unknown>;
  prior?: Record<string, unknown> | null;
  isClone?: boolean;
  expectedStatus: 'completed' | 'waiting' | 'skipped';
  expectedOutputs?: Record<string, unknown>;
};

export type FlowDefinitionMetadata = {
  id?: string;
  apiName: string;
  label: string;
  description?: string;
  createdAt?: string;
  createdBy?: string;
  lastModifiedAt?: string;
  lastModifiedBy?: string;
  flowType: 'Record-Triggered Flow' | 'Screen Flow' | 'In-Screen Flow' | 'Autolaunched Flow' | 'Flow Orchestration' | 'Schedule-Triggered Flow' | 'Platform Event-Triggered Flow';
  status: 'Draft' | 'Active';
  versionNumber: number;
  activeVersion: number | null;
  triggerObject: string | null;
  startConfig: Record<string, unknown>;
  elements: FlowElementMetadata[];
  connectors: FlowConnectorMetadata[];
  resources: FlowResourceMetadata[];
  versions: FlowVersionMetadata[];
  tests?: FlowTestCaseMetadata[];
};

export type PlatformEventMetadata = {
  apiName: string;
  label: string;
  description: string;
  fields: FieldMetadata[];
};

export type PageComponentMetadata = {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  visible: boolean;
  region?: 'header' | 'main' | 'sidebar';
  parentId?: string;
  position?: { x: number; y: number; width: number; height: number };
};

export type LightningPageTemplate =
  | 'one-region'
  | 'header-main'
  | 'main-sidebar'
  | 'header-main-sidebar';

export type PageLayoutVariant = 'Mobile' | 'Desktop' | 'Tablet' | 'Custom';

export type LightningPageMetadata = {
  /** Draft and published are independent SQL revisions of each device layout. */
  layoutVariant?: PageLayoutVariant;
  draftRevision?: number;
  publishedRevision?: number;
  revision?: number;
  apiName: string; scope?: 'tenant'|'platform-system'; ownerNamespace?: string; definitionVersion?: number; overridePolicy?: 'presentation-only'|'none'; requiredPermissions?: string[];
  label: string;
  updatedAt?: string;
  targetObject: string;
  pageType: 'Record Page' | 'App Page' | 'Home Page' | 'In-Screen Page' | 'Print Template';
  /** Object-owned record pages: independent View and Edit templates. */
  recordMode?: 'View' | 'Edit';
  layoutMode: 'template' | 'free-canvas';
  template?: LightningPageTemplate;
  canvasWidth: number;
  canvasHeight: number;
  /** Whole page background, independent of component and container fill. */
  canvasFillColor?: string;
  /** Custom variant: auto-select when viewport matches a published, assigned target. */
  customTargetEnabled?: boolean;
  customTargetMinWidth?: number;
  customTargetMaxWidth?: number;
  status: 'Draft' | 'Active';
  devices: Array<'Desktop' | 'Tablet' | 'Phone' | 'Custom'>;
  components: PageComponentMetadata[];
  activationAssignments?: PageActivationAssignmentMetadata[];
};

export type DashboardComponentMetadata = {
  id: string;
  title: string;
  subtitle?: string;
  footer?: string;
  type: 'Metric' | 'Chart' | 'Table' | 'Rich Text' | 'Image' | 'Custom';
  customComponentApiName?: string;
  reportApiName?: string;
  properties?: Record<string, unknown>;
  richTextContent?: string;
  imageUrl?: string;
  imageAltText?: string;
  objectApiName: string;
  width?: 'Quarter' | 'Half' | 'ThreeQuarter' | 'Full';
  height?: 'Short' | 'Medium' | 'Tall';
  aggregation: 'Count' | 'Sum' | 'Average' | 'Minimum' | 'Maximum';
  measureFieldApiName: string | null;
  groupByFieldApiName: string | null;
  seriesFieldApiName?: string | null;
  gaugeMin?: number;
  gaugeMax?: number;
  gaugeRange1EndPercent?: number;
  gaugeRange2EndPercent?: number;
  showLegend?: boolean;
  showValues?: boolean;
  chartDataLabelPosition?: 'Auto' | 'Inside' | 'Outside';
  chartSortOrder?: 'Ascending' | 'Descending';
  chartColorPalette?: 'Salesforce' | 'Colorblind Safe' | 'Monochrome';
  chartLimit?: number;
  chartXAxisMinimum?: number | null;
  chartXAxisMaximum?: number | null;
  chartYAxisMinimum?: number | null;
  chartYAxisMaximum?: number | null;
  chartValueFormat?: 'Number' | 'Currency' | 'Percent';
  chartCurrencyCode?: string;
  chartDecimalPlaces?: number;
  xAxisFieldApiName?: string | null;
  xAxisTitle?: string;
  yAxisTitle?: string;
  showGridlines?: boolean;
  legendPosition?: 'Bottom' | 'Right' | 'Top';
  chartType: 'Bar' | 'Column' | 'Horizontal Bar' | 'Stacked Bar' | 'Stacked Column' | '100% Stacked Bar' | '100% Stacked Column' | 'Line' | 'Area' | 'Scatter' | 'Donut' | 'Pie' | 'Funnel' | 'Gauge';
  displayFieldApiNames: string[];
};

export type DashboardFilterMetadata = {
  id: string;
  objectApiName: string;
  fieldApiName: string;
  operator: 'Equals' | 'Not Equal To' | 'Contains' | 'Starts With' | 'Greater Than' | 'Less Than' | 'Includes' | 'Excludes' | 'Is Null' | 'Is Not Null';
  value: string;
};

export type DashboardMetadata = {
  apiName: string;
  label: string;
  description: string;
  folderName: string;
  folderId?: string | null;
  folderAccessLevel?: 'Viewer' | 'Editor' | 'Manager' | null;
  ownerUserId: string;
  runningUserId?: string | null;
  allowViewerToSelectRunningUser?: boolean;
  visibility: 'Private' | 'All Users';
  sharedUserIds: string[];
  sharedPermissionSetGroupIds: string[];
  filterLogic: 'All' | 'Any';
  status: 'Draft' | 'Deployed';
  components: DashboardComponentMetadata[];
  filters: DashboardFilterMetadata[];
  refreshIntervalMinutes?: 0 | 1 | 5 | 15 | 60;
};

export type DashboardFolderShareMetadata = {
  targetType: 'User' | 'PublicGroup' | 'PermissionSetGroup' | 'Role' | 'RoleAndSubordinates' | 'Territory';
  targetId: string;
  accessLevel: 'Viewer' | 'Editor' | 'Manager';
};

export type DashboardTerritoryMetadata = {
  id: string;
  label: string;
  parentTerritoryId: string | null;
  userIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type DashboardFolderMetadata = {
  id: string;
  label: string;
  parentFolderId: string | null;
  ownerUserId: string;
  shares: DashboardFolderShareMetadata[];
  createdAt: string;
  updatedAt: string;
  accessLevel?: 'Viewer' | 'Editor' | 'Manager' | null;
};

export type DashboardFolderInput = Pick<DashboardFolderMetadata, 'label' | 'parentFolderId' | 'shares'>;

export type DashboardSnapshot = {
  id: string;
  dashboardApiName: string;
  label: string;
  createdAt: string;
  createdBy: string;
  runningUserId?: string;
  subscriptionId?: string;
  filters: DashboardFilterMetadata[];
  crossFilter?: DashboardFilterMetadata;
  crossFilters?: DashboardFilterMetadata[];
  components: Array<{
    componentId: string;
    title: string;
    subtitle?: string;
    footer?: string;
    type: 'Metric' | 'Chart' | 'Table' | 'Rich Text' | 'Image' | 'Custom';
    width?: DashboardComponentMetadata['width'];
    height?: DashboardComponentMetadata['height'];
    customHtml?: string | null;
    richTextContent?: string;
    imageUrl?: string;
    imageAltText?: string;
    unavailableReason?: string | null;
    chartType: DashboardComponentMetadata['chartType'] | null;
    chartSortOrder: 'Ascending' | 'Descending';
    chartColorPalette?: 'Salesforce' | 'Colorblind Safe' | 'Monochrome';
    chartLimit: number;
    chartXAxisMinimum?: number | null;
    chartXAxisMaximum?: number | null;
    chartYAxisMinimum?: number | null;
    chartYAxisMaximum?: number | null;
    chartValueFormat?: 'Number' | 'Currency' | 'Percent';
    chartCurrencyCode?: string;
    chartDecimalPlaces?: number;
    xAxisFieldApiName?: string | null;
    xAxisTitle?: string;
    yAxisTitle?: string;
    showGridlines?: boolean;
    legendPosition?: 'Bottom' | 'Right' | 'Top';
    aggregation: DashboardComponentMetadata['aggregation'];
    gaugeMin: number;
    gaugeMax: number;
    gaugeRange1EndPercent: number;
    gaugeRange2EndPercent: number;
    showLegend: boolean;
    showValues: boolean;
    chartDataLabelPosition?: 'Auto' | 'Inside' | 'Outside';
    objectApiName: string;
    groupByLabel: string | null;
    totalRows: number;
    metricValue: number | null;
    columns: Array<{ apiName: string; label: string }>;
    buckets: Array<{ label: string; value: number; series?: Record<string, number> }>;
    rows: Array<Record<string, unknown>>;
  }>;
};

export type DashboardSubscriptionInput = {
  label: string;
  frequency: 'Daily' | 'Weekly';
  localTime: string;
  timeZone: string;
  dayOfWeek: number | null;
  recipientUserIds: string[];
  namedCredentialId: string;
  fromEmail: string;
  active: boolean;
  saveSnapshots: boolean;
};

export type DashboardSubscription = DashboardSubscriptionInput & {
  id: string;
  dashboardApiName: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: 'Never' | 'Success' | 'Failed';
  lastRunError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportFilterMetadata = {
  id: string;
  fieldApiName: string;
  operator: DashboardFilterMetadata['operator'] | 'Does Not Contain' | 'Greater Than or Equal To' | 'Less Than or Equal To' | 'Includes' | 'Excludes';
  value: string;
  values: string[];
  locked: boolean;
};

export type ReportCrossFilterMetadata = {
  id: string;
  childObjectApiName: string;
  mode: 'With' | 'Without';
  filters: ReportFilterMetadata[];
};

export type ReportDateRange =
  | 'All Time'
  | 'Today'
  | 'Yesterday'
  | 'Last 7 Days'
  | 'Next 7 Days'
  | 'Next 30 Days'
  | 'This Week'
  | 'Last Week'
  | 'This Month'
  | 'Last Month'
  | 'This Quarter'
  | 'Last Quarter'
  | 'This Year'
  | 'Last Year';

export type ReportStandardFiltersMetadata = {
  showMe: 'All' | 'My' | 'My Descendants';
  dateFieldApiName: string | null;
  dateRange: ReportDateRange;
  statusFieldApiName: string | null;
  statusSelection: string;
};

export type ReportRowLimitMetadata = {
  limit: number | null;
  sortFieldApiName: string | null;
  sortDirection: 'Ascending' | 'Descending';
};

export type ReportSummaryOperation = 'Count' | 'Sum' | 'Average' | 'Minimum' | 'Maximum';
export type ReportDateGrouping = 'Day' | 'Month' | 'Quarter' | 'Year';
export type ReportBucketRangeMetadata = {
  label: string;
  lowerBound: number | null;
  upperBound: number | null;
};
export type ReportBucketMetadata = {
  apiName: string;
  label: string;
  fieldApiName: string;
  ranges: ReportBucketRangeMetadata[];
  treatBlanksAsZero: boolean;
};

export type ReportMetadata = {
  reportType: 'Standard';
  apiName: string;
  label: string;
  description: string;
  objectApiName: string;
  fieldApiNames: string[];
  groupByFieldApiNames: string[];
  filterLogic: string;
  format: 'Tabular' | 'Summary' | 'Matrix';
  columnGroupByFieldApiName?: string | null;
  sortFieldApiName?: string | null;
  sortDirection?: 'Ascending' | 'Descending';
  filters: ReportFilterMetadata[];
  standardFilters: ReportStandardFiltersMetadata;
  crossFilters: ReportCrossFilterMetadata[];
  rowLimit: ReportRowLimitMetadata;
  summaryOperations: Record<string, ReportSummaryOperation[]>;
  dateGroupings: Record<string, ReportDateGrouping>;
  bucketFields?: ReportBucketMetadata[];
  showDetails: boolean;
  showChart: boolean;
  folderName: string;
  folderId: string | null;
};

export type ReportFolderMetadata = DashboardFolderMetadata & {
  visibility: 'Private' | 'All Users';
  accessLevel: 'Viewer' | 'Editor' | 'Manager' | null;
};
export type ReportFolderInput = Pick<ReportFolderMetadata, 'label' | 'parentFolderId' | 'shares' | 'visibility'>;

export type ReportRunMetadata = {
  report: ReportMetadata;
  rows: Array<Record<string, unknown>>;
  summaryRows: Array<{
    groupValues: Record<string, unknown>;
    rowCount: number;
    sums: Record<string, number>;
    counts: Record<string, number>;
    minimums: Record<string, number>;
    maximums: Record<string, number>;
  }>;
  subtotalRows: Array<{
    groupValues: Record<string, unknown>;
    groupLevel: number;
    rowCount: number;
    sums: Record<string, number>;
    counts: Record<string, number>;
    minimums: Record<string, number>;
    maximums: Record<string, number>;
  }>;
  summaryTotals: {
    rowCount: number;
    sums: Record<string, number>;
    counts: Record<string, number>;
    minimums: Record<string, number>;
    maximums: Record<string, number>;
  };
  totalRows: number;
  offset: number;
  pageSize: number;
  truncated: boolean;
  generatedAt: string;
};

export type ComponentEventPayloadField={apiName:string;label:string;kind:'TEXT'|'NUMBER'|'BOOLEAN'|'OBJECT';fields?:ComponentEventPayloadField[]};
export type ComponentEventDefinition={apiName:string;label:string;payloadFields?:ComponentEventPayloadField[]};
export type LibraryComponentMetadata = { category?: string; eventDefinitions?: ComponentEventDefinition[]; propertyDefinitions?: import('../../components/Properties/componentSettingDefinitions').ComponentSettingDefinition[]; primitiveMetadata?: import('../../components/RegisteredComponent/sharedPrimitiveMetadata').PrimitiveMetadata;
  tenantId?: string;
  apiName: string;
  label: string;
  description: string;
  surfaces: Array<'page' | 'dashboard' | 'flow' | 'platform'>;
  resize?: {
    defaultWidth: number;
    defaultHeight: number;
    minWidth: number;
    minHeight: number;
  };
  jsxSource: string;
  cssSource: string;
  compiledJs: string;
  scopedCss: string;
  version: number;
  updatedAt: string;
  status?: 'Draft' | 'Published';
  publishedVersion?: number;
  trustedBundled?: boolean; scope?: 'platform-system';
  revisions?: Array<{
    version: number; label: string; description: string; surfaces: Array<'page' | 'dashboard' | 'flow' | 'platform'>;
    resize: NonNullable<LibraryComponentMetadata['resize']>; propertyDefinitions?: LibraryComponentMetadata['propertyDefinitions'];
    jsxSource: string; cssSource: string; compiledJs: string; scopedCss: string; updatedAt: string;
  }>;
  pendingDraft?: {
    version: number; label: string; description: string; surfaces: Array<'page' | 'dashboard' | 'flow' | 'platform'>;
    resize: NonNullable<LibraryComponentMetadata['resize']>; propertyDefinitions?: LibraryComponentMetadata['propertyDefinitions'];
    jsxSource: string; cssSource: string; compiledJs: string; scopedCss: string; updatedAt: string;
  };
};

export type ConnectorSettingFieldMetadata = {
  apiName: string;
  label: string;
  value: string;
};

export type ConnectorSettingsMetadata = {
  apiName: string;
  label: string;
  fields: ConnectorSettingFieldMetadata[];
};

export type ConnectorProviderMetadata = {
  connectorKey: string;
  name: string;
  authType: 'NONE' | 'BEARER' | 'BASIC' | 'API_KEY';
  baseUrl: string;
  authHeader?: string;
  authCredential?: string;
  credentialsSchema: Array<{ name: string; label: string; secret: boolean; required: boolean }>;
  operations: Record<string, { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string }>;
  test?: {
    method: 'GET' | 'HEAD';
    path: string;
    expectedStatus: number;
    responseValidation?: { jsonPath: string; equals: string };
  };
  timeoutMs: number;
  retryPolicy: { maxAttempts: number };
  status: 'ACTIVE' | 'INACTIVE';
};

export type IntegrationConnectionMetadata = {
  id: string;
  connectorKey: string;
  name: string;
  configuration: Record<string, string>;
  status: 'ACTIVE' | 'INACTIVE';
  hasCredentials: boolean;
  credentialFields: Array<{ name: string; label: string; secret: boolean; required: boolean; configured: boolean }>;
  testStatus: 'Connected' | 'Failed' | 'Not configured' | 'Test unavailable' | null;
  lastTestedAt: string | null;
  lastTestMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardWidgetMetadata = PageComponentMetadata;

export type PageActivationAssignmentMetadata = {
  id: string;
  scope: 'Org Default' | 'App Default' | 'App and Profile' | 'App, Record Type, and Profile';
  appId: string | null;
  profileId: string | null;
  recordTypeId: string | null;
  formFactors: Array<'Desktop' | 'Phone' | 'Tablet' | 'Custom'>;
};

export type PermissionSetMetadata = PermissionPolicyExtras & {
  id: string;
  label: string;
  apiName: string;
  license: string;
  description: string;
  systemPermissions: string[];
  objectPermissions: Record<string, { read: boolean; create: boolean; edit: boolean; delete: boolean; viewAll: boolean; modifyAll: boolean }>;
  recordTypePermissions: Record<string, boolean>;
  appPermissions?: Record<string, boolean>;
  tabPermissions?: Record<string, boolean>;
  navigationDefaultAccess?: 'Allow' | 'Deny';
  recordDataScopes?: Record<string, 'all' | 'descendants' | 'own'>;
  fieldPermissions: Record<string, { read: boolean; edit: boolean; create?: boolean; delete?: boolean }>;
};

export type PermissionSetGroupMetadata = {
  id: string;
  label: string;
  apiName: string;
  description: string;
  permissionSetIds: string[];
  calculationStatus: 'Updated' | 'Updating' | 'Failed';
  lastCalculatedAt: string | null;
  mutedSystemPermissions: string[];
  mutedObjectPermissions: Record<string, { read: boolean; create: boolean; edit: boolean; delete: boolean; viewAll: boolean; modifyAll: boolean }>;
  mutedRecordTypePermissions: Record<string, boolean>;
  mutedAppPermissions?: Record<string, boolean>;
  mutedTabPermissions?: Record<string, boolean>;
  mutedFieldPermissions: Record<string, { read?: boolean; edit?: boolean; create?: boolean; delete?: boolean }>;
};

export type ProfileMetadata = ProfilePolicyExtras & {
  id: string;
  label: string;
  apiName: string;
  license: string;
  description: string;
  isStandard: boolean;
  systemPermissions: string[];
  objectPermissions: Record<string, { read: boolean; create: boolean; edit: boolean; delete: boolean; viewAll: boolean; modifyAll: boolean }>;
  recordTypePermissions: Record<string, boolean>;
  appPermissions?: Record<string, boolean>;
  tabPermissions?: Record<string, boolean>;
  fieldPermissions: Record<string, { read: boolean; edit: boolean; create?: boolean; delete?: boolean }>;
};

export type UserMetadata = {
  id: string;
  name: string;
  username: string;
  role: string;
  roleId: string;
  profileId: string;
  permissionSetIds: string[];
  permissionSetGroupIds: string[];
  timeZone: string;
  locale: string;
  currencyIsoCode?: string;
  userType?: 'internal' | 'external';
  externalAccountId?: string;
};

export type RoleMetadata = {
  id: string;
  name: string;
  apiName: string;
  parentRoleId: string | null;
};

export type PublicGroupMetadata = {
  id: string;
  label: string;
  apiName: string;
  description: string;
  userIds: string[];
  roleIds: string[];
  roleAndSubordinateIds: string[];
  groupIds: string[];
};

export type QueueMetadata = {
  id: string;
  label: string;
  apiName: string;
  description: string;
  supportedObjectApiNames: string[];
  userIds: string[];
  roleIds: string[];
  roleAndSubordinateIds: string[];
  publicGroupIds: string[];
};

export type SharingRuleMetadata = {
  id: string;
  label: string;
  apiName: string;
  objectApiName: string;
  active: boolean;
  type: 'OwnerBased' | 'CriteriaBased';
  ownerRoleIds: string[];
  criteria: Array<{
    fieldApiName: string;
    operator: 'Equals' | 'Not Equals' | 'Contains' | 'Starts With' | 'Greater Than' | 'Less Than' | 'Is Null';
    value: string;
  }>;
  filterLogic: 'All' | 'Any';
  targetType: 'User' | 'PublicGroup' | 'Role' | 'RoleAndSubordinates';
  targetId: string;
  accessLevel: 'Read' | 'Edit';
};

export type RestrictionConditionMetadata = {
  field:string;
  operator:'eq'|'ne'|'in'|'notIn'|'isNull'|'notNull';
  value?:string|string[]|number|boolean|null;
};
export type RestrictionRuleMetadata = {
  id:string;tenantId:string;objectApiName:string;enabled:boolean;
  subjectType:'all'|'user'|'role'|'external';subjectId?:string;
  conditionLogic:'all'|'any';conditions:RestrictionConditionMetadata[];
};
export type SharingSettingMetadata = {
  defaultAccess:'Private'|'Public Read Only'|'Public Read/Write';
  grantAccessUsingHierarchies:boolean;
  restrictionRules?:RestrictionRuleMetadata[];
  portalEnabled?:boolean;
  portalAccountField?:string;
};
export type AccessControlMetadata = {
  tenantId?:string;revision?:number;
  profiles: ProfileMetadata[];
  permissionSets: PermissionSetMetadata[];
  permissionSetGroups: PermissionSetGroupMetadata[];
  roles: RoleMetadata[];
  publicGroups: PublicGroupMetadata[];
  queues: QueueMetadata[];
  sharingRules: SharingRuleMetadata[];
  users: UserMetadata[];
  sharingSettings: Record<string, SharingSettingMetadata>;
};

export type CurrencySettingsMetadata = {
  corporateCurrency: string;
  standardVatRate: number;
  currencies: Array<{ currencyIsoCode: string; conversionRate: number }>;
};

export type WorkspaceMetadata = {
  id: WorkspaceId;
  label: string;
  icon: LucideIcon;
};

export const workspaces: WorkspaceMetadata[] = [
  { id: 'home', label: 'Setup Home', icon: LayoutTemplate },
  { id: 'object-manager', label: 'Object Manager', icon: Database },
  { id: 'data-loader', label: 'Universal Data Loader', icon: Database },
  { id: 'page-builder', label: 'Page Builder', icon: LayoutTemplate },
  { id: 'dashboard-builder', label: 'Dashboards', icon: BarChart3 },
  { id: 'report-builder', label: 'Reports', icon: FileText },
  { id: 'flow-builder', label: 'Flows', icon: Workflow },
  { id: 'automation-settings', label: 'Process Automation Settings', icon: Workflow },
  { id: 'scheduled-actions', label: 'Scheduled Actions', icon: Workflow },
  { id: 'app-manager', label: 'App Manager', icon: LayoutTemplate },
  { id: 'app-exchange', label: 'AppExchange', icon: Store },
  { id: 'named-credentials', label: 'Named Credentials', icon: Database },
  { id: 'company-settings', label: 'Company Settings', icon: Building2 },
  { id: 'tenant-management', label: 'Tenant Management', icon: Building2 },
  { id: 'rbac', label: 'Users & Permissions', icon: ShieldCheck }
];

export const setupNavigation = [
  { group: 'Platform Administration', items: ['Tenant Management'] },
  { group: 'Company Settings', items: ['Company Settings', 'Security & Recovery', 'Connected Apps', 'Audit Trail'] },
  { group: 'Platform Tools', items: ['Setup Home', 'Object Manager', 'Records', 'Universal Data Loader', 'Page Builder', 'App Manager', 'AppExchange'] },
  { group: 'Integrations', items: ['Named Credentials', 'Webhook Endpoints', 'Named Devices'] },
  { group: 'Automation', items: ['Flows', 'Paused and Waiting Interviews', 'Scheduled Actions', 'Scheduled Flows', 'Flow History', 'Process Automation Settings'] },
  { group: 'Analytics', items: ['Reports Builder', 'Reports View', 'Dashboard Builder', 'Dashboard View'] },
  { group: 'Security', items: ['Users', 'Roles', 'Public Groups', 'Profiles', 'Permission Sets', 'Permission Set Groups', 'Sharing Settings', 'Sharing Rules'] }
];

export type LightningAppMetadata = {
  apiName: string; installationAppKey?: string;
  label: string;
  description: string;
  navigationItems: string[];
  navigationPageApiNames: string[];
  navigationOrder: Array<{ type: 'Object' | 'App Page'; apiName: string }>;
  brandColor: string;
  utilityItems: Array<'Notes' | 'History'>;
};

export const objectMetadata: ObjectMetadata[] = [
  {
    apiName: 'User',
    label: 'User',
    pluralLabel: 'Users',
    kind: 'Standard Object',
    description: 'Platform users who belong to this tenant.',
    fields: [
      { apiName: 'Name', label: 'Full Name', dataType: 'Text(121)', required: true, unique: false },
      { apiName: 'Email', label: 'Email', dataType: 'Email', required: true, unique: true },
      { apiName: 'Username', label: 'Username', dataType: 'Text(80)', required: true, unique: true },
      { apiName: 'IsActive', label: 'Active', dataType: 'Checkbox', required: true, unique: false },
      { apiName: 'UserRoleId', label: 'User Role', dataType: 'Text(18)', required: false, unique: false }
    ]
  },
  {
    apiName: 'Account',
    label: 'Account',
    pluralLabel: 'Accounts',
    kind: 'Standard Object',
    description: 'Companies and organizations that you do business with.',
    fields: [
      { apiName: 'Name', label: 'Account Name', dataType: 'Text(255)', required: true, unique: false },
      { apiName: 'Type', label: 'Account Type', dataType: 'Picklist', required: false, unique: false, picklistValues: ['Prospect', 'Customer - Direct', 'Customer - Channel', 'Channel Partner / Reseller', 'Technology Partner', 'Other'], picklistRestricted: true },
      { apiName: 'Industry', label: 'Industry', dataType: 'Picklist', required: false, unique: false, picklistValues: ['Agriculture', 'Apparel', 'Banking', 'Biotechnology', 'Chemicals', 'Communications', 'Construction', 'Consulting', 'Education', 'Electronics', 'Energy', 'Engineering', 'Entertainment', 'Environmental', 'Finance', 'Food & Beverage', 'Government', 'Healthcare', 'Hospitality', 'Insurance', 'Machinery', 'Manufacturing', 'Media', 'Not For Profit', 'Recreation', 'Retail', 'Shipping', 'Technology', 'Telecommunications', 'Transportation', 'Utilities', 'Other'], picklistRestricted: true },
      { apiName: 'AnnualRevenue', label: 'Annual Revenue', dataType: 'Currency(18, 0)', required: false, unique: false },
      { apiName: 'Phone', label: 'Phone', dataType: 'Phone', required: false, unique: false },
      { apiName: 'Website', label: 'Website', dataType: 'URL', required: false, unique: false },
      { apiName: 'OwnerId', label: 'Account Owner', dataType: 'Lookup(User)', required: true, unique: false, relationship: { type: 'Lookup', targetObject: 'User', relationshipName: 'Owner', childRelationshipName: 'Accounts' } },
      { apiName: 'CreatedDate', label: 'Created Date', dataType: 'DateTime', required: false, unique: false }
    ]
  },
  {
    apiName: 'Contact',
    label: 'Contact',
    pluralLabel: 'Contacts',
    kind: 'Standard Object',
    description: 'People associated with your accounts.',
    fields: [
      { apiName: 'Name', label: 'Contact Name', dataType: 'Name', required: true, unique: false },
      { apiName: 'AccountId', label: 'Account Name', dataType: 'Lookup(Account)', required: false, unique: false, relationship: { type: 'Lookup', targetObject: 'Account', relationshipName: 'Account', childRelationshipName: 'Contacts' } },
      { apiName: 'Title', label: 'Title', dataType: 'Text(128)', required: false, unique: false },
      { apiName: 'Email', label: 'Email', dataType: 'Email', required: false, unique: false },
      { apiName: 'Phone', label: 'Phone', dataType: 'Phone', required: false, unique: false },
      { apiName: 'OwnerId', label: 'Contact Owner', dataType: 'Lookup(User)', required: true, unique: false, relationship: { type: 'Lookup', targetObject: 'User', relationshipName: 'Owner', childRelationshipName: 'OwnedContacts' } }
    ],
    listViewButtons: ['New', 'Change Owner', 'Import']
  },
  {
    apiName: 'Lead',
    label: 'Lead',
    pluralLabel: 'Leads',
    kind: 'Standard Object',
    description: 'Prospective customers and the sources that introduced them.',
    fields: [
      { apiName: 'FirstName', label: 'First Name', dataType: 'Text(40)', required: false, unique: false },
      { apiName: 'LastName', label: 'Last Name', dataType: 'Text(80)', required: true, unique: false },
      { apiName: 'Company', label: 'Company', dataType: 'Text(255)', required: true, unique: false },
      { apiName: 'Street', label: 'Street', dataType: 'Text(255)', required: false, unique: false },
      { apiName: 'Title', label: 'Title', dataType: 'Text(128)', required: false, unique: false },
      { apiName: 'Email', label: 'Email', dataType: 'Email', required: false, unique: false },
      { apiName: 'Phone', label: 'Phone', dataType: 'Phone', required: false, unique: false },
      { apiName: 'MobilePhone', label: 'Mobile Phone', dataType: 'Phone', required: false, unique: false },
      { apiName: 'LeadSource', label: 'Lead Source', dataType: 'Picklist', required: false, unique: false, picklistValues: ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other'], picklistRestricted: true },
      { apiName: 'Status', label: 'Lead Status', dataType: 'Picklist', required: true, unique: false, picklistValues: ['New', 'Working', 'Qualified', 'Unqualified'], picklistRestricted: true, defaultValue: 'New' },
      { apiName: 'Industry', label: 'Industry', dataType: 'Picklist', required: false, unique: false, picklistValues: ['Agriculture', 'Apparel', 'Banking', 'Biotechnology', 'Chemicals', 'Communications', 'Construction', 'Consulting', 'Education', 'Electronics', 'Energy', 'Engineering', 'Entertainment', 'Environmental', 'Finance', 'Food & Beverage', 'Government', 'Healthcare', 'Hospitality', 'Insurance', 'Machinery', 'Manufacturing', 'Media', 'Not For Profit', 'Recreation', 'Retail', 'Shipping', 'Technology', 'Telecommunications', 'Transportation', 'Utilities', 'Other'], picklistRestricted: true },
      { apiName: 'Rating', label: 'Rating', dataType: 'Picklist', required: false, unique: false, picklistValues: ['Hot', 'Warm', 'Cold'], picklistRestricted: true },
      { apiName: 'CreatedDate', label: 'Created Date', dataType: 'DateTime', required: false, unique: false },
      { apiName: 'OwnerId', label: 'Lead Owner', dataType: 'Lookup(User)', required: true, unique: false, relationship: { type: 'Lookup', targetObject: 'User', relationshipName: 'Owner', childRelationshipName: 'Leads' } }
    ]
  },
  {
    apiName: 'Opportunity',
    label: 'Opportunity',
    pluralLabel: 'Opportunities',
    kind: 'Standard Object',
    description: 'Potential revenue and deals in progress.',
    fields: [
      { apiName: 'Name', label: 'Opportunity Name', dataType: 'Text(120)', required: true, unique: false },
      { apiName: 'Type', label: 'Type', dataType: 'Picklist', required: false, unique: false, picklistValues: ['Existing Business', 'New Business'], picklistRestricted: true },
      { apiName: 'LeadSource', label: 'Lead Source', dataType: 'Picklist', required: false, unique: false, picklistValues: ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other'], picklistRestricted: true },
      { apiName: 'Amount', label: 'Amount', dataType: 'Currency(16, 2)', required: false, unique: false },
      { apiName: 'CloseDate', label: 'Close Date', dataType: 'Date', required: true, unique: false },
      { apiName: 'NextStep', label: 'Next Step', dataType: 'Text(255)', required: false, unique: false },
      { apiName: 'StageName', label: 'Stage', dataType: 'Picklist', required: true, unique: false, picklistValues: ['Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition', 'Id. Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review', 'Closed Won', 'Closed Lost'], picklistRestricted: true },
      { apiName: 'Probability', label: 'Probability (%)', dataType: 'Percent(3, 0)', required: false, unique: false },
      { apiName: 'Fiscal', label: 'Fiscal Period', dataType: 'Text(30)', required: false, unique: false },
      { apiName: 'Age', label: 'Age', dataType: 'Number(8, 0)', required: false, unique: false },
      { apiName: 'CreatedDate', label: 'Created Date', dataType: 'DateTime', required: false, unique: false },
      { apiName: 'AccountId', label: 'Account Name', dataType: 'Lookup(Account)', required: false, unique: false, relationship: { type: 'Lookup', targetObject: 'Account', relationshipName: 'Account', childRelationshipName: 'Opportunities' } },
      { apiName: 'OwnerId', label: 'Opportunity Owner', dataType: 'Lookup(User)', required: true, unique: false, relationship: { type: 'Lookup', targetObject: 'User', relationshipName: 'Owner', childRelationshipName: 'Opportunities' } },
      { apiName: 'OwnerRole', label: 'Owner Role', dataType: 'Text(80)', required: false, unique: false }
    ]
  },
  {
    apiName: 'Case',
    label: 'Case',
    pluralLabel: 'Cases',
    kind: 'Standard Object',
    description: 'Customer questions, feedback, and product issues.',
    fields: [
      { apiName: 'CaseNumber', label: 'Case Number', dataType: 'Auto Number', required: true, unique: true },
      { apiName: 'Subject', label: 'Subject', dataType: 'Text(255)', required: true, unique: false },
      { apiName: 'Status', label: 'Status', dataType: 'Picklist', required: true, unique: false, picklistValues: ['New', 'Working', 'Escalated', 'Closed'], picklistRestricted: true },
      { apiName: 'Priority', label: 'Case Priority', dataType: 'Picklist', required: true, unique: false, picklistValues: ['High', 'Medium', 'Low'], picklistRestricted: true },
      { apiName: 'CreatedDate', label: 'Date/Time Opened', dataType: 'DateTime', required: false, unique: false },
      { apiName: 'Age', label: 'Age', dataType: 'Number(8, 0)', required: false, unique: false },
      { apiName: 'IsOpen', label: 'Open', dataType: 'Checkbox', required: false, unique: false },
      { apiName: 'IsClosed', label: 'Closed', dataType: 'Checkbox', required: false, unique: false },
      { apiName: 'AccountId', label: 'Account Name', dataType: 'Lookup(Account)', required: false, unique: false, relationship: { type: 'Lookup', targetObject: 'Account', relationshipName: 'Account', childRelationshipName: 'Cases' } },
      { apiName: 'OwnerId', label: 'Case Owner', dataType: 'Lookup(User)', required: true, unique: false, relationship: { type: 'Lookup', targetObject: 'User', relationshipName: 'Owner', childRelationshipName: 'OwnedCases' } }
    ]
  },
  {
    apiName: 'Renewal__c',
    label: 'Renewal',
    pluralLabel: 'Renewals',
    kind: 'Custom Object',
    description: 'Tracks upcoming customer contract renewals.',
    fields: [
      { apiName: 'Name', label: 'Renewal Name', dataType: 'Text(80)', required: true, unique: false },
      { apiName: 'Account__c', label: 'Account', dataType: 'Lookup(Account)', required: true, unique: false, relationship: { type: 'Lookup', targetObject: 'Account', relationshipName: 'Account', childRelationshipName: 'Renewals' } },
      { apiName: 'Renewal_Date__c', label: 'Renewal Date', dataType: 'Date', required: true, unique: false },
      { apiName: 'ARR__c', label: 'Annual Recurring Revenue', dataType: 'Currency(16, 2)', required: false, unique: false }
    ]
  }
];

export const setupShortcuts = [
  { title: 'Object Manager', description: 'Manage objects, fields, and relationships', workspace: 'object-manager' as const, icon: Database },
  { title: 'Page Builder', description: 'Create and edit app pages', workspace: 'page-builder' as const, icon: LayoutTemplate },
  { title: 'Flows', description: 'Build automated business processes', workspace: 'flow-builder' as const, icon: Workflow },
  { title: 'Reports', description: 'Create, customize, and run reports', workspace: 'report-builder' as const, icon: FileText },
  { title: 'Dashboards', description: 'Visualize key business metrics', workspace: 'dashboard-builder' as const, icon: BarChart3 },
  { title: 'AppExchange', description: 'Discover and manage organization apps', workspace: 'app-exchange' as const, icon: Store },
  { title: 'Company Settings', description: 'Manage company settings, tax and currencies', workspace: 'company-settings' as const, icon: Building2 },
  { title: 'Permission Sets', description: 'Manage access to apps and data', workspace: 'rbac' as const, icon: ShieldCheck }
];

export const defaultFlow: FlowDefinitionMetadata = {
  apiName: 'Renewal_Risk_Evaluation',
  label: 'New Autolaunched Flow',
  flowType: 'Autolaunched Flow',
  status: 'Draft',
  versionNumber: 1,
  activeVersion: null,
  triggerObject: null,
  startConfig: {},
  elements: [
    { id: 1, type: 'Start', label: 'Start', config: {} },
    { id: 2, type: 'End', label: 'End', config: {} }
  ],
  connectors: [
    { id: 'connector-1', from: 1, to: 2, label: '', kind: 'normal' }
  ],
  resources: [
    { name: 'recordId', label: 'Record ID', type: 'Variable', dataType: 'Text', isCollection: false, availableForInput: true, availableForOutput: false }
  ],
  versions: []
};

export const defaultLightningPage: LightningPageMetadata = {
  apiName: 'Account_Record_Page',
  label: 'Account Record Page',
  targetObject: 'Account',
  pageType: 'Record Page',
  layoutMode: 'template',
  template: 'header-main-sidebar',
  canvasWidth: 1920,
  canvasHeight: 1080,
  canvasFillColor: '#ffffff',
  status: 'Draft',
  devices: ['Desktop', 'Phone'],
  components: [
    { id: 'highlights-panel', type: 'Highlights Panel', label: 'Highlights Panel', properties: { variant: 'compact' }, visible: true, region: 'header' },
    { id: 'record-tabs', type: 'Tabs', label: 'Tabs', properties: { tabs: ['Related', 'Details', 'News'] }, visible: true, region: 'main' },
    { id: 'related-list', type: 'Related List', label: 'Related List', properties: { relatedLists: ['Contacts', 'Opportunities', 'Cases'] }, visible: true, region: 'sidebar' }
  ],
  activationAssignments: [
    { id: 'account-default-desktop', scope: 'Org Default', appId: null, profileId: null, recordTypeId: null, formFactors: ['Desktop'] },
    { id: 'account-default-phone', scope: 'Org Default', appId: null, profileId: null, recordTypeId: null, formFactors: ['Phone'] }
  ]
};

/** Empty, non-authoritative UI shape only. Tenant access always comes from SQL. */
export const defaultAccessControl: AccessControlMetadata = {
  profiles: [], permissionSets: [], permissionSetGroups: [], roles: [],
  publicGroups: [], queues: [], sharingRules: [], users: [], sharingSettings: {}
};
