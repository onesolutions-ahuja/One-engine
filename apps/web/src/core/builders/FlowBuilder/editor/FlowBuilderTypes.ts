import { type FlowCapabilityCatalog } from '../flowCapabilityCatalog';
import {
type FlowDefinitionMetadata, type FlowVersionMetadata, type FlowValidationMetadata,
type NamedCredentialMetadata, type EmailAlertMetadata, type ConnectorProviderMetadata,
type IntegrationConnectionMetadata, type ObjectMetadata, type PlatformEventMetadata,
type UserMetadata, type ApprovalProcessMetadata, type LibraryComponentMetadata,
type LightningPageMetadata, type LightningAppMetadata,
} from '../../../metadata/Definitions/metadata';

export type FlowListRow = Pick<FlowDefinitionMetadata, 'apiName' | 'label' | 'flowType' | 'status' | 'versionNumber' | 'activeVersion' | 'createdAt' | 'createdBy' | 'lastModifiedAt' | 'lastModifiedBy'>;
export type FlowListResponse = { flows: FlowListRow[]; total: number; page: number; pageSize: number };
export type ExternalServiceParameter = { name: string; location: 'path' | 'query' | 'body'; required: boolean; valueType: string };
export type ExternalServiceOperation = {
  operationApi: string; label: string; method: string; path: string;
  requestBodyRequired: boolean; parameters: ExternalServiceParameter[];
};
export type ExternalServiceMetadata = { apiName: string; label: string; operations: ExternalServiceOperation[] };
export type FlowBuilderProps = {
  landing?: boolean;
  flow: FlowDefinitionMetadata;
  flows: FlowDefinitionMetadata[];
  pages: LightningPageMetadata[];
  apps: LightningAppMetadata[];
  onListFlows?: (page: number, search: string, flowType?: string) => Promise<FlowListResponse>;
  onLoadCapabilities: () => Promise<FlowCapabilityCatalog>;
  onLoadExternalServices: () => Promise<{ services: ExternalServiceMetadata[] }>;
  onImportExternalService: (apiName: string, label: string, spec: unknown) => Promise<void>;
  libraryComponents: LibraryComponentMetadata[];
  platformEvents: PlatformEventMetadata[];
  objects: ObjectMetadata[];
  users: UserMetadata[];
  approvalProcesses: ApprovalProcessMetadata[];
  namedCredentials: NamedCredentialMetadata[];
  emailAlerts: EmailAlertMetadata[];
  connectorProviders: ConnectorProviderMetadata[];
  integrationConnections: IntegrationConnectionMetadata[];
  validation: FlowValidationMetadata | null;
  isDirty: boolean;
  canRunFlows: boolean;
  selectedId: number;
  toolTab: 'Elements' | 'Manager';
  canUndo: boolean;
  canRedo: boolean;
  onExit: () => void;
  onOpenFlowList: () => void;
  onFlowChange: (flow: FlowDefinitionMetadata) => void;
  onSelectFlow: (apiName: string) => void;
  onRestoreFlowVersion: (version: FlowVersionMetadata) => void;
  onExportFlow: () => void;
  onImportFlow: (file: File) => void;
  onCloneFlow: (flow: FlowDefinitionMetadata) => void;
  onDeactivateFlow: (apiName: string) => void;
  onDeleteFlow: (apiName: string) => void;
  onCreateFlow: (label: string, flowType: FlowDefinitionMetadata['flowType']) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelect: (id: number) => void;
  onToolTab: (tab: 'Elements' | 'Manager') => void;
  onAdd: (type: string, afterId?: number, connectorId?: string) => void;
  onUpdateLabel: (id: number, label: string) => void;
  onUpdateConfig: (id: number, key: string, value: unknown) => void;
  onRemove: (id: number) => void;
  onValidate: () => void;
  onSave: () => void;
  onActivate: () => void;
  onRun: () => void;
  onDebug: () => void;
  onRunTests: (flow: FlowDefinitionMetadata) => Promise<Array<{ id: string; label: string; passed: boolean; actualStatus: string; details: string }>>;
  onNotify: (message: string) => void;
  onSaveNamedCredential: (credential: {
    id?: string; name: string; label: string; protocol: NamedCredentialMetadata['protocol']; baseUrl: string;
    authType: NamedCredentialMetadata['authType']; headerName?: string; username?: string; secret?: string;
  }) => Promise<void>;
  onDeleteNamedCredential: (id: string) => Promise<void>;
  onSaveEmailAlert: (alert: {
    id?: string; name: string; label: string; objectApiName: string; namedCredentialId: string;
    fromEmail: string; recipients: string; subject: string; body: string;
  }) => Promise<void>;
  onDeleteEmailAlert: (id: string) => Promise<void>;
  onSavePlatformEvent: (event: PlatformEventMetadata) => Promise<void>;
  onDeletePlatformEvent: (apiName: string) => Promise<void>;
};
