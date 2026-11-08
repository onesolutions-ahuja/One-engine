import { reconcileDecisionOutcomePaths } from '../../flowInsertElement.mjs';
import { outcomesFrom, displayValue, type DecisionOutcome } from '../../flowEditorData';
import FlowReferenceInput from '../../../FlowReferenceInput/FlowReferenceInput';
import { Fragment } from 'react';
import { Plus, X } from 'lucide-react';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowGraphActions } from '../canvas/useFlowGraphActions';
import type { useFlowConfiguration } from './useFlowConfiguration';

export function renderDecisionSettings(
  editorState: ReturnType<typeof useFlowEditorState>,
  props: FlowBuilderProps,
  graphActions: ReturnType<typeof useFlowGraphActions>,
  configuration: ReturnType<typeof useFlowConfiguration>,
) {
  const { selected } = editorState;
  const { objects, onFlowChange, flow, onNotify } = props;
  const { selectedObject } = graphActions;
  const { setConfig, renderConditionLogic } = configuration;

      const outcomes = outcomesFrom(selected.config.outcomes);
      const decisionObject = objects.find((object) => object.apiName === displayValue(selected.config.object)) ?? selectedObject;
      const setOutcomes = (next: DecisionOutcome[]) => {
        try {
          onFlowChange(reconcileDecisionOutcomePaths(flow, selected.id, next, `connector-${crypto.randomUUID()}`));
        } catch (error) {
          onNotify(error instanceof Error ? error.message : 'Unable to update Decision paths');
        }
      };
      return <div className="flow-config-list"><h3>Outcomes</h3>
        <label className="form-label">Object<select className="form-control" value={decisionObject?.apiName ?? ''} onChange={(event) => setConfig('object', event.target.value)}><option value="">Select object</option>{objects.map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label>
        {outcomes.map((outcome, index) => <div className="metadata-card" key={outcome.name}>
          <label className="form-label">Outcome Label<input className="form-control" value={outcome.label} disabled={outcome.name === 'Default'} onChange={(event) => setOutcomes(outcomes.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value, name: item.name === 'Default' ? 'Default' : event.target.value.replace(/[^A-Za-z0-9]+/g, '_') } : item))} /></label>
          {outcome.name !== 'Default' && <>
            {renderConditionLogic('Condition Requirements', outcome.conditionLogic ?? 'All', outcome.conditions.length, (logic) => setOutcomes(outcomes.map((item, itemIndex) => itemIndex === index ? { ...item, conditionLogic: logic } : item)))}
            {outcome.conditions.map((condition, conditionIndex) => <div className="flow-config-row" key={`outcome-${index}-condition-${conditionIndex}`}>
              <select className="form-control" aria-label="Outcome condition field" value={displayValue(condition.field)} onChange={(event) => setOutcomes(outcomes.map((item, itemIndex) => itemIndex === index ? { ...item, conditions: item.conditions.map((entry, entryIndex) => entryIndex === conditionIndex ? { ...entry, field: event.target.value } : entry) } : item))}><option value="">Select field or resource</option>{decisionObject && <optgroup label="Record Fields">{flow.flowType === 'Record-Triggered Flow' && decisionObject.fields.map((field) => <Fragment key={field.apiName}><option value={`{!$Record.${field.apiName}}`}>Current · {field.label}</option><option value={`{!$Record__Prior.${field.apiName}}`}>Prior · {field.label}</option></Fragment>)}{flow.flowType !== 'Record-Triggered Flow' && decisionObject.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</optgroup>}<optgroup label="Flow Resources">{flow.resources.map((resource) => <option key={resource.name} value={`{${resource.name}}`}>{resource.label}</option>)}</optgroup></select>
              <select className="form-control" aria-label="Outcome condition operator" value={displayValue(condition.operator) || 'Equals'} onChange={(event) => setOutcomes(outcomes.map((item, itemIndex) => itemIndex === index ? { ...item, conditions: item.conditions.map((entry, entryIndex) => entryIndex === conditionIndex ? { ...entry, operator: event.target.value, ...(['Is Changed', 'Was Set'].includes(event.target.value) ? { value: '' } : {}) } : entry) } : item))}>{['Equals', 'Not Equals', 'Is Null', 'Is Not Null', 'Greater Than', 'Greater Than or Equal To', 'Less Than', 'Less Than or Equal To', 'Contains', 'Does Not Contain', 'Starts With', 'Ends With', ...(flow.flowType === 'Record-Triggered Flow' ? ['Is Changed', 'Was Set'] : [])].map((operator) => <option key={operator}>{operator}</option>)}</select>
              {!['Is Null', 'Is Not Null', 'Was Set', 'Is Changed'].includes(String(condition.operator)) && <FlowReferenceInput
                ariaLabel="Outcome condition value" value={displayValue(condition.value)}
                flow={flow} elementId={selected.id} objects={objects}
                field={decisionObject?.fields.find(field=>field.apiName===condition.field)??(condition.field==='Id'?{apiName:'Id',label:'Record ID',dataType:'Id',required:true,unique:true}:undefined)} targetObjectApiName={decisionObject?.apiName}
                onChange={value=>setOutcomes(outcomes.map((item,itemIndex)=>itemIndex===index
                  ? {...item,conditions:item.conditions.map((entry,entryIndex)=>
                    entryIndex===conditionIndex?{...entry,value}:entry)}:item))} />}
              <button className="row-menu" aria-label="Remove outcome condition" onClick={() => setOutcomes(outcomes.map((item, itemIndex) => itemIndex === index ? { ...item, conditions: item.conditions.filter((_, entryIndex) => entryIndex !== conditionIndex) } : item))}><X size={14} /></button>
            </div>)}
            <button className="text-action" onClick={() => setOutcomes(outcomes.map((item, itemIndex) => itemIndex === index ? { ...item, conditions: [...item.conditions, { field: '', operator: 'Equals', value: '' }] } : item))}><Plus size={13} />Add Condition</button>
          </>}
          {outcome.name !== 'Default' && <button className="row-menu" aria-label={`Remove ${outcome.label} outcome`} onClick={() => setOutcomes(outcomes.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>}
        </div>)}
        <button className="text-action" onClick={() => setOutcomes([...outcomes.filter((item) => item.name !== 'Default'), { name: `Outcome_${outcomes.length + 1}`, label: `Outcome ${outcomes.length + 1}`, conditionLogic: 'All', conditions: [] }, ...outcomes.filter((item) => item.name === 'Default')])}><Plus size={13} />Add Outcome</button>
        <p className="settings-panel-copy">Create a matching connector below for each outcome path.</p>
      </div>;

}
