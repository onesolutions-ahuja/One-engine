import { rowsFrom, displayValue } from '../../flowEditorData';
import FlowReferenceInput from '../../../FlowReferenceInput/FlowReferenceInput';

import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowEditorState } from '../useFlowEditorState';
import type { useFlowConfiguration } from './useFlowConfiguration';

export function renderRecordSettings(
  props: FlowBuilderProps,
  editorState: ReturnType<typeof useFlowEditorState>,
  configuration: ReturnType<typeof useFlowConfiguration>,
) {
  const { objects, flow, onFlowChange } = props;
  const { selected } = editorState;
  const { setConfig, renderConditionLogic, renderConditions, renderFieldValues } = configuration;

      const object = objects.find((item) => item.apiName === displayValue(selected.config.object));
      const mutationSource = displayValue(selected.config.recordSource)
        || (selected.type === 'Delete Records' ? 'filter' : 'id');
      const fieldsToStore = Array.isArray(selected.config.fields)
        ? selected.config.fields.filter((item): item is string => typeof item === 'string')
        : null;
      const recordLimit = displayValue(selected.config.recordLimit) || '1';
      const outputResources = flow.resources.filter((resource) => resource.type === (recordLimit === '1' ? 'Record' : 'Record Collection'));
      return <>
        <label className="form-label">Object<select className="form-control" value={displayValue(selected.config.object)} onChange={(event) => setConfig('object', event.target.value)}><option value="">Select object</option>{objects.map((item) => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}</select></label>
        {selected.type === 'Create Records' && <>
          <label className="form-label">How to Set Record Values
            <select className="form-control" value={displayValue(selected.config.recordSource) || 'fields'}
              onChange={(event) => onFlowChange({
                ...flow, elements: flow.elements.map((element) => element.id === selected.id
                  ? { ...element, config: {
                    ...element.config, recordSource: event.target.value,
                    ...(event.target.value === 'fields' ? { fieldValues: [], field: '', value: '' } : {})
                  } } : element)
              })}>
              <option value="fields">Use separate field values (one record)</option>
              <option value="collection">Use a record collection</option>
            </select>
          </label>
          {selected.config.recordSource === 'collection' && <>
            <label className="form-label">Record Collection<select className="form-control"
              value={displayValue(selected.config.collection)}
              onChange={(event) => setConfig('collection', event.target.value)}>
              <option value="">Select a record collection</option>
              {flow.resources.filter((resource) => resource.type === 'Record Collection'
                && resource.dataType === object?.apiName).map((resource) =>
                <option key={resource.name} value={resource.name}>{resource.label}</option>)}
            </select></label>
            <label className="form-label">Created Records Output<select className="form-control"
              value={displayValue(selected.config.resultVariable)}
              onChange={(event) => setConfig('resultVariable', event.target.value)}>
              <option value="">Do not store created records</option>
              {flow.resources.filter((resource) => resource.type === 'Record Collection'
                && resource.dataType === object?.apiName).map((resource) =>
                <option key={resource.name} value={resource.name}>{resource.label}</option>)}
            </select></label>
          </>}
          {displayValue(selected.config.recordSource) === 'collection' && <p className="info-callout" role="status">
            Each collection record is created through shared CRUD in the current Flow transaction. The operation is limited to 200 records.
          </p>}
        </>}
        {selected.type === 'Get Records' && <>
          <h3>Filter Records</h3>
          <label className="form-label">Records Owned By
            <select className="form-control" value={displayValue(selected.config.ownerScope)||'all'}
              onChange={event=>setConfig('ownerScope',event.target.value)}>
              <option value="all">All accessible users</option>
              <option value="own">Current user</option>
              <option value="direct">Current user and direct reports</option>
              <option value="descendants">Current user and all descendants</option>
            </select>
            <small>Uses the Reports To user tree. Existing Object and Record permissions still apply.</small>
          </label>
          {renderConditionLogic('Filter Logic', selected.config.conditionLogic ?? 'All',
            rowsFrom(selected.config.conditions).length, (logic) => setConfig('conditionLogic', logic))}
          {renderConditions('conditions', object?.fields ?? [])}
          <label className="form-label">How Many Records to Store<select className="form-control" value={recordLimit === 'all' || recordLimit === '1' ? recordLimit : 'limited'} onChange={(event) => {
            setConfig('recordLimit', event.target.value === 'limited' ? '50' : event.target.value);
          }}><option value="1">Only the first record</option><option value="limited">Up to a specified limit</option><option value="all">All records</option></select></label>
          {recordLimit !== 'all' && recordLimit !== '1' && <label className="form-label">Maximum Records
            <input className="form-control" type="number" min={2} max={200} step={1} value={recordLimit}
              onChange={(event) => setConfig('recordLimit', event.target.value)} />
            <small className="settings-panel-copy">Store up to 200 matching records in a Record Collection.</small>
          </label>}
          <label className="form-label">Sort By<select className="form-control" value={displayValue(selected.config.sortField)} onChange={(event) => setConfig('sortField', event.target.value)}><option value="">No sorting</option>{object?.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select></label>
          <label className="form-label">Sort Order<select className="form-control" value={displayValue(selected.config.sortOrder) || 'Ascending'} onChange={(event) => setConfig('sortOrder', event.target.value)}><option>Ascending</option><option>Descending</option></select></label>
          <label className="form-label">Output Variable<select className="form-control" value={displayValue(selected.config.outputVariable)} onChange={(event) => setConfig('outputVariable', event.target.value)}><option value="">Select an output resource</option>{outputResources.map((resource) => <option key={resource.name} value={resource.name}>{resource.label} · {resource.name}</option>)}</select></label>
          <label className="form-label">Fields to Store<select className="form-control" value={fieldsToStore ? 'selected' : 'all'} onChange={(event) => setConfig('fields', event.target.value === 'all' ? 'all' : [])}><option value="all">Automatically store all fields</option><option value="selected">Choose fields</option></select></label>
          {fieldsToStore && <div className="field-selector-list">{object?.fields.map((field) => <label className="checkbox-row" key={field.apiName}><input type="checkbox" checked={fieldsToStore.includes(field.apiName)} onChange={() => setConfig('fields', fieldsToStore.includes(field.apiName) ? fieldsToStore.filter((name) => name !== field.apiName) : [...fieldsToStore, field.apiName])} />{field.label}<small className="api-name">{field.apiName}</small></label>)}</div>}
        </>}
        {['Update Records', 'Delete Records'].includes(selected.type) && <>
          <label className="form-label">Records to {selected.type === 'Update Records' ? 'Update' : 'Delete'}<select
            className="form-control" value={displayValue(selected.config.recordSource)
              || (selected.type === 'Delete Records' ? 'filter' : 'id')}
            onChange={(event) => setConfig('recordSource', event.target.value)}>
            <option value="id">One record by ID</option>
            <option value="record">A record variable</option>
            <option value="collection">A record collection</option>
            <option value="filter">Records matching conditions</option>
          </select></label>
          {mutationSource === 'id'
            && <label className="form-label">Record ID / Flow Resource<FlowReferenceInput ariaLabel="Record ID" value={displayValue(selected.config.recordId)}
          flow={flow} elementId={selected.id} objects={objects}
          onChange={value=>setConfig('recordId',value)}/></label>}
          {(displayValue(selected.config.recordSource) === 'record') && <label className="form-label">Record Variable<select
            className="form-control" value={displayValue(selected.config.recordVariable)}
            onChange={(event) => setConfig('recordVariable', event.target.value)}>
            <option value="">Select a record variable</option>{flow.resources.filter((resource) =>
              resource.type === 'Record' && resource.dataType === object?.apiName).map((resource) =>
              <option key={resource.name} value={resource.name}>{resource.label}</option>)}
          </select></label>}
          {(displayValue(selected.config.recordSource) === 'collection') && <label className="form-label">Record Collection<select
            className="form-control" value={displayValue(selected.config.collection)}
            onChange={(event) => setConfig('collection', event.target.value)}>
            <option value="">Select a record collection</option>{flow.resources.filter((resource) =>
              resource.type === 'Record Collection' && resource.dataType === object?.apiName).map((resource) =>
              <option key={resource.name} value={resource.name}>{resource.label}</option>)}
          </select></label>}
        </>}
        {['Update Records', 'Delete Records'].includes(selected.type) && mutationSource === 'filter'
          && <>{renderConditionLogic('Filter Logic', selected.config.conditionLogic ?? 'All', rowsFrom(selected.config.conditions).length, (logic) => setConfig('conditionLogic', logic))}<label className="form-label">Filter Conditions</label>{renderConditions('conditions', object?.fields ?? [])}</>}
        {selected.type !== 'Delete Records' && selected.type !== 'Get Records' && !(selected.type === 'Create Records' && selected.config.recordSource === 'collection') && <><label className="form-label">Set Field Values</label>{renderFieldValues()}</>}
      </>;

}
