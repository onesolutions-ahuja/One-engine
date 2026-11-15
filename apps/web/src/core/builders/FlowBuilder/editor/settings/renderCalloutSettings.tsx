import { displayValue } from '../../flowEditorData';
import HttpCalloutFieldEditor from '../../HttpCalloutFieldEditor';
import HttpCalloutOutputsEditor from '../../HttpCalloutOutputsEditor';
import FlowReferenceInput from '../../../FlowReferenceInput/FlowReferenceInput';

import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowEditorState } from '../useFlowEditorState';
import type { useFlowConfiguration } from './useFlowConfiguration';
import type { useFlowGraphActions } from '../canvas/useFlowGraphActions';

export function renderCalloutSettings(
  props: FlowBuilderProps,
  editorState: ReturnType<typeof useFlowEditorState>,
  configuration: ReturnType<typeof useFlowConfiguration>,
  graphActions: ReturnType<typeof useFlowGraphActions>,
) {
  const {
    integrationConnections, connectorProviders, namedCredentials, flow, objects, onFlowChange,
    onNotify,
  } = props;
  const { selected } = editorState;
  const { setConfig } = configuration;
  const { selectedObject } = graphActions;

      const selectedConnection = integrationConnections.find((item) => item.id === displayValue(selected.config.integrationConnectionId));
      const selectedProvider = connectorProviders.find((item) => item.connectorKey === selectedConnection?.connectorKey);
      return <>
        <label className="form-label">Named Credential<select className="form-control" value={displayValue(selected.config.namedCredentialId)} onChange={(event) => {
          setConfig('namedCredentialId', event.target.value);
          if (event.target.value) {
            setConfig('namedCredentialResource', '');
            setConfig('integrationConnectionId', '');
            setConfig('integrationConnectionResource', '');
          }
        }}><option value="">Select a credential</option>{namedCredentials.filter((credential) => credential.protocol === 'HTTPS').map((credential) => <option key={credential.id} value={credential.id}>{credential.label} · {credential.baseUrl}</option>)}</select></label>
        <label className="form-label">Provider / Integration Connection<select className="form-control" value={displayValue(selected.config.integrationConnectionId)} onChange={(event) => {
          setConfig('integrationConnectionId', event.target.value);
          if (event.target.value) {
            setConfig('integrationConnectionResource', '');
            setConfig('namedCredentialId', '');
            setConfig('namedCredentialResource', '');
            setConfig('operation', '');
            setConfig('method', 'GET');
            setConfig('path', '');
          }
        }}><option value="">Use a Named Credential instead</option>{integrationConnections.filter((connection) => connection.status === 'ACTIVE').map((connection) => {
          const provider = connectorProviders.find((item) => item.connectorKey === connection.connectorKey);
          return <option key={connection.id} value={connection.id}>{connection.name} · {provider?.name ?? connection.connectorKey}</option>;
        })}</select></label>
        {selectedProvider && <label className="form-label">Operation<select className="form-control" value={displayValue(selected.config.operation)} onChange={(event) => {
          const operationName = event.target.value;
          setConfig('operation', operationName);
          const operation = selectedProvider.operations[operationName];
          if (operation) {
            setConfig('method', operation.method);
            setConfig('path', operation.path);
          }
        }}><option value="">Choose an operation (or configure a path below)</option>{Object.entries(selectedProvider.operations).map(([name, operation]) => <option key={name} value={name}>{name} · {operation.method} {operation.path}</option>)}</select></label>}
        <label className="form-label">Method<select className="form-control" value={displayValue(selected.config.method) || 'GET'} onChange={(event) => setConfig('method', event.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}</select></label>
        <label className="form-label">Relative Path<FlowReferenceInput ariaLabel="Relative path" value={displayValue(selected.config.path)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('path',value)}/></label>
        <label className="form-label">Headers (one per line, Name: value)<FlowReferenceInput multiline ariaLabel="Headers" value={displayValue(selected.config.headers)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value => setConfig('headers', value)} /></label>
        <HttpCalloutFieldEditor label="Query Parameters" mode="query" value={displayValue(selected.config.queryParameters)} onChange={(value) => setConfig('queryParameters', value)} resources={flow.resources} fields={selectedObject?.fields ?? []} picker={{flow,elementId:selected.id,objects}} />
        {typeof selected.config.messageTextField==='string' && (() => {
          const fieldPath=displayValue(selected.config.messageTextField).split('.');
          const validPath=fieldPath.length>0&&fieldPath.length<=3
            &&fieldPath.every(key=>/^[A-Za-z][A-Za-z0-9_]*$/.test(key));
          let payload:Record<string,unknown>={};
          try{
            const parsed=JSON.parse(displayValue(selected.config.body));
            if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))payload=parsed;
          }catch{/* An invalid raw payload is handled by existing callout validation. */}
          const messageValue=fieldPath.reduce<unknown>((value,key)=>
            value&&typeof value==='object'&&!Array.isArray(value)
              ?(value as Record<string,unknown>)[key]:undefined,payload);
          const editMessage=(value:string)=>{
            if(!validPath)return;
            const next=JSON.parse(JSON.stringify(payload)) as Record<string,unknown>;
            let pointer=next;
            for(const key of fieldPath.slice(0,-1)){
              const existing=pointer[key];
              if(!existing||typeof existing!=='object'||Array.isArray(existing))pointer[key]={};
              pointer=pointer[key] as Record<string,unknown>;
            }
            pointer[fieldPath[fieldPath.length-1]]=value;
            setConfig('body',JSON.stringify(next));
          };
          return <label className="form-label">Message Text (editable template)
            <textarea className="form-control" rows={5} maxLength={4000}
              disabled={!validPath} value={typeof messageValue==='string'?messageValue:''}
              onChange={event=>editMessage(event.target.value)}/>
            <span className="settings-panel-copy">Edit only the message here. Recipient, channel and protected credential settings are preserved.</span>
          </label>;
        })()}
        <HttpCalloutFieldEditor label="Request Body" mode="body" value={displayValue(selected.config.body)} onChange={(value) => setConfig('body', value)} resources={flow.resources} fields={selectedObject?.fields ?? []} picker={{flow,elementId:selected.id,objects}} />
        <label className="form-label">Timeout (milliseconds)<input className="form-control" type="number" min={1000} max={30000} value={displayValue(selected.config.timeoutMs)} onChange={(event) => setConfig('timeoutMs', event.target.value)} placeholder={selectedProvider ? String(selectedProvider.timeoutMs) : '15000'} /></label>
        {displayValue(selected.config.deliveryMode) === 'DURABLE_ASYNC' && <label className="form-label">Maximum Retry Attempts<input className="form-control" type="number" min={1} max={5} step={1}
          value={displayValue(selected.config.maxAttempts)}
          onChange={(event) => setConfig('maxAttempts', event.target.value)}
          placeholder="5" /></label>}
        <label className="form-label">Delivery Mode<select className="form-control"
          value={displayValue(selected.config.deliveryMode) || 'SYNC'}
          onChange={(event) => {
            setConfig('deliveryMode', event.target.value);
            if (event.target.value === 'DURABLE_ASYNC') {
              setConfig('responseMapping', '');
              setConfig('responseVariable', '');
              setConfig('statusVariable', '');
            }
          }}>
          <option value="SYNC">Wait for reply and use it (synchronous)</option>
          <option value="DURABLE_ASYNC">Send in background, retry if it fails (durable async)</option>
        </select></label>
        <div className="info-callout">Durable Async stores an encrypted, tenant-scoped job in PostgreSQL and returns HTTP 202 to the Flow. The server worker retries failed delivery up to the configured maximum using a stable Idempotency-Key. Async callouts do not provide response mappings or output variables; a terminal failure is retained with the job.</div>
                <label className="form-label">Idempotency Key (optional)<FlowReferenceInput ariaLabel="Unique ID so it is never sent twice" value={displayValue(selected.config.idempotencyKey)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('idempotencyKey',value)}/></label>
        <div className="info-callout">For a retryable payment, select an existing stable attempt ID
          using a Flow resource reference. The same attempt must reuse the same key across retries;
          a new attempt must use a new key. Leave blank only for non-retryable calls.</div>
        {displayValue(selected.config.deliveryMode) !== 'DURABLE_ASYNC' ? <>
          <HttpCalloutOutputsEditor flow={flow} elementId={selected.id} onFlowChange={onFlowChange} onNotify={onNotify} />
          <details className="flow-advanced-settings">
            <summary>Advanced: map outputs to existing variables</summary>
          <HttpCalloutFieldEditor label="Response Mapping" mode="response" value={displayValue(selected.config.responseMapping)} onChange={(value) => setConfig('responseMapping', value)} resources={flow.resources} fields={selectedObject?.fields ?? []} />
          <label className="form-label">Response Variable<select className="form-control" value={displayValue(selected.config.responseVariable)} onChange={(event) => setConfig('responseVariable', event.target.value)}><option value="">Do not store response</option>{flow.resources.filter((resource) => resource.type !== 'Constant').map((resource) => <option key={resource.name} value={resource.name}>{resource.label} · {resource.name}</option>)}</select></label>
          <label className="form-label">Status Code Variable<select className="form-control" value={displayValue(selected.config.statusVariable)} onChange={(event) => setConfig('statusVariable', event.target.value)}><option value="">Do not store status</option>{flow.resources.filter((resource) => resource.type !== 'Constant').map((resource) => <option key={resource.name} value={resource.name}>{resource.label} · {resource.name}</option>)}</select></label>
          </details>
        </> : <div className="info-callout">Background sending does not return a reply to this Flow. Choose "Wait for reply and use it" to use the response in the next steps.</div>}
        <label className="form-label">{displayValue(selected.config.deliveryMode) === 'DURABLE_ASYNC' ? 'On Queue Error' : 'On Error'}<select className="form-control" value={displayValue(selected.config.onError) || 'FAULT_PATH'} onChange={(event) => setConfig('onError', event.target.value)}><option value="FAULT_PATH">FAULT_PATH</option><option value="FAIL">FAIL</option><option value="CONTINUE">CONTINUE</option></select></label>
        <div className="info-callout">Select a tenant Named Credential or Integration Connection above. The Flow stores only the metadata reference; secrets, tokens, and authentication values remain protected in credential metadata and are never exposed as Flow variables.</div>
        <details className="flow-advanced-settings">
          <summary>Advanced credential binding</summary>
          <p className="settings-panel-copy">Optional: resolve the credential or integration connection ID from a Flow resource. Normal Flows should select the credential directly above and do not need a Get Credentials step.</p>
          <label className="form-label">Named Credential Resource<input className="form-control" value={displayValue(selected.config.namedCredentialResource)} onChange={(event) => {
            setConfig('namedCredentialResource', event.target.value);
            if (event.target.value) {
              setConfig('namedCredentialId', '');
              setConfig('integrationConnectionId', '');
              setConfig('integrationConnectionResource', '');
            }
          }} placeholder="{!CredentialSettings.NamedCredentialId__c}" /></label>
          <label className="form-label">Integration Connection Resource<input className="form-control" value={displayValue(selected.config.integrationConnectionResource)} onChange={(event) => {
            setConfig('integrationConnectionResource', event.target.value);
            if (event.target.value) {
              setConfig('integrationConnectionId', '');
              setConfig('namedCredentialId', '');
              setConfig('namedCredentialResource', '');
              setConfig('operation', '');
            }
          }} placeholder="{!CredentialSettings.IntegrationConnectionId__c}" /></label>
        </details>
      </>;

}
