import OfflineRecordPicker from './OfflineRecordPicker';
import type { ObjectMetadata } from '../../metadata/Definitions/metadata';
import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import './OfflineBriefcaseSettings.css';

type Selection = { objectApi: string; recordIds: string[] };
type DraftSelection = { objectApi: string; recordIdsText: string };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

const briefcaseFailureMessage = (cause: unknown, fallback: string): string => {
  const detail = cause instanceof Error ? cause.message : fallback;
  return /SQL|database|postgres|non-JSON|HTTP 50[0234]|upstream|relation .+ does not exist/i.test(detail)
    ? 'Offline briefcase service is temporarily unavailable. Please retry.' : detail;
};

const toDraft = (selection: Selection): DraftSelection => ({
  objectApi: selection.objectApi,
  recordIdsText: selection.recordIds.join('\n')
});

export default function OfflineBriefcaseSettings({ request, permitted, objects }: {
  objects: ObjectMetadata[];
  request: Request;
  permitted: boolean;
}) {
  const [selections, setSelections] = useState<DraftSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState('[]');

  useEffect(() => {
    if (!permitted) return;
    let active = true;
    setLoading(true);
    setReady(false);
    setError('');
    void request<{ briefcase: { selections: Selection[] } }>('/tenant/offline-briefcase')
      .then(({ briefcase }) => {
        if (active) { const rows = (briefcase?.selections ?? []).map(toDraft); setSelections(rows); setSaved(JSON.stringify(rows)); setReady(true); }
      })
      .catch((cause: unknown) => {
        if (active) { setReady(false); setError(briefcaseFailureMessage(cause, 'Unable to load offline briefcase settings')); }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, permitted, revision]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving || !valid || !dirty) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const normalized = selections.map(({ objectApi, recordIdsText }) => ({
        objectApi: objectApi.trim(),
        recordIds: recordIdsText.split(/[\s,]+/).map(id => id.trim()).filter(Boolean)
      })).filter(selection => selection.objectApi || selection.recordIds.length);
      const { briefcase } = await request<{ briefcase: { selections: Selection[] } }>('/tenant/offline-briefcase', {
        method: 'PUT',
        body: JSON.stringify({ selections: normalized })
      });
      setSelections(briefcase.selections.map(toDraft));
      setSaved(JSON.stringify(briefcase.selections.map(toDraft)));
      setNotice('Offline briefcase selections saved.');
    } catch (cause) {
      setError(briefcaseFailureMessage(cause, 'Unable to save offline briefcase settings'));
    } finally { setSaving(false); }
  };

  if (!permitted) return null;
  const selectedCount = selections.reduce((count, selection) =>
    count + selection.recordIdsText.split(/[\s,]+/).filter(Boolean).length, 0);
  const dirty = JSON.stringify(selections) !== saved;
  const valid = ready && selectedCount <= 100 && selections.length <= 20 && selections.every(row => {
    const ids = row.recordIdsText.split(/[\s,]+/).filter(Boolean);
    return row.objectApi && ids.length >= 1 && ids.length <= 50 && new Set(ids).size === ids.length;
  }) && new Set(selections.map(row => row.objectApi)).size === selections.length;
  return <section className="offline-briefcase surface permission-section" aria-label="Mobile offline briefcase">
    <header><div><h2>Mobile offline briefcase</h2>
      <p>Choose up to 100 records across no more than 20 objects (50 records maximum per object) for read-only offline access.</p></div>
      <button type="button" className="btn" disabled={loading || saving}
        onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> Refresh</button>
    </header>
    {loading && <p role="status">Loading offline briefcase settings…</p>}
    {error && <p className="offline-briefcase-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {ready && <form onSubmit={event => void save(event)}>
      {selections.map((selection, index) => <fieldset className="offline-briefcase-selection" key={index}>
        <legend>{selection.objectApi ? (objects.find(object=>object.apiName===selection.objectApi)?.label??selection.objectApi) : `Object selection ${index+1}`} · {selection.recordIdsText.split(/[\s,]+/).filter(Boolean).length} selected</legend>
        <label>Object
          <select required value={selection.objectApi} disabled={loading || saving} onChange={event => setSelections(value => value.map((item, itemIndex) => itemIndex === index ? {objectApi:event.target.value,recordIdsText:''} : item))}>
            <option value="">Choose an object</option>
            {!objects.some(object => object.apiName === selection.objectApi) && selection.objectApi && <option value={selection.objectApi}>{selection.objectApi} (access unavailable)</option>}
            {objects.filter(object => object.apiName === selection.objectApi || !selections.some(row => row.objectApi === object.apiName)).map(object => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}
          </select>
        </label>
        <OfflineRecordPicker key={selection.objectApi} request={request} objectApi={selection.objectApi} nameField={objects.find(object => object.apiName === selection.objectApi)?.compactLayout?.fieldApiNames[0] ?? 'Name'} selected={selection.recordIdsText.split(/[\s,]+/).filter(Boolean)} disabled={loading || saving} remaining={Math.min(100-selectedCount, 50-selection.recordIdsText.split(/[\s,]+/).filter(Boolean).length)} onToggle={(id,checked) => setSelections(value => {
          const total = value.reduce((count,item) => count + item.recordIdsText.split(/[\s,]+/).filter(Boolean).length,0);
          return value.map((item,itemIndex) => {
            if(itemIndex !== index)return item;
            const ids = item.recordIdsText.split(/[\s,]+/).filter(Boolean);
            if(checked){
              if(ids.includes(id) || ids.length>=50 || total>=100)return item;
              return {...item,recordIdsText:[...ids,id].join('\n')};
            }
            return {...item,recordIdsText:ids.filter(value=>value!==id).join('\n')};
          });
        })} />
        <button type="button" className="btn btn-secondary" onClick={() =>
          setSelections(value => value.filter((_, itemIndex) => itemIndex !== index))}>
          Remove object
        </button>
      </fieldset>)}
      <p className="offline-briefcase-count" aria-live="polite">{selectedCount} of 100 records selected</p>
      {!valid && <p role="status">Choose an object and 1–50 unique records per object, with no more than 20 objects or 100 records in total.</p>}
      <div className="offline-briefcase-actions">
        <button type="button" className="btn btn-secondary" disabled={loading || selections.length >= 20 || saving}
          onClick={() => setSelections(value => [...value, { objectApi: '', recordIdsText: '' }])}>
          Add object
        </button>
        <button type="submit" className="btn btn-primary" disabled={loading || saving || !valid || !dirty}>
          {saving ? 'Saving…' : 'Save selections'}
        </button>
      </div>
    </form>}
  </section>;
}

