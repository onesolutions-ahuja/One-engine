import { confirmDestructiveAction } from '../../../../components/ConfirmAction/confirmDestructiveAction';
import { downloadFlowExcel, readFlowExcel, previewFlowExcel, ensureFlowUnchanged, flowExcelFingerprint } from '../../flowExcelWorkbook';
import { formulaFunctions, formulaOperators } from '../../flowEditorCatalog';
import FormulaSignatureGuide from '../../../PageBuilder/FormulaSignatureGuide';
import { displayValue } from '../../flowEditorData';
import { apiRequest } from '../../../../authentication/Client/authClient';
import FlowTestsPanel from '../../FlowTestsPanel';
import SmartFieldInput from '../../../../../component-libraries/shared/primitives/SmartFieldInput/SmartFieldInput';
import { Copy, MoreHorizontal, Plus, Save, Search, X } from 'lucide-react';
import { type FlowDefinitionMetadata, type FlowResourceMetadata, type NamedCredentialMetadata } from '../../../../metadata/Definitions/metadata';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowGraphActions } from '../canvas/useFlowGraphActions';
import type { useFlowConfiguration } from '../settings/useFlowConfiguration';

export default function FlowToolbox({ editorState, props, graphActions, configuration }: {
  editorState: ReturnType<typeof useFlowEditorState>;
  props: FlowBuilderProps;
  graphActions: ReturnType<typeof useFlowGraphActions>;
  configuration: ReturnType<typeof useFlowConfiguration>;
}) {
  const {
    toolboxExpanded, setToolboxExpanded, toolTab, setToolTab, capabilityError, elementSearch,
    setElementSearch, insertionConnectorId, setInsertionConnectorId, flowElementMetadata,
    isToolboxElement, contextDefinitions, newContextLabel, setNewContextLabel, newContextObject,
    setNewContextObject, loadContexts, setExcelError, capabilityCatalog, excelValidating,
    setExcelPreview, setExcelSkipErrors, setExcelValidating, excelError, excelPreview,
    excelSkipErrors, newFlowType, setNewFlowType, flowTypeOptions, newFlowLabel, setNewFlowLabel,
    setPlatformEventApiName, setPlatformEventLabel, setPlatformEventDescription,
    setPlatformEventFields, platformEventLabel, platformEventApiName, platformEventDescription,
    platformEventFields, resourceLabel, setResourceLabel, resourceType, setResourceType,
    setResourceDataType, resourceDataType, formulaInsertField, setFormulaInsertField,
    formulaOperator, setFormulaOperator, formulaFunction, setFormulaFunction, setFormulaGuide,
    formulaEditorRef, resourceValue, setResourceValue, formulaGuide, credentialName,
    setCredentialName, credentialLabel, setCredentialLabel, credentialProtocol,
    setCredentialProtocol, credentialAuthType, setCredentialAuthType, credentialBaseUrl,
    setCredentialBaseUrl, credentialHeaderName, setCredentialHeaderName, credentialUsername,
    setCredentialUsername, credentialId, credentialSecret, setCredentialSecret, emailAlertName,
    setEmailAlertName, emailAlertLabel, setEmailAlertLabel, emailAlertObject, setEmailAlertObject,
    emailAlertCredentialId, setEmailAlertCredentialId, emailAlertFrom, setEmailAlertFrom,
    emailAlertRecipients, setEmailAlertRecipients, emailAlertSubject, setEmailAlertSubject,
    emailAlertBody, setEmailAlertBody, emailAlertId,
  } = editorState;
  const {
    onToolTab, flow, onNotify, onAdd, selectedId, objects, flows, onSelectFlow, onCloneFlow,
    onDeactivateFlow, onDeleteFlow, onRestoreFlowVersion, isDirty, onFlowChange, onExportFlow,
    onImportFlow, canRunFlows, onRunTests, onCreateFlow, platformEvents, onDeletePlatformEvent,
    namedCredentials, onDeleteNamedCredential, emailAlerts, onDeleteEmailAlert,
  } = props;
  const { insertionPaths, toolboxGroups, selectedObject, selectedPlatformEvent } = graphActions;
  const {
    addPlatformEventField, savePlatformEvent, insertFormulaToken, addResource, updateResource,
    submitCredential, editCredential, submitEmailAlert, editEmailAlert,
  } = configuration;
  return <>
<aside id="flow-element-toolbox" className="flow-toolbox">
        <div className="toolbox-heading"><h2>Toolbox</h2><button className="icon-button subtle" aria-label={toolboxExpanded ? 'Collapse toolbox' : 'Expand toolbox'} aria-expanded={toolboxExpanded} title={toolboxExpanded ? 'Collapse toolbox' : 'Expand toolbox'} onClick={() => setToolboxExpanded((expanded) => !expanded)}><MoreHorizontal size={16} /></button></div>
        <div className="toolbox-tabs"><button className={toolTab === 'Elements' ? 'active' : ''} onClick={() => { setToolTab('Elements'); onToolTab('Elements'); }}>Elements</button><button className={toolTab === 'Manager' ? 'active' : ''} onClick={() => { setToolTab('Manager'); onToolTab('Manager'); }}>Manager</button></div>
        {toolTab === 'Elements' ? <>
          {capabilityError && <div className="info-callout" role="alert">{capabilityError}</div>}
           <div className="component-search"><Search size={14} /><input placeholder="Search elements..." aria-label="Search flow elements" value={elementSearch} onChange={(event) => setElementSearch(event.target.value)} /></div>
          {insertionPaths.length > 1 && <label className="form-label">Insert onto path
            <select className="form-control" aria-label="Choose Flow insertion path"
              value={insertionPaths.some((connector) => connector.id === insertionConnectorId) ? insertionConnectorId : ''}
              onChange={(event) => setInsertionConnectorId(event.target.value)}>
              <option value="">Select outcome, fault, or scheduled path</option>
              {insertionPaths.map((connector) => <option value={connector.id} key={connector.id}>
                {connector.label || connector.kind} · {flow.elements.find((element) => element.id === connector.to)?.label ?? connector.to}
              </option>)}
            </select>
          </label>}
          {toolboxGroups.map((group) => {
            const elements = flowElementMetadata.filter((item) => item.group === group && item.type.toLowerCase().includes(elementSearch.trim().toLowerCase()) && isToolboxElement(item.type));
            return elements.length ? <div className="toolbox-group" key={group}><h3>{group}</h3>{elements.map((element) => <button key={element.type} className="flow-element-option" title={element.type} draggable
              aria-label={`Click to add ${element.type}, or drag onto the canvas`}
              onDragStart={(event)=>{event.dataTransfer.effectAllowed='copy';
                event.dataTransfer.setData('application/x-metadrive-flow-type',element.type);}}
              onClick={() => {
              const selectedPath = insertionPaths.some((connector) => connector.id === insertionConnectorId)
                ? insertionConnectorId : undefined;
              if (insertionPaths.length > 1 && !selectedPath) {
                onNotify('Choose an outcome or fault path before inserting an element.');
                return;
              }
              onAdd(element.type, selectedId, selectedPath);
              setInsertionConnectorId('');
            }}><span>{element.icon}</span>{element.type}<Plus size={13} /></button>)}</div> : null;
          })}
          {flowElementMetadata.filter((item) => item.type.toLowerCase().includes(elementSearch.trim().toLowerCase()) && isToolboxElement(item.type)).length === 0 && <p className="empty-list">No elements found.</p>}
        </> : <div className="resource-list">
          <div className="toolbox-group"><h3>Business Contexts</h3>
           {contextDefinitions.map(item=><div className="flow-manager-row" key={item.apiName}>
             {item.label} · {item.objectApiName}</div>)}
           <label className="form-label">Context label
             <input className="form-control" value={newContextLabel}
              onChange={event=>setNewContextLabel(event.target.value)}
              placeholder="Current Cart, Current Conversation..." />
           </label>
           <label className="form-label">Linked Object
             <select className="form-control" value={newContextObject}
              onChange={event=>setNewContextObject(event.target.value)}>
              <option value="">Choose an Object</option>
              {objects.map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
             </select>
           </label>
           <button className="btn" type="button" disabled={!newContextLabel.trim()||!newContextObject}
            onClick={()=>{
             const label=newContextLabel.trim(),apiName=label.replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'');
             if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)){
              onNotify('Context name must begin with a letter');return;
             }
             void apiRequest('/contexts/definitions',{method:'POST',body:JSON.stringify({
              apiName,label,objectApiName:newContextObject
             })}).then(()=>loadContexts()).then(()=>{
              setNewContextLabel('');setNewContextObject('');
             }).catch(error=>onNotify(error instanceof Error?error.message:'Unable to create Context'));
            }}>Create Context</button>
          </div>
          <div className="toolbox-group"><h3>Flows</h3>{flows.map((candidate) => <div className="flow-manager-row" key={candidate.apiName}><button className={`flow-manager-item ${flow.apiName === candidate.apiName ? 'active' : ''}`} onClick={() => onSelectFlow(candidate.apiName)}><span>{candidate.flowType}</span><strong>{candidate.label}</strong><small>{candidate.status} · v{candidate.versionNumber}</small></button><div className="flow-manager-actions"><button className="btn btn-small" aria-label={`Clone ${candidate.label}`} title="Clone flow" onClick={() => onCloneFlow(candidate)}><Copy size={13} />Clone</button>{candidate.status === 'Active' && <button className="btn btn-small" aria-label={`Deactivate ${candidate.label}`} onClick={() => onDeactivateFlow(candidate.apiName)}>Deactivate</button>}<button className="btn btn-small" aria-label={`Delete ${candidate.label}`} onClick={() => { if (window.confirm(`Delete the ENTIRE flow "${candidate.label}" including ALL versions? This is not a version-only delete. To edit v1, use Version History → Restore as Draft.`)) onDeleteFlow(candidate.apiName); }}>Delete Entire Flow</button></div></div>)}</div>
          <div className="toolbox-group"><h3>Version History</h3>{flow.versions.length
            ? [...flow.versions].sort((left, right) => right.versionNumber - left.versionNumber).map((version, index) =>
              <div className="flow-resource-card" key={`${version.versionNumber}-${index}`}>
                <strong>Version {version.versionNumber} · {version.status}</strong>
                <small>{version.label ?? flow.label} · {version.flowType ?? flow.flowType} · {new Date(version.savedAt).toLocaleString()}</small>
                {version.description && <small>{version.description}</small>}
                <button className="text-action" aria-label={`Restore version ${version.versionNumber} as draft`}
                  onClick={() => onRestoreFlowVersion(version)}>Restore as Draft</button>
              </div>)
            : <p className="empty-list">No saved versions yet.</p>}</div>
          <div className="toolbox-group"><h3>Excel Node Upsert (Existing Flow Only)</h3>
<button className="btn" type="button" disabled={!flow.apiName||isDirty} onClick={()=>{void (async()=>{try{await ensureFlowUnchanged(flow);await downloadFlowExcel(flow,{nodeTypes:flowElementMetadata.filter(item=>item.builderFlowTypes.includes(flow.flowType)).map(item=>item.type),objects});}catch(error){setExcelError(error instanceof Error?error.message:'Download failed');}})();}}>Download Excel (.xlsx)</button>
<label className="form-label">Upload edited Excel (.xlsx)<input className="form-control" type="file"
 accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!flow.apiName||isDirty||!capabilityCatalog||excelValidating}
 onChange={event=>{
 const file=event.target.files?.[0];event.target.value='';setExcelPreview(null);setExcelError('');setExcelSkipErrors(false);
 if(file)void (async()=>{
   setExcelValidating(true);
   try{
    await ensureFlowUnchanged(flow);
    const tables=await readFlowExcel(file,flow.apiName);
    const allowed=flowElementMetadata.filter(element=>element.builderFlowTypes.includes(flow.flowType))
       .map(element=>element.type);
    const preview=previewFlowExcel(tables,flow,allowed);
    const verification=await apiRequest<{valid:boolean;errors:string[];warnings:string[]}>(
      '/metadata/flows/'+encodeURIComponent(flow.apiName)+'/validate',{
      method:'POST',body:JSON.stringify(preview.draft)});
    if(!verification.valid)preview.errors.push(...(verification.errors??[]).map(error=>'Server validation: '+error));
    setExcelPreview(preview);
   }catch(error){setExcelError(error instanceof Error?error.message:'Unable to read workbook.');}
   finally{setExcelValidating(false);}
 })();
 }}/></label>
<p className="settings-panel-copy">Existing saved flows only. Edit nodes, inputs, resources, connections and canvas metadata. Changes apply to the editor draft, not a published flow.</p>
{excelValidating&&<p>Checking uploaded workbook and server metadata…</p>}
{excelError&&<p role="alert" className="info-callout">{excelError}</p>}
{excelPreview&&<div className="metadata-card">
<p>{excelPreview.changes.length} row operations · {excelPreview.errors.length} errors</p>
{excelPreview.errors.map((error,i)=><p role="alert" key={i}>{error}</p>)}
{excelPreview.changes.slice(0,20).map((change,i)=><p key={i}>{change}</p>)}
{excelPreview.changes.length>20&&<p>+ {excelPreview.changes.length-20} more operations</p>}
{excelPreview.errors.length>0&&<button type="button" className="btn" onClick={()=>{
 const csv=['Sheet,Row,Status,Message',...excelPreview.errors.map(error=>{
   const row=/^(Nodes|Inputs|Connections|Resources) row (\\d+):/.exec(error);
   const section=row?.[1]??(error.startsWith('Graph:')?'Graph':'Server');
   const fields=[section,row?.[2]??'','Error',error];
   return fields.map(value=>'"'+value.replace(/"/g,'""')+'"').join(',');
 })].join('\\r\\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=flow.apiName+'_excel_errors.csv';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}}>Download Error Report</button>}
{excelPreview.errors.length>0&&!excelPreview.errors.some(error=>/^(Graph:|Server validation:)/.test(error))&&
<label><input type="checkbox" checked={excelSkipErrors} onChange={event=>setExcelSkipErrors(event.target.checked)}/>
 Skip invalid individual rows and apply only verified valid changes</label>}
<button type="button" className="btn" onClick={()=>setExcelPreview(null)}>Cancel</button>
<button type="button" className="btn" disabled={isDirty||excelValidating||excelPreview.changes.length===0||
 (excelPreview.errors.length>0&&(!excelSkipErrors||excelPreview.errors.some(error=>/^(Graph:|Server validation:)/.test(error))))}
 onClick={()=>{if(excelPreview.errors.some(error=>/^(Graph:|Server validation:)/.test(error)))return;
 setExcelValidating(true);
 void ensureFlowUnchanged(flow).then(()=>{
   onFlowChange({...excelPreview.draft,__excelExpectedFingerprint:flowExcelFingerprint(flow)} as FlowDefinitionMetadata);setExcelPreview(null);
   onNotify('Excel changes applied to draft. Validate and Save.');
 }).catch(error=>setExcelError(error instanceof Error?error.message:'Flow changed on server.'))
 .finally(()=>setExcelValidating(false));
 }}>Apply to Draft</button>
</div>}</div>
<div className="toolbox-group"><h3>Flow Portability</h3><button className="btn" onClick={onExportFlow}>Export Flow JSON</button><label className="form-label">Import Flow JSON<input className="form-control" type="file" accept=".json,application/json" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportFlow(file);
            event.target.value = '';
          }} /></label><p className="settings-panel-copy">Import creates a separate Draft and will not overwrite an existing Flow.</p></div>
          <FlowTestsPanel flow={flow} isDirty={isDirty} canRun={canRunFlows} onChange={onFlowChange} onRunTests={onRunTests} onNotify={onNotify} />
          <div className="toolbox-group"><h3>Flow Description</h3><label className="form-label">Description<textarea className="form-control" rows={3} value={flow.description ?? ''} onChange={(event) => onFlowChange({ ...flow, description: event.target.value })} /></label></div>
          <div className="toolbox-group"><h3>New Flow</h3><label className="form-label">Flow Type<select className="form-control" value={newFlowType ?? ''} onChange={(event) => setNewFlowType(event.target.value ? event.target.value as FlowDefinitionMetadata['flowType'] : null)}><option value="">Select flow type</option>{flowTypeOptions.map((option) => <option key={option.type} value={option.type}>{option.type}</option>)}</select></label>{newFlowType && <><label className="form-label">Flow Name<input className="form-control" value={newFlowLabel} onChange={(event) => setNewFlowLabel(event.target.value)} /></label><button className="btn btn-brand" disabled={!newFlowLabel.trim()} onClick={() => { onCreateFlow(newFlowLabel.trim(), newFlowType); setNewFlowLabel(''); }}><Plus size={13} />Create Flow</button></>}</div>
          <div className="toolbox-group"><h3>Platform Events</h3>
            <button className="btn" onClick={() => {
              setPlatformEventApiName('');
              setPlatformEventLabel('');
              setPlatformEventDescription('');
              setPlatformEventFields([]);
            }}><Plus size={13} />New Event</button>
            {platformEvents.map((event) => <div className="flow-resource-card" key={event.apiName}>
              <button className="flow-manager-item" onClick={() => {
                setPlatformEventApiName(event.apiName);
                setPlatformEventLabel(event.label);
                setPlatformEventDescription(event.description);
                setPlatformEventFields(event.fields);
              }}><strong>{event.label}</strong><small>{event.apiName} · {event.fields.length} fields</small></button>
              <button className="btn btn-small" onClick={() => { if (!confirmDestructiveAction('Delete', 'Platform Event "'+event.label+'"')) return; void onDeletePlatformEvent(event.apiName).catch((error: unknown) => onNotify(error instanceof Error ? error.message : String(error))); }}>Delete</button>
            </div>)}
            <label className="form-label">Event Label<input className="form-control" value={platformEventLabel} onChange={(event) => {
              const label = event.target.value;
              setPlatformEventLabel(label);
              if (!platformEventApiName || !platformEvents.some((item) => item.apiName === platformEventApiName)) {
                setPlatformEventApiName(`${label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}__e`);
              }
            }} /></label>
            <label className="form-label">API Name<input className="form-control" value={platformEventApiName} onChange={(event) => setPlatformEventApiName(event.target.value)} placeholder="Order_Updated__e" /></label>
            <label className="form-label">Description<textarea className="form-control" rows={2} value={platformEventDescription} onChange={(event) => setPlatformEventDescription(event.target.value)} /></label>
            {platformEventFields.map((field, index) => <div className="flow-resource-card" key={`new-platform-field-${index}`}>
              <label className="form-label">Field Label<input className="form-control" value={field.label} onChange={(event) => setPlatformEventFields((current) => current.map((item, itemIndex) => itemIndex === index ? {
                ...item,
                label: event.target.value,
                apiName: `${event.target.value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}__c`
              } : item))} /></label>
              <label className="form-label">API Name<input className="form-control" value={field.apiName} onChange={(event) => setPlatformEventFields((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, apiName: event.target.value } : item))} /></label>
              <label className="form-label">Data Type<select className="form-control" value={field.dataType} onChange={(event) => setPlatformEventFields((current) => current.map((item, itemIndex) => itemIndex === index ? {
                ...item,
                dataType: event.target.value,
                ...(event.target.value === 'Picklist' ? { picklistRestricted: true, picklistValues: item.picklistValues ?? [] } : {})
              } : item))}>{['Text(255)', 'Long Text Area', 'Number', 'Currency', 'Percent', 'Checkbox', 'Date', 'DateTime', 'Picklist'].map((type) => <option key={type}>{type}</option>)}</select></label>
              {field.dataType === 'Picklist' && <label className="form-label">Picklist Values (one per line)<textarea className="form-control" rows={3} value={field.picklistValues?.join('\n') ?? ''} onChange={(event) => setPlatformEventFields((current) => current.map((item, itemIndex) => itemIndex === index ? {
                ...item,
                picklistRestricted: true,
                picklistValues: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
              } : item))} /></label>}
              <button className="btn btn-small" onClick={() => setPlatformEventFields((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove Field</button>
            </div>)}
            <button className="text-action" onClick={addPlatformEventField}><Plus size={13} />Add Field</button>
            <button className="btn btn-brand" disabled={!platformEventLabel.trim() || !platformEventFields.length || platformEventFields.some((field) => !field.apiName.trim() || !field.label.trim())} onClick={() => void savePlatformEvent().catch((error: unknown) => onNotify(error instanceof Error ? error.message : String(error)))}><Save size={13} />Save Platform Event</button>
          </div>
          <div className="toolbox-group"><h3>Resources</h3><label className="form-label">Resource Label<input className="form-control" value={resourceLabel} onChange={(event) => setResourceLabel(event.target.value)} /></label><label className="form-label">Resource Type<select className="form-control" value={resourceType} onChange={(event) => {
            const type = event.target.value as FlowResourceMetadata['type'];
            setResourceType(type);
            if (type === 'Record' || type === 'Record Collection') setResourceDataType(objects[0]?.apiName ?? '');
            else if (type === 'Variable' || type === 'Formula' || type === 'Constant' || type === 'Choice' || type === 'Choice Set') setResourceDataType('Text');
          }}>{['Variable', 'Record', 'Record Collection', 'Formula', 'Constant', 'Choice', 'Choice Set', 'Text Template'].map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="form-label">Data Type{resourceType === 'Record' || resourceType === 'Record Collection'
              ? <select className="form-control" value={resourceDataType} onChange={(event) => setResourceDataType(event.target.value)}>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select>
              : ['Variable', 'Formula', 'Constant', 'Choice', 'Choice Set'].includes(resourceType)
                ? <select className="form-control" value={resourceDataType} onChange={(event) => setResourceDataType(event.target.value)}>
                    {['Text', 'Number', 'Currency', 'Percent', 'Boolean', 'Date', 'Date/Time', 'Time', 'Id', 'Picklist', 'Multi-Select Picklist'].map((type) => <option key={type}>{type}</option>)}
                  </select>
                : <input className="form-control" value={resourceDataType} onChange={(event) => setResourceDataType(event.target.value)} />}</label>
            {resourceType === 'Formula' && <div className="flow-config-list">
              <div className="flow-config-row">
                <select className="form-control" aria-label="Formula field or resource" value={formulaInsertField} onChange={(event) => setFormulaInsertField(event.target.value)}>
                  <option value="">Select field or resource</option>
                  {selectedObject && <optgroup label="Trigger Fields">{selectedObject.fields.map((field) => <option key={field.apiName} value={flow.flowType === 'Record-Triggered Flow' ? `{!$Record.${field.apiName}}` : field.apiName}>{field.label}</option>)}</optgroup>}
                  {selectedPlatformEvent && <optgroup label="Event Fields">{selectedPlatformEvent.fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</optgroup>}
                  <optgroup label="Flow Resources">{flow.resources.map((resource) => <option key={resource.name} value={resource.name}>{resource.label}</option>)}</optgroup>
                </select>
                <button className="btn btn-small" disabled={!formulaInsertField} onClick={() => insertFormulaToken(formulaInsertField)}>Insert Field</button>
              </div>
              <div className="flow-config-row">
                <select className="form-control" aria-label="Formula operator" value={formulaOperator} onChange={(event) => setFormulaOperator(event.target.value)}>{formulaOperators.map((operator) => <option key={operator}>{operator}</option>)}</select>
                <button className="btn btn-small" onClick={() => insertFormulaToken(` ${formulaOperator} `)}>Insert Operator</button>
              </div>
              <div className="flow-config-row">
                <select className="form-control" aria-label="Formula function" value={formulaFunction} onChange={(event) => setFormulaFunction(event.target.value)}>{formulaFunctions.map((name) => <option key={name}>{name}</option>)}</select>
                <button className="btn btn-small" onClick={() => insertFormulaToken(`${formulaFunction}()`, formulaFunction.length + 1)}>Insert Function</button>
              </div>
              <p className="settings-panel-copy">Insert controls add text at the cursor. Use Check to validate the expression and the rest of the Flow.</p>
            </div>}
            <label className="form-label"
              onSelectCapture={event=>{const field=event.target as HTMLTextAreaElement;
                if(resourceType==='Formula'&&typeof field.selectionStart==='number')
                  setFormulaGuide({key:'new',caret:field.selectionStart});}}
              onKeyUpCapture={event=>{const field=event.target as HTMLTextAreaElement;
                if(resourceType==='Formula'&&typeof field.selectionStart==='number')
                  setFormulaGuide({key:'new',caret:field.selectionStart});}}>
              {resourceType === 'Formula' ? 'Formula Expression' : resourceType === 'Text Template' ? 'Template' : resourceType === 'Choice Set' ? 'Choices (one per line)' : 'Default Value'}{resourceType === 'Formula' || resourceType === 'Text Template' || resourceType === 'Choice Set'
              ? <SmartFieldInput multiline rows={resourceType === 'Text Template' ? 9 : 5} textareaRef={resourceType === 'Formula' ? formulaEditorRef : undefined} kind={resourceType === 'Formula' ? 'formula' : 'text'} objects={objects} primaryObjectApiName={flow.triggerObject ?? ''} placeholder={resourceType === 'Text Template' ? 'Write your message here. Press Enter for a new line.' : undefined} value={resourceValue} onChange={setResourceValue} />
              : <input className="form-control" value={resourceValue} onChange={(event) => setResourceValue(event.target.value)} />}</label>
            {resourceType==='Formula'&&formulaGuide?.key==='new'&&
              <FormulaSignatureGuide value={resourceValue} caret={formulaGuide.caret}/>}
            <button className="btn" disabled={!resourceLabel.trim()} onClick={addResource}><Plus size={13} />New Resource</button>
            {flow.resources.map((resource) => <div className="flow-resource-card" key={resource.name}>
              <strong>{resource.label}</strong><small>{resource.name} · {resource.type} · {resource.dataType}</small>
              <label className="form-label"
                onSelectCapture={event=>{const field=event.target as HTMLTextAreaElement;
                  if(resource.type==='Formula'&&typeof field.selectionStart==='number')
                    setFormulaGuide({key:resource.name,caret:field.selectionStart});}}
                onKeyUpCapture={event=>{const field=event.target as HTMLTextAreaElement;
                  if(resource.type==='Formula'&&typeof field.selectionStart==='number')
                    setFormulaGuide({key:resource.name,caret:field.selectionStart});}}>
                {resource.type === 'Formula' ? 'Formula Expression' : resource.type === 'Text Template' ? 'Template' : resource.type === 'Choice Set' ? 'Choices (one per line)' : 'Default Value'}{resource.type === 'Formula' || resource.type === 'Text Template' || resource.type === 'Choice Set'
                ? <SmartFieldInput multiline rows={resource.type === 'Text Template' ? 9 : 4} kind={resource.type === 'Formula' ? 'formula' : 'text'} objects={objects} primaryObjectApiName={flow.triggerObject ?? ''} value={displayValue(resource.value)} onChange={next => updateResource(resource.name, { value: next })} />
                : <input className="form-control" value={displayValue(resource.value)} onChange={(event) => updateResource(resource.name, { value: event.target.value })} />}</label>
              {resource.type==='Formula'&&formulaGuide?.key===resource.name&&
                <FormulaSignatureGuide value={displayValue(resource.value)} caret={formulaGuide.caret}/>}
              <div className="form-options"><label className="checkbox-row"><input type="checkbox" checked={resource.availableForInput} disabled={!['Variable', 'Record', 'Record Collection'].includes(resource.type)} onChange={(event) => updateResource(resource.name, { availableForInput: event.target.checked })} />Available for input</label><label className="checkbox-row"><input type="checkbox" checked={resource.availableForOutput} onChange={(event) => updateResource(resource.name, { availableForOutput: event.target.checked })} />Available for output</label></div>
              <button className="text-action" onClick={() => onFlowChange({ ...flow, resources: flow.resources.filter((item) => item.name !== resource.name) })}><X size={13} />Delete Resource</button>
            </div>)}
          </div>
          <div className="toolbox-group"><h3>Named Credentials</h3>          <p>Tenant-scoped HTTPS and SMTP credentials are encrypted at rest. Secrets are never returned to the browser.</p>
            <label className="form-label">API Name<input className="form-control" value={credentialName} onChange={(event) => setCredentialName(event.target.value.replace(/[^A-Za-z0-9_]/g, ''))} placeholder="Partner_API" /></label>
            <label className="form-label">Label<input className="form-control" value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} placeholder="Partner API" /></label>
            <label className="form-label">Protocol<select className="form-control" value={credentialProtocol} onChange={(event) => { const protocol = event.target.value as NamedCredentialMetadata['protocol']; setCredentialProtocol(protocol); if (protocol === 'SMTP' && credentialAuthType !== 'Basic' && credentialAuthType !== 'None') setCredentialAuthType('Basic'); }}><option>HTTPS</option><option>SMTP</option></select></label>
            <label className="form-label">{credentialProtocol === 'SMTP' ? 'SMTP Server URL' : 'Base URL'}<input className="form-control" type="url" value={credentialBaseUrl} onChange={(event) => setCredentialBaseUrl(event.target.value)} placeholder={credentialProtocol === 'SMTP' ? 'smtp://smtp.example.com:587' : 'https://api.example.com/'} /></label>
            <label className="form-label">Authentication<select className="form-control" value={credentialAuthType} onChange={(event) => setCredentialAuthType(event.target.value as NamedCredentialMetadata['authType'])}>{(credentialProtocol === 'SMTP' ? ['None', 'Basic'] : ['None', 'Bearer', 'Basic', 'API Key']).map((type) => <option key={type}>{type}</option>)}</select></label>
            {credentialAuthType === 'API Key' && <label className="form-label">API Key Header<input className="form-control" value={credentialHeaderName} onChange={(event) => setCredentialHeaderName(event.target.value)} /></label>}
            {credentialAuthType === 'Basic' && <label className="form-label">Username<input className="form-control" autoComplete="off" value={credentialUsername} onChange={(event) => setCredentialUsername(event.target.value)} placeholder={credentialId ? 'Leave blank to retain' : ''} /></label>}
            {credentialAuthType !== 'None' && <label className="form-label">{credentialAuthType === 'Basic' ? 'Password' : 'Secret'}<input className="form-control" type="password" autoComplete="new-password" value={credentialSecret} onChange={(event) => setCredentialSecret(event.target.value)} placeholder={credentialId ? 'Stored securely · blank keeps existing secret' : 'Enter secret'} /></label>}
            <button className="btn btn-brand" disabled={!credentialName.trim() || !credentialLabel.trim() || !credentialBaseUrl.trim()} onClick={() => void submitCredential()}>{credentialId ? 'Update Named Credential' : 'Save Named Credential'}</button>
            {credentialId && <button className="text-action" onClick={() => editCredential()}>Cancel edit</button>}
            {namedCredentials.map((credential) => <div className="flow-resource-card" key={credential.id}><strong>{credential.label}</strong><small>{credential.protocol} · {credential.name} · {credential.authType} · key {credential.keyId}</small><small>{credential.baseUrl} · Secret {credential.hasSecret ? 'stored (masked)' : 'not required'}</small><div className="toolbar-actions"><button className="btn" onClick={() => editCredential(credential)}>Edit</button><button className="btn" onClick={() => { if (!confirmDestructiveAction('Delete', 'Named Credential "'+credential.label+'"', 'Flows or integrations using this credential may fail.')) return; void onDeleteNamedCredential(credential.id).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to delete credential')); }}>Delete</button></div></div>)}
            {!namedCredentials.length && <p className="empty-list">No Named Credentials are configured.</p>}
          </div>
          <div className="toolbox-group"><h3>Email Alerts</h3>
            <p>Reusable, tenant-scoped alerts for record-triggered flows. Recipients, subject, and body support Flow record references.</p>
            <label className="form-label">API Name<input className="form-control" value={emailAlertName} onChange={(event) => setEmailAlertName(event.target.value.replace(/[^A-Za-z0-9_]/g, ''))} placeholder="Account_Notification" /></label>
            <label className="form-label">Label<input className="form-control" value={emailAlertLabel} onChange={(event) => setEmailAlertLabel(event.target.value)} placeholder="Account Notification" /></label>
            <label className="form-label">Object<select className="form-control" value={emailAlertObject} onChange={(event) => setEmailAlertObject(event.target.value)}><option value="">Select an object</option>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label} ({object.apiName})</option>)}</select></label>
            <label className="form-label">SMTP Named Credential<select className="form-control" value={emailAlertCredentialId} onChange={(event) => setEmailAlertCredentialId(event.target.value)}><option value="">Select an SMTP credential</option>{namedCredentials.filter((credential) => credential.protocol === 'SMTP').map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}</select></label>
            <label className="form-label">From Email<input className="form-control" type="email" value={emailAlertFrom} onChange={(event) => setEmailAlertFrom(event.target.value)} /></label>
            <label className="form-label">Recipients (comma or semicolon separated)<input className="form-control" value={emailAlertRecipients} onChange={(event) => setEmailAlertRecipients(event.target.value)} placeholder="person@example.com, {!$Record.Email}" /></label>
            <label className="form-label">Subject<input className="form-control" value={emailAlertSubject} onChange={(event) => setEmailAlertSubject(event.target.value)} /></label>
            <label className="form-label">Plain-text Body<textarea className="form-control" rows={4} value={emailAlertBody} onChange={(event) => setEmailAlertBody(event.target.value)} placeholder="Hello {!$Record.Name}" /></label>
            <button className="btn btn-brand" disabled={!emailAlertName.trim() || !emailAlertLabel.trim() || !emailAlertObject || !emailAlertCredentialId || !emailAlertFrom.trim() || !emailAlertRecipients.trim() || !emailAlertSubject.trim() || !emailAlertBody.trim()} onClick={() => void submitEmailAlert()}>{emailAlertId ? 'Update Email Alert' : 'Save Email Alert'}</button>
            {emailAlertId && <button className="text-action" onClick={() => editEmailAlert()}>Cancel edit</button>}
            {emailAlerts.map((alert) => <div className="flow-resource-card" key={alert.id}><strong>{alert.label}</strong><small>{alert.name} · {alert.objectApiName}</small><small>{alert.recipients} · SMTP credential: {namedCredentials.find((credential) => credential.id === alert.namedCredentialId)?.label ?? 'Unavailable'}</small><div className="toolbar-actions"><button className="btn" onClick={() => editEmailAlert(alert)}>Edit</button><button className="btn" onClick={() => { if (!confirmDestructiveAction('Delete', 'Email Alert "'+alert.label+'"')) return; void onDeleteEmailAlert(alert.id).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to delete Email Alert')); }}>Delete</button></div></div>)}
            {!emailAlerts.length && <p className="empty-list">No Email Alerts are configured.</p>}
          </div>
        </div>}
      </aside>
  </>;
}
