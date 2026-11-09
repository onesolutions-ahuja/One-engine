import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import { useEffect, useState, type FormEvent } from 'react';
import { Building2, ChevronLeft, ChevronRight, CircleAlert, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import './TenantManagement.css';
import {tenantCreateFieldDefinitions} from './adminTenantFieldMetadata';
import AdminPropertyControl from '../../builders/AdminPropertyControl/AdminPropertyControl';
import TenantDomains from '../TenantDomains/TenantDomains';
import TenantRecoveryPanel from '../TenantRecoveryPanel/TenantRecoveryPanel';
import TenantUsagePanel from '../TenantUsagePanel/TenantUsagePanel';
import SeederManager from './SeederManager';
import {PlatformPageSlot} from '../Workspace/PlatformPageSlot';

export type TenantSummary = {
  tenantId: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  archivedAt?: string | null; retentionUntil?: string | null; legalHold?: boolean;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  activeUserCount: number;
  provisioning: { status: 'READY'; version: number; completedAt: string };
  developerAccount: { email: string; activated: boolean } | null;
};

type TenantCreate = {
  tenantId: string; tenantName: string; adminName: string; email: string; password: string; tenantDeveloperEmail: string;
};
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type TenantDeveloperAvailability = { email: string; available: boolean; alternatives: string[]; developerDomain: string };
const emptyCreate: TenantCreate = { tenantId: '', tenantName: '', adminName: '', email: '', password: '', tenantDeveloperEmail: '' };
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleDateString();
};

export default function TenantManagement({ request, permitted }: { request: Request; permitted: boolean }) {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<TenantSummary | null>(null);
  const [editing, setEditing] = useState({ name: '', description: '' });
  const [create, setCreate] = useState<TenantCreate>(emptyCreate);
  const [emailCheck, setEmailCheck] = useState<TenantDeveloperAvailability|null>(null);
  const [emailChecking,setEmailChecking] = useState(false);
  const [emailCheckError,setEmailCheckError] = useState('');
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [showCreate, setShowCreate] = useState(false);
  const [detailTab, setDetailTab] = useState<'details' | 'usage' | 'domains' | 'recovery' | 'seeders'>('details');
  const [editDetails, setEditDetails] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [retentionUntil, setRetentionUntil] = useState('');
  const [legalHold, setLegalHold] = useState(false);
  const pageSize = 25;
  const activeOnPage = tenants.filter(item => item.status === 'ACTIVE').length;
  const suspendedOnPage = tenants.filter(item => item.status === 'SUSPENDED').length;
  const archivedOnPage = tenants.filter(item => item.status === 'ARCHIVED').length;

  useEffect(()=>{
    if(!showCreate)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.querySelector<HTMLElement>('.tenant-create-dialog input:not([disabled])')?.focus();
    return()=>previous?.focus();
  },[showCreate]);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);
  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    setLoading(true);
    request<{ tenants: TenantSummary[]; total: number }>(
      '/platform/tenants?' + new URLSearchParams({
        q: debouncedQuery, status, page: String(page), pageSize: String(pageSize)
      }).toString()
    ).then((result) => {
      if (cancelled) return;
      setTenants(result.tenants);
      setTotal(result.total);
      setError('');
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load tenants');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [permitted, request, debouncedQuery, status, page, revision]);

  useEffect(()=>{
    if(!showCreate||!create.tenantId||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(create.tenantId)||create.tenantId.length>54) {
      setEmailCheck(null);setEmailCheckError('');setEmailChecking(false);return;
    }
    let cancelled=false;
    setEmailChecking(true);setEmailCheck(null);setEmailCheckError('');
    const timeout=window.setTimeout(()=>{
      request<TenantDeveloperAvailability>(
        '/platform/tenants/developer-email-availability?slug='+encodeURIComponent(create.tenantId)
      ).then(value=>{
        if(cancelled)return;
        if(!value.email||!value.developerDomain||!Array.isArray(value.alternatives)){
          setEmailCheck(null);
          setEmailCheckError('Mailbox availability service returned an incomplete response.');
          return;
        }
        setEmailCheck(value);
      }).catch(cause=>{
        if(!cancelled){
          setEmailCheck(null);
          setEmailCheckError(cause instanceof Error?cause.message:'Unable to check developer mailbox availability.');
        }
      }).finally(()=>{if(!cancelled)setEmailChecking(false);});
    },250);
    return ()=>{cancelled=true;window.clearTimeout(timeout);};
  },[create.tenantId,showCreate,request]);

  const selectTenant = async (id: string) => {
    setError('');
    try {
      const result = await request<{ tenant: TenantSummary }>('/platform/tenants/' + encodeURIComponent(id));
      setSelected(result.tenant);
      setDetailTab('details'); setEditDetails(false);
      setRetentionUntil(result.tenant.retentionUntil?.slice(0, 10) ?? '');
      setLegalHold(result.tenant.legalHold ?? false);
      setEditing({ name: result.tenant.name, description: result.tenant.description });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open tenant');
    }
  };
  const administratorEmailMatchesDeveloper = create.email.trim().length>0
    && create.email.trim().toLowerCase()===create.tenantDeveloperEmail.trim().toLowerCase();
  const developerEmailAvailable = Boolean(emailCheck
    && emailCheck.email===create.tenantId+'@unesolutions.co.uk'
    && (create.tenantDeveloperEmail===emailCheck.email&&emailCheck.available
      || emailCheck.alternatives.includes(create.tenantDeveloperEmail)));
  const canCreateTenant = !busy&&!emailChecking&&developerEmailAvailable
    && Boolean(emailCheck?.developerDomain)&&!administratorEmailMatchesDeveloper;

  const createTenant = async (event: FormEvent) => {
    event.preventDefault();
    if (!permitted || busy) return;
    if(administratorEmailMatchesDeveloper){setError('Initial administrator and tenant developer emails must be different.');return;}
    if(!developerEmailAvailable||!emailCheck?.developerDomain){setError('Verify an available developer mailbox.');return;}
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ tenant: TenantSummary; replayed: boolean }>('/platform/tenants', {
        method: 'POST', headers: { 'Idempotency-Key': createKey },
        body: JSON.stringify(create)
      });
      setShowCreate(false); setCreate(emptyCreate); setCreateKey(crypto.randomUUID());
      setSelected(result.tenant);
      setEditing({ name: result.tenant.name, description: result.tenant.description });
      setNotice(result.replayed ? 'Existing provisioning request confirmed; no duplicate tenant or account was created.' : 'Tenant provisioned and saved successfully.');
      setPage(1); setRevision((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create tenant');
    } finally { setBusy(false); }
  };
  const saveTenant = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || busy || !permitted) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ tenant: TenantSummary }>(
        '/platform/tenants/' + encodeURIComponent(selected.tenantId), {
          method: 'PATCH', body: JSON.stringify(editing)
        });
      setSelected(result.tenant); setEditing({ name: result.tenant.name, description: result.tenant.description });
      setEditDetails(false);
      setNotice('Tenant details saved.'); setRevision((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save tenant');
    } finally { setBusy(false); }
  };
  const changeStatus = async () => {
    if (!selected || busy || !permitted) return;
    const suspend = selected.status === 'ACTIVE';
    // Require the immutable tenant ID, not its editable display name, before
    // an operator can change the authentication availability of an organisation.
    // This UI safeguard complements (and never replaces) server-side platform RBAC.
    const confirmation = window.prompt(
      (suspend
        ? `Suspend ${selected.name}? All tenant sessions will be blocked and existing refresh sessions revoked.`
        : `Reactivate ${selected.name}? Users will need to sign in again.`) +
      `\n\nEnter tenant ID "${selected.tenantId}" to confirm:`
    );
    if (confirmation !== selected.tenantId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ tenant: TenantSummary }>(
        '/platform/tenants/' + encodeURIComponent(selected.tenantId) + (suspend ? '/suspend' : '/reactivate'),
        { method: 'POST', body: '{}' }
      );
      setSelected(result.tenant);
      setNotice(suspend ? 'Tenant suspended.' : 'Tenant reactivated.');
      setRevision((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to change tenant status');
    } finally { setBusy(false); }
  };

  const changeLifecycle = async (operation: 'archive' | 'restore') => {
    if (!selected || busy || !permitted) return;
    if (window.prompt(`Enter tenant ID "${selected.tenantId}" to ${operation} this tenant:`) !== selected.tenantId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ tenant: TenantSummary }>(
        '/platform/tenants/' + encodeURIComponent(selected.tenantId) + '/' + operation,
        { method: 'POST', body: '{}' }
      );
      setSelected(result.tenant); setRevision((n) => n + 1);
      setNotice(operation === 'archive' ? 'Tenant archived; data retained and authentication blocked.' :
        'Tenant restored to suspended. Reactivation requires a separate action.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to change lifecycle');
    } finally { setBusy(false); }
  };
  const saveRetention = async () => {
    if (!selected || busy || !permitted) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ tenant: TenantSummary }>(
        '/platform/tenants/' + encodeURIComponent(selected.tenantId) + '/retention', {
          method: 'PATCH',
          body: JSON.stringify({ retentionUntil: retentionUntil ? new Date(retentionUntil + 'T23:59:59.000Z').toISOString() : null, legalHold })
        });
      setSelected(result.tenant); setRevision((n) => n + 1);
      setNotice('Tenant retention settings saved and audited; no data deleted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save retention settings');
    } finally { setBusy(false); }
  };

  if (!permitted) return <section className="tenant-console tenant-restricted" role="status">
    <ShieldCheck size={24} />
    <h2>Platform administration only</h2>
    <p>Only users with the platform superadministrator policy can manage tenants.</p>
  </section>;

  return <div className="tenant-console">
    <header className="tenant-heading">
      <div><div className="tenant-eyebrow"><Building2 size={14} /> Platform administration</div>
        <h1>Tenant Management</h1><p>Create, search and manage tenant organisations.</p></div>
      <div className="tenant-header-actions">
        <button type="button" className="tenant-button" onClick={() => setRevision((n) => n + 1)} disabled={loading || busy}><RefreshCw size={16} /> Refresh</button>
        <button type="button" className="tenant-button tenant-button-primary" onClick={() => { setCreate(emptyCreate); setCreateKey(crypto.randomUUID()); setShowCreate(true); setSelected(null); setError(''); }}><Plus size={16} /> New tenant</button>
      </div>
    </header>
    {error && <div className="tenant-alert tenant-alert-error" role="alert"><CircleAlert size={17} /> {error}</div>}
    {notice && <div className="tenant-alert" role="status">{notice}</div>}
    <section className="tenant-overview" aria-label="Tenant overview"><div><strong>{total}</strong><span>Matching tenants</span></div><div><strong>{activeOnPage}</strong><span>Active on this page</span></div><div><strong>{suspendedOnPage}</strong><span>Suspended on this page</span></div><div><strong>{archivedOnPage}</strong><span>Archived on this page</span></div></section>
    <div className="tenant-columns" aria-hidden={showCreate || undefined}>
      <PlatformPageSlot slotKey="directory"><section className="tenant-panel" aria-label="Tenants">
        <div className="tenant-toolbar">
          <label className="tenant-search"><Search size={16} /><input type="search" aria-label="Search tenants" placeholder="Search name or tenant ID" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
          <label className="tenant-filter">Status <select aria-label="Filter tenant status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">All</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="ARCHIVED">Archived</option></select></label>
        </div>
        <ResponsiveDataList rows={tenants} getId={item=>item.tenantId} label="Tenant organisations"
          onOpen={item=>void selectTenant(item.tenantId)} openLabel="Open tenant"
          loading={loading}
          columns={[
            {apiName:'name',label:'Organisation',phoneRole:'title',render:item=>item.name},
            {apiName:'tenantId',label:'Tenant ID',render:item=>item.tenantId},
            {apiName:'status',label:'Status',phoneRole:'badge',render:item=>item.status},
            {apiName:'users',label:'Users',phoneRole:'subtitle',render:item=>item.activeUserCount+' / '+item.userCount},
            {apiName:'created',label:'Created',phoneRole:'trailing',render:item=>shortDate(item.createdAt)}
          ]}/>
        <div className="tenant-table-wrap md-mobile-table-replaced"><table className="tenant-table"><thead><tr><th>Organisation</th><th>Tenant ID</th><th>Status</th><th>Users</th><th>Created</th></tr></thead>
          <tbody>{tenants.map((item) => <tr key={item.tenantId} className={selected?.tenantId === item.tenantId ? 'tenant-row-selected' : ''}>
            <td><button className="tenant-name-link" onClick={() => void selectTenant(item.tenantId)}>{item.name}</button></td><td title={item.tenantId}><code>{item.tenantId}</code></td>
            <td><span className={item.status === 'ACTIVE' ? 'tenant-pill tenant-pill-active' : 'tenant-pill tenant-pill-suspended'}>{item.status === 'ACTIVE' ? 'Active' : item.status === 'ARCHIVED' ? 'Archived' : 'Suspended'}</span></td>
            <td>{item.activeUserCount} / {item.userCount}</td><td>{shortDate(item.createdAt)}</td></tr>)}
            {!loading && tenants.length === 0 && <tr><td colSpan={5} className="tenant-empty">No tenants match this search.</td></tr>}
            {loading && <tr><td colSpan={5} className="tenant-empty">Loading tenants…</td></tr>}
          </tbody></table></div>
        <footer className="tenant-pagination"><span>{total} tenant{total === 1 ? '' : 's'} · Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span><div>
          <button aria-label="Previous tenants" disabled={page === 1 || loading} onClick={() => setPage((n) => Math.max(1, n - 1))}><ChevronLeft size={16} /></button>
          <button aria-label="Next tenants" disabled={page * pageSize >= total || loading} onClick={() => setPage((n) => n + 1)}><ChevronRight size={16} /></button>
        </div></footer>
      </section></PlatformPageSlot>
      {!showCreate&&<PlatformPageSlot slotKey="tenant-details"><section className="tenant-panel tenant-detail" aria-label="Tenant details">
        {selected ? <><div className="tenant-detail-tabs" role="tablist" aria-label="Tenant details sections">{([["details","Details"],["usage","Usage"],["domains","Domains"],["recovery","Recovery"],["seeders","Seeders"]] as const).map(([id,label]) => <button type="button" key={id} role="tab" aria-selected={detailTab === id} className={detailTab === id ? "active" : ""} onClick={() => setDetailTab(id)}>{label}</button>)}</div>{detailTab === "details" && <form onSubmit={(event) => void saveTenant(event)}>
          <div className="tenant-detail-heading"><div><h2>{selected.name}</h2><code>{selected.tenantId}</code></div><button type="button" className="tenant-button" onClick={() => setSelected(null)}>Close</button></div>
          <p className="tenant-provisioning-status"><span className="tenant-pill tenant-pill-active">Provisioning ready</span> <small>Version {selected.provisioning.version} · {shortDate(selected.provisioning.completedAt)}</small></p>
          {selected.developerAccount && <p className="tenant-help">Developer seeder: <strong>{selected.developerAccount.email}</strong> — {selected.developerAccount.activated ? 'Tenant activated' : 'Pending tenant activation'}. The tenant owns all access changes.</p>}
          <p><span className={selected.status === 'ACTIVE' ? 'tenant-pill tenant-pill-active' : 'tenant-pill tenant-pill-suspended'}>{selected.status === 'ACTIVE' ? 'Active' : selected.status === 'ARCHIVED' ? 'Archived' : 'Suspended'}</span></p>
          {editDetails ? <label>Organisation name<input required maxLength={120} value={editing.name} onChange={(event) => setEditing((old) => ({ ...old, name: event.target.value }))} /></label> : <div className="tenant-readonly-field"><span>Organisation name</span><strong>{selected.name}</strong></div>}
          {editDetails ? <label>Description<textarea rows={4} maxLength={1000} value={editing.description} onChange={(event) => setEditing((old) => ({ ...old, description: event.target.value }))} /></label> : <div className="tenant-readonly-field"><span>Description</span><strong>{selected.description || "Not provided"}</strong></div>}
          <div className="tenant-facts"><span>Created</span><strong>{shortDate(selected.createdAt)}</strong><span>Last updated</span><strong>{shortDate(selected.updatedAt)}</strong><span>Active users</span><strong>{selected.activeUserCount} of {selected.userCount}</strong></div>
          <div className="tenant-actions">{editDetails ? <><button type="submit" className="tenant-button tenant-button-primary" disabled={busy || !editing.name.trim()}>{busy ? 'Saving…' : 'Save details'}</button><button type="button" className="tenant-button" onClick={() => {setEditing({name:selected.name,description:selected.description});setEditDetails(false);}}>Cancel</button></> : <button type="button" className="tenant-button" onClick={() => setEditDetails(true)}>Edit details</button>}
            {selected.status !== 'ARCHIVED' && <button type="button" className={selected.status === 'ACTIVE' ? 'tenant-button tenant-button-danger' : 'tenant-button'} onClick={() => void changeStatus()} disabled={busy}>{selected.status === 'ACTIVE' ? 'Suspend tenant' : 'Reactivate tenant'}</button>}
            {selected.status === 'SUSPENDED' && <button type="button" className="tenant-button tenant-button-danger" onClick={() => void changeLifecycle('archive')} disabled={busy}>Archive tenant</button>}
            {selected.status === 'ARCHIVED' && <button type="button" className="tenant-button" onClick={() => void changeLifecycle('restore')} disabled={busy}>Restore to suspended</button>}</div>
          <p className="tenant-help">Tenant ID cannot be changed. Suspended and archived tenants cannot authenticate; reactivation never restores revoked sessions. Archival retains tenant data.</p>
          <section aria-label="Retention controls">
            <h3>Retention and legal hold</h3>
            <label>Retention until (optional)<input type="date" value={retentionUntil} onChange={(event) => setRetentionUntil(event.target.value)} /></label>
            <label><input type="checkbox" checked={legalHold} onChange={(event) => setLegalHold(event.target.checked)} /> Legal hold</label>
            <button type="button" className="tenant-button" onClick={() => void saveRetention()} disabled={busy}>Save retention policy</button>
            <p className="tenant-help">Retention metadata is audited. No automatic or manual data deletion is enabled.</p>
          </section>
        </form>}{detailTab === "usage" && <PlatformPageSlot slotKey="tenant-usage"><TenantUsagePanel request={request} tenantId={selected.tenantId} permitted={permitted} /></PlatformPageSlot>}{detailTab === "domains" && <PlatformPageSlot slotKey="tenant-domains"><TenantDomains request={request} permitted={permitted} tenantId={selected.tenantId} /></PlatformPageSlot>}{detailTab === "seeders" && <SeederManager request={request} tenantId={selected.tenantId} />}{detailTab === "recovery" && <PlatformPageSlot slotKey="tenant-recovery"><TenantRecoveryPanel request={request} operator permitted={permitted} tenantId={selected.tenantId} /></PlatformPageSlot>}</> : <div className="tenant-placeholder"><Building2 size={30} /><h2>Tenant details</h2><p>Select a tenant to view details.</p></div>}
      </section></PlatformPageSlot>}
    </div>
    {showCreate&&<div className="tenant-create-backdrop" role="presentation">
      <section className="tenant-create-dialog" role="dialog" aria-modal="true" aria-labelledby="tenant-create-title"
        onKeyDown={event=>{
          if(event.key==='Escape'){event.preventDefault();if(!busy){setShowCreate(false);setCreate(emptyCreate);setCreateKey(crypto.randomUUID());}return;}
          if(event.key!=='Tab')return;
          const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
          ));
          if(!controls.length){event.preventDefault();return;}
          const first=controls[0],last=controls[controls.length-1];
          if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
          else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        }}>
        <form aria-label="New tenant draft" onSubmit={(event) => void createTenant(event)}>
          <div className="tenant-detail-heading"><h2 id="tenant-create-title">New tenant</h2><button type="button" className="tenant-button" disabled={busy} onClick={() => { setShowCreate(false); setCreate(emptyCreate); setCreateKey(crypto.randomUUID()); }}>Close</button></div>
          {tenantCreateFieldDefinitions.map(field=><AdminPropertyControl
            key={field.key} definition={{...field,propertyKey:field.key,kind:'TEXT'}}
            value={create[field.key]??''}
            onChange={value=>{setCreateKey(crypto.randomUUID());setCreate(old=>({...old,[field.key]:value,...(field.key==='tenantId'?{tenantDeveloperEmail:value+'@unesolutions.co.uk'}:{})}));}}/>)}
          <div className="tenant-help" aria-live="polite">
            {emailCheckError?<span role="alert">Developer mailbox check failed: {emailCheckError}</span>:
              emailChecking?'Checking mailbox availability…':emailCheck?
              <><strong>{emailCheck.email}</strong> — {emailCheck.available?'Available':'Already in use'}
                {!emailCheck.available&&<div>Choose a verified alternative: {emailCheck.alternatives.map(email=>
                  <button type="button" className="tenant-button" key={email}
                    onClick={()=>{setCreateKey(crypto.randomUUID());setCreate(old=>({...old,tenantDeveloperEmail:email}));}}>{email}</button>)}</div>}
              </>:create.tenantId?'Tenant ID must contain lowercase letters, numbers or hyphens (maximum 54 characters).':'Enter a tenant ID to verify developer mailbox availability.'}
          </div>
          {administratorEmailMatchesDeveloper&&<p className="tenant-help tenant-validation-error" role="alert">Initial administrator email must differ from the tenant developer email.</p>}
          <p className="tenant-help">Platform login domain: <strong>{emailCheck?.developerDomain??'assigned automatically'}</strong>. Your organisation does not need its own domain. The administrator can use any valid email address; custom website domains can be added later under Domains.</p>
          <p className="tenant-help">Creates an initial administrator and a disabled developer account with full starting tenant permissions. The new developer identity uses the selected @unesolutions.co.uk mailbox. The tenant administrator activates the developer account from Company Settings; no password is shared with platform operators.</p>
          <div className="setup-draft-footer"><span>Unsaved tenant draft</span><button type="button" className="tenant-button" disabled={busy} onClick={() => { setShowCreate(false); setCreate(emptyCreate); setCreateKey(crypto.randomUUID()); }}>Discard</button><button type="submit" className="tenant-button tenant-button-primary" disabled={!canCreateTenant}>{busy ? 'Creating…' : 'Create tenant'}</button></div>
        </form>
      </section>
    </div>}
  </div>;
}
