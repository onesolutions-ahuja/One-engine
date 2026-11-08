import {validateRecordFilterFormula} from '../../../../core/pages/PageRuntime/recordFilterFormula';
import FormulaSignatureGuide from '../../../../core/builders/PageBuilder/FormulaSignatureGuide';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';
import { ChevronDown, Plus, Search, Trash2 } from 'lucide-react';
import type { FieldMetadata,ObjectMetadata } from '../../../../core/metadata/Definitions/metadata';
import SmartFieldInput from '../SmartFieldInput/SmartFieldInput';
import {mentionGroups} from '../SmartFieldInput/smartFieldMentions';
import {
  examineRecordFilter, isBooleanFilterField, isNumericFilterField, supportedFilterOperators
} from '../../../../core/records/RecordWorkspace/recordFilterMetadata';
import './RecordFilterEditor.css';

type Filter = {field: string; operator: string; value: unknown};
type DynamicValue = {source?: string; key?: string; skipWhenBlank?: boolean; allWhenStar?: boolean};
type StateChoice={source:'PageState'|'CollectionState';key:string;label:string};
const isFilter = (item: unknown): item is Filter =>
  Boolean(item && typeof item === 'object' && !Array.isArray(item));
const isBlank = (operator: string) => operator === 'Is Blank' || operator === 'Is Not Blank';
const dateInputType = (field?: FieldMetadata): 'date'|'datetime-local'|'time'|'text' => {
  const type = (field?.dataType ?? '').replace(/^Formula\((.*)\)$/i, '$1');
  return /^(Date\/Time|DateTime)$/i.test(type) ? 'datetime-local'
    : /^Date$/i.test(type) ? 'date' : /^Time$/i.test(type) ? 'time' : 'text';
};
const isPicklist = (field?: FieldMetadata) =>
  /^(Picklist|Multi-Select Picklist|Multipicklist)$/i.test(field?.dataType ?? '');


/** Search within the field selector: every accessible field is shown before typing. */
function FilterFieldCombobox({
  value, fields, related, label, onChange
}: {
  value: string;
  fields: FieldMetadata[];
  related: FieldMetadata[];
  label: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState({top: 0, left: 0, width: 240, maxHeight: 260});
  const listId = useId();
  const match = (item: FieldMetadata) =>
    (item.label + ' ' + item.apiName).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const currentFields = fields.filter(match);
  const relatedFields = related.filter(match);
  const available = [...currentFields, ...relatedFields];
  const selected = [...fields, ...related].find(item => item.apiName === value);
  useLayoutEffect(() => {
    if (!open) return;
    // Portal the picker outside the scrolling dialog body, and keep it anchored
    // to its field trigger when the dialog or viewport scrolls.
    const positionDropdown = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = Math.max(0, window.innerHeight - rect.bottom - 8);
      const above = Math.max(0, rect.top - 8);
      const placeAbove = below < 260 && above > below;
      const availableHeight = placeAbove ? above : below;
      const maxHeight = Math.max(70, Math.min(260, availableHeight - 4));
      const width = Math.min(Math.max(240, rect.width), Math.max(100, window.innerWidth - 16));
      setPlacement({
        top: placeAbove ? Math.max(8, rect.top - maxHeight - 3)
          : Math.max(8, Math.min(rect.bottom + 3, window.innerHeight - maxHeight - 8)),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        maxHeight
      });
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) setOpen(false);
    };
    positionDropdown();
    searchRef.current?.focus();
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', positionDropdown);
    window.addEventListener('scroll', positionDropdown, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', positionDropdown);
      window.removeEventListener('scroll', positionDropdown, true);
    };
  }, [open]);
  const choose = (apiName: string) => {
    onChange(apiName);
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  };
  const handleKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // Escape should close only this picker, not the entire filter dialog.
      setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (available.length) setActiveIndex(index =>
        (index + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length);
    } else if (event.key === 'Enter' && available.length) {
      event.preventDefault();
      choose(available[Math.min(activeIndex, available.length - 1)].apiName);
    }
  };
  const option = (item: FieldMetadata, index: number) =>
    <button key={item.apiName} type="button" role="option" tabIndex={-1}
      id={listId + '-option-' + index} aria-selected={item.apiName === value}
      className={index === activeIndex ? 'is-highlighted' : ''}
      onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item.apiName)}>
      <span>{item.label}</span><small>{item.apiName}</small>
    </button>;
  return <div className="metadata-filter-field-picker" ref={containerRef}
    onBlur={event => {
      const next = event.relatedTarget as Node | null;
      if (!containerRef.current?.contains(next) && !dropdownRef.current?.contains(next)) setOpen(false);
    }}>
    <button ref={triggerRef} type="button" className="metadata-filter-field-trigger" role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      onClick={() => {setOpen(previous => !previous); setQuery(''); setActiveIndex(0);}}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
          setQuery('');
          setActiveIndex(0);
        }
      }}>
      <span className={!value ? 'is-placeholder' : ''}>{selected?.label ?? (value ? 'Missing: ' + value : 'Choose field…')}</span>
      <ChevronDown size={15} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={dropdownRef} className="metadata-filter-field-dropdown"
      style={{top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight}}>
      <span className="metadata-filter-field-search"><Search size={15} aria-hidden="true"/>
        <input ref={searchRef} type="search" value={query} placeholder="Search fields…"
          aria-label={'Search ' + label} aria-controls={listId}
          aria-activedescendant={available.length ? listId + '-option-' + Math.min(activeIndex, available.length - 1) : undefined}
          onKeyDown={handleKeys}
          onChange={event => {setQuery(event.target.value); setActiveIndex(0);}}/>
      </span>
      <div className="metadata-filter-field-options" id={listId} role="listbox" aria-label={label}>
        {currentFields.length > 0 && <div role="group" aria-label="Current Object">
          <strong>Current Object</strong>
          {currentFields.map((item, index) => option(item, index))}
        </div>}
        {relatedFields.length > 0 && <div role="group" aria-label="Related Lookup Fields">
          <strong>Related Lookup Fields</strong>
          {relatedFields.map((item, index) => option(item, currentFields.length + index))}
        </div>}
        {!available.length && <p>No matching accessible fields.</p>}
      </div>
    </div>, document.body)}
  </div>;
}

/** Shared no-code filter editor: all types and choices come from accessible Field metadata. */
export default function RecordFilterEditor({
  title, fields, filters, onChange, logic = 'AND', onLogicChange, objects = [], rootObjectApiName = '',
  formula = '', onFormulaChange, mode, onModeChange, compact = false, stateOptions = []
}: {
  title: string;
  fields: FieldMetadata[];
  objects?:readonly ObjectMetadata[];
  rootObjectApiName?:string;
  filters: unknown[];
  onChange: (next: unknown[]) => void;
  logic?: 'AND'|'OR';
  onLogicChange?: (next: 'AND'|'OR') => void;
  formula?:string;
  onFormulaChange?:(value:string)=>void;
  mode?:'Field'|'Formula';
  onModeChange?:(next:'Field'|'Formula')=>void;
  compact?:boolean;
  stateOptions?:readonly StateChoice[];
}) {
  const [fieldSearch, setFieldSearch] = useState('');
  const [formulaCaret,setFormulaCaret]=useState<number>(0);
  const [manualStateIndex,setManualStateIndex]=useState<number|null>(null);
  const related=mentionGroups(objects,rootObjectApiName,[],'','text')
    .filter(group=>!group.primary).flatMap(group=>group.fields.flatMap(item=>{
      const field=objects.find(object=>object.apiName===item.objectApiName)
        ?.fields.find(candidate=>candidate.apiName===item.fieldApiName);
      return field?[{...field,apiName:item.reference,label:group.via+' → '+item.fieldLabel}]:[];
    }));
  const allFields=[...fields,...related];
  // The first editable row exists before the first filter is saved.
  const set = (index: number, patch: Partial<Filter>) =>
    onChange(index === filters.length && filters.length < 20
      ? [...filters, {field:'',operator:'Equals',value:'',...patch}]
      : filters.map((entry, i) => i === index ? { ...(isFilter(entry) ? entry : {}), ...patch } : entry));
  const remove = (index: number) => onChange(filters.filter((_, i) => i !== index));
  const add = (field = '') => {
    if (filters.length >= 20) return;
    onChange([...filters, { field, operator: 'Equals', value: '' }]);
    setFieldSearch('');
  };
  const effectiveMode = onFormulaChange && mode === 'Formula' ? 'Formula' : 'Field';
  const query = fieldSearch.trim().toLocaleLowerCase();
  const matchingFields = query
    ? allFields.filter(item => (item.label + ' ' + item.apiName).toLocaleLowerCase().includes(query)).slice(0, 20)
    : [];
  const formulaError = effectiveMode === 'Formula' ? validateRecordFilterFormula(formula,allFields) : null;
  return <section className={'metadata-record-filter-editor' + (compact ? ' is-compact' : '')} aria-label={title + ' filter editor'}>
    <div className="metadata-filter-intro">
      <div>
        <div className="metadata-filter-intro-heading">
          <strong>{title}</strong>
          {onFormulaChange && onModeChange && <div className="metadata-filter-mode" role="group" aria-label="Filter method">
            <button type="button" aria-pressed={effectiveMode === 'Field'} className={effectiveMode === 'Field' ? 'is-active' : ''}
              onClick={() => onModeChange('Field')}>Field</button>
            <button type="button" aria-pressed={effectiveMode === 'Formula'} className={effectiveMode === 'Formula' ? 'is-active' : ''}
              onClick={() => onModeChange('Formula')}>Formula</button>
          </div>}
          {compact && effectiveMode === 'Field' && <label className="metadata-filter-logic">
            <span>Match conditions</span>
            <select aria-label="Filter match logic" value={logic} disabled={!onLogicChange}
              onChange={e => onLogicChange?.(e.target.value === 'OR' ? 'OR' : 'AND')}>
              <option value="AND">All conditions (AND)</option>
              <option value="OR">Any condition (OR)</option>
            </select>
          </label>}
        </div>
        <p>{effectiveMode === 'Formula' ? 'Write a formula to filter records.' : 'Choose a field, operator and value to filter records.'}</p>
      </div>
      {effectiveMode === 'Field' && <span className="metadata-filter-count">{filters.length}/20 conditions</span>}
    </div>
    {effectiveMode === 'Field' && <>
    {!compact && <div className="metadata-filter-toolbar">
      <label className="metadata-filter-search">
        <span>Find a field</span>
        <span className="metadata-filter-search-input"><Search size={16} aria-hidden="true"/>
          <input type="search" value={fieldSearch} placeholder="Search available fields"
            onChange={e => setFieldSearch(e.target.value)}/>
        </span>
      </label>
      <label className="metadata-filter-logic"><span>Match conditions</span>
        <select aria-label="Filter match logic" value={logic} disabled={!onLogicChange}
          onChange={e => onLogicChange?.(e.target.value === 'OR' ? 'OR' : 'AND')}>
          <option value="AND">All conditions (AND)</option>
          <option value="OR">Any condition (OR)</option>
        </select>
      </label>
    </div>}
    {!compact && query && <div className="metadata-filter-search-results" role="region" aria-label="Matching fields">
      {matchingFields.length ? matchingFields.map(item => <button type="button" key={item.apiName}
        disabled={filters.length >= 20} onClick={() => add(item.apiName)}>
        <Plus size={15} aria-hidden="true"/> {item.label} <small>{item.apiName}</small>
      </button>) : <p>No matching accessible fields.</p>}
    </div>}
    </>}
    {effectiveMode === 'Formula' && onFormulaChange && <section className="metadata-filter-formula" aria-label="Record filter formula">
      <label><strong>Filter Formula</strong>
        <span onSelectCapture={event=>setFormulaCaret((event.target as HTMLTextAreaElement).selectionStart)}
          onKeyUpCapture={event=>setFormulaCaret((event.target as HTMLTextAreaElement).selectionStart)}>
          <SmartFieldInput multiline rows={3} kind="formula" formulaContext="ribbon_binding" objects={objects}
            primaryObjectApiName={rootObjectApiName} value={formula} onChange={onFormulaChange}
            ariaLabel={title+' filter formula'} placeholder={'IF(ISBLANK($state.categoryId), TRUE, @MenuCategory = $state.categoryId)'}/>
        </span>
      </label>
      <FormulaSignatureGuide value={formula} caret={formulaCaret}/>
      <small>Use @Field, $state.key, IF, ISBLANK and AND/OR. The formula is applied to authorised records before pagination.</small>
      {formulaError && <p role="alert" className="metadata-filter-error">{formulaError}</p>}
    </section>}
    {effectiveMode === 'Field' && <>
    <div className="metadata-filter-conditions">
      {(filters.length ? filters : [{field:'',operator:'Equals',value:''}]).map((entry, index) => {
        const raw: Partial<Filter> = isFilter(entry) ? entry : {};
        const fieldName = typeof raw.field === 'string' ? raw.field : '';
        const field = allFields.find(candidate => candidate.apiName === fieldName);
        const operator = typeof raw.operator === 'string' ? raw.operator : 'Equals';
        const dynamic = raw.value && typeof raw.value === 'object' && !Array.isArray(raw.value)
          ? raw.value as DynamicValue : undefined;
        const source = dynamic?.source ?? 'Fixed';
        const stateSource=source==='CollectionState'||source==='PageState';
        const value = dynamic ? '' : String(raw.value ?? '');
        const operators = supportedFilterOperators(field);
        const error = filters.length === 0 ? null : examineRecordFilter(entry, allFields);
        const errorTarget = !error ? null :
          /^(Choose a field|This field is unavailable|Invalid saved filter)/.test(error) ? 'field' :
          /^This operator/.test(error) ? 'operator' :
          /^(Enter a Page State key|Invalid optional Page State|Choose a named Collection State|Invalid Collection State)/.test(error) ? 'state' :
          /^Choose an accessible field/.test(error) ? 'expression' :
          /^Choose a valid dynamic filter source/.test(error) ? 'source' : 'value';
        const inlineError = (target: string) => compact && errorTarget === target
          ? <small role="alert" className="metadata-filter-inline-error">{error}</small> : null;
        const valueType = dateInputType(field);
        const valueControl = isBooleanFilterField(field)
          ? <select aria-label={title + ' value ' + (index + 1)} value={value}
              onChange={e => set(index, {value: e.target.value})}>
              <option value="">Choose value…</option>
              <option value="true">True</option><option value="false">False</option>
            </select>
          : isPicklist(field)
            ? <select aria-label={title + ' value ' + (index + 1)} value={value}
                onChange={e => set(index, {value: e.target.value})}>
                <option value="">Choose value…</option>
                {value && !field?.picklistValues?.includes(value) && <option value={value} disabled>Unavailable: {value}</option>}
                {field?.picklistValues?.map(choice => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            : <input aria-label={title + ' value ' + (index + 1)}
                type={isNumericFilterField(field) ? 'number' : valueType}
                step={isNumericFilterField(field) ? 'any' : undefined}
                placeholder={field ? 'Enter a value' : 'Choose a field first'}
                disabled={!field} value={value} onChange={e => set(index, {value: e.target.value})}/>;
        return <div key={index} className="metadata-filter-condition" data-filter-index={index}>
          <div className="metadata-filter-condition-heading">
            <strong>Condition {index + 1}</strong>
            {filters.length > 0 && <button type="button" aria-label={'Remove condition ' + (index + 1)} onClick={() => remove(index)}>
              <Trash2 size={16} aria-hidden="true"/>{!compact && ' Remove'}
            </button>}
          </div>
          <div className="metadata-filter-condition-grid">
            {compact ? <div className="metadata-filter-cell"><span>Field</span>{inlineError('field')}
              <FilterFieldCombobox value={fieldName} fields={fields} related={related}
                label={title + ' field ' + (index + 1)}
                onChange={next => set(index, {field: next, operator: 'Equals', value: ''})}/>
              </div> : <label><span>Field</span>
                <select aria-label={title + ' field ' + (index + 1)} value={fieldName}
                  onChange={e => set(index, {field: e.target.value, operator: 'Equals', value: ''})}>
                  <option value="">Choose field…</option>
                  {fieldName && !field && <option value={fieldName} disabled>Missing: {fieldName}</option>}
                  <optgroup label="Current Object">
                    {fields.map(item => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
                  </optgroup>
                  {related.length>0&&<optgroup label="Related Lookup Fields">
                    {related.map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
                  </optgroup>}
                </select>
              </label>}
            <label><span>Operator</span>{inlineError('operator')}
              <select aria-label={title + ' operator ' + (index + 1)} value={operator}
                disabled={!field} onChange={e => set(index, {operator: e.target.value, value: ''})}>
                {!operators.includes(operator as typeof operators[number]) &&
                  <option value={operator} disabled>Unsupported: {operator}</option>}
                {operators.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {!isBlank(operator) && <label><span>Value source</span>{inlineError('source')}
              <select aria-label={title + ' value source ' + (index + 1)} value={stateSource?'PageState':source}
                disabled={!field} onChange={e => set(index, {value: e.target.value === 'Fixed' ? ''
                  : e.target.value === 'PageState' ? {source: 'PageState', key: ''}
                  : {source: e.target.value}})}>
                <option value="Fixed">Fixed value</option>
                <option value="PageState">State (Collection / Page State)</option>
                <option value="FieldExpression">@ Field or related lookup</option>
                <option value="CurrentRecord">Current record ID</option>
                <option value="Session">Current session ID</option>
              </select>
            </label>}
            {!isBlank(operator) && (source === 'FieldExpression'
              ? <label><span>Related field expression</span>{inlineError('expression')}
                  <SmartFieldInput value={dynamic?.key??''}
                    onChange={key=>set(index,{value:{source:'FieldExpression',key}})}
                    objects={objects} primaryObjectApiName={rootObjectApiName}
                    ariaLabel={title+' comparison field '+(index+1)} kind="text"
                    placeholder="@Field or @Object.Relationship.Field"/>
                </label>
              : stateSource
              ? <label><span>State value</span>{inlineError('state')}
                  {stateOptions.length>0&&<select aria-label={title+' available state '+(index+1)}
                    value={manualStateIndex===index?'manual':stateOptions.some(option=>
                      option.source===source&&option.key===dynamic?.key)?source+':'+dynamic?.key:''}
                    onChange={e=>{
                      if(e.target.value==='manual'){
                        setManualStateIndex(index);
                        set(index,{value:{source:'PageState',key:'',skipWhenBlank:true,allWhenStar:true}});
                        return;
                      }
                      setManualStateIndex(null);
                      const choice=stateOptions.find(option=>option.source+':'+option.key===e.target.value);
                      if(choice)set(index,{value:{source:choice.source,key:choice.key,skipWhenBlank:true,
                        allWhenStar:choice.source==='PageState'}});
                    }}>
                    <option value="">Choose state…</option>
                    {stateOptions.filter(option=>option.source==='CollectionState').length>0&&
                      <optgroup label="Named Collections">
                        {stateOptions.filter(option=>option.source==='CollectionState').map(option=>
                          <option key={option.source+option.key} value={option.source+':'+option.key}>{option.label}</option>)}
                      </optgroup>}
                    {stateOptions.filter(option=>option.source==='PageState').length>0&&
                      <optgroup label="Page / Flow State">
                        {stateOptions.filter(option=>option.source==='PageState').map(option=>
                          <option key={option.source+option.key} value={option.source+':'+option.key}>{option.label}</option>)}
                      </optgroup>}
                    <option value="manual">Enter state key manually…</option>
                  </select>}
                  {(stateOptions.length===0||manualStateIndex===index
                   ||Boolean(dynamic?.key&&!stateOptions.some(choice=>
                       choice.source===source&&choice.key===dynamic.key)))&&
                    <input aria-label={title + ' page state key ' + (index + 1)}
                      value={dynamic?.key ?? ''} placeholder="e.g. categoryId"
                      onChange={e => set(index, {value: {...dynamic,source: 'PageState', key: e.target.value}})}/>}
                </label>
              : source === 'Fixed' ? <label><span>Value</span>{inlineError('value')}{valueControl}</label> : null)}
          </div>
          {!isBlank(operator) && stateSource && <label className="metadata-filter-optional">
            <input type="checkbox" aria-label={title + ' ignore blank page state ' + (index + 1)}
              checked={dynamic?.skipWhenBlank === true}
              onChange={e => set(index,{value:{...dynamic,source,skipWhenBlank:e.target.checked}})}/>
            <span>Ignore condition when State value is blank</span>
            <small>Blank → skip this condition. Collection '*' is a field-specific wildcard criterion; optional legacy Page State All (*) skips only when explicitly configured. AND/OR still applies.</small>
          </label>}
          {!compact && error && <p role="alert" className="metadata-filter-error">{error}</p>}
        </div>;
      })}
    </div>
    <div className="metadata-filter-footer">
      <button type="button" className="metadata-filter-add" disabled={!allFields.length || filters.length >= 20}
        onClick={() => add()}><Plus size={16} aria-hidden="true"/> Add condition</button>
      {!allFields.length && <span>Select an Object with accessible fields first.</span>}
      {filters.length >= 20 && <span>Maximum 20 conditions per source.</span>}
    </div>
    </>}
  </section>;
}
