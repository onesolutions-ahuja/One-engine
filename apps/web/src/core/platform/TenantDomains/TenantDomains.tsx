import { useEffect, useState } from 'react';
import { CircleAlert, Copy, Globe2, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import './TenantDomains.css';

type Domain = { hostname: string; status: 'PENDING' | 'VERIFIED'; createdAt: string; verifiedAt?: string;
  verification: { type: string; host: string; value: string }; hosting: string; platformOwned?: boolean };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

// Same component serves tenant self-administration and platform-only tenant detail.
// A platform operator cannot use tenant credentials or bypass DNS ownership.
/** Registrar "Name/Host" field: the record name relative to the zone being verified. */
const hostLabel = (domain: Domain) => {
  const suffix = '.' + domain.hostname;
  return domain.verification.host.endsWith(suffix)
    ? domain.verification.host.slice(0, -suffix.length) : domain.verification.host;
};

export default function TenantDomains({ request, permitted, tenantId }: {
  request: Request; permitted: boolean; tenantId?: string;
}) {
  const base = tenantId ? '/platform/tenants/' + encodeURIComponent(tenantId) + '/domains' : '/tenant/domains';
  const [domains, setDomains] = useState<Domain[]>([]);
  const [hostname, setHostname] = useState('');
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    setLoading(true);
    request<{domains: Domain[]}>(base).then(({domains}) => {
      if (!cancelled) { setDomains(domains); setError(''); }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to read domains');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [base, permitted, request, revision]);
  const perform = async (path: string, method: 'POST'|'DELETE', body?: unknown) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(path, { method, ...(body ? {body: JSON.stringify(body)} : {}) });
      if (body) { setHostname(''); setAdding(false); }
      setNotice(method === 'DELETE' ? 'Domain removed and routing revoked.' :
        path.endsWith('/verify') ? 'DNS ownership verified. HTTPS hosting configuration is still required.' :
          'Domain registered. Publish the TXT proof, then verify.');
      setRevision((n) => n + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Domain operation failed'); }
    finally { setBusy(false); }
  };
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => setNotice(what + ' copied.'),
      () => setError('Copy failed; select the text and copy it manually.'));
  };
  if (!permitted) return null;
  return <section className="tenant-domains" aria-label="Tenant domains">
    <header className="tenant-domain-header"><div><h3><Globe2 size={17} /> Custom domains</h3>
      <p>Prove domain ownership before enabling tenant-bound sessions. Domain attachment and TLS must also be configured at the hosting provider.</p>
    </div><button type="button" className="tenant-button" disabled={loading || busy}
      onClick={() => setRevision((n) => n + 1)}><RefreshCw size={14} /> Refresh</button></header>
    {error && <p role="alert" className="tenant-domain-error"><CircleAlert size={14} /> {error}</p>}
    {notice && <p role="status" className="tenant-domain-notice">{notice}</p>}
    {loading && <p className="tenant-help">Loading domains…</p>}
    {!loading && domains.length === 0 && <p className="tenant-help">No domains registered.</p>}
    {domains.map((domain) => <div className="tenant-domain-item" key={domain.hostname}>
      <div className="tenant-domain-item-header"><strong>{domain.hostname}</strong>
        <span className={domain.status === 'VERIFIED' ? 'tenant-pill tenant-pill-active' : 'tenant-pill tenant-pill-suspended'}>
          {domain.status === 'VERIFIED' ? <><ShieldCheck size={12} /> Verified</> : 'Pending DNS'}</span></div>
      {domain.status === 'PENDING' && <div className="tenant-domain-proof">
        <span>Record type</span><code>{domain.verification.type}</code>
        <span>Name / Host</span><code>{hostLabel(domain)}
          <button type="button" className="tenant-button" aria-label="Copy DNS name"
            onClick={() => copy(hostLabel(domain), 'DNS name')}><Copy size={12} /></button></code>
        <span>Value</span><code>{domain.verification.value}
          <button type="button" className="tenant-button" aria-label="Copy TXT value"
            onClick={() => copy(domain.verification.value, 'TXT value')}><Copy size={12} /></button></code>
        <span />
        <small className="tenant-help">Most DNS providers (GoDaddy, Cloudflare, 123-reg) add the domain automatically, so enter
          only <code>{hostLabel(domain)}</code> as the Name. Full record: <code>{domain.verification.host}</code>.
          For a subdomain such as crm.example.com, add the subdomain part too
          (<code>_metadrive-challenge.crm</code>). New records can take up to an hour to publish.</small>
      </div>}
      <div className="tenant-domain-actions">
        {domain.status === 'PENDING' && <button type="button" className="tenant-button" disabled={busy}
          onClick={() => void perform(base + '/' + encodeURIComponent(domain.hostname) + '/verify', 'POST')}>Verify DNS</button>}
        {!domain.platformOwned && <button type="button" className="tenant-button tenant-button-danger" disabled={busy}
          onClick={() => { if (window.confirm('Remove ' + domain.hostname + '? Existing host-bound sessions will stop working here.'))
            void perform(base + '/' + encodeURIComponent(domain.hostname), 'DELETE'); }}><Trash2 size={14} /> Remove</button>}
        {domain.platformOwned && <span className="tenant-help">Platform login domain</span>}
      </div>
    </div>)}
    {!adding && domains.length < 5 && <div className="tenant-domain-add">
      <button type="button" className="tenant-button tenant-button-primary" disabled={busy || loading}
        onClick={() => setAdding(true)}><Plus size={14} /> Add domain</button>
    </div>}
    {adding && <div className="tenant-domain-add tenant-domain-add-edit">
      <label className="form-label">Domain hostname
        <input className="form-control" type="text" autoComplete="off" maxLength={253}
          placeholder="crm.customer.example" value={hostname}
          autoCapitalize="none" spellCheck={false}
          onChange={(event) => setHostname(event.target.value.toLowerCase())} />
      </label>
      <div className="tenant-domain-actions">
        <button type="button" className="tenant-button" disabled={busy}
          onClick={() => { setAdding(false); setHostname(''); }}>Cancel</button>
        <button type="button" className="tenant-button tenant-button-primary"
          disabled={busy || !hostname.trim() || domains.length >= 5}
          onClick={() => void perform(base, 'POST', {hostname: hostname.trim().toLowerCase().replace(/\.$/, '')})}>Save domain</button>
      </div>
    </div>}
  </section>;
}
