import { Pencil, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FlowDefinitionMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';

type TriggerRow = {
  apiName: string; label: string; objectName: string; objectLabel: string;
  trigger: string; runWhen: string; triggerOrder: number | null;
  publishedVersion: number | null; draftVersion: number | null; hasPendingDraft: boolean;
  steps: number;
};

function activeDefinition(flow: FlowDefinitionMetadata): FlowDefinitionMetadata | null {
  if (flow.activeVersion === null) return null;
  if (flow.status === 'Active' && flow.versionNumber === flow.activeVersion) return flow;
  const published = flow.versions.find((version) => version.versionNumber === flow.activeVersion);
  if (!published) return null;
  return { ...flow, ...published, status: 'Active', versionNumber: flow.activeVersion,
    activeVersion: flow.activeVersion, versions: flow.versions };
}

export default function FlowTriggerExplorer({ flows, objects, loading, onEdit }: {
  flows: FlowDefinitionMetadata[];
  objects: ObjectMetadata[];
  loading: boolean;
  onEdit: (apiName: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [objectName, setObjectName] = useState('');
  const [status, setStatus] = useState<'all' | 'published' | 'draft'>('all');
  const [page, setPage] = useState(1);
  const availableObjects = useMemo(() => [...objects]
    .sort((left, right) => left.label.localeCompare(right.label)), [objects]);
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return flows.flatMap((flow): TriggerRow[] => {
      const published = activeDefinition(flow);
      const definition = published ?? flow;
      if (definition.flowType !== 'Record-Triggered Flow') return [];
      const object = objects.find((item) => item.apiName === definition.triggerObject);
      const row: TriggerRow = {
        apiName: flow.apiName, label: published?.label ?? flow.label,
        objectName: definition.triggerObject ?? '', objectLabel: object?.label ?? definition.triggerObject ?? 'Unassigned',
        trigger: String(definition.startConfig.trigger ?? 'created-or-updated'),
        runWhen: String(definition.startConfig.runWhen ?? 'after-save'),
        triggerOrder: typeof definition.startConfig.triggerOrder === 'number' && Number.isInteger(definition.startConfig.triggerOrder)
          ? definition.startConfig.triggerOrder : null,
        publishedVersion: flow.activeVersion,
        draftVersion: flow.status === 'Draft' ? flow.versionNumber : null,
        hasPendingDraft: flow.status === 'Draft' && flow.activeVersion !== null,
        steps: definition.elements.length
      };
      if (objectName && row.objectName !== objectName) return [];
      if (status === 'published' && row.publishedVersion === null) return [];
      if (status === 'draft' && row.draftVersion === null) return [];
      if (query && ![row.label, row.apiName, row.objectLabel, row.objectName, row.trigger, row.runWhen]
        .some((value) => value.toLocaleLowerCase().includes(query))) return [];
      return [row];
    }).sort((left, right) =>
      left.objectLabel.localeCompare(right.objectLabel)
      || (left.runWhen === 'before-save' ? 0 : 1) - (right.runWhen === 'before-save' ? 0 : 1)
      || (left.triggerOrder ?? Number.MAX_SAFE_INTEGER) - (right.triggerOrder ?? Number.MAX_SAFE_INTEGER)
      || left.apiName.localeCompare(right.apiName)
    );
  }, [flows, objects, objectName, status, search]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pageCount);
  const visible = rows.slice((currentPage - 1) * 50, currentPage * 50);
  return (
    <section className="surface scheduled-flows-surface">
      <div className="list-view-header">
        <div>
          <div className="list-view-label">RECORD AUTOMATION</div>
          <h2>Flow Trigger Explorer</h2>
          <span>{loading ? 'Loading Flow metadata…' : `${rows.length} trigger ${rows.length === 1 ? 'definition' : 'definitions'} · Executing order shown within each object and timing`}</span>
        </div>
      </div>
      <div className="flow-config-row flow-trigger-explorer-filters" style={{ padding: 12, flexWrap: 'wrap' }}>
        <label className="scheduled-flows-search">
          <Search size={14} />
          <input aria-label="Search record-triggered flows" placeholder="Search flows or trigger" value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </label>
        <label className="form-label">Object
          <select className="form-control" aria-label="Filter trigger object" value={objectName}
            onChange={(event) => { setObjectName(event.target.value); setPage(1); }}>
            <option value="">All objects</option>
            {availableObjects.map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}
          </select>
        </label>
        <label className="form-label">Version status
          <select className="form-control" aria-label="Filter trigger status" value={status}
            onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}>
            <option value="all">All definitions</option>
            <option value="published">Published only</option>
            <option value="draft">Draft available</option>
          </select>
        </label>
      </div>
      <p className="settings-panel-copy" style={{ padding: '0 12px' }}>
        Active versions execute even when a newer draft exists. The trigger object, timing and order shown here belong
        to the currently published version where one exists. To change the running version, edit and activate the Flow.
      </p>
      <div className="table-scroll" role="region" aria-label="Record-triggered Flow results" tabIndex={0}>
        <table className="slds-table scheduled-flows-table">
          <thead><tr>
            <th scope="col">Object</th><th scope="col">Flow</th><th scope="col">API Name</th><th scope="col">Event</th>
            <th scope="col">Execution</th><th scope="col">Order</th><th scope="col">Versions</th>
            <th scope="col">Elements</th><th scope="col" aria-label="Actions"></th>
          </tr></thead>
          <tbody>
            {visible.map((row) => <tr key={row.apiName}>
              <td>{row.objectLabel}</td>
              <td><strong>{row.label}</strong></td><td title={row.apiName}><code>{row.apiName}</code></td>
              <td>{row.trigger}</td>
              <td>{row.runWhen}</td>
              <td>{row.triggerOrder ?? 'Default'}</td>
              <td>{row.publishedVersion !== null
                ? `Published v${row.publishedVersion}${row.hasPendingDraft ? ` · Draft v${row.draftVersion}` : ''}`
                : 'Draft only — inactive'}</td>
              <td>{row.steps}</td>
              <td><button className="row-menu" type="button" title={`Edit ${row.label}`}
                aria-label={`Edit ${row.label}`} onClick={() => onEdit(row.apiName)}><Pencil size={14} /></button></td>
            </tr>)}
            {!loading && visible.length === 0 && <tr><td colSpan={9} className="scheduled-flows-empty">
              No matching record-triggered flows. Configure a Record-Triggered Flow in the Flow Builder.
            </td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flow-config-row" style={{ justifyContent: 'flex-end', padding: 12 }}>
        <span>{rows.length ? `${(currentPage - 1) * 50 + 1}–${Math.min(currentPage * 50, rows.length)} of ${rows.length}` : '0 results'}</span>
        <button className="btn" type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>First</button>
        <button className="btn" type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage} of {pageCount}</span>
        <button className="btn" type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
        <button className="btn" type="button" disabled={currentPage >= pageCount} onClick={() => setPage(pageCount)}>Last</button>
      </div>
    </section>
  );
}
