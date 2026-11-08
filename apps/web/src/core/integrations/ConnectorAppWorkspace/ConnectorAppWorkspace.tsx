import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';
import NamedCredentials from '../NamedCredentials/NamedCredentials';
import type { NamedCredentialMetadata } from '../../metadata/Definitions/metadata';
import { appLicensed } from './appLicence';
export { appLicensed } from './appLicence';

export type ConnectorApp = {
  Id: string;
  Name: string;
  AppKey__c: string;
  Description__c?: string;
  Category__c?: string;
  AppType__c?: 'Application' | 'ConnectorApp';
  CredentialName__c: string;
  DefaultBaseUrl__c?: string;
  AuthType__c?: NamedCredentialMetadata['authType'];
  ConfigFields__c?: string;
  RecordObject__c?: string;
  RecordFilterField__c?: string;
  RecordFilterValue__c?: string;
  InstallFlow__c?: string;
  UninstallFlow__c?: string;
  TrialFlow__c?: string;
  Installed__c: boolean;
  TrialUsed__c?: boolean;
  TrialStartedAt__c?: string;
  TrialExpiresAt__c?: string;
  TrialDays__c?: number;
  LicenceTermDays__c?: number;
  RecordColumns__c?: string;
  TestPath__c?: string;
  TestMethod__c?: string;
  LicenceExpiresAt__c?: string;
  LicenceStatus__c?: string;
  PackageVersion__c?: number;
  InstalledPackageVersion__c?: number;
  AccessScope__c?: string;
};
export type CommunicationRow = { Id: string; [key: string]: unknown };
export type CommunicationPage = { records: CommunicationRow[]; total: number };
export type ConnectorFlowSummary = { apiName: string; label: string; status: string; elements: Array<{type: string; config: Record<string, unknown>}> };
export type CredentialInput = Parameters<Parameters<typeof NamedCredentials>[0]['onSave']>[0];


function configFields(metadata?: string): { values: Record<string, string>; labels: Record<string, string> } {
  try {
    const parsed: unknown = JSON.parse(metadata || '[]');
    if (!Array.isArray(parsed)) return { values: {}, labels: {} };
    // Only required fields are automatically presented. Optional fields remain
    // available through the Named Credentials "Add variable" action.
    const rows = parsed.filter((entry) => entry && entry.required === true
      && typeof entry.apiName === 'string'
      && /^[A-Za-z][A-Za-z0-9_]*$/.test(entry.apiName));
    return { values: Object.fromEntries(rows.map((entry) => [entry.apiName, ''])),
      labels: Object.fromEntries(rows.map((entry) => [entry.apiName, typeof entry.label === 'string' ? entry.label : entry.apiName])) };
  } catch { return { values: {}, labels: {} }; }
}

export default function ConnectorAppWorkspace({
  app, credentials, flows, canManageCredentials, canView, canManageSecrets,
  canInstall, canManageFlows, encryptionReady, onBack,
  onSave, onDelete, loadHistory, onOpenRecord, onOpenFlow, onLifecycle
}: {
  app: ConnectorApp;
  credentials: NamedCredentialMetadata[];
  flows: ConnectorFlowSummary[];
  canManageCredentials: boolean;
  canView: boolean;
  canManageSecrets: boolean;
  canInstall: boolean;
  canManageFlows: boolean;
  encryptionReady: boolean | null;
  onBack: () => void;
  onSave: (value: CredentialInput) => Promise<{credential: NamedCredentialMetadata; webhookVerifyToken?: string}>;
  onDelete: (id: string) => Promise<void>;
  loadHistory: (objectName: string, field: string, source: string, offset: number, search: string) => Promise<CommunicationPage>;
  onOpenRecord: (objectName: string, id: string) => void;
  onOpenFlow: (apiName: string) => void;
  onLifecycle: (app: ConnectorApp, action: 'trial' | 'uninstall') => Promise<void>;
}) {
  const [section, setSection] = useState<'settings' | 'history' | 'flows' | 'licence'>('settings');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<CommunicationPage>({ records: [], total: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const licensed = appLicensed(app);
  const matched = credentials.filter((item) => item.name === app.CredentialName__c);
  const credential = matched[0];
  const dependencyFlows = flows.filter((flow) => flow.elements.some((element) =>
    ['HTTP Callout','Action'].includes(element.type)
    && (element.config.namedCredentialId === credential?.id
      || element.config.namedCredentialId === app.CredentialName__c
      || Boolean(element.config.namedCredentialResource))));
  useEffect(() => { setPage(0); setSearch(''); setSection('settings'); }, [app.AppKey__c]);
  useEffect(() => {
    if (section !== 'history') return;
    const objectName = app.RecordObject__c;
    const field = app.RecordFilterField__c;
    if (!objectName) { setData({records:[],total:0}); return; }
    let mounted = true;
    setLoading(true);
    setError('');
    void loadHistory(objectName, field || '', app.RecordFilterValue__c || app.Name, page * 50, search)
      .then((result) => { if (mounted) setData(result); })
      .catch((reason: unknown) => { if (mounted) { setData({ records: [], total: 0 }); setError(reason instanceof Error ? reason.message : 'Unable to load history'); } })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [app.AppKey__c, app.Name, app.RecordObject__c, app.RecordFilterField__c, app.RecordFilterValue__c, section, page, search, loadHistory]);

  const perform = async (action: 'trial' | 'uninstall') => {
    if (acting) return;
    if (action === 'uninstall' && !window.confirm('Uninstall ' + app.Name + '? Configuration and history will be retained.')) return;
    setActing(true); setError('');
    try { await onLifecycle(app, action); if (action === 'uninstall') onBack(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update app'); }
    finally { setActing(false); }
  };
  const columns: [string,string][] = (() => {
    try {
      const fields: unknown = JSON.parse(app.RecordColumns__c || '[]');
      if (Array.isArray(fields)) return fields.filter((name): name is string =>
        typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(name))
        .map((name) => [name, name.replace(/__c$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')]);
    } catch { /* invalid optional metadata */ }
    return [];
  })();
  return <div className="app-exchange connector-open-page">
    <div className="exchange-topline"><button className="btn" onClick={onBack}><ArrowLeft size={14}/> AppExchange</button><strong>{app.Name}</strong></div>
    <section className="surface" style={{padding:18,marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div><h2>{app.Name}</h2><p>{app.Description__c || 'Tenant-scoped connector configuration'}</p></div>
        <strong>{licensed ? 'Licence active' : app.TrialUsed__c ? 'Trial expired or inactive' : 'Not activated'}</strong>
      </div>
      <div className="exchange-tabs" role="tablist" aria-label={app.Name + ' management'}>
        {(['settings','history','flows','licence'] as const).map((tab) =>
          <button key={tab} role="tab" aria-selected={section === tab} className={section === tab ? 'active' : ''}
            onClick={() => setSection(tab)}>{tab === 'settings' ? 'Settings' : tab === 'history' ? 'Records' : tab === 'flows' ? 'Flows' : 'Licence'}</button>)}
      </div>
    </section>
    {section === 'settings' && <>
      {!licensed && <div className="info-callout"><ShieldCheck size={15}/> Start your free trial or activate a licence to configure or test this connection.</div>}
      {!canView && <div className="info-callout">******** · Missing connector configuration View permission.</div>}
      {credential && <div className="section-toolbar" style={{marginBottom:12}}><strong>Connection: {credential.enabled !== false && licensed ? 'Enabled' : 'Disabled'}</strong><span>Activation is managed in Setup &gt; Named Credentials.</span></div>}
      <NamedCredentials embedded providerName={app.CredentialName__c}
        preset={{name:app.CredentialName__c,label:app.Name,baseUrl:app.DefaultBaseUrl__c || '',authType:app.AuthType__c || 'None',configuration:configFields(app.ConfigFields__c).values}}
        fieldLabels={configFields(app.ConfigFields__c).labels}
        credentials={matched} canManage={canManageCredentials && licensed}
        canManageSecrets={canManageSecrets}
        encryptionReady={encryptionReady} onSave={onSave} onDelete={onDelete}/>
    </>}
    {section === 'licence' && <section className="surface" style={{padding:18}}>
      <h2>App Licence</h2>
      <p>Trial duration: {app.TrialDays__c || 21} days · Trial can only be activated once per tenant.</p>
      <p>Installed: {app.Installed__c ? 'Yes' : 'No'}</p>
      <p>Trial started: {app.TrialStartedAt__c ? new Date(app.TrialStartedAt__c).toLocaleString() : 'Not started'}</p>
      <p>Trial expires: {app.TrialExpiresAt__c ? new Date(app.TrialExpiresAt__c).toLocaleString() : '—'}</p>
      <p>Paid licence expires: {app.LicenceExpiresAt__c ? new Date(app.LicenceExpiresAt__c).toLocaleString() : 'Not configured'}</p>
      {!app.TrialUsed__c && <button className="btn btn-brand" disabled={acting || !canInstall}
        onClick={() => void perform('trial')}>{acting ? 'Activating…' : 'Start free trial'}</button>}
      {app.TrialUsed__c && !licensed && <div className="records-message">This tenant's free trial cannot be restarted. Contact your licence administrator.</div>}
      <hr style={{margin:'18px 0'}}/>
      <button className="btn btn-danger" disabled={acting || !canInstall} onClick={() => void perform('uninstall')}>Uninstall app</button>
      <p>Uninstall disables connector execution, but keeps configuration and records. Active Flow dependencies will prevent uninstall.</p>
    </section>}
    {section === 'flows' && <section className="surface" style={{padding:18}}>
      <h2>Flow Dependencies</h2>
      {!canManageFlows ? <p>Flow access is controlled by your permissions.</p> : dependencyFlows.length
        ? <><ResponsiveDataList rows={dependencyFlows} getId={x=>x.apiName} label="Connector Flow dependencies"
            onOpen={x=>onOpenFlow(x.apiName)} openLabel="Open Flow"
            columns={[
              {apiName:'label',label:'Flow',phoneRole:'title',render:x=>x.label},
              {apiName:'status',label:'Status',phoneRole:'badge',render:x=>x.status},
              {apiName:'name',label:'API name',phoneRole:'subtitle',render:x=>x.apiName}
            ]}/>
           <div className="table-scroll md-mobile-table-replaced"><table className="slds-table"><thead><tr><th>Flow</th><th>Status</th><th>Action</th></tr></thead><tbody>
            {dependencyFlows.map((flow) => <tr key={flow.apiName}><td>{flow.label}</td><td>{flow.status}</td>
              <td><button className="btn btn-small" onClick={() => onOpenFlow(flow.apiName)}>Open Flow</button></td></tr>)}
          </tbody></table></div></> : <p>No direct Flow references found for this credential.</p>}
    </section>}
    {section === 'history' && <section className="surface" style={{padding:18}}>
      <div className="section-toolbar"><div><h2>{app.RecordObject__c ? 'App Records' : 'Records'}</h2>
        <p>RBAC-filtered records for {app.Name}. Page size: 50.</p></div>
        <button className="btn" disabled={loading} onClick={() => setPage(0)}><RefreshCw size={14}/> Refresh</button></div>
      {!app.RecordObject__c && <p>No history object is configured for this connector. Choose an existing object and filter in Connector App metadata.</p>}
      {!!app.RecordObject__c && <input className="form-control" style={{maxWidth:360,marginBottom:14}} type="search" value={search}
        aria-label="Search app records" placeholder="Search app records" onChange={(event) => {setSearch(event.target.value);setPage(0);}}/>}
      {loading && <p>Loading…</p>}
      <ResponsiveDataList rows={data.records} getId={x=>String(x.Id)} label="Connector app records"
        loading={loading} onOpen={x=>onOpenRecord(app.RecordObject__c||'',x.Id)} openLabel="View record"
        columns={columns.map(([key,label],i)=>({apiName:key,label,
          phoneRole:(i===0?'title':i===1?'subtitle':i===2?'badge':i===3?'trailing':undefined) as 'title'|'subtitle'|'badge'|'trailing'|undefined,
          render:(x:CommunicationPage['records'][number])=>Object.prototype.hasOwnProperty.call(x,key)?String(x[key]??''):'********'
        }))}/>
      <div className="table-scroll md-mobile-table-replaced"><table className="slds-table"><thead><tr>{columns.map(([key,label]) => <th key={key}>{label}</th>)}<th>Action</th></tr></thead>
        <tbody>{data.records.map((record) => <tr key={record.Id}>{columns.map(([key]) => <td key={key}>{Object.prototype.hasOwnProperty.call(record,key)
          ? String(record[key] ?? '') : '********'}</td>)}<td>
          <button className="btn btn-small" onClick={() => onOpenRecord(app.RecordObject__c || '',record.Id)}>View</button></td></tr>)}</tbody>
      </table></div>
      {!loading && !!app.RecordObject__c && data.records.length === 0 && <p>No matching records.</p>}
      <div className="section-toolbar" style={{marginTop:14}}><span>{data.total} records · Page {page+1}</span>
        <div className="toolbar-actions">
          <button className="btn btn-small" disabled={page===0 || loading} onClick={() => setPage(0)}>First</button>
          <button className="btn btn-small" disabled={page===0 || loading} onClick={() => setPage((x) => x-1)}><ChevronLeft size={13}/> Previous</button>
          <button className="btn btn-small" disabled={loading || (page+1)*50>=data.total} onClick={() => setPage((x) => x+1)}>Next <ChevronRight size={13}/></button>
          <button className="btn btn-small" disabled={loading || (page+1)*50>=data.total} onClick={() => setPage(Math.max(0,Math.ceil(data.total/50)-1))}>Last</button>
        </div></div>
    </section>}
  </div>;
}
