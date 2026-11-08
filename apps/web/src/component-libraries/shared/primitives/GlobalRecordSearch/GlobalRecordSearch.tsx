import type * as React from 'react';
import {useEffect,useRef,useState,useCallback} from 'react';
import {Search,X} from 'lucide-react';
import {createPortal} from 'react-dom';
import {useModalAccessibility} from '../../../../core/accessibility/Modal/useModalAccessibility';
import type {NavigableObject,SearchableRecord} from '../../recordTypes';

export function GlobalRecordSearch({
  objects, searchObject, onSelect, navigationItems = [], onNavigateItem, onOpenObject
}: {
  objects: NavigableObject[];
  searchObject: (apiName: string, term: string) => Promise<{ records: SearchableRecord[] }>;
  onSelect: (objectApiName: string, recordId: string) => void;
  /** RBAC-filtered destinations supplied by the owning workspace. */
  navigationItems?: ReadonlyArray<{ id:string; label:string; group?:string }>;
  onNavigateItem?: (id:string) => void;
  onOpenObject?: (apiName:string) => void;
}) {
  const [query, setQuery] = useState('');
  const shortcutLabel=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/i.test(navigator.platform)?'⌘ K':'Ctrl K';
  const [results, setResults] = useState<Array<{ object: NavigableObject; record: SearchableRecord }>>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [checked, setChecked] = useState(0);
  const [failures, setFailures] = useState(0);
  const requestId = useRef(0);
  const wrap = useRef<HTMLFormElement>(null);
  const palette = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); requestId.current++; setBusy(false); }, []);
  useModalAccessibility(open, palette, close);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        searchInput.current?.focus();
      }
    };
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, []);
  useEffect(() => () => { requestId.current++; }, []);

  const performSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) { setOpen(true); setSearched(false); return; }
    const id = ++requestId.current;
    setResults([]); setChecked(0); setFailures(0); setBusy(true); setSearched(true); setOpen(true);
    // Bounded concurrency: a tenant may have hundreds of custom objects.
    let next = 0;
    const worker = async () => {
      while (next < objects.length && requestId.current === id) {
        const object = objects[next++];
        try {
          const payload = await searchObject(object.apiName, term);
          if (requestId.current !== id) return;
          if (payload.records.length) setResults(current => [
            ...current, ...payload.records.map(record => ({ object, record }))
          ]);
        } catch {
          if (requestId.current !== id) return;
          setFailures(count => count + 1); // RBAC remains enforced by the record API.
        } finally {
          if (requestId.current === id) setChecked(count => count + 1);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, objects.length) }, () => worker()));
    if (requestId.current === id) setBusy(false);
  };
  const updateQuery = (value: string) => { setQuery(value); setSearched(false); requestId.current++; setBusy(false); setResults([]); };
  const navigationMatches = navigationItems.filter(item =>
    `${item.label} ${item.group ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ).slice(0,12);
  const searchForm = (inPalette: boolean) => <form role="search" onSubmit={event => void performSearch(event)}>
    <button type="submit" className="global-search-submit" aria-label="Search all records"><Search size={18} /></button>
    <input ref={inPalette ? searchInput : undefined} type="search" aria-label="Global record search"
      placeholder="Search records, pages and settings…" value={query} onChange={event => updateQuery(event.target.value)} />
  </form>;
  return <>
    <button type="button" className="global-search global-record-search palette-trigger"
      aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" onClick={() => setOpen(true)}>
      <Search size={16} aria-hidden="true" /><span>Search records and navigation</span><kbd>{shortcutLabel}</kbd>
    </button>
    {open && createPortal(<div className="palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="palette-dialog" role="dialog" aria-modal="true" aria-label="Global search command palette" ref={palette} tabIndex={-1}>
        <div className="palette-toolbar">{searchForm(true)}<button type="button" className="icon-button" aria-label="Close search" onClick={close}><X size={18}/></button></div>
        <div className="palette-results">
          <h3>Navigation</h3>
          {navigationMatches.map(item => <button key={item.id} type="button"
            onClick={() => {close();onNavigateItem?.(item.id);}}>
            <strong>{item.label}</strong><small>{item.group ?? 'Page'}</small>
          </button>)}
          {objects.filter(object => `${object.pluralLabel} ${object.apiName}`.toLowerCase().includes(query.toLowerCase())).slice(0,12).map(object =>
            <button key={object.apiName} type="button" onClick={() => {
              if (onOpenObject) { close();onOpenObject(object.apiName); }
              else { updateQuery(object.pluralLabel);searchInput.current?.focus(); }
            }}>
              <strong>{object.pluralLabel}</strong><small>{onOpenObject ? 'Open object list' : 'Search records'} · {object.apiName}</small>
            </button>)}
          <h3>Records</h3>
          {query.trim().length < 2 ? <p>Enter at least two characters and press Enter to search.</p> : <>
            <p role="status">{busy ? `Searching ${checked}/${objects.length} objects…` : searched ? `${results.length} matches` : 'Press Enter to search'}</p>
            {results.map(({object,record}) => <button type="button" key={`${object.apiName}:${record.Id}`}
              onClick={() => { close(); onSelect(object.apiName, record.Id); }}>
              <strong>{String(record.Name ?? record.Email ?? record.Id)}</strong><small>{object.pluralLabel}</small>
            </button>)}
            {searched && !busy && !results.length && <p>No matching accessible records.</p>}
            {searched && !busy && failures > 0 && <p>Some objects could not be searched. Server permissions remain enforced.</p>}
          </>}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
