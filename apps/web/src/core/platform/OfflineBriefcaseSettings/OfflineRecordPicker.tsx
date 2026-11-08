import { useEffect, useState } from 'react';

type RecordRow = { Id: string; [key: string]: unknown };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
export default function OfflineRecordPicker({ request, objectApi, nameField, selected, onToggle, disabled, remaining }: {
  request: Request; objectApi: string; nameField: string; selected: string[];
  onToggle: (id: string, checked: boolean) => void; disabled: boolean; remaining: number;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [retryIndex,setRetryIndex]=useState(0);
  useEffect(()=>{setRows([]);setLabels({});setQuery('');},[objectApi]);
  useEffect(() => {
    let active = true;
    setError(''); setLoading(Boolean(objectApi));
    if (!objectApi) return;
    const timer = window.setTimeout(() => {
      void request<{records: RecordRow[]}>(`/records/${encodeURIComponent(objectApi)}?${new URLSearchParams({search:query.trim(),limit:'20',offset:'0'})}`)
        .then(result => { if (active) { setRows(result.records); setLabels(previous => ({...previous,...Object.fromEntries(result.records.map(record => [record.Id, String(record[nameField] ?? record.Name ?? record.Id)]))})); } })
        .catch(() => { if (active) setError('Record search is temporarily unavailable. Your previous results remain visible.'); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [request, objectApi, nameField, query, retryIndex]);
  return <div className="offline-record-picker">
    <label>Find records<input type="search" value={query} disabled={disabled || !objectApi} placeholder="Search records by name" onChange={event => setQuery(event.target.value)} /></label>
    <p role="status">{selected.length} records selected for this object{loading ? ' · Searching…' : ''}</p>
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-small" disabled={disabled || loading} onClick={()=>setRetryIndex(value=>value+1)}>Retry record search</button></div>}
    {selected.length > 0 && <ul aria-label="Selected records">{selected.map(id => <li key={id}><span>{labels[id] ?? id}</span> <button type="button" className="btn btn-small" disabled={disabled} aria-label={`Remove ${labels[id] ?? id}`} onClick={() => onToggle(id, false)}>Remove</button></li>)}</ul>}
    <div className="offline-record-results" aria-label="Matching records" aria-busy={loading}>
      {!loading && objectApi && !rows.length && !error && <p>No matching records. Try another name.</p>}
      {rows.map(record => <label key={record.Id}><input type="checkbox" checked={selected.includes(record.Id)} disabled={disabled || (!selected.includes(record.Id) && remaining <= 0)} onChange={event => onToggle(record.Id, event.target.checked)} />{String(record[nameField] ?? record.Name ?? record.Id)}</label>)}
    </div>
    <small>Showing up to 20 matches. Search to find more records.</small>
  </div>;
}
