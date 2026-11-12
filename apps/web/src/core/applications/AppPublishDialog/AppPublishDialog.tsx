import { useEffect, useState } from 'react';
import { CircleAlert, Store, X } from 'lucide-react';
import './AppPublishDialog.css';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Item = { apiName: string; label: string; suggested: boolean };
type Category = 'objects' | 'objectConfigurations' | 'pages' | 'components' | 'flows' | 'permissionSets';
type Discovery = {
  app: { apiName: string; label: string; description: string };
  published: { appExchangeApiName: string; latestVersion: number } | null;
  nextVersion: number;
  navigation: Array<{ type: string; apiName: string }>;
  available: Record<Category, Item[]>;
};
const CATEGORIES: Array<[Category, string, string]> = [
  ['objects', 'Objects and fields', 'Installing tenants reuse objects they already have and gain only missing fields.'],
  ['objectConfigurations', 'Page layouts and record types', 'Skipped in tenants that already have the object.'],
  ['pages', 'Pages', 'Navigation and home pages are required.'],
  ['components', 'Custom components', ''],
  ['flows', 'Flows', 'Callouts use each tenant\'s own Named Credential (for example from the WhatsApp Connector). Flows active here are activated after install.'],
  ['permissionSets', 'Permission sets', '']
];

/** Publish a tenant-built app to AppExchange so any licensed tenant can install it. */
export default function AppPublishDialog({ appApiName, request, onClose }: {
  appApiName: string; request: Request; onClose: () => void;
}) {
  const base = '/platform/apps/' + encodeURIComponent(appApiName) + '/publish';
  const [data, setData] = useState<Discovery | null>(null);
  const [selected, setSelected] = useState<Record<Category, string[]>>({
    objects: [], objectConfigurations: [], pages: [], components: [], flows: [], permissionSets: [] });
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  useEffect(() => {
    let cancelled = false;
    request<Discovery>(base).then((found) => {
      if (cancelled) return;
      setData(found);
      setDescription(found.app.description);
      setSelected(Object.fromEntries(CATEGORIES.map(([key]) =>
        [key, found.available[key].filter((item) => item.suggested).map((item) => item.apiName)])) as Record<Category, string[]>);
    }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load app'); });
    return () => { cancelled = true; };
  }, [base, request]);

  const toggle = (key: Category, apiName: string) => setSelected((current) => ({
    ...current, [key]: current[key].includes(apiName) ? current[key].filter((x) => x !== apiName) : [...current[key], apiName] }));
  const publish = async () => {
    if (!data || busy) return;
    setBusy(true); setError(''); setResult('');
    try {
      const published = await request<{ appExchangeApiName: string; version: number; activateFlows: string[] }>(base, {
        method: 'POST', body: JSON.stringify({ version: data.nextVersion, description, ...selected }) });
      setResult(data.app.label + ' version ' + published.version + ' is now on AppExchange as "' + published.appExchangeApiName
        + '". Licensed tenants can install it from Setup → AppExchange.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Publishing failed'); }
    finally { setBusy(false); }
  };

  return <div className="app-publish-backdrop" role="presentation">
    <section className="app-publish-dialog" role="dialog" aria-modal="true" aria-label={'Publish ' + appApiName + ' to AppExchange'}>
      <header><h2><Store size={18} /> Publish to AppExchange</h2>
        <button type="button" className="btn btn-small" aria-label="Close" onClick={onClose}><X size={14} /></button></header>
      {!data && !error && <p role="status">Loading app metadata…</p>}
      {error && <p className="form-error" role="alert"><CircleAlert size={14} /> {error}</p>}
      {result ? <><p className="form-success" role="status">{result}</p>
        <div className="app-publish-actions"><button type="button" className="btn btn-brand" onClick={onClose}>Done</button></div></>
      : data && <>
        <p><strong>{data.app.label}</strong> · version {data.nextVersion}
          {data.published ? ' (currently v' + data.published.latestVersion + ')' : ' (first release)'}</p>
        <p className="app-publish-help">Metadata only: credentials, records and users are never published. Installing tenants keep
          anything they already have; existing objects only gain missing fields.</p>
        <label className="form-label">Description shown in AppExchange
          <textarea className="form-control" rows={2} maxLength={4000} value={description}
            onChange={(event) => setDescription(event.target.value)} /></label>
        {CATEGORIES.map(([key, label, help]) => data.available[key].length > 0 && <fieldset key={key} className="app-publish-group">
          <legend>{label} <span>({selected[key].length} of {data.available[key].length})</span></legend>
          {help && <p className="app-publish-help">{help}</p>}
          <div className="app-publish-items">{data.available[key].map((item) => <label key={item.apiName}>
            <input type="checkbox" checked={selected[key].includes(item.apiName)} onChange={() => toggle(key, item.apiName)} />
            {item.label}{item.label !== item.apiName && <code>{item.apiName}</code>}
          </label>)}</div>
        </fieldset>)}
        <div className="app-publish-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-brand" onClick={() => void publish()} disabled={busy}>
            {busy ? 'Publishing…' : 'Publish version ' + data.nextVersion}</button>
        </div>
      </>}
    </section>
  </div>;
}
