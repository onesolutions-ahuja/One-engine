import { useState } from 'react';
import { AtSign, ChevronLeft, ChevronRight, Database, Search, X } from 'lucide-react';
import './ReferenceBrowser.css';

/** One visual navigator for Object metadata and typed Flow resources. It never executes references. */
export type ReferenceOption = {
  reference: string;
  label: string;
  detail?: string;
  dataType?: string;
  disabled?: boolean;
  reason?: string;
};
export type ReferenceGroup = {
  path: string;
  label: string;
  detail?: string;
  options: ReferenceOption[];
};
type Props = {
  id: string;
  groups: readonly ReferenceGroup[];
  directOptions?: readonly ReferenceOption[];
  query: string;
  onQueryChange: (value: string) => void;
  onChoose: (reference: string) => void;
  onClose: () => void;
  emptyHint?: string;
};

const lower = (value: string) => value.toLocaleLowerCase();
export function filterReferenceBrowser(groups: readonly ReferenceGroup[], query: string) {
  const q = lower(query.trim().replace(/^@/, ''));
  if (!q) return [...groups];
  return groups.filter(group =>
    [group.path, group.label, group.detail ?? '', ...group.options.flatMap(option =>
      [option.label, option.detail ?? '', option.reference, option.dataType ?? ''])]
      .some(text => lower(text).includes(q)));
}

export default function ReferenceBrowser({
  id, groups, directOptions = [], query, onQueryChange, onChoose, onClose, emptyHint
}: Props) {
  const [selectedPath, setSelectedPath] = useState('');
  const q = query.trim().replace(/^@/, '');
  const auto = [...groups].sort((a, b) => b.path.length - a.path.length)
    .find(group => lower(q).startsWith(lower(group.path) + '.'));
  const path = auto?.path ?? selectedPath;
  const selected = groups.find(group => group.path === path);
  const search = auto ? q.slice(auto.path.length + 1) : q === selected?.path ? '' : q;
  const matching = (option: ReferenceOption) =>
    !search || [option.label, option.detail ?? '', option.reference, option.dataType ?? '']
      .some(text => lower(text).includes(lower(search)));
  const descendants = selected
    ? groups.filter(group => group.path.startsWith(path + '.') &&
      group.path.slice(path.length + 1).indexOf('.') === -1)
    : [];
  const visibleGroups = selected ? descendants : filterReferenceBrowser(groups, q)
    .filter(group => !groups.some(parent => group.path.startsWith(parent.path + '.')));
  // Searching for a related field must still show its parent Object to navigate into it.
  const rootGroups = selected ? visibleGroups : (q ? [
    ...visibleGroups, ...groups.filter(group => !visibleGroups.some(item => item.path === group.path)
      && group.path.includes('.') && filterReferenceBrowser([group], q).length)
      .map(group => groups.find(parent => group.path.startsWith(parent.path + '.') &&
        !parent.path.includes('.'))).filter((item): item is ReferenceGroup => Boolean(item))
  ] : visibleGroups);
  const uniqueGroups = [...new Map(rootGroups.map(group => [group.path, group])).values()];
  const items = (selected ? selected.options : directOptions).filter(matching);

  return <div className="metadata-reference-browser" id={id} role="dialog" aria-label="Choose a metadata reference">
    <div className="metadata-reference-header">
      {selected && <button type="button" aria-label="Back to available resources"
        onMouseDown={event => event.preventDefault()} onClick={() => { setSelectedPath(''); onQueryChange(''); }}>
        <ChevronLeft size={15}/>
      </button>}
      <Search size={14}/>
      <input aria-label="Search records, fields and relationships" autoFocus value={query}
        onChange={event => onQueryChange(event.target.value)}
        placeholder="Search resources, Objects and fields"/>
      <button type="button" aria-label="Close reference browser"
        onMouseDown={event => event.preventDefault()} onClick={onClose}><X size={14}/></button>
    </div>
    {selected && <div className="metadata-reference-breadcrumb">
      <Database size={13}/> {selected.label} <small>{selected.detail || selected.path}</small>
    </div>}
    <div className="metadata-reference-results">
      {uniqueGroups.map(group => <button type="button" key={group.path} className="metadata-reference-group"
        onMouseDown={event => event.preventDefault()}
        onClick={() => { setSelectedPath(group.path); onQueryChange(''); }}>
        <Database size={15}/><span><strong>{group.label}</strong><small>{group.detail || group.path}</small></span>
        <ChevronRight size={15}/>
      </button>)}
      {items.map(option => <button type="button" key={option.reference} className="metadata-reference-option"
        title={option.disabled ? option.reason : option.detail}
        disabled={option.disabled}
        onMouseDown={event => event.preventDefault()}
        onClick={() => onChoose(option.reference)}>
        <AtSign size={14}/><span><strong>{option.label}</strong>
          <small>{option.reason || option.detail || option.reference}</small></span>
        <small>{option.dataType || ''}</small>
      </button>)}
      {!uniqueGroups.length && !items.length &&
        <p className="metadata-reference-empty">{emptyHint ||
          'No available matching reference. Check Object Manager relationships, Flow record context and fields stored by Get Records.'}</p>}
    </div>
    <div className="metadata-reference-help">Fields come from Object Manager metadata. Only records available on this execution path can be used.</div>
  </div>;
}
