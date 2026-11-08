import { useFormFactor } from '../../../workspace/Responsive/useFormFactor';
import { uniqueLibraryComponents, libraryComponentLabel } from '../../../components/Registry/componentLibraryDiscovery';
import { useFlowPropertiesWidth } from '../FlowPropertiesResizeHandle';
import { type FlowImportPreview } from '../flowExcelWorkbook';
import { flowCreateOptions, flowElementAvailable, flowElementInToolbox, type FlowCapabilityCatalog } from '../flowCapabilityCatalog';
import { apiRequest } from '../../../authentication/Client/authClient';
import { useEffect, useRef, useState, useMemo } from 'react';
import {
type FlowDefinitionMetadata, type FlowResourceMetadata, type NamedCredentialMetadata,
type PlatformEventMetadata,
} from '../../../metadata/Definitions/metadata';

import type { FlowBuilderProps } from './FlowBuilderTypes';
import type { FlowListRow, FlowListResponse, ExternalServiceMetadata } from './FlowBuilderTypes';

export function useFlowEditorState(
  props: FlowBuilderProps,
) {
  const {
    libraryComponents, landing, onLoadCapabilities, onLoadExternalServices, onListFlows, flows,
    flow, selectedId,
  } = props;

  const phoneFlow=useFormFactor()==='Phone';
  const [phoneInspectorOpen,setPhoneInspectorOpen]=useState(false);
  const flowComponents = useMemo(() => uniqueLibraryComponents(libraryComponents, 'flow')
    .map(component => ({ ...component, label: libraryComponentLabel(component) })), [libraryComponents]);
  const [capabilityCatalog, setCapabilityCatalog] = useState<FlowCapabilityCatalog | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [excelPreview,setExcelPreview]=useState<FlowImportPreview|null>(null);
  const [excelError,setExcelError]=useState('');
  const [excelSkipErrors,setExcelSkipErrors]=useState(false);
  const [excelValidating,setExcelValidating]=useState(false);
  const [externalServices, setExternalServices] = useState<ExternalServiceMetadata[]>([]);
  const [externalServiceError, setExternalServiceError] = useState('');
  const [newExternalServiceApiName, setNewExternalServiceApiName] = useState('');
  const [newExternalServiceLabel, setNewExternalServiceLabel] = useState('');
  const [contextDefinitions,setContextDefinitions]=useState<Array<{apiName:string;label:string;objectApiName:string}>>([]);
  const [newContextLabel,setNewContextLabel]=useState('');
  const [newContextObject,setNewContextObject]=useState('');
  const loadContexts=async()=>{
   const result=await apiRequest<{contexts:Array<{apiName:string;label:string;objectApiName:string}>}>('/contexts/definitions');
   setContextDefinitions(result.contexts);
  };
  useEffect(()=>{
   let active=true;
   void apiRequest<{contexts:Array<{apiName:string;label:string;objectApiName:string}>}>('/contexts/definitions')
    .then(result=>{if(active)setContextDefinitions(result.contexts);})
    .catch(()=>{if(active)setContextDefinitions([]);});
   return()=>{active=false;};
  },[landing]);

  useEffect(() => {
    // The Builder mounts only when opened; never load this catalogue for app runtime.
    // Refetch when switching between the Flow list and editor; do not reuse tenant state.
    let current = true;
    setCapabilityCatalog(null);
    setCapabilityError('');
    void onLoadCapabilities().then((response) => {
      if (current) setCapabilityCatalog(response);
    }).catch(() => {
      if (current) setCapabilityError('Flow capabilities could not be loaded. Editing is disabled until the catalogue is available.');
    });
    return () => { current = false; };
    // onLoadCapabilities is provided by Setup rendering and has an unstable callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing]);
  useEffect(() => {
    let current = true;
    setExternalServices([]);
    setExternalServiceError('');
    void onLoadExternalServices().then((response) => {
      if (current) setExternalServices(response.services);
    }).catch(() => {
      if (current) setExternalServiceError('External Services could not be loaded.');
    });
    return () => { current = false; };
    // Load tenant-specific actions only while the Flow Builder is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing]);
  const flowTypeOptions = flowCreateOptions(capabilityCatalog);
  const flowElementMetadata = capabilityCatalog?.elements.filter(element => element.builderEnabled) ?? [];
  const [toolboxExpanded, setToolboxExpanded] = useState(false);
  const [toolTab, setToolTab] = useState<'Elements' | 'Manager'>('Elements');
  const [elementSearch, setElementSearch] = useState('');
  const [insertionConnectorId, setInsertionConnectorId] = useState('');
  const [newFlowLabel, setNewFlowLabel] = useState('');
  const [newFlowType, setNewFlowType] = useState<FlowDefinitionMetadata['flowType'] | null>(null);
  const [existingFlowSearch, setExistingFlowSearch] = useState('');
  const [existingFlowTypeTab, setExistingFlowTypeTab] = useState('all');
  const [existingFlowPage, setExistingFlowPage] = useState(1);
  const [remoteFlowResults, setRemoteFlowResults] = useState<FlowListResponse | null>(null);
  const [remoteFlowLoading, setRemoteFlowLoading] = useState(false);
  useEffect(() => {
    if (!landing || !onListFlows) return;
    let cancelled = false;
    setRemoteFlowLoading(true);
    void onListFlows(existingFlowPage, existingFlowSearch, existingFlowTypeTab === 'all' ? '' : existingFlowTypeTab)
      .then((response) => { if (!cancelled) setRemoteFlowResults(response); })
      .catch(() => { if (!cancelled) setRemoteFlowResults(null); })
      .finally(() => { if (!cancelled) setRemoteFlowLoading(false); });
    return () => { cancelled = true; };
  }, [landing, onListFlows, existingFlowPage, existingFlowSearch, existingFlowTypeTab]);
  const matchingFlows = flows.filter((candidate) => (existingFlowTypeTab === 'all' || candidate.flowType === existingFlowTypeTab) && `${candidate.label} ${candidate.apiName} ${candidate.flowType} ${candidate.status}`.toLowerCase().includes(existingFlowSearch.trim().toLowerCase()));
  const totalFlowCount = remoteFlowResults?.total ?? matchingFlows.length;
  const flowPageCount = Math.max(1, Math.ceil(totalFlowCount / 50));
  const safeFlowPage = Math.min(existingFlowPage, flowPageCount);
  const displayedFlows: FlowListRow[] = remoteFlowResults ? remoteFlowResults.flows : matchingFlows.slice((safeFlowPage - 1) * 50, safeFlowPage * 50);
  const isElementAvailable = (type: string) =>
    flowElementAvailable(capabilityCatalog, type, flow.flowType, flow.startConfig?.runWhen);
  const isToolboxElement = (type: string) =>
    flowElementInToolbox(capabilityCatalog,type,flow.flowType,flow.startConfig?.runWhen);
  const [resourceLabel, setResourceLabel] = useState('');
  const [resourceType, setResourceType] = useState<FlowResourceMetadata['type']>('Variable');
  const [resourceDataType, setResourceDataType] = useState('Text');
  const [resourceValue, setResourceValue] = useState('');
  const [formulaFunction, setFormulaFunction] = useState('IF');
  const [formulaGuide,setFormulaGuide]=useState<{key:string;caret:number}|null>(null);
  const [formulaInsertField, setFormulaInsertField] = useState('');
  const [formulaOperator, setFormulaOperator] = useState('+');
  const [credentialId, setCredentialId] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [credentialLabel, setCredentialLabel] = useState('');
  const [credentialProtocol, setCredentialProtocol] = useState<NamedCredentialMetadata['protocol']>('HTTPS');
  const [credentialBaseUrl, setCredentialBaseUrl] = useState('');
  const [credentialAuthType, setCredentialAuthType] = useState<NamedCredentialMetadata['authType']>('Bearer');
  const [credentialHeaderName, setCredentialHeaderName] = useState('x-api-key');
  const [credentialUsername, setCredentialUsername] = useState('');
  const [credentialSecret, setCredentialSecret] = useState('');
  const [emailAlertId, setEmailAlertId] = useState('');
  const [emailAlertName, setEmailAlertName] = useState('');
  const [emailAlertLabel, setEmailAlertLabel] = useState('');
  const [emailAlertObject, setEmailAlertObject] = useState('');
  const [emailAlertCredentialId, setEmailAlertCredentialId] = useState('');
  const [emailAlertFrom, setEmailAlertFrom] = useState('');
  const [emailAlertRecipients, setEmailAlertRecipients] = useState('');
  const [emailAlertSubject, setEmailAlertSubject] = useState('');
  const [emailAlertBody, setEmailAlertBody] = useState('');
  const [platformEventApiName, setPlatformEventApiName] = useState('');
  const [platformEventLabel, setPlatformEventLabel] = useState('');
  const [platformEventDescription, setPlatformEventDescription] = useState('');
  const [platformEventFields, setPlatformEventFields] = useState<PlatformEventMetadata['fields']>([]);
  const [zoom, setZoom] = useState(1);
  const [showGraphReview, setShowGraphReview] = useState(false);
  const [activeGraphPath, setActiveGraphPath] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ id: number; x: number; y: number } | null>(null);
  const dragRef = useRef<{
    id: number; startClientX: number; startClientY: number;
    x: number; y: number; moved: boolean
  } | null>(null);
  const {propertiesWidth, setPropertiesWidth, workareaRef, clampPropertiesWidth} = useFlowPropertiesWidth();
  const canvasRef = useRef<HTMLDivElement>(null);
  const formulaEditorRef = useRef<HTMLTextAreaElement>(null);
  const selected = flow.elements.find((element) => element.id === selectedId) ?? flow.elements[0];

  return {
    phoneFlow, phoneInspectorOpen, setPhoneInspectorOpen, flowComponents, capabilityCatalog,
    capabilityError, excelPreview, setExcelPreview, excelError, setExcelError, excelSkipErrors,
    setExcelSkipErrors, excelValidating, setExcelValidating, externalServices, setExternalServices,
    externalServiceError, setExternalServiceError, newExternalServiceApiName,
    setNewExternalServiceApiName, newExternalServiceLabel, setNewExternalServiceLabel,
    contextDefinitions, newContextLabel, setNewContextLabel, newContextObject, setNewContextObject,
    loadContexts, flowTypeOptions, flowElementMetadata, toolboxExpanded, setToolboxExpanded, toolTab,
    setToolTab, elementSearch, setElementSearch, insertionConnectorId, setInsertionConnectorId,
    newFlowLabel, setNewFlowLabel, newFlowType, setNewFlowType, existingFlowSearch,
    setExistingFlowSearch, existingFlowTypeTab, setExistingFlowTypeTab, setExistingFlowPage,
    setRemoteFlowResults, remoteFlowLoading, totalFlowCount, flowPageCount, safeFlowPage, displayedFlows,
    isElementAvailable, isToolboxElement, resourceLabel, setResourceLabel, resourceType, setResourceType,
    resourceDataType, setResourceDataType, resourceValue, setResourceValue, formulaFunction,
    setFormulaFunction, formulaGuide, setFormulaGuide, formulaInsertField, setFormulaInsertField,
    formulaOperator, setFormulaOperator, credentialId, setCredentialId, credentialName,
    setCredentialName, credentialLabel, setCredentialLabel, credentialProtocol, setCredentialProtocol,
    credentialBaseUrl, setCredentialBaseUrl, credentialAuthType, setCredentialAuthType,
    credentialHeaderName, setCredentialHeaderName, credentialUsername, setCredentialUsername,
    credentialSecret, setCredentialSecret, emailAlertId, setEmailAlertId, emailAlertName,
    setEmailAlertName, emailAlertLabel, setEmailAlertLabel, emailAlertObject, setEmailAlertObject,
    emailAlertCredentialId, setEmailAlertCredentialId, emailAlertFrom, setEmailAlertFrom,
    emailAlertRecipients, setEmailAlertRecipients, emailAlertSubject, setEmailAlertSubject,
    emailAlertBody, setEmailAlertBody, platformEventApiName, setPlatformEventApiName, platformEventLabel,
    setPlatformEventLabel, platformEventDescription, setPlatformEventDescription, platformEventFields,
    setPlatformEventFields, zoom, setZoom, showGraphReview, setShowGraphReview, activeGraphPath,
    setActiveGraphPath, dropActive, setDropActive, dragPreview, setDragPreview, dragRef, propertiesWidth,
    setPropertiesWidth, workareaRef, clampPropertiesWidth, canvasRef, formulaEditorRef, selected,
  };
}
