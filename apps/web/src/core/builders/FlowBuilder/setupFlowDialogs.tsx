// @ts-nocheck
// Flow interview and debug dialogs load only when a flow screen is opened.
import { lazy, Suspense } from 'react';
// Only fetch the published Screen Flow renderer when an interview opens.
const FlowScreenContent = lazy(() => import('../../automation/FlowScreen/FlowScreenContent'));
import { screenFieldIsVisible } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import { X } from 'lucide-react';

export default function SetupFlowDialogs({ context }: { context: any }) {
 const { flowRun, setFlowRun, flowRunnerError, setFlowRunnerError, submitFlowScreen, goBackFlowScreen,
   flowRunnerSubmitting, flowDebug, setFlowDebug, runFlowDebug, libraryComponents, loadFlowScreenRecords,
   flows, pages, apps, objects, reports, LightningAppRuntime, pageDefinitionCache, formFactor,
   activeAppId, onNavigate, onLaunchFlow } = context;
 const flowMetadata=flows?.find(item=>item.apiName===flowRun?.flowApiName);
 const settings=flowMetadata?.flowType==='In-Screen Flow'?flowMetadata.startConfig??{}:{};
 const windowPage=pages?.find(page=>page.pageType==='In-Screen Page'
   &&page.apiName===settings.windowPageApiName&&page.status==='Active');
 const windowAppId=settings.targetAppApiName||activeAppId;
 const pageBindings=Array.isArray(settings.windowPageBindings)?settings.windowPageBindings:[];
 const exposedPageInputs=Object.fromEntries(pageBindings.filter((name:unknown)=>typeof name==='string')
   .map((name:string)=>[name,flowRun?.launchInputs?.[name]]).filter(([,value])=>value!==undefined));
 const sourceSessionBinding=Object.entries(settings.inputBindings??{}).find(([,source])=>source==='page.sessionKey')?.[0]??'sessionKey';
 const sourceSessionId=typeof flowRun?.launchInputs?.[sourceSessionBinding]==='string'
   ?String(flowRun.launchInputs[sourceSessionBinding]).slice(0,128):'';
 const mode=['modal','drawer','floating','fullscreen'].includes(settings.windowMode)?settings.windowMode:'modal';
 const position=settings.windowPlacement||'center';
 const width=Number.isInteger(settings.windowWidth)?Math.max(320,Math.min(1600,settings.windowWidth)):480;
 const height=Number.isInteger(settings.windowHeight)?Math.max(320,Math.min(1000,settings.windowHeight)):undefined;
 const isWindow=flowMetadata?.flowType==='In-Screen Flow';
 const horizontal=mode==='drawer'||position.endsWith('right')?'flex-end':
   position.endsWith('left')?'flex-start':'center';
 const vertical=position.startsWith('top')?'flex-start':position.startsWith('bottom')?'flex-end':'center';
 const backdropStyle=isWindow?{justifyContent:horizontal,alignItems:mode==='drawer'?'stretch':vertical}:undefined;
 const windowStyle=isWindow?{
   width:mode==='fullscreen'?'100vw':mode==='drawer'?'min(520px,100vw)':Math.min(width,1600)+'px',
   height:mode==='fullscreen'||mode==='drawer'?'100vh':height?height+'px':undefined,
   maxWidth:'100vw',maxHeight:'100vh',overflowY:'auto'
 }:undefined;
 return <>
      {flowRun && (
        <div className="modal-backdrop" role="presentation" style={backdropStyle}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="flow-screen-title" style={windowStyle}>
            <div className="modal-header"><h2 id="flow-screen-title">{flowRun.screen.label}</h2><button className="icon-button dark" type="button" onClick={() => { window.dispatchEvent(new CustomEvent('metadrive:flow-cancelled', { detail: { requestId:flowRun.requestId,flowApiName: flowRun.flowApiName } })); setFlowRun(null); }} aria-label="Close"><X size={18} /></button></div>
            {flowRunnerError && <div className="flow-screen-error" role="alert" aria-live="assertive">{flowRunnerError}</div>}
            {windowPage&&windowAppId&&LightningAppRuntime&&<div className="in-screen-page-host" style={{maxHeight:'65vh',overflow:'auto'}}>
              <LightningAppRuntime appId={windowAppId} pageApiName={windowPage.apiName} inScreenPage
                inScreenContext={{sessionId:sourceSessionId,values:exposedPageInputs}}
                objects={objects} apps={apps} pages={pages} reports={reports}
                libraryComponents={libraryComponents} availableFlows={flows.filter(item=>['Screen Flow','In-Screen Flow','Autolaunched Flow'].includes(item.flowType))}
                formFactor={formFactor} pageDefinitionCache={pageDefinitionCache}
                onNavigate={onNavigate} onLaunchFlow={onLaunchFlow} onStandaloneModeChange={()=>{}} />
            </div>}
            <form onSubmit={submitFlowScreen}>
            <div className={`flow-screen-grid${flowRun.screen.config.layout === 'Two Columns' ? ' flow-screen-grid-two' : ''}`}>
              <Suspense fallback={<div className="records-loading" role="status">Loading screen components…</div>}>
              <FlowScreenContent
                fields={(Array.isArray(flowRun.screen.config.fields) ? flowRun.screen.config.fields : []) as Array<Record<string, unknown>>}
                libraryComponents={libraryComponents}
                interviewId={flowRun.interviewId}
                values={{...flowRun.screenResources,...flowRun.values}}
                onValueChange={(name, value) => {
                  setFlowRunnerError('');
                  setFlowRun((current) => current ? { ...current, values: { ...current.values, [name]: value } } : current);
                }}
                loadRecords={loadFlowScreenRecords}
                onError={setFlowRunnerError}
                isFieldVisible={screenFieldIsVisible}
              />
              </Suspense>
            </div>
            <div className="modal-actions"><button className="btn" type="button" onClick={() => { window.dispatchEvent(new CustomEvent('metadrive:flow-cancelled', { detail: { requestId:flowRun.requestId,flowApiName: flowRun.flowApiName } })); setFlowRun(null); }}>Cancel</button>{flowRun.canGoBack && <button className="btn" type="button" onClick={() => void goBackFlowScreen()} disabled={flowRunnerSubmitting}>Previous</button>}{flowRun.outcomes.map((outcome) => <button className="btn btn-brand" type="submit" name="outcome" value={outcome.label} key={outcome.name} disabled={flowRunnerSubmitting}>{flowRunnerSubmitting ? 'Continuing…' : outcome.label}</button>)}</div>
          </form>
          </section>
        </div>
      )}
      {flowDebug && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="flow-debug-title">
            <div className="modal-header">
              <div>
                <h2 id="flow-debug-title">{flowDebug.mode === 'debug' ? 'Debug' : 'Run'} {flowDebug.flow.label}</h2>
                <p>{flowDebug.mode === 'debug'
                  ? 'Debug runs the saved version read-only. SQL writes, email, HTTP calls and child Flow execution are simulated.'
                  : 'Provide inputs for the saved version. Side effects occur as configured by the flow.'}</p>
              </div>
              <button className="btn btn-icon" type="button" aria-label="Close debug" onClick={() => setFlowDebug(null)}><X size={16} /></button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void runFlowDebug(); }}>
              <div className="modal-body">
                {flowDebug.mode === 'debug' && flowDebug.flow.flowType === 'Record-Triggered Flow' && <>
                  <div className="info-callout">Simulate a record-triggered Flow. This test uses the record values you provide; it never saves record changes or delivers messages. Use actual field API names in the JSON, and provide prior values when testing an update or deletion.</div>
                  <label className="form-label">Trigger Event
                    <select className="form-control" value={flowDebug.inputs.$Event ?? 'created'} onChange={(event) => setFlowDebug((current) => current ? { ...current, inputs: { ...current.inputs, $Event: event.target.value } } : current)}>
                      <option value="created">Created</option><option value="updated">Updated</option><option value="deleted">Deleted</option>
                    </select>
                  </label>
                  <label className="form-label">Current Record ({flowDebug.flow.triggerObject ?? 'object'}) — JSON
                    <textarea className="form-control" rows={7} value={flowDebug.inputs.$Record ?? '{}'} onChange={(event) => setFlowDebug((current) => current ? { ...current, inputs: { ...current.inputs, $Record: event.target.value } } : current)} />
                  </label>
                  {flowDebug.inputs.$Event !== 'created' && <label className="form-label">Prior Record — JSON
                    <textarea className="form-control" rows={6} value={flowDebug.inputs.$Prior ?? '{}'} onChange={(event) => setFlowDebug((current) => current ? { ...current, inputs: { ...current.inputs, $Prior: event.target.value } } : current)} />
                  </label>}
                  <label className="checkbox-row"><input type="checkbox" checked={flowDebug.inputs.$IsClone === 'true'} onChange={(event) => setFlowDebug((current) => current ? { ...current, inputs: { ...current.inputs, $IsClone: event.target.checked ? 'true' : 'false' } } : current)} />Simulate cloned record</label>
                </>}
                {flowDebug.flow.resources.filter((resource) => resource.availableForInput && flowDebug.flow.flowType !== 'Record-Triggered Flow').map((resource) => {
                  const normalizedType = resource.dataType.toLocaleLowerCase();
                  const isJsonInput = ['Record', 'Record Collection'].includes(resource.type) || normalizedType === 'json';
                  const updateValue = (value: string) => setFlowDebug((current) => current ? {
                    ...current, inputs: { ...current.inputs, [resource.name]: value }
                  } : current);
                  return (
                    <label className="form-label" key={resource.name}>
                      {resource.label} <span className="muted">({resource.dataType})</span>
                      {isJsonInput || normalizedType === 'multi-select picklist'
                        ? <textarea
                            className="form-control"
                            rows={4}
                            value={flowDebug.inputs[resource.name] ?? ''}
                            placeholder={normalizedType === 'multi-select picklist' ? '["Sales", "Service"]' : 'Enter JSON'}
                            onChange={(event) => updateValue(event.target.value)}
                          />
                        : normalizedType === 'boolean' || normalizedType === 'checkbox'
                          ? <select className="form-control" value={flowDebug.inputs[resource.name] ?? ''} onChange={(event) => updateValue(event.target.value)}>
                              <option value="">Use default</option><option value="true">True</option><option value="false">False</option>
                            </select>
                          : <input
                              className="form-control"
                              type={normalizedType.startsWith('number') || normalizedType.startsWith('currency') || normalizedType.startsWith('percent') ? 'number'
                                : normalizedType === 'date' ? 'date'
                                  : normalizedType === 'time' ? 'time'
                                    : normalizedType === 'date/time' || normalizedType === 'datetime' ? 'datetime-local'
                                      : normalizedType === 'email' ? 'email'
                                        : normalizedType === 'url' ? 'url'
                                          : normalizedType === 'phone' ? 'tel' : 'text'}
                              step={normalizedType.startsWith('number') || normalizedType.startsWith('currency') || normalizedType.startsWith('percent') ? 'any' : undefined}
                              value={flowDebug.inputs[resource.name] ?? ''}
                              onChange={(event) => updateValue(event.target.value)}
                            />}
                    </label>
                  );
                })}
                {flowDebug.error && <div className="records-message" role="alert">{flowDebug.error}</div>}
                {flowDebug.result && (
                  <div className="flow-debug-results" aria-live="polite">
                    <h3>Debug results</h3>
                    <p>{flowDebug.error
                      ? 'Execution failed; the trace shows the path reached before the error.'
                      : flowDebug.result.status === 'failed'
                        ? 'Debug stopped with an error: ' + String(flowDebug.result.reason ?? 'Unknown Flow error')
                      : flowDebug.result.status === 'skipped'
                        ? `Trigger skipped: ${String(flowDebug.result.reason ?? 'entry conditions did not match')}`
                        : flowDebug.result.status === 'waiting'
                          ? `Paused at ${flowDebug.result.kind === 'screen' ? 'a Screen' : 'an asynchronous stage'}.`
                          : 'Execution completed.'}</p>
                    {typeof flowDebug.result.screen === 'object' && flowDebug.result.screen !== null && (
                      <section>
                        <h4>Current screen</h4>
                        <p>{String((flowDebug.result.screen as Record<string, unknown>).label ?? 'Screen')}</p>
                        <pre>{JSON.stringify((flowDebug.result.screen as Record<string, unknown>).config ?? {}, null, 2)}</pre>
                      </section>
                    )}
                    {typeof flowDebug.result.waitUntil === 'string' && (
                      <p>Wait scheduled until {new Date(flowDebug.result.waitUntil).toLocaleString()}.</p>
                    )}
                    {flowDebug.result.sideEffectsSimulated === true && (
                      <p>External side effects were simulated; no email or HTTP request was sent.</p>
                    )}
                    {flowDebug.result.outputs !== undefined && (
                      <section><h4>Outputs</h4><pre>{JSON.stringify(flowDebug.result.outputs, null, 2)}</pre></section>
                    )}
                    {flowDebug.result.variables !== undefined && (
                      <section><h4>Variables</h4><pre>{JSON.stringify(flowDebug.result.variables, null, 2)}</pre></section>
                    )}
                    {Array.isArray(flowDebug.result.debugTrace) && (
                      <section>
                        <h4>Element trace</h4>
                        <ol>{flowDebug.result.debugTrace.map((entry, index) => (
                          <li key={index}>
                            <strong>Step {String(entry.step ?? index + 1)} · {String(entry.type)}</strong>
                            <span> · {String(entry.status)} · {String(entry.durationMs ?? 0)} ms</span>
                            {entry.details && <p>{String(entry.details)}</p>}
                            <details><summary>Resource snapshot (redacted and bounded)</summary>
                              <pre>{JSON.stringify(entry.variables ?? {}, null, 2)}</pre>
                            </details>
                          </li>
                        ))}</ol>
                      </section>
                    )}
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button className="btn" type="button" onClick={() => setFlowDebug(null)}>Close</button>
                <button className="btn btn-brand" type="submit" disabled={flowDebug.running}>
                  {flowDebug.running ? (flowDebug.mode === 'debug' ? 'Debugging…' : 'Running…')
                    : flowDebug.mode === 'debug' ? 'Run Debug' : 'Run Flow'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
 </>;
}
