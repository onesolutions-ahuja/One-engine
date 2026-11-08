import { retargetFlowGraphConnector } from '../../flowGraphOperations.mjs';
import { rowsFrom, outcomesFrom, screenOutcomesFrom, displayValue } from '../../flowEditorData';
import { FlowConditionRows, FlowFieldAssignments } from '../../FlowValueEditors';
import {
type FlowDefinitionMetadata, type FlowResourceMetadata, type NamedCredentialMetadata,
type EmailAlertMetadata, type ObjectMetadata,
} from '../../../../metadata/Definitions/metadata';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { FlowBuilderProps } from '../FlowBuilderTypes';

export function useFlowConfiguration(
  editorState: ReturnType<typeof useFlowEditorState>,
  props: FlowBuilderProps,
) {
  const {
    selected, setPlatformEventFields, platformEventLabel, platformEventApiName,
    platformEventDescription, platformEventFields, setPlatformEventApiName, setCredentialId,
    setCredentialName, setCredentialLabel, setCredentialProtocol, setCredentialBaseUrl,
    setCredentialAuthType, setCredentialHeaderName, setCredentialUsername, setCredentialSecret,
    setEmailAlertId, setEmailAlertName, setEmailAlertLabel, setEmailAlertObject,
    setEmailAlertCredentialId, setEmailAlertFrom, setEmailAlertRecipients, setEmailAlertSubject,
    setEmailAlertBody, emailAlertId, emailAlertName, emailAlertLabel, emailAlertObject,
    emailAlertCredentialId, emailAlertFrom, emailAlertRecipients, emailAlertSubject,
    emailAlertBody, credentialId, credentialName, credentialLabel, credentialProtocol,
    credentialBaseUrl, credentialAuthType, credentialHeaderName, credentialUsername,
    credentialSecret, resourceLabel, resourceType, resourceDataType, resourceValue,
    setResourceLabel, setResourceValue, formulaEditorRef,
  } = editorState;
  const {
    onUpdateConfig, flow, platformEvents, objects, onFlowChange, onSavePlatformEvent, onNotify,
    namedCredentials, onSaveEmailAlert, onSaveNamedCredential,
  } = props;

  const setConfig = (key: string, value: unknown) => {
    if (selected) onUpdateConfig(selected.id, key, value);
  };
  const setStartConfig = (key: string, value: unknown) => {
    if (!selected) return;
    onUpdateConfig(selected.id, key, value);
  };
  const updateFlowType = (flowType: FlowDefinitionMetadata['flowType']) => {
    const triggerObject = flowType === 'Platform Event-Triggered Flow'
      ? flow.triggerObject && platformEvents.some((event) => event.apiName === flow.triggerObject)
        ? flow.triggerObject
        : platformEvents[0]?.apiName ?? null
      : flowType === 'Record-Triggered Flow' || flowType === 'Schedule-Triggered Flow'
      ? flow.triggerObject ?? objects.find((object) => object.apiName !== 'User')?.apiName ?? null
      : null;
    const startConfig = flowType === 'Schedule-Triggered Flow'
      ? { entryConditions: [], startDate: '', startTime: '', frequency: '', timeZone: displayValue(flow.startConfig.timeZone) || 'UTC', executionContext: flow.startConfig.executionContext === 'System' ? 'System' : 'User' }
      : flowType === 'Platform Event-Triggered Flow'
        ? { entryConditions: rowsFrom(flow.startConfig.entryConditions), executionContext: flow.startConfig.executionContext === 'System' ? 'System' : 'User', ...(flow.startConfig.conditionLogic ? { conditionLogic: flow.startConfig.conditionLogic } : {}) }
        : flowType === 'Record-Triggered Flow'
          ? { entryConditions: rowsFrom(flow.startConfig.entryConditions), trigger: 'created-or-updated', runWhen: 'after-save', executionContext: flow.startConfig.executionContext === 'System' ? 'System' : 'User', ...(flow.startConfig.conditionLogic ? { conditionLogic: flow.startConfig.conditionLogic } : {}) }
          : { executionContext: ['Screen Flow','In-Screen Flow'].includes(flowType) ? 'User' : flow.startConfig.executionContext === 'System' ? 'System' : 'User' };
    const elements = flow.elements
      .filter((element) => element.type !== 'Screen' || ['Screen Flow','In-Screen Flow'].includes(flowType))
      .map((element) => element.type === 'Start'
        ? { ...element, config: { ...element.config, ...startConfig, ...(triggerObject ? { object: triggerObject } : {}) } }
        : element);
    onFlowChange({ ...flow, flowType, triggerObject, startConfig, elements });
  };
  const addPlatformEventField = () => setPlatformEventFields((current) => [...current, {
    apiName: '',
    label: '',
    dataType: 'Text(255)',
    required: false,
    unique: false
  }]);
  const savePlatformEvent = async () => {
    const label = platformEventLabel.trim();
    const name = platformEventApiName.trim() || `${label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}__e`;
    await onSavePlatformEvent({
      apiName: name,
      label,
      description: platformEventDescription,
      fields: platformEventFields.map((field) => ({
        ...field,
        apiName: field.apiName.trim(),
        label: field.label.trim()
      }))
    });
    setPlatformEventApiName(name);
  };
  const updateConnector = (id: string, update: Partial<FlowDefinitionMetadata['connectors'][number]>) => {
    if(update.to!==undefined){
      try{
        const next=retargetFlowGraphConnector(flow,id,update.to);
        onFlowChange({...next,connectors:next.connectors.map(item=>
          item.id===id?{...item,...update}:item)});
      }catch(error){onNotify(error instanceof Error?error.message:'Unable to connect Flow path');}
      return;
    }
    onFlowChange({ ...flow, connectors: flow.connectors.map((connector) => connector.id === id ? { ...connector, ...update } : connector) });
  };
  const setConnectorKind = (id: string, kind: FlowDefinitionMetadata['connectors'][number]['kind']) => {
    const connector = flow.connectors.find((item) => item.id === id);
    updateConnector(id, {
      kind,
      scheduledPath: kind === 'scheduled'
        ? connector?.scheduledPath ?? { timeSourceFieldApiName: '', offsetAmount: 0, offsetUnit: 'Hours' }
        : undefined
    });
  };
  const editCredential = (credential?: NamedCredentialMetadata) => {
    setCredentialId(credential?.id ?? '');
    setCredentialName(credential?.name ?? '');
    setCredentialLabel(credential?.label ?? '');
    setCredentialProtocol(credential?.protocol ?? 'HTTPS');
    setCredentialBaseUrl(credential?.baseUrl ?? '');
    setCredentialAuthType(credential?.authType ?? 'Bearer');
    setCredentialHeaderName(credential?.headerName ?? 'x-api-key');
    setCredentialUsername('');
    setCredentialSecret('');
  };
  const editEmailAlert = (alert?: EmailAlertMetadata) => {
    setEmailAlertId(alert?.id ?? '');
    setEmailAlertName(alert?.name ?? '');
    setEmailAlertLabel(alert?.label ?? '');
    setEmailAlertObject(alert?.objectApiName ?? objects.find((object) => object.apiName !== 'User')?.apiName ?? '');
    setEmailAlertCredentialId(alert?.namedCredentialId ?? namedCredentials.find((credential) => credential.protocol === 'SMTP')?.id ?? '');
    setEmailAlertFrom(alert?.fromEmail ?? '');
    setEmailAlertRecipients(alert?.recipients ?? '');
    setEmailAlertSubject(alert?.subject ?? '');
    setEmailAlertBody(alert?.body ?? '');
  };
  const submitEmailAlert = async () => {
    try {
      await onSaveEmailAlert({
        ...(emailAlertId ? { id: emailAlertId } : {}),
        name: emailAlertName.trim(),
        label: emailAlertLabel.trim(),
        objectApiName: emailAlertObject,
        namedCredentialId: emailAlertCredentialId,
        fromEmail: emailAlertFrom.trim(),
        recipients: emailAlertRecipients.trim(),
        subject: emailAlertSubject.trim(),
        body: emailAlertBody
      });
      editEmailAlert();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to save Email Alert');
    }
  };
  const submitCredential = async () => {
    try {
      await onSaveNamedCredential({
        ...(credentialId ? { id: credentialId } : {}),
        name: credentialName.trim(),
        label: credentialLabel.trim(),
        protocol: credentialProtocol,
        baseUrl: credentialBaseUrl.trim(),
        authType: credentialAuthType,
        ...(credentialHeaderName.trim() ? { headerName: credentialHeaderName.trim() } : {}),
        ...(credentialUsername ? { username: credentialUsername } : {}),
        ...(credentialSecret ? { secret: credentialSecret } : {})
      });
      editCredential();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to save Named Credential');
    }
  };
  const addConnector = () => {
    if (!selected) return;
    const target = flow.elements.find((element) => element.id !== selected.id && element.type !== 'Start');
    if (!target) {
      onNotify('Add another element before creating a branch');
      return;
    }
    const outgoing = flow.connectors.filter((connector) => connector.from === selected.id && connector.kind !== 'fault');
    let label = '';
    if (selected.type === 'Decision') {
      const outcomes = outcomesFrom(selected.config.outcomes);
      const outcome = outcomes.find((item) => !outgoing.some((connector) => connector.label === item.label || connector.label === item.name));
      if (!outcome) {
        onNotify('Every Decision outcome already has a connector');
        return;
      }
      label = outcome.name === 'Default' ? 'Default' : outcome.label;
    } else if (selected.type === 'Screen') {
      const outcomes = screenOutcomesFrom(selected.config.outcomes);
      const outcome = outcomes.find((item) => !outgoing.some((connector) => connector.label === item.label || connector.label === item.name));
      if (!outcome) {
        onNotify('Every Screen outcome already has a connector');
        return;
      }
      label = outcome.label;
    } else if (selected.type === 'Orchestration Stage') {
      label = ['Approved', 'Rejected'].find((outcome) =>
        !outgoing.some((connector) => connector.label.toLowerCase() === outcome.toLowerCase())) ?? '';
      if (!label) {
        onNotify('Both orchestration outcomes already have connectors');
        return;
      }
    } else if (selected.type === 'Loop') {
      label = outgoing.some((connector) => connector.label.toLowerCase().includes('for each'))
        ? 'After Last'
        : 'For Each';
    }
    onFlowChange({
      ...flow,
      connectors: [...flow.connectors, {
        id: `connector-${crypto.randomUUID()}`,
        from: selected.id,
        to: target.id,
        label,
        kind: 'normal'
      }]
    });
  };
  const addResource = () => {
    const label = resourceLabel.trim();
    const name = label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!name) return;
    if (flow.resources.some((resource) => resource.name.toLowerCase() === name.toLowerCase())) {
      onNotify('A flow resource with this API name already exists');
      return;
    }
    const resource: FlowResourceMetadata = {
      name,
      label,
      type: resourceType,
      dataType: resourceDataType,
      isCollection: resourceType === 'Record Collection',
      availableForInput: false,
      availableForOutput: false,
      ...(resourceValue ? { value: resourceValue } : {})
    };
    onFlowChange({ ...flow, resources: [...flow.resources, resource] });
    setResourceLabel('');
    setResourceValue('');
  };
  const updateResource = (name: string, update: Partial<FlowResourceMetadata>) => {
    onFlowChange({
      ...flow,
      resources: flow.resources.map((resource) => resource.name === name ? { ...resource, ...update } : resource)
    });
  };
  const insertFormulaToken = (text: string, caretOffset = text.length) => {
    const editor = formulaEditorRef.current;
    const start = editor?.selectionStart ?? resourceValue.length;
    const end = editor?.selectionEnd ?? start;
    setResourceValue(`${resourceValue.slice(0, start)}${text}${resourceValue.slice(end)}`);
    requestAnimationFrame(() => {
      editor?.focus();
      editor?.setSelectionRange(start + caretOffset, start + caretOffset);
    });
  };
  const renderConditions = (key: string, fields: ObjectMetadata['fields']) => (
    <FlowConditionRows flow={flow} elementId={selected?.id ?? 0} objects={objects}
      rows={rowsFrom(selected?.config[key])} fields={fields}
      onChange={rows => setConfig(key, rows)} />
  );
  const renderConditionLogic = (label: string, value: unknown, count: number, onChange: (logic: string) => void) => {
    const logic = displayValue(value);
    const mode = value === undefined || value === null || logic === 'All' ? 'All' : logic === 'Any' ? 'Any' : 'Custom';
    return <>
      <label className="form-label">{label}<select className="form-control" value={mode} onChange={(event) => onChange(event.target.value === 'Custom' ? '' : event.target.value)}>
        <option value="All">All Conditions Are Met (AND)</option>
        <option value="Any">Any Condition Is Met (OR)</option>
        <option value="Custom">Custom Condition Logic</option>
      </select></label>
      {mode === 'Custom' && <>
        <label className="form-label">Custom Logic<input className="form-control" aria-label={`${label} expression`} placeholder="1 AND (2 OR 3)" value={logic} onChange={(event) => onChange(event.target.value)} /></label>
        <p className="settings-panel-copy">Use condition row numbers (1–{count}) with AND, OR, and parentheses.</p>
      </>}
    </>;
  };
  const renderFieldValues = () => (
    <FlowFieldAssignments flow={flow} elementId={selected?.id ?? 0} objects={objects}
      object={objects.find(obj=>obj.apiName===selected?.config.object)}
      config={selected?.config ?? {}} onChange={rows=>setConfig('fieldValues',rows)} />
  );
  const inScreenBindings=flow.startConfig.inputBindings&&typeof flow.startConfig.inputBindings==='object'
    &&!Array.isArray(flow.startConfig.inputBindings)
    ?flow.startConfig.inputBindings as Record<string,string>:{};

  return {
    setConfig, setStartConfig, updateFlowType, addPlatformEventField, savePlatformEvent, updateConnector,
    setConnectorKind, editCredential, editEmailAlert, submitEmailAlert, submitCredential, addConnector,
    addResource, updateResource, insertFormulaToken, renderConditions, renderConditionLogic,
    renderFieldValues, inScreenBindings,
  };
}
