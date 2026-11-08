import {formulaFunctionPrefix,matchingFormulaFunctions,getFormulaFunctionNames} from '../../../../../../server/src/expression-engine/FormulaFunctionRegistry.js';
import { useId, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type Ref, type UIEvent } from 'react';
import { AtSign } from 'lucide-react';
import type { ObjectMetadata } from '../../../../core/metadata/Definitions/metadata';
import { mentionGroups, mentionSegments, type MentionKind } from './smartFieldMentions';
import ReferenceBrowser, { type ReferenceGroup } from '../ReferenceBrowser/ReferenceBrowser';
import './SmartFieldInput.css';

type InputElement = HTMLInputElement | HTMLTextAreaElement;
type Props = {
  value: string;
  onChange: (value: string) => void;
  objects?: readonly ObjectMetadata[];
  primaryObjectApiName?: string;
  appObjectApiNames?: readonly string[];
  kind?: MentionKind;
  multiline?: boolean;
  rows?: number;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  formulaContext?:'flow_formula'|'ribbon_binding';
  textareaRef?: Ref<HTMLTextAreaElement>;
};

function tokenAtCursor(value: string, cursor: number): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  const found = /(^|[\s([{,=:])@([A-Za-z0-9_.]*)$/.exec(before);
  return found ? { start: cursor - found[2].length - 1, query: found[2] } : null;
}

/** Shared no-code control for any string-capable component property or expression. */
export default function SmartFieldInput({
  value, onChange, objects = [], primaryObjectApiName = '', appObjectApiNames = [],
  kind = 'text', multiline = false, rows = 3, id, ariaLabel, placeholder,
  disabled = false, maxLength, textareaRef,formulaContext='flow_formula'
}: Props) {
  const inputRef = useRef<InputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const resultId = useId();
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [forced, setForced] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOverride, setSearchOverride] = useState(false);
  const token = tokenAtCursor(value, cursorRef.current);
  const functionQuery=kind==='formula'&&!forced?formulaFunctionPrefix(value.slice(0,cursorRef.current)):null;
  const completions=functionQuery?matchingFormulaFunctions(getFormulaFunctionNames(formulaContext),functionQuery):[];
  const hasSuggestion=(source:string,caret:number)=>Boolean(tokenAtCursor(source,caret)||
    kind==='formula'&&formulaFunctionPrefix(source.slice(0,caret)));
  const query = forced || searchOverride ? search : token?.query ?? '';
  const options = useMemo(() =>
    mentionGroups(objects, primaryObjectApiName, appObjectApiNames, '', kind),
    [objects, primaryObjectApiName, appObjectApiNames, kind]);
  const browserGroups: ReferenceGroup[] = options.map(group => ({
    path: group.path, label: group.primary ? group.label : group.path.split('.').at(-1) || group.label,
    detail: group.primary ? 'Current Object' : group.via,
    options: group.fields.map(field => ({
      reference: field.reference, label: field.fieldLabel, detail: field.reference,
      dataType: field.dataType
    }))
  }));
  const segments = mentionSegments(value, objects, kind, primaryObjectApiName);

  const putCursor = (next: number) => {
    cursorRef.current = next;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next, next);
    });
  };
  const onInput = (event: ChangeEvent<InputElement>) => {
    const next = event.target.value;
    cursorRef.current = event.target.selectionStart ?? next.length;
    onChange(next);
    setForced(false);
    setSearchOverride(false);
    setOpen(hasSuggestion(next,cursorRef.current));
  };
  const updateCursor = () => {
    cursorRef.current = inputRef.current?.selectionStart ?? value.length;
    if (!forced) setOpen(hasSuggestion(value,cursorRef.current));
  };
  const insert = (reference: string) => {
    const position = inputRef.current?.selectionStart ?? cursorRef.current;
    const end = inputRef.current?.selectionEnd ?? position;
    const active = !forced ? tokenAtCursor(value, position) : null;
    const from = active?.start ?? position;
    onChange(value.slice(0, from) + reference + value.slice(end));
    setOpen(false);
    setForced(false);
    setSearch('');
    setSearchOverride(false);
    putCursor(from + reference.length);
  };
  const common = {
    id,
    'aria-label': ariaLabel,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open,
    'aria-controls': open ? resultId : undefined,
    value, placeholder, disabled, maxLength,
    onChange: onInput,
    onClick: updateCursor,
    onKeyUp: (event: KeyboardEvent<InputElement>) => { if (event.key !== 'Escape') updateCursor(); },
    onScroll: (event: UIEvent<InputElement>) => {
      if (mirrorRef.current) {
        mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
        mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
      }
    },
    onKeyDown: (event: KeyboardEvent<InputElement>) => {
      if (event.key === 'Escape') { setOpen(false); setForced(false); setSearchOverride(false); }
    },
    onBlur: (event: FocusEvent<InputElement>) => {
      if (event.relatedTarget instanceof Node && editorRef.current?.contains(event.relatedTarget)) return;
      setOpen(false); setForced(false); setSearchOverride(false);
    }
  };
  return <div className="smart-field-editor" ref={editorRef}>
    <div className={'smart-field-input-wrap' + (multiline ? ' is-multiline' : '')}>
      <div ref={mirrorRef} className="smart-field-mirror" aria-hidden="true">
        {segments.map((part, index) => <span key={index} className={part.reference ? 'smart-field-reference' : undefined}>{part.text}</span>)}
        {multiline && '\n'}
      </div>
      {multiline
        ? <textarea {...common} ref={node => {
            inputRef.current = node;
            if (typeof textareaRef === 'function') textareaRef(node);
            else if (textareaRef) (textareaRef as { current: HTMLTextAreaElement | null }).current = node;
          }} className="form-control smart-field-control" rows={rows} />
        : <input {...common} ref={node => { inputRef.current = node; }} className="form-control smart-field-control" type="text" />}
      <button className="smart-field-trigger" type="button" aria-label="Insert dynamic field"
        title="Insert dynamic field (@)" disabled={disabled || !primaryObjectApiName || objects.length === 0}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { cursorRef.current = inputRef.current?.selectionStart ?? value.length; setForced(true); setSearchOverride(false); setSearch(''); setOpen(true); }}>
        <AtSign size={15} />
      </button>
    </div>
    {open&&!disabled&&functionQuery&&completions.length>0&&<div role="listbox" aria-label="Formula functions" id={resultId}>
      {completions.map(name=><button key={name} type="button" role="option" aria-selected={false}
       onMouseDown={event=>event.preventDefault()} onClick={()=>{
        const end=cursorRef.current,start=end-functionQuery.length;
        onChange(value.slice(0,start)+name+'('+value.slice(end));
        setOpen(false);putCursor(start+name.length+1);
       }}>{name}</button>)}
    </div>}
    {open && !functionQuery && !disabled && primaryObjectApiName && objects.length > 0 &&
      <ReferenceBrowser id={resultId} groups={browserGroups} query={query}
        onQueryChange={next => { setSearch(next); setSearchOverride(true); }}
        onChoose={insert} onClose={() => { setOpen(false); setForced(false); }}
        emptyHint="No matching field on this Object or its declared relationships. Create the relationship in Object Manager to navigate to a related Object."/>}
  </div>;
}
