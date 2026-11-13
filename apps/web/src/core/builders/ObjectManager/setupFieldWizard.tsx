// @ts-nocheck
import { PicklistValueRows } from './PicklistValueRows';
// Shared metadata-driven field creation wizard. View-only; actions remain in the object engine.
import { useEffect, useState } from 'react';
import type { RelatedLookupFilterMetadata } from '../../metadata/Definitions/metadata';
import { apiRequest } from '../../authentication/Client/authClient';
import { Plus } from 'lucide-react';
import SmartFieldInput from '../../../component-libraries/shared/primitives/SmartFieldInput/SmartFieldInput';
type NewFieldLookupFilterDraft = {
  id: string;
  relatedFieldApiName: string;
  operator: RelatedLookupFilterMetadata['operator'];
  valueMode: 'Value' | 'Field';
  value: string;
  valueFieldApiName: string;
  required: boolean;
};

export default function FieldWizardModal({ context }: { context: any }) {
  const ctx = context;
  const [globalValueSets, setGlobalValueSets] = useState<Array<{ apiName: string; label: string; values: Array<{ value: string; active: boolean }> }>>([]);
  const [globalValueSetApiName, setGlobalValueSetApiName] = useState('');
  const [globalValueSetError, setGlobalValueSetError] = useState('');
  const [autoNumberFormat,setAutoNumberFormat]=useState('REC-{0000}');
  const [rollupChildObject, setRollupChildObject] = useState('');
  const [rollupRelationshipField, setRollupRelationshipField] = useState('');
  const [rollupOperation, setRollupOperation] = useState<'COUNT' | 'SUM' | 'MIN' | 'MAX'>('COUNT');
  const [rollupSourceField, setRollupSourceField] = useState('');
  const [rollupFilterLogic, setRollupFilterLogic] = useState<'All' | 'Any'>('All');
  const [rollupFilters, setRollupFilters] = useState<Array<{ id: string; fieldApiName: string; operator: string; value: string }>>([]);
  const { X, addField, formulaEditorRef, insertFormulaText, newFieldAllowReparenting, newFieldApiName, newFieldAutoNumberFormat, newFieldCaseSensitive, newFieldChildRelationshipName, newFieldConfigurationError, newFieldController, newFieldControllerApiName, newFieldControllerValues, newFieldDefaultValue, newFieldDeleteBehavior, newFieldDescription, newFieldExternalId, newFieldFormula, newFieldFormulaValidation, newFieldHasDefault, newFieldHelpText, newFieldLabel, newFieldLayoutIds, newFieldLookupFilterLogic, newFieldLookupFilters, newFieldPicklistOptions, newFieldPicklistRestricted, newFieldPicklistValues, newFieldPrecision, newFieldRelationshipName, newFieldRelationshipTarget, newFieldRequired, newFieldReturnType, newFieldScale, newFieldStage, newFieldTextLength, newFieldType, newFieldUnique, newFieldValueSettings, object, objects, relatedLookupFilterOperators, resetNewFieldDraft, setNewFieldAllowReparenting, setNewFieldAutoNumberFormat, setNewFieldCaseSensitive, setNewFieldChildRelationshipName, setNewFieldControllerApiName, setNewFieldDefaultValue, setNewFieldDeleteBehavior, setNewFieldDescription, setNewFieldExternalId, setNewFieldFormula, setNewFieldFormulaValidation, setNewFieldHasDefault, setNewFieldHelpText, setNewFieldLabel, setNewFieldLayoutIds, setNewFieldLookupFilterLogic, setNewFieldLookupFilters, setNewFieldPicklistRestricted, setNewFieldPicklistValues, setNewFieldPrecision, setNewFieldRelationshipName, setNewFieldRelationshipTarget, setNewFieldRequired, setNewFieldReturnType, setNewFieldScale, setNewFieldStage, setNewFieldTextLength, setNewFieldType, setNewFieldUnique, setNewFieldValueSettings, setShowNewField, showNewField, validateNewFieldFormula } = ctx;
  useEffect(() => {
    if (!showNewField) {
      setGlobalValueSetApiName('');
      setGlobalValueSetError('');
      setRollupChildObject('');
      setRollupRelationshipField('');
      setRollupOperation('COUNT');
      setRollupSourceField('');
      setAutoNumberFormat('REC-{0000}');
      setRollupFilterLogic('All');
      setRollupFilters([]);
    }
  }, [showNewField]);
  useEffect(() => {
    if (!showNewField || !['Picklist', 'Multi-Select Picklist'].includes(newFieldType)) return;
    let active = true;
    void apiRequest<{ valueSets: Array<{ apiName: string; label: string; values: Array<{ value: string; active: boolean }> }> }>(
      '/metadata/global-value-sets'
    ).then((payload) => {
      if (active) {
        setGlobalValueSets(payload.valueSets);
        setGlobalValueSetError('');
      }
    }).catch((error: unknown) => {
      if (active) setGlobalValueSetError(error instanceof Error ? error.message : 'Unable to load Global Value Sets');
    });
    return () => { active = false; };
  }, [showNewField, newFieldType]);
  const rollupChildren = objects.filter((candidate: any) => candidate.fields.some((field: any) =>
    (field.relationship?.type === 'Master-Detail' || field.relationship?.type === 'Lookup') && field.relationship.targetObject === object.apiName));
  const selectedRollupChild = rollupChildren.find((candidate: any) => candidate.apiName === rollupChildObject);
  const rollupRelationships = selectedRollupChild?.fields.filter((field: any) =>
    (field.relationship?.type === 'Master-Detail' || field.relationship?.type === 'Lookup') && field.relationship.targetObject === object.apiName) ?? [];
  const rollupSources = selectedRollupChild?.fields.filter((field: any) => {
    const type = String(field.dataType);
    const numeric = /^(Number|Currency|Percent)(?:\(|$)/i.test(type);
    const temporal = /^(Date|Date\/Time|DateTime)$/i.test(type);
    return numeric || (rollupOperation !== 'SUM' && temporal);
  }) ?? [];
  const rollupConfigurationError = newFieldType === 'Roll-Up Summary'
    && (!selectedRollupChild || !rollupRelationships.some((field: any) => field.apiName === rollupRelationshipField)
      || (rollupOperation !== 'COUNT' && !rollupSources.some((field: any) => field.apiName === rollupSourceField)))
    ? 'Choose a child Master-Detail or Lookup relationship and a compatible source field for this roll-up operation.'
    : '';
  const autoNumberConfigurationError = newFieldType === 'Auto Number'
    && (!autoNumberFormat.trim() || autoNumberFormat.length > 80
      || (!/\{0+\}/.test(autoNumberFormat) && !/\{YYYY\}/.test(autoNumberFormat)))
    ? 'Auto Number format must contain a zero or year placeholder and be at most 80 characters.'
    : '';
  const fieldConfigurationError = newFieldConfigurationError || rollupConfigurationError || autoNumberConfigurationError;
  const rollupConfig = newFieldType === 'Roll-Up Summary' && selectedRollupChild && rollupRelationshipField
    ? {
      childObject: selectedRollupChild.apiName,
      relationshipField: rollupRelationshipField,
      operation: rollupOperation,
      ...(rollupOperation === 'COUNT' ? {} : { sourceField: rollupSourceField }),
      filterLogic: rollupFilterLogic,
      filters: rollupFilters.map(({ fieldApiName, operator, value }) => ({ fieldApiName, operator, value }))
    } as const
    : undefined;
  return <>
      {showNewField && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { resetNewFieldDraft(); setShowNewField(false); } }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-field-title">
            <div className="modal-header"><h2 id="new-field-title">New Field</h2><button className="icon-button dark" onClick={() => { resetNewFieldDraft(); setShowNewField(false); }} aria-label="Close"><X size={18} /></button></div>
            <p className="modal-copy">Create a field on {object.label}. Formula and relationship definitions are stored as object metadata.</p>
            <div className="wizard-progress" aria-label="New field steps">
              {(['Select Type', 'Configure', 'Page Layouts', 'Review'] as const).map((step, index) => <span key={step} className={newFieldStage === index ? 'active' : newFieldStage > index ? 'complete' : ''}>{index + 1}. {step}</span>)}
            </div>
            {newFieldStage === 0 && <div>
              <label className="form-label" htmlFor="new-field-type">Data Type</label>
              <select className="form-control" id="new-field-type" value={newFieldType} onChange={(event) => setNewFieldType(event.target.value)}>
              {['Text', 'Text Area', 'Text (Encrypted)', 'Auto Number', 'Long Text Area', 'Rich Text Area', 'Number', 'Currency', 'Percent', 'Date', 'Date/Time', 'Time', 'Checkbox', 'Email', 'Phone', 'URL', 'Image', 'File', 'Address', 'Geolocation', 'Formula', 'Roll-Up Summary', 'Picklist', 'Multi-Select Picklist', 'Lookup Relationship', 'Master-Detail Relationship', ...(object.apiName === 'User' ? ['Hierarchical Relationship'] : [])].map((type) => <option key={type}>{type}</option>)}
              </select>
              {newFieldType === 'Text (Encrypted)' && <p className="permission-help">Encrypted with the platform key at rest. Values are masked unless the user has View Encrypted Data access. Maximum 175 characters; encrypted values cannot be unique or external IDs.</p>}
              <p className="permission-help">External Lookup and Indirect Lookup require external objects, which are not supported for this object. Hierarchical Relationship is available for User.</p>
            </div>}
            {newFieldStage === 1 && <div>
            <label className="form-label" htmlFor="new-field-label">Field Label</label>
            <input className="form-control" id="new-field-label" value={newFieldLabel} onChange={(event) => setNewFieldLabel(event.target.value)} placeholder="Enter a field label" autoFocus />
            <label className="form-label">Field Name<div className="form-display">{newFieldApiName || 'Enter a field label to generate the API name'}</div></label>
            {newFieldType === 'Text' && <label className="form-label" htmlFor="new-field-text-length">Length<input className="form-control" id="new-field-text-length" type="number" min={1} max={255} step={1} value={newFieldTextLength} onChange={(event) => setNewFieldTextLength(Number(event.target.value))} /></label>}
            {newFieldType === 'Auto Number' && <label className="form-label">Display Format
              <input className="form-control" maxLength={80} value={autoNumberFormat}
                onChange={(event) => setAutoNumberFormat(event.target.value)} placeholder="INV-{0000}" />
            </label>}
            {['Number', 'Currency', 'Percent'].includes(newFieldType) && <div className="form-options">
              <label className="form-label">Length (Precision)<input className="form-control" type="number" min={1} max={18} step={1} value={newFieldPrecision} onChange={(event) => {
                const precision = Number(event.target.value);
                setNewFieldPrecision(precision);
                setNewFieldScale((scale) => Math.min(scale, precision));
              }} /></label>
              <label className="form-label">Decimal Places (Scale)<input className="form-control" type="number" min={0} max={newFieldPrecision} step={1} value={newFieldScale} onChange={(event) => setNewFieldScale(Number(event.target.value))} /></label>
            </div>}
            {['Picklist', 'Multi-Select Picklist'].includes(newFieldType) && <>
              <label className="form-label">Global Value Set
                <select className="form-control" value={globalValueSetApiName} onChange={(event) => {
                  const selected = event.target.value;
                  setGlobalValueSetApiName(selected);
                  const values = globalValueSets.find((item) => item.apiName === selected)
                    ?.values.filter((item) => item.active).map((item) => item.value) ?? [];
                  setNewFieldPicklistValues(values.join('\n'));
                  setNewFieldValueSettings({});
                }}>
                  <option value="">Use field-specific values</option>
                  {globalValueSets.map((valueSet) => <option key={valueSet.apiName} value={valueSet.apiName}>{valueSet.label} ({valueSet.apiName})</option>)}
                </select>
              </label>
              {globalValueSetError && <p className="permission-help">Global Value Sets could not be loaded. You can still define field-specific values. {globalValueSetError}</p>}
              <PicklistValueRows key={globalValueSetApiName || 'field-specific'} values={newFieldPicklistValues.split(/\r?\n/).filter(Boolean)} disabled={Boolean(globalValueSetApiName)} onChange={(values, previous, replacement) => {
                setNewFieldPicklistValues(values.join('\n'));
                setNewFieldValueSettings((current) => Object.fromEntries(Object.entries(current).map(([controllerValue, selectedValues]) =>
                  [controllerValue, selectedValues.map((value) => value === previous ? replacement ?? '' : value).filter((value) => values.includes(value))])));
                if (previous && newFieldDefaultValue === previous) {
                  setNewFieldDefaultValue(replacement && values.includes(replacement) ? replacement : '');
                  setNewFieldHasDefault(Boolean(replacement && values.includes(replacement)));
                }
              }} />
              <label className="checkbox-row"><input type="checkbox" checked={newFieldPicklistRestricted} onChange={(event) => setNewFieldPicklistRestricted(event.target.checked)} />Restrict to the values defined in the value set</label>
              {object.fields.some((field) => field.apiName !== newFieldApiName && (field.dataType === 'Picklist' || field.dataType === 'Checkbox')) && <div className="metadata-card">
                <label className="form-label">Controlling Field
                  <select className="form-control" value={newFieldControllerApiName} onChange={(event) => {
                    const controllerApiName = event.target.value;
                    const controller = object.fields.find((field) => field.apiName === controllerApiName);
                    const values = controller?.dataType === 'Checkbox' ? ['true', 'false'] : controller?.picklistValues ?? [];
                    setNewFieldControllerApiName(controllerApiName);
                    setNewFieldValueSettings(Object.fromEntries(values.map((value) => [value, newFieldValueSettings[value] ?? []])));
                  }}>
                    <option value="">None</option>{object.fields.filter((field) => field.apiName !== newFieldApiName && (field.dataType === 'Picklist' || field.dataType === 'Checkbox')).map((field) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.dataType})</option>)}
                  </select>
                </label>
                {newFieldControllerApiName && <><p className="permission-help">Choose which values are available for each controlling value.</p>{newFieldControllerValues.map((controllerValue) => <div className="metadata-card" key={controllerValue}>
                  <strong>{controllerValue}</strong>
                  <div className="field-selector-list">{newFieldPicklistOptions.map((value) => <label className="checkbox-row" key={value}><input type="checkbox" checked={(newFieldValueSettings[controllerValue] ?? []).includes(value)} onChange={() => {
                    const selectedValues = newFieldValueSettings[controllerValue] ?? [];
                    setNewFieldValueSettings({ ...newFieldValueSettings, [controllerValue]: selectedValues.includes(value) ? selectedValues.filter((item) => item !== value) : [...selectedValues, value] });
                  }} />{value}</label>)}</div>
                </div>)}</>}
              </div>}
            </>}
            {(newFieldType === 'Lookup Relationship' || newFieldType === 'Master-Detail Relationship' || newFieldType === 'Hierarchical Relationship') && <>
              {newFieldType === 'Hierarchical Relationship'
                ? <div className="form-display">Related Object: User</div>
                : <label className="form-label" htmlFor="new-field-target">Related Object
                  <select className="form-control" id="new-field-target" value={newFieldRelationshipTarget} onChange={(event) => {
                    setNewFieldRelationshipTarget(event.target.value);
                    setNewFieldLookupFilters([]);
                    setNewFieldLookupFilterLogic('All');
                  }}>
                    <option value="">Select an object</option>{objects.filter((item) => newFieldType === 'Lookup Relationship' || item.apiName !== object.apiName).map((item) => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
                  </select>
                </label>}
              <label className="form-label">Relationship Name
                  <input className="form-control" value={newFieldRelationshipName || newFieldLabel.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}
                  onChange={(event) => setNewFieldRelationshipName(event.target.value)} />
              </label>
              <label className="form-label">Child Relationship Name
                <input className="form-control" value={newFieldChildRelationshipName || `${object.apiName.replace(/__c$/, '')}${newFieldApiName.replace(/Id$/, '')}Records`.slice(0,80)}
                  onChange={(event) => setNewFieldChildRelationshipName(event.target.value)} />
              </label>
              {newFieldType === 'Lookup Relationship' && <label className="form-label">When a referenced record is deleted
                <select className="form-control" value={newFieldRequired ? 'Restrict' : newFieldDeleteBehavior}
                  disabled={newFieldRequired}
                  onChange={(event) => setNewFieldDeleteBehavior(event.target.value as 'Clear' | 'Restrict' | 'Cascade')}>
                  <option value="Clear">Clear the lookup field</option>
                  <option value="Restrict">Prevent deletion</option>
                  <option value="Cascade">Delete related records (requires permission for every record)</option>
                </select>
              </label>}
              {newFieldType === 'Master-Detail Relationship' && <label className="checkbox-row">
                <input type="checkbox" checked={newFieldAllowReparenting} onChange={(event) => setNewFieldAllowReparenting(event.target.checked)} />
                Allow reparenting
              </label>}
              {newFieldType !== 'Hierarchical Relationship' && newFieldRelationshipTarget && <>
                <div className="section-toolbar">
                  <div><h3>Related Lookup Filters</h3><p>Add one or more criteria that determine which records are eligible.</p></div>
                  <button type="button" className="btn" onClick={() => setNewFieldLookupFilters((filters) => [...filters, {
                    id: crypto.randomUUID(),
                    relatedFieldApiName: '',
                    operator: 'Equals',
                    valueMode: 'Value',
                    value: '',
                    valueFieldApiName: '',
                    required: true
                  }])}><Plus size={14} />Add Filter</button>
                </div>
                {newFieldLookupFilters.length > 1 && <label className="form-label">Required criteria match
                  <select className="form-control" aria-label="Lookup filter logic" value={newFieldLookupFilterLogic} onChange={(event) => setNewFieldLookupFilterLogic(event.target.value as 'All' | 'Any')}>
                    <option value="All">All criteria</option><option value="Any">Any criterion</option>
                  </select>
                </label>}
                {newFieldLookupFilters.map((filter, index) => {
                  const relatedFields = objects.find((item) => item.apiName === newFieldRelationshipTarget)?.fields ?? [];
                  const noOperand = filter.operator === 'Is Null' || filter.operator === 'Is Not Null';
                  const updateFilter = (update: Partial<NewFieldLookupFilterDraft>) => setNewFieldLookupFilters((filters) =>
                    filters.map((candidate) => candidate.id === filter.id ? { ...candidate, ...update } : candidate));
                  return <div className="metadata-card" key={filter.id}>
                    <div className="metadata-card-header"><h4>Filter {index + 1}</h4><button type="button" className="row-menu" aria-label={`Remove lookup filter ${index + 1}`} onClick={() => setNewFieldLookupFilters((filters) => filters.filter((candidate) => candidate.id !== filter.id))}><X size={14} /></button></div>
                    <label className="form-label">Related Field
                      <select className="form-control" value={filter.relatedFieldApiName} onChange={(event) => updateFilter({ relatedFieldApiName: event.target.value })}>
                        <option value="">Select a field…</option>{relatedFields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}
                      </select>
                    </label>
                    <label className="form-label">Operator
                      <select className="form-control" value={filter.operator} onChange={(event) => updateFilter({
                        operator: event.target.value as RelatedLookupFilterMetadata['operator'],
                        ...(event.target.value === 'Is Null' || event.target.value === 'Is Not Null' ? { value: '', valueFieldApiName: '' } : {})
                      })}>
                        {relatedLookupFilterOperators.map((operator) => <option key={operator}>{operator}</option>)}
                      </select>
                    </label>
                    {!noOperand && <>
                      <label className="form-label">Compare Against
                        <select className="form-control" value={filter.valueMode} onChange={(event) => updateFilter({ valueMode: event.target.value as 'Value' | 'Field', value: '', valueFieldApiName: '' })}>
                          <option value="Value">A value</option>
                          <option value="Field">A field on this object</option>
                        </select>
                      </label>
                      {filter.valueMode === 'Field'
                        ? <label className="form-label">Source Field
                          <select className="form-control" value={filter.valueFieldApiName} onChange={(event) => updateFilter({ valueFieldApiName: event.target.value })}>
                            <option value="">Select a field…</option>{object.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}
                          </select>
                        </label>
                        : <label className="form-label">Value
                          <input className="form-control" value={filter.value} onChange={(event) => updateFilter({ value: event.target.value })} />
                        </label>}
                    </>}
                    <label className="checkbox-row"><input type="checkbox" checked={filter.required} onChange={(event) => updateFilter({ required: event.target.checked })} />Required</label>
                  </div>;
                })}
              </>}
            </>}
            {newFieldType === 'Roll-Up Summary' && <>
              <label className="form-label">Child Object
                <select className="form-control" value={rollupChildObject} onChange={(event) => {
                  setRollupChildObject(event.target.value);
                  setRollupRelationshipField('');
                  setRollupSourceField('');
                }}>
                  <option value="">Select a child object</option>
                  {rollupChildren.map((candidate: any) => <option key={candidate.apiName} value={candidate.apiName}>{candidate.label}</option>)}
                </select>
              </label>
              <label className="form-label">Master-Detail Relationship
                <select className="form-control" value={rollupRelationshipField} onChange={(event) => setRollupRelationshipField(event.target.value)}>
                  <option value="">Select a relationship</option>
                  {rollupRelationships.map((field: any) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                </select>
              </label>
              <label className="form-label">Summary Operation
                <select className="form-control" value={rollupOperation} onChange={(event) => {
                  const operation = event.target.value as 'COUNT' | 'SUM' | 'MIN' | 'MAX';
                  setRollupOperation(operation);
                  if (operation === 'COUNT') setRollupSourceField('');
                  else if (operation === 'SUM' && !rollupSources.some((field: any) =>
                    field.apiName === rollupSourceField && /^(Number|Currency|Percent)(?:\(|$)/i.test(String(field.dataType))))
                    setRollupSourceField('');
                }}>
                  {['COUNT', 'SUM', 'MIN', 'MAX'].map((operation) => <option key={operation}>{operation}</option>)}
                </select>
              </label>
              {rollupOperation !== 'COUNT' && <label className="form-label">Summary Field
                <select className="form-control" value={rollupSourceField} onChange={(event) => setRollupSourceField(event.target.value)}>
                  <option value="">Select a compatible field</option>
                  {rollupSources.map((field: any) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.dataType})</option>)}
                </select>
              </label>}
              <div className="section-toolbar">
                <div><h3>Filter Criteria</h3><p>Only related records matching these criteria are included.</p></div>
                <button type="button" className="btn" onClick={() => setRollupFilters((filters) => [...filters, {
                  id: crypto.randomUUID(), fieldApiName: '', operator: 'Equals', value: ''
                }])}><Plus size={14} />Add Filter</button>
              </div>
              {rollupFilters.length > 1 && <label className="form-label">Criteria Logic
                <select className="form-control" value={rollupFilterLogic} onChange={(event) => setRollupFilterLogic(event.target.value as 'All' | 'Any')}>
                  <option value="All">Match all filters</option><option value="Any">Match any filter</option>
                </select>
              </label>}
              {rollupFilters.map((filter) => {
                const selectedField = selectedRollupChild?.fields.find((field: any) => field.apiName === filter.fieldApiName);
                const dataType = selectedField?.dataType?.toLowerCase() ?? '';
                const supportedFields = selectedRollupChild?.fields.filter((field: any) =>
                  !['Formula', 'Roll-Up Summary', 'Text (Encrypted)', 'Address', 'Geolocation'].includes(field.dataType)) ?? [];
                const operators = [
                  'Equals', 'Not Equal To',
                  ...(['Number', 'Currency', 'Percent', 'Date', 'Date/Time', 'Time'].some((type) => selectedField?.dataType?.startsWith(type))
                    ? ['Greater Than', 'Less Than'] : []),
                  ...(['Text', 'Email', 'Phone', 'URL', 'Text Area', 'Long Text Area', 'Rich Text Area', 'Picklist'].includes(selectedField?.dataType)
                    ? ['Contains'] : []),
                  'Is Null', 'Is Not Null'
                ];
                return <div className="metadata-card" key={filter.id}>
                  <div className="section-toolbar">
                    <strong>{selectedField?.label ?? 'Filter'}</strong>
                    <button type="button" className="btn" onClick={() => setRollupFilters((filters) => filters.filter((item) => item.id !== filter.id))}>Remove</button>
                  </div>
                  <label className="form-label">Field
                    <select className="form-control" value={filter.fieldApiName} onChange={(event) => setRollupFilters((filters) => filters.map((item) =>
                      item.id === filter.id ? { ...item, fieldApiName: event.target.value, operator: 'Equals', value: '' } : item))}>
                      <option value="">Select a field</option>
                      {supportedFields.map((field: any) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}
                    </select>
                  </label>
                  <label className="form-label">Operator
                    <select className="form-control" value={filter.operator} onChange={(event) => setRollupFilters((filters) => filters.map((item) =>
                      item.id === filter.id ? { ...item, operator: event.target.value } : item))}>
                      {operators.map((operator) => <option key={operator}>{operator}</option>)}
                    </select>
                  </label>
                  {!['Is Null', 'Is Not Null'].includes(filter.operator) && <label className="form-label">Value
                    {dataType === 'checkbox'
                      ? <select className="form-control" value={filter.value} onChange={(event) => setRollupFilters((filters) => filters.map((item) =>
                        item.id === filter.id ? { ...item, value: event.target.value } : item))}>
                        <option value="">Select a value</option><option value="true">True</option><option value="false">False</option>
                      </select>
                      : <input className="form-control" type={dataType === 'date' ? 'date' : dataType === 'date/time' ? 'datetime-local' : dataType === 'time' ? 'time' : ['number', 'currency', 'percent'].includes(dataType) ? 'number' : 'text'} value={filter.value}
                        onChange={(event) => setRollupFilters((filters) => filters.map((item) =>
                          item.id === filter.id ? { ...item, value: event.target.value } : item))} />}
                  </label>}
                </div>;
              })}
            </>}
            {newFieldType === 'Formula' && <>
              <label className="form-label" htmlFor="new-field-return-type">Formula Return Type</label>
              <select className="form-control" id="new-field-return-type" value={newFieldReturnType} onChange={(event) => { setNewFieldReturnType(event.target.value); setNewFieldFormulaValidation({ status: 'idle', message: '' }); }}>{['Number', 'Currency', 'Percent', 'Text', 'Date', 'DateTime', 'Time', 'Checkbox'].map((type) => <option key={type}>{type}</option>)}</select>
              <label className="form-label" htmlFor="new-field-formula">Formula</label>
              <SmartFieldInput textareaRef={formulaEditorRef} id="new-field-formula" multiline rows={4} kind="formula"
                value={newFieldFormula} objects={objects} primaryObjectApiName={object.apiName}
                onChange={next => { setNewFieldFormula(next); setNewFieldFormulaValidation({ status: 'idle', message: '' }); }}
                placeholder="For example: @Sale.Amount * @Sale.Probability" />
              <div className="formula-builder-tools">
                <label className="form-label">Insert Field
                  <select className="form-control" value="" onChange={(event) => { if (event.target.value) insertFormulaText(event.target.value); }}>
                    <option value="">Select a field…</option>
                    {object.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label} ({field.apiName})</option>)}
                  </select>
                </label>
                <label className="form-label">Insert Function
                  <select className="form-control" value="" onChange={(event) => {
                    const templates: Record<string, string> = {
                      IF: 'IF(condition, value_if_true, value_if_false)',
                      AND: 'AND(condition1, condition2)',
                      OR: 'OR(condition1, condition2)',
                      ISBLANK: 'ISBLANK(value)',
                      BLANKVALUE: 'BLANKVALUE(value, replacement)',
                      TEXT: 'TEXT(value)',
                      DATE: 'DATE(year, month, day)',
                      ROUND: 'ROUND(number, num_digits)'
                    };
                    if (event.target.value) insertFormulaText(templates[event.target.value] ?? `${event.target.value}()`);
                    event.target.value = '';
                  }}>
                    <option value="">Select a function…</option>
                    {['IF', 'AND', 'OR', 'ISBLANK', 'BLANKVALUE', 'TEXT', 'DATE', 'ROUND'].map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              </div>
              <div className="formula-operator-tools" aria-label="Insert operator">
                {[' + ', ' - ', ' * ', ' / ', ' = ', ' <> ', ' > ', ' < ', ' & ', ' AND ', ' OR '].map((operator) =>
                  <button key={operator} type="button" className="btn" onClick={() => insertFormulaText(operator)}>{operator.trim()}</button>
                )}
              </div>
              <div className="formula-validation-row">
                <button type="button" className="btn" onClick={() => { void validateNewFieldFormula(); }} disabled={!newFieldFormula.trim() || newFieldFormulaValidation.status === 'checking'}>
                  {newFieldFormulaValidation.status === 'checking' ? 'Checking…' : 'Check Syntax'}
                </button>
                {newFieldFormulaValidation.message && <span className={newFieldFormulaValidation.status === 'valid' ? 'formula-validation-success' : 'formula-validation-error'} role="status">{newFieldFormulaValidation.message}</span>}
              </div>
            </>}
            <label className="form-label" htmlFor="new-field-description">Description</label>
            <input className="form-control" id="new-field-description" value={newFieldDescription} onChange={(event) => setNewFieldDescription(event.target.value)} placeholder="Optional field description" />
            <label className="form-label" htmlFor="new-field-help-text">Help Text</label>
            <textarea className="form-control" id="new-field-help-text" value={newFieldHelpText} onChange={(event) => setNewFieldHelpText(event.target.value)} placeholder="Optional guidance shown to users" maxLength={255} rows={2} />
            {!['Formula', 'Roll-Up Summary', 'Auto Number', 'Address', 'Geolocation', 'Lookup Relationship', 'Master-Detail Relationship', 'Hierarchical Relationship', 'Text (Encrypted)'].includes(newFieldType) && (newFieldType === 'Checkbox'
              ? <div className="form-options"><label className="checkbox-row"><input type="checkbox" checked={newFieldHasDefault} onChange={(event) => setNewFieldHasDefault(event.target.checked)} />Set a default value</label><label className="checkbox-row"><input type="checkbox" disabled={!newFieldHasDefault} checked={newFieldDefaultValue === 'true'} onChange={(event) => setNewFieldDefaultValue(String(event.target.checked))} />Default to checked</label></div>
              : ['Picklist', 'Multi-Select Picklist'].includes(newFieldType)
                ? <label className="form-label">Default Value<select className="form-control" multiple={newFieldType === 'Multi-Select Picklist'} value={newFieldType === 'Multi-Select Picklist' ? newFieldDefaultValue.split(';').filter(Boolean) : newFieldDefaultValue} onChange={(event) => {
                  const values = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
                  const value = newFieldType === 'Multi-Select Picklist' ? values.join(';') : values[0] ?? '';
                  setNewFieldDefaultValue(value);
                  setNewFieldHasDefault(value !== '');
                }}><option value="">— None —</option>{newFieldPicklistValues.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                :                 <label className="form-label" htmlFor="new-field-default">Default Value<input className="form-control" id="new-field-default" type={['Number', 'Currency', 'Percent'].includes(newFieldType) ? 'number' : newFieldType === 'Date' ? 'date' : newFieldType === 'Date/Time' ? 'datetime-local' : newFieldType === 'Time' ? 'time' : newFieldType === 'Email' ? 'email' : newFieldType === 'URL' ? 'url' : 'text'} step={['Number', 'Currency', 'Percent'].includes(newFieldType) ? (newFieldScale ? 10 ** -newFieldScale : 1) : newFieldType === 'Time' ? 1 : undefined} maxLength={newFieldType === 'Text' ? newFieldTextLength : undefined} value={newFieldDefaultValue} onChange={(event) => { setNewFieldDefaultValue(event.target.value); setNewFieldHasDefault(event.target.value !== ''); }} /></label>)}
            {!['Formula', 'Roll-Up Summary'].includes(newFieldType) && <div className="form-options">
              <label className="checkbox-row"><input type="checkbox" checked={newFieldType === 'Master-Detail Relationship' || newFieldType === 'Auto Number' || newFieldRequired} disabled={newFieldType === 'Master-Detail Relationship' || newFieldType === 'Auto Number'} onChange={(event) => setNewFieldRequired(event.target.checked)} /> Required</label>
              <label className="checkbox-row"><input type="checkbox" checked={newFieldType === 'Auto Number' || newFieldUnique} disabled={newFieldType === 'Auto Number' || newFieldType === 'Text Area' || newFieldType === 'Text (Encrypted)' || newFieldType === 'Long Text Area' || newFieldType === 'Rich Text Area' || newFieldType === 'Address' || newFieldType === 'Geolocation' || newFieldType === 'Multi-Select Picklist' || newFieldType === 'Lookup Relationship' || newFieldType === 'Master-Detail Relationship' || newFieldType === 'Hierarchical Relationship'} onChange={(event) => setNewFieldUnique(event.target.checked)} /> Unique</label>
              {['Text', 'Number', 'Email', 'Phone'].includes(newFieldType) && <label className="checkbox-row">
                <input type="checkbox" checked={newFieldExternalId} onChange={(event) => setNewFieldExternalId(event.target.checked)} /> External ID
              </label>}
              {(newFieldUnique || newFieldExternalId) && ['Text', 'Email', 'Phone'].includes(newFieldType) && <label className="checkbox-row">
                <input type="checkbox" checked={newFieldCaseSensitive} onChange={(event) => setNewFieldCaseSensitive(event.target.checked)} /> Treat uppercase and lowercase values as different
              </label>}
            </div>}
            </div>}
            {newFieldStage === 2 && <div className="metadata-card" aria-label="Add field to page layouts">
              <h3>Add to Page Layouts</h3>
              <p className="permission-help">Choose which record layouts should display this field. You can change placements later in Page Layouts.</p>
              {(object.pageLayouts ?? []).map((layout) => <label className="checkbox-row" key={layout.id}>
                <input type="checkbox" checked={newFieldLayoutIds.includes(layout.id)} onChange={() => setNewFieldLayoutIds((current) =>
                  current.includes(layout.id) ? current.filter((id) => id !== layout.id) : [...current, layout.id])} />
                {layout.label}
              </label>)}
              {(object.pageLayouts ?? []).length === 0 && <p className="permission-help">No page layouts are available for this object.</p>}
            </div>}
            {newFieldStage === 3 && <div className="metadata-card" aria-label="Field review">
              <h3>Review Field</h3>
              <dl className="metadata-summary">
                <dt>Data Type</dt><dd>{newFieldType}{newFieldType === 'Text' ? ` (${newFieldTextLength})` : ''}{['Number', 'Currency', 'Percent'].includes(newFieldType) ? ` (${newFieldPrecision}, ${newFieldScale})` : ''}</dd>
                {newFieldType === 'Auto Number' && <><dt>Display Format</dt><dd>{autoNumberFormat}</dd></>}
                <dt>Field Label</dt><dd>{newFieldLabel.trim()}</dd>
                <dt>Field Name</dt><dd>{newFieldApiName}</dd>
                <dt>Required / Unique</dt><dd>{newFieldType === 'Master-Detail Relationship' || newFieldType === 'Auto Number' || newFieldRequired ? 'Required' : 'Optional'} / {newFieldType === 'Auto Number' || newFieldUnique ? 'Unique' : 'Not unique'}</dd>
                {['Text', 'Number', 'Email', 'Phone'].includes(newFieldType) && <><dt>External ID</dt><dd>{newFieldExternalId ? 'Yes' : 'No'}</dd></>}
                {(newFieldUnique || newFieldExternalId) && ['Text', 'Email', 'Phone'].includes(newFieldType) && <><dt>Case sensitivity</dt><dd>{newFieldCaseSensitive ? 'Case sensitive' : 'Case insensitive'}</dd></>}
                {newFieldDescription.trim() && <><dt>Description</dt><dd>{newFieldDescription.trim()}</dd></>}
                {newFieldHelpText.trim() && <><dt>Help Text</dt><dd>{newFieldHelpText.trim()}</dd></>}
                {globalValueSetApiName && <><dt>Global Value Set</dt><dd>{globalValueSetApiName}</dd></>}
                {newFieldPicklistOptions.length > 0 && <><dt>Values</dt><dd>{newFieldPicklistOptions.join(', ')}</dd></>}
                {newFieldController && <><dt>Controlling Field</dt><dd>{newFieldController.label}</dd></>}
                {newFieldRelationshipTarget && <><dt>Related Object</dt><dd>{newFieldRelationshipTarget}</dd></>}
                {newFieldType === 'Roll-Up Summary' && <><dt>Summary</dt><dd>{rollupOperation} {rollupSourceField ? `of ${rollupSourceField}` : ''} from {rollupChildObject || 'child object'}</dd></>}
                {newFieldHasDefault && <><dt>Default Value</dt><dd>{newFieldDefaultValue || '(blank)'}</dd></>}
                <dt>Page Layouts</dt><dd>{(object.pageLayouts ?? []).filter((layout) => newFieldLayoutIds.includes(layout.id)).map((layout) => layout.label).join(', ') || 'None'}</dd>
              </dl>
            </div>}
            {newFieldStage === 1 && fieldConfigurationError && <p className="form-error" role="alert">{fieldConfigurationError}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => { resetNewFieldDraft(); setShowNewField(false); }}>Cancel</button>
              {newFieldStage > 0 && <button className="btn" onClick={() => setNewFieldStage((stage) => (stage - 1) as 0 | 1 | 2 | 3)}>Back</button>}
              {newFieldStage < 3
                ? <button className="btn btn-brand" onClick={() => setNewFieldStage((stage) => (stage + 1) as 0 | 1 | 2 | 3)} disabled={newFieldStage === 1 && Boolean(fieldConfigurationError)}>Next</button>
                : <button className="btn btn-brand" onClick={() => { void addField(rollupConfig, globalValueSetApiName || undefined, autoNumberFormat); }} disabled={Boolean(fieldConfigurationError)}>Save Field</button>}
            </div>
          </section>
        </div>
      )}</>;
}
