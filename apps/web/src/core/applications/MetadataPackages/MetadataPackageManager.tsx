import {generateMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import {useViewportWidth} from '../../workspace/Responsive/useViewportWidth';
import { useCallback, useEffect, useState } from 'react';
import { Download, PackageCheck, RefreshCw, Upload } from 'lucide-react';
import './MetadataPackageManager.css';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Choice = { apiName: string; label: string };
type MetadataPackage = {
  package: { apiName: string; label: string; version: number; type: 'Managed'|'Unlocked' };
  dependencies: Array<{ type: string; apiName: string }>;
  contents: { objects: unknown[]; pages: unknown[]; components: unknown[];
    flows?: unknown[]; objectConfigurations?: unknown[]; permissionSets?: unknown[] };
  digest: string;
};
type Preview = {
  canInstall: boolean;
  operation: 'install'|'upgrade'|'reinstall';
  missingDependencies: Array<{ type: string; apiName: string }>;
  conflicts: Array<{ type: string; apiName: string; reason: string }>;
  preservedCustomizations: Array<{ type: string; apiName: string }>;
};
type InstalledPackage = {
  apiName: string; label: string; type: 'Managed'|'Unlocked';
  version: number; active: boolean;
};

export default function MetadataPackageManager({ request, permitted, canManage }: {
  request: Request;
  permitted: boolean;
  canManage: boolean;
}) {
  const viewportWidth=useViewportWidth();
  const [objects, setObjects] = useState<Choice[]>([]);
  const [pages, setPages] = useState<Choice[]>([]);
  const [components, setComponents] = useState<Choice[]>([]);
  const [flows, setFlows] = useState<Choice[]>([]);
  const [permissionSets, setPermissionSets] = useState<Choice[]>([]);
  const [installed, setInstalled] = useState<InstalledPackage[]>([]);
  const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [selectedFlows, setSelectedFlows] = useState<string[]>([]);
  const [selectedObjectConfigurations, setSelectedObjectConfigurations] = useState<string[]>([]);
  const [selectedPermissionSets, setSelectedPermissionSets] = useState<string[]>([]);
  const [packageApi, setPackageApi] = useState('');
  const [manualPackageApi,setManualPackageApi]=useState(false);
  const [packageLabel, setPackageLabel] = useState('');
  const [packageVersion, setPackageVersion] = useState(1);
  const [packageType, setPackageType] = useState<'Managed'|'Unlocked'>('Managed');
  const [artifact, setArtifact] = useState<MetadataPackage|null>(null);
  const [preview, setPreview] = useState<Preview|null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [optionalCatalogError, setOptionalCatalogError] = useState('');
  const [selectorQuery,setSelectorQuery]=useState<Record<string,string>>({});
  const [selectorPages,setSelectorPages]=useState<Record<string,number>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [objectsResult, pagesResult, componentsResult, packagesResult] = await Promise.all([
        request<{ objects: Array<{ apiName: string; label: string; kind: string }> }>('/metadata/objects'),
        request<{ pages: Array<{ apiName: string; label: string }> }>('/metadata/pages'),
        request<{ components: Array<{ apiName: string; label: string }> }>('/component-library'),
        request<{ packages: InstalledPackage[] }>('/metadata/packages')
      ]);
      setObjects(objectsResult.objects.filter(item => item.kind === 'Custom Object'));
      setPages(pagesResult.pages);
      setComponents(componentsResult.components);
      setInstalled(packagesResult.packages);
      const [flowResult, permissionResult] = await Promise.all([
        request<{ flows: Array<{ apiName: string; label: string }> }>('/metadata/flows')
          .catch(() => null),
        request<{ permissionSets: Array<{ apiName: string; label: string }> }>('/metadata/permissions')
          .catch(() => null)
      ]);
      setFlows(flowResult?.flows ?? []);
      setPermissionSets(permissionResult?.permissionSets ?? []);
      setOptionalCatalogError([
        ...(!flowResult ? ['Flow catalog unavailable (Flow Definition read permission required).'] : []),
        ...(!permissionResult ? ['Permission-set catalog unavailable (Security read permission required).'] : [])
      ].join(' '));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load tenant package metadata');
    } finally { setLoading(false); }
  }, [request]);

  useEffect(() => { if (permitted) void refresh(); }, [permitted, refresh]);

  const exportPackage = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ metadataPackage: MetadataPackage }>('/metadata/packages/export', {
        method: 'POST',
        body: JSON.stringify({
          apiName: packageApi, label: packageLabel, version: packageVersion, type: packageType,
          objects: selectedObjects, pages: selectedPages, components: selectedComponents,
          flows: selectedFlows, objectConfigurations: selectedObjectConfigurations,
          permissionSets: selectedPermissionSets
        })
      });
      const json = JSON.stringify(result.metadataPackage, null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = packageApi + '-v' + packageVersion + '.metadrive-package.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('Portable package exported. Share the file with an administrator of the destination tenant.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export metadata package');
    } finally { setBusy(false); }
  };

  const readPackage = async (file?: File) => {
    setArtifact(null); setPreview(null); setError(''); setNotice('');
    if (!file) return;
    if (file.size > 1_000_000) { setError('Package file exceeds the 1 MB limit.'); return; }
    try {
      const value: unknown = JSON.parse(await file.text());
      const result = await request<{ preview: Preview }>('/metadata/packages/preview', {
        method: 'POST', body: JSON.stringify({ metadataPackage: value })
      });
      setArtifact(value as MetadataPackage);
      setPreview(result.preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to inspect metadata package');
    }
  };

  const installPackage = async () => {
    if (!artifact || !preview?.canInstall || !canManage || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/metadata/packages/install', {
        method: 'POST', body: JSON.stringify({ metadataPackage: artifact })
      });
      setNotice('Package installed. Reload Setup to refresh the active metadata.');
      setArtifact(null); setPreview(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to install metadata package');
    } finally { setBusy(false); }
  };

  const uninstall = async (apiName: string) => {
    if (!canManage || busy || !window.confirm('Uninstall ' + apiName
      + '? Pages will be disabled, active Flows deactivated, and Objects, settings/layouts, permission sets,'
      + ' and shared components retained where needed.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ retainedObjects: string[]; retainedComponents: string[];
        retainedFlows: string[]; retainedObjectConfigurations: string[]; retainedPermissionSets: string[];
        disabledPages: string[]; disabledComponents: string[] }>(
        '/metadata/packages/' + encodeURIComponent(apiName) + '/uninstall', { method: 'POST' });
      setNotice('Package uninstalled. Retained Objects: ' + result.retainedObjects.join(', ')
        + (result.retainedFlows.length ? '; deactivated Flows retained: ' + result.retainedFlows.join(', ') : '')
        + (result.retainedObjectConfigurations.length
          ? '; Object settings/layouts retained: ' + result.retainedObjectConfigurations.join(', ') : '')
        + (result.retainedPermissionSets.length
          ? '; permission sets retained: ' + result.retainedPermissionSets.join(', ') : '')
        + (result.retainedComponents.length
          ? '; retained shared components: ' + result.retainedComponents.join(', ') : ''));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to uninstall metadata package');
    } finally { setBusy(false); }
  };

  if (!permitted) return null;
  const selector = (title: string, rows: Choice[], selected: string[], setSelected: (next: string[]) => void) => {
    const search=(selectorQuery[title]??'').trim().toLowerCase();
    const matches=rows.filter(item=>!search||(`${item.label} ${item.apiName}`).toLowerCase().includes(search));
    const shown=matches.slice(0,Math.max(1,selectorPages[title]??1)*25);
    const matchingIds=matches.map(item=>item.apiName);
    return <details className="metadata-package-selector-group" open={viewportWidth>600}>
      <summary>{title} ({selected.length} selected)</summary>
      <fieldset className="metadata-package-selector">
       <legend className="sr-only">{title} choices</legend>
      {rows.length>25 && <label className="form-label">Find {title.toLowerCase()}
        <input type="search" className="form-control" value={selectorQuery[title]??''}
          onChange={event=>{setSelectorQuery(prev=>({...prev,[title]:event.target.value}));setSelectorPages(prev=>({...prev,[title]:1}));}}
          placeholder="Filter by label or API name"/>
      </label>}
      {matches.length>0 && <div className="md-admin-actions">
        <button type="button" className="btn" onClick={()=>setSelected([...new Set([...selected,...matchingIds])])}>Select matching</button>
        <button type="button" className="btn" onClick={()=>setSelected(selected.filter(id=>!matchingIds.includes(id)))}>Clear matching</button>
        <small>{matches.length} matching · showing {shown.length}</small>
      </div>}
      {shown.length ? shown.map(item => <label key={item.apiName}>
        <input type="checkbox" checked={selected.includes(item.apiName)}
          onChange={event => setSelected(event.target.checked
            ? [...selected, item.apiName] : selected.filter(value => value !== item.apiName))} />
        <span>{item.label}<small>{item.apiName}</small></span>
      </label>) : <p>{rows.length?'No matching entries. Clear the search to see all items.':`No packageable ${title.toLowerCase()} found.`}</p>}
      {matches.length>shown.length&&<button type="button" className="btn" onClick={()=>setSelectorPages(prev=>({...prev,[title]:(prev[title]??1)+1}))}>Show next 25</button>}
      </fieldset>
    </details>;
  };

  return <section className="metadata-package-manager" aria-label="Metadata packages">
    <header><div><h2>Metadata packages &amp; change sets</h2>
      <p>Export a portable, versioned package from this tenant; inspect dependency checks before installing it in another tenant.</p></div>
      <button className="btn" type="button" disabled={loading || busy} onClick={() => void refresh()}>
        <RefreshCw size={14} /> Refresh
      </button></header>
    {error && <p role="alert" className="metadata-package-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">Loading tenant metadata…</p>}
    <div className="metadata-package-columns">
      <section>
        <h3><Download size={16} /> Outbound package</h3>
        <div className="metadata-package-form">
          <label>Package label<input value={packageLabel} maxLength={200}
            onChange={event => {setPackageLabel(event.target.value);if(!manualPackageApi)setPackageApi(generateMetadataApiName(event.target.value));}} placeholder="Retail Suite" /></label>
          <details><summary>Advanced: Package API Name</summary><label>Package API name<input value={packageApi} maxLength={128}
            onChange={event => {setManualPackageApi(true);setPackageApi(event.target.value);}} placeholder="RetailSuite" /></label></details>
          <p>API Name: {packageApi||'Generated from label'}</p>
          <label>Version<input type="number" min={1} step={1} value={packageVersion}
            onChange={event => setPackageVersion(Number(event.target.value))} /></label>
          <label>Package type<select value={packageType}
            onChange={event => setPackageType(event.target.value as 'Managed'|'Unlocked')}>
            <option value="Managed">Managed — package-owned metadata is locked</option>
            <option value="Unlocked">Unlocked — tenant edits are preserved on upgrades</option>
          </select></label>
        </div>
        {selector('Objects', objects, selectedObjects, setSelectedObjects)}
        {selector('Object settings & layouts', objects, selectedObjectConfigurations, setSelectedObjectConfigurations)}
        {selector('Pages', pages, selectedPages, setSelectedPages)}
        {selector('Components', components, selectedComponents, setSelectedComponents)}
        {selector('Flows (deploy as Draft)', flows, selectedFlows, setSelectedFlows)}
        {selector('Permission sets', permissionSets, selectedPermissionSets, setSelectedPermissionSets)}
        {optionalCatalogError && <p className="metadata-package-error" role="status">{optionalCatalogError}</p>}
        <p className="permission-help">Export requires a package label, a valid API name, and at least one selected item. Unavailable choices require metadata read permissions.</p>
        <button className="btn btn-primary" type="button" disabled={busy || !permitted
          || !packageApi.trim() || !packageLabel.trim() || !Number.isSafeInteger(packageVersion)
          || packageVersion < 1 || !selectedObjects.length && !selectedObjectConfigurations.length
            && !selectedPages.length && !selectedComponents.length && !selectedFlows.length
            && !selectedPermissionSets.length}
          onClick={() => void exportPackage()}><Download size={14} /> Export package</button>
      </section>
      <section>
        <h3><Upload size={16} /> Inbound package</h3>
        <label className="metadata-package-upload">Choose a package file
          <input type="file" accept=".json,.metadrive-package.json,application/json"
            onChange={event => void readPackage(event.target.files?.[0])} />
        </label>
        {artifact && preview && <div className="metadata-package-preview">
          <strong>{artifact.package.label} · v{artifact.package.version} · {artifact.package.type}</strong>
          <span>Operation: {preview.operation}</span>
          <span>Dependency check: {preview.canInstall ? 'Ready' : 'Blocked'}</span>
          {preview.missingDependencies.length > 0 && <ul>{preview.missingDependencies.map(item =>
            <li key={item.type + item.apiName}>Missing {item.type}: {item.apiName}</li>)}</ul>}
          {preview.conflicts.length > 0 && <ul>{preview.conflicts.map(item =>
            <li key={item.type + item.apiName}>{item.type} {item.apiName}: {item.reason}</li>)}</ul>}
          {preview.preservedCustomizations.length > 0 && <p>Unlocked customer changes will be preserved for: {
            preview.preservedCustomizations.map(item => item.apiName).join(', ')}</p>}
          <button className="btn btn-primary" type="button" disabled={!preview.canInstall || !canManage || busy}
            onClick={() => void installPackage()}><PackageCheck size={14} /> Install / upgrade</button>
        </div>}
        <h3>Installed packages</h3>
        {installed.length === 0 && <p>No metadata packages installed.</p>}
        <ul className="metadata-package-installed">
          {installed.map(item => <li key={item.apiName}><span><strong>{item.label}</strong>
            <small>{item.apiName} · {item.type} · v{item.version} · {item.active ? 'Active' : 'Uninstalled'}</small></span>
            {item.active && <button className="btn" type="button" disabled={!canManage || busy}
              onClick={() => void uninstall(item.apiName)}>Uninstall</button>}
          </li>)}
        </ul>
      </section>
    </div>
  </section>;
}
