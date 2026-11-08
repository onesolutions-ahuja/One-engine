import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import {generateMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import {PlatformPageSlot} from '../../platform/Workspace/PlatformPageSlot';
import {apiBase,apiRequest} from '../../authentication/Client/authClient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalAccessibility } from '../../accessibility/Modal/useModalAccessibility';
import { Eye, KeyRound, Pencil, Plus, RotateCw, Trash2, X } from 'lucide-react';
import type { NamedCredentialMetadata } from '../../metadata/Definitions/metadata';

type CredentialInput = {
  id?: string;
  name: string;
  label: string;
  protocol: NamedCredentialMetadata['protocol'];
  baseUrl: string;
  authType: NamedCredentialMetadata['authType'];
  headerName?: string;
  configuration?: Record<string, string>;
  username?: string;
  secret?: string;
  webhookRequired?: boolean;
  webhookSecret?: string;
  removedConfigurationKeys?: string[];
  webhookVerifyToken?: string;
};

type CredentialDraft = Omit<CredentialInput, 'id'> & { id?: string };

const blankCredential = (): CredentialDraft => ({
  name: '',
  label: '',
  protocol: 'HTTPS',
  baseUrl: '',
  authType: 'None',
  headerName: '',
  configuration: {},
  username: '',
  secret: '',
  webhookRequired: false,
  webhookSecret: '',
  webhookVerifyToken: ''
});

export default function NamedCredentials({
  credentials,
  canManage,
  canManageSecrets = true,
  canTest,
  encryptionReady,
  providerName,
  preset,
  fieldLabels,
  embedded = false,
  webhookOnly = false,
  onSave,
  onDelete,
  onRotate,
  onTest,
  onToggleEnabled,
  onOAuthAuthorize,
}: {
  credentials: NamedCredentialMetadata[];
  canManage: boolean;
  canManageSecrets?: boolean;
  canTest?: boolean;
  encryptionReady: boolean | null;
  providerName?: string;
  preset?: { name: string; label: string; baseUrl: string; authType: CredentialDraft['authType']; configuration: Record<string, string> };
  embedded?: boolean;
  webhookOnly?: boolean;
  fieldLabels?: Record<string,string>;
  onSave: (credential: CredentialInput) => Promise<{credential:NamedCredentialMetadata;webhookVerifyToken?:string}>;
  onDelete: (id: string) => Promise<void>;
  onRotate?: (id: string) => Promise<void>;
  onTest?: (id: string, testPath?: string) => Promise<{ connected: boolean; status?: number; message: string }>;
  onToggleEnabled?: (id: string, enabled: boolean) => Promise<void>;
  onOAuthAuthorize?: (id:string)=>Promise<string>;
}) {
  const [draft, setDraft] = useState<CredentialDraft | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const [viewing, setViewing] = useState(false);
  const [manualCredentialName,setManualCredentialName]=useState(false);
  const [saving, setSaving] = useState(false);
  const dismissModal = useCallback(() => { if (!saving) setDraft(null); }, [saving]);
  useModalAccessibility(Boolean(draft), modalRef, dismissModal);
  const [error, setError] = useState('');
  const [revealedVerifyToken,setRevealedVerifyToken]=useState<string|null>(null);
  const [loadingVerifyToken,setLoadingVerifyToken]=useState(false);
  const [savedWebhook,setSavedWebhook]=useState<{callbackUrl:string;verifyToken?:string}|null>(null);
  const [copiedWebhookId,setCopiedWebhookId]=useState<string|null>(null);
  const activeWebhookCredential=draft?.id ? credentials.find(item=>item.id===draft.id) : undefined;
  // A saved endpoint ID is enough to reconstruct the public callback from the
  // current HTTPS application origin when older API deployments omit its URL.
  const callbackFor=(credential:NamedCredentialMetadata)=>credential.webhookId
    ? `${apiBase.replace(/\/$/,'').replace(/^http:/,'https:')}/inbound-webhooks/${encodeURIComponent(credential.webhookId)}`
    : (credential.webhookCallbackUrl?.replace(/^http:/,'https:') || '');
  const activeWebhookUrl=savedWebhook?.callbackUrl || (activeWebhookCredential ? callbackFor(activeWebhookCredential) : '');
  const activeWebhookExists=Boolean(activeWebhookCredential?.webhookId);
  const copyWebhookUrl=async(credential:NamedCredentialMetadata)=>{
    const url=callbackFor(credential);
    if(!url)return;
    try{await navigator.clipboard.writeText(url);setCopiedWebhookId(credential.id);}
    catch{setError('Unable to copy automatically. Open webhook details and select the URL to copy.');}
  };
  const [removedKeys,setRemovedKeys]=useState<string[]>([]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const webhookSecretLength=draft?.webhookSecret?.length??0;
  const webhookNeedsSecret=Boolean(draft?.webhookRequired && !credentials.some(item=>item.id===draft?.id && item.webhookId));
  const webhookSecretInvalid=Boolean(draft?.webhookRequired && ((webhookNeedsSecret && webhookSecretLength<16) || (webhookSecretLength>0 && (webhookSecretLength<16 || webhookSecretLength>512))));
  const fieldErrors = { name: !/^[A-Za-z][A-Za-z0-9_]*$/.test(draft?.name ?? '') ? 'Use a name starting with a letter, containing only letters, numbers and underscores.' : '', label: !(draft?.label.trim()) ? 'Label is required.' : '', baseUrl: !(draft?.baseUrl.trim()) ? 'URL is required.' : draft?.protocol === 'HTTPS' && !/^https:\/\//i.test(draft.baseUrl.trim()) ? 'Use an HTTPS URL.' : '' };
  const blurField = (field: keyof typeof fieldErrors) => setTouched(current => ({...current, [field]: true}));
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState('');
  const [toggleBusyId, setToggleBusyId] = useState('');
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const credentialRevisions = credentials.map(({ id, enabled, updatedAt }) => `${id}:${enabled}:${updatedAt}`).join('|');
  useEffect(() => { setTestResults({}); }, [credentialRevisions]);
  const updateDraft = (update: Partial<CredentialDraft>) => {
    setDraft((current) => current ? { ...current, ...update } : current);
    setError('');
  };

  const editCredential = (credential?: NamedCredentialMetadata, readOnly = false) => {
    setManualCredentialName(Boolean(credential));
    setError('');
    setSavedWebhook(null);
    setRemovedKeys([]);
    setRevealedVerifyToken(null);
    setTouched({});
    setViewing(readOnly);
    setDraft(credential ? {
      id: credential.id,
      name: credential.name,
      label: credential.label,
      protocol: credential.protocol,
      baseUrl: credential.baseUrl,
      authType: credential.authType,
      headerName: credential.headerName,
      configuration: { ...preset?.configuration, ...credential.configuration },
      username: '',
      secret: '',
      webhookRequired: credential.webhookEnabled===true,
      webhookSecret: '',
      webhookVerifyToken: ''
    } : preset ? { ...blankCredential(), ...preset, protocol: 'HTTPS', webhookRequired: webhookOnly } : {...blankCredential(), webhookRequired: webhookOnly});
  };

  const submit = async () => {
    if (!draft || saving) return;
    setTouched({ name: true, label: true, baseUrl: true });
    if (Object.values(fieldErrors).some(Boolean)) return;
    const existingWebhook=Boolean(credentials.find(item=>item.id===draft.id)?.webhookId);
    if(draft.webhookRequired&&(!existingWebhook&&!draft.webhookSecret||draft.webhookSecret&&draft.webhookSecret.length<16)){
      setError('Enter a webhook signing secret of at least 16 characters.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result=await onSave({
        ...draft,
        removedConfigurationKeys:removedKeys,
        name: draft.name.trim(),
        label: draft.label.trim(),
        baseUrl: draft.baseUrl.trim(),
        ...(draft.headerName?.trim() ? { headerName: draft.headerName.trim() } : {}),
        ...(draft.username?.trim() ? { username: draft.username.trim() } : {}),
        ...(draft.secret ? { secret: draft.secret } : {}),
        ...((draft.webhookRequired || existingWebhook)
          ? {webhookRequired:Boolean(draft.webhookRequired)} : {}),
        ...(draft.webhookSecret?{webhookSecret:draft.webhookSecret}:{}),
        ...(draft.webhookVerifyToken?{webhookVerifyToken:draft.webhookVerifyToken}:{})
      });
      if(draft.webhookRequired){
        setSavedWebhook({callbackUrl:result.credential.webhookCallbackUrl??'',
          verifyToken:result.webhookVerifyToken});
        setDraft({...draft,id:result.credential.id,webhookSecret:'',webhookVerifyToken:''});
        setRevealedVerifyToken(result.webhookVerifyToken??null);
        setViewing(true);
      }else setDraft(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save Named Credential');
    } finally {
      setSaving(false);
    }
  };

  const visibleCredentials = credentials.filter((credential) => (!webhookOnly || Boolean(credential.webhookId)) &&
    `${credential.label} ${credential.name} ${credential.protocol} ${credential.baseUrl}`
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const totalPages = Math.max(1, Math.ceil(visibleCredentials.length / 50));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedCredentials = visibleCredentials.slice(currentPage * 50, (currentPage + 1) * 50);

  const performAction = async (credential: NamedCredentialMetadata, action: 'delete' | 'rotate') => {
    if (busyId) return;
    if (action === 'delete' && !window.confirm(`Delete Named Credential "${credential.label}"? Credentials used by a Flow or other feature cannot be deleted.`)) return;
    setBusyId(credential.id);
    setError('');
    try {
      if (action === 'delete') await onDelete(credential.id);
      else if (onRotate) await onRotate(credential.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Unable to ${action} Named Credential`);
    } finally {
      setBusyId('');
    }
  };

  const toggleEnabled = async (credential: NamedCredentialMetadata) => {
    if (!onToggleEnabled || toggleBusyId) return;
    setToggleBusyId(credential.id);
    setError('');
    try {
      await onToggleEnabled(credential.id, credential.enabled === false);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to change connection status');
    } finally {
      setToggleBusyId('');
    }
  };

  const authorizeOAuth=async(credential:NamedCredentialMetadata)=>{
    if(!onOAuthAuthorize||busyId)return;
    setBusyId(credential.id);setError('');
    try{
      const url=await onOAuthAuthorize(credential.id);
      const destination=new URL(url);
      if(destination.protocol!=='https:')throw new Error('Authorization URL must use HTTPS');
      window.location.assign(url);
    }catch(error){setError(error instanceof Error?error.message:'OAuth authorization failed');}
    finally{setBusyId('');}
  };
  const testCredential = async (credential: NamedCredentialMetadata) => {
    if (busyId || !onTest) return;
    setBusyId(credential.id);
    setError('');
    setTestResults((current) => ({ ...current, [credential.id]: 'Testing connection…' }));
    try {
      // Provider-aware path is only a UI default. The backend remains a generic
      // read-only HTTP diagnostic controlled by OneEngine and Named Credentials.
      const configuredPath=credential.configuration?.public_testPath?.trim();
      let testPath=configuredPath||'';
      try{
        if(!configuredPath&&new URL(credential.baseUrl).hostname.toLowerCase()==='graph.facebook.com')
          testPath='me';
      }catch{/* Invalid base URL will be reported by the existing backend guard. */}
      const result = await onTest(credential.id,testPath);
      setTestResults((current) => ({ ...current, [credential.id]: `${result.connected ? 'Connected' : 'Failed'}: ${result.message}` }));
    } catch (testError) {
      setTestResults((current) => ({ ...current, [credential.id]: `Failed: ${testError instanceof Error ? testError.message : 'Unable to test connection'}` }));
    } finally {
      setBusyId('');
    }
  };

  return <section className="surface object-setting-surface named-credentials-page">
    <div className="section-toolbar">
      <div><h1 className="audit-page-heading">{embedded ? 'Connection Settings' : webhookOnly ? 'Webhook Endpoints' : 'Named Credentials'}</h1><p>{embedded ? 'Tenant-specific HTTPS connection configuration. Secrets remain encrypted and masked.' : 'Manage tenant-wide HTTPS credentials used by HTTP Callouts and webhook integrations.'}</p></div>
      <button className="btn btn-brand" disabled={!canManage || encryptionReady === false} title={!canManage ? 'Requires namedCredentials:manage permission' : encryptionReady === false ? 'Credential encryption is not configured on the server' : undefined} onClick={() => editCredential()}><Plus size={14} />{embedded ? 'Configure Connection' : 'New Named Credential'}</button>
    </div>
    {!embedded && <div className="record-type-create">
      <input className="form-control" type="search" aria-label="Search Named Credentials" placeholder="Search credentials…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
    </div>}
    {error && <div className="records-message" role="alert">{error}</div>}
    {!canManage && <div className="info-callout" role="alert">This account cannot edit connector configuration. Ask an administrator for connectorApps:edit.</div>}
    {encryptionReady === false && <div className="records-message" role="alert">Credential encryption is not configured on the server. Check METADRIVE_CREDENTIAL_KEYS and METADRIVE_CREDENTIAL_ACTIVE_KEY_ID in the active server environment (or the legacy METADRIVE_CREDENTIAL_ENCRYPTION_KEY). Preserve existing keys when moving between hosting providers.</div>}
    <ResponsiveDataList rows={pagedCredentials} getId={credential=>credential.id}
      label="Named credentials" onOpen={credential=>editCredential(credential,true)} openLabel="View connection"
      columns={[
        {apiName:'label',label:'Connection',phoneRole:'title',render:credential=>credential.label},
        {apiName:'name',label:'API name',phoneRole:'subtitle',render:credential=>credential.name},
        {apiName:'state',label:'Status',phoneRole:'badge',render:credential=>credential.enabled===false?'Disabled':'Enabled'},
        {apiName:'protocol',label:'Protocol',phoneRole:'trailing',render:credential=>credential.protocol},
        {apiName:'base',label:'Base URL',render:credential=>credential.baseUrl},
        {apiName:'auth',label:'Authentication',render:credential=>credential.authType},
        {apiName:'secret',label:'Secret',render:credential=>credential.authType==='None'?'Not required':credential.hasSecret?'Stored · masked':'Not configured'},
        {apiName:'test',label:'Connection test',render:credential=>testResults[credential.id]??'Not tested'},
        {apiName:'actions',label:'Actions',render:credential=><div className="toolbar-actions">
          {credential.webhookId && <button type="button" className="btn btn-small" onClick={() => void copyWebhookUrl(credential)}>{copiedWebhookId === credential.id ? 'Copied URL' : 'Copy webhook URL'}</button>}
          <button className="btn btn-small" type="button"
            disabled={!(canTest??canManage)||!onTest||credential.enabled===false||Boolean(busyId)}
            onClick={()=>void testCredential(credential)}>Test</button>
          {credential.webhookId && <button className="btn btn-small" type="button" onClick={() => editCredential(credential,true)}>Webhook details</button>}
          <button className="btn btn-small" type="button" disabled={!canManage||Boolean(busyId)}
            onClick={()=>editCredential(credential)}>Edit</button>
          {onRotate&&<button className="btn btn-small" type="button" disabled={!canManage||Boolean(busyId)}
            onClick={()=>void performAction(credential,'rotate')}>Rotate key</button>}
          {!embedded&&<button className="btn btn-small" type="button" disabled={!canManage||Boolean(busyId)}
            onClick={()=>void performAction(credential,'delete')}>Delete</button>}
        </div>}
      ]}/>
    <div className="table-scroll md-mobile-table-replaced" role="region" aria-label="Named Credential connections" tabIndex={0}>
      <table className="slds-table">
        <thead><tr><th scope="col">Connection</th><th scope="col">Authentication</th><th scope="col">Connection test</th>{!embedded && <th scope="col">Status</th>}<th scope="col">Actions</th></tr></thead>
        <tbody>{pagedCredentials.map((credential) => <tr key={credential.id}>
          <td><button className="btn btn-link" onClick={() => editCredential(credential, true)}>{credential.label}</button><div className="api-name" title={credential.name}>{credential.name}</div>{credential.webhookId && <button className="btn btn-link" onClick={() => editCredential(credential, true)}>Webhook: {credential.webhookEnabled ? 'enabled' : 'disabled'}</button>}</td>
                    <td>{credential.authType}</td>
          <td role="status">{testResults[credential.id] ?? 'Not tested'}</td>
          {!embedded && <td><label className="credential-switch" aria-label={`Connection status for ${credential.label}`}><input type="checkbox" role="switch" checked={credential.enabled !== false} disabled={!canManage || !onToggleEnabled || Boolean(toggleBusyId)} onChange={() => void toggleEnabled(credential)} /><span className="credential-switch-track" aria-hidden="true" /><span>{toggleBusyId === credential.id ? 'Updating…' : credential.enabled === false ? 'Disabled' : 'Enabled'}</span></label></td>}
          <td><div className="toolbar-actions">
            {credential.authType==='OAuth Authorization Code'&&onOAuthAuthorize&&
              <button className="btn btn-small" disabled={!canManage||Boolean(busyId)||credential.enabled===false}
                onClick={()=>void authorizeOAuth(credential)}>Authorize</button>}
            <button className="btn btn-small" aria-label={`Test connection for ${credential.label}`} disabled={!(canTest ?? canManage) || !onTest || credential.enabled === false || Boolean(busyId)} title={credential.protocol === 'SMTP' ? 'Verify SMTP connection, TLS and authentication without sending email' : 'Test saved HTTPS base URL with stored authentication'} onClick={() => void testCredential(credential)}>{busyId === credential.id ? 'Testing…' : 'Test Connection'}</button>
            {credential.webhookId && <button className="btn btn-small credential-webhook-action" type="button"
              aria-label={`Webhook details for ${credential.label}`}
              onClick={() => editCredential(credential,true)}>Webhook</button>}
            <button className="icon-button subtle" aria-label={`View ${credential.label}`} onClick={() => editCredential(credential, true)}><Eye size={14} /></button>
            <button className="icon-button subtle" aria-label={`Edit ${credential.label}`} title={!canManage ? 'Manage Named Credentials permission required' : 'Edit credential'} disabled={!canManage || Boolean(busyId)} onClick={() => editCredential(credential)}><Pencil size={14} /></button>
            {onRotate && <button className="icon-button subtle" aria-label={`Rotate key for ${credential.label}`} title="Rotate encryption key" disabled={!canManage || Boolean(busyId)} onClick={() => void performAction(credential, 'rotate')}><RotateCw size={14} /></button>}
            {!embedded && <button className="icon-button subtle" aria-label={`Delete ${credential.label}`} disabled={!canManage || Boolean(busyId)} onClick={() => void performAction(credential, 'delete')}><Trash2 size={14} /></button>}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!embedded && <div className="section-toolbar md-admin-pagination">
      <span>{visibleCredentials.length===0?'No credentials':totalPages===1?`${visibleCredentials.length} credential${visibleCredentials.length===1?'':'s'} · showing all`:`Showing ${currentPage*50+1}–${Math.min((currentPage+1)*50,visibleCredentials.length)} of ${visibleCredentials.length} credentials · Page ${currentPage+1} of ${totalPages}`}</span>
      <div className="toolbar-actions">
        <button className="btn btn-small" disabled={currentPage === 0} onClick={() => setPage(0)}>First</button>
        <button className="btn btn-small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <button className="btn btn-small" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
        <button className="btn btn-small" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(totalPages - 1)}>Last</button>
      </div>
    </div>}
    {!visibleCredentials.length && <div className="empty-state">{credentials.length ? 'No Named Credentials match your search.' : 'No Named Credentials are configured yet.'}</div>}
    {draft && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDraft(null); }}>
      <section ref={modalRef} tabIndex={-1} className="modal named-credential-modal" role="dialog" aria-modal="true" aria-labelledby="named-credential-title">
        <div className="modal-header"><h2 id="named-credential-title">{viewing ? 'Connection Details' : draft.id ? 'Edit Connection' : 'Configure Connection'}</h2><button className="icon-button dark" aria-label="Close" disabled={saving} onClick={() => setDraft(null)}><X size={18} /></button></div>
        <p className="modal-copy"><KeyRound size={14} /> Credentials are shared within this tenant. Secrets are encrypted at rest and never displayed after saving.</p>
        <fieldset disabled={viewing} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="named-credential-form-grid">
        <PlatformPageSlot slotKey="field-credentials-01"><label className="form-label">API Name<input className="form-control" autoComplete="off" disabled={Boolean(providerName)} value={draft.name} aria-invalid={Boolean(touched.name && fieldErrors.name)} onBlur={() => blurField('name')} onChange={(event) => {setManualCredentialName(true);updateDraft({ name: event.target.value.replace(/[^A-Za-z0-9_]/g, '') });}} placeholder="Partner_API" />{touched.name && fieldErrors.name && <small role="alert" className="field-error">{fieldErrors.name}</small>}</label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-credentials-02"><label className="form-label">Label<input className="form-control" value={draft.label} aria-invalid={Boolean(touched.label && fieldErrors.label)} onBlur={() => blurField('label')} onChange={(event) => updateDraft({label:event.target.value,...(!draft.id && !providerName && !manualCredentialName ? {name:generateMetadataApiName(event.target.value)} : {})})} placeholder="Partner API" />{touched.label && fieldErrors.label && <small role="alert" className="field-error">{fieldErrors.label}</small>}</label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-credentials-04"><label className="form-label">Base URL<input className="form-control" type="url" value={draft.baseUrl} aria-invalid={Boolean(touched.baseUrl && fieldErrors.baseUrl)} onBlur={() => blurField('baseUrl')} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder="https://api.example.com/" />{touched.baseUrl && fieldErrors.baseUrl && <small role="alert" className="field-error">{fieldErrors.baseUrl}</small>}</label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-credentials-05"><label className="form-label">Authentication<select className="form-control" value={draft.authType} onChange={(event) => {
          const authType = event.target.value as NamedCredentialMetadata['authType'];
          updateDraft({ authType, configuration: ['OAuth Client Credentials','OAuth Authorization Code'].includes(authType)
            ? { clientId: '', ...(authType==='OAuth Authorization Code'?{authorizationUrl:'',tokenUrl:''}:{tokenPath:''}), scope: '', ...draft.configuration }
            : draft.configuration });
        }}>
          {['None', 'Bearer', 'Basic', 'API Key', 'OAuth Client Credentials', 'OAuth Authorization Code', 'Authorization Scheme'].map((authType) => <option key={authType}>{authType}</option>)}
        </select></label></PlatformPageSlot>
        <fieldset className="connector-config-fields named-credential-span-full" style={{ border: 0, padding: 0, margin: '12px 0',gridColumn:"1 / -1" }}>
          <legend>Configuration variables</legend>
          {Object.entries(draft.configuration ?? {}).map(([key, value]) => (
            <div key={key} className="connector-config-row">
              <label htmlFor={'credential-var-'+key}>{fieldLabels?.[key] || (draft.id ? credentials.find(c => c.id === draft.id)?.configurationLabels?.[key] : undefined) || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}</label>
              <input id={'credential-var-'+key} className="form-control" disabled={viewing||!canManage} value={value} onChange={(event) => updateDraft({ configuration: { ...draft.configuration, [key]: event.target.value } })} />
              {!viewing && canManage && <button type="button" className="icon-button subtle" aria-label={'Delete variable '+key} title="Remove variable after saving" onClick={()=>{
                const next={...draft.configuration}; delete next[key];
                setRemovedKeys(previous=>Array.from(new Set([...previous,key])));
                updateDraft({configuration:next});
              }}><Trash2 size={16}/></button>}
            </div>
          ))}
          {!viewing && <button type="button" className="btn btn-small" onClick={() => {
            const input = window.prompt('Variable name (letters, numbers, underscore)');
            if (input === null) return;
            const name = input.trim();
            const key = name.startsWith('public_') ? name : `public_${name}`;
            // Public variables survive the credential API's safe-list. Never expose
            // secrets through the editable and client-readable variable collection.
            if (!/^public_[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
                /(secret|token|password|passphrase|private|pin|credential|authorization|api_?key)/i.test(key)) {
              setError('Use a non-secret variable name containing letters, numbers or underscores.');
              return;
            }
            setError('');
            setRemovedKeys(previous=>previous.filter(item=>item!==key));
            updateDraft({ configuration: { ...draft.configuration, [key]: draft.configuration?.[key] ?? '' } });
          }}>Add variable</button>}
        </fieldset>
        {['OAuth Client Credentials','OAuth Authorization Code'].includes(draft.authType) && <div className="info-callout named-credential-span-full">Configure clientId and scope. Client Credentials requires tokenPath (relative to Base URL); Authorization Code requires public HTTPS authorizationUrl and tokenUrl. Enter the client secret in the encrypted Secret field. OAuth tokens are protected and never exposed to Flows.</div>}
        {['API Key', 'Authorization Scheme'].includes(draft.authType) && <PlatformPageSlot slotKey="field-credentials-06"><label className="form-label">{draft.authType === 'Authorization Scheme' ? 'Authorization Scheme' : 'API Key Header'}<input className="form-control" value={draft.headerName ?? ''} onChange={(event) => updateDraft({ headerName: event.target.value })} placeholder="X-API-Key" /></label></PlatformPageSlot>}
        {draft.authType === 'Basic' && canManageSecrets && <PlatformPageSlot slotKey="field-credentials-07"><label className="form-label">Username<input className="form-control" autoComplete="off" value={draft.username ?? ''} onChange={(event) => updateDraft({ username: event.target.value })} placeholder={draft.id ? 'Leave blank to retain' : ''} /></label></PlatformPageSlot>}
        {draft.authType !== 'None' && canManageSecrets && <PlatformPageSlot slotKey="field-credentials-08"><label className="form-label">{draft.authType === 'Basic' ? 'Password' : draft.authType === 'OAuth Client Credentials' ? 'Client Secret' : 'Secret'}<input className="form-control" type="password" autoComplete="new-password" value={draft.secret ?? ''} onChange={(event) => updateDraft({ secret: event.target.value })} placeholder={draft.id ? 'Stored securely · blank keeps existing secret' : 'Enter secret'} /></label></PlatformPageSlot>}
        </div>
        {draft.protocol==='HTTPS' && <div className="named-credential-span-full" style={{marginTop:16}}>
          <label className="credential-switch">
            <input type="checkbox" role="switch" checked={Boolean(draft.webhookRequired)}
              disabled={!canManageSecrets}
              onChange={event=>updateDraft({webhookRequired:event.target.checked,webhookSecret:''})}/>
            <span className="credential-switch-track" aria-hidden="true"/>
            <span>Webhook required?</span>
          </label>
          {draft.webhookRequired && <p className="modal-copy">
            One signed callback is generated after you save this connection. Incoming events
            are stored in Communication; no Flow assignment is needed.
          </p>}
          {draft.webhookRequired && !activeWebhookExists && !savedWebhook?.callbackUrl && <div className="info-callout" role="status">
            No webhook endpoint exists yet. Enter your provider signing secret, then click <strong>{draft.id?'Save Changes':'Create Connection'}</strong> to generate the callback URL and one-time verification token.
          </div>}
          {draft.webhookRequired && activeWebhookExists && !activeWebhookUrl && <div className="records-message" role="alert">
            Webhook exists, but the callback URL is missing from the server response. Please check the Named Credentials API deployment.
          </div>}
          {draft.webhookRequired && activeWebhookExists && canManage && canManageSecrets && <div className="info-callout">
            <strong>Webhook verification token (give this to Meta)</strong>
            <p>Available only to credential and webhook administrators. Existing tokens created before encrypted storage cannot be retrieved; set a new token below.</p>
            <button type="button" className="btn btn-small" disabled={loadingVerifyToken}
              onClick={()=>{if(!draft.id)return;setLoadingVerifyToken(true);setError('');
                void apiRequest<{verifyToken:string|null}>('/named-credentials/'+encodeURIComponent(draft.id)+'/webhook-verify-token')
                  .then((result:{verifyToken:string|null})=>{setRevealedVerifyToken(result.verifyToken);if(!result.verifyToken)setError('Legacy token cannot be recovered. Enter a replacement verification token and save.');})
                  .catch(error=>setError(error instanceof Error?error.message:String(error)))
                  .finally(()=>setLoadingVerifyToken(false));
              }}>Reveal verification token</button>
            {revealedVerifyToken && <input className="form-control" readOnly type="text" value={revealedVerifyToken} onFocus={e=>e.currentTarget.select()} />}
          </div>}
          {draft.webhookRequired && canManageSecrets && !viewing && <label className="form-label">
            Set or replace verification token (16–256 characters)
            <input className="form-control" type="text" autoComplete="off" value={draft.webhookVerifyToken??''}
              onChange={event=>updateDraft({webhookVerifyToken:event.target.value})} minLength={16} maxLength={256}
              placeholder="Optional: choose a verification token to enter in Meta" />
          </label>}
          {draft.webhookRequired && canManageSecrets && <label className="form-label">
            Webhook signing secret (16–512 characters)
            <input className="form-control" type="password" autoComplete="new-password"
              minLength={16} maxLength={512} value={draft.webhookSecret??''}
              placeholder={credentials.find(item=>item.id===draft.id)?.webhookId
                ?'Stored securely · leave blank to retain':'Enter provider signing secret'}
              onChange={event=>updateDraft({webhookSecret:event.target.value})}/>
            <small>Leave blank to keep the stored signing secret. Enter a new Meta App Secret only to rotate it; this also generates a new one-time verify token.</small>
            {webhookSecretInvalid && <small role="alert" className="field-error">{webhookSecretLength===0?'Enter a webhook signing secret (minimum 16 characters) to create the endpoint.':`Signing secret must be 16–512 characters (currently ${webhookSecretLength}).`}</small>}
          </label>}
        </div>}
        {draft.id && !embedded && <div className="named-credential-activation"><strong>Connection status</strong><label className="credential-switch"><input type="checkbox" role="switch" checked={credentials.find((item) => item.id === draft.id)?.enabled !== false} disabled={viewing || !canManage || !onToggleEnabled || Boolean(toggleBusyId)} onChange={() => { const credential = credentials.find((item) => item.id === draft.id); if (credential) void toggleEnabled(credential); }} /><span className="credential-switch-track" aria-hidden="true" /><span>{toggleBusyId ? 'Updating…' : credentials.find((item) => item.id === draft.id)?.enabled === false ? 'Disabled' : 'Enabled'}</span></label></div>}
        {draft.id && <div className="info-callout">Leave the secret blank to keep the existing secret. Changing authentication type requires a new secret.</div>}
        {error && <div className="records-message" role="alert">{error}</div>}
        </fieldset>
        {draft.webhookRequired && activeWebhookUrl && <div className="info-callout" style={{marginTop:14}}>
            <h3>Webhook callback URL</h3>
            <p>Copy this address into the provider webhook configuration. This is separate from the editable public_webhookCallbackUrl configuration variable.</p>
            <input className="form-control" readOnly
              value={activeWebhookUrl}
              onFocus={event=>event.currentTarget.select()}/>
            <p><small>Webhook status: {credentials.find(item=>item.id===draft.id)?.webhookEnabled ? 'Enabled' : 'Disabled'}. The URL remains available whenever you reopen this connection.</small></p>
            {(savedWebhook?.verifyToken||revealedVerifyToken)&&<>
              <strong>Verification token (copy now; shown only once)</strong>
              <input className="form-control" readOnly value={savedWebhook?.verifyToken||revealedVerifyToken||''}
                onFocus={event=>event.currentTarget.select()}/>
            </>}
            <button type="button" className="btn btn-small" onClick={()=>{
              void navigator.clipboard.writeText(activeWebhookUrl).catch(()=>setError('Select the callback URL above to copy it.'));
            }}>Copy callback URL</button>
            <small>The verification token is different from the signing secret. Register the callback and verification token with your provider.
              The signing secret is never displayed after saving.</small>
          </div>}
        <div className="modal-actions"><button className="btn" disabled={saving} onClick={() => setDraft(null)}>{viewing ? 'Close' : 'Cancel'}</button>{!viewing && <button className="btn btn-brand" disabled={saving || !draft.name.trim() || !draft.label.trim() || !draft.baseUrl.trim() || (draft.authType !== 'None' && !draft.id && !draft.secret) || (draft.authType === 'Basic' && !draft.id && !draft.username?.trim())
          ||webhookSecretInvalid || Boolean(draft.webhookVerifyToken && (draft.webhookVerifyToken.length<16 || draft.webhookVerifyToken.length>256))} onClick={() => void submit()}>{saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Named Credential'}</button>}{viewing && canManage && <button className="btn btn-brand" onClick={() => setViewing(false)}><Pencil size={14} />Edit</button>}</div>
      </section>
    </div>}
  </section>;
}

