import { OwnRecoveryPhone } from '../../security/AccountAssist/AccountAssist';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { ChevronDown, X, Wifi, WifiOff } from 'lucide-react';
import {useDismissOnOutside} from '../../accessibility/Dismiss/useDismissOnOutside';
import { apiRequest, apiBase } from '../Client/authClient';
import { tillPeople, lockTillScreen } from '../TillDevice/tillDevice';

export function ProfilePasswordMenu({ onLogout, onPasswordChanged }: { onLogout: () => Promise<void> | void; onPasswordChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(profileMenuRef, open, () => setOpen(false));
  const [editing, setEditing] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinPassword, setPinPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinMessage, setPinMessage] = useState('');
  const resetPin = () => { setPinPassword(''); setPin(''); setPinConfirm(''); setPinMessage(''); };
  // Till PIN: used by VERIFYPIN() in apps (till lock, manager approval, refunds).
  const savePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^[0-9]{4,8}$/.test(pin)) { setPinMessage('PIN must contain 4 to 8 digits'); return; }
    if (pin !== pinConfirm) { setPinMessage('PINs do not match'); return; }
    setBusy(true); setPinMessage('');
    try {
      await apiRequest('/me/till-pin', { method: 'POST', body: JSON.stringify({ password: pinPassword, pin }) });
      resetPin(); setPinOpen(false);
    } catch (failure) { setPinMessage(failure instanceof Error ? failure.message : 'Could not save PIN'); }
    finally { setBusy(false); }
  };
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reset = () => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setError(''); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) { setError('New passwords do not match'); return; }
    if (newPassword.length < 12) { setError('Use at least 12 characters'); return; }
    setBusy(true); setError('');
    try {
      await apiRequest('/auth/change-password', { method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }) });
      reset(); setEditing(false); setOpen(false);
      onPasswordChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not change password'); }
    finally { setBusy(false); }
  };
  return <div className="profile-menu-wrap" ref={profileMenuRef}>
    <button type="button" className="user-menu" aria-label="User profile" aria-expanded={open}
      onClick={() => setOpen((state) => !state)}>Profile <ChevronDown size={13} /></button>
    {open && <div className="profile-menu-panel">
      <button type="button" onClick={() => { setEditing(true); setOpen(false); reset(); }}>Change Password</button>
      <button type="button" onClick={() => { setPhoneOpen(true); setOpen(false); }}>Recovery Mobile</button>
      <button type="button" onClick={() => { resetPin(); setPinOpen(true); setOpen(false); }}>Till PIN</button>
      {tillPeople().length>0&&<button type="button" onClick={() => { setOpen(false); lockTillScreen(); }}>Lock till</button>}
      <button type="button" onClick={() => void onLogout()}>Sign Out</button>
    </div>}
    {phoneOpen && <div className="profile-password-backdrop" role="presentation">
      <section className="profile-password-dialog" role="dialog" aria-modal="true" aria-label="Recovery mobile">
        <div className="profile-password-heading"><h2>Recovery Mobile</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => setPhoneOpen(false)}><X size={18} /></button></div>
        <OwnRecoveryPhone />
      </section>
    </div>}
    {pinOpen && <div className="profile-password-backdrop" role="presentation">
      <section className="profile-password-dialog" role="dialog" aria-modal="true" aria-labelledby="till-pin-heading">
        <div className="profile-password-heading"><h2 id="till-pin-heading">Till PIN</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => { setPinOpen(false); resetPin(); }}><X size={18} /></button></div>
        <form onSubmit={(event) => void savePin(event)}>
          <label className="form-label">Current Password<input autoComplete="current-password" className="form-control" type="password" required value={pinPassword} onChange={(event) => setPinPassword(event.target.value)} /></label>
          <label className="form-label">New PIN (4 to 8 digits)<input autoComplete="off" className="form-control" type="password" inputMode="numeric" pattern="[0-9]{4,8}" required value={pin} onChange={(event) => setPin(event.target.value)} /></label>
          <label className="form-label">Confirm PIN<input autoComplete="off" className="form-control" type="password" inputMode="numeric" pattern="[0-9]{4,8}" required value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value)} /></label>
          <p className="settings-panel-copy">Used to unlock a till and to approve refunds or cleared sales.</p>
          {pinMessage && <p role="alert" className="form-error">{pinMessage}</p>}
          <div className="toolbar-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => { setPinOpen(false); resetPin(); }}>Cancel</button>
            <button type="submit" className="btn btn-brand" disabled={busy}>{busy ? 'Saving…' : 'Save PIN'}</button>
          </div>
        </form>
      </section>
    </div>}
    {editing && <div className="profile-password-backdrop" role="presentation">
      <section className="profile-password-dialog" role="dialog" aria-modal="true" aria-labelledby="change-password-heading">
        <div className="profile-password-heading"><h2 id="change-password-heading">Change Password</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => { setEditing(false); reset(); }}><X size={18} /></button></div>
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-label">Current Password<input autoComplete="current-password" className="form-control" type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="form-label">New Password<input autoComplete="new-password" className="form-control" type="password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label className="form-label">Confirm New Password<input autoComplete="new-password" className="form-control" type="password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <p className="settings-panel-copy">After changing your password, all sessions will be signed out.</p>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="toolbar-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => { setEditing(false); reset(); }}>Cancel</button>
            <button type="submit" className="btn btn-brand" disabled={busy}>{busy ? 'Updating…' : 'Change Password'}</button>
          </div>
        </form>
      </section>
    </div>}
  </div>;
}

export function ConnectionHealthIndicator() {
  const [health, setHealth] = useState<{ status: 'checking' | 'healthy' | 'slow' | 'offline'; database: string; latency: number | null; checked: string }>({ status: 'checking', database: 'checking', latency: null, checked: '' });
  const [expanded, setExpanded] = useState(false);
  const healthRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(healthRef, expanded, () => setExpanded(false));
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const started = performance.now();
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(`${apiBase.replace(/\/$/, '')}/health`, { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' });
          const latency = Math.round(performance.now() - started);
          const result = response.ok ? await response.json() as { status?: string; persistence?: string; database?: string } : null;
          // /health exposes status and persistence; older API versions may expose database.
          const database = result?.database ?? (result?.status === 'ok' && result.persistence === 'sql' ? 'healthy' : 'unknown');
          const healthy = response.ok && (result?.status === 'ok' || result?.database === 'healthy') && database === 'healthy';
          if (alive) setHealth({
            status: !healthy ? 'offline' : latency > 2500 ? 'slow' : 'healthy',
            database, latency, checked: new Date().toLocaleTimeString()
          });
        } finally { window.clearTimeout(timeout); }
      } catch {
        if (alive) setHealth({ status: 'offline', database: 'unknown (health check failed)', latency: null, checked: new Date().toLocaleTimeString() });
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 30000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);
  return <div className="connection-health-wrap" ref={healthRef}>
    <button type="button" className={`icon-button connection-health-${health.status}`} onClick={() => setExpanded((value) => !value)}
      aria-label={`API connection: ${health.status}`} aria-expanded={expanded} title={`API connection: ${health.status}`}>
      {health.status === 'offline' ? <WifiOff size={18} /> : <Wifi size={18} />}
    </button>
    {expanded && <div className="connection-health-popover" role="status">
      <strong>Connection health</strong>
      <p>API: {health.status}</p>
      <p>Response: {health.latency === null ? 'Unavailable' : `${health.latency} ms`}</p>
      <p>Checked: {health.checked || 'Checking…'}</p>
      <p>Database: {health.database}</p>
    </div>}
  </div>;
}

