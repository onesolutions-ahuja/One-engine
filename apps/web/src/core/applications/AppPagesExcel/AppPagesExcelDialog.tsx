import { useMemo, useState } from 'react';
import type { LightningAppMetadata, LightningPageMetadata } from '../../metadata/Definitions/metadata';
import { appPagesOf } from '../../builders/PageBuilder/editor/canvas/AppPageBar';
import { downloadPagesExcel } from '../../builders/PageBuilder/pageInventoryExcel';
import PageInventoryImportDialog from '../../builders/PageBuilder/PageInventoryImportDialog';
import './AppPagesExcelDialog.css';

type TypeFilter = 'all' | 'App Page' | 'Home Page' | 'In-Screen Page';

/** Pages of one app: tick the ones you want, filter by type, download them as one Excel file, or upload one. */
export default function AppPagesExcelDialog({ app, pages, request, onClose, onOpenPage, onApplied }: {
  app: LightningAppMetadata;
  pages: readonly LightningPageMetadata[];
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onClose: () => void;
  onOpenPage?: (apiName: string) => void;
  onApplied?: (pages: LightningPageMetadata[], changes: number) => void;
}) {
  const appPages = useMemo(() => appPagesOf(app, pages), [app, pages]);
  const [type, setType] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const shown = appPages.filter(item => (type === 'all' || item.pageType === type)
    && (item.label + ' ' + item.apiName).toLowerCase().includes(search.trim().toLowerCase()));
  const shownTicked = shown.filter(item => ticked.has(item.apiName));
  const toggle = (apiName: string) => setTicked(current => {
    const next = new Set(current); if (next.has(apiName)) next.delete(apiName); else next.add(apiName); return next;
  });
  const allShownTicked = shown.length > 0 && shownTicked.length === shown.length;
  // "Select all" ticks only what the filter shows.
  const toggleShown = () => setTicked(current => {
    const next = new Set(current);
    shown.forEach(item => { if (allShownTicked) next.delete(item.apiName); else next.add(item.apiName); });
    return next;
  });
  const download = async (chosen: readonly LightningPageMetadata[]) => {
    if (busy || !chosen.length) return;
    setBusy(true); setMessage('');
    try {
      const name = (chosen.length === 1 ? chosen[0].apiName : app.apiName + '_pages').toLowerCase();
      const failed = await downloadPagesExcel(request, chosen, 'Desktop', name);
      setMessage(failed.length ? 'Not included (could not be read): ' + failed.slice(0, 10).join(', ') : 'Downloaded ' + (chosen.length - failed.length) + ' page(s).');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to download the pages.'); }
    finally { setBusy(false); }
  };
  if (uploading) return <PageInventoryImportDialog request={request} onClose={() => setUploading(false)}
    onApplied={(updated, changes) => { setUploading(false); setMessage(changes + ' change(s) applied to ' + updated.length + ' page(s).'); onApplied?.(updated, changes); }} />;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal app-pages-excel" role="dialog" aria-modal="true" aria-labelledby="app-pages-excel-title">
      <h2 id="app-pages-excel-title">{app.label}: pages Excel</h2>
      <div className="app-pages-excel-filters">
        <select aria-label="Page type" value={type} onChange={event => setType(event.target.value as TypeFilter)}>
          <option value="all">All types</option><option value="App Page">App pages</option>
          <option value="Home Page">Home pages</option><option value="In-Screen Page">In-screen pages</option>
        </select>
        <input type="search" aria-label="Search pages" placeholder="Search pages…" value={search} onChange={event => setSearch(event.target.value)} />
      </div>
      <div className="app-pages-excel-list" role="group" aria-label="Pages">
        <label className="app-pages-excel-row app-pages-excel-all">
          <input type="checkbox" checked={allShownTicked} disabled={!shown.length} onChange={toggleShown} />
          <strong>Select all shown ({shown.length})</strong>
        </label>
        {shown.map(item => <div key={item.apiName} className="app-pages-excel-row">
          <label><input type="checkbox" checked={ticked.has(item.apiName)} onChange={() => toggle(item.apiName)} />
            <span>{item.label}</span><small>{item.pageType}</small></label>
          <span className="app-pages-excel-actions">
            {onOpenPage && <button type="button" className="btn btn-small" onClick={() => onOpenPage(item.apiName)}>Open</button>}
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void download([item])}>Download</button>
          </span>
        </div>)}
        {!shown.length && <p className="app-pages-excel-empty">{appPages.length ? 'No pages match the filters.' : 'This app has no pages yet.'}</p>}
      </div>
      {message && <p role="status" className="app-pages-excel-message">{message}</p>}
      <div className="app-pages-excel-footer">
        <button type="button" className="btn btn-brand" disabled={busy || !shownTicked.length} onClick={() => void download(shownTicked)}>
          {busy ? 'Downloading…' : 'Download ' + shownTicked.length + ' ticked'}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => setUploading(true)}>Upload Excel</button>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </section>
  </div>;
}
