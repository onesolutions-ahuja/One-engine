import { rowsFrom, displayValue } from '../../flowEditorData';

import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowConfiguration } from './useFlowConfiguration';
import type { useFlowEditorState } from '../useFlowEditorState';
import type { useFlowGraphActions } from '../canvas/useFlowGraphActions';

export function createFlowStartSettings(
  props: FlowBuilderProps,
  configuration: ReturnType<typeof useFlowConfiguration>,
  editorState: ReturnType<typeof useFlowEditorState>,
  graphActions: ReturnType<typeof useFlowGraphActions>,
) {
  const { flow, pages, apps, platformEvents, objects, flows } = props;
  const { setStartConfig, inScreenBindings, renderConditions, renderConditionLogic } = configuration;
  const { contextDefinitions } = editorState;
  const { selectedPlatformEvent, selectedObject } = graphActions;

  const renderStartSettings = () => (
    <>
      <label className="form-label">Execution Context<select className="form-control"
        value={displayValue(flow.startConfig.executionContext) || 'User'}
        onChange={(event) => setStartConfig('executionContext', event.target.value)}>
        <option value="User">User Context</option>
        <option value="System" disabled={['Screen Flow','In-Screen Flow'].includes(flow.flowType)
          || flow.flowType === 'Record-Triggered Flow' && flow.startConfig?.runWhen === 'before-save'}>
          System Context
        </option>
      </select></label>
      <p className="settings-panel-copy">System Context runs as the configured tenant automation user. It does not bypass Object, Field, Record, tenant, app, or Flow permissions. Activation requires explicit Flow system-context approval.</p>
      {flow.flowType==='In-Screen Flow' && <fieldset className="metadata-card">
        <legend>In-Screen Window</legend>
        <p className="settings-panel-copy">Reuse the Screen elements and Page Builder components. No app-specific logic is required.</p>
        <label className="form-label">Window page
          <select className="form-control" value={displayValue(flow.startConfig.windowPageApiName)}
            onChange={event=>setStartConfig('windowPageApiName',event.target.value)}>
            <option value="">Use Flow Screen fields</option>
            {pages.filter(page=>page.pageType==='In-Screen Page').map(page=>
              <option key={page.apiName} value={page.apiName}>{page.label}</option>)}
          </select>
        </label>
        <label className="form-label">Launch trigger
          <select className="form-control" value={displayValue(flow.startConfig.launchTrigger)||'manual'}
            onChange={event=>setStartConfig('launchTrigger',event.target.value)}>
            <option value="manual">Manual action / another Flow</option>
            <option value="page-load">When target page opens</option>
            <option value="component-event">When a component raises an event</option>
            <option value="page-updated">When page data is changed by a Flow</option>
            <option value="platform-event">When a subscribed Platform Event arrives</option>
          </select>
        </label>
        <label className="form-label">Target application
          <select className="form-control" value={displayValue(flow.startConfig.targetAppApiName)}
            onChange={event=>setStartConfig('targetAppApiName',event.target.value)}>
            <option value="">Any permitted app (manual only)</option>
            {apps.map(app=><option key={app.apiName} value={app.apiName}>{app.label}</option>)}
          </select>
        </label>
        <label className="form-label">Target page
          <select className="form-control" value={displayValue(flow.startConfig.targetPageApiName)}
            onChange={event=>setStartConfig('targetPageApiName',event.target.value)}>
            <option value="">Any page within selected app</option>
            {pages.filter(page=>page.pageType!=='In-Screen Page').map(page=>
              <option key={page.apiName} value={page.apiName}>{page.label}</option>)}
          </select>
        </label>
        {flow.startConfig.launchTrigger==='platform-event' && <label className="form-label">
          Platform Event
          <select className="form-control" value={displayValue(flow.startConfig.platformEventApiName)}
            onChange={event=>setStartConfig('platformEventApiName',event.target.value)}>
            <option value="">Choose a published Platform Event</option>
            {platformEvents.map(event=><option key={event.apiName} value={event.apiName}>{event.label}</option>)}
          </select>
        </label>}
        {flow.startConfig.launchTrigger==='platform-event' && <>
          <label className="form-label">Deliver to
            <select className="form-control" value={displayValue(flow.startConfig.matchEventTo)}
             onChange={event=>setStartConfig('matchEventTo',event.target.value)}>
              <option value="">All permitted subscribers</option>
              <option value="page-session">Current page session</option>
              <option value="record">Current page record</option>
              <option value="user">Current signed-in user</option>
              <option value="context">Selected business Context record</option>
            </select>
          </label>
          {flow.startConfig.matchEventTo==='context'&&<label className="form-label">Business Context
             <select className="form-control" value={displayValue(flow.startConfig.matchContextApiName)}
              onChange={event=>setStartConfig('matchContextApiName',event.target.value)}>
              <option value="">Choose Context</option>
              {contextDefinitions.map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
             </select>
            </label>}
          {Boolean(flow.startConfig.matchEventTo)&&<label className="form-label">Match event field
            <select className="form-control" value={displayValue(flow.startConfig.matchEventField)}
              onChange={event=>setStartConfig('matchEventField',event.target.value)}>
              <option value="">Select an event field</option>
              {platformEvents.find(item=>item.apiName===flow.startConfig.platformEventApiName)?.fields?.map(field=>
                <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
            </select>
          </label>}
        </>}
        {flow.startConfig.launchTrigger==='component-event' && <label className="form-label">
          Component event<input className="form-control" value={displayValue(flow.startConfig.launchEventName)}
            onChange={event=>setStartConfig('launchEventName',event.target.value)}
            placeholder="click, change or published component event" />
        </label>}
        <label className="form-label">Window type
          <select className="form-control" value={displayValue(flow.startConfig.windowMode)||'modal'}
            onChange={event=>setStartConfig('windowMode',event.target.value)}>
            <option value="modal">Modal</option><option value="drawer">Side drawer</option>
            <option value="floating">Floating window</option><option value="fullscreen">Full screen</option>
          </select>
        </label>
        <label className="form-label">Position
          <select className="form-control" value={displayValue(flow.startConfig.windowPlacement)||'center'}
            onChange={event=>setStartConfig('windowPlacement',event.target.value)}>
            {['center','top-left','top-right','bottom-left','bottom-right'].map(x=>
              <option key={x} value={x}>{x.replace('-', ' ')}</option>)}
          </select>
        </label>
        <label className="form-label">Width (px)
          <input className="form-control" type="number" min={320} max={1600}
            value={displayValue(flow.startConfig.windowWidth)||480}
            onChange={event=>setStartConfig('windowWidth',Number(event.target.value))} />
        </label>
        <label className="form-label">Height (px; blank = automatic)
          <input className="form-control" type="number" min={320} max={1000}
            value={displayValue(flow.startConfig.windowHeight)}
            onChange={event=>setStartConfig('windowHeight',event.target.value?Number(event.target.value):undefined)} />
        </label>
        <label className="checkbox-row"><input type="checkbox"
          checked={flow.startConfig.oncePerSession===true}
          onChange={event=>setStartConfig('oncePerSession',event.target.checked)} />
          Show only once per page session</label>
        <label className="form-label">Cooldown (seconds)
          <input className="form-control" type="number" min={0} max={3600}
            value={displayValue(flow.startConfig.cooldownSeconds)||0}
            onChange={event=>setStartConfig('cooldownSeconds',Number(event.target.value))}/>
        </label>
        <fieldset className="metadata-card"><legend>Flow input bindings</legend>
          <p className="settings-panel-copy">Map declared Flow inputs to the triggering context. Resolve business records and related fields with authorised Get Records elements.</p>
          {flow.resources.filter(resource=>resource.availableForInput).map(resource=>
            <label className="form-label" key={resource.name}>{resource.label||resource.name}
              <select className="form-control" value={inScreenBindings[resource.name]??'auto'}
                onChange={event=>setStartConfig('inputBindings',{
                  ...inScreenBindings,[resource.name]:event.target.value
                })}>
                <option value="auto">Automatically match input name</option>
                <option value="page.sessionKey">Current page session key</option>
                <option value="page.apiName">Current page</option>
                <option value="app.apiName">Current application</option>
                <option value="event.recordId">Triggered record ID</option>
                <option value="event.componentId">Triggering component</option>
                <option value="event.name">Triggering event name</option>
                <option value="event.value">Triggering event value</option>
                {contextDefinitions.map(item=><option key={item.apiName} value={'context.'+item.apiName+'.recordId'}>Current {item.label} Record Id</option>)}
              </select>
            </label>)}
        </fieldset>
        <fieldset className="metadata-card"><legend>Expose input values to the Window Page</legend>
          <p className="settings-panel-copy">Selected inputs are available as Page Builder state bindings. Do not expose passwords, credentials or confidential values.</p>
          {flow.resources.filter(resource=>resource.availableForInput).map(resource=>
            <label className="checkbox-row" key={resource.name}>
              <input type="checkbox"
                checked={Array.isArray(flow.startConfig.windowPageBindings)
                  &&flow.startConfig.windowPageBindings.includes(resource.name)}
                onChange={event=>{
                  const current=Array.isArray(flow.startConfig.windowPageBindings)
                    ?flow.startConfig.windowPageBindings.filter((name):name is string=>typeof name==='string'):[];
                  setStartConfig('windowPageBindings',event.target.checked
                    ?[...new Set([...current,resource.name])]
                    :current.filter(name=>name!==resource.name));
                }}/>
              {resource.label||resource.name} → Page State
            </label>)}
        </fieldset>
      </fieldset>}
      {flow.flowType === 'Platform Event-Triggered Flow' && <>
        <label className="form-label">Platform Event<select className="form-control" value={flow.triggerObject ?? ''} onChange={(event) => setStartConfig('object', event.target.value)}><option value="">Select platform event</option>{platformEvents.map((platformEvent) => <option key={platformEvent.apiName} value={platformEvent.apiName}>{platformEvent.label} ({platformEvent.apiName})</option>)}</select></label>
        <label className="form-label">Entry Conditions</label>
        {renderConditions('entryConditions', selectedPlatformEvent?.fields ?? [])}
        {renderConditionLogic('Condition Requirements', flow.startConfig.conditionLogic, rowsFrom(flow.startConfig.entryConditions).length, (logic) => setStartConfig('conditionLogic', logic))}
      </>}
      {(flow.flowType === 'Record-Triggered Flow' || flow.flowType === 'Schedule-Triggered Flow') && <>
        <label className="form-label">Object<select className="form-control" value={flow.triggerObject ?? ''} onChange={(event) => setStartConfig('object', event.target.value)}><option value="">Select object</option>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label>
        {flow.flowType === 'Record-Triggered Flow' && <>
          <label className="form-label">Trigger<select className="form-control" value={displayValue(flow.startConfig.trigger) || 'created-or-updated'} onChange={(event) => setStartConfig('trigger', event.target.value)}><option value="created">A record is created</option><option value="updated">A record is updated</option><option value="created-or-updated">A record is created or updated</option><option value="deleted">A record is deleted</option></select></label>
          <label className="form-label">Optimize the Flow For<select className="form-control" value={displayValue(flow.startConfig?.runWhen) || 'after-save'} onChange={(event) => { setStartConfig('runWhen', event.target.value); if (event.target.value === 'before-save' && flow.startConfig.executionContext === 'System') setStartConfig('executionContext', 'User'); }}><option value="before-save">Fast Field Updates (before-save)</option><option value="after-save">Actions and Related Records (after-save)</option></select></label>
          <div className="info-callout">{flow.startConfig?.runWhen === 'before-save' ? 'Before-save flows can query records, loop and transform collections, and update $Record fields. Write actions, HTTP calls and waits remain blocked.' : 'After-save flows run in the same transaction as API record creates, updates, and deletes. CRUD performed inside a Flow does not recursively dispatch record triggers; up to 50 matching Flows run for one record operation.'}</div>
          <label className="form-label">Trigger Order<input className="form-control" type="number" min={1} max={2000} step={1} value={displayValue(flow.startConfig.triggerOrder)} onChange={(event) => setStartConfig('triggerOrder', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
          <p className="settings-panel-copy">Optional order from 1 to 2000. Lower numbers normally run first. Selected dependencies run before this Flow even if they have higher numbers.</p>
          <fieldset className="metadata-card">
            <legend>Run after other Flows</legend>
            <p className="settings-panel-copy">Select active record Flows on this Object and save phase.
             The selected Flows are not forced to run when their trigger or conditions do not match.
             Circular dependencies stop the record transaction.</p>
            {flows.filter(candidate=>candidate.apiName!==flow.apiName
              &&candidate.flowType==='Record-Triggered Flow'
              &&candidate.status==='Active'
              &&candidate.triggerObject===flow.triggerObject
              &&(candidate.startConfig.runWhen??'after-save')===(flow.startConfig.runWhen??'after-save'))
             .map(candidate=>{
              const selected=Array.isArray(flow.startConfig.runAfterFlows)
               &&flow.startConfig.runAfterFlows.includes(candidate.apiName);
              return <label className="checkbox-row" key={candidate.apiName}>
               <input type="checkbox" checked={selected}
                disabled={!selected&&Array.isArray(flow.startConfig.runAfterFlows)
                 &&flow.startConfig.runAfterFlows.length>=20}
                onChange={event=>setStartConfig('runAfterFlows',event.target.checked
                 ?[...(Array.isArray(flow.startConfig.runAfterFlows)?flow.startConfig.runAfterFlows:[]),
                   candidate.apiName]
                 :(Array.isArray(flow.startConfig.runAfterFlows)?flow.startConfig.runAfterFlows:[])
                   .filter(item=>item!==candidate.apiName))}/>
               {candidate.label}
              </label>;
             })}
            {Array.isArray(flow.startConfig.runAfterFlows)
              &&flow.startConfig.runAfterFlows.some(name=>!flows.some(item=>item.apiName===name
               &&item.status==='Active'&&item.triggerObject===flow.triggerObject
               &&(item.startConfig.runWhen??'after-save')===(flow.startConfig.runWhen??'after-save')))
              &&<p role="alert">A selected dependency is unavailable or runs in another phase. Review and remove it before activation.</p>}
          </fieldset>
          <label className="form-label">Entry Conditions</label>
          {renderConditions('entryConditions', selectedObject?.fields ?? [])}
          {renderConditionLogic('Condition Requirements', flow.startConfig.conditionLogic, rowsFrom(flow.startConfig.entryConditions).length, (logic) => setStartConfig('conditionLogic', logic))}
          <label className="form-label">When to Run for Updated Records<select className="form-control" value={displayValue(flow.startConfig.updatedRecordBehavior) || 'every-time'} onChange={(event) => setStartConfig('updatedRecordBehavior', event.target.value)}><option value="every-time">Every time a record is updated and meets conditions</option><option value="transition">Only when a record is updated to meet conditions</option></select></label>
        </>}
        {flow.flowType === 'Schedule-Triggered Flow' && <>
          <label className="form-label">Start Date<input className="form-control" type="date" value={displayValue(flow.startConfig.startDate)} onChange={(event) => setStartConfig('startDate', event.target.value)} /></label>
          <label className="form-label">Start Time<input className="form-control" type="time" value={displayValue(flow.startConfig.startTime)} onChange={(event) => setStartConfig('startTime', event.target.value)} /></label>
          <label className="form-label">Time Zone<input className="form-control" value={displayValue(flow.startConfig.timeZone) || 'UTC'} placeholder="America/Los_Angeles" onChange={(event) => setStartConfig('timeZone', event.target.value)} /></label>
          <p className="settings-panel-copy">Enter an IANA time zone, such as America/Los_Angeles. Recurring runs follow local wall time across daylight-saving changes.</p>
          <label className="form-label">Frequency<select className="form-control" value={displayValue(flow.startConfig.frequency)} onChange={(event) => setStartConfig('frequency', event.target.value)}><option value="">Select frequency</option><option value="Once">Once</option><option value="Daily">Daily</option><option value="Weekly">Weekly</option><option value="Monthly">Monthly</option></select></label>
          <label className="form-label">Entry Conditions</label>{renderConditions('entryConditions', selectedObject?.fields ?? [])}
          {renderConditionLogic('Condition Requirements', flow.startConfig.conditionLogic, rowsFrom(flow.startConfig.entryConditions).length, (logic) => setStartConfig('conditionLogic', logic))}
        </>}
      </>}
      {(['Screen Flow', 'In-Screen Flow', 'Autolaunched Flow', 'Flow Orchestration'].includes(flow.flowType)) && <p className="info-callout">{['Screen Flow','In-Screen Flow'].includes(flow.flowType) ? 'This flow starts when launched by a user or supported Lightning entry point.' : flow.flowType === 'Flow Orchestration' ? 'Launch this orchestration to coordinate approval stages and persist human work items.' : 'This flow runs without screens when invoked by another automation or API.'}</p>}
    </>
  );

  return {
    renderStartSettings,
  };
}
