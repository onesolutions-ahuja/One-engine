import { useState } from 'react';
import type { FieldMetadata, FlowDefinitionMetadata } from '../../metadata/Definitions/metadata';
import { decodeInputSource, declaredFlowInputs, declaredFlowOutputs, encodeInputSource, mappedInputNames, sessionInputFields, type InputSourceKind } from '../../automation/FlowScreen/flowInputBindings';

/** Shared typed property control; stores the existing Flow input mapping shape. */
export default function FlowInputBindingEditor({
  flow, inputs, outputs, fields, onChange, onOutputChange
}: {
  flow?: FlowDefinitionMetadata;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  fields: FieldMetadata[];
  onChange: (next: Record<string, unknown>) => void;
  onOutputChange?: (next: Record<string, unknown>) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingKinds, setPendingKinds] = useState<Record<string, InputSourceKind>>({});
  const resources = declaredFlowInputs(flow);
  const outputResources = declaredFlowOutputs(flow);
  const resourceByName = new Map(resources.map(item => [item.name, item]));
  const names = mappedInputNames(flow, inputs);
  const update = (name: string, kind: Exclude<InputSourceKind, 'Legacy'>, detail: string) => {
    try {
      const value = encodeInputSource(kind, detail, fields, resourceByName.get(name)?.dataType);
      const next = { ...inputs };
      if (kind === 'Unmapped') delete next[name];
      else next[name] = value;
      onChange(next);
      setErrors(current => ({ ...current, [name]: '' }));
      setPendingKinds(current => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    } catch (error) {
      setErrors(current => ({ ...current, [name]: error instanceof Error ? error.message : 'Invalid input source' }));
    }
  };
  return <div className="component-flow-input-editor" aria-label="Flow variable mapping">
    <div className="properties-section-title">Flow input mapping</div>
    {!flow && <p className="properties-help">Choose an active Screen or Autolaunched Flow to see its input variables.</p>}
    {flow && !resources.length && <p className="properties-help">This Flow has no declared input variables. Create an input variable in Flow Builder first.</p>}
    {names.map(name => {
      const source = decodeInputSource(inputs[name], Object.prototype.hasOwnProperty.call(inputs, name));
      const selectedKind = pendingKinds[name] ?? source.kind;
      const resource = resourceByName.get(name);
      const title = resource?.label || name;
      return <div className="metadata-array-property" key={name} data-flow-input={name}>
        <strong>{title}</strong>
        <small className="api-name">{name}{resource ? ' · ' + resource.dataType : ' · saved legacy input'}</small>
        {!resource && <p className="properties-help">This input is not declared in the selected active Flow version. Review the binding or remove it.</p>}
        <label className="form-label">Source
          <select className="form-control" aria-label={name + ' source'} value={selectedKind} onChange={event => {
            const kind = event.target.value as InputSourceKind;
            if (kind === 'Legacy') return;
            if (kind === 'Session') { update(name, kind, 'id'); return; }
            if (kind === 'Unmapped' || kind === 'Event') {
              update(name, kind, '');
              return;
            }
            if (kind === 'Record Field') {
              if (fields.length) update(name, 'Record Field', fields[0].apiName);
              else setErrors(current => ({ ...current, [name]: 'Select a component data object first.' }));
              return;
            }
            if (kind === 'Event Field' || kind === 'Literal' || kind === 'Page State' || kind === 'Numeric Page State' || kind === 'Record Collection') {
              // Only persist a valid mapping after the developer chooses a source.
              setPendingKinds(current => ({ ...current, [name]: kind }));
              setErrors(current => ({ ...current, [name]: '' }));
              return;
            }
            update(name, 'Literal', '');
          }}>
            <option value="Unmapped">Not mapped</option>
            <option value="Event Field">Event property</option>
            <option value="Event">Entire event payload</option>
            <option value="Record Field">Record field</option>
            <option value="Page State">Page state / Flow output</option>
            <option value="Numeric Page State">Numeric page state (e.g. cash received)</option>
            <option value="Record Collection">Record collection from Page State</option>
            <option value="Session">Current session</option>
            <option value="Literal">Fixed value</option>
            {source.kind === 'Legacy' && <option value="Legacy">Existing unsupported value</option>}
          </select>
        </label>
        {selectedKind === 'Event Field' && <label className="form-label">
          Event property name
          <input className="form-control" aria-label={name + ' event property'} placeholder="e.g. item.id"
            value={source.kind === 'Event Field' ? source.detail : ''}
            onChange={event => update(name, 'Event Field', event.target.value)} />
        </label>}
        {selectedKind === 'Page State' && <label className="form-label">Page state key
          <input className="form-control" aria-label={name+' page state key'}
            placeholder="CurrentCartId" value={source.kind==='Page State'?source.detail:''}
            onChange={event=>update(name,'Page State',event.target.value)} />
        </label>}
        {selectedKind === 'Numeric Page State' && <label className="form-label">Numeric Page State key
          <input className="form-control" aria-label={name+' numeric page state key'}
            placeholder="cashReceived" value={source.kind==='Numeric Page State'?source.detail:''}
            onChange={event=>update(name,'Numeric Page State',event.target.value)} />
        </label>}
        {selectedKind === 'Record Collection' && <label className="form-label">Collection state and permitted Fields
          <input className="form-control" aria-label={name+' collection fields'}
            placeholder="cartItems:Product,Quantity"
            value={source.kind==='Record Collection'?source.detail:''}
            onChange={event=>update(name,'Record Collection',event.target.value)} />
          <small>Choose Page State and the Fields passed to the Flow. Record Id and undeclared fields are excluded.</small>
        </label>}
        {selectedKind === 'Session' && <label className="form-label">Session field
          <select className="form-control" aria-label={name + ' session field'}
            value={source.kind === 'Session'?source.detail||'id':'id'}
            onChange={event=>update(name,'Session',event.target.value)}>
            {sessionInputFields.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>}
        {selectedKind === 'Record Field' && <label className="form-label">Record field
          <select className="form-control" aria-label={name + ' record field'} value={source.detail}
            onChange={event => update(name, 'Record Field', event.target.value)}>
            {fields.map(field => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
          </select>
        </label>}
        {selectedKind === 'Literal' && <label className="form-label">Fixed value
          {['Boolean', 'Checkbox'].includes(resource?.dataType ?? '')
            ? <select className="form-control" aria-label={name + ' fixed value'}
                value={source.kind === 'Literal' ? String(source.value) : ''} onChange={event => update(name, 'Literal', event.target.value)}>
                <option value="">Choose value…</option><option value="true">True</option><option value="false">False</option>
              </select>
            : <input className="form-control" aria-label={name + ' fixed value'}
                type={/^(Number|Currency|Percent|Integer|Decimal|Double)/i.test(resource?.dataType ?? '') ? 'number' : 'text'}
                value={source.kind === 'Literal' ? source.detail : ''} onChange={event => update(name, 'Literal', event.target.value)} />}
        </label>}
        {source.kind === 'Legacy' && <button className="btn btn-small" type="button"
          onClick={() => update(name, 'Unmapped', '')}>Remove old input</button>}
        {errors[name] && <p className="auth-error" role="alert">{errors[name]}</p>}
      </div>;
    })}
    {onOutputChange && <section aria-label="Flow output mapping">
      <div className="properties-section-title">Flow output mapping</div>
      {flow && !outputResources.length && <p className="properties-help">This Flow has no output-enabled variables.</p>}
      {outputResources.map(resource => {
        const target = typeof outputs?.[resource.name] === 'string' ? outputs[resource.name] as string : '';
        return <label className="form-label" key={resource.name}>
          {resource.label || resource.name}
          <small className="api-name">{resource.name} · {resource.dataType}</small>
          <input className="form-control" aria-label={resource.name + ' output target'}
            value={target} maxLength={64} placeholder="Page state key"
            onChange={event => {
              const value = event.target.value.trim();
              if (value && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) return;
              const next = { ...(outputs ?? {}) };
              if (value) next[resource.name] = value;
              else delete next[resource.name];
              onOutputChange(next);
            }} />
        </label>;
      })}
    </section>}
  </div>;
}
