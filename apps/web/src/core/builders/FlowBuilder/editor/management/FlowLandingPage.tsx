import ResponsiveDataList from '../../../../records/ResponsiveDataList/ResponsiveDataList';
import { Plus, Pencil } from 'lucide-react';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { useFlowCreateDialog } from './useFlowCreateDialog';
import type { FlowBuilderProps } from '../FlowBuilderTypes';

export default function FlowLandingPage({ editorState, createDialog, props }: {
  editorState: ReturnType<typeof useFlowEditorState>;
  createDialog: ReturnType<typeof useFlowCreateDialog>;
  props: FlowBuilderProps;
}) {
  const {
    capabilityError, flowTypeOptions, newFlowType, setNewFlowType, newFlowLabel, setNewFlowLabel,
    existingFlowTypeTab, setExistingFlowTypeTab, setExistingFlowPage, setRemoteFlowResults,
    existingFlowSearch, setExistingFlowSearch, remoteFlowLoading, totalFlowCount, displayedFlows,
    safeFlowPage, flowPageCount,
  } = editorState;
  const { setShowCreateFlow, showCreateFlow, createFlowDialog } = createDialog;
  const { onCreateFlow, onSelectFlow } = props;
  return <div className="flow-start-page flow-start-page-split">
    <div className="flow-start-heading">
      <div className="eyebrow">AUTOMATION</div>
      <h1>Flows</h1>
      {capabilityError && <div className="info-callout" role="alert">{capabilityError}</div>}
      <p>Create a flow or find an existing automation.</p><button type="button" className="btn btn-brand" onClick={() => setShowCreateFlow(true)}><Plus size={14} />New Flow</button>
    </div>
    <div className="flow-start-panels">
    {showCreateFlow && <div className="modal-backdrop"><section ref={createFlowDialog} tabIndex={-1} className="modal flow-create-dialog" role="dialog" aria-modal="true" aria-labelledby="flow-start-types" onKeyDown={event => { if (event.key === 'Escape') setShowCreateFlow(false); }}>
      <header className="flow-start-modal-header"><h2 id="flow-start-types">Create a flow</h2>
       <button type="button" className="btn" autoFocus onClick={() => setShowCreateFlow(false)}>Cancel</button></header>
      <div className="flow-start-types">
        {flowTypeOptions.map((option) => <button type="button" key={option.type}
          className={newFlowType === option.type ? 'flow-start-type selected' : 'flow-start-type'}
          aria-pressed={newFlowType === option.type}
          onClick={() => setNewFlowType(option.type)}>
          <strong>{option.type}</strong>
          <span>{option.description}</span>
        </button>)}
      </div>
      {newFlowType && <div className="flow-start-name-step">
      <label className="form-label" htmlFor="flow-start-label">Flow Name</label>
      <input id="flow-start-label" className="form-control" value={newFlowLabel}
        onChange={(event) => setNewFlowLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && newFlowLabel.trim() && newFlowType) {
            onCreateFlow(newFlowLabel.trim(), newFlowType);
            setNewFlowLabel(''); setShowCreateFlow(false);
          }
        }}
        placeholder="For example, Send Appointment Reminder" />
      <button className="btn btn-brand" type="button" disabled={!newFlowLabel.trim()}
        onClick={() => {
          onCreateFlow(newFlowLabel.trim(), newFlowType);
          setNewFlowLabel(''); setShowCreateFlow(false);
        }}><Plus size={14} />Create Flow</button>
      </div>}
    </section></div>}
    <section className="flow-start-existing surface" aria-labelledby="flow-start-existing-title">
      <h2 id="flow-start-existing-title">Existing flows</h2>
      <nav className="flow-existing-type-tabs" aria-label="Flows by type" style={{display:'flex',gap:6,flexWrap:'wrap',padding:'10px 0'}}>
        {[{type:'all',label:'All Flows'},...flowTypeOptions.map(option=>({type:option.type,label:option.type})),
          ...(['Screen Flow','In-Screen Flow','Autolaunched Flow','Record-Triggered Flow','Schedule-Triggered Flow','Platform Event-Triggered Flow','Flow Orchestration'] as const)
            .filter(type=>!flowTypeOptions.some(option=>option.type===type)).map(type=>({type,label:type}))].map(option=>
          <button type="button" className={'btn btn-small'+(existingFlowTypeTab===option.type?' btn-brand':'')}
            key={option.type} aria-pressed={existingFlowTypeTab===option.type}
            onClick={()=>{setExistingFlowTypeTab(option.type);setExistingFlowPage(1);setRemoteFlowResults(null);}}>{option.label}</button>)}
      </nav>
      <label className="form-label flow-existing-type-select">Flow type
       <select className="form-control" aria-label="Filter flows by type" value={existingFlowTypeTab}
        onChange={e=>{setExistingFlowTypeTab(e.target.value);setExistingFlowPage(1);setRemoteFlowResults(null);}}>
        {[{type:'all',label:'All Flows'},...flowTypeOptions.map(option=>({type:option.type,label:option.type})),
          ...(['Screen Flow','In-Screen Flow','Autolaunched Flow','Record-Triggered Flow','Schedule-Triggered Flow','Platform Event-Triggered Flow','Flow Orchestration'] as const)
           .filter(type=>!flowTypeOptions.some(option=>option.type===type)).map(type=>({type,label:type}))].map(item=><option key={item.type} value={item.type}>{item.label}</option>)}
       </select>
      </label>
      <div className="flow-existing-controls">
        <label className="form-label" htmlFor="existing-flow-search">Search Flows
          <input id="existing-flow-search" className="form-control" type="search" placeholder="Search by flow name, type or status"
            value={existingFlowSearch} onChange={(event) => { setExistingFlowSearch(event.target.value); setExistingFlowPage(1); setRemoteFlowResults(null); }} />
        </label>
      </div>
      {remoteFlowLoading && <p role="status" className="settings-panel-copy">Loading flows…</p>}
      {totalFlowCount ? <>
        <ResponsiveDataList rows={displayedFlows} includeTablet getId={item=>item.apiName}
         label="Existing Flows" onOpen={item=>onSelectFlow(item.apiName)} openLabel="Edit Flow"
         columns={[
          {apiName:'label',label:'Flow',phoneRole:'title',render:item=>item.label},
          {apiName:'flowType',label:'Type',phoneRole:'subtitle',render:item=>item.flowType},
          {apiName:'status',label:'Status',phoneRole:'badge',render:item=>item.status},
          {apiName:'version',label:'Version',phoneRole:'trailing',render:item=>'v'+item.versionNumber},
          {apiName:'apiName',label:'API Name',render:item=>item.apiName},
          {apiName:'modified',label:'Modified',render:item=>item.lastModifiedAt?new Date(item.lastModifiedAt).toLocaleString():'—'}
         ]}/>
        <div className="flow-existing-table-scroll md-mobile-table-replaced md-tablet-table-replaced">
        <table className="flow-existing-table">
          <thead><tr><th aria-label="Edit flow">Edit</th><th>Flow Name</th><th>Flow Type</th><th>Status</th><th>Version</th><th>Details</th></tr></thead>
          <tbody>{displayedFlows.map((candidate) =>
            <tr key={candidate.apiName}>
              <td><button type="button" className="icon-button subtle" aria-label={`Edit ${candidate.label}`} title={`Edit ${candidate.label}`} onClick={() => onSelectFlow(candidate.apiName)}><Pencil size={16} /></button></td>
              <td><button type="button" className="text-action" onClick={() => onSelectFlow(candidate.apiName)}>{candidate.label}</button></td>
              <td>{candidate.flowType}</td><td>{candidate.status}</td><td>v{candidate.versionNumber}</td>
              <td><details><summary>View details</summary><dl><dt>Created by</dt><dd>{candidate.createdBy || '—'}</dd><dt>Created</dt><dd>{candidate.createdAt ? new Date(candidate.createdAt).toLocaleString() : '—'}</dd><dt>Modified by</dt><dd>{candidate.lastModifiedBy || '—'}</dd><dt>Modified</dt><dd>{candidate.lastModifiedAt ? new Date(candidate.lastModifiedAt).toLocaleString() : '—'}</dd></dl></details></td>
            </tr>)}</tbody>
        </table>
      </div></> : <p className="settings-panel-copy">No matching flows found.</p>}
      <nav aria-label="Flow list pagination" className="flow-existing-pagination">
        <span>{totalFlowCount} flow{totalFlowCount === 1 ? '' : 's'} · Page {safeFlowPage} of {flowPageCount}</span>
        <button className="btn" disabled={safeFlowPage === 1} onClick={() => setExistingFlowPage(1)}>First</button>
        <button className="btn" disabled={safeFlowPage === 1} onClick={() => setExistingFlowPage(safeFlowPage - 1)}>Previous</button>
        {Array.from({ length: Math.min(5, flowPageCount) }, (_, index) => {
          const firstPage = Math.max(1, Math.min(flowPageCount - 4, safeFlowPage - 2));
          const pageNumber = firstPage + index;
          return <button key={pageNumber} type="button" aria-label={`Page ${pageNumber}`}
            aria-current={safeFlowPage === pageNumber ? 'page' : undefined}
            className={safeFlowPage === pageNumber ? 'btn active' : 'btn'}
            onClick={() => { setExistingFlowPage(pageNumber); setRemoteFlowResults(null); }}>{pageNumber}</button>;
        })}
        <button className="btn" disabled={safeFlowPage === flowPageCount} onClick={() => setExistingFlowPage(safeFlowPage + 1)}>Next</button>
        <button className="btn" disabled={safeFlowPage === flowPageCount} onClick={() => setExistingFlowPage(flowPageCount)}>Last</button>
      </nav>
    </section>
    </div>
  </div>;
}
