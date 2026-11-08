import { useState } from 'react';
import type { FlowDefinitionMetadata, FlowResourceMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';
import FlowReferenceInput from '../FlowReferenceInput/FlowReferenceInput';

type Mode = 'query' | 'body' | 'response';
type Row = { path: string; value: string; type: 'Text' | 'Number' | 'Boolean' | 'Null' | 'Resource' };
type Props = {
  label: string;
  mode: Mode;
  value: string;
  onChange: (value: string) => void;
  resources: FlowResourceMetadata[];
  fields: ObjectMetadata['fields'];
  /** When given, text values accept @ $ ! like every other Flow value box. */
  picker?: { flow: FlowDefinitionMetadata; elementId: number; objects: readonly ObjectMetadata[] };
};

function flatten(value: unknown, prefix = ''): Row[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, prefix ? `${prefix}[${index}]` : `[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key));
  }
  const type: Row['type'] = value === null ? 'Null' : typeof value === 'boolean' ? 'Boolean' : typeof value === 'number' ? 'Number' : typeof value === 'string' && /^\{![^}]+\}$/.test(value) ? 'Resource' : 'Text';
  return prefix ? [{ path: prefix, value: value === null ? '' : String(value), type }] : [];
}

function toObject(rows: Row[], mode: Mode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    if (!row.path.trim() || row.path === '__proto__' || row.path === 'constructor' || row.path === 'prototype') continue;
    const value: unknown = mode === 'response' || row.type === 'Text' || row.type === 'Resource' ? row.value
      : row.type === 'Number' ? Number(row.value)
      : row.type === 'Boolean' ? row.value === 'true' : null;
    if (mode !== 'body') { result[row.path] = value; continue; }
    const parts = row.path.match(/[^.[\]]+/g) ?? [];
    if (!parts.length || parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) continue;
    let cursor: Record<string, unknown> | unknown[] = result;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const key: string | number = Array.isArray(cursor) && /^\d+$/.test(part) ? Number(part) : part;
      if (last) { (cursor as Record<string, unknown>)[key] = value; return; }
      const next = parts[index + 1];
      const existing = (cursor as Record<string, unknown>)[key];
      if (!existing || typeof existing !== 'object') {
        (cursor as Record<string, unknown>)[key] = /^\d+$/.test(next) ? [] : {};
      }
      cursor = (cursor as Record<string, unknown>)[key] as Record<string, unknown>;
    });
  }
  return result;
}

export default function HttpCalloutFieldEditor({ label, mode, value, onChange, resources, fields, picker }: Props) {
  const [search, setSearch] = useState('');
  const [advanced, setAdvanced] = useState(false);
  let rows: Row[] = [];
  let legacy = false;
  try {
    const parsed: unknown = value.trim() ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) legacy = true;
    else rows = flatten(parsed);
  } catch { legacy = Boolean(value.trim()); }
  const update = (next: Row[]) => onChange(JSON.stringify(toObject(next, mode)));
  const choices = [
    ...fields.map((field) => ({ label: `Record → ${field.label} (${field.apiName})`, value: `{!$Record.${field.apiName}}` })),
    ...resources.map((resource) => ({ label: `Resource → ${resource.label} (${resource.name})`, value: `{!${resource.name}}` }))
  ].filter((choice) => choice.label.toLowerCase().includes(search.toLowerCase()));
  return <div className="flow-config-list">
    <strong>{label}</strong>
    {mode !== 'response' && <label className="form-label"><input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} /> Advanced value types</label>}
    {legacy ? <div className="info-callout" role="alert">This saved callout uses an older request format. Its existing value is preserved. Select Replace with field mapping to edit it using fields; this will replace that value.
      <button className="text-action" type="button" onClick={() => onChange('{}')}>Replace with field mapping</button>
    </div> : <>
      {advanced && <input className="form-control" aria-label={`Search ${label} fields`} placeholder="Search available record fields and resources" value={search} onChange={(event) => setSearch(event.target.value)} />}
      {rows.map((row, index) => <div className="flow-config-row" key={index}>
        {mode==='response' ? <select className="form-control" aria-label={label+' target variable'}
          value={row.path} onChange={event=>update(rows.map((item,i)=>i===index?{...item,path:event.target.value}:item))}>
          <option value="">Choose Flow variable</option>
          {row.path&&!resources.some(resource=>resource.name===row.path&&resource.type==='Variable')
            &&<option value={row.path} disabled>Missing: {row.path}</option>}
          {resources.filter(resource=>resource.type==='Variable'&&!resource.isCollection)
            .map(resource=><option key={resource.name} value={resource.name}>{resource.label} ({resource.name})</option>)}
        </select> : <input className="form-control" aria-label={`${label} field path`}
          placeholder="Key" value={row.path}
          onChange={event=>update(rows.map((item,i)=>i===index?{...item,path:event.target.value}:item))} />}
        {advanced && mode !== 'response' && <select className="form-control" aria-label={`${label} value type`} value={row.type} onChange={(event) => update(rows.map((item, i) => i === index ? { ...item, type: event.target.value as Row['type'], value: event.target.value === 'Boolean' ? 'false' : item.value } : item))}>
          {['Text', 'Number', 'Boolean', 'Null', 'Resource'].map((type) => <option key={type}>{type}</option>)}
        </select>}
        {row.type === 'Resource' && mode !== 'response' ? <select className="form-control" aria-label={`${label} resource`} value={row.value} onChange={(event) => update(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))}>
          <option value="">Select a field or resource</option>
          {row.value && !choices.some((choice) => choice.value === row.value) && <option value={row.value}>{row.value}</option>}
          {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select> : row.type === 'Boolean' && mode !== 'response' ? <select className="form-control" aria-label={`${label} value`} value={row.value} onChange={(event) => update(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))}><option value="false">False</option><option value="true">True</option></select> : row.type === 'Null' && mode !== 'response' ? <span>Null</span> : picker && mode !== 'response' && row.type === 'Text' ? <FlowReferenceInput ariaLabel={`${label} value`} value={row.value} flow={picker.flow} elementId={picker.elementId} objects={picker.objects} onChange={(next) => update(rows.map((item, i) => i === index ? { ...item, value: next } : item))} /> : <input className="form-control" aria-label={`${label} value`} placeholder={mode === 'response' ? 'Response field path, e.g. messages[0].id' : 'Value'} value={row.value} onChange={(event) => update(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />}
        <button className="row-menu" type="button" aria-label="Remove field" onClick={() => update(rows.filter((_, i) => i !== index))}>×</button>
      </div>)}
      <button className="text-action" type="button" onClick={() => update([...rows, { path: mode==='response' ? resources.find(r=>r.type==='Variable'&&!r.isCollection&&!rows.some(row=>row.path===r.name))?.name??'' : `field_${rows.length + 1}`, value: '', type: 'Text' }])}>+ Add Field</button>
    </>}
  </div>;
}
