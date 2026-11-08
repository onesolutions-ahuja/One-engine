import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import { useState } from 'react';
import { Copy, Pencil, Search } from 'lucide-react';
import type { LightningAppMetadata } from '../../metadata/Definitions/metadata';
import './AppManagerList.css';

type Props = {
  apps: LightningAppMetadata[];
  busy: boolean;
  onEdit: (app: LightningAppMetadata) => void;
  onClone: (app: LightningAppMetadata) => void;
};

export default function AppManagerList({apps, busy, onEdit, onClone}: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'label'|'apiName'|'navigation'|'pages'>('label');
  const [descending, setDescending] = useState(false);
  const changeSort=(field: typeof sort)=>{if(field===sort)setDescending(value=>!value);else{setSort(field);setDescending(false);}};
  const filtered = apps.filter(app =>
    (app.label + ' ' + app.apiName + ' ' + app.description)
      .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ).sort((a, b) => {const result=sort==='label'?a.label.localeCompare(b.label):sort==='apiName'?a.apiName.localeCompare(b.apiName):sort==='navigation'?a.navigationItems.length-b.navigationItems.length:a.navigationPageApiNames.length-b.navigationPageApiNames.length;return descending?-result:result;});
  return <section className="app-manager-list surface" aria-label="Existing applications">
    <div className="app-manager-list-head">
      <div><h2>Existing Apps <span>{apps.length}</span></h2>
        <p>Select Edit to configure an app, or Clone to use its settings as a starting point.</p>
      </div>
      <label className="app-manager-list-search">
        <Search size={16} aria-hidden="true"/>
        <input type="search" value={search} aria-label="Search apps"
          onChange={event => setSearch(event.target.value)} placeholder="Search apps…"/>
      </label>
    </div>
    <div className="app-manager-mobile-sort">
      <label htmlFor="app-manager-sort-field">Sort applications</label>
      <select id="app-manager-sort-field" value={sort} onChange={event=>{setSort(event.target.value as typeof sort);setDescending(false);}}>
        <option value="label">App name</option><option value="apiName">Developer name</option>
        <option value="navigation">Navigation items</option><option value="pages">App pages</option>
      </select>
      <button type="button" className="app-manager-sort-direction"
        aria-label={descending?'Sort descending; change to ascending':'Sort ascending; change to descending'}
        aria-pressed={descending} title={descending?'Descending (switch to ascending)':'Ascending (switch to descending)'}
        onClick={()=>setDescending(value=>!value)}>{descending?'↓ Descending':'↑ Ascending'}</button>
    </div>
    <ResponsiveDataList rows={filtered} includeTablet includeNarrowDesktop getId={app=>app.apiName} label="Applications"
      onOpen={app=>onEdit(app)} openLabel="Edit application"
      columns={[
        {apiName:'name',label:'Application',phoneRole:'title',render:app=>app.label},
        {apiName:'apiName',label:'Developer name',phoneRole:'subtitle',render:app=>app.apiName},
        {apiName:'description',label:'Description',render:app=>app.description || '—'},
        {apiName:'pages',label:'Pages',phoneRole:'badge',render:app=>app.navigationPageApiNames.length+(app.navigationPageApiNames.length===1?' page':' pages')},
        {apiName:'navigation',label:'Navigation',phoneRole:'trailing',render:app=>app.navigationItems.length+(app.navigationItems.length===1?' item':' items')},
        {apiName:'actions',label:'Actions',render:app=><div className="app-manager-list-actions">
         <button type="button" className="btn" disabled={busy} aria-label={"Edit "+app.label} onClick={()=>onEdit(app)}>Edit</button>
         <button type="button" className="btn" disabled={busy} aria-label={"Clone "+app.label} onClick={()=>onClone(app)}>Clone</button>
        </div>}
      ]}/>
    <div className="app-manager-list-scroll md-mobile-table-replaced md-tablet-table-replaced">
      <table className="app-manager-list-table">
        <thead><tr>
          <th scope="col" aria-sort={sort==="label"?(descending?"descending":"ascending"):undefined}><button type="button" onClick={()=>changeSort("label")}>App {sort==='label'&&<span className="md-sort-indicator" aria-hidden="true">{descending?'↓':'↑'}</span>}</button></th>
          <th scope="col" aria-sort={sort==="apiName"?(descending?"descending":"ascending"):undefined}><button type="button" onClick={()=>changeSort("apiName")}>Developer Name {sort==='apiName'&&<span className="md-sort-indicator" aria-hidden="true">{descending?'↓':'↑'}</span>}</button></th>
          <th scope="col">Description</th>
          <th scope="col" aria-sort={sort==="navigation"?(descending?"descending":"ascending"):undefined}><button type="button" onClick={()=>changeSort("navigation")}>Navigation Items {sort==='navigation'&&<span className="md-sort-indicator" aria-hidden="true">{descending?'↓':'↑'}</span>}</button></th>
          <th scope="col" aria-sort={sort==="pages"?(descending?"descending":"ascending"):undefined}><button type="button" onClick={()=>changeSort("pages")}>App Pages {sort==='pages'&&<span className="md-sort-indicator" aria-hidden="true">{descending?'↓':'↑'}</span>}</button></th>
          <th scope="col">Actions</th>
        </tr></thead>
        <tbody>{filtered.map(app => <tr key={app.apiName}>
          <td><div className="app-manager-list-name">
            <span className="app-manager-list-color" style={{backgroundColor:app.brandColor}} aria-hidden="true"/>
            <span><strong>{app.label}</strong></span>
          </div></td>
          <td><code>{app.apiName}</code></td>
          <td title={app.description || ''}>{app.description || '—'}</td>
          <td>{app.navigationItems.length}</td>
          <td>{app.navigationPageApiNames.length}</td>
          <td><div className="app-manager-list-actions">
            <button type="button" className="btn btn-small" disabled={busy}
              aria-label={'Edit ' + app.label} onClick={() => onEdit(app)} title={'Edit ' + app.label}>
              <Pencil size={14} aria-hidden="true"/> Edit
            </button>
            <button type="button" className="btn btn-small" disabled={busy}
              aria-label={'Clone ' + app.label} onClick={() => onClone(app)} title={'Clone ' + app.label}>
              <Copy size={14} aria-hidden="true"/> Clone
            </button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="app-manager-list-result-count" role="status">{filtered.length} of {apps.length} apps shown</p>
    {!filtered.length && <div className="app-manager-list-empty">
      {apps.length ? 'No apps match your search. Try a different name.' : 'No apps created yet. Select New App to get started.'}
    </div>}
  </section>;
}
