import { precedingFlowSteps } from '../../flowReferenceCatalog';
import { displayValue } from '../../flowEditorData';
import FlowReferenceInput from '../../../FlowReferenceInput/FlowReferenceInput';

import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowEditorState } from '../useFlowEditorState';
import type { useFlowConfiguration } from './useFlowConfiguration';

export function renderAssignmentSettings(
  props: FlowBuilderProps,
  editorState: ReturnType<typeof useFlowEditorState>,
  configuration: ReturnType<typeof useFlowConfiguration>,
) {
  const { objects, flow, onFlowChange } = props;
  const { selected } = editorState;
  const { setConfig } = configuration;

      const triggerObject = objects.find((object) => object.apiName === flow.triggerObject);
      const beforeSave = flow.flowType === 'Record-Triggered Flow' && flow.startConfig?.runWhen === 'before-save';
      const selectedVariableResource = flow.resources.find((resource) => resource.name === selected.config.variable);
      const collectionOperators = ['Assign', 'Add', 'Add At Beginning', 'Add At End', 'Remove', 'Remove All'];
      const numericTypes = ['Number', 'Currency', 'Percent'];
      const textTypes = ['Text', 'Picklist', 'Id'];
      const scalarOperators = ['Assign',
        ...(numericTypes.includes(selectedVariableResource?.dataType ?? '')
          ? ['Add', 'Subtract', 'Multiply', 'Divide'] : []),
        ...(textTypes.includes(selectedVariableResource?.dataType ?? '')
          ? ['Add At Beginning', 'Add At End'] : [])];
      const isRecordCollection = selectedVariableResource?.type === 'Record Collection';
      const assignmentOperators = isRecordCollection ? collectionOperators : scalarOperators;
      const valueOperator = displayValue(selected.config.operator) || 'Assign';
      const collectionObject = selectedVariableResource?.dataType;
      const recordSources = flow.resources.filter((resource) =>
        resource.type === 'Record' && resource.dataType === collectionObject);
      const collectionSources = flow.resources.filter((resource) =>
        resource.type === 'Record Collection' && resource.dataType === collectionObject);
      const earlierSteps = precedingFlowSteps(flow, selected.id);
      const loopSources = flow.elements.filter((element) => element.type === 'Loop'
        && earlierSteps.has(element.id)
        && flow.resources.some((resource) => resource.name === element.config.collection
          && resource.type === 'Record Collection' && resource.dataType === collectionObject)
        && typeof element.config.loopVariable === 'string' && element.config.loopVariable);
      return <>
      <label className="form-label">Variable<select className="form-control" value={displayValue(selected.config.variable)} onChange={(event) => onFlowChange({
        ...flow, elements: flow.elements.map((element) => element.id === selected.id
          ? { ...element, config: { ...element.config, variable: event.target.value, operator: 'Assign' } }
          : element)
      })}><option value="">Select variable</option>{flow.resources.filter((resource) =>
        resource.type === 'Variable' || resource.type === 'Record Collection').length > 0
        && <optgroup label="Flow Resources">{flow.resources.filter((resource) =>
          resource.type === 'Variable' || resource.type === 'Record Collection').map((resource) =>
            <option key={resource.name} value={resource.name}>{resource.label}</option>)}</optgroup>}
        {beforeSave && triggerObject && <optgroup label="$Record Fields">{triggerObject.fields.filter((field) => !field.formula && !['AutoNumber', 'Auto Number'].includes(field.dataType)).map((field) => <option key={field.apiName} value={`$Record.${field.apiName}`}>{field.label}</option>)}</optgroup>}</select></label>
      <label className="form-label">Operator<select className="form-control" value={displayValue(selected.config.operator) || 'Assign'} onChange={(event) => setConfig('operator', event.target.value)}>{assignmentOperators.map((operator) => <option key={operator}>{operator}</option>)}</select></label>
      {isRecordCollection
        ? valueOperator !== 'Remove All' && <label className="form-label">Value<select
          className="form-control" aria-label="Assignment value"
          value={displayValue(selected.config.value)} onChange={(event) => setConfig('value', event.target.value)}>
          <option value="">Select a matching record or collection</option>
          {valueOperator === 'Assign'
            ? collectionSources.map((resource) => <option key={resource.name} value={`@${resource.name}`}>
              {resource.label} · collection</option>)
            : <>{recordSources.map((resource) => <option key={resource.name} value={`@${resource.name}`}>
              {resource.label}</option>)}{loopSources.map((element) => <option key={element.id}
              value={`@${String(element.config.loopVariable)}`}>{element.label} · loop record</option>)}</>}
        </select></label>
        : <label className="form-label">Value<FlowReferenceInput ariaLabel="Assignment value" multiline
        value={displayValue(selected.config.value)} flow={flow} elementId={selected.id} objects={objects}
        field={triggerObject?.fields.find(field=>selected.config.variable===`$Record.${field.apiName}`)}
        onChange={value=>setConfig('value',value)}/></label>}
    </>;

}
