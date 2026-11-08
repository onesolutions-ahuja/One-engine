import { useMemo, useState } from 'react';
import './HttpCalloutOutputsEditor.css';
import type { FlowDefinitionMetadata } from '../../metadata/Definitions/metadata';
import { httpResponseMapping, httpSampleFields, toggleHttpResponseField, toggleHttpStandardOutput,
  type HttpSampleField } from './flowHttpOutputs';

type Props = {
  flow: FlowDefinitionMetadata;
  elementId: number;
  onFlowChange: (flow: FlowDefinitionMetadata) => void;
  onNotify?: (message: string) => void;
};

/** "Tick what you need" outputs: no variables, JSON paths or mapping syntax to learn. */
export default function HttpCalloutOutputsEditor({ flow, elementId, onFlowChange, onNotify }: Props) {
  const [sample, setSample] = useState('');
  const element = flow.elements.find(item => item.id === elementId);
  const parsed = useMemo(() => {
    try { return { fields: httpSampleFields(sample), error: '' }; }
    catch (error) { return { fields: [] as HttpSampleField[], error: error instanceof Error ? error.message : 'Invalid example' }; }
  }, [sample]);
  if (!element) return null;
  const mapping = httpResponseMapping(element);
  const mappedPaths = new Map(Object.entries(mapping).map(([name, path]) => [path, name]));
  const typeOf = (name: string) => flow.resources.find(item => item.name === name)?.dataType ?? '';
  const apply = (change: () => FlowDefinitionMetadata) => {
    try { onFlowChange(change()); }
    catch (error) { onNotify?.(error instanceof Error ? error.message : 'Unable to update outputs'); }
  };
  const statusName = typeof element.config.statusVariable === 'string' ? element.config.statusVariable : '';
  const bodyName = typeof element.config.responseVariable === 'string' ? element.config.responseVariable : '';
  const unlisted = Object.entries(mapping).filter(([, path]) => !parsed.fields.some(field => field.path === path));
  return <section className="flow-config-list flow-http-outputs" aria-label="HTTP Callout outputs">
    <strong>Outputs for next steps</strong>
    <p className="settings-panel-copy">Tick what you need. Each output appears in later steps under <b>!</b>,
      like a named cell in Excel.</p>
    <label className="form-label flow-http-output-row">
      <input type="checkbox" checked={Boolean(statusName)}
        onChange={event => apply(() => toggleHttpStandardOutput(flow, elementId, 'status', event.target.checked))} />
      Status code (200 = OK) {statusName && <code>!{statusName}</code>}
    </label>
    <label className="form-label flow-http-output-row">
      <input type="checkbox" checked={Boolean(bodyName)}
        onChange={event => apply(() => toggleHttpStandardOutput(flow, elementId, 'body', event.target.checked))} />
      Full response text {bodyName && <code>!{bodyName}</code>}
    </label>
    <details open={!Object.keys(mapping).length || Boolean(sample)}>
      <summary>Pick fields from a sample response</summary>
      <label className="form-label">Paste an example reply from this service (kept only while editing)
        <textarea className="form-control" rows={5} value={sample} onChange={event => setSample(event.target.value)}
          placeholder='{"order":{"id":"A12","total":49.5,"paid":true}}' />
      </label>
      {parsed.error && <p role="alert" className="flow-reference-error">{parsed.error}</p>}
      {parsed.fields.length > 0 && <div className="flow-http-sample-fields" role="group" aria-label="Response fields">
        {parsed.fields.map(field => {
          const name = mappedPaths.get(field.path);
          return <label key={field.path} className="form-label flow-http-output-row">
            <input type="checkbox" checked={Boolean(name)}
              onChange={event => apply(() => toggleHttpResponseField(flow, elementId, field, event.target.checked))} />
            <span>{field.path}</span>
            <small className="flow-reference-type">{field.dataType}{field.sample ? ' · e.g. ' + field.sample.slice(0, 40) : ''}</small>
            {name && <code>!{name}</code>}
          </label>;
        })}
      </div>}
    </details>
    {unlisted.length > 0 && <div className="flow-config-list" aria-label="Selected response fields">
      {unlisted.map(([name, path]) => <div key={name} className="flow-http-output-row">
        <span>{path}</span><small className="flow-reference-type">{typeOf(name)}</small><code>!{name}</code>
        <button type="button" className="row-menu" aria-label={'Remove output ' + name}
          onClick={() => apply(() => toggleHttpResponseField(flow, elementId,
            { path, sample: '', dataType: 'Text' }, false))}>×</button>
      </div>)}
    </div>}
  </section>;
}
