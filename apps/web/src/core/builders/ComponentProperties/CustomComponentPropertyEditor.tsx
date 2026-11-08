import BooleanPropertyEditor from './property-editors/BooleanPropertyEditor';
import NumberPropertyEditor from './property-editors/NumberPropertyEditor';
import PicklistPropertyEditor from './property-editors/PicklistPropertyEditor';
import ObjectFieldMapPropertyEditor from './property-editors/ObjectFieldMapPropertyEditor';
import ExpressionPropertyEditor from './property-editors/ExpressionPropertyEditor';
import StringPropertyEditor from './property-editors/StringPropertyEditor';
import EventPropertyEditor from './property-editors/EventPropertyEditor';
import ResponsivePropertyEditor from './property-editors/ResponsivePropertyEditor';
import {metadataFieldObject,metadataReference,metadataSelection} from '../../metadata/Definitions/metadataReferences';
import StructuredListPropertyEditor from './StructuredListPropertyEditor';
import { useState } from 'react';
import TenantMediaPicker from './TenantMediaPicker';
import type { ObjectMetadata,FlowDefinitionMetadata } from '../../metadata/Definitions/metadata';
import { sortComponentSettings, validateComponentSetting, resolveComponentSettings, isPropertyRecord, componentSettingAvailable, type PropertyDevice, type ComponentSettingDefinition } from '../../components/Properties/componentSettingDefinitions';
import {
  addComponentProperty,
  displayComponentPropertyName,
  validateComponentPropertyName,
  type ComponentPropertyKind,
  type ComponentPropertyValues
} from '../../components/Properties/componentProperties';

export default function CustomComponentPropertyEditor({
  properties,
  onChange,
  idPrefix = 'component-property', device, componentVersion,
  disabled = false,
  addOnly = false,
  definitions, choiceOverrides = {}, targetBindableOptions = {},
  objects = [], flows = [], primaryObjectApiName = '', appObjectApiNames = []
}: {
  idPrefix?: string; device?: PropertyDevice; componentVersion?: number;
  properties: ComponentPropertyValues;
  onChange: (next: ComponentPropertyValues) => void;
  disabled?: boolean;
  addOnly?: boolean;
  definitions?: readonly ComponentSettingDefinition[];
  choiceOverrides?:Readonly<Record<string,ReadonlyArray<{key:string;label:string}>>>;
  targetBindableOptions?:Readonly<Record<string,ReadonlyArray<{key:string;label:string}>>>;
  objects?: readonly ObjectMetadata[];
  flows?: readonly FlowDefinitionMetadata[];
  primaryObjectApiName?: string;
  appObjectApiNames?: readonly string[];
}) {
  const [propertyName, setPropertyName] = useState('');
  const [propertyType, setPropertyType] = useState<ComponentPropertyKind>('text');
  const [error, setError] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const update = (name: string, value: unknown) => onChange({ ...properties, [name]: value });
  const remove = (name: string) => {
    const next = { ...properties };
    delete next[name];
    onChange(next);
  };
  const add = () => {
    const name = propertyName.trim();
    const validation = validateComponentPropertyName(name, properties);
    if (validation) { setError(validation); return; }
    const definition = definitions?.find(item => item.propertyKey === name);
    const inferredType: ComponentPropertyKind = definition?.kind === 'BOOLEAN' ? 'boolean'
      : ['NUMBER', 'CURRENCY'].includes(definition?.kind ?? '') ? 'number' : propertyType;
    onChange(addComponentProperty(properties, name, inferredType));
    setPropertyName('');
    setError('');
  };

  const typedDefinitions = definitions ? sortComponentSettings(definitions).filter(d=>componentSettingAvailable(d,device,componentVersion)) : [];
  const definitionByName = new Map(typedDefinitions.map(definition => [definition.propertyKey, definition]));
  const availablePropertyNames = typedDefinitions.filter(definition => !Object.prototype.hasOwnProperty.call(properties, definition.propertyKey));
  const selectedDefinition = typedDefinitions.find(definition => definition.propertyKey === propertyName.trim());
  const visibleProperties = definitions ? [
    ...typedDefinitions.map(definition => [definition.propertyKey, properties[definition.propertyKey] ?? definition.defaultValue ?? ''] as const),
    ...Object.entries(properties).filter(([name]) => !definitions.some(d=>d.propertyKey===name))
  ] : Object.entries(properties);
  return <div className="metadata-component-properties" aria-label="Custom component properties">
    {(!addOnly || typedDefinitions.length > 0) && <details className="component-optional-settings" open={!addOnly}>
      <summary className="properties-section-title">{addOnly ? 'Add optional appearance, card, image and responsive settings' : 'Component settings'}</summary>
      {!Object.keys(properties).length && <p className="properties-help">No settings yet. Add a property to configure this component.</p>}
      {(addOnly ? visibleProperties.filter(([name]) => definitionByName.has(name) && !Object.prototype.hasOwnProperty.call(properties,name)) : visibleProperties).map(([name, value]) => {
        const definition = definitionByName.get(name);
        const label = definition?.label ?? displayComponentPropertyName(name);
        const id = `${idPrefix}-${name}`;
        const boundObject=metadataFieldObject(objects,{...properties,objectApiName:properties.objectApiName||primaryObjectApiName},name);
        return <div className="metadata-array-property" key={name}>
          {definition?.helpText && <p className="properties-help">{definition.helpText}</p>}
          {definition?.kind === 'GROUP' ? <fieldset disabled={disabled}><legend>{label}</legend>
            <CustomComponentPropertyEditor idPrefix={id} definitions={definition.fields??[]}
              properties={isPropertyRecord(value)?value:{}} objects={objects} flows={flows}
              primaryObjectApiName={primaryObjectApiName} appObjectApiNames={appObjectApiNames}
              disabled={disabled} device={device} componentVersion={componentVersion}
              choiceOverrides={choiceOverrides} targetBindableOptions={targetBindableOptions}
              onChange={next=>update(name,next)}/>
          </fieldset> : definition?.kind === 'COLLECTION' ? <fieldset disabled={disabled}><legend>{label}</legend>
            {(Array.isArray(value)?value:[]).map((row,index)=><div className="metadata-array-property" key={index}>
              <CustomComponentPropertyEditor idPrefix={id+'-'+index} definitions={definition.fields??[]}
                properties={isPropertyRecord(row)?row:{}} objects={objects} flows={flows}
                primaryObjectApiName={primaryObjectApiName} appObjectApiNames={appObjectApiNames}
                disabled={disabled} device={device} componentVersion={componentVersion}
                choiceOverrides={{...choiceOverrides,
                  ...(isPropertyRecord(row)&&typeof row.targetComponentId==='string'&&targetBindableOptions[row.targetComponentId]
                    ?{targetProperty:targetBindableOptions[row.targetComponentId]}:{})}}
                targetBindableOptions={targetBindableOptions}
                onChange={next=>update(name,(value as unknown[]).map((v,i)=>i===index?next:v))}/>
              <button type="button" className="btn btn-small" disabled={disabled}
                onClick={()=>update(name,(value as unknown[]).filter((_,i)=>i!==index))}>Remove {label} row {index+1}</button>
            </div>)}
            <button type="button" className="btn btn-small" disabled={disabled||(Array.isArray(value)?value.length:0)>=(definition.maxItems??500)}
              onClick={()=>update(name,[...(Array.isArray(value)?value:[]),resolveComponentSettings(definition.fields??[],{})])}>Add {label} row</button>
          </fieldset> : definition?.kind === 'STRING_LIST' ? <fieldset disabled={disabled}><legend>{label}</legend>
            {(Array.isArray(value)?value:[]).map((entry,index)=><div className="flow-config-row" key={index}>
              <input className="form-control" aria-label={label+' '+(index+1)} value={String(entry)} maxLength={definition.maxLength}
                onChange={event=>update(name,(value as unknown[]).map((v,i)=>i===index?event.target.value:v))}/>
              <button type="button" className="btn btn-small" onClick={()=>update(name,(value as unknown[]).filter((_,i)=>i!==index))}>Remove item</button>
            </div>)}
            <button type="button" className="btn btn-small" disabled={disabled||(Array.isArray(value)?value.length:0)>=(definition.maxItems??500)}
              onClick={()=>update(name,[...(Array.isArray(value)?value:[]),''])}>Add {label} item</button>
          </fieldset> : definition && ['TEXT','OBJECT_FIELD'].includes(definition.kind)
            && Boolean(choiceOverrides[name]?.length) ? <label className="form-label" htmlFor={id}>{label}
            <select id={id} className="form-control" value={String(value??'')} disabled={disabled}
              onChange={event=>update(name,event.target.value)}>
              <option value="">Select {label.toLowerCase()}…</option>
              {value!==undefined&&value!==null&&String(value)!==''&&!choiceOverrides[name]?.some(o=>o.key===value)
                &&<option value={String(value)}>{String(value)} (previously configured)</option>}
              {choiceOverrides[name]?.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}
            </select></label> : definition?.kind === 'OBJECT' ? <label className="form-label" htmlFor={id}>{label}<select id={id} className="form-control" disabled={disabled}
              value={metadataSelection(objects,value)?.apiName??String(value??'')}
              onChange={event=>{const selected=objects.find(item=>item.apiName===event.target.value);
               update(name,selected?.id?metadataReference(selected.id):event.target.value);}}>
              <option value="">Select Object…</option>{objects.map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
            </select></label> : definition?.kind==='FIELD_LIST' || definition?.kind==='COLUMNS' || definition?.kind==='OPTIONS' || definition?.kind==='RECORD_LIST'
              ? <StructuredListPropertyEditor label={label} kind={definition.kind} value={value}
                  fields={boundObject?.fields??[]} disabled={disabled} onChange={next=>update(name,next)}/>
              : definition?.kind === 'OBJECT_FIELD' ? <ObjectFieldMapPropertyEditor id={id} label={label} name={name} value={value} disabled={disabled} fields={boundObject?.fields??[]} onChange={next=>update(name,next)}/> : definition?.kind === 'FLOW' ? <PicklistPropertyEditor id={id} label={label} value={value} disabled={disabled} flows={flows} onChange={next=>update(name,next)}/> : definition?.kind === 'SELECT' && definition.choices ? <PicklistPropertyEditor id={id} label={label} value={value} disabled={disabled} required={definition.required} choices={definition.choices} onChange={next=>update(name,next)}/> :
          definition?.kind === 'IMAGE' ? <div className="form-label"><label>{label}</label>
            <TenantMediaPicker value={String(value??'')} disabled={disabled}
              onChange={next=>update(name,next)}/></div> :
          definition?.kind === 'BOOLEAN' || typeof value === 'boolean'
            ? <BooleanPropertyEditor label={label} value={value} disabled={disabled} onChange={next=>update(name,next)}/>
            : definition?.kind === 'NUMBER' || definition?.kind === 'CURRENCY' || typeof value === 'number'
              ? <NumberPropertyEditor id={id} label={label} value={value} disabled={disabled} onChange={next=>update(name,next)} onClear={()=>remove(name)}/> : typeof value === 'string'
                ? <div className="form-label"><label htmlFor={id}>{label}</label>
                    {/formula|expression/i.test(name)
                      ? <ExpressionPropertyEditor id={id} value={value} disabled={disabled} objects={objects} primaryObjectApiName={primaryObjectApiName} appObjectApiNames={appObjectApiNames} onChange={next=>update(name,next)}/>
                      : /^(on[A-Z]|event)/.test(name)
                        ? <EventPropertyEditor id={id} value={value} disabled={disabled} objects={objects} primaryObjectApiName={primaryObjectApiName} appObjectApiNames={appObjectApiNames} onChange={next=>update(name,next)}/>
                        : /mobile|tablet|desktop|responsive|breakpoint/i.test(name)
                          ? <ResponsivePropertyEditor id={id} value={value} disabled={disabled} objects={objects} primaryObjectApiName={primaryObjectApiName} appObjectApiNames={appObjectApiNames} onChange={next=>update(name,next)}/>
                          : <StringPropertyEditor id={id} name={name} isColor={definition?.kind==='COLOR'} value={value} disabled={disabled} objects={objects} primaryObjectApiName={primaryObjectApiName} appObjectApiNames={appObjectApiNames} onChange={next=>update(name,next)}/>}
                  </div> : <div className="properties-help">{label} contains structured data; its existing value is preserved.</div>}
          {definition && !validateComponentSetting(definition,value) && <span className="auth-error">Invalid {label.toLowerCase()}</span>}
          <button className="btn btn-small" type="button" disabled={disabled || Boolean(definition?.required)}
            aria-label={`Remove ${label} property`} onClick={() => remove(name)}>Remove property</button>
        </div>;
      })}
    </details>}
    <div className="properties-section-title">Add setting</div>
    {availablePropertyNames.length > 0 && <label className="form-label">Find a setting
      <input className="form-control" type="search" value={propertySearch} disabled={disabled}
        placeholder="Search available settings" onChange={event => setPropertySearch(event.target.value)} />
    </label>}
    {availablePropertyNames.length > 0 && <label className="form-label">Choose property
      <select className="form-control" disabled={disabled} value={selectedDefinition?.propertyKey ?? ""}
        onChange={event => { setPropertyName(event.target.value); setError(""); }}>
        <option value="">Choose a setting…</option>
        {availablePropertyNames.filter(definition => (definition.label + " " + definition.propertyKey).toLowerCase().includes(propertySearch.trim().toLowerCase()))
          .map(definition => <option key={definition.propertyKey} value={definition.propertyKey}>{definition.label} ({definition.propertyKey})</option>)}
      </select>
    </label>}
    <details className="component-advanced-custom-setting" open={!definitions?.length}>
      <summary>Advanced: enter a custom property API name</summary>
      <label className="form-label">Property API name
        <input className="form-control" disabled={disabled} value={propertyName}
          placeholder="e.g. title, accentColor, columns"
          onChange={(event) => { setPropertyName(event.target.value); setError(""); }} />
      </label>
    </details>
    {!selectedDefinition && <label className="form-label">Value type
      <select className="form-control" value={propertyType} disabled={disabled}
        onChange={(event) => setPropertyType(event.target.value as ComponentPropertyKind)}>
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="boolean">True / false</option>
      </select>
    </label>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    <button type="button" className="btn" disabled={disabled || !propertyName.trim()}
      onClick={add}>Add property</button>
  </div>;
}
