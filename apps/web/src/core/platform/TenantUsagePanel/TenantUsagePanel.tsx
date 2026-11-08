import { useEffect, useState, type FormEvent } from 'react';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import './TenantUsagePanel.css';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Counter = 'users' | 'records' | 'objects' | 'flows' | 'storage_bytes' | 'api_requests_daily';
type Counts = {
  users: number; activeUsers: number; objects: number; customObjects: number;
  fields: number; records: number; flows: number; activeFlows: number;
  pages: number; apps: number; reports: number; dashboards: number;
  namedCredentials: number; pendingApprovals: number; verifiedDomains: number;
};
type Usage = {
  tenantId: string; status: string; sampledAt: string; counts: Counts;
  targets: Partial<Record<Counter, number>>; warnings: Counter[];
  enforcement: 'advisory_only'; storageBytes: number; apiRequestsToday: number;
};
const counters: Array<{ key: keyof Counts; label: string }> = [
  {key: 'users', label: 'Users'}, {key: 'activeUsers', label: 'Active users'},
  {key: 'objects', label: 'Objects'}, {key: 'customObjects', label: 'Custom objects'},
  {key: 'fields', label: 'Fields'}, {key: 'records', label: 'Records'},
  {key: 'flows', label: 'Flows'}, {key: 'activeFlows', label: 'Published flows'},
  {key: 'pages', label: 'Pages'}, {key: 'apps', label: 'Apps'},
  {key: 'reports', label: 'Reports'}, {key: 'dashboards', label: 'Dashboards'},
  {key: 'namedCredentials', label: 'Named Credentials (count only)'},
  {key: 'pendingApprovals', label: 'Pending approvals'}, {key: 'verifiedDomains', label: 'Verified domains'}
];
const editable: Array<{ key: Counter; label: string }> = [
  {key: 'users', label: 'Users'}, {key: 'records', label: 'Records'},
  {key: 'objects', label: 'Objects'}, {key: 'flows', label: 'Flows'},
  {key: 'storage_bytes', label: 'Estimated data bytes'},
  {key: 'api_requests_daily', label: 'API requests today'}
];
type TargetForm = Record<Counter, string>;
const empty: TargetForm = { users: '', records: '', objects: '', flows: '', storage_bytes:'', api_requests_daily:'' };
function fromTargets(targets: Usage['targets']): TargetForm {
  return { users: String(targets.users ?? ''), records: String(targets.records ?? ''),
    objects: String(targets.objects ?? ''), flows: String(targets.flows ?? ''),
    storage_bytes:String(targets.storage_bytes??''),api_requests_daily:String(targets.api_requests_daily??'') };
}
// Same controlled component supports platform tenant detail and the tenant's
// self-service security settings. Tenants cannot change advisory targets.
export default function TenantUsagePanel({ request, tenantId, permitted }: {
  request: Request; tenantId?: string; permitted: boolean;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [targets, setTargets] = useState<TargetForm>(empty);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = tenantId ? '/platform/tenants/' + encodeURIComponent(tenantId) + '/usage' : '/tenant/usage';
  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    setUsage(null); setLoading(true); setError('');
    request<{ usage: Usage }>(base).then(({usage}) => {
      if (!cancelled) { setUsage(usage); setTargets(fromTargets(usage.targets)); }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to read tenant usage');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [base, request, permitted, revision]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || saving || !usage) return;
    const payload: Record<Counter, number | null> = { users: null, records: null, objects: null,
      flows: null,storage_bytes:null,api_requests_daily:null };
    for (const key of Object.keys(payload) as Counter[]) {
      const value = targets[key].trim();
      if (value) {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1) {
          setError('Warning targets must be positive whole numbers within the supported integer range.');
          return;
        }
        payload[key] = parsed;
      }
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await request<{ usage: Usage }>(base + '-targets', {
        method: 'PATCH', body: JSON.stringify(payload)
      });
      setUsage(result.usage); setTargets(fromTargets(result.usage.targets));
      setNotice('Advisory warning targets saved and audited. Nothing is blocked or billed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save warning targets');
    } finally { setSaving(false); }
  };
  if (!permitted) return null;
  return <section className="tenant-usage" aria-label="Tenant usage and advisory targets">
    <div className="tenant-usage-title">
      <div><h3><Activity size={17} aria-hidden="true" /> Tenant usage</h3>
        <p>Tenant-scoped counts and resource estimates. No record values or credentials are exposed.</p>
      </div>
      <button type="button" className="tenant-button" disabled={loading || saving}
        onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} /> Refresh</button>
    </div>
    {loading && <p role="status">Calculating usage…</p>}
    {error && <p className="tenant-usage-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {usage && <>
      <div className="tenant-usage-grid">
      <div className="tenant-usage-stat"><span>Estimated tenant data storage</span><strong>{usage.storageBytes.toLocaleString()} bytes</strong></div>
      <div className="tenant-usage-stat"><span>Authenticated API requests today</span><strong>{usage.apiRequestsToday.toLocaleString()}</strong></div>
    </div>
    <div className="tenant-usage-grid">
        {counters.map(({key,label}) => <div className="tenant-usage-stat" key={key}>
          <span>{label}</span><strong>{usage.counts[key].toLocaleString()}</strong>
        </div>)}
      </div>
      <p className="tenant-usage-help">
        Sampled {new Date(usage.sampledAt).toLocaleString()} · Status: {usage.status}.
        Storage estimates include tenant record rows, field-value rows and uploaded file payloads; they exclude indexes, shared platform data and backups.
      </p>
      {usage.warnings.length > 0 && <p className="tenant-usage-warning" role="status">
        Advisory warning: {usage.warnings.join(', ')} reached or exceeded their configured target.
      </p>}
      {tenantId && <form onSubmit={(event) => void save(event)}>
        <h4>Advisory warning targets</h4>
        <p className="tenant-usage-help"><ShieldCheck size={14} aria-hidden="true" />
          Targets are notifications only: no request, user, workflow or record write is blocked. Leave blank to remove a target.</p>
        <div className="tenant-usage-targets">
          {editable.map(({key,label}) => <label key={key}>{label}
            <input type="number" inputMode="numeric" min={1} step={1}
              value={targets[key]} onChange={(event) => setTargets((previous) => ({
                ...previous, [key]: event.target.value
              }))} />
          </label>)}
        </div>
        <button type="submit" className="tenant-button tenant-button-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save warning targets'}
        </button>
      </form>}
    </>}
  </section>;
}
