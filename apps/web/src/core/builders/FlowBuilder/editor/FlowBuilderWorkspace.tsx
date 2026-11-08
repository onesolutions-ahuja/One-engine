import { FlowPropertiesResizeHandle } from '../FlowPropertiesResizeHandle';
import { canBypassFlowElement } from '../flowGraphOperations.mjs';
import { ArrowLeft, Check, ChevronDown, CircleHelp, Plus, Redo2, Save, Undo2, X } from 'lucide-react';
import { type FlowDefinitionMetadata } from '../../../metadata/Definitions/metadata';

import { useFlowEditorState } from './useFlowEditorState';
import { useFlowGraphActions } from './canvas/useFlowGraphActions';
import { useFlowConfiguration } from './settings/useFlowConfiguration';
import { createFlowStartSettings } from './settings/createFlowStartSettings';
import { lazy, Suspense } from 'react';
import { useFlowCreateDialog } from './management/useFlowCreateDialog';
import type { FlowBuilderProps } from './FlowBuilderTypes';
import FlowLandingPage from './management/FlowLandingPage';
import FlowToolbox from './toolbox/FlowToolbox';
import FlowCanvas from './canvas/FlowCanvas';

const FlowElementSettings = lazy(() => import('./settings/FlowElementSettings'));

export default function FlowBuilder(props: FlowBuilderProps) {
  const editorState = useFlowEditorState(props);
  const graphActions = useFlowGraphActions(props, editorState);
  const configuration = useFlowConfiguration(editorState, props);
  const startSettings = createFlowStartSettings(props, configuration, editorState, graphActions);
  const createDialog = useFlowCreateDialog();
  const {
    landing, onOpenFlowList, flow, onFlowChange, isDirty, onUndo, canUndo, onRedo, canRedo,
    onValidate, onSave, onDebug, canRunFlows, onRun, onActivate, onNotify, onToolTab, selectedId,
    onRemove, onUpdateLabel, objects,
  } = props;
  const {
    phoneFlow, toolboxExpanded, setToolTab, setToolboxExpanded, phoneInspectorOpen, workareaRef,
    clampPropertiesWidth, propertiesWidth, setPropertiesWidth, setPhoneInspectorOpen, selected,
    flowElementMetadata, flowTypeOptions,
  } = editorState;
  const { updateFlowType, updateConnector, setConnectorKind, addConnector } = configuration;

  if (landing) return <FlowLandingPage editorState={editorState} createDialog={createDialog} props={props} />;
  return <div className={phoneFlow?'flow-builder flow-mobile-builder':'flow-builder'}>
    <div className="flow-topbar">
      <button type="button" className="icon-button subtle flow-back-to-list" aria-label="Back to flows" onClick={onOpenFlowList}><ArrowLeft size={17}/><span>Flows</span></button>
      <div className="flow-name"><input aria-label="Flow label" value={flow.label} onChange={(event) => onFlowChange({ ...flow, label: event.target.value })} /><span className="flow-type-pill">{flow.status} · v{flow.versionNumber}</span><span className={`flow-save-state ${isDirty ? 'dirty' : ''}`} role="status">{isDirty ? 'Unsaved changes' : 'Saved'}</span><ChevronDown size={13} /></div>
      <div className="flow-toolbar-actions">
        <button className="icon-button subtle" title="Undo" aria-label="Undo" onClick={onUndo} disabled={!canUndo}><Undo2 size={15} /></button>
        <button className="icon-button subtle" title="Redo" aria-label="Redo" onClick={onRedo} disabled={!canRedo}><Redo2 size={15} /></button>
        <button className="btn" onClick={onValidate}><Check size={14} />Check</button>
        <button className="btn" onClick={onSave}><Save size={14} />Save</button>
        {(['Autolaunched Flow', 'Screen Flow', 'In-Screen Flow', 'Flow Orchestration', 'Record-Triggered Flow'].includes(flow.flowType)) && <button className="btn" onClick={onDebug} disabled={!canRunFlows} title={!canRunFlows ? 'The Run Flows permission is required.' : 'Debug the most recently saved version with sample inputs.'}>Debug</button>}
        {(['Autolaunched Flow', 'Screen Flow', 'In-Screen Flow', 'Flow Orchestration'].includes(flow.flowType)) && <button className="btn" onClick={onRun} disabled={!canRunFlows} title={!canRunFlows ? 'The Run Flows permission is required.' : isDirty ? 'Runs the most recently saved version; unsaved changes are excluded.' : undefined}>Run</button>}
        <button className="btn btn-brand" onClick={onActivate}><Check size={14} />Activate</button>
        <button className="icon-button subtle" title="Flow Builder help" onClick={() => onNotify('Configure the Start node, build element paths, check, then save or activate.')}><CircleHelp size={16} /></button>
      </div>
    </div>
    <div className="flow-tablet-top-actions">
      <button type="button" className="btn" aria-controls="flow-element-toolbox"
        aria-expanded={toolboxExpanded}
        onClick={() => { setToolTab('Elements'); onToolTab('Elements'); setToolboxExpanded(value => !value); }}>
        {toolboxExpanded ? 'Close elements' : 'Add step'}
      </button>
    </div>
    {phoneFlow && <div className="flow-phone-top-actions">
      <p>Full editor works best on a tablet or larger. Tap a step to inspect its properties.</p>
      <button type="button" className="btn" onClick={onOpenFlowList}><ArrowLeft size={15} aria-hidden="true" /> Back to flows</button>
      <button type="button" className="btn" aria-expanded={toolboxExpanded} onClick={()=>setToolboxExpanded(current=>!current)}>
        {toolboxExpanded?'Close elements':'Add step'}
      </button>
    </div>}
<div className={`flow-workarea ${toolboxExpanded ? 'flow-toolbox-expanded' : 'flow-toolbox-collapsed'} ${phoneFlow&&phoneInspectorOpen&&flow.elements.some(element=>element.id===selectedId)?'flow-mobile-inspector-open':''}`}
      ref={workareaRef} style={{ gridTemplateColumns:phoneFlow?'minmax(0, 1fr)':`240px minmax(0, 1fr) 8px ${clampPropertiesWidth(propertiesWidth)}px` }}>
        <FlowToolbox editorState={editorState} props={props} graphActions={graphActions} configuration={configuration} />
        <FlowCanvas graphActions={graphActions} props={props} editorState={editorState} />
      <FlowPropertiesResizeHandle width={propertiesWidth} setWidth={setPropertiesWidth} clamp={clampPropertiesWidth} />
      <aside className="flow-settings">
        {phoneFlow && <div className="flow-mobile-inspector-header">
          <strong>Step properties</strong>
          <button type="button" className="btn" onClick={()=>setPhoneInspectorOpen(false)}>Done</button>
        </div>}
        <div className="settings-header"><h2>{selected?.type === 'Start' ? 'Configure Start' : 'Set Up'}</h2><button className="icon-button subtle" onClick={() => selected && canBypassFlowElement(flow,selected.id) && onRemove(selected.id)}
          aria-label="Delete element" disabled={!selected || !canBypassFlowElement(flow,selected.id)}><X size={16} /></button></div>
        <div className="settings-element-type"><span className="flow-step-icon">{flowElementMetadata.find((item) => item.type === selected?.type)?.icon ?? '◉'}</span><div><small>{selected?.type}</small><strong>{selected?.label}</strong></div></div>
        {selected?.type === 'Start' && <label className="form-label flow-editor-field">Flow Type<select className="form-control" value={flow.flowType} onChange={(event) => updateFlowType(event.target.value as FlowDefinitionMetadata['flowType'])}>{flowTypeOptions.map((option) => <option key={option.type}>{option.type}</option>)}</select></label>}
        <label className="form-label flow-editor-field">Label<input className="form-control" value={selected?.label ?? ''} onChange={(event) => selected && onUpdateLabel(selected.id, event.target.value)} /></label>
        <label className="form-label flow-editor-field">API Name<div className="form-display">{selected?.label.replace(/[^A-Za-z0-9]+/g, '_') ?? ''}</div></label>
        <div className="settings-divider" />
        <div className="settings-panel-copy"><h3>{selected?.type === 'Start' ? 'Configure Start' : `${selected?.type ?? 'Element'} Details`}</h3><p>{selected?.type === 'Start' ? 'Choose how this flow starts and set its trigger criteria.' : 'Configure the behavior and data for this flow element.'}</p></div>
        <div className="flow-element-config">{!selected || selected.type === 'Start' ? startSettings.renderStartSettings() : <Suspense fallback={<span role="status">Loading settings…</span>}>
          <FlowElementSettings props={props} editorState={editorState}
            configuration={configuration} graphActions={graphActions} />
        </Suspense>}</div>
        {selected && <div className="flow-branches"><h3>Connector Paths</h3>{flow.connectors.filter((connector) => connector.from === selected.id).map((connector) => <div key={connector.id}>
          <div className="flow-config-row">
            <input className="form-control" aria-label="Connector outcome label" value={connector.label} onChange={(event) => updateConnector(connector.id, { label: event.target.value })} placeholder="Outcome label" />
            <select className="form-control" aria-label="Connector target" value={connector.to} onChange={(event) => updateConnector(connector.id, { to: Number(event.target.value) })}>{flow.elements.filter((element) => element.id !== selected.id && element.type !== 'Start').map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}</select>
            <select className="form-control" aria-label="Connector type" value={connector.kind} onChange={(event) => setConnectorKind(connector.id, event.target.value as FlowDefinitionMetadata['connectors'][number]['kind'])}>
              <option value="normal">Normal</option>
              <option value="fault" disabled={selected.type === 'Start'}>Fault</option>
              <option value="scheduled" disabled={selected.type !== 'Start' || flow.flowType !== 'Record-Triggered Flow'}>Scheduled Path</option>
              <option value="async" disabled={selected.type !== 'Start' || flow.flowType !== 'Record-Triggered Flow' || flow.startConfig?.runWhen === 'before-save' || flow.startConfig.trigger === 'deleted'}>Asynchronous Path</option>
            </select>
            <button className="row-menu" aria-label="Remove connector" onClick={() => onFlowChange({ ...flow, connectors: flow.connectors.filter((item) => item.id !== connector.id) })}><X size={14} /></button>
          </div>
          {connector.kind === 'async' && <p className="settings-panel-copy">Runs independently after the record transaction commits. The scheduler persists this path, retries eligible failures, and shows it under Pending Work.</p>}
          {connector.kind === 'scheduled' && <div className="flow-config-row">
            <select className="form-control" aria-label="Scheduled path time source field" value={connector.scheduledPath?.timeSourceFieldApiName ?? ''} onChange={(event) => updateConnector(connector.id, { scheduledPath: { ...connector.scheduledPath!, timeSourceFieldApiName: event.target.value } })}>
              <option value="">Select Date/DateTime field</option>
              {objects.find((object) => object.apiName === flow.triggerObject)?.fields.filter((field) => ['Date', 'DateTime'].includes(field.dataType)).map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
            </select>
            <input className="form-control" type="number" min={-3650} max={3650} step={1} aria-label="Scheduled path offset" value={connector.scheduledPath?.offsetAmount ?? 0} onChange={(event) => updateConnector(connector.id, { scheduledPath: { ...connector.scheduledPath!, offsetAmount: Number(event.target.value) } })} />
            <select className="form-control" aria-label="Scheduled path offset unit" value={connector.scheduledPath?.offsetUnit ?? 'Hours'} onChange={(event) => updateConnector(connector.id, { scheduledPath: { ...connector.scheduledPath!, offsetUnit: event.target.value as 'Minutes' | 'Hours' | 'Days' } })}>
              <option>Minutes</option><option>Hours</option><option>Days</option>
            </select>
            <p className="settings-panel-copy">The path is durably queued with the record save and replaced on later matching record-trigger events. Negative offsets run before the source value; Date values use midnight UTC. Due paths run under the initiating user and recheck Flow, app entitlement and permissions.</p>
          </div>}
        </div>)}<button className="text-action" onClick={addConnector}><Plus size={13} />Add Connector</button></div>}
        <button className="btn btn-brand btn-full" onClick={onSave}>Save Flow</button>
      </aside>
    </div>
    <div className="flow-bottom-bar"><span>Flow Builder</span><span>{flow.status} · Version {flow.versionNumber}</span><button className="text-action" onClick={() => onNotify('Click a connector + to insert on a branch, or drag an element from the toolbox onto a path. Ctrl/Cmd+D duplicates, Delete removes safe nodes, Ctrl/Cmd+Z/Y undo/redo, Ctrl/Cmd+S saves.')}><CircleHelp size={12} />Keyboard shortcuts</button></div>
  </div>;
}
