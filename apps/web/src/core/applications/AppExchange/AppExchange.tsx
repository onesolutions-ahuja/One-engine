import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BadgeCheck, ChevronRight, Download, LockKeyhole, PackageCheck, Puzzle, Search, ShieldCheck, X } from 'lucide-react';
import type { ConnectorApp, ConnectorFlowSummary, CommunicationPage, CredentialInput } from '../../integrations/ConnectorAppWorkspace/ConnectorAppWorkspace';
const ConnectorAppWorkspace = lazy(() => import('../../integrations/ConnectorAppWorkspace/ConnectorAppWorkspace'));
import type { NamedCredentialMetadata } from '../../metadata/Definitions/metadata';
import {PlatformPageSlot} from '../../platform/Workspace/PlatformPageSlot';

type Props = {
  credentials: NamedCredentialMetadata[];
  flows: ConnectorFlowSummary[];
  canManageCredentials: boolean;
  canView: boolean;
  canManageSecrets: boolean;
  canInstall: boolean;
  canManageFlows: boolean;
  encryptionReady: boolean | null;
  loadApps: () => Promise<ConnectorApp[]>;
  executeLifecycleFlow: (flowName: string, appKey: string) => Promise<void>;
  installApp: (appKey: string) => Promise<void>;
  uninstallApp: (appKey: string) => Promise<void>;
  grantLicence: (appKey: string) => Promise<void>;
  canManageLicences: boolean;
  onSave: (value: CredentialInput) => Promise<{credential: NamedCredentialMetadata; webhookVerifyToken?: string}>;
  onDelete: (id: string) => Promise<void>;
  loadHistory: (objectName: string, field: string, source: string, offset: number, search: string) => Promise<CommunicationPage>;
  onOpenRecord: (objectName: string, id: string) => void;
  onOpenFlow: (apiName: string) => void;
};

export default function AppExchange(props: Props) {
  const [apps, setApps] = useState<ConnectorApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All apps');
  const [view, setView] = useState<'discover'|'installed'>('discover');
  const [selected, setSelected] = useState<string | null>(null);
  const [openedKey, setOpenedKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await props.loadApps();
    setApps(rows);
  }, [props.loadApps]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void props.loadApps().then((rows) => { if (active) setApps(rows); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Cannot load AppExchange metadata'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.loadApps]);
  const categories = useMemo(() => ['All apps', ...Array.from(new Set(apps.map((app) => app.Category__c || 'Applications')))], [apps]);
  const visible = useMemo(() => apps.filter((app) =>
    (view === 'discover' || app.Installed__c) &&
    (category === 'All apps' || (app.Category__c || 'Applications') === category) &&
    (app.Name + ' ' + (app.Description__c || '') + ' ' + (app.Category__c || '')).toLowerCase().includes(query.trim().toLowerCase())
  ), [apps, view, category, query]);
  const installed = apps.filter((app) => app.Installed__c).length;
  const details = selected ? apps.find((app) => app.AppKey__c === selected) : undefined;
  const opened = openedKey ? apps.find((app) => app.AppKey__c === openedKey) : undefined;

  const action = async (app: ConnectorApp, operation: 'install'|'trial'|'uninstall'|'grant-install') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (operation === 'install') {
        if (app.LicenceStatus__c !== 'ACTIVE') throw new Error('An active app licence is required before installation');
        await props.installApp(app.AppKey__c);
      } else if (operation === 'grant-install') {
        if (!props.canManageLicences || !props.canInstall) throw new Error('Licence management permission required');
        await props.grantLicence(app.AppKey__c);
        await props.installApp(app.AppKey__c);
      } else if (operation === 'uninstall') {
        await props.uninstallApp(app.AppKey__c);
      } else {
        if (!app.TrialFlow__c) throw new Error('No trial activation Flow is configured for this app');
        await props.executeLifecycleFlow(app.TrialFlow__c, app.AppKey__c);
      }
      await refresh();
      setSelected(null);
      if (operation === 'uninstall') setOpenedKey(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to complete application lifecycle');
    } finally { setBusy(false); }
  };

  const uninstallFromCard = (app: ConnectorApp) => {
    if (busy || !props.canInstall || !app.Installed__c) return;
    if (!window.confirm('Uninstall ' + app.Name + '? Credentials and tenant records will be retained.')) return;
    void action(app, 'uninstall');
  };

  if (opened) return <Suspense fallback={<div role="status">Loading connector settings…</div>}><ConnectorAppWorkspace app={opened}
    credentials={props.credentials} flows={props.flows} canManageCredentials={props.canManageCredentials}
    canView={props.canView} canManageSecrets={props.canManageSecrets}
    canInstall={props.canInstall}
    canManageFlows={props.canManageFlows} encryptionReady={props.encryptionReady}
    onSave={props.onSave} onDelete={props.onDelete}
    loadHistory={props.loadHistory} onOpenRecord={props.onOpenRecord} onOpenFlow={props.onOpenFlow}
    onLifecycle={(app, operation) => action(app, operation)}
    onBack={() => {setOpenedKey(null);void refresh().catch(()=>{});}}/></Suspense>;

  return <div className="app-exchange">
    <div className="exchange-topline">
      <div className="exchange-breadcrumb"><span>Setup</span><ChevronRight size={13}/><strong>AppExchange</strong></div>
      <span className="exchange-preview-label"><BadgeCheck size={13}/> Tenant-scoped metadata</span>
    </div>
    <PlatformPageSlot slotKey="marketplace-search"><section className="exchange-hero">
      <div className="exchange-hero-copy">
        <div className="exchange-eyebrow"><Puzzle size={13}/> APP MARKETPLACE</div>
        <h1>Discover applications and connectors</h1>
        <p>Install only the applications your tenant needs. App code remains shared; tenant metadata and installation status are stored in SQL.</p>
        <PlatformPageSlot slotKey="field-marketplaceSearch"><label className="exchange-search"><Search size={17}/>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps and connectors" aria-label="Search AppExchange"/>
          {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14}/></button>}
        </label></PlatformPageSlot>
      </div>
    </section></PlatformPageSlot>
    <div className="exchange-content">
      {error && <div className="records-message" role="alert">{error}</div>}
      <PlatformPageSlot slotKey="marketplace-filters"><div className="exchange-tabs" role="tablist" aria-label="Marketplace views">
        <button role="tab" aria-selected={view === 'discover'} className={view === 'discover' ? 'active' : ''} onClick={() => setView('discover')}>Discover apps</button>
        <button role="tab" aria-selected={view === 'installed'} className={view === 'installed' ? 'active' : ''} onClick={() => setView('installed')}>Installed apps <span aria-live="polite">{loading ? 'Loading…' : error ? 'Unavailable' : installed}</span></button>
      </div>
      <div className="exchange-section-heading"><div><h2>{view === 'installed' ? 'Installed packages' : 'Available packages'}</h2>
        <p>Published package versions, installation status and licences come from tenant-scoped SQL metadata.</p></div>
        <div className="exchange-trust-note"><ShieldCheck size={16}/> Permission-aware setup</div>
      </div>
      <div className="exchange-category-row" aria-label="Filter by category">
        {categories.map((name) => <button key={name} className={category === name ? 'active' : ''} onClick={() => setCategory(name)}>{name}</button>)}
      </div>
      </PlatformPageSlot>
      {loading && <div className="records-loading">Loading app metadata…</div>}
      <PlatformPageSlot slotKey="marketplace-catalog"><div className="exchange-app-grid">
        {visible.map((app) => <article className="exchange-app-card" key={app.AppKey__c}>
          <div className="exchange-card-top">
            <span className="exchange-app-mark teal"><Puzzle size={23}/></span>
            <span className={app.Installed__c ? 'exchange-installed-tag' : 'exchange-price'}>{app.Installed__c ? 'Installed' : app.AppType__c === 'ConnectorApp' ? 'Connector App' : 'Application'}</span>
          </div>
          <button className="exchange-card-info" onClick={() => setSelected(app.AppKey__c)}>
            <strong>{app.Name}</strong><span>{app.AppType__c === 'ConnectorApp' ? 'Tenant connector' : 'Tenant application'} <BadgeCheck size={12}/></span>
            <p>{app.Description__c || 'Metadata-driven application package'}</p>
          </button>
          <div className="exchange-card-meta"><span>{app.Category__c || 'Applications'}</span>
            <span>{app.LicenceStatus__c === 'ACTIVE' ? 'Licence active' : 'Licence required'}{app.PackageVersion__c ? ' · v'+app.PackageVersion__c : ''}</span></div>
          <div className="exchange-card-footer">
            <span className="exchange-category-label">{app.Category__c || 'Applications'}</span>
            {app.Installed__c
              ? <div className="toolbar-actions">
                  <button className="btn btn-small btn-brand" disabled={busy} onClick={() => setSelected(app.AppKey__c)}>
                    {app.PackageVersion__c && app.PackageVersion__c > (app.InstalledPackageVersion__c ?? 0)
                      ? 'Update available' : 'Details'} <ArrowRight size={13}/></button>
                  <button className="btn btn-small btn-danger" disabled={busy || !props.canInstall}
                    aria-label={'Uninstall ' + app.Name} title={!props.canInstall ? 'App installation permission required' : undefined}
                    onClick={() => uninstallFromCard(app)}>
                    Uninstall
                  </button>
                </div>
              : <button className="btn btn-brand btn-small" onClick={() => setSelected(app.AppKey__c)}>Details <Download size={13}/></button>}
          </div>
        </article>)}
      </div>
      </PlatformPageSlot>
      {!loading && !visible.length && <div className="exchange-empty"><strong>No matching apps.</strong>
        <p>Check metadata permissions or adjust search filters.</p></div>}
      <div className="exchange-safe-note"><LockKeyhole size={15}/> Uninstall deactivates package resources while preserving saved credentials and tenant records.</div>
    </div>
    {details && <PlatformPageSlot slotKey="marketplace-details"><div className="exchange-backdrop" role="presentation" onMouseDown={(event) => {if (event.target === event.currentTarget) setSelected(null);}}>
      <section className="exchange-detail" role="dialog" aria-modal="true" aria-labelledby="app-detail-title">
        <button className="exchange-close" aria-label="Close" onClick={() => setSelected(null)}><X size={18}/></button>
        <div className="exchange-detail-head"><span className="exchange-app-mark green"><Puzzle size={25}/></span>
          <div><div className="exchange-detail-category">{details.Category__c || 'Applications'}</div>
            <h2 id="app-detail-title">{details.Name}</h2><div className="exchange-detail-publisher">Configured through metadata and Flows</div></div></div>
        <p className="exchange-detail-description">{details.Description__c}</p>
        <div className="exchange-detail-columns">
          <div><h3>Includes</h3><p>{details.AppType__c === 'ConnectorApp' ? 'HTTP callouts, credentials, connection settings and provider metadata.' : 'Published app metadata, navigation, pages and shared runtime components.'}</p></div>
          <div><h3>Access</h3><p>Uses existing tenant licensing, OneEngine permissions and shared platform services.</p></div>
        </div>
        <div className="exchange-data-note"><ShieldCheck size={15}/><span>Installing or updating preserves existing tenant data and customisations. Licences are checked server-side.</span></div>
        {!details.Installed__c && <div className="exchange-data-note"><LockKeyhole size={15}/>
          <span>Access is granted through user profiles and permission sets. Installation does not grant credentials access to every user.</span>
        </div>}
        <div className="exchange-detail-footer"><span><PackageCheck size={14}/> {details.AppType__c === 'ConnectorApp' ? 'Connector App' : 'Application'}</span>
          {details.Installed__c
            ? <>
                {details.PackageVersion__c && details.PackageVersion__c > (details.InstalledPackageVersion__c ?? 0) &&
                  <button className="btn btn-brand" disabled={busy || !props.canInstall || details.LicenceStatus__c !== 'ACTIVE'}
                    onClick={() => void action(details,'install')}>{busy ? 'Updating…' : 'Update package'}</button>}
                {details.AppType__c === 'ConnectorApp'
                  ? <button className="btn btn-brand" onClick={() => {setOpenedKey(details.AppKey__c);setSelected(null);}}>Configure connector</button>
                  : <span>Open this application using the app dropdown.</span>}
              </>
            : <button className="btn btn-brand" disabled={busy || !props.canInstall ||
                (details.LicenceStatus__c !== 'ACTIVE' && !props.canManageLicences)}
                onClick={() => void action(details,details.LicenceStatus__c === 'ACTIVE' ? 'install' : 'grant-install')}>
                {busy ? 'Installing…' : details.LicenceStatus__c === 'ACTIVE'
                  ? 'Confirm install' : props.canManageLicences ? 'Grant licence & install' : 'Licence required'} <ArrowRight size={14}/></button>}
        </div>
      </section>
    </div></PlatformPageSlot>}
  </div>;
}

