import type { FieldMetadata } from '../../metadata/Definitions/metadata';
import {
  type ComponentVisibilityRule, type VisibilityCondition, validateVisibilityRule
} from '../../components/Properties/componentVisibility';
import { isBooleanFilterField, isNumericFilterField, supportedFilterOperators } from '../../records/RecordWorkspace/recordFilterMetadata';

/** Shared Page Builder visibility control; no executable expressions or custom business fields. */
export default function ComponentVisibilityEditor({
  rules, fields, allowRecordFields, onChange, profiles=[], recordTypes=[]
}: {
  rules: unknown;
  fields: FieldMetadata[];
  allowRecordFields: boolean;
  profiles?:Array<{id:string;name?:string;label?:string}>;
  recordTypes?:Array<{id:string;label:string}>;
  onChange: (rules: ComponentVisibilityRule | undefined) => void;
}) {
  const enabled = rules !== null && rules !== undefined;
  const validStructure = Boolean(rules && typeof rules === 'object' && !Array.isArray(rules)
    && ['All', 'Any'].includes((rules as ComponentVisibilityRule).logic)
    && Array.isArray((rules as ComponentVisibilityRule).conditions));
  const config = validStructure ? rules as ComponentVisibilityRule : undefined;
  const errors = validateVisibilityRule(rules, fields, allowRecordFields);
  const update = (next: ComponentVisibilityRule) => onChange(next);
  const deviceCondition = (): VisibilityCondition => ({ source: 'Device', operator: 'Equals', value: 'Desktop' });
  const newRecordCondition = (): VisibilityCondition => ({
    source: 'Record Field', fieldApiName: '', operator: 'Equals', value: ''
  });
  const newPermissionCondition = (): VisibilityCondition => ({
    source:'Record Permission',operator:'Equals',value:'Edit'
  });
  const newIdentityCondition = (source:'Record Type'|'User Profile'): VisibilityCondition => ({
    source,operator:'Equals',value:''
  });
  const setCondition = (index: number, next: VisibilityCondition) => {
    if (!config) return;
    update({ ...config, conditions: config.conditions.map((item, i) => i === index ? next : item) });
  };
  return <div className="component-visibility-editor" aria-label="Component visibility rules">
    <label className="checkbox-row">
      <input type="checkbox" aria-label="Enable visibility conditions" checked={enabled}
        onChange={event => onChange(event.target.checked
          ? { logic: 'All', conditions: [deviceCondition()] }
          : undefined)} />
      Show only when conditions match
    </label>
    {enabled && !config && <button type="button" className="btn btn-small"
      onClick={() => update({ logic: 'All', conditions: [deviceCondition()] })}>
      Repair invalid visibility rules
    </button>}
    {config && <>
      <p className="properties-help">This changes page presentation only. Record access still requires server permissions.</p>
      <label className="form-label">Match conditions
        <select className="form-control" aria-label="Visibility condition logic"
          value={config.logic} onChange={event => update({
            ...config, logic: event.target.value as 'All' | 'Any'
          })}>
          <option value="All">All conditions (AND)</option>
          <option value="Any">Any condition (OR)</option>
        </select>
      </label>
      <label className="form-label">Advanced condition logic (optional)
        <input className="form-control" aria-label="Visibility condition expression"
          placeholder="1 AND (2 OR 3)" value={config.expression??''}
          onChange={event=>update({...config,
            expression:event.target.value||undefined})} />
        <small className="properties-help">Use condition numbers with AND, OR and parentheses.
          Leave empty to use the match setting above. Invalid expressions hide the component.</small>
      </label>
      {config.conditions.map((condition, index) => {
        const recordCondition = condition.source === 'Record Field' ? condition : null;
        const field = recordCondition
          ? fields.find(item => item.apiName === recordCondition.fieldApiName) : undefined;
        const available = supportedFilterOperators(field);
        return <div className="metadata-array-property" key={index} data-visibility-index={index}>
          <strong>Condition {index + 1}</strong>
          <label className="form-label">Source
            <select className="form-control" aria-label={'Visibility source ' + (index + 1)}
              value={condition.source} onChange={event => setCondition(index,
                event.target.value==='Record Field'?newRecordCondition()
                  :event.target.value==='Record Permission'?newPermissionCondition()
                  :event.target.value==='Record Type'||event.target.value==='User Profile'
                    ?newIdentityCondition(event.target.value):deviceCondition())}>
              <option value="Device">Device</option>
              {allowRecordFields && <option value="Record Field">Current record field</option>}
              {allowRecordFields && <option value="Record Type">Record type</option>}
              <option value="User Profile">Viewer profile</option>
              {allowRecordFields && <option value="Record Permission">Viewer record permission</option>}
            </select>
          </label>
          {recordCondition ? <>
            <label className="form-label">Record field
              <select className="form-control" aria-label={'Visibility field ' + (index + 1)}
                value={recordCondition.fieldApiName} onChange={event => setCondition(index, {
                  ...recordCondition, fieldApiName: event.target.value, operator: 'Equals', value: ''
                })}>
                <option value="">Choose field…</option>
                {recordCondition.fieldApiName && !field
                  && <option value={recordCondition.fieldApiName} disabled>
                    Missing: {recordCondition.fieldApiName}
                  </option>}
                {fields.map(item => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
              </select>
            </label>
            <label className="form-label">Operator
              <select className="form-control" aria-label={'Visibility operator ' + (index + 1)}
                value={recordCondition.operator} onChange={event => setCondition(index, {
                  ...recordCondition, operator: event.target.value
                })}>
                {!available.includes(recordCondition.operator as typeof available[number])
                  && <option value={recordCondition.operator} disabled>Unsupported: {recordCondition.operator}</option>}
                {available.map(operator => <option key={operator} value={operator}>{operator}</option>)}
              </select>
            </label>
            <label className="form-label">Value
              {isBooleanFilterField(field)
                ? <select className="form-control" aria-label={'Visibility value ' + (index + 1)}
                    value={recordCondition.value} onChange={event => setCondition(index, {
                      ...recordCondition, value: event.target.value
                    })}>
                    <option value="">Choose…</option><option value="true">True</option><option value="false">False</option>
                  </select>
                : field?.dataType === 'Picklist' && field.picklistValues?.length
                  ? <select className="form-control" aria-label={'Visibility value ' + (index + 1)}
                      value={recordCondition.value} onChange={event => setCondition(index, {
                        ...recordCondition, value: event.target.value
                      })}>
                      <option value="">Choose…</option>
                      {recordCondition.value && !field.picklistValues.includes(recordCondition.value)
                        && <option value={recordCondition.value}>Saved: {recordCondition.value}</option>}
                      {field.picklistValues.map(item => <option value={item} key={item}>{item}</option>)}
                    </select>
                  : <input className="form-control" aria-label={'Visibility value ' + (index + 1)}
                      type={isNumericFilterField(field) ? 'number' : 'text'} value={recordCondition.value}
                      onChange={event => setCondition(index, { ...recordCondition, value: event.target.value })} />}
            </label>
          </> : condition.source==='Record Permission'
          ? <div>
              <label className="form-label">Operator
                <select className="form-control" value={condition.operator}
                  onChange={event=>setCondition(index,{...condition,
                    operator:event.target.value as 'Equals'|'Not Equals'})}>
                  <option value="Equals">Can</option><option value="Not Equals">Cannot</option>
                </select>
              </label>
              <label className="form-label">Permission
                <select className="form-control" value={condition.value}
                  onChange={event=>setCondition(index,{...condition,
                    value:event.target.value as 'Create'|'Edit'|'Delete'})}>
                  <option value="Create">Create records</option>
                  <option value="Edit">Edit this record</option>
                  <option value="Delete">Delete this record</option>
                </select>
              </label>
            </div>
          : condition.source==='Record Type'||condition.source==='User Profile'
          ? <div>
              <label className="form-label">Operator
                <select className="form-control" value={condition.operator}
                  onChange={event=>setCondition(index,{...condition,
                    operator:event.target.value as 'Equals'|'Not Equals'})}>
                  <option value="Equals">Is</option><option value="Not Equals">Is not</option>
                </select>
              </label>
              <label className="form-label">{condition.source}
                <select className="form-control" value={condition.value}
                  onChange={event=>setCondition(index,{...condition,value:event.target.value})}>
                  <option value="">Select…</option>
                  {(condition.source==='Record Type'
                    ?recordTypes.map(item=>({value:item.id,label:item.label}))
                    :profiles.map(item=>({value:item.id,label:item.label??item.name??item.id})))
                    .map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>
          : <div>
            <label className="form-label">Operator
              <select className="form-control" aria-label={'Visibility operator ' + (index + 1)}
                value={condition.operator} onChange={event => setCondition(index, {
                  ...condition, operator: event.target.value as 'Equals' | 'Not Equals'
                })}>
                <option value="Equals">Is</option><option value="Not Equals">Is not</option>
              </select>
            </label>
            <label className="form-label">Device
              <select className="form-control" aria-label={'Visibility value ' + (index + 1)}
                value={condition.value} onChange={event => setCondition(index, {
                  ...condition, value: event.target.value as 'Desktop' | 'Tablet' | 'Phone'
                })}>
                <option value="Desktop">Desktop</option><option value="Tablet">Tablet</option><option value="Phone">Phone</option>
              </select>
            </label>
          </div>}
          <button className="btn btn-small" type="button" disabled={config.conditions.length === 1}
            onClick={() => update({ ...config, conditions: config.conditions.filter((_, i) => i !== index) })}>
            Remove condition
          </button>
        </div>;
      })}
      <button type="button" className="btn btn-small" disabled={config.conditions.length >= 20}
        onClick={() => update({ ...config, conditions: [...config.conditions, deviceCondition()] })}>
        Add condition
      </button>
      {errors.map((error, i) => <p role="alert" className="properties-help" key={i}>{error}</p>)}
    </>}
  </div>;
}
