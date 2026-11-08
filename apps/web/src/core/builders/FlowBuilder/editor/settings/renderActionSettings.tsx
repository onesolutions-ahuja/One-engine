import { displayValue } from '../../flowEditorData';
import HttpCalloutFieldEditor from '../../HttpCalloutFieldEditor';
import FlowReferenceInput from '../../../FlowReferenceInput/FlowReferenceInput';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { useFlowConfiguration } from './useFlowConfiguration';
import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowGraphActions } from '../canvas/useFlowGraphActions';

export function renderActionSettings(
  editorState: ReturnType<typeof useFlowEditorState>,
  configuration: ReturnType<typeof useFlowConfiguration>,
  props: FlowBuilderProps,
  graphActions: ReturnType<typeof useFlowGraphActions>,
) {
  const {
    selected, externalServices, externalServiceError, newExternalServiceApiName,
    setNewExternalServiceApiName, newExternalServiceLabel, setNewExternalServiceLabel,
    setExternalServices, setExternalServiceError,
  } = editorState;
  const { setConfig } = configuration;
  const {
    onFlowChange, flow, onImportExternalService, onLoadExternalServices, onNotify,
    namedCredentials, objects, integrationConnections, connectorProviders, approvalProcesses,
    users, emailAlerts,
  } = props;
  const { selectedObject } = graphActions;
  return <>
      <label className="form-label">Action Type<select className="form-control" value={displayValue(selected.config.actionType)} onChange={(event) => setConfig('actionType', event.target.value)}><option value="">Select action</option><option>Generate 4-Digit Random OTP</option><option>Generate 6-Digit Random OTP</option><option>Create Task</option><option>Quick Actions</option><option>Custom Notification</option><option>Send Email</option><option>Email Alert</option><option>Post to Chatter</option><option>External Service Action</option><option>Outbound Message</option><option>Submit for Approval</option></select></label>
      {displayValue(selected.config.actionType) === 'External Service Action' && (() => {
        const service = externalServices.find((item) => item.apiName === selected.config.externalServiceApiName);
        const operation = service?.operations.find((item) => item.operationApi === selected.config.externalOperationApiName);
        const inputs = selected.config.externalInputs && typeof selected.config.externalInputs === 'object'
          && !Array.isArray(selected.config.externalInputs)
          ? selected.config.externalInputs as Record<string, unknown> : {};
        const updateInput = (name: string, value: string) => setConfig('externalInputs', { ...inputs, [name]: value });
        return <>
          <label className="form-label">External Service<select className="form-control"
            value={displayValue(selected.config.externalServiceApiName)}
            onChange={(event) => onFlowChange({
              ...flow, elements: flow.elements.map((element) => element.id === selected.id
                ? { ...element, config: { ...element.config, externalServiceApiName: event.target.value,
                  externalOperationApiName: '', externalInputs: {} } } : element)
            })}>
            <option value="">Select imported service</option>
            {externalServices.map((item) => <option key={item.apiName} value={item.apiName}>{item.label} · {item.apiName}</option>)}
          </select></label>
          <label className="form-label">Operation<select className="form-control"
            value={displayValue(selected.config.externalOperationApiName)}
            onChange={(event) => onFlowChange({
              ...flow, elements: flow.elements.map((element) => element.id === selected.id
                ? { ...element, config: { ...element.config, externalOperationApiName: event.target.value,
                  externalInputs: {} } } : element)
            })}>
            <option value="">Select operation</option>
            {service?.operations.map((item) => <option key={item.operationApi} value={item.operationApi}>
              {item.method} {item.path} · {item.label}
            </option>)}
          </select></label>
          {externalServiceError && <p className="info-callout" role="alert">{externalServiceError}</p>}
          <div className="metadata-card">
            <h3>Import an OpenAPI 3.x definition</h3>
            <label className="form-label">Service API Name<input className="form-control" value={newExternalServiceApiName}
              onChange={(event) => setNewExternalServiceApiName(event.target.value)} placeholder="InventoryService" /></label>
            <label className="form-label">Service Label<input className="form-control" value={newExternalServiceLabel}
              onChange={(event) => setNewExternalServiceLabel(event.target.value)} placeholder="Inventory Service" /></label>
            <label className="form-label">OpenAPI JSON<input className="form-control" type="file" accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => {
                  const spec = JSON.parse(text) as unknown;
                  return onImportExternalService(newExternalServiceApiName, newExternalServiceLabel, spec);
                }).then(() => onLoadExternalServices()).then((result) => {
                  setExternalServices(result.services);
                  setExternalServiceError('');
                  onNotify('External Service imported.');
                }).catch((error) => onNotify(error instanceof Error ? error.message : 'External Service import failed.'));
              }} /></label>
            <p className="settings-panel-copy">Only inline OpenAPI 3.x operations using path/query parameters and JSON object bodies are supported. Callouts run through an HTTPS Named Credential and are queued durably.</p>
          </div>
          {operation && <>
            <label className="form-label">HTTPS Named Credential<select className="form-control"
              value={displayValue(selected.config.namedCredentialId)}
              onChange={(event) => setConfig('namedCredentialId', event.target.value)}>
              <option value="">Select credential</option>
              {namedCredentials.filter((credential) => credential.protocol === 'HTTPS' && credential.enabled)
                .map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}
            </select></label>
            <div className="flow-config-list">{operation.parameters.map((parameter) => (
              <label className="form-label" key={`${parameter.location}-${parameter.name}`}>
                {parameter.location === 'body' ? 'JSON Request Body' : `${parameter.location === 'path' ? 'Path' : 'Query'} · ${parameter.name}`}
                {parameter.required ? ' *' : ''}
                {parameter.location === 'body'
                  ? <FlowReferenceInput multiline ariaLabel={parameter.name} value={displayValue(inputs[parameter.name])}
                    flow={flow} elementId={selected.id} objects={objects}
                    onChange={value => updateInput(parameter.name, value)} />
                  : <FlowReferenceInput ariaLabel={parameter.name} value={displayValue(inputs[parameter.name])}
                    flow={flow} elementId={selected.id} objects={objects}
                    onChange={value => updateInput(parameter.name, value)} />}
              </label>
            ))}</div>
            <div className="info-callout">This Action queues a durable HTTPS callout through the selected Named Credential. Execution requires Flow permissions and HTTP Callout execution permission. Responses are not returned to the Flow.</div>
          </>}
        </>;
      })()}
      {flow.apiName === 'SYSTEM_PASSWORD_RECOVERY' && displayValue(selected.config.actionType) === 'Generate Verification' ? <>
        <label className="form-label">Verification Method<select className="form-control" value={displayValue(selected.config.method) || 'TENANT_POLICY'} onChange={(event)=>setConfig('method',event.target.value)}>
          <option value="TENANT_POLICY">Tenant policy</option><option value="OTP">Email OTP</option><option value="LINK">Reset link</option></select></label>
        <div className="info-callout">The verification secret is generated and protected by the platform; it is never exposed to flow debug.</div>
      </> : flow.apiName === 'SYSTEM_PASSWORD_RECOVERY' && displayValue(selected.config.actionType) === 'Send Recovery Communication' ? <>
        <label className="form-label">Channel<select className="form-control" value={displayValue(selected.config.channel) || 'email'} onChange={(event)=>setConfig('channel',event.target.value)}>
          <option value="email">Email (enabled)</option><option value="sms" disabled>SMS (requires verified contact and provider)</option><option value="whatsapp" disabled>WhatsApp (requires verified contact and provider)</option></select></label>
        <label className="form-label">Template Source<select className="form-control" value={displayValue(selected.config.templateSource) || 'TENANT'} onChange={(event)=>setConfig('templateSource',event.target.value)}>
          <option value="TENANT">Tenant recovery template</option><option value="FLOW">Override in this Flow</option></select></label>
        <label className="form-label">Subject<input className="form-control" maxLength={240} value={displayValue(selected.config.subject)} onChange={(event)=>setConfig('subject',event.target.value)} /></label>
        <label className="form-label">Body<textarea className="form-control" rows={6} maxLength={4000} value={displayValue(selected.config.body)} onChange={(event)=>setConfig('body',event.target.value)} /></label>
        <div className="info-callout">Protected verification variables: {'{!Tenant.Id}'}, {'{!Tenant.Name}'}, {'{!Verification.Value}'}, {'{!Verification.ExpiryMinutes}'}. Password verification and session revocation cannot be disabled.</div>
      </> : flow.apiName === 'SYSTEM_PASSWORD_RECOVERY' && ['Verify Verification','Reset Password'].includes(displayValue(selected.config.actionType)) ? <>
        <div className="info-callout">This protected platform action validates and updates only the account associated with the issued single-use recovery challenge. It cannot be bypassed or configured to change another user's password.</div>
      </> : ['Generate 4-Digit Random OTP','Generate 6-Digit Random OTP'].includes(displayValue(selected.config.actionType)) ? <>
        <label className="form-label">Output Variable<input className="form-control" maxLength={128}
          value={displayValue(selected.config.outputVariable)} onChange={(event) => setConfig('outputVariable', event.target.value)}
          placeholder="verificationOtp" /></label>
        <div className="info-callout">Generates a cryptographically secure 4- or 6-digit numeric OTP as text, preserving leading zeroes. Store it securely and implement expiry, attempt limits and single-use verification in your Flow.</div>
            </> : displayValue(selected.config.actionType) === 'Create Task' ? <>
        <label className="form-label">Target Object<select className="form-control" value={displayValue(selected.config.objectApiName)} onChange={(event) => setConfig('objectApiName', event.target.value)}><option value="">Select an object</option>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label>
        <label className="form-label">Target Record ID<FlowReferenceInput ariaLabel="Record ID" value={displayValue(selected.config.recordId)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recordId',value)}/></label>
        <label className="form-label">Subject<FlowReferenceInput ariaLabel="Subject" value={displayValue(selected.config.subject)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('subject',value)}/></label>
        <label className="form-label">Description<FlowReferenceInput ariaLabel="Description" multiline value={displayValue(selected.config.description)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('description',value)}/></label>
        <label className="form-label">Due Date (ISO 8601)<FlowReferenceInput ariaLabel="Due date" value={displayValue(selected.config.dueAt)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('dueAt',value)}/></label>
        <div className="info-callout">Creates a Task activity on the target record in the Flow transaction. The running user needs edit access to the target record.</div>
      </> : displayValue(selected.config.actionType) === 'Quick Actions' ? <>
        <label className="form-label">Target Object<select className="form-control" value={displayValue(selected.config.objectApiName)} onChange={(event) => { setConfig('objectApiName', event.target.value); setConfig('quickActionId', ''); }}><option value="">Select an object</option>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label>
        <label className="form-label">Quick Action<select className="form-control" value={displayValue(selected.config.quickActionId)} onChange={(event) => setConfig('quickActionId', event.target.value)}><option value="">Select an enabled action</option>{objects.find((object) => object.apiName === displayValue(selected.config.objectApiName))?.actions?.filter((action) => action.type === 'Custom' && action.enabled && action.behavior === 'Set Field Value').map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}</select></label>
        <label className="form-label">Target Record ID<FlowReferenceInput ariaLabel="Record ID" value={displayValue(selected.config.recordId)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recordId',value)}/></label>
        <div className="info-callout">Runs the enabled metadata-defined Set Field Value action against the selected record in the Flow transaction. The running user needs object, record, and target-field edit access.</div>
      </> : displayValue(selected.config.actionType) === 'Post to Chatter' ? <>
        <label className="form-label">Target Object<select className="form-control" value={displayValue(selected.config.objectApiName)} onChange={(event) => setConfig('objectApiName', event.target.value)}><option value="">Select an object</option>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label>
        <label className="form-label">Target Record ID<FlowReferenceInput ariaLabel="Record ID" value={displayValue(selected.config.recordId)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recordId',value)}/></label>
        <label className="form-label">Message<FlowReferenceInput ariaLabel="Message" multiline value={displayValue(selected.config.message)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('message',value)}/></label>
        <div className="info-callout">Post to Chatter adds a message to a record feed when the running user has edit access and Chatter is enabled for the target object.</div>
      </> : displayValue(selected.config.actionType) === 'Custom Notification' ? <>
        <label className="form-label">Recipient User IDs (comma or newline separated)<FlowReferenceInput ariaLabel="Recipient user IDs" multiline value={displayValue(selected.config.recipientIds)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recipientIds',value)}/></label>
        <label className="form-label">Title<FlowReferenceInput ariaLabel="Title" value={displayValue(selected.config.title)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('title',value)}/></label>
        <label className="form-label">Message<FlowReferenceInput ariaLabel="Message" multiline value={displayValue(selected.config.messageBody)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('messageBody',value)}/></label>
        <div className="info-callout">Delivers a persistent notification to each active user in this tenant. The running user needs the Send Custom Notifications permission; recipients can view and mark their own notifications as read.</div>
      </> : displayValue(selected.config.actionType) === 'Outbound Message' ? <>
        <div className="info-callout">Deliver SMS, WhatsApp or other messages through an activated provider operation or tenant HTTPS Named Credential. Messages are queued in the encrypted SQL outbox; provider activation, HTTPS credentials and execution permissions are required. Configure destination, sender and any consent fields using the provider's expected request mapping.</div>
        <label className="form-label">Integration Connection
          <select className="form-control" aria-label="Outbound Message provider" value={displayValue(selected.config.integrationConnectionId)}
            onChange={(event) => {setConfig('integrationConnectionId',event.target.value);setConfig('operation','');setConfig('namedCredentialId','');setConfig('path','');}}>
            <option value="">Use a tenant HTTPS Named Credential</option>
            {integrationConnections.filter(connection=>connection.status==='ACTIVE').map(connection=>
              <option key={connection.id} value={connection.id}>{connection.name}</option>)}
          </select>
        </label>
        {displayValue(selected.config.integrationConnectionId) ? <>
          <label className="form-label">Provider Operation
            <select className="form-control" aria-label="Outbound Message operation" value={displayValue(selected.config.operation)}
              onChange={(event)=>{
                const connection=integrationConnections.find(item=>item.id===displayValue(selected.config.integrationConnectionId));
                const provider=connectorProviders.find(item=>item.connectorKey===connection?.connectorKey);
                const operation=provider?.operations[event.target.value];
                setConfig('operation',event.target.value);
                if(operation){setConfig('method',operation.method);setConfig('path',operation.path);}
              }}>
              <option value="">Select a POST messaging operation</option>
              {Object.entries(connectorProviders.find(provider=>provider.connectorKey===
                integrationConnections.find(connection=>connection.id===displayValue(selected.config.integrationConnectionId))?.connectorKey)?.operations??{})
                .filter(([,operation])=>operation.method==='POST')
                .map(([name])=><option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </> : <>
          <label className="form-label">HTTPS Named Credential
            <select className="form-control" value={displayValue(selected.config.namedCredentialId)}
              onChange={(event)=>setConfig('namedCredentialId',event.target.value)}>
              <option value="">Select a credential</option>
              {namedCredentials.filter(c=>c.protocol==='HTTPS').map(c=>
                <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="form-label">Relative POST Endpoint
            <FlowReferenceInput ariaLabel="Relative POST endpoint" value={displayValue(selected.config.path)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('path',value)}/>
          </label>
        </>}
        <HttpCalloutFieldEditor label="Message Request Fields" mode="body"
          value={displayValue(selected.config.body)} onChange={(value)=>setConfig('body',value)}
          resources={flow.resources} fields={selectedObject?.fields??[]} picker={{flow,elementId:selected.id,objects}} />
        <p className="settings-panel-copy">The published Flow sends the mapped JSON to the provider using durable delivery. Use a Decision element to enforce verified contact and opt-in rules before this action. Protected password-recovery messaging remains separate.</p>
      </> : displayValue(selected.config.actionType) === 'Submit for Approval' ? <>
        <label className="form-label">Approval Process<select className="form-control" value={displayValue(selected.config.approvalProcessApiName)} onChange={(event) => {
          const process = approvalProcesses.find((item) => item.apiName === event.target.value);
          setConfig('approvalProcessApiName', event.target.value);
          if (process) setConfig('objectApiName', process.objectApiName);
        }}><option value="">Select an approval process</option>{approvalProcesses.filter((process) => process.active).map((process) => <option key={process.apiName} value={process.apiName}>{process.label} · {process.objectApiName}</option>)}</select></label>
        <label className="form-label">Target Object<select className="form-control" value={displayValue(selected.config.objectApiName)} onChange={(event) => setConfig('objectApiName', event.target.value)}><option value="">Select an object</option>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label>
        <label className="form-label">Target Record ID<FlowReferenceInput ariaLabel="Record ID" value={displayValue(selected.config.recordId)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recordId',value)}/></label>
        {!displayValue(selected.config.approvalProcessApiName) && <label className="form-label">Approvers<select className="form-control" multiple size={Math.min(6, Math.max(3, users.length))} value={displayValue(selected.config.approverIds).split(/[;,\r\n]+/).map((id) => id.trim()).filter(Boolean)} onChange={(event) => setConfig('approverIds', Array.from(event.currentTarget.selectedOptions, (option) => option.value).join(', '))}>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.username}</option>)}</select></label>}
        <label className="form-label">Submission Comments<FlowReferenceInput ariaLabel="Comments" multiline value={displayValue(selected.config.comments)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('comments',value)}/></label>
        <div className="info-callout">{displayValue(selected.config.approvalProcessApiName) ? 'Submits through the selected reusable approval process.' : 'Select an approval process or use the direct approver list.'} The submitter needs record edit access. Each approver must be enabled, have approval rights and be able to read the record. Approvers decide from the notification center.</div>
      </> : displayValue(selected.config.actionType) === 'Email Alert' ? <>
        <label className="form-label">Email Alert<select className="form-control" value={displayValue(selected.config.emailAlertId)} onChange={(event) => setConfig('emailAlertId', event.target.value)}><option value="">Select a saved Email Alert</option>{emailAlerts.filter((alert) => flow.flowType === 'Record-Triggered Flow' && alert.objectApiName === flow.triggerObject).map((alert) => <option key={alert.id} value={alert.id}>{alert.label} · {alert.objectApiName}</option>)}</select></label>
        {emailAlerts.find((alert) => alert.id === displayValue(selected.config.emailAlertId)) && <p className="settings-panel-copy">The selected Email Alert sends its configured recipients and template for the triggering record.</p>}
        {flow.flowType !== 'Record-Triggered Flow' && <div className="info-callout">Email Alerts are available only in record-triggered flows.</div>}
        {flow.flowType === 'Record-Triggered Flow' && !emailAlerts.some((alert) => alert.objectApiName === flow.triggerObject) && <div className="info-callout">Create an Email Alert for {flow.triggerObject || 'the flow object'} in Manager before adding this action.</div>}
      </> : <>
        <label className="form-label">SMTP Named Credential<select className="form-control" value={displayValue(selected.config.namedCredentialId)} onChange={(event) => setConfig('namedCredentialId', event.target.value)}><option value="">Select an SMTP credential</option>{namedCredentials.filter((credential) => credential.protocol === 'SMTP').map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}</select></label>
        <label className="form-label">From Email<input className="form-control" type="email" value={displayValue(selected.config.fromEmail)} onChange={(event) => setConfig('fromEmail', event.target.value)} /></label>
        <label className="form-label">Recipients (comma separated)<FlowReferenceInput ariaLabel="Recipients" value={displayValue(selected.config.recipients)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recipients',value)}/></label>
        <label className="form-label">Subject<FlowReferenceInput ariaLabel="Subject" value={displayValue(selected.config.subject)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('subject',value)}/></label>
        <label className="form-label">Message Body<FlowReferenceInput ariaLabel="Message body" multiline value={displayValue(selected.config.body)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('body',value)}/></label>
        <div className="info-callout">Send Email delivers through the selected tenant SMTP credential. Configure an SMTP Named Credential in Manager first.</div>
      </>}
    </>;
}
