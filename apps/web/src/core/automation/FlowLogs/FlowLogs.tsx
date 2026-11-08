import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FlowExecutionLogMetadata } from '../../metadata/Definitions/metadata';

type FlowLogsProps = {
  logs: FlowExecutionLogMetadata[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onOpenFlow: (apiName: string) => void;
};

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function FlowLogs({ logs, loading, loadingMore, hasMore, onLoadMore, onOpenFlow }: FlowLogsProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page,setPage]=useState(0);
  const pageSize=25;
  useEffect(()=>setPage(0),[search,status]);
  const filteredLogs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return logs.filter(log => {
      const actualStatus = log.status ?? 'unknown';
      return (status === 'all' || status === actualStatus) &&
        (!query || (log.flowLabel + ' ' + log.flowApiName + ' ' + actualStatus + ' ' + (log.error ?? ''))
          .toLocaleLowerCase().includes(query));
    });
  }, [logs, search, status]);

  const pageCount=Math.max(1,Math.ceil(filteredLogs.length/pageSize));
  const currentPage=Math.min(page,pageCount-1);
  const visibleLogs=filteredLogs.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  return (
    <div className="flow-logs-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SETUP / AUTOMATION</div>
          <h1>Flow Execution History</h1>
          <p>Review completed, failed, waiting, pending and cancelled SQL Flow runs. Read-only telemetry; debug traces are not persisted.</p>
        </div>
      </div>
      <section className="surface flow-logs-surface">
        <div className="list-view-header">
          <div>
            <div className="list-view-label">FLOW RUNS</div>
            <h2>Execution History</h2>
            <span>{loading ? 'Loading Flow history…' : filteredLogs.length + ' visible executions'}</span>
          </div>
          <label className="scheduled-flows-search">
            <Search size={14} />
            <input aria-label="Search Flow history" placeholder="Search executions"
              value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <label className="form-label">Status
            <select aria-label="Filter Flow status" className="form-control" value={status}
              onChange={event => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="waiting">Waiting</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <ResponsiveDataList rows={visibleLogs} includeTablet getId={log=>log.id}
          columns={[
            {apiName:'flow',label:'Flow',phoneRole:'title',render:log=>log.flowLabel},
            {apiName:'apiName',label:'API Name',render:log=>log.flowApiName},
            {apiName:'status',label:'Status',phoneRole:'badge',render:log=>log.status??'unknown'},
            {apiName:'started',label:'Started',phoneRole:'trailing',render:log=>formatTime(log.startedAt??log.failedAt)},
            {apiName:'type',label:'Flow type',phoneRole:'subtitle',render:log=>(log.flowType??log.trigger??'Unknown flow type') + (log.versionNumber?' · v'+log.versionNumber:'')},
            {apiName:'finished',label:'Finished',render:log=>formatTime(log.finishedAt??null)},
            {apiName:'duration',label:'Duration',render:log=>log.durationMs==null?'—':(log.durationMs/1000).toFixed(2)+'s'},
            {apiName:'error',label:'Error',render:log=>log.error??'—'},
            {apiName:'user',label:'User',render:log=>log.userId??'System'}
          ]} label="Flow execution history" loading={loading} emptyText="No matching Flow runs"
          onOpen={log=>onOpenFlow(log.flowApiName)} openLabel="Open Flow"/>
        <div className="table-scroll md-mobile-table-replaced md-tablet-table-replaced">
          <table className="slds-table flow-logs-table">
            <thead>
              <tr>
                <th scope="col">Flow</th>
                <th scope="col">API Name</th>
                <th scope="col">Status</th>
                <th scope="col">Type / Version</th>
                <th scope="col">Started</th>
                                <th scope="col">Duration</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleLogs.map(log => (
                <tr key={log.id}>
                  <td>
                    <button className="flow-log-link" type="button" onClick={() => onOpenFlow(log.flowApiName)}>
                      {log.flowLabel}
                    </button>
                  </td>
                  <td title={log.flowApiName}><code>{log.flowApiName}</code></td>
                  <td>{log.status ?? 'unknown'}</td>
                  <td>{log.flowType ?? log.trigger ?? 'Unknown flow type'}{log.versionNumber ? ' · v' + log.versionNumber : ''}</td>
                  <td>{formatTime(log.startedAt ?? log.failedAt)}</td>
                                    <td>{log.durationMs == null ? '—' : (log.durationMs / 1000).toFixed(2) + ' s'}</td>
                  <td><details><summary>Run details</summary><dl><dt>Run ID</dt><dd>{log.id}</dd><dt>Finished</dt><dd>{formatTime(log.finishedAt ?? (log.status ? null : log.failedAt))}</dd><dt>User</dt><dd>{log.userId ?? 'System'}</dd><dt>Error</dt><dd>{log.error ?? 'None'}</dd></dl></details></td>
                </tr>
              ))}
              {!loading && filteredLogs.length === 0 && (
                <tr><td className="scheduled-flows-empty" colSpan={7}>
                  {search || status !== 'all' ? 'No matching executions in the loaded history.' : 'No Flow executions have been logged.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <nav className="flow-history-pagination" aria-label="Flow history pages">
          <span>Page {currentPage+1} of {pageCount} loaded · {filteredLogs.length} matching runs</span>
          <button type="button" className="btn" disabled={currentPage===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button>
          <button type="button" className="btn" disabled={currentPage>=pageCount-1} onClick={()=>setPage(p=>Math.min(pageCount-1,p+1))}>Next</button>
          {hasMore && <button type="button" className="btn" onClick={onLoadMore}
            disabled={loading || loadingMore}>{loadingMore?'Loading…':'Load older runs'}</button>}
        </nav>
      </section>
    </div>
  );
}

