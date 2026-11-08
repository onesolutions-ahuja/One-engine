import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import { useEffect, useMemo, useState } from 'react';
import type { LightningAppMetadata, LightningPageMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';
import { browserRoutePath, listPageRoutes } from './routeDirectory';

type RouteAlias = {
  appId: string; slug: string; kind: 'App Home' | 'App Page' | 'Record List';
  targetApiName: string; status: 'Active' | 'Disabled'; version: number;
};
type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export default function PageRouteDirectory({
  apps, pages, objects, initialAppId, selectedPageApiName, basePath, onClose, onNotify, request, canManage
}: {
  apps: LightningAppMetadata[];
  pages: LightningPageMetadata[];
  objects: ObjectMetadata[];
  initialAppId: string;
  /** Restrict page-specific access to the page currently open in the builder. */
  selectedPageApiName?: string;
  basePath: string;
  onClose: () => void;
  onNotify: (message: string) => void;
  request: ApiRequest;
  canManage: boolean;
}) {
  const [appId, setAppId] = useState(initialAppId);
  const [query, setQuery] = useState('');
  const [aliases, setAliases] = useState<RouteAlias[]>([]);
  const [aliasError, setAliasError] = useState('');
  const [aliasBusy, setAliasBusy] = useState(false);
  const [aliasAppId, setAliasAppId] = useState(initialAppId || apps[0]?.apiName || '');
  const [aliasSlug, setAliasSlug] = useState('');
  const [aliasRouteKey, setAliasRouteKey] = useState('');
  const [editing, setEditing] = useState<RouteAlias | null>(null);
  const entries = useMemo(
    () => listPageRoutes(apps, objects, pages, appId), [apps, objects, pages, appId]
  );
  const allEntries = useMemo(
    () => listPageRoutes(apps, objects, pages), [apps, objects, pages]
  );
  const candidateRoutes = allEntries.filter(route => route.appId === aliasAppId && route.available &&
    (!selectedPageApiName || route.targetApiName === selectedPageApiName));
  const chosen = candidateRoutes.find(route => route.key === aliasRouteKey);
  const search = query.trim().toLowerCase();
  const visible = entries.filter(route =>
    (!selectedPageApiName || route.targetApiName === selectedPageApiName) &&
    (route.appLabel + ' ' + route.kind + ' ' + route.targetLabel + ' ' + route.targetApiName
      + ' ' + route.path).toLowerCase().includes(search)
  );
  const visibleAliases = aliases.filter(alias =>
    (!appId || alias.appId === appId) &&
    (!selectedPageApiName || alias.targetApiName === selectedPageApiName) &&
    (alias.slug + ' ' + alias.appId + ' ' + alias.kind + ' ' + alias.targetApiName).toLowerCase().includes(search)
  );

  async function refreshAliases() {
    const data = await request<{ aliases: RouteAlias[] }>('/metadata/route-aliases');
    setAliases(data.aliases);
    setAliasError('');
  }
  useEffect(() => {
    let active = true;
    void request<{ aliases: RouteAlias[] }>('/metadata/route-aliases')
      .then(data => { if (active) { setAliases(data.aliases); setAliasError(''); } })
      .catch(error => { if (active) setAliasError(error instanceof Error ? error.message : 'Route alias registry unavailable'); });
    return () => { active = false; };
  }, [request]);
  async function copyRoute(path: string) {
    try {
      const relativePath = browserRoutePath(basePath, path);
      await navigator.clipboard.writeText(window.location.origin + relativePath);
      onNotify('Route copied');
    } catch {
      onNotify('Unable to copy route. Check clipboard permissions.');
    }
  }
  function aliasPath(alias: RouteAlias) {
    return '/une/apps/' + encodeURIComponent(alias.appId) + '/routes/' + encodeURIComponent(alias.slug);
  }
  function resetEditor() {
    setEditing(null); setAliasSlug(''); setAliasRouteKey('');
  }
  function editAlias(alias: RouteAlias) {
    setEditing(alias); setAliasAppId(alias.appId); setAliasSlug(alias.slug);
    setAliasRouteKey(allEntries.find(route => route.appId === alias.appId &&
      route.kind === alias.kind && route.targetApiName === alias.targetApiName)?.key ?? '');
    setAliasError('');
  }
  async function saveAlias() {
    if (!chosen || !/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(aliasSlug)) {
      setAliasError('Choose an active destination and a lowercase alias of 2–63 characters.');
      return;
    }
    const next = {
      appId: aliasAppId, slug: aliasSlug, kind: chosen.kind,
      targetApiName: chosen.targetApiName, status: 'Active' as const,
      expectedVersion: editing?.version ?? 0
    };
    if (editing && (editing.appId !== next.appId || editing.slug !== next.slug)) {
      setAliasError('Alias identity cannot be changed. Disable the old alias and create a new one.');
      return;
    }
    setAliasBusy(true);
    try {
      await request('/metadata/route-aliases/' + encodeURIComponent(next.appId) + '/' + encodeURIComponent(next.slug),
        { method: 'PUT', body: JSON.stringify(next) });
      await refreshAliases(); resetEditor(); onNotify('Route alias saved');
    } catch (error) {
      setAliasError(error instanceof Error ? error.message : 'Unable to save route alias');
    } finally { setAliasBusy(false); }
  }
  async function disableAlias(alias: RouteAlias) {
    setAliasBusy(true);
    try {
      await request('/metadata/route-aliases/' + encodeURIComponent(alias.appId) + '/' + encodeURIComponent(alias.slug),
        { method: 'DELETE', body: JSON.stringify({ expectedVersion: alias.version }) });
      await refreshAliases(); resetEditor(); onNotify('Route alias disabled; existing canonical URLs are unchanged');
    } catch (error) {
      setAliasError(error instanceof Error ? error.message : 'Unable to disable route alias');
    } finally { setAliasBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="page-route-directory-title"
      style={{ width: 'min(960px, 95vw)', maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto' }}>
      <div className="modal-header">
        <h2 id="page-route-directory-title">{selectedPageApiName ? 'Routes for this page' : 'Page routes'}</h2>
        <button type="button" className="btn btn-small" aria-label="Close page routes"
          onClick={onClose}>Close</button>
      </div>
      <p className="modal-copy">Routes use saved applications, pages and objects. A live link still requires
        the user's permissions. Draft or missing destinations cannot be opened.</p>
      <div className="permission-form-grid">
        <label className="form-label">Application
          <select className="form-control" aria-label="Filter routes by application"
            value={appId} onChange={event => setAppId(event.target.value)}>
            <option value="">All applications</option>
            {apps.map(app => <option key={app.apiName} value={app.apiName}>{app.label}</option>)}
          </select>
        </label>
        <label className="form-label">Search routes
          <input className="form-control" type="search" value={query} placeholder="Page, object or URL"
            onChange={event => setQuery(event.target.value)} />
        </label>
      </div>
      <ResponsiveDataList rows={visible} getId={route=>route.key} label="Page routes"
        columns={[
          {apiName:'target',label:'Destination',phoneRole:'title',render:route=>route.targetLabel},
          {apiName:'app',label:'Application',phoneRole:'subtitle',render:route=>route.appLabel},
          {apiName:'targetApiName',label:'Destination API Name',render:route=>route.targetApiName},
          {apiName:'status',label:'Status',phoneRole:'badge',render:route=>route.available?'Ready':route.reason},
          {apiName:'kind',label:'Type',phoneRole:'trailing',render:route=>route.kind},
          {apiName:'path',label:'Canonical path',render:route=><code>{browserRoutePath(basePath,route.path)}</code>},
          {apiName:'actions',label:'Actions',render:route=>route.available?<div className="toolbar-actions">
            <a className="btn" href={browserRoutePath(basePath,route.path)} target="_blank" rel="noopener noreferrer">Open</a>
            <button type="button" className="btn" onClick={()=>void copyRoute(route.path)}>Copy</button>
          </div>:<span>Not published</span>}
        ]}/>
      <div className="md-mobile-table-replaced">
      <table className="records-table" style={{ width: '100%' }} aria-label="Page route directory">
        <thead><tr><th>Application</th><th>Destination</th><th>Type</th><th>Destination API Name</th><th>Status</th><th>Canonical route</th><th>Actions</th></tr></thead>
        <tbody>
          {visible.map(route => {
            const fullPath = browserRoutePath(basePath, route.path);
            return <tr key={route.key} data-route-key={route.key}>
              <td>{route.appLabel}</td>
              <td><strong>{route.targetLabel}</strong></td>
              <td>{route.kind}</td><td title={route.targetApiName}>{route.targetApiName}</td>
              <td>{route.available ? 'Ready' : route.reason}</td>
              <td><code style={{ overflowWrap: 'anywhere' }}>{fullPath}</code></td>
              <td>
                {route.available
                  ? <>
                    <a className="btn btn-small" href={fullPath} target="_blank" rel="noopener noreferrer"
                      aria-label={'Open route ' + route.key}>Open</a>{' '}
                    <button className="btn btn-small" type="button"
                      aria-label={'Copy route ' + route.key}
                      onClick={() => void copyRoute(route.path)}>Copy</button>
                  </>
                  : <span className="properties-help">Not published</span>}
              </td>
            </tr>;
          })}
          {!visible.length && <tr><td colSpan={7}>No matching routes.</td></tr>}
        </tbody>
      </table></div>
      <h3>Friendly route aliases</h3>
      <p className="properties-help">Aliases resolve through current tenant permissions and saved metadata.
        Disabling an alias does not change its target page or existing canonical URLs.</p>
      {aliasError && <div className="auth-error" role="alert">{aliasError}</div>}
      <ResponsiveDataList rows={visibleAliases} getId={a=>a.appId+':'+a.slug} label="Route aliases"
        columns={[
          {apiName:'alias',label:'Alias',phoneRole:'title',render:a=>a.slug},
          {apiName:'app',label:'App',phoneRole:'subtitle',render:a=>apps.find(x=>x.apiName===a.appId)?.label??a.appId},
          {apiName:'status',label:'Status',phoneRole:'badge',render:a=>a.status},
          {apiName:'version',label:'Revision',phoneRole:'trailing',render:a=>'v'+a.version},
          {apiName:'path',label:'Path',render:a=>browserRoutePath(basePath,aliasPath(a))},
          {apiName:'actions',label:'Actions',render:a=><div className="toolbar-actions">
            {a.status==='Active'&&<button type="button" className="btn" onClick={()=>void copyRoute(aliasPath(a))}>Copy</button>}
            {canManage&&<button className="btn" type="button" disabled={aliasBusy} onClick={()=>editAlias(a)}>Edit</button>}
            {canManage&&<button className="btn" type="button" disabled={aliasBusy||a.status==='Disabled'}
              onClick={()=>void disableAlias(a)}>Disable</button>}
          </div>}
        ]}/>
      <div className="md-mobile-table-replaced">
      <table className="records-table" style={{ width: '100%' }} aria-label="Route aliases">
        <thead><tr><th>Application</th><th>Alias</th><th>Target</th><th>Status / revision</th><th>Actions</th></tr></thead>
        <tbody>
          {visibleAliases.map(alias => {
            const path = aliasPath(alias);
            const available = allEntries.some(entry => entry.appId === alias.appId && entry.kind === alias.kind
              && entry.targetApiName === alias.targetApiName && entry.available);
            return <tr key={alias.appId + ':' + alias.slug}>
              <td>{apps.find(app => app.apiName === alias.appId)?.label ?? alias.appId}</td>
              <td><code>{browserRoutePath(basePath, path)}</code></td>
              <td>{alias.kind} · {alias.targetApiName}</td>
              <td>{alias.status} · v{alias.version}{!available && ' · Target unavailable'}</td>
              <td>
                {alias.status === 'Active' && available && <>
                  <a className="btn btn-small" href={browserRoutePath(basePath, path)} target="_blank"
                    rel="noopener noreferrer" aria-label={'Test alias ' + alias.slug}>Test</a>{' '}
                  <button type="button" className="btn btn-small" onClick={() => void copyRoute(path)}>Copy</button>{' '}
                </>}
                {canManage && <>
                  <button type="button" className="btn btn-small" disabled={aliasBusy}
                    onClick={() => editAlias(alias)}>Edit</button>{' '}
                  <button type="button" className="btn btn-small" disabled={aliasBusy || alias.status === 'Disabled'}
                    onClick={() => void disableAlias(alias)}>Disable</button>
                </>}
              </td>
            </tr>;
          })}
          {!visibleAliases.length && <tr><td colSpan={5}>No route aliases found.</td></tr>}
        </tbody>
      </table></div>
      {canManage && <section className="setup-card" aria-label="Route alias editor">
        <h3>{editing ? 'Edit route alias' : 'Create route alias'}</h3>
        <div className="permission-form-grid">
          <label className="form-label">Application
            <select className="form-control" aria-label="Alias application" value={aliasAppId}
              disabled={!!editing} onChange={event => { setAliasAppId(event.target.value); setAliasRouteKey(''); }}>
              {apps.map(app => <option key={app.apiName} value={app.apiName}>{app.label}</option>)}
            </select>
          </label>
          <label className="form-label">Destination
            <select className="form-control" aria-label="Alias destination" value={aliasRouteKey}
              onChange={event => setAliasRouteKey(event.target.value)}>
              <option value="">Select a published destination</option>
              {candidateRoutes.map(entry => <option key={entry.key} value={entry.key}>{entry.kind} · {entry.targetLabel}</option>)}
            </select>
          </label>
          <label className="form-label">Friendly URL name
            <input className="form-control" aria-label="Friendly URL name" value={aliasSlug}
              disabled={!!editing} placeholder="shop-home" onChange={event => setAliasSlug(event.target.value.toLowerCase())} />
          </label>
        </div>
        {aliasAppId && aliasSlug && <p className="properties-help">Preview: <code>
          {browserRoutePath(basePath, '/une/apps/' + encodeURIComponent(aliasAppId) + '/routes/' +
            encodeURIComponent(aliasSlug.replace(/[^a-z0-9-]/g, '')))}</code></p>}
        <button className="btn btn-brand btn-small" type="button" disabled={aliasBusy}
          onClick={() => void saveAlias()}>{editing ? 'Save alias revision' : 'Create alias'}</button>{' '}
        {editing && <button className="btn btn-small" type="button" onClick={resetEditor}>Cancel edit</button>}
      </section>}
    </section>
  </div>;
}
