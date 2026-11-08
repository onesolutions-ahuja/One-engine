import { rowsFrom, displayValue, type ConfigRow } from '../../flowEditorData';
import ParseJsonConfigEditor from '../../ParseJsonConfigEditor';
import FlowSubflowMappingEditor from '../../FlowSubflowMappingEditor';
import FlowReferenceInput from '../../../FlowReferenceInput/FlowReferenceInput';
import { Plus, X } from 'lucide-react';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { useFlowConfiguration } from './useFlowConfiguration';
import type { useFlowGraphActions } from '../canvas/useFlowGraphActions';
import type { FlowBuilderProps } from '../FlowBuilderTypes';
import { renderDecisionSettings } from './renderDecisionSettings';
import { renderAssignmentSettings } from './renderAssignmentSettings';
import { renderSlotSettings } from './renderSlotSettings';
import { renderRecordSettings } from './renderRecordSettings';
import { renderScreenSettings } from './renderScreenSettings';
import { renderActionSettings } from './renderActionSettings';
import { renderCalloutSettings } from './renderCalloutSettings';

export default function FlowElementSettings({ editorState, configuration, graphActions, props }: {
  editorState: ReturnType<typeof useFlowEditorState>;
  configuration: ReturnType<typeof useFlowConfiguration>;
  graphActions: ReturnType<typeof useFlowGraphActions>;
  props: FlowBuilderProps;
}) {
  const { selected, isElementAvailable, contextDefinitions } = editorState;
  const { setConfig, renderConditionLogic, renderConditions } = configuration;
  const { selectedObject } = graphActions;
  const { platformEvents, onFlowChange, flow, objects, approvalProcesses, users, flows } = props;

    if (!selected) return null;
    if (!isElementAvailable(selected.type)) return <div className="info-callout" role="status">
      This Flow element is not supported by the current runtime. Remove it or replace it with a supported element before activating the Flow.
    </div>;
    if (selected.type === 'End') return <div className="info-callout">
      <p>End completes this execution path and returns Flow resources marked <strong>Available for output</strong> in the Manager tab.</p>
      <p>For checkout, create and assign the status and request ID resources before End, mark both Available for output, and map their exact API names in the till component's checkout status and request output properties. Return the incoming request ID unchanged. Optional message and change resources can be mapped in the same way.</p>
      <p>A checkout status must be pending, complete, failed, or cancelled. The till stays unavailable until its output mappings and other required settings are configured.</p>
    </div>;
    if (selected.type === 'Roll Back Records') {
      return <div className="info-callout">
        Restores record changes made earlier in this Flow transaction. Execution continues, so later record changes can still be saved.
      </div>;
    }
    if (selected.type === 'Custom Error') return <>
      <label className="form-label">Error Message<textarea className="form-control" maxLength={1000}
        value={displayValue(selected.config.errorMessage)}
        onChange={(event) => setConfig('errorMessage', event.target.value)}
        placeholder="Explain why this record cannot be saved" /></label>
      <label className="form-label">Display Location<select className="form-control"
        value={displayValue(selected.config.errorLocation) || 'Page'}
        onChange={(event) => setConfig('errorLocation', event.target.value)}>
        <option value="Page">Page</option><option value="Field">Field</option>
      </select></label>
      {displayValue(selected.config.errorLocation) === 'Field' && <label className="form-label">
        Error Field<select className="form-control" value={displayValue(selected.config.fieldName)}
          onChange={(event) => setConfig('fieldName', event.target.value)}>
          <option value="">Select field</option>{selectedObject?.fields.map((field) =>
            <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
        </select></label>}
      <p className="settings-panel-copy">This element stops the Flow and rolls back the record save. Field-level errors are available for create and update triggers.</p>
    </>;
    if (selected.type === 'Publish Platform Event') {
      const platformEvent = platformEvents.find((event) => event.apiName === displayValue(selected.config.eventApiName));
      const fieldValues = rowsFrom(selected.config.fieldValues);
      return <>
        <label className="form-label">Platform Event<select className="form-control" value={displayValue(selected.config.eventApiName)} onChange={(event) => onFlowChange({
          ...flow,
          elements: flow.elements.map((element) => element.id === selected.id
            ? { ...element, config: { ...element.config, eventApiName: event.target.value, fieldValues: [] } }
            : element)
        })}><option value="">Select platform event</option>{platformEvents.map((event) => <option key={event.apiName} value={event.apiName}>{event.label} ({event.apiName})</option>)}</select></label>
        <p className="settings-panel-copy">Type a value, or @ record field · $ user/system · ! flow value.</p>
        <div className="flow-config-list">{fieldValues.map((fieldValue, index) => <div className="flow-config-row" key={`platform-event-field-${index}`}>
          <select className="form-control" aria-label="Platform event field" value={displayValue(fieldValue.field)} onChange={(event) => setConfig('fieldValues', fieldValues.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value } : item))}>
            <option value="">Select event field</option>{platformEvent?.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
          </select>
          <FlowReferenceInput ariaLabel="Platform event value" value={displayValue(fieldValue.value)}
            flow={flow} elementId={selected.id} objects={objects}
            onChange={value => setConfig('fieldValues', fieldValues.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item))} />
          <button className="row-menu" aria-label="Remove event field mapping" onClick={() => setConfig('fieldValues', fieldValues.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
        </div>)}
          {platformEvent && <button className="text-action" onClick={() => setConfig('fieldValues', [...fieldValues, { field: '', value: '' }])}><Plus size={13} />Add Field</button>}
        </div>
      </>;
    }
    if (selected.type === 'Decision') { return renderDecisionSettings(editorState, props, graphActions, configuration); }
    if (selected.type === 'Assignment') { return renderAssignmentSettings(props, editorState, configuration); }
    if (selected.type === 'Loop') return <>
      <label className="form-label">Collection Variable<select className="form-control" value={displayValue(selected.config.collection)} onChange={(event) => setConfig('collection', event.target.value)}><option value="">Select collection</option>{flow.resources.filter((resource) => resource.type === 'Record Collection').map((resource) => <option key={resource.name} value={resource.name}>{resource.label}</option>)}</select></label>
      <label className="form-label">Direction<select className="form-control" value={displayValue(selected.config.direction) || 'First to last'} onChange={(event) => setConfig('direction', event.target.value)}><option>First to last</option><option>Last to first</option></select></label>
      <label className="form-label">Loop Variable<input className="form-control" value={displayValue(selected.config.loopVariable)} onChange={(event) => setConfig('loopVariable', event.target.value)} /></label>
    </>;
    if (selected.type === 'Collection Filter') {
      const collections = flow.resources.filter((resource) => resource.type === 'Record Collection');
      const collection = collections.find((resource) => resource.name === selected.config.collection);
      const object = objects.find((item) => item.apiName === collection?.dataType);
      return <>
        <label className="form-label">Collection Variable<select className="form-control" value={displayValue(selected.config.collection)} onChange={(event) => setConfig('collection', event.target.value)}><option value="">Select a record collection</option>{collections.map((resource) => <option key={resource.name} value={resource.name}>{resource.label}</option>)}</select></label>
        {renderConditionLogic('Condition Requirements', selected.config.conditionLogic ?? 'All', rowsFrom(selected.config.conditions).length, (logic) => setConfig('conditionLogic', logic))}
        <label className="form-label">Filter Conditions</label>{renderConditions('conditions', object?.fields ?? [])}
        <label className="form-label">Filtered Collection<select className="form-control" value={displayValue(selected.config.outputCollection)} onChange={(event) => setConfig('outputCollection', event.target.value)}><option value="">Select an output collection</option>{collections.filter((resource) => resource.name !== collection?.name && resource.dataType === collection?.dataType).map((resource) => <option key={resource.name} value={resource.name}>{resource.label}</option>)}</select></label>
      </>;
    }
    if (selected.type === 'Collection Sort') {
      const collections = flow.resources.filter((resource) => resource.type === 'Record Collection');
      const collection = collections.find((resource) => resource.name === selected.config.collection);
      const object = objects.find((item) => item.apiName === collection?.dataType);
      return <>
        <label className="form-label">Collection Variable<select className="form-control" value={displayValue(selected.config.collection)} onChange={(event) => setConfig('collection', event.target.value)}><option value="">Select a record collection</option>{collections.map((resource) => <option key={resource.name} value={resource.name}>{resource.label}</option>)}</select></label>
        <label className="form-label">Sort By<select className="form-control" value={displayValue(selected.config.sortField)} onChange={(event) => setConfig('sortField', event.target.value)}><option value="">Select a field</option>{object?.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select></label>
        <label className="form-label">Sort Order<select className="form-control" value={displayValue(selected.config.sortOrder) || 'Ascending'} onChange={(event) => setConfig('sortOrder', event.target.value)}><option>Ascending</option><option>Descending</option></select></label>
        <label className="form-label">Sorted Collection<select className="form-control" value={displayValue(selected.config.outputCollection)} onChange={(event) => setConfig('outputCollection', event.target.value)}><option value="">Select an output collection</option>{collections.filter((resource) => resource.name !== collection?.name && resource.dataType === collection?.dataType).map((resource) => <option key={resource.name} value={resource.name}>{resource.label}</option>)}</select></label>
      </>;
    }
    if (selected.type === 'Transform') {
      const collections = flow.resources.filter((resource) => resource.type === 'Record Collection');
      const source = collections.find((resource) => resource.name === selected.config.collection);
      const output = collections.find((resource) => resource.name === selected.config.outputCollection);
      const sourceObject = objects.find((item) => item.apiName === source?.dataType);
      const targetObject = objects.find((item) => item.apiName === output?.dataType);
      const mappings = rowsFrom(selected.config.mappings);
      const updateMappings = (next: ConfigRow[]) => setConfig('mappings', next);
      return <>
        <label className="form-label">Source Collection<select className="form-control" value={displayValue(selected.config.collection)} onChange={(event) => setConfig('collection', event.target.value)}><option value="">Select a record collection</option>{collections.map((resource) => <option key={resource.name} value={resource.name}>{resource.label} · {resource.dataType}</option>)}</select></label>
        <label className="form-label">Output Collection<select className="form-control" value={displayValue(selected.config.outputCollection)} onChange={(event) => setConfig('outputCollection', event.target.value)}><option value="">Select an output collection</option>{collections.filter((resource) => resource.name !== source?.name).map((resource) => <option key={resource.name} value={resource.name}>{resource.label} · {resource.dataType}</option>)}</select></label>
        <h3>Field Mappings</h3>
        {mappings.map((mapping, index) => <div className="flow-config-row" key={`transform-mapping-${index}`}>
          <select className="form-control" aria-label={`Transform source field ${index + 1}`} value={displayValue(mapping.sourceField)} onChange={(event) => updateMappings(mappings.map((item, itemIndex) => itemIndex === index ? { ...item, sourceField: event.target.value } : item))}><option value="">Source field</option>{sourceObject?.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select>
          <select className="form-control" aria-label={`Transform target field ${index + 1}`} value={displayValue(mapping.targetField)} onChange={(event) => updateMappings(mappings.map((item, itemIndex) => itemIndex === index ? { ...item, targetField: event.target.value } : item))}><option value="">Target field</option>{targetObject?.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select>
          <button className="row-menu" aria-label="Remove transform mapping" onClick={() => updateMappings(mappings.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
        </div>)}
        <button className="text-action" onClick={() => updateMappings([...mappings, { sourceField: '', targetField: '' }])}><Plus size={13} />Add Field Mapping</button>
        <p className="settings-panel-copy">Transform creates mapped in-memory records in the output collection; it does not create or update database records.</p>
      </>;
    }
    if (selected.type === 'Get Available Slots') { return renderSlotSettings(editorState, props, configuration); }
    if (selected.type === 'Wait') return <>
      <label className="form-label">Wait Type<select className="form-control" value={displayValue(selected.config.waitType) || 'Duration'} onChange={(event) => setConfig('waitType', event.target.value)}><option>Duration</option><option>Specific Time</option></select></label>
      {displayValue(selected.config.waitType) === 'Specific Time'
        ? <><label className="form-label">Resume At<input className="form-control" type="datetime-local" value={displayValue(selected.config.dateTime)} onChange={(event) => setConfig('dateTime', event.target.value)} /></label>
          <label className="form-label">Time Zone<input className="form-control" value={displayValue(selected.config.timeZone) || 'UTC'} placeholder="America/Los_Angeles" onChange={(event) => setConfig('timeZone', event.target.value)} /></label>
          <p className="settings-panel-copy">This Wait uses the durable SQL worker, not a browser timer. Enter an IANA time zone; nonexistent daylight-saving times are rejected.</p></>
        : <><label className="form-label">Wait Amount<input className="form-control" type="number" min="1" value={displayValue(selected.config.amount) || '1'} onChange={(event) => setConfig('amount', Number(event.target.value))} /></label>
          <label className="form-label">Unit<select className="form-control" value={displayValue(selected.config.unit) || 'Hours'} onChange={(event) => setConfig('unit', event.target.value)}>{['Minutes', 'Hours', 'Days'].map((unit) => <option key={unit}>{unit}</option>)}</select></label></>}
    </>;
    if (['Get Records', 'Create Records', 'Update Records', 'Delete Records'].includes(selected.type)) { return renderRecordSettings(props, editorState, configuration); }
    if (selected.type === 'Screen') { return renderScreenSettings(editorState, props, configuration); }
    if (selected.type === 'Orchestration Stage') return <>
      <div className="info-callout">A durable human-approval stage. The Flow pauses until approvers respond, then continues along Approved or Rejected. Chain multiple stages to orchestrate a process.</div>
      <label className="form-label">Approval Process<select className="form-control" value={displayValue(selected.config.approvalProcessApiName)} onChange={(event) => {
        const process = approvalProcesses.find((item) => item.apiName === event.target.value);
        setConfig('approvalProcessApiName', event.target.value);
        if (process) setConfig('objectApiName', process.objectApiName);
      }}><option value="">Use direct approvers</option>{approvalProcesses.filter((item) => item.active).map((item) => <option key={item.apiName} value={item.apiName}>{item.label} · {item.objectApiName}</option>)}</select></label>
      <label className="form-label">Target Object<select className="form-control" value={displayValue(selected.config.objectApiName)} onChange={(event) => setConfig('objectApiName', event.target.value)}><option value="">Select object</option>{objects.filter((item) => item.apiName !== 'User').map((item) => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}</select></label>
      <label className="form-label">Record ID / Flow Reference<FlowReferenceInput ariaLabel="Record ID" value={displayValue(selected.config.recordId)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recordId',value)}/></label>
      {!displayValue(selected.config.approvalProcessApiName) && <label className="form-label">Approver Users<select className="form-control" multiple size={Math.min(6, Math.max(3, users.length))} value={displayValue(selected.config.approverIds).split(/[;,\r\n]+/).map((id) => id.trim()).filter(Boolean)} onChange={(event) => setConfig('approverIds', Array.from(event.currentTarget.selectedOptions, (option) => option.value).join(', '))}>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.username}</option>)}</select></label>}
      <label className="form-label">Approval Rule<select className="form-control" value={displayValue(selected.config.approvalMode) || 'ANY'} onChange={(event) => setConfig('approvalMode', event.target.value)}><option value="ANY">Any one approver</option><option value="ALL">All approvers must approve</option></select></label>
      <label className="form-label">Status Output Variable<select className="form-control" value={displayValue(selected.config.statusVariable)} onChange={(event) => setConfig('statusVariable', event.target.value)}><option value="">No output variable</option>{flow.resources.filter((resource) => resource.type === 'Variable' && resource.dataType === 'Text' && !resource.isCollection).map((resource) => <option key={resource.name} value={resource.name}>{resource.label} · {resource.name}</option>)}</select></label>
      <label className="form-label">Request Comments<FlowReferenceInput ariaLabel="Comments" multiline value={displayValue(selected.config.comments)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('comments',value)}/></label>
      <div className="settings-panel-copy">Create exactly two normal connectors labeled Approved and Rejected. Work items appear in the approvers' existing inbox, and Pending Work shows paused stages. Canceling the interview also cancels unfinished approval requests.</div>
    </>;
    if (selected.type === 'Action') { return renderActionSettings(editorState, configuration, props, graphActions); }
    if (selected.type === 'HTTP Callout') { return renderCalloutSettings(props, editorState, configuration, graphActions); }
    if (['Get Context','Set Context','Clear Context'].includes(selected.type)) return <>
      <label className="form-label">Business Context
       <select className="form-control" value={displayValue(selected.config.contextApiName)}
        onChange={event=>setConfig('contextApiName',event.target.value)}>
        <option value="">Choose a Context definition</option>
        {contextDefinitions.map(item=><option key={item.apiName} value={item.apiName}>
          {item.label} ({item.objectApiName})</option>)}
       </select>
      </label>
      {selected.type==='Get Context'&&<label className="form-label">Store current Record Id in
       <select className="form-control" value={displayValue(selected.config.outputVariable)}
        onChange={event=>setConfig('outputVariable',event.target.value)}>
        <option value="">Choose Text Variable</option>
        {flow.resources.filter(resource=>resource.type==='Variable'&&resource.dataType==='Text')
         .map(resource=><option key={resource.name} value={resource.name}>{resource.label}</option>)}
       </select>
      </label>}
      {selected.type==='Set Context'&&<label className="form-label">Record Id from
       <select className="form-control" value={displayValue(selected.config.recordId)}
        onChange={event=>setConfig('recordId',event.target.value)}>
        <option value="">Choose source</option>
        <option value="{!$Record.Id}">Triggering Record Id</option>
        {flow.resources.filter(resource=>resource.type==='Variable'&&resource.dataType==='Text')
         .map(resource=><option key={resource.name} value={'@'+resource.name}>{resource.label}</option>)}
       </select>
      </label>}
      <p className="settings-panel-copy">Context selections are stored for the signed-in user and tenant. Record permissions apply.</p>
    </>;
    if (selected.type === 'Parse JSON') return <ParseJsonConfigEditor
      config={selected.config} resources={flow.resources} onChange={setConfig} />;
    if (selected.type === 'Subflow') return <>
      <label className="form-label">Flow<select className="form-control" value={displayValue(selected.config.flowApiName)} onChange={(event) => setConfig('flowApiName', event.target.value)}><option value="">Select an active autolaunched flow</option>{flows.filter((candidate) => candidate.apiName !== flow.apiName && candidate.flowType === 'Autolaunched Flow' && candidate.status === 'Active').map((candidate) => <option key={candidate.apiName} value={candidate.apiName}>{candidate.label}</option>)}</select></label>
      <FlowSubflowMappingEditor
        selectedFlowApiName={displayValue(selected.config.flowApiName)}
        flows={flows} parentResources={flow.resources}
        inputValues={selected.config.inputValues} outputValues={selected.config.outputValues}
        onChange={(key, value) => setConfig(key, value)} />
    </>;
    return <label className="form-label">Configuration<textarea className="form-control" rows={4} value={JSON.stringify(selected.config, null, 2)} readOnly /></label>;
}
