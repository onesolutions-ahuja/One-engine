import {useEffect, useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';

type LinkResult = {resetUrl: string; email: string; expiresAt: string; validMinutes: number};
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Reason + "requested by the user" are mandatory: both are written to the tenant's Audit Trail. */
function AssistFields({reason, setReason, requested, setRequested}: {
  reason: string; setReason: (v: string) => void; requested: boolean | null; setRequested: (v: boolean) => void;
}) {
  return <>
    <label className="form-label">Reason (recorded in the audit trail)
      <textarea className="form-control" rows={2} maxLength={500} value={reason}
        placeholder="e.g. User called support from their registered number and cannot sign in"
        onChange={e => setReason(e.target.value)} /></label>
    <fieldset className="account-assist-requested">
      <legend className="form-label">Did the user ask for this?</legend>
      <label className="checkbox-row"><input type="radio" name="assist-requested" checked={requested === true}
        onChange={() => setRequested(true)} /> Yes, at the user's request</label>
      <label className="checkbox-row"><input type="radio" name="assist-requested" checked={requested === false}
        onChange={() => setRequested(false)} /> No, admin decision</label>
    </fieldset>
  </>;
}
const ready = (reason: string, requested: boolean | null) => reason.trim().length >= 10 && requested !== null;

function ResetLinkResult({result}: {result: LinkResult}) {
  const [copied, setCopied] = useState(false);
  return <div className="account-assist-result" role="status">
    <p><strong>One-time set-password link for {result.email}</strong> — valid {result.validMinutes} minutes
      (until {new Date(result.expiresAt).toLocaleTimeString()}). It is shown only once and is not stored.</p>
    <input className="form-control" readOnly value={result.resetUrl} onFocus={e => e.currentTarget.select()} />
    <button className="btn" type="button" onClick={() => void navigator.clipboard?.writeText(result.resetUrl)
      .then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</button>
    <p>Give it to the user over a channel only they can see (for example a call to their known number).
      Using it signs out all their sessions; MFA still applies at their next sign-in.</p>
  </div>;
}

/** Tenant admin: recovery mobile + password-reset link for a selected user. */
export function AdminUserAccountAssist({userId, userLabel}: {userId: string; userLabel: string}) {
  const [phone, setPhone] = useState(''), [reason, setReason] = useState('');
  const [requested, setRequested] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [link, setLink] = useState<LinkResult | null>(null);
  useEffect(() => {setLink(null); setMessage(''); setError(''); setReason(''); setRequested(null); setPhone('');}, [userId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try {await fn();} catch (e) {setError(e instanceof Error ? e.message : 'Request failed');} finally {setBusy(false);}
  };
  const body = (extra: Record<string, unknown>) => JSON.stringify({reason: reason.trim(), requestedByUser: requested, ...extra});
  return <section className="account-assist" aria-label={'Account recovery for ' + userLabel}>
    <h3>Account recovery</h3>
    <AssistFields reason={reason} setReason={setReason} requested={requested} setRequested={setRequested} />
    <label className="form-label">Recovery mobile (for SMS / WhatsApp codes)
      <input className="form-control" inputMode="tel" placeholder="+447700900123" value={phone}
        onChange={e => setPhone(e.target.value)} /></label>
    <div className="account-assist-actions">
      <button className="btn" type="button" disabled={busy || !ready(reason, requested) || !phone.trim()}
        onClick={() => void run(async () => {
          const r = await apiRequest<{phone: string}>('/records/User/' + userId + '/recovery-phone',
            {method: 'PUT', body: body({phone: phone.trim()})});
          setMessage('Recovery mobile saved: ' + r.phone); setPhone('');
        })}>Save recovery mobile</button>
      <button className="btn" type="button" disabled={busy || !ready(reason, requested)}
        onClick={() => void run(async () => {
          await apiRequest('/records/User/' + userId + '/recovery-phone', {method: 'PUT', body: body({phone: null})});
          setMessage('Recovery mobile removed');
        })}>Remove mobile</button>
      <button className="btn btn-brand" type="button" disabled={busy || !ready(reason, requested)}
        onClick={() => void run(async () => {
          setLink(await apiRequest<LinkResult>('/records/User/' + userId + '/password-reset-link',
            {method: 'POST', body: body({})}));
        })}>Create password reset link</button>
    </div>
    {message && <p className="form-success" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {link && <ResetLinkResult result={link} />}
  </section>;
}

/** Platform support (OneEngine): reset link for any tenant user, recorded in both audit trails. */
export function PlatformPasswordResetPanel({request, tenantId}: {request: Request; tenantId: string}) {
  const [email, setEmail] = useState(''), [reason, setReason] = useState('');
  const [requested, setRequested] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [link, setLink] = useState<LinkResult | null>(null);
  return <section className="account-assist" aria-label="Tenant user password reset">
    <h3>Reset a user's password</h3>
    <p>Creates a one-time set-password link. The tenant sees who issued it, when and why in its Audit Trail.</p>
    <label className="form-label">User email<input className="form-control" type="email" value={email}
      onChange={e => setEmail(e.target.value)} /></label>
    <AssistFields reason={reason} setReason={setReason} requested={requested} setRequested={setRequested} />
    <button className="btn btn-brand" type="button" disabled={busy || !email.trim() || !ready(reason, requested)}
      onClick={() => {
        setBusy(true); setError(''); setLink(null);
        void request<LinkResult>('/platform/tenants/' + encodeURIComponent(tenantId) + '/password-reset-link', {
          method: 'POST', body: JSON.stringify({email: email.trim(), reason: reason.trim(), requestedByUser: requested})})
          .then(setLink).catch(e => setError(e instanceof Error ? e.message : 'Request failed')).finally(() => setBusy(false));
      }}>Create password reset link</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {link && <ResetLinkResult result={link} />}
  </section>;
}

/** Signed-in user: set their own recovery mobile (re-enter password). */
export function OwnRecoveryPhone() {
  const [current, setCurrent] = useState<string | null>(null), [phone, setPhone] = useState('');
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => {void apiRequest<{phone: string | null}>('/auth/recovery-phone').then(r => setCurrent(r.phone)).catch(() => undefined);}, []);
  const save = (value: string | null) => {
    setBusy(true); setError(''); setMessage('');
    void apiRequest<{phone: string | null}>('/auth/recovery-phone', {method: 'PUT',
      body: JSON.stringify({phone: value, currentPassword: password})})
      .then(r => {setCurrent(r.phone); setPhone(''); setPassword(''); setMessage(value ? 'Recovery mobile saved' : 'Recovery mobile removed');})
      .catch(e => setError(e instanceof Error ? e.message : 'Request failed')).finally(() => setBusy(false));
  };
  return <section className="account-assist" aria-label="Recovery mobile">
    <h3>Recovery mobile</h3>
    <p>Used for password reset codes by SMS or WhatsApp. Current: {current ?? 'not set'}</p>
    <label className="form-label">Mobile number<input className="form-control" inputMode="tel" placeholder="+447700900123"
      value={phone} onChange={e => setPhone(e.target.value)} /></label>
    <label className="form-label">Current password<input className="form-control" type="password" autoComplete="current-password"
      value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className="btn btn-brand" type="button" disabled={busy || !phone.trim() || !password} onClick={() => save(phone.trim())}>Save</button>
    {current && <button className="btn" type="button" disabled={busy || !password} onClick={() => save(null)}>Remove</button>}
    {message && <p className="form-success" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
