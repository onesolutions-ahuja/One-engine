import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import './ChecklistMultiSelect.css';

export type ChecklistChoice = {
  value: string;
  label: string;
  meta?: string;
  disabled?: boolean;
};

type Props = {
  label: string;
  choices: readonly ChecklistChoice[];
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
};

/** A reusable controlled visual selector; domain rules remain in the parent metadata editor. */
export default function ChecklistMultiSelect({
  label, choices, values, onChange, placeholder = 'Select items…',
  searchPlaceholder = 'Search…', emptyText = 'No matching items.', disabled = false
}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {setOpen(false);window.requestAnimationFrame(()=>trigger.current?.focus());};
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault();close();}
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    searchInput.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const filtered = useMemo(() => choices.filter(choice =>
    (choice.label + ' ' + choice.value + ' ' + (choice.meta ?? ''))
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ), [choices, query]);
  const optionsByValue = new Map(choices.map(choice => [choice.value, choice]));
  const toggle = (value: string) => onChange(values.includes(value)
    ? values.filter(item => item !== value)
    : [...values, value]);

  return <div className="md-checklist" ref={root}>
    <div className="md-checklist-control" aria-label={label}>
      <div className="md-checklist-chips">
        {values.map(value => <span key={value} className="md-checklist-chip">
          <span title={optionsByValue.get(value)?.meta ?? value}>{optionsByValue.get(value)?.label ?? value}</span>
          <button type="button" disabled={disabled} aria-label={`Remove ${optionsByValue.get(value)?.label ?? value} from ${label}`}
            onClick={() => toggle(value)}><X size={12}/></button>
        </span>)}
        <button ref={trigger} className="md-checklist-trigger" type="button" disabled={disabled} aria-expanded={open}
          aria-haspopup="dialog" aria-controls={id + '-options'}
          aria-label={label + (values.length ? ` (${values.length} selected)` : '')}
          onClick={() => { setQuery(''); setOpen(state => !state); }}>
          {!values.length && <span>{placeholder}</span>}
          <ChevronDown size={16} className={open ? 'md-checklist-chevron-open' : ''}/>
        </button>
      </div>
      {values.length > 0 && <button type="button" className="md-checklist-clear"
        disabled={disabled} onClick={() => onChange([])}
        aria-label={'Clear ' + label} title="Clear selection"><X size={14}/></button>}
    </div>
    {open && <div className="md-checklist-popover" id={id + '-options'} role="dialog" aria-modal="false" aria-label={label + " selection"}>
      <div className="md-checklist-search"><Search size={15}/>
        <input ref={searchInput} type="search" value={query} aria-label={'Search ' + label}
          onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder}/>
      </div>
      <div className="md-checklist-options" role="group" aria-label={label + ' options'}>
        {filtered.map(choice => <label className={'md-checklist-option' + (choice.disabled ? ' md-checklist-option-disabled' : '')} key={choice.value}>
          <input type="checkbox" checked={values.includes(choice.value)} disabled={disabled || choice.disabled}
            onChange={() => toggle(choice.value)}/>
          <span className="md-checklist-option-title">{choice.label}
            <small>{choice.value}</small>
          </span>
          {choice.meta && <small className="md-checklist-option-meta">{choice.meta}</small>}
        </label>)}
        {!filtered.length && <p className="md-checklist-empty">{emptyText}</p>}
      </div>
      <div className="md-checklist-footer"><span>{values.length} selected</span>
        <button type="button" onClick={close} style={{minHeight:40,minWidth:72}}><Check size={13}/> Done</button>
      </div>
    </div>}
  </div>;
}
