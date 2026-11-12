import { useEffect, useState } from 'react';
import { CircleAlert, LockOpen, Pencil, Plus, Power, RefreshCw, Search, Trash2, Users } from 'lucide-react';
import './TenantUsersPanel.css';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type TenantUser = {
  id: string; email: string; name: string; enabled: boolean; userType: 'internal' | 'external';
  locked: boolean; lastLoginAt: string | null; tenantDeveloper: boolean; licensed: boolean;
  entitlementIds: string[]; permissionSetIds: string[];
};
type Licence = { id: string; label: string; key: string; enabled: boolean; seatLimit: number | null; usedSeats: number };
type PermissionSet = { id: string; apiName: string };
type Listing = { tenantId: string; users: TenantUser[]; licences: Licence[]; permissionSets: PermissionSet[] };
type Draft = {
  email: string; name: string; password: string; enabled: boolean; userType: 'internal' | 'external';
  entitlementIds: string[]; permissionSetIds: string[];
};
const emptyDraft: Draft = { email: '', name: '', password: '', enabled: true, userType: 'internal', entitlementIds: [], permissionSetIds: [] };
const toggle = (list: string[], id: string) => list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
const when = (value: string | null) => {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString();
};

/**
 * Platform operator view of one tenant's users: list, create, edit, activate,
 * deactivate, unlock, licence and delete. Authorised server-side by OneEngine
 * in any tenant; the server rejects everyone else.
 */
export default function TenantUsersPanel({ request, permitted, tenantId }: {
  request: Request; permitted: boolean; tenantId: string;
}) {
  const base = '/platform/tenants/' + encodeURIComponent(tenantId) + '/users';
  const [data, setData] = useState<Listing | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => { const t = window.setTimeout(() => setDebounced(query.trim()), 250); return () => window.clearTimeout(t); }, [query]);
  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    setLoading(true);
    request<Listing>(base + (debounced ? '?q=' + encodeURIComponent(debounced) : '')).then((result) => {
      if (!cancelled) { setData(result); setError(''); }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load users');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [base, debounced, permitted, request, revision]);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action()); setRevision((n) => n + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'User operation failed'); }
    finally { setBusy(false); }
  };
  const patch = (user: TenantUser, body: Record<string, unknown>, message: string) =>
    run(async () => { await request(base + '/' + user.id, { method: 'PATCH', body: JSON.stringify(body) }); return message; });

  const startEdit = (user: TenantUser) => {
    setEditing(user.id); setError(''); setNotice('');
    setDraft({ email: user.email, name: user.name, password: '', enabled: user.enabled, userType: user.userType,
      entitlementIds: user.entitlementIds, permissionSetIds: user.permissionSetIds });
  };
  const startCreate = () => {
    setEditing('new'); setError(''); setNotice('');
    // Preselect the first enabled User licence so a new user can sign in straight away.
    setDraft({ ...emptyDraft, entitlementIds: (data?.licences ?? []).filter((l) => l.enabled).slice(0, 1).map((l) => l.id) });
  };
  const save = () => run(async () => {
    const body: Record<string, unknown> = {
      email: draft.email.trim(), name: draft.name.trim(), enabled: draft.enabled, userType: draft.userType,
      entitlementIds: draft.entitlementIds, permissionSetIds: draft.permissionSetIds
    };
    if (draft.password) body.password = draft.password;
    if (editing === 'new') {
      await request(base, { method: 'POST', body: JSON.stringify(body) });
      setEditing(null); setDraft(emptyDraft);
      return 'User ' + body.email + ' created.';
    }
    await request(base + '/' + editing, { method: 'PATCH', body: JSON.stringify(body) });
    setEditing(null); setDraft(emptyDraft);
    return 'User ' + body.email + ' saved.' + (draft.password ? ' Password changed; existing sessions were signed out.' : '');
  });
  const remove = (user: TenantUser) => {
    if (!window.confirm('Delete ' + user.email + ' from ' + tenantId + '?\n\nUsers with history (sign-ins, records, audit entries) '
      + 'are deactivated and their licences removed instead, so no data is lost.')) return;
    void run(async () => {
      const result = await request<{ deleted: boolean; reason: string | null }>(base + '/' + user.id, { method: 'DELETE' });
      if (editing === user.id) setEditing(null);
      return result.deleted ? user.email + ' was permanently deleted.' : (result.reason ?? user.email + ' was deactivated.');
    });
  };

  if (!permitted) return null;
  const licences = data?.licences ?? [];
  const permissionSets = data?.permissionSets ?? [];
  const users = data?.users ?? [];
  const licensedCount = users.filter((u) => u.enabled && u.licensed).length;

  const form = <div className="tenant-users-form" role="group" aria-label={editing === 'new' ? 'New user' : 'Edit user'}>
    <h4>{editing === 'new' ? 'New user' : 'Edit user'}</h4>
    <div className="tenant-users-form-grid">
      <label className="form-label">Email
        <input className="form-control" type="email" autoComplete="off" maxLength={254} value={draft.email}
          autoCapitalize="none" spellCheck={false} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
      <label className="form-label">Display name
        <input className="form-control" type="text" maxLength={200} value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="form-label">{editing === 'new' ? 'Initial password' : 'New password (leave blank to keep)'}
        <input className="form-control" type="password" autoComplete="new-password" minLength={12} maxLength={1024}
          value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
        <small className="tenant-help">At least 12 characters and the tenant's password policy.</small></label>
      <label className="form-label">User type
        <select className="form-control" value={draft.userType}
          onChange={(e) => setDraft({ ...draft, userType: e.target.value as Draft['userType'] })}>
          <option value="internal">Internal</option><option value="external">External</option>
        </select></label>
      <label className="tenant-users-check"><input type="checkbox" checked={draft.enabled}
        onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Active</label>
    </div>
    <fieldset className="tenant-users-fieldset"><legend>User licences</legend>
      {licences.length === 0 && <p className="tenant-help">This tenant has no User licences. Issue one in licence management first; without one the user cannot sign in.</p>}
      {licences.map((l) => <label key={l.id} className="tenant-users-check">
        <input type="checkbox" checked={draft.entitlementIds.includes(l.id)} disabled={!l.enabled && !draft.entitlementIds.includes(l.id)}
          onChange={() => setDraft({ ...draft, entitlementIds: toggle(draft.entitlementIds, l.id) })} />
        {l.label} <span className="tenant-help">({l.usedSeats}{l.seatLimit === null ? '' : ' / ' + l.seatLimit} seats{l.enabled ? '' : ', disabled'})</span>
      </label>)}
    </fieldset>
    <fieldset className="tenant-users-fieldset"><legend>Permission sets</legend>
      <div className="tenant-users-sets">{permissionSets.map((p) => <label key={p.id} className="tenant-users-check">
        <input type="checkbox" checked={draft.permissionSetIds.includes(p.id)}
          onChange={() => setDraft({ ...draft, permissionSetIds: toggle(draft.permissionSetIds, p.id) })} /> {p.apiName}
      </label>)}</div>
    </fieldset>
    <div className="tenant-domain-actions">
      <button type="button" className="tenant-button" disabled={busy} onClick={() => { setEditing(null); setDraft(emptyDraft); }}>Cancel</button>
      <button type="button" className="tenant-button tenant-button-primary"
        disabled={busy || !draft.email.trim() || (editing === 'new' && draft.password.length < 12) || (!!draft.password && draft.password.length < 12)}
        onClick={() => void save()}>{busy ? 'Saving…' : editing === 'new' ? 'Create user' : 'Save user'}</button>
    </div>
  </div>;

  return <section className="tenant-users" aria-label="Tenant users">
    <header className="tenant-domain-header"><div><h3><Users size={17} /> Users</h3>
      <p>{users.length} users · {users.filter((u) => u.enabled).length} active · <strong>{licensedCount} licensed</strong> (billable)</p>
    </div><div className="tenant-domain-actions">
      <button type="button" className="tenant-button" disabled={loading || busy} onClick={() => setRevision((n) => n + 1)}><RefreshCw size={14} /> Refresh</button>
      <button type="button" className="tenant-button tenant-button-primary" disabled={busy || editing !== null} onClick={startCreate}><Plus size={14} /> New user</button>
    </div></header>
    <label className="tenant-users-search"><Search size={14} />
      <input className="form-control" type="search" placeholder="Search users by email or name" value={query}
        onChange={(e) => setQuery(e.target.value)} aria-label="Search users" /></label>
    {error && <p role="alert" className="tenant-domain-error"><CircleAlert size={14} /> {error}</p>}
    {notice && <p role="status" className="tenant-domain-notice">{notice}</p>}
    {editing === 'new' && form}
    {loading && !data && <p className="tenant-help">Loading users…</p>}
    {!loading && users.length === 0 && <p className="tenant-help">No users found.</p>}
    {users.map((user) => <div className="tenant-domain-item" key={user.id}>
      <div className="tenant-domain-item-header">
        <div><strong>{user.name || user.email}</strong>{user.name && <div className="tenant-help">{user.email}</div>}</div>
        <div className="tenant-users-pills">
          <span className={user.enabled ? 'tenant-pill tenant-pill-active' : 'tenant-pill tenant-pill-suspended'}>{user.enabled ? 'Active' : 'Inactive'}</span>
          <span className={user.licensed ? 'tenant-pill tenant-pill-active' : 'tenant-pill tenant-pill-suspended'}>{user.licensed ? 'Licensed' : 'No licence'}</span>
          {user.locked && <span className="tenant-pill tenant-pill-suspended">Locked</span>}
          {user.tenantDeveloper && <span className="tenant-pill">Tenant developer</span>}
          {user.userType === 'external' && <span className="tenant-pill">External</span>}
        </div>
      </div>
      <p className="tenant-help">Last sign-in: {when(user.lastLoginAt)} · Permission sets: {permissionSets.filter((p) => user.permissionSetIds.includes(p.id)).map((p) => p.apiName).join(', ') || 'none'}</p>
      {editing === user.id ? form : <div className="tenant-domain-actions">
        <button type="button" className="tenant-button" disabled={busy || editing !== null} onClick={() => startEdit(user)}><Pencil size={14} /> Edit</button>
        <button type="button" className="tenant-button" disabled={busy}
          onClick={() => void patch(user, { enabled: !user.enabled }, user.email + (user.enabled ? ' deactivated and signed out.' : ' activated.'))}>
          <Power size={14} /> {user.enabled ? 'Deactivate' : 'Activate'}</button>
        {user.locked && <button type="button" className="tenant-button" disabled={busy}
          onClick={() => void patch(user, { unlock: true }, user.email + ' unlocked.')}><LockOpen size={14} /> Unlock</button>}
        <button type="button" className="tenant-button tenant-button-danger" disabled={busy} onClick={() => remove(user)}><Trash2 size={14} /> Delete</button>
      </div>}
    </div>)}
  </section>;
}
