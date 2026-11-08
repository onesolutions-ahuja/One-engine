import type { LibraryComponentMetadata } from '../../metadata/Definitions/metadata';
import { validateFlowScreenUpload } from './flowScreenUploadValidation.mjs';
import { validFlowScreenSelection } from './flowScreenDataTableSelection.mjs';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';

type ScreenConfig = Record<string, unknown>;
type ScreenRecord = Record<string, unknown>;

type FlowScreenAdvancedFieldProps = {
  field: ScreenConfig;
  libraryComponents: LibraryComponentMetadata[];
  label: string;
  inputId: string;
  helpId: string;
  helpText: string;
  value: unknown;
  values: Record<string, unknown>;
  setValue: (value: unknown) => void;
  loadRecords: (objectApiName: string) => Promise<ScreenRecord[]>;
  onError: (message: string) => void;
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function recordLabel(record: ScreenRecord): string {
  return String(record.Name ?? record.Id ?? '');
}

function readFile(file: File): Promise<{ name: string; type: string; size: number; content: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read "${file.name}"`));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Unable to read "${file.name}"`));
        return;
      }
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        content: reader.result
      });
    };
    reader.readAsDataURL(file);
  });
}

export default function FlowScreenAdvancedField({
  field,
  libraryComponents,
  label,
  inputId,
  helpId,
  helpText,
  value,
  values,
  setValue,
  loadRecords,
  onError
}: FlowScreenAdvancedFieldProps): ReactNode {
  const type = String(field.type ?? '');
  const required = field.required === true;
  const help = helpText ? <small className="settings-panel-copy" id={helpId}>{helpText}</small> : null;

  if (type === 'Address' || type === 'Name') {
    const parts = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const addressParts = [
      ['street', 'Street', 'text'],
      ['city', 'City', 'text'],
      ['state', 'State/Province', 'text'],
      ['postalCode', 'Postal Code', 'text'],
      ['country', 'Country', 'text']
    ];
    const nameParts = [
      ['salutation', 'Salutation', 'text'],
      ['firstName', 'First Name', 'text'],
      ['middleName', 'Middle Name', 'text'],
      ['lastName', 'Last Name', 'text'],
      ['suffix', 'Suffix', 'text']
    ];
    const partsToRender = type === 'Address' ? addressParts : nameParts;
    return <fieldset className="form-label flow-screen-composite" aria-describedby={helpText ? helpId : undefined}>
      <legend>{label}{required ? ' *' : ''}</legend>
      <div className="flow-screen-composite-grid">
        {partsToRender.map(([part, partLabel, inputType]) => {
          const partId = `${inputId}-${part}`;
          return <label className="form-label" htmlFor={partId} key={part}>
            {partLabel}
            <input id={partId} className="form-control" type={inputType}
              required={required && (type === 'Address' ? part === 'street' || part === 'city' : part === 'firstName' || part === 'lastName')}
              value={stringValue(parts[part])}
              onChange={(event) => setValue({ ...parts, [part]: event.target.value })} />
          </label>;
        })}
      </div>
      {help}
    </fieldset>;
  }

  if (type === 'Lookup') {
    return <LookupInput libraryComponents={libraryComponents} field={field} label={label} inputId={inputId} help={help}
      helpText={helpText} helpId={helpId} value={value} required={required} setValue={setValue}
      loadRecords={loadRecords} onError={onError} />;
  }

  if (type === 'Choice Lookup') {
    return <ChoiceLookupInput libraryComponents={libraryComponents} field={field} label={label} inputId={inputId} help={help}
      helpText={helpText} helpId={helpId} value={value} required={required} setValue={setValue}
      loadRecords={loadRecords} onError={onError} />;
  }

  if (type === 'Data Table') {
    const collection = Array.isArray(values[String(field.collection ?? '')])
      ? values[String(field.collection)] as ScreenRecord[]
      : [];
    const columns = Array.isArray(field.columns) ? field.columns.filter((item): item is string => typeof item === 'string') : [];
    const selected = validFlowScreenSelection(value, collection, field.multiselect === true);
    const multi = field.multiselect === true;
    const toggle = (id: string) => {
      if (multi) setValue(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
      else setValue(selected[0] === id ? '' : id);
    };
    return <fieldset className="form-label flow-screen-table" aria-describedby={helpText ? helpId : undefined}>
      <legend>{label}{required ? ' *' : ''}</legend>
      {collection.length === 0
        ? <p className="settings-panel-copy">No records are available in this collection.</p>
        : <div className="table-scroll"><table><thead><tr><th scope="col">Select</th>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>{collection.filter((record) => typeof record.Id === 'string').map((record) => {
            const id = String(record.Id);
            return <tr key={id}>
              <td><input type={multi ? 'checkbox' : 'radio'} name={multi ? undefined : inputId}
                aria-label={`Select ${recordLabel(record)}`} aria-required={required}
                required={required && !multi} checked={selected.includes(id)} onChange={() => toggle(id)} /></td>
              {columns.map((column) => <td key={column}>{String(record[column] ?? '')}</td>)}
            </tr>;
          })}</tbody></table></div>}
      {help}
    </fieldset>;
  }

  if (type === 'File Upload') {
    const files = Array.isArray(value) ? value.filter((item): item is ScreenRecord => typeof item === 'object' && item !== null && !Array.isArray(item)) : [];
    const maxFiles = typeof field.maxFiles === 'number' ? field.maxFiles : 1;
    const maxFileSize = (typeof field.maxFileSize === 'number' ? field.maxFileSize : 512) * 1024;
    const allowedTypes = Array.isArray(field.allowedTypes) ? field.allowedTypes.filter((item): item is string => typeof item === 'string') : [];
    const onSelectedFiles = async (selectedFiles: File[]) => {
      try {
        validateFlowScreenUpload(selectedFiles, files.map(file => ({ name: String(file.name ?? ''), type: String(file.type ?? ''), size: Number(file.size ?? 0) })), { maxFiles, maxFileSize, allowedTypes });
        const uploads = await Promise.all(selectedFiles.map(readFile));
        const combined = [...files, ...uploads];
        const totalBytes = combined.reduce((total, file) => total + Number(file.size ?? 0), 0);
        if (combined.length > maxFiles) throw new Error(`Choose no more than ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`);
        if (totalBytes > 512 * 1024) throw new Error('Selected files exceed the 512 KB total limit.');
        setValue(combined);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Unable to read selected files');
      }
    };
    const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
      await onSelectedFiles(Array.from(event.target.files ?? []));
      event.target.value = '';
    };
    return <div className="form-label">
      <label htmlFor={inputId}>{label}{required ? ' *' : ''}</label>
      <input id={inputId} className="form-control" type="file" multiple={maxFiles > 1}
        accept={allowedTypes.join(',') || undefined} aria-required={required} aria-describedby={helpText ? helpId : undefined}
        onChange={(event) => void onFiles(event)} />
      {files.length > 0 && <ul className="flow-screen-file-list">{files.map((file, index) => <li key={`${String(file.name)}-${index}`}>
        {String(file.name)} ({Math.ceil(Number(file.size ?? 0) / 1024)} KB)
        <button type="button" className="text-action" aria-label={`Remove ${String(file.name)}`} onClick={() => setValue(files.filter((_, fileIndex) => fileIndex !== index))}>Remove</button>
      </li>)}</ul>}
      {help}
    </div>;
  }

  if (type === 'Repeater') {
    const rows = Array.isArray(value)
      ? value.filter((item): item is ScreenRecord => typeof item === 'object' && item !== null && !Array.isArray(item))
      : [];
    const subfields = Array.isArray(field.subfields)
      ? field.subfields.filter((item): item is ScreenConfig => typeof item === 'object' && item !== null && !Array.isArray(item))
      : [];
    const minimumRows = typeof field.minimumRows === 'number' ? field.minimumRows : 0;
    const maximumRows = typeof field.maximumRows === 'number' ? field.maximumRows : 10;
    const updateRow = (rowIndex: number, apiName: string, nextValue: unknown) =>
      setValue(rows.map((row, index) => index === rowIndex ? { ...row, [apiName]: nextValue } : row));
    return <fieldset className="form-label flow-screen-repeater">
      <legend>{label}{required ? ' *' : ''}</legend>
      {rows.map((row, rowIndex) => <fieldset className="metadata-card" key={`row-${rowIndex}`}>
        <legend>Entry {rowIndex + 1}</legend>
        {subfields.map((subfield, subfieldIndex) => {
          const apiName = stringValue(subfield.apiName);
          const subfieldLabel = stringValue(subfield.label) || apiName;
          const subfieldType = String(subfield.type ?? 'Text');
          const subId = `${inputId}-${rowIndex}-${apiName || subfieldIndex}`;
          const subvalue = row[apiName];
          if (subfieldType === 'Checkbox') return <label className="checkbox-row" key={apiName} htmlFor={subId}>
            <input id={subId} type="checkbox" checked={subvalue === true} onChange={(event) => updateRow(rowIndex, apiName, event.target.checked)} />{subfieldLabel}{subfield.required === true ? ' *' : ''}
          </label>;
          return <label className="form-label" htmlFor={subId} key={apiName}>{subfieldLabel}
            <input id={subId} className="form-control" type={subfieldType === 'Number' ? 'number' : subfieldType === 'Date' ? 'date' : subfieldType === 'Email' ? 'email' : 'text'}
              required={subfield.required === true} value={typeof subvalue === 'string' || typeof subvalue === 'number' ? subvalue : ''}
              onChange={(event) => updateRow(rowIndex, apiName, subfieldType === 'Number' ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value)} />
          </label>;
        })}
        {rows.length > minimumRows && <button type="button" className="text-action" onClick={() => setValue(rows.filter((_, index) => index !== rowIndex))}>Remove entry {rowIndex + 1}</button>}
      </fieldset>)}
      {rows.length < maximumRows && <button type="button" className="text-action" onClick={() => setValue([...rows, {}])}>Add entry</button>}
      {help}
    </fieldset>;
  }

  return null;
}

function LookupInput({
  field, libraryComponents: _libraryComponents, label, inputId, help, helpText, helpId, value, required, setValue, loadRecords, onError
}: {
  libraryComponents: LibraryComponentMetadata[]; field: ScreenConfig; label: string; inputId: string; help: ReactNode;
  helpText: string; helpId: string; value: unknown; required: boolean;
  setValue: (value: unknown) => void; loadRecords: (objectApiName: string) => Promise<ScreenRecord[]>;
  onError: (message: string) => void;
}) {
  const objectApiName = stringValue(field.objectApiName);
  const [records, setRecords] = useState<ScreenRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadRecords(objectApiName).then((items) => {
      if (active) setRecords(items);
    }).catch((error: unknown) => {
      if (active) onError(error instanceof Error ? error.message : `Unable to load ${objectApiName} records`);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadRecords, objectApiName, onError]);

  return <label className="form-label" htmlFor={inputId}>
    {label}{required ? ' *' : ''}
    <select id={inputId} className="form-control" value={stringValue(value)} required={required}
      aria-describedby={helpText ? helpId : undefined} disabled={loading || !objectApiName}
      onChange={(event) => setValue(event.target.value)}>
      <option value="">{loading ? 'Loading records…' : 'Select a record'}</option>
      {records.map((record) => <option key={String(record.Id)} value={String(record.Id)}>{recordLabel(record)}</option>)}
    </select>
    {help}
  </label>;
}

function ChoiceLookupInput({
  field, libraryComponents: _libraryComponents, label, inputId, help, helpText, helpId, value, required, setValue, loadRecords, onError
}: {
  libraryComponents: LibraryComponentMetadata[]; field: ScreenConfig; label: string; inputId: string; help: ReactNode;
  helpText: string; helpId: string; value: unknown; required: boolean;
  setValue: (value: unknown) => void; loadRecords: (objectApiName: string) => Promise<ScreenRecord[]>;
  onError: (message: string) => void;
}) {
  const objectApiName = stringValue(field.objectApiName);
  const displayField = stringValue(field.displayField) || 'Name';
  const multiple = field.multipleSelections === true;
  const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' && value ? [value] : [];
  const [records, setRecords] = useState<ScreenRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadRecords(objectApiName).then((items) => {
      if (active) setRecords(items);
    }).catch((error: unknown) => {
      if (active) onError(error instanceof Error ? error.message : `Unable to load ${objectApiName} choices`);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadRecords, objectApiName, onError]);

  const choices = records.filter((record) =>
    String(record[displayField] ?? recordLabel(record)).toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id: string) => {
    if (multiple) setValue(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
    else setValue(selected[0] === id ? '' : id);
  };

  return <fieldset className="form-label flow-choice-lookup" aria-describedby={helpText ? helpId : undefined}>
    <legend>{label}{required ? ' *' : ''}</legend>
    <label className="form-label" htmlFor={`${inputId}-search`}>Search choices
      <input id={`${inputId}-search`} className="form-control" type="search" value={search}
        aria-describedby={helpText ? helpId : undefined} onChange={(event) => setSearch(event.target.value)} />
    </label>
    {loading
      ? <p className="settings-panel-copy" role="status">Loading choices…</p>
      : choices.length === 0
        ? <p className="settings-panel-copy">{records.length === 0 ? 'No choices are available.' : 'No choices match your search.'}</p>
        : <div className="flow-choice-lookup-options">{choices.map((record) => {
          const id = String(record.Id ?? '');
          const choiceLabel = String(record[displayField] ?? recordLabel(record));
          if (!id) return null;
          return <label className="checkbox-row" key={id}>
            <input type={multiple ? 'checkbox' : 'radio'} name={multiple ? undefined : inputId}
              aria-label={choiceLabel} aria-required={required} required={required && !multiple}
              checked={selected.includes(id)} onChange={() => toggle(id)} />
            {choiceLabel}
          </label>;
        })}</div>}
    {help}
  </fieldset>;
}
