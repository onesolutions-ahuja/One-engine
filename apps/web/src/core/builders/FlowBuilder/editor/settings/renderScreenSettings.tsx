import { generateMetadataApiName, metadataNameConflict, suggestMetadataApiName } from '../../../../metadata/Definitions/metadataApiNames';
import { rowsFrom, screenOutcomesFrom, displayValue, type ConfigRow } from '../../flowEditorData';
import CustomComponentPropertyEditor from '../../../ComponentProperties/CustomComponentPropertyEditor';
import SmartFieldInput from '../../../../../component-libraries/shared/primitives/SmartFieldInput/SmartFieldInput';
import PageComponentStyleEditor from '../../../ComponentStyleEditor/PageComponentStyleEditor';
import { parseComponentProperties } from '../../../../components/Properties/componentProperties';
import { Plus, X } from 'lucide-react';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowConfiguration } from './useFlowConfiguration';

export function renderScreenSettings(
  editorState: ReturnType<typeof useFlowEditorState>,
  props: FlowBuilderProps,
  configuration: ReturnType<typeof useFlowConfiguration>,
) {
  const { selected, flowComponents } = editorState;
  const { flow, onFlowChange, libraryComponents, objects } = props;
  const { setConfig } = configuration;

      const screenFields = rowsFrom(selected.config.fields);
      const screenCollections = [
        ...flow.resources.filter(resource => resource.type === 'Record Collection'),
        ...flow.elements.filter(element => element.type === 'Get Records'
          && (element.config.recordLimit === 'all' || Number(element.config.recordLimit ?? 1) > 1))
          .flatMap(element => {
            const objectApi = displayValue(element.config.object);
            const name = displayValue(element.config.outputVariable) || 'record' + element.id;
            return objectApi && !flow.resources.some(resource => resource.name === name)
              ? [{name, label: name + ' (Get Records)', type: 'Record Collection', dataType: objectApi}]
              : [];
          })
      ];
      const outcomes = screenOutcomesFrom(selected.config.outcomes);
      const updateOutcomes = (next: Array<{ name: string; label: string }>, renamed?: { from: string[]; to: string }) => onFlowChange({
        ...flow,
        elements: flow.elements.map((element) => element.id === selected.id
          ? { ...element, config: { ...element.config, outcomes: next } }
          : element),
        connectors: flow.connectors
          .filter((connector) => connector.from !== selected.id || connector.kind === 'fault'
            || !connector.label || renamed?.from.includes(connector.label) || next.some((outcome) => outcome.label === connector.label || outcome.name === connector.label))
          .map((connector) => renamed && connector.from === selected.id && renamed.from.includes(connector.label)
            ? { ...connector, label: renamed.to }
            : connector)
      });
      return <div className="flow-config-list"><h3>Screen Fields</h3>
        <label className="form-label">Screen Layout<select className="form-control" value={displayValue(selected.config.layout) || 'One Column'} onChange={(event) => setConfig('layout', event.target.value)}><option>One Column</option><option>Two Columns</option></select></label>
        {screenFields.map((field, index) => <div className="metadata-card" key={`screen-field-${index}`}>
          <label className="form-label">Label<input className="form-control" value={displayValue(field.label)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value, ...(!item.apiName ? {apiName:generateMetadataApiName(event.target.value)} : {}) } : item))} /></label>
          {field.type === 'Custom Component'
            ? <>
              <details><summary>Advanced: API Name</summary><label className="form-label">API Name<input className="form-control" value={displayValue(field.apiName)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, apiName: event.target.value.replace(/[^A-Za-z0-9_]/g, '') } : item))} /></label></details>
              {metadataNameConflict(displayValue(field.apiName),screenFields.filter((_,i)=>i!==index).map(item=>displayValue(item.apiName)))&&<p role="alert" className="form-error">Duplicate screen field API Name.
                <button type="button" className="btn" onClick={()=>setConfig('fields',screenFields.map((item,i)=>i===index?{...item,apiName:suggestMetadataApiName(displayValue(field.apiName),screenFields.filter((_,j)=>j!==index).map(v=>displayValue(v.apiName)))}:item))}>Use suggested name</button></p>}
              <label className="form-label">Component<select className="form-control" value={displayValue(field.componentApiName)} onChange={(event) => {
                const component = flowComponents.find((item) => item.apiName === event.target.value);
                setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? {
                  ...item,
                  componentApiName: event.target.value,
                  width: component?.resize?.defaultWidth ?? 320,
                  height: component?.resize?.defaultHeight ?? 180
                } : item));
              }}>
                <option value="">Select a registered component</option>
                {flowComponents.map((component) => <option key={component.apiName} value={component.apiName}>{component.label}</option>)}
              </select></label>
              <label className="form-label">Width (px)<input className="form-control" type="number"
                min={Math.min(libraryComponents.find((item) => item.apiName === field.componentApiName)?.resize?.minWidth ?? 120, 2000)} max={2000}
                value={displayValue(field.width) || libraryComponents.find((item) => item.apiName === field.componentApiName)?.resize?.defaultWidth || 320}
                onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, width: Number(event.target.value) } : item))} /></label>
              <label className="form-label">Height (px)<input className="form-control" type="number"
                min={Math.min(libraryComponents.find((item) => item.apiName === field.componentApiName)?.resize?.minHeight ?? 60, 2000)} max={2000}
                value={displayValue(field.height) || libraryComponents.find((item) => item.apiName === field.componentApiName)?.resize?.defaultHeight || 180}
                onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, height: Number(event.target.value) } : item))} /></label>
              <label className="form-label">Column Span<select className="form-control" value={displayValue(field.columnSpan) || '1'} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, columnSpan: Number(event.target.value) } : item))}><option value="1">One column</option><option value="2">Full width</option></select></label>
              {parseComponentProperties(field.componentPropsJson).error
                ? <div className="auth-error" role="alert">
                    {parseComponentProperties(field.componentPropsJson).error}
                    <button className="btn btn-small" type="button" onClick={() =>
                      setConfig('fields', screenFields.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, componentPropsJson: '{}' } : item))
                    }>Reset invalid properties</button>
                  </div>
                : <>
                    <PageComponentStyleEditor
                      properties={parseComponentProperties(field.componentPropsJson).properties}
                      onChange={(properties) => setConfig('fields', screenFields.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, componentPropsJson: JSON.stringify(properties) } : item))}
                    />
                    <CustomComponentPropertyEditor definitions={libraryComponents.find(component => component.apiName === field.componentApiName && component.status !== 'Draft')?.propertyDefinitions} properties={parseComponentProperties(field.componentPropsJson).properties}
                      objects={objects} primaryObjectApiName={flow.triggerObject ?? ''}
                      onChange={(properties) => setConfig('fields', screenFields.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, componentPropsJson: JSON.stringify(properties) } : item))}
                    />
                  </>}
              <label className="checkbox-row"><input type="checkbox" checked={field.required === true} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))} />Required</label>
            </>
            : field.type === 'Display Text'
            ? <div className="form-label">Text Content<SmartFieldInput multiline rows={4} objects={objects} primaryObjectApiName={flow.triggerObject ?? ''} value={displayValue(field.text)} onChange={next => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, text: next } : item))} /></div>
            : field.type === 'Display Image'
              ? <>
                <div className="form-label">Image URL<SmartFieldInput objects={objects} primaryObjectApiName={flow.triggerObject ?? ''} kind="image" value={displayValue(field.imageUrl)} onChange={next => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, imageUrl: next } : item))} placeholder="https://example.com/image.png" /></div>
                <label className="form-label">Alternative Text<input className="form-control" value={displayValue(field.imageAltText)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, imageAltText: event.target.value } : item))} /></label>
              </>
              : field.type === 'Section'
                ? <>
                  <label className="form-label">Description<textarea className="form-control" rows={2} maxLength={255} value={displayValue(field.description)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></label>
                  <label className="form-label">Columns<select className="form-control" value={displayValue(field.columns) || 1} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, columns: Number(event.target.value) } : item))}><option value={1}>One Column</option><option value={2}>Two Columns</option></select></label>
                </>
            : <>
          <label className="form-label">API Name<input className="form-control" value={displayValue(field.apiName)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, apiName: event.target.value.replace(/[^A-Za-z0-9_]/g, '') } : item))} /></label>
          <label className="form-label">Help Text<input className="form-control" value={displayValue(field.helpText)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, helpText: event.target.value } : item))} /></label>
          {!['Address', 'Name', 'Lookup', 'Choice Lookup', 'Data Table', 'File Upload', 'Repeater', 'Custom Component'].includes(String(field.type)) && <label className="form-label">Default Value{['Checkbox', 'Toggle'].includes(String(field.type))
            ? <input className="form-control" type="checkbox" checked={field.defaultValue === true} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, defaultValue: event.target.checked } : item))} />
            : field.type === 'Multi-Select Picklist'
              ? <textarea className="form-control" rows={2} value={Array.isArray(field.defaultValue) ? field.defaultValue.filter((choice): choice is string => typeof choice === 'string').join('\n') : ''} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, defaultValue: event.target.value.split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean) } : item))} />
              : <input className="form-control" type={['Number', 'Currency', 'Slider'].includes(String(field.type)) ? 'number' : field.type === 'Date' ? 'date' : field.type === 'Time' ? 'time' : field.type === 'Date/Time' ? 'datetime-local' : 'text'} value={displayValue(field.defaultValue)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, defaultValue: ['Number', 'Currency', 'Slider'].includes(String(field.type)) ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value } : item))} />}</label>}
          {field.type === 'Multi-Select Picklist' && <small className="settings-panel-copy">Enter one default choice per line.</small>}
          {!['Display Text', 'Display Image', 'Section'].includes(String(field.type)) && <label className="form-label">Data Type<select className="form-control" value={displayValue(field.type) || 'Text'} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => {
            if (itemIndex !== index) return item;
            if (event.target.value === 'Custom Component') {
              const component = flowComponents[0];
              return {
                ...item,
                type: event.target.value,
                componentApiName: component?.apiName ?? '',
                width: component?.resize?.defaultWidth ?? 320,
                height: component?.resize?.defaultHeight ?? 180,
                componentPropsJson: '{}',
                apiName: displayValue(item.apiName) || `Custom_Component_${index + 1}`
              };
            }
            return { ...item, type: event.target.value, defaultValue: undefined };
          }))}>{['Text', 'Password', 'Number', 'Currency', 'Slider', 'Date', 'Time', 'Date/Time', 'Email', 'URL', 'Phone', 'Checkbox', 'Toggle', 'Picklist', 'Multi-Select Picklist', 'Long Text Area', 'Display Text', 'Display Image', 'Section', 'Address', 'Name', 'Lookup', 'Choice Lookup', 'Data Table', 'File Upload', 'Repeater', ...(flowComponents.length ? ['Custom Component'] : [])].map((type) => <option key={type}>{type}</option>)}</select></label>}
          {['Lookup', 'Choice Lookup'].includes(String(field.type)) && <>
            <label className="form-label">Target Object<select className="form-control" value={displayValue(field.objectApiName)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, objectApiName: event.target.value, displayField: 'Name' } : item))}><option value="">Select object</option>{objects.map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label>
            {field.type === 'Choice Lookup' && <>
              <label className="form-label">Choice Label Field<select className="form-control" value={displayValue(field.displayField) || 'Name'} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, displayField: event.target.value } : item))}><option value="Name">Name</option>{objects.find((object) => object.apiName === field.objectApiName)?.fields.filter((item) => item.apiName !== 'Name').map((item) => <option key={item.apiName} value={item.apiName}>{item.label}</option>)}</select></label>
              <label className="checkbox-row"><input type="checkbox" checked={field.multipleSelections === true} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, multipleSelections: event.target.checked, defaultValue: undefined } : item))} />Allow multiple selections</label>
            </>}
          </>}
          {field.type === 'Data Table' && <>
            <label className="form-label">Record Collection<select className="form-control" value={displayValue(field.collection)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, collection: event.target.value, columns: [], selectedRowsResource: '' } : item))}><option value="">Select collection</option>{screenCollections.map((resource) => <option key={resource.name} value={resource.name}>{resource.label}</option>)}</select></label>
            <label className="checkbox-row"><input type="checkbox" checked={field.multiselect === true} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, multiselect: event.target.checked } : item))} />Allow multiple row selection</label>
            {(() => {
              const dataType = screenCollections.find((resource) => resource.name === field.collection)?.dataType;
              const tableObject = objects.find((object) => object.apiName === dataType);
              return tableObject ? <fieldset className="field-selector-list"><legend className="form-label">Displayed Columns</legend>{tableObject.fields.map((column) => {
                const selectedColumns = Array.isArray(field.columns) ? field.columns.filter((item): item is string => typeof item === 'string') : [];
                return <label className="checkbox-row" key={column.apiName}><input type="checkbox" checked={selectedColumns.includes(column.apiName)} onChange={() => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, columns: selectedColumns.includes(column.apiName) ? selectedColumns.filter((item) => item !== column.apiName) : [...selectedColumns, column.apiName] } : item))} />{column.label}</label>;
              })}</fieldset> : null;
            })()}
          </>}
          {['Data Table', 'Choice Lookup'].includes(String(field.type)) && <>
            <label className="form-label">Selected Rows Output (Record Collection)<select className="form-control"
              value={displayValue(field.selectedRowsResource)}
              onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, selectedRowsResource: event.target.value } : item))}>
              <option value="">Select a Record Collection output</option>
              {flow.resources.filter((resource) => resource.type === 'Record Collection'
                && resource.dataType === (field.type === 'Data Table'
                  ? screenCollections.find(item => item.name === field.collection)?.dataType
                  : field.objectApiName)).map((resource) =>
                <option key={resource.name} value={resource.name}>{resource.label}</option>)}
            </select></label>
            <label className="form-label">Minimum Selections<input className="form-control" type="number" min={0} max={200}
              value={typeof field.minimumSelections === 'number' ? field.minimumSelections : 0}
              onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, minimumSelections: Number(event.target.value) } : item))} /></label>
            <label className="form-label">Maximum Selections (0 = unlimited)<input className="form-control" type="number" min={0} max={200}
              value={typeof field.maximumSelections === 'number' ? field.maximumSelections : 0}
              onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, maximumSelections: Number(event.target.value) } : item))} /></label>
            {(field.type === 'Data Table' ? field.multiselect === true : field.multipleSelections === true)
              && !field.selectedRowsResource && <p className="properties-help">Multiple selection requires a typed Record Collection output. Create one in Manager and select it here.</p>}
          </>}
          {field.type === 'File Upload' && <>
            <label className="form-label">Maximum Files<input className="form-control" type="number" min={1} max={10} value={displayValue(field.maxFiles) || 1} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, maxFiles: Number(event.target.value) } : item))} /></label>
            <label className="form-label">Maximum File Size (KB)<input className="form-control" type="number" min={1} max={512} value={displayValue(field.maxFileSize) || 512} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, maxFileSize: Number(event.target.value) } : item))} /></label>
            <label className="form-label">Allowed MIME Types (one per line; blank allows any type)<textarea className="form-control" rows={2} value={Array.isArray(field.allowedTypes) ? field.allowedTypes.filter((item): item is string => typeof item === 'string').join('\n') : ''} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, allowedTypes: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } : item))} /></label>
          </>}
          {field.type === 'Repeater' && <>
            <label className="form-label">Minimum Rows<input className="form-control" type="number" min={0} max={50} value={displayValue(field.minimumRows) || 0} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, minimumRows: Number(event.target.value) } : item))} /></label>
            <label className="form-label">Maximum Rows<input className="form-control" type="number" min={1} max={50} value={displayValue(field.maximumRows) || 10} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, maximumRows: Number(event.target.value) } : item))} /></label>
            {(Array.isArray(field.subfields) ? field.subfields.filter((item): item is ConfigRow => typeof item === 'object' && item !== null && !Array.isArray(item)) : []).map((subfield, subIndex, subfields) => <div className="flow-config-row" key={`repeater-${subIndex}`}>
              <input className="form-control" aria-label={`Repeater field ${subIndex + 1} label`} placeholder="Field label" value={displayValue(subfield.label)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, subfields: subfields.map((child, childIndex) => childIndex === subIndex ? { ...child, label: event.target.value } : child) } : item))} />
              <input className="form-control" aria-label={`Repeater field ${subIndex + 1} API name`} placeholder="API name" value={displayValue(subfield.apiName)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, subfields: subfields.map((child, childIndex) => childIndex === subIndex ? { ...child, apiName: event.target.value.replace(/[^A-Za-z0-9_]/g, '') } : child) } : item))} />
              <select className="form-control" aria-label={`Repeater field ${subIndex + 1} type`} value={displayValue(subfield.type) || 'Text'} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, subfields: subfields.map((child, childIndex) => childIndex === subIndex ? { ...child, type: event.target.value } : child) } : item))}>{['Text', 'Number', 'Date', 'Email', 'Checkbox'].map((type) => <option key={type}>{type}</option>)}</select>
              <label className="checkbox-row"><input type="checkbox" checked={subfield.required === true} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, subfields: subfields.map((child, childIndex) => childIndex === subIndex ? { ...child, required: event.target.checked } : child) } : item))} />Required</label>
              <button className="row-menu" aria-label={`Remove repeater field ${subIndex + 1}`} onClick={() => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, subfields: subfields.filter((_, childIndex) => childIndex !== subIndex) } : item))}><X size={14} /></button>
            </div>)}
            <button className="text-action" onClick={() => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, subfields: [...(Array.isArray(item.subfields) ? item.subfields : []), { label: 'New Field', apiName: `Field_${(Array.isArray(item.subfields) ? item.subfields.length : 0) + 1}`, type: 'Text', required: false }] } : item))}><Plus size={13} />Add Repeater Field</button>
          </>}
          {['Text', 'Password', 'Long Text Area', 'Email', 'URL', 'Phone'].includes(String(field.type ?? 'Text')) && <>
            <label className="form-label">Minimum Length<input className="form-control" type="number" min={0} value={displayValue(field.minLength)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, minLength: event.target.value === '' ? undefined : Number(event.target.value) } : item))} /></label>
            <label className="form-label">Maximum Length<input className="form-control" type="number" min={0} value={displayValue(field.maxLength)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, maxLength: event.target.value === '' ? undefined : Number(event.target.value) } : item))} /></label>
          </>}
          {['Number', 'Currency', 'Slider'].includes(String(field.type)) && <>
            <label className="form-label">Minimum Value<input className="form-control" type="number" value={displayValue(field.min)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, min: event.target.value === '' ? undefined : Number(event.target.value) } : item))} /></label>
            <label className="form-label">Maximum Value<input className="form-control" type="number" value={displayValue(field.max)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, max: event.target.value === '' ? undefined : Number(event.target.value) } : item))} /></label>
            <label className="form-label">Step<input className="form-control" type="number" min={0.001} value={displayValue(field.step)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, step: event.target.value === '' ? undefined : Number(event.target.value) } : item))} /></label>
          </>}
          {['Text', 'Long Text Area'].includes(String(field.type ?? 'Text')) && <>
            <label className="form-label">Validation Pattern<input className="form-control" value={displayValue(field.pattern)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, pattern: event.target.value || undefined } : item))} /></label>
            <label className="form-label">Validation Message<input className="form-control" maxLength={255} value={displayValue(field.validationMessage)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, validationMessage: event.target.value || undefined } : item))} /></label>
          </>}
          {field.type === 'Picklist' && <label className="form-label">Reusable Choice Set
            <select className="form-control" aria-label="Picklist Choice Set"
              value={displayValue(field.choiceSetResource)}
              onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) =>
                itemIndex === index ? { ...item, choiceSetResource: event.target.value } : item))}>
              <option value="">Use choices defined below</option>
              {flow.resources.filter(resource => resource.type === 'Choice Set').map(resource =>
                <option key={resource.name} value={resource.name}>{resource.label}</option>)}
            </select>
          </label>}
          {['Picklist', 'Multi-Select Picklist'].includes(String(field.type)) && <label className="form-label">Choices (one per line)<textarea className="form-control" rows={3} value={Array.isArray(field.choices) ? field.choices.filter((choice): choice is string => typeof choice === 'string').join('\n') : ''} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, choices: event.target.value.split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean) } : item))} /></label>}
          {['Picklist', 'Multi-Select Picklist'].includes(String(field.type)) && <label className="form-label">Display As<select className="form-control" value={displayValue(field.displayAs) || (field.type === 'Picklist' ? 'Dropdown' : 'Multi-Select Dropdown')} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, displayAs: event.target.value } : item))}>{(field.type === 'Picklist' ? ['Dropdown', 'Radio Buttons'] : ['Multi-Select Dropdown', 'Checkbox Group']).map((mode) => <option key={mode}>{mode}</option>)}</select></label>}
          {!['Display Text', 'Display Image', 'Section', 'Custom Component'].includes(String(field.type)) && <label className="checkbox-row"><input type="checkbox" checked={field.required === true} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))} />Required</label>}
          {screenFields.filter((candidate) => !['Display Text', 'Display Image', 'Section'].includes(String(candidate.type)) && candidate.apiName !== field.apiName).length > 0 && <>
            <label className="form-label">Visibility Logic<select className="form-control" value={displayValue(field.visibilityLogic) || 'All'} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, visibilityLogic: event.target.value } : item))}><option>All</option><option>Any</option></select></label>
            {rowsFrom(field.visibilityConditions).map((condition, conditionIndex) => <div className="flow-config-row" key={`${index}-visibility-${conditionIndex}`}>
              <select className="form-control" aria-label="Visibility controlling field" value={displayValue(condition.field)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, visibilityConditions: rowsFrom(item.visibilityConditions).map((row, rowIndex) => rowIndex === conditionIndex ? { ...row, field: event.target.value } : row) } : item))}>
                <option value="">Choose field</option>{screenFields.filter((candidate) => !['Display Text', 'Display Image', 'Section'].includes(String(candidate.type)) && candidate.apiName !== field.apiName).map((candidate) => <option key={displayValue(candidate.apiName)} value={displayValue(candidate.apiName)}>{displayValue(candidate.label)}</option>)}
              </select>
              <select className="form-control" aria-label="Visibility operator" value={['Not Equals', 'Not Equal To'].includes(String(condition.operator)) ? 'Does Not Equal' : displayValue(condition.operator) || 'Equals'} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, visibilityConditions: rowsFrom(item.visibilityConditions).map((row, rowIndex) => rowIndex === conditionIndex ? { ...row, operator: event.target.value } : row) } : item))}>
                {['Equals', 'Does Not Equal', 'Greater Than', 'Greater Than or Equal To', 'Less Than', 'Less Than or Equal To', 'Is Null', 'Is Not Null', 'Contains', 'Does Not Contain', 'Starts With', 'Includes'].map((operator) => <option key={operator}>{operator}</option>)}
              </select>
              {!['Is Null', 'Is Not Null'].includes(String(condition.operator)) && <input className="form-control" aria-label="Visibility comparison value" value={displayValue(condition.value)} onChange={(event) => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, visibilityConditions: rowsFrom(item.visibilityConditions).map((row, rowIndex) => rowIndex === conditionIndex ? { ...row, value: event.target.value } : row) } : item))} />}
              <button className="row-menu" aria-label="Remove visibility condition" onClick={() => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, visibilityConditions: rowsFrom(item.visibilityConditions).filter((_, rowIndex) => rowIndex !== conditionIndex) } : item))}><X size={14} /></button>
            </div>)}
            <button className="text-action" onClick={() => setConfig('fields', screenFields.map((item, itemIndex) => itemIndex === index ? { ...item, visibilityConditions: [...rowsFrom(item.visibilityConditions), { field: '', operator: 'Equals', value: '' }] } : item))}><Plus size={13} />Add Visibility Condition</button>
          </>}
          </>}
          <button className="row-menu" aria-label="Remove screen field" onClick={() => setConfig('fields', screenFields.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
        </div>)}
        <button className="text-action" onClick={() => setConfig('fields', [...screenFields, { label: 'New Screen Field', apiName: 'New_Screen_Field', type: 'Text', required: false }])}><Plus size={13} />Add Screen Field</button>
        {flowComponents.length > 0 && <button className="text-action" onClick={() => {
          const component = flowComponents[0];
          setConfig('fields', [...screenFields, {
            label: component?.label ?? 'Custom Component',
            apiName: `Custom_Component_${screenFields.length + 1}`,
            type: 'Custom Component',
            componentApiName: component?.apiName ?? '',
            width: component?.resize?.defaultWidth ?? 320,
            height: component?.resize?.defaultHeight ?? 180,
            columnSpan: 1,
            componentPropsJson: '{}',
            required: false
          }]);
        }}><Plus size={13} />Add Custom Component</button>}
        <h3>Screen Navigation</h3>
        <p className="settings-panel-copy">Configure the buttons shown when this screen is submitted. Add a connector for each button to route the flow.</p>
        {outcomes.map((outcome, index) => <div className="flow-config-row" key={`${outcome.name}-${index}`}>
          <input className="form-control" aria-label={`Screen outcome ${index + 1} label`} value={outcome.label} disabled={outcome.name === 'Default'} onChange={(event) => {
            const label = event.target.value;
            const name = label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || `Outcome_${index + 1}`;
            updateOutcomes(outcomes.map((item, itemIndex) => itemIndex === index ? { ...item, label, name } : item), { from: [outcome.label, outcome.name], to: label });
          }} />
          {outcome.name === 'Default'
            ? <span className="flow-outcome-default">Default</span>
            : <button className="row-menu" aria-label={`Remove ${outcome.label} outcome`} onClick={() => updateOutcomes(outcomes.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>}
        </div>)}
        <button className="text-action" onClick={() => updateOutcomes([...outcomes.filter((item) => item.name !== 'Default'), { name: `Outcome_${outcomes.length + 1}`, label: `Outcome ${outcomes.length + 1}` }, ...outcomes.filter((item) => item.name === 'Default')])}><Plus size={13} />Add Outcome</button>
      </div>;

}
