import TenantGovernance from './TenantGovernance';
import {useViewportWidth} from '../../workspace/Responsive/useViewportWidth';
import {refreshTenantBrand} from '../../branding/tenantBrandLoader';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Save, Trash2, Plus } from 'lucide-react';
import {confirmDestructiveAction} from '../../components/ConfirmAction/confirmDestructiveAction';
import SettingsViewRow from '../SettingsViewRow/SettingsViewRow';
import TenantPasswordPolicy from './TenantPasswordPolicy';
import TenantMfaControls from './TenantMfaControls';
import TenantSessionControls from './TenantSessionControls';
import TenantFederationControls from './TenantFederationControls';
import {PlatformPageSlot} from '../../platform/Workspace/PlatformPageSlot';
import type { CurrencySettingsMetadata } from '../../metadata/Definitions/metadata';

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
type PageHeadingProps = { eyebrow?: string; title: string; description?: string; actions?: ReactNode };
export function createSettingsViews(apiRequest: ApiRequest, PageHeading: (props: PageHeadingProps) => ReactNode) {
type AutomationSettingsDraft = {
  autoRetryFailedFlows: boolean;
  maxRetryAttempts: number;
  conversationIdleMinutes: number;
  flowServiceUserId: string | null;
};

function AutomationSettingsWorkspace({ canManage }: { canManage: boolean }) {
  const [draft, setDraft] = useState<AutomationSettingsDraft>({
    autoRetryFailedFlows: false, maxRetryAttempts: 10, conversationIdleMinutes: 15,
    flowServiceUserId: null
  });
  const [serviceUsers,setServiceUsers]=useState<Array<{id:string;name:string;email:string;enabled:boolean}>>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const beforeEdit = useRef<AutomationSettingsDraft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const settings=apiRequest<AutomationSettingsDraft>('/metadata/automation-settings');
    const users=canManage
      ?apiRequest<{users:Array<{id:string;name:string;email:string;enabled:boolean}>}>('/metadata/automation-service-users')
      :Promise.resolve({users:[]});
    void Promise.all([settings,users])
      .then(([result,userResult]) => { if (active) { setDraft(result); setServiceUsers(userResult.users); setLoaded(true); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManage]);

  const startEdit = (field: string) => {
    if (!canManage || editingRow || loading) return;
    beforeEdit.current = { ...draft };
    setEditingRow(field);
    setNotice('');
    setError('');
  };
  const cancelEdit = () => {
    if (saving) return;
    if (beforeEdit.current) setDraft(beforeEdit.current);
    beforeEdit.current = null;
    setEditingRow(null);
    setError('');
  };
  const save = async () => {
    if (!canManage || !editingRow || saving) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const result = await apiRequest<AutomationSettingsDraft>('/metadata/automation-settings', {
        method: 'PUT', body: JSON.stringify(draft)
      });
      setDraft(result);
      setEditingRow(null);
      beforeEdit.current = null;
      setNotice('Process automation settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const editable = (key: string) => canManage && !editingRow && !loading;
  const serviceUser=serviceUsers.find(user=>user.id===draft.flowServiceUserId);
  return <div className="connector-settings-page settings-read-first-page">
    <PageHeading eyebrow="Setup / Automation" title="Process Automation Settings"
      description="Review automation execution policies and the explicitly selected identity used for scheduled Flow triggers." />
    <section className="surface permission-section" style={{ maxWidth: 800 }}>
      {loading ? <p>Loading process automation settings…</p> : loaded ? <>
        <h2>Execution safety</h2>
        <div className="settings-read-first-section">
          {editingRow==='flowServiceUserId'
            ?<div className="settings-edit-row">
              <PlatformPageSlot slotKey="field-settings-04"><label className="form-label">Scheduled Flow service user
                <select className="form-control" value={draft.flowServiceUserId??''} onChange={event=>
                  setDraft(current=>({...current,flowServiceUserId:event.target.value||null}))}>
                  <option value="">Not configured (scheduled triggers remain disabled)</option>
                  {serviceUsers.map(user=><option key={user.id} value={user.id}>
                    {user.name} ({user.email}){user.enabled?'':' — disabled'}
                  </option>)}
                </select>
              </label></PlatformPageSlot>
            </div>
            :<SettingsViewRow label="Scheduled Flow service user"
              value={serviceUser?`${serviceUser.name} (${serviceUser.email})`
                :draft.flowServiceUserId??'Not configured'}
              canEdit={editable('flowServiceUserId')} onEdit={()=>startEdit('flowServiceUserId')} />}
          <p className="permission-help">No user is implicitly elevated. Tenant, Flow activation, app entitlement, and current OneEngine grants must still pass on every execution.</p>
          {editingRow === 'autoRetryFailedFlows'
            ? <div className="settings-edit-row">
                <PlatformPageSlot slotKey="field-settings-01"><label className="checkbox-row">
                  <input type="checkbox" checked={draft.autoRetryFailedFlows}
                    onChange={(event) => setDraft((current) => ({ ...current, autoRetryFailedFlows: event.target.checked }))} />
                  Automatically retry failed flow executions
                </label></PlatformPageSlot>
              </div>
            : <SettingsViewRow label="Automatically retry failed flow executions"
                value={draft.autoRetryFailedFlows ? 'On' : 'Off'}
                canEdit={editable('autoRetryFailedFlows')} onEdit={() => startEdit('autoRetryFailedFlows')} />}
          <p className="permission-help">Off by default. Disabled retries are logged; new scheduled occurrences can still run.</p>
          {editingRow === 'maxRetryAttempts'
            ? <div className="settings-edit-row">
                <PlatformPageSlot slotKey="field-settings-02"><label className="form-label">Maximum failed attempts
                  <input className="form-control" type="number" min="1" max="20" step="1"
                    value={draft.maxRetryAttempts} onChange={(event) =>
                      setDraft((current) => ({ ...current, maxRetryAttempts: Number(event.target.value) }))} />
                </label></PlatformPageSlot>
              </div>
            : <SettingsViewRow label="Maximum failed attempts" value={String(draft.maxRetryAttempts)}
                canEdit={editable('maxRetryAttempts')} onEdit={() => startEdit('maxRetryAttempts')} />}
          <p className="permission-help">Default: 10. Exhausted deliveries are recorded as failed or dead-lettered.</p>
        </div>
        <h2>Conversation inactivity</h2>
        <div className="settings-read-first-section">
          {editingRow === 'conversationIdleMinutes'
            ? <div className="settings-edit-row">
                <PlatformPageSlot slotKey="field-settings-03"><label className="form-label">Expire inactive conversations after (minutes)
                  <input className="form-control" type="number" min="1" max="1440" step="1"
                    value={draft.conversationIdleMinutes} onChange={(event) =>
                      setDraft((current) => ({ ...current, conversationIdleMinutes: Number(event.target.value) }))} />
                </label></PlatformPageSlot>
              </div>
            : <SettingsViewRow label="Conversation idle timeout"
                value={`${draft.conversationIdleMinutes} minutes`}
                canEdit={editable('conversationIdleMinutes')} onEdit={() => startEdit('conversationIdleMinutes')} />}
          <p className="permission-help">Default: 15 minutes. Existing message records are retained after inactivity.</p>
        </div>
        {editingRow && canManage && <div className="settings-read-first-toolbar">
          <button className="btn" type="button" disabled={saving} onClick={cancelEdit}>Cancel</button>
          <button className="btn btn-brand" type="button" onClick={() => void save()}
            disabled={saving || !Number.isInteger(draft.maxRetryAttempts) || draft.maxRetryAttempts < 1 || draft.maxRetryAttempts > 20
              || !Number.isInteger(draft.conversationIdleMinutes) || draft.conversationIdleMinutes < 1 || draft.conversationIdleMinutes > 1440}>
            <Save size={14} />{saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>}
      </> : null}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
    </section>
  </div>;
}

type TenantMfaMode = 'Off' | 'Optional' | 'Required';

type RecoveryChannel='sms'|'whatsapp';
type RecoveryAction={channel:RecoveryChannel;enabled:boolean;flowServiceUserId:string|null;
 credentialId:string|null;calloutPath:string;calloutBody:string;messageTemplate:string};
type RecoveryFlow={method:'OTP'|'LINK';otpLength:4|6;expiryMinutes:number;maxAttempts:number;
 emailSubject:string;emailTemplate:string;channels:Record<RecoveryChannel,RecoveryAction>};
type RecoverySettings={flow:RecoveryFlow;revision:number;fromEmail:string;deliveryReady:boolean;linkReady:boolean};
function TenantEmailRecoverySettings({canManage}:{canManage:boolean}){
 const [flow,setFlow]=useState<RecoveryFlow|null>(null);
 const [revision,setRevision]=useState(0),[deliveryReady,setDeliveryReady]=useState(false);
 const [linkReady,setLinkReady]=useState(false),[fromEmail,setFromEmail]=useState('');
 const [credentials,setCredentials]=useState<Array<{id:string;name:string;protocol:string;enabled:boolean}>>([]);
 const [serviceUsers,setServiceUsers]=useState<Array<{id:string;email:string;enabled:boolean}>>([]);
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [recoverySection,setRecoverySection]=useState<'otp'|'email'|'whatsapp'|'sms'>('otp');
 const recoveryEditorRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
   if(!editing)return;
   const activeGroup=recoveryEditorRef.current?.querySelector<HTMLElement>('details[open] > summary');
   activeGroup?.scrollIntoView({block:'start',behavior:'auto'});
 },[editing,recoverySection]);
 const snapshot=useRef<RecoveryFlow|null>(null);
 useEffect(()=>{
  let active=true;
  void apiRequest<RecoverySettings>('/auth/password-recovery/settings')
   .then(r=>{if(active){setFlow(r.flow);setRevision(r.revision);setDeliveryReady(r.deliveryReady);
    setLinkReady(r.linkReady);setFromEmail(r.fromEmail);}}).catch(()=>{});
  void apiRequest<{credentials:typeof credentials}>('/named-credentials')
   .then(r=>{if(active)setCredentials(r.credentials.filter(item=>item.protocol==='HTTPS'&&item.enabled));}).catch(()=>{});
  void apiRequest<{users:typeof serviceUsers}>('/metadata/automation-service-users')
   .then(r=>{if(active)setServiceUsers(r.users.filter(user=>user.enabled));}).catch(()=>{});
  return()=>{active=false;};
 },[]);
 if(!flow)return null;
 const recoveryDirty=editing&&snapshot.current!==null&&JSON.stringify(flow)!==JSON.stringify(snapshot.current);
 const recoveryReady=(['whatsapp','sms'] as const).every(channel=>!flow.channels[channel].enabled
  ||Boolean(flow.channels[channel].flowServiceUserId&&flow.channels[channel].credentialId
   &&flow.channels[channel].messageTemplate.trim()&&flow.channels[channel].calloutPath.startsWith('/')));
 const change=(patch:Partial<RecoveryFlow>)=>setFlow(value=>value?{...value,...patch}:value);
 const changeChannel=(channel:RecoveryChannel,patch:Partial<RecoveryAction>)=>
  setFlow(value=>value?{...value,channels:{...value.channels,
   [channel]:{...value.channels[channel],...patch}}}:value);
 const begin=(section:'otp'|'email'|'whatsapp'|'sms')=>{if(canManage&&!busy){setRecoverySection(section);snapshot.current=JSON.parse(JSON.stringify(flow)) as RecoveryFlow;
  setEditing(true);setMessage('');}};
 const cancel=()=>{if(busy)return;if(snapshot.current)setFlow(snapshot.current);
  snapshot.current=null;setEditing(false);setMessage('');};
 const save=async()=>{
  if(!canManage||!editing||busy||!recoveryDirty||!recoveryReady)return;
  setBusy(true);setMessage('');
  try{const result=await apiRequest<RecoverySettings>('/auth/password-recovery/settings',{
   method:'PUT',body:JSON.stringify({flow,revision})
  });setFlow(result.flow);setRevision(result.revision);setEditing(false);snapshot.current=null;
   setMessage('Password recovery Flow saved.');
  }catch(error){setMessage(error instanceof Error?error.message:'Unable to save recovery Flow');}
  finally{setBusy(false);}
 };
 return <section className="surface permission-section">
  <TenantPasswordPolicy request={apiRequest} canManage={canManage}/>
  <h2>Password Recovery Flow</h2>
  <p>Recovery button → Find tenant user → Generate OTP → Email / WhatsApp / SMS action → Verify → Reset password.</p>
  <p>Security-critical verification is enforced by Core; templates and HTTP Callout actions are editable here without code.</p>
  {!deliveryReady&&<p role="alert" className="permission-help">Platform recovery email is not configured.</p>}
  {flow.method==='LINK'&&!linkReady&&<p role="alert">Configure a trusted HTTPS reset link origin.</p>}
  {editing?<div ref={recoveryEditorRef} className="settings-read-first-section md-recovery-editor">
   <p className="permission-help">Open only the section you need to edit. Changes are saved together when you choose Save Flow.</p>
   <details className="md-recovery-config-group" open={recoverySection==='otp'}>
    <summary>Generate OTP and verification limits</summary>
   <label className="form-label">Recovery method<select className="form-control" value={flow.method}
    onChange={event=>change({method:event.target.value as 'OTP'|'LINK'})}>
    <option value="OTP">Numeric code</option><option value="LINK">Email reset link (legacy)</option>
   </select></label>
   <label className="form-label">Code length<select className="form-control" value={flow.otpLength}
    onChange={event=>{const length=Number(event.target.value) as 4|6;
     change({otpLength:length,expiryMinutes:length===4?5:10,maxAttempts:length===4?3:5});}}>
    <option value={6}>6 digits (recommended)</option><option value={4}>4 digits</option>
   </select></label>
   <label className="form-label">Expiry (minutes)<input className="form-control" type="number"
    min={5} max={flow.otpLength===4?5:15} value={flow.expiryMinutes}
    onChange={event=>change({expiryMinutes:Number(event.target.value)})}/></label>
   <label className="form-label">Maximum attempts<input className="form-control" type="number"
    min={3} max={flow.otpLength===4?3:5} value={flow.maxAttempts}
    onChange={event=>change({maxAttempts:Number(event.target.value)})}/></label>
   </details>
   <details className="md-recovery-config-group" open={recoverySection==='email'}>
    <summary>Email delivery template</summary>
   <p>Sender: {fromEmail||'noreply@unesolutions.co.uk (configure platform mail transport)'}</p>
   <label className="form-label">Subject template<input className="form-control"
    value={flow.emailSubject} onChange={event=>change({emailSubject:event.target.value})}/></label>
   <label className="form-label">Email template<textarea className="form-control" rows={4}
    value={flow.emailTemplate} onChange={event=>change({emailTemplate:event.target.value})}/></label>
   </details>
   {(['whatsapp','sms'] as const).map(channel=>{
    const action=flow.channels[channel];
    return <details key={channel} className="settings-read-first-section md-recovery-config-group" open={recoverySection===channel}>
     <summary>{channel==='whatsapp'?'WhatsApp':'SMS'} HTTP Callout</summary>
     <label className="checkbox-row"><input type="checkbox" checked={action.enabled}
      disabled={flow.method==='LINK'}
      onChange={event=>changeChannel(channel,{enabled:event.target.checked})}/>
      Enable {channel==='whatsapp'?'WhatsApp':'SMS'} recovery</label>
     <label className="form-label">Service user
      <select className="form-control" value={action.flowServiceUserId??''}
       onChange={event=>changeChannel(channel,{flowServiceUserId:event.target.value||null})}>
       <option value="">Select later</option>
       {serviceUsers.map(user=><option key={user.id} value={user.id}>{user.email}</option>)}
      </select></label>
     <label className="form-label">HTTPS Named Credential
      <select className="form-control" value={action.credentialId??''}
       onChange={event=>changeChannel(channel,{credentialId:event.target.value||null})}>
       <option value="">Select later</option>
       {credentials.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
     <label className="form-label">Message template<textarea className="form-control" rows={3}
      value={action.messageTemplate}
      onChange={event=>changeChannel(channel,{messageTemplate:event.target.value})}/></label>
     <details><summary>HTTP Callout mapping (advanced)</summary>
      <label className="form-label">Relative endpoint<input className="form-control"
       value={action.calloutPath}
       onChange={event=>changeChannel(channel,{calloutPath:event.target.value})}/></label>
      <label className="form-label">JSON request template<textarea className="form-control" rows={5}
       value={action.calloutBody}
       onChange={event=>changeChannel(channel,{calloutBody:event.target.value})}/></label>
     </details>
     <p>Requires verified account phone, authorised service user and configured Named Credential.</p>
    </details>;
   })}
  </div>:<div className="settings-read-first-section">
   <SettingsViewRow label="Flow revision" value={String(revision)} canEdit={false} onEdit={()=>undefined}/>
   <SettingsViewRow label="OTP length" value={flow.otpLength+' digits'} canEdit={canManage} onEdit={()=>begin('otp')}/>
   <SettingsViewRow label="Expiry" value={flow.expiryMinutes+' minutes'} canEdit={canManage} onEdit={()=>begin('otp')}/>
   <SettingsViewRow label="Platform email" value={deliveryReady?'Configured':'Not configured'} canEdit={canManage} onEdit={()=>begin('email')}/>
   <SettingsViewRow label="WhatsApp HTTP Callout" value={flow.channels.whatsapp.enabled?'Enabled':'Not configured'} canEdit={canManage} onEdit={()=>begin('whatsapp')}/>
   <SettingsViewRow label="SMSGate HTTP Callout" value={flow.channels.sms.enabled?'Enabled':'Not configured'} canEdit={canManage} onEdit={()=>begin('sms')}/>
  </div>}
  {editing&&canManage&&<div className="settings-read-first-toolbar md-recovery-save-bar">
   <span>{recoveryDirty?'Unsaved recovery Flow changes':'No unsaved changes'}</span>
   <button className="btn" type="button" disabled={busy} onClick={cancel}>Cancel</button>
   <button className="btn btn-brand" type="button" disabled={busy||!recoveryDirty||!recoveryReady} onClick={()=>void save()}>
    <Save size={14}/>{busy?'Saving…':'Save Flow'}
   </button>
  </div>}
  {editing&&!recoveryReady&&<p role="alert" className="form-error">For each enabled WhatsApp or SMS channel, select a service user and Named Credential and supply a message and relative endpoint before saving.</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}

function TenantUserLockSettings() {
  return null;
}

function AccountSessionSecurity({ onReauthenticate }: { onReauthenticate: () => void }) {
  const [sessions, setSessions] = useState<Array<{ familyId: string; expiresAt: number; mfaVerified: boolean }>>([]);
  const [password, setPassword] = useState('');
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void apiRequest<{ sessions: Array<{ familyId: string; expiresAt: number; mfaVerified: boolean }> }>('/auth/sessions')
      .then((response) => { if (active) setSessions(response.sessions); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, []);
  const revokeAll = async () => {
    setBusy(true); setError('');
    try {
      await apiRequest('/auth/sessions/revoke-all', {
        method: 'POST', body: JSON.stringify({ currentPassword: password })
      });
      setPassword(''); setConfirmingRevoke(false);
      onReauthenticate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke sessions');
    } finally { setBusy(false); }
  };
  return <section className="surface permission-section">
    <h2>Active sessions</h2>
    <p>Active refresh sessions for your account. Revoking all sessions immediately invalidates existing access tokens on every device.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <p>{sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}</p>
    {sessions.length > 0 && <ul>{sessions.slice(0, 10).map((session) =>
      <li key={session.familyId}>Expires {new Date(session.expiresAt * 1000).toLocaleString()}
        {session.mfaVerified ? ' · MFA verified' : ''}</li>
    )}</ul>}
    {!confirmingRevoke && <button type="button" className="btn"
      onClick={() => setConfirmingRevoke(true)}>Sign out on all devices</button>}
    {confirmingRevoke && <div className="settings-edit-row">
      <PlatformPageSlot slotKey="field-settings-09"><label className="form-label" htmlFor="sessions-revoke-password">Confirm current password
        <input className="form-control" id="sessions-revoke-password" type="password"
          autoComplete="current-password" value={password}
          onChange={(event) => setPassword(event.target.value)} />
      </label></PlatformPageSlot>
      <div className="settings-read-first-toolbar">
        <button type="button" className="btn" disabled={busy}
          onClick={() => { setPassword(''); setConfirmingRevoke(false); }}>Cancel</button>
        <button type="button" className="btn btn-brand" disabled={busy || !password}
          onClick={() => void revokeAll()}>{busy ? 'Revoking…' : 'Confirm sign out on all devices'}</button>
      </div>
    </div>}
  </section>;
}

type SecurityEvent={id:string;at:string;actorUserId:string|null;action:string;loginIdentifier?:string;sourceIp?:string;details?:Record<string,string>};
type SecurityEventFilters={action:string;identifier:string;ip:string;from:string;to:string};
const emptySecurityEventFilters=():SecurityEventFilters=>({action:'',identifier:'',ip:'',from:'',to:''});
function TenantSecurityAudit() {
 const viewportWidth=useViewportWidth();
 const pageSize=viewportWidth>0&&viewportWidth<=600?10:25;
 const [events,setEvents]=useState<SecurityEvent[]>([]);
 const [draft,setDraft]=useState<SecurityEventFilters>(emptySecurityEventFilters);
 const [filters,setFilters]=useState<SecurityEventFilters>(emptySecurityEventFilters);
 const [page,setPage]=useState(0);
 useEffect(()=>setPage(0),[pageSize]);
 const [hasNext,setHasNext]=useState(false);
 const [permitted,setPermitted]=useState(false);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [filterError,setFilterError]=useState('');
 useEffect(()=>{
  let active=true;
  setBusy(true);
  const query=new URLSearchParams({limit:String(pageSize),offset:String(page*pageSize)});
  for(const [key,value] of Object.entries(filters))if(value.trim())query.set(key,value.trim());
  void apiRequest<{events:SecurityEvent[];nextOffset:number|null}>('/auth/security-events?'+query.toString())
   .then(response=>{if(active){setEvents(response.events);setHasNext(response.nextOffset!==null);setPermitted(true);setError('');}})
   .catch(cause=>{if(active){setError(cause instanceof Error?cause.message:String(cause));setEvents([]);setHasNext(false);}})
   .finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[filters,page,pageSize]);
 const field=(key:keyof SecurityEventFilters,label:string,type='search')=><label className="form-label" key={key}>{label}
  <input className="form-control" type={type} value={draft[key]} onChange={event=>setDraft(previous=>({...previous,[key]:event.target.value}))}/>
 </label>;
 return <section className="surface permission-section">
  <h2>Login history and security activity</h2>
  <p>Tenant security events. Access requires the server-enforced Security read permission.</p>
  <form className="md-admin-form-grid md-security-history-filters" onSubmit={event=>{
    event.preventDefault();
    if(draft.from&&draft.to&&draft.from>draft.to){setFilterError('From date must not be later than Before date.');return;}
    setFilterError('');setPage(0);setFilters({...draft});
  }}>
   {field('action','Event action')}{field('identifier','Account / login identifier')}{field('ip','Source IP address')}
   {field('from','From date','date')}{field('to','Before date','date')}
   <div className="md-admin-actions"><button type="submit" className="btn btn-brand" disabled={busy}>Apply filters</button>
    <button type="button" className="btn" disabled={busy} onClick={()=>{setDraft(emptySecurityEventFilters());setFilters(emptySecurityEventFilters());setFilterError('');setPage(0);}}>Clear</button></div>
  </form>
  {filterError&&<p role="alert" className="form-error">{filterError}</p>}
  {busy&&<p role="status">Loading security history…</p>}
  {error&&<p role="alert">Unable to load security events: {error}</p>}
  {!busy&&!error&&permitted&&<div className="md-admin-table-wrap" role="region" aria-label="Login security history" tabIndex={0}>
   <table className="md-admin-table md-audit-table md-security-history-table">
    <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Login</th><th scope="col">IP address</th><th scope="col">Changes</th></tr></thead>
    <tbody>{events.map(event=><tr key={event.id}>
     <td data-label="Time">{new Date(event.at).toLocaleString()}</td>
     <td data-label="Action">{event.action.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase())}</td><td data-label="Login">{event.loginIdentifier||event.actorUserId||'—'}</td>
     <td data-label="IP address">{event.sourceIp||'—'}</td>
     <td data-label="Changes">{event.details?.from&&event.details?.to?event.details.from+' → '+event.details.to
  :event.details&&Object.keys(event.details).length>0?Object.entries(event.details).filter(([key])=>!/secret|token|password/i.test(key)).slice(0,3).map(([key,value])=>key+': '+String(value).slice(0,80)).join(', ')||'No changes recorded'
  :'No changes recorded'}</td>
    </tr>)}{!events.length&&<tr><td colSpan={5}>No matching security activity.</td></tr>}</tbody>
   </table>
  </div>}
  {!busy&&!error&&<div className="md-admin-actions" role="navigation" aria-label="Security event pages">
   <button type="button" className="btn" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button>
   <span aria-live="polite">Page {page+1}</span>
   <button type="button" className="btn" disabled={!hasNext} onClick={()=>setPage(page+1)}>Next</button>
  </div>}
 </section>;
}

function TenantMfaSettings({ onReauthenticate, canManage, governanceTab, governanceFocus }: { onReauthenticate: () => void; canManage: boolean; governanceTab?: string; governanceFocus?: boolean }) {
 const [view,setView]=useState<'mfa'|'sessions'|'federation'|'governance'>(governanceFocus?'governance':'mfa');
 useEffect(()=>{if(governanceFocus)setView('governance');},[governanceFocus,governanceTab]);
 const views=[{id:'mfa',label:'Multi-factor authentication'},{id:'sessions',label:'Session restrictions'},
  {id:'federation',label:'Identity federation'},{id:'governance',label:'Security governance'}] as const;
 return <section className="md-security-access-tabs" aria-label="Sign-in and access controls">
  <div role="tablist" className="md-admin-tabstrip" aria-label="Security configuration">{views.map(item=>
   <button type="button" role="tab" key={item.id} aria-selected={view===item.id}
    aria-controls={'security-panel-'+item.id} id={'security-tab-'+item.id}
    onClick={()=>setView(item.id)}>{item.label}</button>)}</div>
  <div role="tabpanel" id={'security-panel-'+view} aria-labelledby={'security-tab-'+view} className="md-admin-tabpanel">
   {view==='mfa'&&<TenantMfaControls request={apiRequest} canManage={canManage} onReauthenticate={onReauthenticate}/>}
   {view==='sessions'&&<TenantSessionControls request={apiRequest} canManage={canManage}/>}
   {view==='federation'&&<TenantFederationControls request={apiRequest} canManage={canManage}/>}
   {view==='governance'&&<TenantGovernance request={apiRequest} canManage={canManage} initialTab={governanceTab} focusOnMount={governanceFocus}/>}
  </div>
 </section>;
}

type CompanyProfile = {logoUrl?:string;legalName:string;tradingName:string;website:string;phone:string;email:string;addressLine1:string;addressLine2:string;city:string;postcode:string;country:string;timezone:string;locale:string;description:string};
const blankCompanyProfile:CompanyProfile={logoUrl:'',legalName:'',tradingName:'',website:'',phone:'',email:'',addressLine1:'',addressLine2:'',city:'',postcode:'',country:'',timezone:'Europe/London',locale:'en-GB',description:''};
const companyFields:ReadonlyArray<{key:keyof CompanyProfile;label:string}>= [
{key:'legalName',label:'Legal company name'},{key:'tradingName',label:'Trading name'},
{key:'description',label:'Description'},{key:'website',label:'Website'},
{key:'email',label:'Contact email'},{key:'phone',label:'Contact phone'},
{key:'addressLine1',label:'Address line 1'},{key:'addressLine2',label:'Address line 2'},
{key:'city',label:'Town / City'},{key:'postcode',label:'Postcode'},
{key:'country',label:'Country'},{key:'timezone',label:'Time zone'},{key:'locale',label:'Locale'}];

function CompanySettings({ canManage, section = 'general' }: { canManage: boolean; section?: string }) {
  const sectionTitle = section === 'branding' ? 'Company branding' : section === 'contacts' ? 'Contact details' : 'Company details';
  const [company,setCompany]=useState<CompanyProfile>(blankCompanyProfile);
  const [companyBeforeEdit,setCompanyBeforeEdit]=useState<CompanyProfile|null>(null);
  const [companyEditing,setCompanyEditing]=useState(false);
  const [companyLoading,setCompanyLoading]=useState(true);
  const [companyReady,setCompanyReady]=useState(false);
  const [companySaving,setCompanySaving]=useState(false);
  const [companyError,setCompanyError]=useState('');
  const [companyNotice,setCompanyNotice]=useState('');
  const [logoReading,setLogoReading]=useState(false);
  const contactFieldKeys=['website','phone','email','addressLine1','addressLine2','city','postcode','country'];
  const brandFieldKeys=['tradingName','website'];
  const visibleCompanyFields=companyFields.filter(field=>section==='contacts'?contactFieldKeys.includes(field.key)
    :section==='branding'?brandFieldKeys.includes(field.key)
      :!contactFieldKeys.includes(field.key)||field.key==='email');
  const shownCompanyFields=companyEditing?visibleCompanyFields:visibleCompanyFields.filter(field=>section!=='contacts'||Boolean(company[field.key]?.trim()));
  const contactsConfigured=contactFieldKeys.some(key=>Boolean(company[key as keyof CompanyProfile]?.trim()));
  const companyDirty=companyBeforeEdit!==null&&JSON.stringify(company)!==JSON.stringify(companyBeforeEdit);
  const saveCompanyAllowed=companyReady&&companyDirty;
  const companyFailureMessage=(failure:unknown)=>{
    const detail=failure instanceof Error?failure.message:String(failure);
    return /non-JSON|SQL|database|postgres|upstream|relation .+ does not exist|HTTP 50[0234]|API /i.test(detail)
      ?'Company settings are temporarily unavailable. Please retry.':detail;
  };
  const selectCompanyLogo=async(file?:File)=>{
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setCompanyError('Choose a PNG, JPG or WebP image.');return;}
    if(file.size>128*1024){setCompanyError('Logo must be 128 KB or smaller.');return;}
    setLogoReading(true);setCompanyError('');
    try{
      const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Unable to read selected logo'));reader.readAsDataURL(file)});
      setCompany(previous=>({...previous,logoUrl:encoded}));
    }catch(error){setCompanyError(error instanceof Error?error.message:String(error));}
    finally{setLogoReading(false)}
  };
  const reloadCompany=async()=>{
    setCompanyLoading(true);setCompanyReady(false);setCompanyError('');
    try{const value=await apiRequest<{profile:CompanyProfile|null}>('/tenant/company-profile');
      setCompany({...blankCompanyProfile,...(value.profile??{})});setCompanyReady(true);}
    catch(error){setCompanyReady(false);setCompanyError(companyFailureMessage(error));}
    finally{setCompanyLoading(false);}
  };
  useEffect(()=>{void reloadCompany();},[]);
  const saveCompany=async()=>{if(!canManage||!companyReady||companySaving||logoReading||!saveCompanyAllowed)return;
    setCompanySaving(true);setCompanyError('');setCompanyNotice('');
    try{const saved=await apiRequest<{profile:CompanyProfile}>('/tenant/company-profile',{method:'PUT',body:JSON.stringify(company)});
      setCompany(saved.profile);setCompanyEditing(false);setCompanyBeforeEdit(null);setCompanyNotice(section==='branding'?'Company logo saved.':'Company details saved.');
       // Update every $tenant.* image/text formula immediately after a confirmed save.
       void refreshTenantBrand();}
    catch(error){setCompanyError(companyFailureMessage(error));}
    finally{setCompanySaving(false)}
  };
  const [draft, setDraft] = useState<CurrencySettingsMetadata>({
    corporateCurrency: 'USD',
    standardVatRate: 20,
    currencies: [{ currencyIsoCode: 'USD', conversionRate: 1 }]
  });
  const [corporateCode, setCorporateCode] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const previousValue = useRef<{ draft: CurrencySettingsMetadata; corporateCode: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [currencyRetry,setCurrencyRetry]=useState(0);
  const currencyFailureMessage=(failure:unknown)=>{
    const detail=failure instanceof Error?failure.message:String(failure);
    return /SQL|database|postgres|non-JSON|HTTP 50[0234]|upstream|relation .+ does not exist/i.test(detail)
      ?'Currency settings are temporarily unavailable. Please retry.':detail;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError('');
    void apiRequest<CurrencySettingsMetadata>('/metadata/currencies')
      .then((settings) => {
        if (active) {
          setDraft(settings);
          setCorporateCode(settings.corporateCurrency);
          setLoaded(true);
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(currencyFailureMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [currencyRetry]);

  const beginEdit = (row: string) => {
    if (!canManage || saving || loading || editingRow) return;
    previousValue.current = { draft, corporateCode };
    setEditingRow(row);
    setError('');
    setNotice('');
  };
  const cancelEdit = () => {
    if (saving) return;
    if (previousValue.current) {
      setDraft(previousValue.current.draft);
      setCorporateCode(previousValue.current.corporateCode);
    }
    previousValue.current = null;
    setEditingRow(null);
    setError('');
  };
  const setCorporateCurrency = () => {
    const normalized = corporateCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      setError('Corporate currency must be a three-letter ISO 4217 code.');
      return;
    }
    setDraft((current) => {
      const hasCorporate = current.currencies.some((currency) => currency.currencyIsoCode === normalized);
      return {
        ...current,
        corporateCurrency: normalized,
        currencies: hasCorporate
          ? current.currencies.map((currency) => currency.currencyIsoCode === normalized
            ? { ...currency, conversionRate: 1 } : currency)
          : [...current.currencies, { currencyIsoCode: normalized, conversionRate: 1 }]
      };
    });
    setError('');
    setNotice('');
  };

  const save = async () => {
    if (!canManage || !editingRow || saving) return;
    const normalizedCorporateCode = corporateCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCorporateCode)) {
      setError('Corporate currency must be a three-letter ISO 4217 code.');
      return;
    }
    if (!Number.isFinite(draft.standardVatRate) || draft.standardVatRate < 0 || draft.standardVatRate > 100) {
      setError('Standard VAT rate must be between 0 and 100 percent.');
      return;
    }

    const currencyCodes=draft.currencies.map(currency=>currency.currencyIsoCode.trim().toUpperCase());
    if(currencyCodes.some(code=>!/^[A-Z]{3}$/.test(code))||new Set(currencyCodes).size!==currencyCodes.length){
      setError('Use a unique three-letter ISO currency code for each active currency.');return;
    }
    if(draft.currencies.some(currency=>!Number.isFinite(currency.conversionRate)||currency.conversionRate<=0)){
      setError('Every conversion rate must be greater than zero.');return;
    }
    const hasCorporateCurrency = draft.currencies.some((currency) => currency.currencyIsoCode === normalizedCorporateCode);
    const settings: CurrencySettingsMetadata = {
      corporateCurrency: normalizedCorporateCode,
      standardVatRate: draft.standardVatRate,
      currencies: hasCorporateCurrency
        ? draft.currencies.map((currency) => currency.currencyIsoCode === normalizedCorporateCode
          ? { ...currency, conversionRate: 1 } : currency)
        : [...draft.currencies, { currencyIsoCode: normalizedCorporateCode, conversionRate: 1 }]
    };
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await apiRequest<CurrencySettingsMetadata>('/metadata/currencies', {
        method: 'PUT', body: JSON.stringify(settings)
      });
      setDraft(saved);
      setCorporateCode(saved.corporateCurrency);
      previousValue.current = null;
      setEditingRow(null);
      setNotice('Company currency settings saved.');
    } catch (saveError) {
      setError(currencyFailureMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const addCurrency = () => {
    if (!canManage || editingRow || loading) return;
    const index = draft.currencies.length;
    beginEdit(`currency-${index}`);
    setDraft((current) => ({
      ...current, currencies: [...current.currencies, { currencyIsoCode: '', conversionRate: 1 }]
    }));
  };

  return <div className="home-content settings-read-first-page company-settings-page">
    <PageHeading eyebrow="Company Settings" title="Company Settings"
      description={section==='currency'?'Review your corporate currency, VAT and exchange rates.':section==='contacts'?'Manage how customers and partners contact your organisation.':section==='branding'?'Review and update your organisation logo and public identity.':'Manage your organisation details.'} />
    {section!=='currency'&&<section className="surface permission-section company-profile-section" aria-label={sectionTitle}>
      <div className="section-toolbar"><div><h2>{sectionTitle}</h2><p>{section==='branding'?'Upload a PNG, JPG or WebP logo (up to 128 KB). Preview the current logo below.':'Organisation, contact and regional information.'}</p></div>
      {canManage&&companyReady&&!companyEditing&&!companyLoading&&<button type="button" className="btn" onClick={()=>{setCompanyBeforeEdit({...company});setCompanyEditing(true);}}>{section === 'branding' ? 'Edit logo' : section === 'contacts' ? contactsConfigured?'Edit contacts':'Add contact details' : 'Edit details'}</button>}</div>
      {companyError&&!companyEditing&&<button type="button" className="btn" disabled={companyLoading} onClick={()=>void reloadCompany()}>Retry loading company details</button>}
      {companyLoading?<p>Loading company details…</p>:companyReady?<>{!companyEditing&&section==='contacts'&&!contactsConfigured&&<p className="company-contacts-empty">No contact details configured yet. Select Add contact details to enter an email, telephone, website or address.</p>}
       {(section==='branding'||section==='general')&&<div className="company-profile-logo">{(company.logoUrl?.startsWith("data:image/")||company.logoUrl?.startsWith("https://"))?<img src={company.logoUrl} alt="Company logo" />:<span aria-label="No logo configured">No logo</span>}</div>}
       {section==='branding'&&<div className="company-brand-preview" aria-label="Illustrative sign-in preview">
        <small>Sign-in preview (illustrative)</small>
        <div>{company.logoUrl?.startsWith('data:image/')||company.logoUrl?.startsWith('https://')?<img src={company.logoUrl} alt="Current company logo" />:<span>No logo configured</span>}
         <strong>{company.tradingName||company.legalName||'Your organisation'}</strong><span>Sign in</span></div>
       </div>}
       <div className="company-profile-grid">{companyEditing&&(section==='branding'||section==='general')&&<div className="company-profile-field" data-company-field="logoUrl"><label htmlFor="company-logo-upload">Company logo</label><input id="company-logo-upload" type="file" accept="image/png,image/jpeg,image/webp" disabled={companySaving||logoReading} onChange={event=>{void selectCompanyLogo(event.target.files?.[0]);event.target.value='';}}/><small>PNG, JPG or WebP · maximum 128 KB</small>{company.logoUrl&&<button className="btn" type="button" disabled={companySaving||logoReading} onClick={()=>{ if (!confirmDestructiveAction('Remove','company logo','Save company settings to apply the removal.')) return; setCompany(previous=>({...previous,logoUrl:''})); }}>Remove logo</button>}</div>}
      {shownCompanyFields.map(field=><div className="company-profile-field" data-company-field={field.key} key={field.key}><label htmlFor={'company-'+field.key}>{field.label}</label>
        {companyEditing?<input id={'company-'+field.key} className="form-control" value={company[field.key]}
          onChange={event=>setCompany(previous=>({...previous,[field.key]:event.target.value}))}/>
        :<p>{company[field.key]||'Not provided'}</p>}</div> )}</div></>:<p role="status">Company data could not be loaded. Editing is unavailable until a successful retry.</p>}
      {companyEditing&&<div className="settings-read-first-toolbar">
        <button type="button" className="btn" disabled={companySaving} onClick={()=>{setCompany(companyBeforeEdit??blankCompanyProfile);setCompanyEditing(false);setCompanyBeforeEdit(null);}}>Cancel</button>
        <button type="button" className="btn btn-brand" disabled={companySaving||logoReading||!saveCompanyAllowed} onClick={()=>void saveCompany()}>{companySaving?'Saving…':'Save details'}</button></div>}
      {companyError&&<p className="form-error" role="alert">{companyError}</p>}
      {companyNotice&&<p className="form-success" role="status">{companyNotice}</p>}
    </section>}
    {section==='currency'&&<section className="surface permission-section">
      <div className="section-toolbar">
        <div><h2>Currency & Tax</h2>
          <p>Rates express units of corporate currency per one unit of the active currency.</p></div>
      </div>
      {!loading&&!loaded&&<button type="button" className="btn" onClick={()=>setCurrencyRetry(value=>value+1)}>Retry loading currency settings</button>}
      {loading ? <p className="permission-help">Loading currency settings…</p> : loaded ? <>
        <div className="settings-read-first-section">
          {editingRow === 'corporate'
            ? <div className="settings-edit-row">
                <PlatformPageSlot slotKey="field-settings-15"><label className="form-label">Corporate Currency (ISO 4217)
                  <input autoFocus className="form-control" value={corporateCode} maxLength={3}
                    onChange={(event) => { setCorporateCode(event.target.value.toUpperCase()); setError(''); }}
                    onBlur={setCorporateCurrency} />
                </label></PlatformPageSlot>
              </div>
            : <SettingsViewRow label="Corporate Currency (ISO 4217)" value={draft.corporateCurrency}
                canEdit={canManage && !editingRow} onEdit={() => beginEdit('corporate')} />}
        </div>
        <div className="settings-read-first-section">
          {editingRow === 'standard-vat-rate'
            ? <div className="settings-edit-row">
                <PlatformPageSlot slotKey="field-settings-17"><label className="form-label">Standard VAT rate (%)
                  <input autoFocus className="form-control" type="number" min="0" max="100" step="0.01"
                    value={draft.standardVatRate}
                    onChange={(event) => setDraft((current) => ({
                      ...current, standardVatRate: Number(event.target.value)
                    }))} />
                </label></PlatformPageSlot>
              </div>
            : <SettingsViewRow label="Standard VAT rate" value={`${draft.standardVatRate}%`}
                canEdit={canManage && !editingRow} onEdit={() => beginEdit('standard-vat-rate')} />}
        </div>
        <h3 className="permission-section-heading">Active Currencies</h3>
        <div className="settings-read-first-section">
          {draft.currencies.map((currency, index) => (
            editingRow === `currency-${index}`
              ? <div className="settings-edit-row" key={`currency-edit-${index}`}>
                  <div className="settings-edit-row-grid">
                    <PlatformPageSlot slotKey="field-settings-16"><label className="form-label">Currency Code
                      <input autoFocus className="form-control currency-iso-code-input" value={currency.currencyIsoCode} maxLength={3}
                        disabled={currency.currencyIsoCode === draft.corporateCurrency}
                        onChange={(event) => {
                          const currencyIsoCode = event.target.value.toUpperCase();
                          setDraft((current) => ({
                            ...current, currencies: current.currencies.map((item, itemIndex) => itemIndex === index
                              ? { ...item, currencyIsoCode } : item)
                          }));
                        }} />
                    </label></PlatformPageSlot>
                    <PlatformPageSlot slotKey="field-settings-17"><label className="form-label">Conversion Rate
                      <input className="form-control" type="number" min="0.00000001" step="any"
                        value={currency.currencyIsoCode === draft.corporateCurrency ? 1 : currency.conversionRate}
                        disabled={currency.currencyIsoCode === draft.corporateCurrency}
                        onChange={(event) => {
                          const conversionRate = Number(event.target.value);
                          setDraft((current) => ({
                            ...current, currencies: current.currencies.map((item, itemIndex) => itemIndex === index
                              ? { ...item, conversionRate } : item)
                          }));
                        }} />
                    </label></PlatformPageSlot>
                  </div>
                  {currency.currencyIsoCode !== draft.corporateCurrency && <div className="settings-read-first-toolbar">
                    <button type="button" className="btn" onClick={() => {
                      if (!confirmDestructiveAction('Remove','currency "'+currency.currencyIsoCode+'"','Save settings to apply this removal.')) return;
                      setDraft((current) => ({
                        ...current, currencies: current.currencies.filter((_item, itemIndex) => itemIndex !== index)
                      }));
                      setEditingRow('removed-currency');
                    }}><Trash2 size={14} />Remove Currency</button>
                  </div>}
                </div>
              : <SettingsViewRow key={`currency-view-${index}`}
                  label={currency.currencyIsoCode || 'New currency'}
                  value={`Conversion rate: ${currency.currencyIsoCode === draft.corporateCurrency ? 1 : currency.conversionRate}${currency.currencyIsoCode !== draft.corporateCurrency && currency.conversionRate === 1 ? " (verify rate)" : ""}`}
                  canEdit={canManage && !editingRow && currency.currencyIsoCode !== draft.corporateCurrency}
                  onEdit={() => beginEdit(`currency-${index}`)} />
          ))}
        </div>
        {canManage && !editingRow && <button className="btn" type="button" onClick={addCurrency}>
          <Plus size={14} />Add Currency
        </button>}
        {canManage && editingRow && <div className="settings-read-first-toolbar">
          <button className="btn" type="button" disabled={saving} onClick={cancelEdit}>Cancel</button>
          <button className="btn btn-brand" type="button" onClick={() => void save()} disabled={saving}>
            <Save size={14} />{saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>}
      </> : null}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
    </section>}
  </div>;
}


return { AutomationSettingsWorkspace, TenantEmailRecoverySettings, TenantUserLockSettings, AccountSessionSecurity, TenantSecurityAudit, TenantMfaSettings, CompanySettings };
}
