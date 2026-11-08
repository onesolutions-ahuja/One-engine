import { useState } from 'react';

/** Shared field editor for tenant-scoped picklist metadata. */
export function PicklistValueRows({ values, onChange, disabled = false }: {
  values: string[];
  onChange: (values: string[], previous?: string, replacement?: string) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<string[]>([]);
  const rows = [...values, ...pending];
  const changeRow = (index: number, value: string) => {
    if (index >= values.length) {
      const nextPending = [...pending];
      nextPending[index - values.length] = value;
      if (value.trim()) {
        onChange([...values, ...nextPending.filter((entry) => entry.trim())]);
        setPending([]);
      } else setPending(nextPending);
      return;
    }
    const previous = values[index];
    onChange(values.map((entry, position) => position === index ? value : entry).filter((entry) => entry.trim()), previous, value);
  };
  return <div className="form-options">
    <label className="form-label">Picklist Values</label>
    {rows.map((value, index) => <div className="form-row" key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input className="form-control" aria-label={`Picklist value ${index + 1}`} value={value} disabled={disabled}
        onChange={(event) => changeRow(index, event.target.value)} maxLength={255} />
      {!disabled && <button type="button" className="btn" aria-label={`Remove picklist value ${index + 1}`}
        onClick={() => {
          if (index < values.length) onChange(values.filter((_, position) => position !== index), value, '');
          else setPending(pending.filter((_, position) => position !== index - values.length));
        }}>Remove</button>}
    </div>)}
    {!disabled && <button type="button" className="btn" onClick={() => setPending([...pending, ''])}>+ Add Value</button>}
    {disabled && <p className="permission-help">Values are managed by the selected Global Value Set.</p>}
  </div>;
}
