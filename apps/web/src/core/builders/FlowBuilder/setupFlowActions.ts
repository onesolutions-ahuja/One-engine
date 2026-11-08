// @ts-nocheck
import {generateMetadataApiName,suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
// Shared Flow CRUD, execution and connector actions. UI builders stay lazily mounted.
import type { FormEvent } from 'react';
import type { FlowDefinitionMetadata, FlowElementMetadata, FlowValidationMetadata, FlowVersionMetadata, PlatformEventMetadata, ApprovalProcessInput, NamedCredentialMetadata, EmailAlertMetadata } from '../../metadata/Definitions/metadata';
import { initialScreenValues } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import { flowTestValuesEqual } from './flowTestAssertions';

export function createSetupFlowActions(ctx: any) {
 const { apiRequest, apps, confirmDiscardFlowChanges, confirmFlowNavigation, flow, flowDebug, flowHistory, flowRun, flowSnapshots, flows, navigateRoute, notify, object, objects, platformEvents, setApprovalProcesses, setEmailAlerts, setFlow, setFlowDebug, setFlowRun, setFlowRunnerError, setFlowRunnerSubmitting, setFlowValidation, setFlows, setNamedCredentials, setPlatformEvents, setSelectedFlowId, workspace } = ctx;
  const saveFlow = async (nextFlow: FlowDefinitionMetadata) => {
    try {
      const payload = await apiRequest<{ flow: FlowDefinitionMetadata }>(`/metadata/flows/${encodeURIComponent(nextFlow.apiName)}`, {
        method: 'PUT', body: JSON.stringify(nextFlow)
      });
      flowSnapshots.current.set(payload.flow.apiName, JSON.stringify(payload.flow));
      setFlow(payload.flow);
      flowHistory.current = { undo: [], redo: [] };
      setFlows((current) => current.some((item) => item.apiName === payload.flow.apiName)
        ? current.map((item) => item.apiName === payload.flow.apiName ? payload.flow : item)
        : [...current, payload.flow]);
      setFlowValidation(null);
      notify(nextFlow.status === 'Active' ? 'Flow activated; previous active version is now obsolete' : 'Flow saved as inactive draft');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save flow');
    }
  };

  const saveNamedCredential = async (credential: {
    id?: string; name: string; label: string; protocol: NamedCredentialMetadata['protocol']; baseUrl: string;
    authType: NamedCredentialMetadata['authType']; headerName?: string; configuration?: Record<string, string>; username?: string; secret?: string;
    webhookRequired?: boolean; webhookSecret?: string; webhookVerifyToken?: string;
  }) => {
    const { id, ...body } = credential;
    const result = await apiRequest<{ credential: NamedCredentialMetadata; webhookVerifyToken?: string }>(
      id ? `/named-credentials/${encodeURIComponent(id)}` : '/named-credentials',
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }
    );
    setNamedCredentials((current) => current.some((item) => item.id === result.credential.id)
      ? current.map((item) => item.id === result.credential.id ? result.credential : item)
      : [...current, result.credential]);
    notify(`Named Credential ${id ? 'updated' : 'created'}`);
    return result;
  };

  const toggleNamedCredentialEnabled = async (id: string, enabled: boolean) => {
    const result = await apiRequest<{ credential: NamedCredentialMetadata }>(
      `/named-credentials/${encodeURIComponent(id)}/enabled`,
      { method: 'PATCH', body: JSON.stringify({ enabled }) }
    );
    setNamedCredentials((current) => current.map((item) => item.id === result.credential.id ? result.credential : item));
    notify(enabled ? 'Connection enabled' : 'Connection disabled');
  };
  const deleteNamedCredential = async (id: string) => {
    await apiRequest<void>(`/named-credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setNamedCredentials((current) => current.filter((item) => item.id !== id));
    notify('Named Credential deleted');
  };

  const saveEmailAlert = async (alert: {
    id?: string; name: string; label: string; objectApiName: string; namedCredentialId: string;
    fromEmail: string; recipients: string; subject: string; body: string;
  }) => {
    const { id, ...body } = alert;
    const result = await apiRequest<{ emailAlert: EmailAlertMetadata }>(
      id ? `/metadata/email-alerts/${encodeURIComponent(id)}` : '/metadata/email-alerts',
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }
    );
    setEmailAlerts((current) => current.some((item) => item.id === result.emailAlert.id)
      ? current.map((item) => item.id === result.emailAlert.id ? result.emailAlert : item)
      : [...current, result.emailAlert]);
    notify(`Email Alert ${id ? 'updated' : 'created'}`);
  };

  const deleteEmailAlert = async (id: string) => {
    await apiRequest<void>(`/metadata/email-alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setEmailAlerts((current) => current.filter((item) => item.id !== id));
    notify('Email Alert deleted');
  };

  const savePlatformEvent = async (platformEvent: PlatformEventMetadata) => {
    const result = await apiRequest<{ platformEvent: PlatformEventMetadata }>(
      `/metadata/platform-events/${encodeURIComponent(platformEvent.apiName)}`,
      { method: 'PUT', body: JSON.stringify(platformEvent) }
    );
    setPlatformEvents((current) => current.some((item) => item.apiName === result.platformEvent.apiName)
      ? current.map((item) => item.apiName === result.platformEvent.apiName ? result.platformEvent : item)
      : [...current, result.platformEvent]);
    notify(`Platform Event ${platformEvent.apiName} saved`);
  };

  const deletePlatformEvent = async (apiName: string) => {
    await apiRequest<void>(`/metadata/platform-events/${encodeURIComponent(apiName)}`, { method: 'DELETE' });
    setPlatformEvents((current) => current.filter((item) => item.apiName !== apiName));
    notify('Platform Event deleted');
  };

  const saveApprovalProcess = async (process: ApprovalProcessInput) => {
    const result = await apiRequest<{ approvalProcess: ApprovalProcessMetadata }>(
      `/metadata/approval-processes/${encodeURIComponent(process.apiName)}`,
      { method: 'PUT', body: JSON.stringify(process) }
    );
    setApprovalProcesses((current) => current.some((item) => item.apiName === result.approvalProcess.apiName)
      ? current.map((item) => item.apiName === result.approvalProcess.apiName ? result.approvalProcess : item)
      : [...current, result.approvalProcess]);
    notify('Approval process saved');
  };

  const deleteApprovalProcess = async (apiName: string) => {
    await apiRequest<void>(`/metadata/approval-processes/${encodeURIComponent(apiName)}`, { method: 'DELETE' });
    setApprovalProcesses((current) => current.filter((item) => item.apiName !== apiName));
    notify('Approval process deleted');
  };

  const validateFlow = async (nextFlow: FlowDefinitionMetadata) => {
    try {
      const result = await apiRequest<FlowValidationMetadata>(`/metadata/flows/${encodeURIComponent(nextFlow.apiName)}/validate`, {
        method: 'POST',
        body: JSON.stringify(nextFlow)
      });
      setFlowValidation(result);
      if (result.valid) notify(result.warnings.length ? 'Flow is valid with warnings' : 'Flow validation passed');
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to validate flow');
      return null;
    }
  };

  const openFlowDebug = () => {
    const savedSnapshot = flowSnapshots.current.get(flow.apiName);
    if (!savedSnapshot) {
      notify('Save the flow before debugging it');
      return;
    }
    let savedFlow: FlowDefinitionMetadata;
    try {
      savedFlow = JSON.parse(savedSnapshot) as FlowDefinitionMetadata;
    } catch {
      notify('The saved Flow version could not be read for debugging');
      return;
    }
    if (savedSnapshot !== JSON.stringify(flow)) {
      notify('Debug uses the most recently saved version; unsaved changes are not included.');
    }
    const inputs = Object.fromEntries(savedFlow.resources
      .filter((resource) => resource.availableForInput)
      .map((resource) => [resource.name, resource.value === undefined
        ? ''
        : typeof resource.value === 'string' ? resource.value : JSON.stringify(resource.value)]));
    if (savedFlow.flowType === 'Record-Triggered Flow') {
      inputs.$Record = JSON.stringify({
        Name: 'Example record',
        Id: 'TEST-RECORD'
      }, null, 2);
      inputs.$Prior = JSON.stringify({ Name: 'Previous record', Id: 'TEST-RECORD' }, null, 2);
      inputs.$Event = savedFlow.startConfig.trigger === 'deleted' ? 'deleted'
        : savedFlow.startConfig.trigger === 'updated' ? 'updated' : 'created';
      inputs.$IsClone = 'false';
    }
    setFlowDebug({ flow: savedFlow, mode: 'debug', inputs, error: '', running: false });
  };

  const parseFlowInputs = (flowDefinition: FlowDefinitionMetadata, rawInputs: Record<string, string>) => {
    const inputs: Record<string, unknown> = {};
    for (const resource of flowDefinition.resources.filter((item) => item.availableForInput)) {
      const rawValue = rawInputs[resource.name] ?? '';
      if (!rawValue.trim()) {
        if (['Text', 'String', 'Email', 'Phone', 'URL'].includes(resource.dataType)) inputs[resource.name] = '';
        continue;
      }
      const normalizedType = resource.dataType.toLocaleLowerCase();
      if (['number', 'currency', 'percent'].some((type) => normalizedType.startsWith(type))) {
        const value = Number(rawValue);
        if (!Number.isFinite(value)) throw new Error(`Enter a valid number for ${resource.label}.`);
        inputs[resource.name] = value;
      } else if (['boolean', 'checkbox'].includes(normalizedType)) {
        if (!['true', 'false'].includes(rawValue.toLocaleLowerCase())) {
          throw new Error(`Enter true or false for ${resource.label}.`);
        }
        inputs[resource.name] = rawValue.toLocaleLowerCase() === 'true';
      } else if (['Record', 'Record Collection'].includes(resource.type) || normalizedType === 'json') {
        try {
          inputs[resource.name] = JSON.parse(rawValue) as unknown;
        } catch {
          throw new Error(`Enter valid JSON for ${resource.label}.`);
        }
      } else if (normalizedType === 'multi-select picklist') {
        let values: unknown;
        try {
          values = JSON.parse(rawValue) as unknown;
        } catch {
          throw new Error(`Enter a JSON array of selected values for ${resource.label}.`);
        }
        if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
          throw new Error(`Enter a JSON array of text values for ${resource.label}.`);
        }
        inputs[resource.name] = values;
      } else if (normalizedType === 'date/time' || normalizedType === 'datetime') {
        const parsedDate = new Date(rawValue);
        if (!Number.isFinite(parsedDate.getTime())) throw new Error(`Enter a valid date and time for ${resource.label}.`);
        inputs[resource.name] = parsedDate.toISOString();
      } else {
        inputs[resource.name] = rawValue;
      }
    }
    return inputs;
  };

  const runFlowDebug = async () => {
    if (!flowDebug) return;
    try {
      const inputs = parseFlowInputs(flowDebug.flow, flowDebug.inputs);
      setFlowDebug((current) => current ? { ...current, error: '', running: true, result: undefined } : current);
      const recordTriggered = flowDebug.mode === 'debug' && flowDebug.flow.flowType === 'Record-Triggered Flow';
      let payload: Record<string, unknown> = inputs;
      if (recordTriggered) {
        let record: unknown;
        let prior: unknown;
        try {
          record = JSON.parse(flowDebug.inputs.$Record ?? '{}') as unknown;
          prior = flowDebug.inputs.$Event === 'created' || !flowDebug.inputs.$Prior?.trim()
            ? undefined : JSON.parse(flowDebug.inputs.$Prior) as unknown;
        } catch {
          throw new Error('Enter valid JSON for the current and prior record.');
        }
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new Error('Current record must be a JSON object.');
        }
        if (prior !== undefined && (!prior || typeof prior !== 'object' || Array.isArray(prior))) {
          throw new Error('Prior record must be a JSON object.');
        }
        const event = flowDebug.inputs.$Event || 'created';
        if (event !== 'created' && prior === undefined) throw new Error('Update/delete tests need prior record values.');
        payload = { record, ...(prior === undefined ? {} : { prior }),
          event, isClone: flowDebug.inputs.$IsClone === 'true' };
      }
      const result = await apiRequest<Record<string, unknown>>(
        `/flows/${encodeURIComponent(flowDebug.flow.apiName)}/${recordTriggered ? 'debug-record' : flowDebug.mode === 'debug' ? 'debug' : 'execute'}`,
        { method: 'POST', body: JSON.stringify(payload) }
      );
      if (flowDebug.mode === 'run') {
        const interviewId = typeof result.interviewId === 'string' ? result.interviewId : '';
        const screen = result.screen as FlowElementMetadata | undefined;
        if (interviewId && screen) {
          setFlowRun({
            interviewId, flowApiName: flowDebug.flow.apiName, screen,
            launchInputs:flowDebug.inputs,
            values: { ...initialScreenValues(screen), ...(result.values as Record<string, unknown> | undefined) }, screenResources: (result.screenResources as Record<string, unknown> | undefined) ?? {},
            outcomes: (result.outcomes as Array<{ name: string; label: string }> | undefined)
              ?? [{ name: 'Default', label: 'Next' }],
            canGoBack: false
          });
        } else {
          window.dispatchEvent(new CustomEvent('metadrive:flow-completed', { detail: { flowApiName: flowDebug.flow.apiName, outputs: result.outputs ?? {} } })); notify(`Flow completed${result.outputs && typeof result.outputs === 'object' && Object.keys(result.outputs).length
            ? ` · ${JSON.stringify(result.outputs)}` : ''}`);
        }
        if (interviewId && !screen) notify('Flow interview started and is waiting for an asynchronous stage or approval. View it under Pending Work.');
        setFlowDebug(null);
        return;
      }
      setFlowDebug((current) => current ? { ...current, result, running: false } : current);
    } catch (error) {
      const responseBody = error instanceof ApiRequestError
        && typeof error.responseBody === 'object' && error.responseBody !== null
        ? error.responseBody as Record<string, unknown>
        : undefined;
      setFlowDebug((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : 'Flow debug failed',
        result: responseBody && Array.isArray(responseBody.debugTrace) ? responseBody : undefined,
        running: false
      } : current);
    }
  };

  const runSavedFlowTests = async (definition: FlowDefinitionMetadata): Promise<Array<{
    id: string; label: string; passed: boolean; actualStatus: string; details: string
  }>> => {
    const saved = flowSnapshots.current.get(definition.apiName);
    if (!saved || saved !== JSON.stringify(definition)) {
      throw new Error('Save the Flow and its test cases before running them.');
    }
    const results: Array<{ id: string; label: string; passed: boolean; actualStatus: string; details: string }> = [];
    for (const test of definition.tests ?? []) {
      try {
        const isRecord = definition.flowType === 'Record-Triggered Flow';
        if (!isRecord && !['Autolaunched Flow', 'Screen Flow', 'In-Screen Flow', 'Flow Orchestration'].includes(definition.flowType)) {
          throw new Error('This Flow type cannot be tested through a manual run.');
        }
        const payload = isRecord ? {
          event: test.event ?? 'created',
          record: test.record ?? {},
          ...(test.prior ? { prior: test.prior } : {}),
          isClone: test.isClone === true
        } : test.input ?? {};
        const endpoint = isRecord ? 'debug-record' : 'debug';
        const response = await apiRequest<Record<string, unknown>>(
          `/flows/${encodeURIComponent(definition.apiName)}/${endpoint}`,
          { method: 'POST', body: JSON.stringify(payload) }
        );
        const actualStatus = typeof response.status === 'string' ? response.status : 'completed';
        const wrongOutputs: string[] = [];
        const outputs = response.outputs && typeof response.outputs === 'object' && !Array.isArray(response.outputs)
          ? response.outputs as Record<string, unknown> : {};
        for (const [name, expected] of Object.entries(test.expectedOutputs ?? {})) {
          if (!flowTestValuesEqual(outputs[name], expected)) wrongOutputs.push(name);
        }
        const passed = actualStatus === test.expectedStatus && wrongOutputs.length === 0;
        results.push({
          id: test.id, label: test.label, passed, actualStatus,
          details: passed ? 'Expected result matched'
            : `Expected ${test.expectedStatus}${wrongOutputs.length ? `; different outputs: ${wrongOutputs.join(', ')}` : ''}`
        });
      } catch (error) {
        results.push({
          id: test.id, label: test.label, passed: false, actualStatus: 'error',
          details: error instanceof Error ? error.message : 'Test could not execute'
        });
      }
    }
    return results;
  };

  const runFlow = async (apiName = flow.apiName, inputs: Record<string, unknown> = {}, context:{requestId?:string}={}) => {
    const selectedFlow = flows.find((item) => item.apiName === apiName);
    if (!selectedFlow) {
      notify(`Flow "${apiName}" was not found`);
      return;
    }
    const savedSnapshot = flowSnapshots.current.get(apiName);
    if (!savedSnapshot) {
      notify('Save the flow before running it');
      return;
    }
    const hasUnsavedChanges = savedSnapshot !== JSON.stringify(selectedFlow);
    if (hasUnsavedChanges) notify('Running the most recently saved version; unsaved changes are not included.');
    const inputResources = selectedFlow.resources.filter((resource) => resource.availableForInput);
    if (inputResources.length && Object.keys(inputs).length === 0) {
      const defaultInputs = Object.fromEntries(inputResources.map((resource) => [resource.name, resource.value === undefined
        ? ''
        : typeof resource.value === 'string' ? resource.value : JSON.stringify(resource.value)]));
      setFlowDebug({ flow: selectedFlow, mode: 'run', inputs: { ...defaultInputs, ...Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])) }, error: '', running: false });
      return;
    }
    try {
      const result = await apiRequest<{ outputs?: Record<string, unknown>; interviewId?: string; screen?: FlowElementMetadata; outcomes?: Array<{ name: string; label: string }>; values?: Record<string, unknown>; screenResources?: Record<string, unknown> }>(`/flows/${encodeURIComponent(selectedFlow.apiName)}/execute`, {
        method: 'POST',
        body: JSON.stringify(inputs)
      });
      if (result.interviewId && result.screen) {
        setFlowRunnerError('');
        setFlowRun({ requestId:context.requestId,launchInputs:inputs,interviewId: result.interviewId, flowApiName: selectedFlow.apiName, screen: result.screen, values: { ...initialScreenValues(result.screen), ...(result.values ?? {}) },
          screenResources: result.screenResources ?? {}, outcomes: result.outcomes ?? [{ name: 'Default', label: 'Next' }], canGoBack: false });
        return;
      }
      if (result.interviewId) {
        window.dispatchEvent(new CustomEvent('metadrive:flow-paused', { detail: {
          requestId:context.requestId,flowApiName:selectedFlow.apiName,interviewId:result.interviewId
        } }));
        notify('Flow interview started. Approval stages and waiting work are visible in Pending Work.');
        return;
      }
      window.dispatchEvent(new CustomEvent('metadrive:flow-completed', { detail: { requestId:context.requestId,flowApiName: selectedFlow.apiName, outputs: result.outputs ?? {} } })); notify(`Flow completed${result.outputs && Object.keys(result.outputs).length ? ` · ${JSON.stringify(result.outputs)}` : ''}`);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('metadrive:flow-failed', { detail: { requestId:context.requestId,flowApiName: selectedFlow.apiName, message: error instanceof Error ? error.message : 'Unable to run flow' } })); notify(error instanceof Error ? error.message : 'Unable to run flow');
    }
  };

  const submitFlowScreen = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flowRun) return;
    setFlowRunnerSubmitting(true);
    try {
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const selectedOutcome = submitter instanceof HTMLButtonElement ? submitter.value : '';
      const result = await apiRequest<{ completed?: boolean; outputs?: Record<string, unknown>; interviewId?: string; screen?: FlowElementMetadata; outcomes?: Array<{ name: string; label: string }>; canGoBack?: boolean; values?: Record<string, unknown>; screenResources?: Record<string, unknown> }>(`/flow-interviews/${encodeURIComponent(flowRun.interviewId)}/next`, {
        method: 'POST',
        body: JSON.stringify({ values: flowRun.values, ...(selectedOutcome ? { outcome: selectedOutcome } : {}) })
      });
      if (result.interviewId && result.screen) {
        setFlowRunnerError('');
        setFlowRun({
          requestId:flowRun.requestId,launchInputs:flowRun.launchInputs,interviewId: result.interviewId, flowApiName: flowRun.flowApiName,
          screen: result.screen,
          values: { ...initialScreenValues(result.screen), ...(result.values ?? {}) },
          screenResources: result.screenResources ?? {},
          outcomes: result.outcomes ?? [{ name: 'Default', label: 'Next' }],
          canGoBack: result.canGoBack === true
        });
        return;
      }
      if (result.interviewId) {
        setFlowRun(null);
        setFlowRunnerError('');
        window.dispatchEvent(new CustomEvent('metadrive:flow-paused', { detail: {
          requestId:flowRun.requestId,flowApiName:flowRun.flowApiName,interviewId:result.interviewId
        } }));
        notify('Flow interview is waiting. Resume status is visible in Pending Work.');
        return;
      }
      setFlowRun(null);
      setFlowRunnerError('');
      window.dispatchEvent(new CustomEvent('metadrive:flow-completed', { detail: { requestId:flowRun.requestId,flowApiName: flowRun.flowApiName, outputs: result.outputs ?? {} } })); notify(`Flow completed${result.outputs && Object.keys(result.outputs).length ? ` · ${JSON.stringify(result.outputs)}` : ''}`);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('metadrive:flow-failed', { detail: { requestId:flowRun.requestId,flowApiName: flowRun.flowApiName, message: error instanceof Error ? error.message : 'Unable to continue flow' } })); setFlowRunnerError(error instanceof Error ? error.message : 'Unable to continue flow');
      notify(error instanceof Error ? error.message : 'Unable to continue flow');
    } finally {
      setFlowRunnerSubmitting(false);
    }
  };

  const goBackFlowScreen = async () => {
    if (!flowRun || !flowRun.canGoBack) return;
    setFlowRunnerSubmitting(true);
    try {
      const result = await apiRequest<{ interviewId: string; screen: FlowElementMetadata; outcomes?: Array<{ name: string; label: string }>; canGoBack?: boolean; values?: Record<string, unknown>; screenResources?: Record<string, unknown> }>(
        `/flow-interviews/${encodeURIComponent(flowRun.interviewId)}/next`,
        { method: 'POST', body: JSON.stringify({ action: 'back' }) }
      );
      setFlowRun({
        requestId:flowRun.requestId,launchInputs:flowRun.launchInputs,interviewId: result.interviewId, flowApiName: flowRun.flowApiName,
        screen: result.screen,
        values: { ...initialScreenValues(result.screen), ...(result.values ?? {}) },
          screenResources: result.screenResources ?? {},
        outcomes: result.outcomes ?? [{ name: 'Default', label: 'Next' }],
        canGoBack: result.canGoBack === true
      });
      setFlowRunnerError('');
    } catch (error) {
      setFlowRunnerError(error instanceof Error ? error.message : 'Unable to return to the previous screen');
      notify(error instanceof Error ? error.message : 'Unable to return to the previous screen');
    } finally {
      setFlowRunnerSubmitting(false);
    }
  };

  const createFlow = (label: string, flowType: FlowDefinitionMetadata['flowType']) => {
    const cleanLabel = label.trim();
    const baseName=generateMetadataApiName(cleanLabel)||'New_Flow';
    const apiName=suggestMetadataApiName(baseName,flows.map(item=>item.apiName));
    if(!apiName){notify('Enter a valid Flow name');return;}
    if(apiName!==baseName)notify('Duplicate API Name. Suggested '+apiName);
    const destination: AppRoute = { kind: 'setup', workspace: 'flow-builder', resourceApiName: apiName };
    if (!confirmFlowNavigation(destination)) return;
    const triggerObject = flowType === 'Platform Event-Triggered Flow'
      ? platformEvents[0]?.apiName ?? null
      : flowType === 'Record-Triggered Flow' || flowType === 'Schedule-Triggered Flow'
        ? objects.find((item) => item.apiName !== 'User')?.apiName ?? null
        : null;
    const startConfig: Record<string, unknown> = flowType === 'Schedule-Triggered Flow'
      ? { startDate: '', startTime: '', timeZone: 'UTC', frequency: '', entryConditions: [] }
      : flowType === 'Platform Event-Triggered Flow'
        ? { entryConditions: [] }
        : flowType === 'Record-Triggered Flow'
          ? { trigger: 'created-or-updated', runWhen: 'after-save', entryConditions: [] }
          : {};
    const created: FlowDefinitionMetadata = {
      apiName,
      label: cleanLabel,
      flowType,
      status: 'Draft',
      versionNumber: 1,
      activeVersion: null,
      triggerObject,
      startConfig,
      elements: [
        { id: 1, type: 'Start', label: `${flowType} Start`, config: { ...startConfig, ...(triggerObject ? { object: triggerObject } : {}) } },
        ...(flowType==='In-Screen Flow' ? [{id:2,type:'Screen',label:'Window Screen',config:{fields:[]}}] : []),
        { id: flowType==='In-Screen Flow'?3:2, type: 'End', label: 'End', config: {} }
      ],
      connectors: flowType==='In-Screen Flow'
        ? [{id:'connector-start-window',from:1,to:2,label:'',kind:'normal' as const},
           {id:'connector-window-end',from:2,to:3,label:'',kind:'normal' as const}]
        : [{ id: 'connector-start-end', from: 1, to: 2, label: '', kind: 'normal' as const }],
      resources: [],
      versions: []
    };
    setFlow(created);
    flowHistory.current = { undo: [], redo: [] };
    setFlows((current) => [...current, created]);
    setSelectedFlowId(1);
    setFlowValidation(null);
    navigateRoute(destination, true);
  };

  const cloneFlow = async (source: FlowDefinitionMetadata) => {
    if (!confirmDiscardFlowChanges()) return;
    const baseApiName = `${source.apiName}_Copy`;
    let apiName = baseApiName;
    let suffix = 2;
    while (flows.some((item) => item.apiName.toLowerCase() === apiName.toLowerCase())) {
      apiName = `${baseApiName}_${suffix}`;
      suffix += 1;
    }
    const cloned: FlowDefinitionMetadata = {
      ...structuredClone(source),
      apiName,
      label: `${source.label} Copy`,
      status: 'Draft',
      versionNumber: 1,
      activeVersion: null,
      versions: []
    };
    try {
      const result = await apiRequest<{ flow: FlowDefinitionMetadata }>(
        `/metadata/flows/${encodeURIComponent(apiName)}`,
        { method: 'PUT', body: JSON.stringify(cloned) }
      );
      flowSnapshots.current.set(result.flow.apiName, JSON.stringify(result.flow));
      setFlow(result.flow);
      setFlows((current) => [...current, result.flow]);
      flowHistory.current = { undo: [], redo: [] };
      setSelectedFlowId(result.flow.elements[0]?.id ?? 1);
      setFlowValidation(null);
      navigateRoute({ kind: 'setup', workspace: 'flow-builder', resourceApiName: result.flow.apiName }, true);
      notify('Flow cloned as a new draft');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to clone flow');
    }
  };

  const deactivateFlow = async (apiName: string) => {
    if (flow.apiName === apiName && !confirmDiscardFlowChanges()) return;
    try {
      const result = await apiRequest<{ flow: FlowDefinitionMetadata }>(
        `/metadata/flows/${encodeURIComponent(apiName)}/deactivate`,
        { method: 'POST' }
      );
      flowSnapshots.current.set(result.flow.apiName, JSON.stringify(result.flow));
      setFlows((current) => current.map((item) => item.apiName === apiName ? result.flow : item));
      if (flow.apiName === apiName) setFlow(result.flow);
      setFlowValidation(null);
      notify('Flow deactivated');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to deactivate flow');
    }
  };

  const deleteFlow = async (apiName: string) => {
    const candidate = flows.find((item) => item.apiName === apiName);
    if (!candidate || !window.confirm(`Delete flow "${candidate.label}"? This cannot be undone.`)) return;
    try {
      await apiRequest<void>(`/metadata/flows/${encodeURIComponent(apiName)}`, { method: 'DELETE' });
      flowSnapshots.current.delete(apiName);
      const remaining = flows.filter((item) => item.apiName !== apiName);
      setFlows(remaining);
      if (flow.apiName === apiName) {
        const nextFlow = remaining[0] ?? defaultFlow;
        setFlow(nextFlow);
        flowHistory.current = { undo: [], redo: [] };
        setSelectedFlowId(nextFlow.elements[0]?.id ?? 1);
        setFlowValidation(null);
        navigateRoute(remaining.length
          ? { kind: 'setup', workspace: 'flow-builder', resourceApiName: nextFlow.apiName }
          : { kind: 'setup', workspace: 'flow-builder' }, true);
      }
      notify('Flow deleted');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to delete flow');
    }
  };

  const selectFlow = (apiName: string) => {
    const selectedFlow = flows.find((item) => item.apiName === apiName);
    if (!selectedFlow) return;
    const destination: AppRoute = { kind: 'setup', workspace: 'flow-builder', resourceApiName: selectedFlow.apiName };
    if (!confirmFlowNavigation(destination)) return;
    setFlow(selectedFlow);
    flowHistory.current = { undo: [], redo: [] };
    setSelectedFlowId(selectedFlow.elements[0]?.id ?? 1);
    setFlowValidation(null);
    navigateRoute(destination, true);
  };

  const restoreFlowVersion = async (version: FlowVersionMetadata) => {
    if (!confirmDiscardFlowChanges()) return;
    try {
      const restored = await apiRequest<{ version: FlowVersionMetadata }>(
        `/metadata/flows/${encodeURIComponent(flow.apiName)}/versions/${version.versionNumber}`);
      await saveFlow({
        ...flow,
        label: restored.version.label ?? flow.label,
        description: restored.version.description ?? flow.description,
        flowType: restored.version.flowType ?? flow.flowType,
        triggerObject: restored.version.triggerObject === undefined ? flow.triggerObject : restored.version.triggerObject,
        startConfig: restored.version.startConfig ?? flow.startConfig,
        elements: structuredClone(restored.version.elements),
        connectors: structuredClone(restored.version.connectors),
        resources: structuredClone(restored.version.resources),
        tests: structuredClone(restored.version.tests ?? []),
        status: 'Draft'
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to restore Flow version');
    }
  };

  const exportFlow = () => {
    const exportBlob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(exportBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${flow.apiName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  };

  const importFlow = async (file: File) => {
    if (!confirmDiscardFlowChanges()) return;
    try {
      const importedValue: unknown = JSON.parse(await file.text());
      if (typeof importedValue !== 'object' || importedValue === null || Array.isArray(importedValue)) {
        throw new Error('The selected file must contain a Flow JSON object.');
      }
      const imported = importedValue as Record<string, unknown>;
      const apiName = imported.apiName;
      if (typeof apiName !== 'string' || typeof imported.label !== 'string'
        || !Array.isArray(imported.elements) || !Array.isArray(imported.connectors)
        || !Array.isArray(imported.resources)) {
        throw new Error('The selected JSON does not contain a complete Flow definition.');
      }
      if (flows.some((item) => item.apiName.toLowerCase() === apiName.toLowerCase())) {
        throw new Error(`A Flow named "${apiName}" already exists. Rename the API name in the JSON before importing.`);
      }
      const destination: AppRoute = {
        kind: 'setup',
        workspace: 'flow-builder',
        resourceApiName: apiName
      };
      if (!confirmFlowNavigation(destination)) return;
      const result = await apiRequest<{ flow: FlowDefinitionMetadata }>(
        `/metadata/flows/${encodeURIComponent(apiName)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...imported,
            status: 'Draft',
            versionNumber: 1,
            activeVersion: null,
            versions: []
          })
        }
      );
      flowSnapshots.current.set(result.flow.apiName, JSON.stringify(result.flow));
      setFlows((current) => [...current, result.flow]);
      setFlow(result.flow);
      flowHistory.current = { undo: [], redo: [] };
      setSelectedFlowId(result.flow.elements[0]?.id ?? 1);
      setFlowValidation(null);
      navigateRoute(destination, true);
      notify('Flow imported as a new draft');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to import Flow');
    }
  };


 return { saveFlow, saveNamedCredential, toggleNamedCredentialEnabled, deleteNamedCredential, saveEmailAlert, deleteEmailAlert, savePlatformEvent, deletePlatformEvent, saveApprovalProcess, deleteApprovalProcess, validateFlow, openFlowDebug, parseFlowInputs, runFlowDebug, runSavedFlowTests, runFlow, submitFlowScreen, goBackFlowScreen, createFlow, cloneFlow, deactivateFlow, deleteFlow, selectFlow, restoreFlowVersion, exportFlow, importFlow };
}
