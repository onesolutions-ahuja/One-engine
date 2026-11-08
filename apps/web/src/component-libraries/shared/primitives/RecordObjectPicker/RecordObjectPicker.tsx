import {useMemo,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {useDismissOnOutside} from '../../../../core/accessibility/Dismiss/useDismissOnOutside';
import type {NavigableObject} from '../../recordTypes';

export function RecordObjectPicker({
  objects, selected, onSelect
}: { objects: NavigableObject[]; selected: string; onSelect: (apiName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  useDismissOnOutside(wrap, open, () => { setOpen(false); setQuery(''); });
  const available = useMemo(() => Array.from(new Map(objects.map(item => [item.apiName, item])).values())
    .sort((a, b) => a.pluralLabel.localeCompare(b.pluralLabel)), [objects]);
  const counts = useMemo(() => { const n = new Map<string, number>(); for (const item of available) { const key = item.pluralLabel.trim().toLocaleLowerCase(); n.set(key, (n.get(key) ?? 0) + 1); } return n; }, [available]);
  const displayName = (item: NavigableObject) => {
    const raw = (item.pluralLabel || item.label || item.apiName).trim();
    const cleaned = raw === item.apiName || raw.toLowerCase() === (item.label + item.apiName).toLowerCase()
      ? (item.label || item.apiName).replace(/__c$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
      : raw;
    return counts.get(raw.toLocaleLowerCase())! > 1 ? `${cleaned} (${item.apiName})` : cleaned;
  };
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? available.filter(item =>
      `${item.pluralLabel} ${item.label} ${item.apiName}`.toLocaleLowerCase().includes(needle)) : available;
  }, [available, query]);
  const select = (apiName: string) => {
    setOpen(false); setQuery(''); setActiveIndex(0); onSelect(apiName);
  };
  const selectedObject = available.find(item => item.apiName === selected);
  const selectedLabel = selectedObject ? displayName(selectedObject) : undefined;
  return <div className="header-record-picker" ref={wrap}>
    <div className="header-record-picker-control">
      <input role="combobox" aria-label="Find record object" aria-haspopup="listbox"
        aria-autocomplete="list" aria-expanded={open} aria-controls="header-record-object-options"
        aria-activedescendant={open && matches.length ? `header-record-object-${activeIndex}` : undefined}
        value={open ? query : selectedLabel ?? ''} placeholder="Find records…"
        onFocus={() => { setOpen(true); setQuery(''); setActiveIndex(0); }}
        onClick={() => { setOpen(true); setQuery(''); setActiveIndex(0); }}
        onChange={event => { setOpen(true); setQuery(event.target.value); setActiveIndex(0); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); setQuery(''); }
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex(i => Math.min(i + 1, matches.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(i => Math.max(0, i - 1)); }
          if (event.key === 'Enter' && open && matches.length) { event.preventDefault(); select(matches[Math.min(activeIndex, matches.length - 1)].apiName); }
        }} />
      <ChevronDown size={15} aria-hidden="true" />
    </div>
    {open && <div id="header-record-object-options" className="header-record-picker-options" role="listbox" aria-label="Record objects">
      {matches.map((item, index) => <button id={`header-record-object-${index}`} key={item.apiName} role="option" type="button"
        aria-selected={item.apiName === selected} className={index === activeIndex ? 'selected' : ''}
        onMouseEnter={() => setActiveIndex(index)} onClick={() => select(item.apiName)}>
        <span>{displayName(item)}</span><small>{item.apiName}</small>
      </button>)}
      {matches.length === 0 && <p className="header-search-empty">No matching objects</p>}
    </div>}
  </div>;
}
