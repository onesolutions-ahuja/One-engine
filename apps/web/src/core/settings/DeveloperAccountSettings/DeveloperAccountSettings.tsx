import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, UserRoundCog } from 'lucide-react';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type DeveloperStatus = {
  seeded: boolean; userId?: string; email?: string; active?: boolean;
  activated?: boolean; initialPermissions?: string; tenantControlled?: boolean;
};

/** Shown inside the tenant's own Company Settings, never the platform console. */
export default function DeveloperAccountSettings({
  request, permitted
}: { request: Request; permitted: boolean }) {
  const [status, setStatus] = useState<DeveloperStatus | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!permitted) return;
    let live = true;
    request<DeveloperStatus>('/tenant/developer-account')
      .then((value) => { if (live) setStatus(value); })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Unable to load developer account'); });
    return () => { live = false; };
  }, [request, permitted]);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!status?.seeded || status.activated || busy || !permitted) return;
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    if (password.length < 12) { setError('The password must contain at least 12 characters.'); return; }
    setError(''); setNotice(''); setBusy(true);
    try {
      await request<{ activated: boolean }>('/tenant/developer-account/activate', {
        method: 'POST', body: JSON.stringify({ password, mfaCode })
      });
      setPassword(''); setConfirm(''); setMfaCode(''); setActivating(false);
      setStatus((current) => current ? { ...current, active: true, activated: true } : current);
      setNotice('Developer account activated. Manage its permissions in Users and RBAC.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to activate developer');
    } finally { setBusy(false); }
  };

  if (!permitted) return null;
  return <section aria-label="Developer account" className="surface permission-section" style={{ maxWidth: 800, margin: '18px 0' }}>
    <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0, fontSize: 19 }}>
      <UserRoundCog size={21} /> Developer account
    </h2>
    <p style={{ color: 'var(--text-secondary, #586666)', lineHeight: 1.5 }}>
      Each newly provisioned tenant receives a developer seeder with initial System Administrator permissions.
      It is disabled until a tenant security administrator activates it. There is no platform password or permanent privileged override.
    </p>
    {error && <p role="alert" style={{ color: '#a52b36' }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!status && !error && <p>Checking developer account…</p>}
    {status && !status.seeded && <p>Legacy tenant: no developer seeder was created during provisioning.</p>}
    {status?.seeded && <>
      <p><ShieldCheck size={16} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }} />
        <strong>{status.email}</strong> — {status.activated
          ? status.active ? 'Active' : 'Inactive (controlled by tenant Users)'
          : 'Not yet activated'}
      </p>
      {status.activated
        ? <p>Activation is complete. Future password, role, permission, and account-state changes use the normal tenant User and RBAC controls.</p>
        : <>
          {!activating && <button type="button" className="btn" onClick={() => setActivating(true)}>Activate developer account</button>}
          {activating && <form className="settings-edit-row" onSubmit={(event) => void activate(event)} style={{ display: 'grid', gap: 11, maxWidth: 480 }}>
          <label className="form-label">New developer password
            <input type="password" required minLength={12} maxLength={256} autoComplete="new-password"
              value={password} onChange={(event) => setPassword(event.target.value)}
              className="form-control" />
          </label>
          <label className="form-label">Confirm new password
            <input type="password" required minLength={12} maxLength={256} autoComplete="new-password"
              value={confirm} onChange={(event) => setConfirm(event.target.value)}
              className="form-control" />
          </label>
          <label className="form-label">Fresh authenticator code
            <input className="form-control" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} pattern="[0-9]{6}" required value={mfaCode}
              onChange={event => setMfaCode(event.target.value.replace(/[^0-9]/g, ''))}/>
          </label>
          <button type="submit" disabled={busy || !password || password !== confirm || mfaCode.length !== 6}
            className="btn btn-brand">
            {busy ? 'Activating…' : 'Activate developer account'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => {
            setActivating(false); setPassword(''); setConfirm(''); setMfaCode(''); setError('');
          }}>Cancel</button>
        </form>}
        </>}
    </>}
  </section>;
}
