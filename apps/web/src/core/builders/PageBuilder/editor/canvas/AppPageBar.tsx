import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { LightningAppMetadata, LightningPageMetadata } from '../../../../metadata/Definitions/metadata';
import { generateMetadataApiName, suggestMetadataApiName } from '../../../../metadata/Definitions/metadataApiNames';
import './AppPageBar.css';

const APP_PAGE_TYPES: ReadonlyArray<LightningPageMetadata['pageType']> = ['App Page', 'Home Page', 'In-Screen Page'];

/** Pages of one app (App, Home and In-Screen pages). Record pages and print templates are not app pages. */
export function appPagesOf(app: LightningAppMetadata | undefined, pages: readonly LightningPageMetadata[]): LightningPageMetadata[] {
  if (!app) return [];
  const listed = new Set(app.navigationPageApiNames ?? []);
  return pages.filter(item => APP_PAGE_TYPES.includes(item.pageType)
    && (listed.has(item.apiName) || item.activationAssignments?.some(a => a.appId === app.apiName)));
}

/** Bottom bar of Page Builder: switch between the pages of the app being edited.
 * + adds an App page or a Popup; double-click a name to rename it (kept as a draft until Save). */
export default function AppPageBar({ app, pages, current, onPick, onAdd, onRename, onDelete }: {
  app: LightningAppMetadata;
  pages: readonly LightningPageMetadata[];
  current: string;
  onPick: (apiName: string) => void;
  onAdd?: (type: 'App Page' | 'In-Screen Page', label: string) => void;
  onRename?: (label: string) => void;
  /** Red X on the open page: delete it permanently (asks first). */
  onDelete?: (apiName: string) => void;
}) {
  const list = appPagesOf(app, pages);
  const [renaming, setRenaming] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [newType, setNewType] = useState<'App Page' | 'In-Screen Page'>('App Page');
  const [newName, setNewName] = useState('');
  // The API name follows the name while typing (taken → _2, _3…); fixed once the screen is added.
  const newApiName = suggestMetadataApiName(generateMetadataApiName(newName), pages.map(item => item.apiName));
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { if (renaming && renaming === current) { finished.current = false; input.current?.focus(); input.current?.select(); } }, [renaming, current]);
  const finishRename = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    const label = value?.trim();
    const item = list.find(entry => entry.apiName === renaming);
    if (label && item && label !== item.label) onRename?.(label);
    setRenaming('');
  };
  if (!list.length && !onAdd) return null;
  return <nav className="app-page-bar" aria-label={'Pages of ' + app.label}>
    <div className="app-page-bar-tabs" role="tablist">
      {list.map(item => item.apiName === renaming && renaming === current
        ? <input key={item.apiName} ref={input} className="app-page-rename" aria-label="Page name" defaultValue={item.label}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === 'Enter') { event.preventDefault(); finishRename(event.currentTarget.value); }
              else if (event.key === 'Escape') { event.preventDefault(); finishRename(null); }
            }}
            onBlur={event => finishRename(event.currentTarget.value)} />
        : <button key={item.apiName} type="button" role="tab" aria-selected={item.apiName === current}
            className={'app-page-tab' + (item.apiName === current ? ' is-current' : '')}
            title={item.label + ' (' + item.pageType + ') · double-click to rename'}
            onClick={() => { if (item.apiName !== current) { setRenaming(''); onPick(item.apiName); } }}
            onDoubleClick={() => { if (!onRename) return; if (item.apiName !== current) onPick(item.apiName); setRenaming(item.apiName); }}>
            <span>{item.label}</span>{item.pageType === 'In-Screen Page' && <small>Popup</small>}
            {onDelete && item.apiName === current && <span role="button" tabIndex={0} className="app-page-delete"
              aria-label={'Delete ' + item.label + ' permanently'} title="Delete this page permanently"
              onClick={event => { event.stopPropagation(); onDelete(item.apiName); }}
              onDoubleClick={event => event.stopPropagation()}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onDelete(item.apiName); } }}>
              <X size={12} /></span>}
          </button>)}
      {onAdd && <button type="button" className="app-page-add" aria-label="Add a screen" title="Add a screen"
        onClick={() => { setNewType('App Page'); setNewName(''); setChoosing(true); }}><Plus size={15} /></button>}
    </div>
    {choosing && onAdd && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setChoosing(false); }}>
      <form className="modal app-page-add-dialog" role="dialog" aria-modal="true" aria-labelledby="app-page-add-title"
        onSubmit={event => { event.preventDefault(); if (!newName.trim() || !newApiName) return; setChoosing(false); onAdd(newType, newName.trim()); }}>
        <button type="button" className="app-page-add-close" aria-label="Close" onClick={() => setChoosing(false)}><X size={16} /></button>
        <h2 id="app-page-add-title">Add a screen</h2>
        <p>Choose how this screen should open in your app.</p>
        <div className="app-page-add-choices" role="radiogroup" aria-label="Screen type">
          <button type="button" role="radio" aria-checked={newType === 'App Page'} className={newType === 'App Page' ? 'is-chosen' : ''}
            onClick={() => setNewType('App Page')}><strong>App page</strong><small>A full screen in your app</small></button>
          <button type="button" role="radio" aria-checked={newType === 'In-Screen Page'} className={newType === 'In-Screen Page' ? 'is-chosen' : ''}
            onClick={() => setNewType('In-Screen Page')}><strong>Popup</strong><small>An overlay opened from another screen</small></button>
        </div>
        <label className="app-page-add-field"><span>Name</span>
          <input autoFocus required maxLength={80} value={newName} placeholder="e.g. Sales"
            onChange={event => setNewName(event.target.value)} /></label>
        <label className="app-page-add-field"><span>API name</span>
          <input readOnly tabIndex={-1} value={newApiName} aria-readonly="true" /></label>
        <small className="app-page-add-hint">Made from the name. It never changes after Add, even if you rename the screen; SCREEN formulas use it.</small>
        <div className="app-page-add-actions">
          <button type="button" className="btn" onClick={() => setChoosing(false)}>Cancel</button>
          <button type="submit" className="btn btn-brand" disabled={!newName.trim() || !newApiName}>Add</button>
        </div>
      </form>
    </div>}
  </nav>;
}
