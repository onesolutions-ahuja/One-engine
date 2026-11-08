import { confirmDestructiveAction } from '../../../../components/ConfirmAction/confirmDestructiveAction';
import { pageTemplates } from '../../pageEditorMetadata';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import RichTextBlockEditor from '../../../ComponentProperties/RichTextBlockEditor';
import { childrenOf, canNest, isLayoutContainer, rawLayoutParentId, reparentComponent } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { findRegisteredComponent } from '../../../../components/Registry/componentRegistryLookup';
import { type PageActivationAssignmentMetadata, type LightningPageTemplate } from '../../../../metadata/Definitions/metadata';

import type { usePageEditorState } from '../usePageEditorState';
import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePagePlacement } from '../canvas/usePagePlacement';
import type { PageBuilderComponents } from '../PageBuilderTypes';
import type { usePageComponentProperties } from './usePageComponentProperties';
import type { createPageRibbon } from '../ribbon/createPageRibbon';
import type { usePageComponentActions } from '../usePageComponentActions';

export default function PagePropertyInspector({ editorState, props, placement, components, componentProperties, ribbon, componentActions }: {
  editorState: ReturnType<typeof usePageEditorState>;
  props: PageBuilderProps;
  placement: ReturnType<typeof usePagePlacement>;
  components: PageBuilderComponents;
  componentProperties: ReturnType<typeof usePageComponentProperties>;
  ribbon: ReturnType<typeof createPageRibbon>;
  componentActions: ReturnType<typeof usePageComponentActions>;
}) {
  const {
    ribbonPropertyHost, ribbonTab, pageSettingsOpen, selected, selectedRegion, activePanel,
    advancedEditor, setSelectedRegion, inspectorTab, updateComponent, builderAppApiName, applyPage,
    setSelectedId, stringList, targetObject, fields, setDynamicFormsUpgradeOpen,
    dynamicFormsUpgradeOpen, migrationLayoutId, setMigrationLayoutId, pageLayouts,
    newRecordLinkLabel, setNewRecordLinkLabel, newRecordLinkUrl, setNewRecordLinkUrl,
    relatedListOptions, recordScope, setRecordScope, recordAppId, setRecordAppId, recordProfileId,
    setRecordProfileId, recordTypeId, setRecordTypeId, recordFormFactors, setRecordFormFactors,
    homeAppId, setHomeAppId, homeScope, setHomeScope, homeProfileId, setHomeProfileId,
    homeFormFactors, setHomeFormFactors,
  } = editorState;
  const {
    page, libraryComponents, objects, apps, pages, flows, onNotify, reports, profiles,
  } = props;
  const { setPageTemplate } = placement;
  const { MetadataComponentProperties } = components;
  const {
    selectedCustomDefinition, dynamicFormsEnabled, assignedMigrationLayout,
    selectedMigrationLayout,
  } = componentProperties;
  const { componentRelatedListOptions, selectedRelatedLists } = ribbon;
  const {
    upgradeRecordDetail, moveSectionField, importLegacyRecordLayout, recordPageActionIds,
    updateRecordPageControls, recordPageActionVisibility, recordPageActionOverrides,
    recordPageLinks, recordPageRelatedSettings, updateRecordPageRelatedList, removePageAssignment,
    addRecordAssignment, addHomeAssignment,
  } = componentActions;
  return <>
{ribbonPropertyHost && createPortal(<aside id="lightning-page-properties" style={ribbonTab !== 'Component Layout' && ribbonTab !== 'Advanced' && !ribbonTab.startsWith('Component ') ? { display: 'none' } : undefined}
          className={`properties-panel reference-properties-panel ${pageSettingsOpen || selected ? 'responsive-open' : ''}`}>
          {selectedRegion && !pageSettingsOpen && activePanel !== 'page' && !advancedEditor ? <div className="properties-section">
            <div className="properties-section-title">Section configuration</div>
            <p className="properties-help">Sections are responsive layout regions. Change the arrangement without deleting any blocks.</p>
            <label className="form-label">Section arrangement<select className="form-control" value={page.template ?? 'main-sidebar'} onChange={event => setPageTemplate(event.target.value as LightningPageTemplate)}>{pageTemplates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            {selectedRegion !== 'main' && <button type="button" className="btn btn-small" onClick={() => {
              const next = pageTemplates.find(item => item.regions.includes('main') && item.regions.every(region => region !== selectedRegion) && item.regions.every(region => region === 'main' || pageTemplates.find(candidate => candidate.id === (page.template ?? 'main-sidebar'))?.regions.includes(region)) && item.regions.length === (pageTemplates.find(candidate => candidate.id === (page.template ?? 'main-sidebar'))?.regions.length ?? 2) - 1);
              if (!next || !confirmDestructiveAction('Remove', `${selectedRegion} section`, 'Blocks in the removed section will move to Main.')) return;
              setPageTemplate(next.id); setSelectedRegion(null);
            }}><Trash2 size={15}/> Remove section</button>}
            {selectedRegion === 'main' && <p className="properties-help">The Main section is required and cannot be deleted. Change the section arrangement to remove optional regions.</p>}
          </div> : selected && !pageSettingsOpen && activePanel !== 'page' && advancedEditor!=='recordPage' && advancedEditor!=='assignments' ? <>
            {inspectorTab === 'Position' ? <div className="office-ribbon-layout-responsive" /> : <>
            {inspectorTab === 'Data & Actions' && <details className="builder-advanced-panel"><summary>Technical details</summary>
              <label className="form-label" htmlFor="page-component-type">Component type</label><div className="form-display" id="page-component-type">{selected.type}</div>
            </details>}
            {inspectorTab === 'Visibility' && <MetadataComponentProperties
              mode="actions" properties={selected.properties} onChange={(properties: Record<string,unknown>)=>updateComponent(selected.id,{properties})}
              pageComponents={page.components} componentCatalog={libraryComponents} device={page.layoutVariant??'Desktop'}
              definitions={selectedCustomDefinition?.propertyDefinitions} eventDefinitions={selectedCustomDefinition?.eventDefinitions}
              componentVersion={selectedCustomDefinition?.version} objects={objects} apps={apps} pages={pages}
              currentAppId={builderAppApiName||apps[0]?.apiName||'Records'} primaryObjectApiName={page.targetObject} flows={flows}/>}
            {inspectorTab === 'Data & Actions' && <>
            {selected.parentId && <button type="button" className="btn btn-small" onClick={() => updateComponent(selected.id, { parentId: undefined })}>Move out of section</button>}
            {selectedCustomDefinition && <>
              <div className="properties-section-title">Connect & configure</div>
              <section className="office-ribbon-presentation-group" aria-label="Section nesting">
              <div className="office-ribbon-group-heading">Section nesting</div>
              {true
                && <label className="checkbox-row">
                  <input type="checkbox" checked={isLayoutContainer(selected)}
                    onChange={(event) => {
                      if (!event.target.checked && childrenOf(page.components, selected.id).length) {
                        onNotify('Move all child components out before disabling nesting.');
                        return;
                      }
                      updateComponent(selected.id, { properties: { ...selected.properties, layoutContainer: event.target.checked } });
                    }} />
                  Accept nested components (requires a component that renders children)
                </label>}
              <label className="form-label">Parent container
                <select className="form-control" aria-label="Parent container" value={rawLayoutParentId(selected) ?? ''}
                  onChange={(event) => {
                    const parentId = event.target.value || null;
                    if (!canNest(page.components, selected.id, parentId)) {
                      onNotify('A component cannot be nested inside itself or a descendant.');
                      return;
                    }
                    applyPage({ ...page, components: reparentComponent(page.components, selected.id, parentId) });
                  }}>
                  <option value="">Canvas / page root</option>
                  {page.components.filter((item) => canNest(page.components, selected.id, item.id))
                    .map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
              {isLayoutContainer(selected) && <>
                <p className="properties-help">Drag components onto this container or select them below to edit. Drop a child onto the canvas to move it back to the root.</p>
                <div className="properties-section-title">Child components</div>
                {childrenOf(page.components, selected.id).map((child) => <button className="btn btn-small" type="button" key={child.id}
                  onClick={() => setSelectedId(child.id)}>{child.label}</button>)}
                {!childrenOf(page.components, selected.id).length && <p className="properties-help">No children yet — drop components into this layout.</p>}
              </>}
              </section>
              <MetadataComponentProperties mode="data"
                pageComponents={page.components} componentCatalog={libraryComponents}
                device={page.layoutVariant??'Desktop'}
                componentVersion={findRegisteredComponent(libraryComponents,selected.type.startsWith('Custom:')?selected.type.slice('Custom:'.length):'','page')?.version}
                eventDefinitions={findRegisteredComponent(libraryComponents,selected.type.startsWith('Custom:')?selected.type.slice('Custom:'.length):'','page')?.eventDefinitions}
                definitions={findRegisteredComponent(libraryComponents, selected.type.startsWith('Custom:') ? selected.type.slice('Custom:'.length) : '', 'page')?.propertyDefinitions} properties={selected.properties}
                objects={objects}
                apps={apps}
                pages={pages}
                currentAppId={builderAppApiName || apps[0]?.apiName || 'Records'} primaryObjectApiName={page.targetObject}
                flows={flows}
                onChange={(properties: Record<string, unknown>) => updateComponent(selected.id, { properties })}
              />
            </>}
            {selected.type === 'Highlights Panel' && <>
              <div className="properties-section-title">Highlight actions</div>
              <p className="properties-help">Only actions allowed by record permissions can execute. Visible actions remain governed by the Object's permission grants.</p>
              {(()=>{
                const configured=stringList(selected.properties.actionIds,[]);
                return (targetObject?.actions??[]).filter(action=>action.enabled).map(action=>
                  <label className="checkbox-row property-check" key={action.id}>
                    <input type="checkbox" checked={configured.includes(action.id)}
                      onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                        actionIds:event.target.checked?[...configured,action.id]:configured.filter(id=>id!==action.id)}})}/>
                    {action.label}
                  </label>);
              })()}
              <label className="checkbox-row property-check"><input type="checkbox"
                checked={selected.properties.showEditAction===true}
                onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                  showEditAction:event.target.checked}})}/>Show permitted Edit button</label>
              <label className="checkbox-row property-check"><input type="checkbox"
                checked={selected.properties.showCloneAction===true}
                onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                  showCloneAction:event.target.checked}})}/>Show permitted Clone button</label>
            </>}
            {selected.type === 'Rich Text' && <>
              <div className="properties-section-title">Text</div>
              <RichTextBlockEditor value={String(selected.properties.content??'')}
                onChange={value=>updateComponent(selected.id,{properties:{...selected.properties,content:value}})}/>
            </>}
            {selected.type === 'List View' && <>
              <div className="properties-section-title">List records</div>
              <label className="form-label">Source Object
                <select className="form-control" value={String(selected.properties.listObjectApiName??'')}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                    listObjectApiName:event.target.value,columns:[]}})}>
                  <option value="">Select Object…</option>
                  {objects.map(item=><option key={item.apiName} value={item.apiName}>{item.pluralLabel}</option>)}
                </select>
              </label>
              {(()=>{
                const source=objects.find(item=>item.apiName===selected.properties.listObjectApiName);
                const chosen=stringList(selected.properties.columns,[]);
                return source?.fields.map(field=><label key={field.apiName} className="checkbox-row property-check">
                  <input type="checkbox" checked={chosen.includes(field.apiName)}
                    onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                      columns:event.target.checked?[...chosen,field.apiName]:chosen.filter(name=>name!==field.apiName)}})}/>
                  {field.label}
                </label>);
              })()}
              <label className="form-label">Rows per page
                <input type="number" className="form-control" min={1} max={100}
                  value={typeof selected.properties.pageSize==='number'?selected.properties.pageSize:25}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                    pageSize:Math.max(1,Math.min(100,Number(event.target.value)||1))}})}/>
              </label>
            </>}
            {selected.type === 'Path' && <>
              <div className="properties-section-title">Record Path</div>
              <label className="form-label">Picklist stage field
                <select className="form-control" value={String(selected.properties.stageFieldApiName??'')}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                    stageFieldApiName:event.target.value}})}>
                  <option value="">Choose field…</option>
                  {fields.filter(field=>field.dataType==='Picklist').map(field=>
                    <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                </select>
              </label>
            </>}
            {selected.type === 'Screen Flow' && <>
              <div className="properties-section-title">Flow</div>
              <label className="checkbox-row property-check">
                <input type="checkbox" checked={selected.properties.embed!==false}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,embed:event.target.checked}})}/>
                Embed the Flow interview on this page (uncheck for a separate Flow dialog)
              </label>
              <label className="form-label">Active Screen Flow
                <select className="form-control" value={String(selected.properties.flowApiName??'')}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                    flowApiName:event.target.value}})}>
                  <option value="">Select Screen Flow…</option>
                  {flows.filter(flow=>flow.flowType==='Screen Flow'&&flow.status==='Active').map(flow=>
                    <option key={flow.apiName} value={flow.apiName}>{flow.label}</option>)}
                </select>
              </label>
              {page.pageType==='Record Page'&&<label className="form-label">Flow input variable for record ID
                <input className="form-control" placeholder="recordId"
                  value={String(selected.properties.inputRecordIdAs??'')}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                    inputRecordIdAs:event.target.value}})}/>
              </label>}
            </>}
            {(selected.type === 'Related List'||selected.type==='Related List Quick Links') && <>
              <div className="properties-section-title">Related Lists</div>
              {componentRelatedListOptions.map((option) => <label className="checkbox-row property-check" key={option.apiName}><input type="checkbox" checked={selectedRelatedLists.includes(option.apiName)} onChange={(event) => {
                updateComponent(selected.id, { properties: { ...selected.properties, relatedLists: event.target.checked ? [...selectedRelatedLists, option.apiName] : selectedRelatedLists.filter((item) => item !== option.apiName) } });
              }} />{option.label}</label>)}
              {!componentRelatedListOptions.length && <div className="palette-note">No related objects have a relationship to this record object.</div>}
              {selected.type==='Related List'&&selectedRelatedLists.map(name=>{
                const relation=objects.flatMap(child=>child.fields
                  .filter(field=>field.relationship?.targetObject===page.targetObject
                    &&(field.relationship.childRelationshipName===name||child.pluralLabel===name))
                  .map(field=>({child,field})))[0];
                if(!relation)return null;
                const configs=(selected.properties.relatedListSettings??{}) as Record<string,Record<string,unknown>>;
                const config=configs[name]??{};
                const setSetting=(key:string,value:unknown)=>{
                  updateComponent(selected.id,{properties:{...selected.properties,
                    relatedListSettings:{...configs,[name]:{...config,[key]:value}}}});
                };
                const eligible=relation.child.fields.filter(field=>field.apiName!==relation.field.apiName);
                const configuredColumns=stringList(config.columns,eligible.slice(0,4).map(field=>field.apiName));
                return <details key={name} className="builder-related-list-config">
                  <summary>{relation.child.pluralLabel} — columns, sort, filters and actions</summary>
                  <div className="properties-section-title">Columns</div>
                  {eligible.map(field=><label className="checkbox-row property-check" key={field.apiName}>
                    <input type="checkbox" checked={configuredColumns.includes(field.apiName)}
                      onChange={event=>setSetting('columns',event.target.checked
                        ?[...configuredColumns,field.apiName]:configuredColumns.filter(value=>value!==field.apiName))}/>
                    {field.label}</label>)}
                  <label className="form-label">Records per page
                    <input type="number" className="form-control" min={1} max={100}
                      value={typeof config.pageSize==='number'?config.pageSize:50}
                      onChange={event=>setSetting('pageSize',Math.max(1,Math.min(100,Number(event.target.value)||1)))}/>
                  </label>
                  <label className="form-label">Sort by
                    <select className="form-control" value={typeof config.sortField==='string'?config.sortField:''}
                      onChange={event=>setSetting('sortField',event.target.value)}>
                      <option value="">Default order</option>
                      {eligible.map(field=><option value={field.apiName} key={field.apiName}>{field.label}</option>)}
                    </select>
                  </label>
                  <label className="form-label">Sort direction
                    <select className="form-control" value={config.sortDirection==='desc'?'desc':'asc'}
                      onChange={event=>setSetting('sortDirection',event.target.value)}>
                      <option value="asc">Ascending</option><option value="desc">Descending</option>
                    </select>
                  </label>
                  <label className="form-label">Filter field
                    <select className="form-control" value={typeof config.filterField==='string'?config.filterField:''}
                      onChange={event=>setSetting('filterField',event.target.value)}>
                      <option value="">No filter</option>
                      {eligible.map(field=><option value={field.apiName} key={field.apiName}>{field.label}</option>)}
                    </select>
                  </label>
                  {!!config.filterField&&<>
                    <label className="form-label">Filter operator
                      <select className="form-control" value={String(config.filterOperator??'Equals')}
                        onChange={event=>setSetting('filterOperator',event.target.value)}>
                        <option value="Equals">Equals</option><option value="Includes">Includes</option><option value="Excludes">Excludes</option>
                      </select>
                    </label>
                    <label className="form-label">Filter value
                      <input className="form-control" value={typeof config.filterValue==='string'?config.filterValue:''}
                        onChange={event=>setSetting('filterValue',event.target.value)}/>
                    </label>
                  </>}
                  <label className="checkbox-row"><input type="checkbox"
                    checked={config.showNewAction!==false}
                    onChange={event=>setSetting('showNewAction',event.target.checked)}/>Show New action</label>
                  <label className="checkbox-row"><input type="checkbox"
                    checked={config.showRowActions===true}
                    onChange={event=>setSetting('showRowActions',event.target.checked)}/>Show permitted row actions</label>
                </details>;
              })}
            </>}
            {selected.type === 'Tabs' && <>
              <div className="properties-section-title">Tabs</div><label className="form-label" htmlFor="page-component-tabs">Tab labels</label>
              <textarea id="page-component-tabs" className="form-control" rows={3} value={stringList(selected.properties.tabs, ['Related', 'Details', 'News']).join('\n')} onChange={(event) => updateComponent(selected.id, { properties: { ...selected.properties, tabs: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } })} />
            </>}
            {selected&&rawLayoutParentId(selected)&&page.components.find(item=>item.id===rawLayoutParentId(selected))?.type==='Tabs'&&(()=>{
              const parent=page.components.find(item=>item.id===rawLayoutParentId(selected))!;
              const available=stringList(parent.properties.tabs,['Details']);
              return <label className="form-label">Parent tab
                <select className="form-control"
                  value={typeof selected.properties.tabLabel==='string'?selected.properties.tabLabel:available[0]??''}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,tabLabel:event.target.value}})}>
                  {available.map(tab=><option key={tab} value={tab}>{tab}</option>)}
                </select>
              </label>;
            })()}
            {selected.type === 'Report Chart' && <>
              <div className="properties-section-title">Report</div>
              <label className="form-label" htmlFor="page-component-report">Source report</label>
              <select id="page-component-report" className="form-control"
                value={typeof selected.properties.reportApiName==='string'?selected.properties.reportApiName:''}
                onChange={event=>{
                  const report=reports.find(item=>item.apiName===event.target.value);
                  const source=objects.find(item=>item.apiName===report?.objectApiName);
                  const lookup=report?.objectApiName===page.targetObject?''
                    :source?.fields.find(field=>field.relationship?.targetObject===page.targetObject)?.apiName??'';
                  updateComponent(selected.id,{properties:{...selected.properties,
                    reportApiName:event.target.value,recordFilterFieldApiName:lookup}});
                }}>
                <option value="">Select a report…</option>
                {reports.filter(report=>page.pageType!=='Record Page'
                  ||report.objectApiName===page.targetObject
                  ||objects.find(item=>item.apiName===report.objectApiName)?.fields.some(field=>
                    field.relationship?.targetObject===page.targetObject))
                  .map(report=><option key={report.apiName} value={report.apiName}>{report.label}</option>)}
              </select>
              {page.pageType==='Record Page'&&<>
                <label className="checkbox-row property-check"><input type="checkbox"
                  checked={selected.properties.filterByCurrentRecord!==false}
                  onChange={event=>updateComponent(selected.id,{properties:{
                    ...selected.properties,filterByCurrentRecord:event.target.checked}})}/>
                  Filter report by current record
                </label>
                {(()=>{
                  const report=reports.find(item=>item.apiName===selected.properties.reportApiName);
                  const source=objects.find(item=>item.apiName===report?.objectApiName);
                  const relationFields=source?.fields.filter(field=>
                    field.relationship?.targetObject===page.targetObject)??[];
                  return report&&report.objectApiName!==page.targetObject
                    ?<label className="form-label">Related record lookup field
                       <select className="form-control"
                         value={typeof selected.properties.recordFilterFieldApiName==='string'
                           ?selected.properties.recordFilterFieldApiName:''}
                         onChange={event=>updateComponent(selected.id,{properties:{
                           ...selected.properties,recordFilterFieldApiName:event.target.value}})}>
                         <option value="">Choose relationship…</option>
                         {relationFields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                       </select>
                     </label>:null;
                })()}
              </>}
            </>}
            {selected.type === 'Record Detail' && <>
              <div className="properties-section-title">Displayed Fields</div>
              {fields.map((field) => {
                const displayedFields = (Array.isArray(selected.properties.fields) ? selected.properties.fields : fields.slice(0, 6).map((item) => item.apiName)) as string[];
                return <label className="checkbox-row property-check" key={field.apiName}><input type="checkbox" checked={displayedFields.includes(field.apiName)} onChange={(event) => updateComponent(selected.id, { properties: { ...selected.properties, fields: event.target.checked ? [...displayedFields, field.apiName] : displayedFields.filter((item) => item !== field.apiName) } })} />{field.label}</label>;
              })}
              {!dynamicFormsEnabled && <div className="dynamic-forms-upgrade">
                <button className="btn" type="button" onClick={() => setDynamicFormsUpgradeOpen((current) => !current)}>Upgrade Now</button>
                {dynamicFormsUpgradeOpen && <>
                  <p className="properties-help">Choose the page layout whose sections and fields should become Dynamic Forms components.</p>
                  <label className="form-label" htmlFor="dynamic-forms-layout">Page Layout
                    <select id="dynamic-forms-layout" className="form-control" value={migrationLayoutId || assignedMigrationLayout?.id || ''} onChange={(event) => setMigrationLayoutId(event.target.value)}>
                      {pageLayouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.label}</option>)}
                    </select>
                  </label>
                  {!pageLayouts.length && <div className="palette-note">No page layouts are available for this object.</div>}
                  <button className="btn btn-brand" type="button" disabled={!selectedMigrationLayout} onClick={() => upgradeRecordDetail(selected)}>Upgrade</button>
                </>}
              </div>}
            </>}
            {selected.type === 'Field Section' && <>
              <div className="properties-section-title">Section Fields</div>
              <label className="form-label" htmlFor="field-section-columns">Columns
                <select id="field-section-columns" className="form-control" value={selected.properties.columns === 1 ? 1 : 2} onChange={(event) => updateComponent(selected.id, { properties: { ...selected.properties, columns: Number(event.target.value) } })}>
                  <option value={1}>1</option><option value={2}>2</option>
                </select>
              </label>
              {fields.map((field) => {
                const fieldApiNames = stringList(selected.properties.fieldApiNames, []);
                const fieldIndex = fieldApiNames.indexOf(field.apiName);
                return <div className="dynamic-field-property-row" key={field.apiName}>
                  <label className="checkbox-row property-check">
                    <input type="checkbox" checked={fieldIndex >= 0} onChange={(event) => updateComponent(selected.id, { properties: { ...selected.properties, fieldApiNames: event.target.checked ? [...fieldApiNames, field.apiName] : fieldApiNames.filter((item) => item !== field.apiName) } })} />
                    {field.label}
                  </label>
                  {fieldIndex >= 0 && <label className="form-label">Layout behavior for {field.label}
                    <select className="form-control" value={
                      stringList(selected.properties.requiredFieldApiNames,[]).includes(field.apiName)?'Required'
                      :stringList(selected.properties.readOnlyFieldApiNames,[]).includes(field.apiName)?'ReadOnly':'Editable'}
                      onChange={event=>{
                        const mode=event.target.value;
                        const required=stringList(selected.properties.requiredFieldApiNames,[])
                          .filter(name=>name!==field.apiName);
                        const readOnly=stringList(selected.properties.readOnlyFieldApiNames,[])
                          .filter(name=>name!==field.apiName);
                        if(mode==='Required')required.push(field.apiName);
                        if(mode==='ReadOnly')readOnly.push(field.apiName);
                        updateComponent(selected.id,{properties:{...selected.properties,
                          requiredFieldApiNames:required,readOnlyFieldApiNames:readOnly}});
                      }}>
                      <option value="Editable">Editable</option>
                      <option value="Required">Required on this layout</option>
                      <option value="ReadOnly" disabled={field.required}>Read-only on this layout</option>
                    </select>
                  </label>}
                  {fieldIndex >= 0 && <div className="property-position-actions">
                    <button className="icon-button subtle" type="button" aria-label={`Move ${field.label} up`} title="Move up" disabled={fieldIndex === 0} onClick={() => moveSectionField(selected.id, fieldIndex, -1)}><ArrowUp size={13} /></button>
                    <button className="icon-button subtle" type="button" aria-label={`Move ${field.label} down`} title="Move down" disabled={fieldIndex === fieldApiNames.length - 1} onClick={() => moveSectionField(selected.id, fieldIndex, 1)}><ArrowDown size={13} /></button>
                  </div>}
                </div>;
              })}
            </>}
            {selected.type === 'Record Field' && <>
              <div className="properties-section-title">Field</div>
              <label className="form-label" htmlFor="record-field-selection">Record Field
                <select id="record-field-selection" className="form-control" value={typeof selected.properties.fieldApiName === 'string' ? selected.properties.fieldApiName : ''} onChange={(event) => {
                  const field = fields.find((item) => item.apiName === event.target.value);
                  updateComponent(selected.id, { label: field?.label ?? selected.label, properties: { ...selected.properties, fieldApiName: event.target.value } });
                }}>
                  {fields.map((field) => <option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                </select>
              </label>
              <label className="form-label">Layout behavior
                <select className="form-control" value={selected.properties.requiredOnLayout===true?'Required'
                 :selected.properties.readOnlyOnLayout===true?'ReadOnly':'Editable'}
                 onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                   requiredOnLayout:event.target.value==='Required',
                   readOnlyOnLayout:event.target.value==='ReadOnly'}})}>
                  <option value="Editable">Editable</option>
                  <option value="Required">Required on this layout</option>
                  <option value="ReadOnly" disabled={fields.find(field=>field.apiName===selected.properties.fieldApiName)?.required===true}>
                    Read-only on this layout
                  </option>
                </select>
              </label>
            </>}
            </>}
            </>}
          </> : <>
            {advancedEditor!=='assignments' && <>
            <div className="properties-section-title">Page configuration</div>
            {page.layoutMode==='template'&&<label className="form-label">Section arrangement
              <select className="form-control" value={page.template??'main-sidebar'}
                onChange={event=>setPageTemplate(event.target.value as LightningPageTemplate)}>
                {pageTemplates.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>}
            {(page.layoutVariant??'Desktop')==='Custom'&&<>
              <div className="properties-section-title">Automatic Custom layout activation</div>
              <label className="checkbox-row"><input type="checkbox"
                checked={page.customTargetEnabled===true}
                onChange={event=>applyPage({...page,customTargetEnabled:event.target.checked})}/>
                Use Custom layout automatically for matching viewport widths
              </label>
              <div className="form-grid">
                <label className="form-label">Minimum viewport width (px)
                  <input className="form-control" type="number" min={320} max={10000}
                    value={page.customTargetMinWidth??320}
                    onChange={event=>{
                      const width=Number(event.target.value);
                      if(Number.isInteger(width)&&width>=320&&width<=(page.customTargetMaxWidth??10000))
                        applyPage({...page,customTargetMinWidth:width});
                    }}/>
                </label>
                <label className="form-label">Maximum viewport width (px)
                  <input className="form-control" type="number" min={320} max={10000}
                    value={page.customTargetMaxWidth??10000}
                    onChange={event=>{
                      const width=Number(event.target.value);
                      if(Number.isInteger(width)&&width<=10000&&width>=(page.customTargetMinWidth??320))
                        applyPage({...page,customTargetMaxWidth:width});
                    }}/>
                </label>
              </div>
              <p className="properties-help">Applies only to published, authorised Custom layouts that are assigned to this app or record context.</p>
            </>}

            {page.pageType === 'Record Page' && <>
              <label className="form-label">Related object</label><div className="form-display">{targetObject?.label ?? page.targetObject}</div>
              <div className="properties-section-title">Fields and sections</div>
              <p className="properties-help">Use Field Section and Record Field blocks for the active record screen. Existing Page Layout configurations can be imported without overwriting their SQL history.</p>
              {(pageLayouts.length>0) && <details className="builder-advanced-panel"><summary>Import existing field layout</summary>
                <label className="form-label">Existing layout<select className="form-control" aria-label="Legacy field layout to import"
                  value={selectedMigrationLayout?.id??''} onChange={event=>setMigrationLayoutId(event.target.value)}>
                  {pageLayouts.map(layout=><option key={layout.id} value={layout.id}>{layout.label}</option>)}
                </select></label>
                <button type="button" className="btn" onClick={importLegacyRecordLayout}>Import into {page.layoutVariant??'Desktop'} draft</button>
              </details>}
              <div className="properties-section-title">Record buttons and actions</div>
              <p className="properties-help">Choose which actions appear on this published Record Page. OneEngine permissions still determine which actions a user may run.</p>
              {[...new Set(['New','Edit','Clone','Delete',...(targetObject?.actions??[]).filter(action=>action.enabled).map(action=>action.id)])]
                .map(actionId=><div className="metadata-card" key={actionId}>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={recordPageActionIds.includes(actionId)}
                      onChange={event=>updateRecordPageControls({actions:event.target.checked
                        ?[...recordPageActionIds,actionId]:recordPageActionIds.filter(id=>id!==actionId)})}/>
                    {targetObject?.actions?.find(action=>action.id===actionId)?.label??actionId}
                  </label>
                  {recordPageActionIds.includes(actionId)&&<>
                    <label className="form-label">Show action when field
                      <select className="form-control" value={recordPageActionVisibility[actionId]?.fieldApiName??''}
                        onChange={event=>{
                          const value=event.target.value;
                          const next={...recordPageActionVisibility};
                          if(value)next[actionId]={fieldApiName:value,equalsValue:''};
                          else delete next[actionId];
                          updateRecordPageControls({actionVisibility:next});
                        }}>
                        <option value="">Always (if permitted)</option>
                        {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                      </select>
                    </label>
                    {recordPageActionVisibility[actionId]&&<>
                      <label className="form-label">Condition
                        <select className="form-control" value={recordPageActionVisibility[actionId].operator??'Equals'}
                         onChange={event=>updateRecordPageControls({actionVisibility:{
                           ...recordPageActionVisibility,[actionId]:{...recordPageActionVisibility[actionId],
                             operator:event.target.value as 'Equals'|'NotEquals'|'Contains'|'IsBlank'|'IsNotBlank'}}})}>
                          <option value="Equals">Equals</option>
                          <option value="NotEquals">Does not equal</option>
                          <option value="Contains">Contains text</option>
                          <option value="IsBlank">Is blank</option>
                          <option value="IsNotBlank">Is not blank</option>
                        </select>
                      </label>
                      {!['IsBlank','IsNotBlank'].includes(recordPageActionVisibility[actionId].operator??'Equals')
                        &&<label className="form-label">Compare with
                          <input className="form-control" maxLength={256}
                           value={recordPageActionVisibility[actionId].equalsValue}
                           onChange={event=>updateRecordPageControls({actionVisibility:{
                             ...recordPageActionVisibility,[actionId]:{...recordPageActionVisibility[actionId],
                               equalsValue:event.target.value}}})}/>
                        </label>}
                    </>}
                  </>}
                </div>)}
              <div className="properties-section-title">Standard button overrides</div>
              <p className="properties-help">Replace a standard button with an existing published
               Object Action. The standard permission and Action permission must both allow it.
               Changes apply only to this device's published layout.</p>
              {(['Edit','Clone','Delete'] as const).map(name=><label key={name} className="form-label">
                {name} button
                <select className="form-control" value={recordPageActionOverrides[name]??''}
                 disabled={!recordPageActionIds.includes(name)}
                 onChange={event=>{
                   const overrides={...recordPageActionOverrides};
                   if(event.target.value)overrides[name]=event.target.value;
                   else delete overrides[name];
                   updateRecordPageControls({actionOverrides:overrides});
                 }}>
                 <option value="">Standard {name} behavior</option>
                 {(targetObject?.actions??[]).filter(action=>action.type==='Custom'&&action.enabled)
                  .map(action=><option key={action.id} value={action.id}>{action.label}</option>)}
                </select>
              </label>)}
              <div className="properties-section-title">Record links</div>
              {recordPageLinks.map(link=><details className="builder-advanced-panel" key={link.id}>
                <summary>{link.label}</summary>
                <label className="form-label">Link label<input className="form-control" maxLength={200}
                  value={link.label} onChange={event=>updateRecordPageControls({customLinks:
                    recordPageLinks.map(item=>item.id===link.id?{...item,label:event.target.value}:item)})}/></label>
                <label className="form-label">Link URL<input className="form-control" maxLength={2048}
                  value={link.url} onChange={event=>updateRecordPageControls({customLinks:
                    recordPageLinks.map(item=>item.id===link.id?{...item,url:event.target.value}:item)})}/></label>
                <label className="checkbox-row"><input type="checkbox" checked={link.openInNewWindow}
                  onChange={event=>updateRecordPageControls({customLinks:
                    recordPageLinks.map(item=>item.id===link.id?{...item,openInNewWindow:event.target.checked}:item)})}/>Open in a new window</label>
                <label className="form-label">Show when field<select className="form-control"
                  value={link.visibleWhenField??''} onChange={event=>updateRecordPageControls({customLinks:
                    recordPageLinks.map(item=>item.id===link.id?{...item,visibleWhenField:event.target.value||undefined,
                      visibleWhenValue:event.target.value?(item.visibleWhenValue??''):undefined}:item)})}>
                  <option value="">Always</option>{fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                </select></label>
                {link.visibleWhenField&&<label className="form-label">Equals value<input className="form-control" maxLength={256}
                  value={link.visibleWhenValue??''} onChange={event=>updateRecordPageControls({customLinks:
                    recordPageLinks.map(item=>item.id===link.id?{...item,visibleWhenValue:event.target.value}:item)})}/></label>}
                <button type="button" className="btn btn-small" aria-label={`Remove record link ${link.label}`}
                  onClick={()=>{if(window.confirm(`Remove ${link.label} from this Record Page draft?`))
                    updateRecordPageControls({customLinks:recordPageLinks.filter(item=>item.id!==link.id)});}}>Remove link</button>
              </details>)}
              <label className="form-label">Link label<input className="form-control" maxLength={200}
                value={newRecordLinkLabel} onChange={event=>setNewRecordLinkLabel(event.target.value)}/></label>
              <label className="form-label">Link URL<input className="form-control" maxLength={2048}
                value={newRecordLinkUrl} onChange={event=>setNewRecordLinkUrl(event.target.value)}
                placeholder="https://example.com or /records/..."/></label>
              <button type="button" className="btn" disabled={!newRecordLinkLabel.trim()||!newRecordLinkUrl.trim()}
                onClick={()=>{
                  updateRecordPageControls({customLinks:[...recordPageLinks,{id:crypto.randomUUID(),
                    label:newRecordLinkLabel.trim(),url:newRecordLinkUrl.trim(),openInNewWindow:false}]});
                  setNewRecordLinkLabel('');setNewRecordLinkUrl('');
                }}>Add record link</button>
              <details className="builder-advanced-panel"><summary>Related list columns and actions</summary>
                <p className="properties-help">Each related list uses this device’s published settings. Field-level permissions are still enforced when records are loaded.</p>
                {relatedListOptions.map(list=>{
                  const child=objects.find(item=>item.fields.some(field=>field.relationship?.targetObject===page.targetObject
                    &&(field.relationship?.childRelationshipName===list.apiName||item.pluralLabel===list.apiName)));
                  const settings=recordPageRelatedSettings[list.apiName]??{};
                  return <section className="metadata-card" key={list.apiName}>
                    <strong>{list.label}</strong>
                    {child&&<div><p className="properties-help">Columns</p>
                      {child.fields.filter(field=>!field.relationship||field.relationship.targetObject!==page.targetObject)
                        .map(field=><label className="checkbox-row" key={field.apiName}>
                          <input type="checkbox"
                            checked={(settings.columns??child.fields.slice(0,4).map(item=>item.apiName)).includes(field.apiName)}
                            onChange={event=>{
                              const current=settings.columns??child.fields.slice(0,4).map(item=>item.apiName);
                              updateRecordPageRelatedList(list.apiName,{columns:event.target.checked
                                ?[...current,field.apiName]:current.filter(name=>name!==field.apiName)});
                            }}/>
                          {field.label}
                        </label>)}
                    </div>}
                    <label className="form-label">Records per page<select className="form-control"
                      value={settings.pageSize??25}
                      onChange={event=>updateRecordPageRelatedList(list.apiName,{pageSize:Number(event.target.value) as 10|25|50})}>
                      <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
                    </select></label>
                    <label className="checkbox-row"><input type="checkbox" checked={settings.showNewAction!==false}
                      onChange={event=>updateRecordPageRelatedList(list.apiName,{showNewAction:event.target.checked})}/>Show New button</label>
                    <label className="checkbox-row"><input type="checkbox" checked={settings.showRowActions===true}
                      onChange={event=>updateRecordPageRelatedList(list.apiName,{showRowActions:event.target.checked})}/>Show row actions</label>
                  </section>;
                })}
              </details>
            </>}
            </>}
            {advancedEditor!=='recordPage' && page.pageType === 'Record Page' && <div className="home-page-assignments">
              <div className="properties-section-title">Where this page appears</div>
              <p className="properties-help">Set the apps, profiles, record types, and form factors that use this Record Page. More specific assignments take precedence over broader defaults.</p>
              {(page.activationAssignments ?? []).map((assignment) => <div className="home-page-assignment" key={assignment.id}>
                <span><strong>{assignment.scope === 'Org Default' ? 'Organization default' : apps.find((app) => app.apiName === assignment.appId)?.label ?? assignment.appId}</strong>
                  <small>{assignment.scope}
                    {assignment.profileId ? ` · ${profiles.find((profile) => profile.id === assignment.profileId)?.label ?? assignment.profileId}` : ''}
                    {assignment.recordTypeId ? ` · ${(targetObject?.recordTypes ?? []).find((recordType) => recordType.id === assignment.recordTypeId)?.label ?? assignment.recordTypeId}` : ''}
                    {` · ${assignment.formFactors.join(', ')}`}
                  </small></span>
                <button className="icon-button subtle" aria-label={`Remove ${assignment.scope} activation assignment`} onClick={() => removePageAssignment(assignment.id)}><Trash2 size={14} /></button>
              </div>)}
              <label className="form-label">Assign as<select className="form-control" value={recordScope} onChange={(event) => setRecordScope(event.target.value as PageActivationAssignmentMetadata['scope'])}>
                <option>Org Default</option><option>App Default</option><option>App and Profile</option>
                {(targetObject?.recordTypes ?? []).some((recordType) => recordType.active) && <option>App, Record Type, and Profile</option>}
              </select></label>
              {recordScope !== 'Org Default' && <label className="form-label">App<select className="form-control" value={recordAppId} onChange={(event) => setRecordAppId(event.target.value)}>
                <option value="">Select an app…</option>{apps.map((app) => <option key={app.apiName} value={app.apiName}>{app.label}</option>)}
              </select></label>}
              {(recordScope === 'App and Profile' || recordScope === 'App, Record Type, and Profile') && <label className="form-label">Profile<select className="form-control" value={recordProfileId} onChange={(event) => setRecordProfileId(event.target.value)}>
                <option value="">Select a profile…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </select></label>}
              {recordScope === 'App, Record Type, and Profile' && <label className="form-label">Record Type<select className="form-control" value={recordTypeId} onChange={(event) => setRecordTypeId(event.target.value)}>
                <option value="">Select a record type…</option>{(targetObject?.recordTypes ?? []).filter((recordType) => recordType.active).map((recordType) => <option key={recordType.id} value={recordType.id}>{recordType.label}</option>)}
              </select></label>}
              <div className="form-label">Devices</div>
              <div className="form-options">{(['Desktop', 'Phone', 'Tablet', 'Custom'] as const).map((factor) => <label className="checkbox-row" key={factor}>
                <input type="checkbox" disabled={(factor==='Desktop'||factor==='Phone')&&!page.devices.includes(factor)} checked={recordFormFactors.includes(factor)}
                  onChange={() => setRecordFormFactors((current) => current.includes(factor) ? current.filter((item) => item !== factor) : [...current, factor])} />
                {factor}
              </label>)}</div>
              <button className="btn btn-full" type="button" onClick={addRecordAssignment}>Add Record Page Assignment</button>
            </div>}
            {advancedEditor!=='recordPage' && page.pageType === 'Home Page' && <div className="home-page-assignments">
              <div className="properties-section-title">Where this page appears</div>
              <p className="properties-help">Assign this Home Page to an app, or to an app and profile.</p>
              {(page.activationAssignments ?? []).map((assignment) => <div className="home-page-assignment" key={assignment.id}>
                <span><strong>{apps.find((app) => app.apiName === assignment.appId)?.label ?? assignment.appId}</strong>
                  <small>{assignment.scope}{assignment.profileId ? ` · ${profiles.find((profile) => profile.id === assignment.profileId)?.label ?? assignment.profileId}` : ''} · {assignment.formFactors.join(', ')}</small></span>
                <button className="icon-button subtle" aria-label="Remove Home Page assignment" onClick={() => removePageAssignment(assignment.id)}><Trash2 size={14} /></button>
              </div>)}
              <label className="form-label">App<select className="form-control" value={homeAppId} onChange={(event) => setHomeAppId(event.target.value)}>
                <option value="">Select an app…</option>{apps.map((app) => <option key={app.apiName} value={app.apiName}>{app.label}</option>)}
              </select></label>
              <label className="form-label">Assign as<select className="form-control" value={homeScope} onChange={(event) => setHomeScope(event.target.value as typeof homeScope)}>
                <option>App Default</option><option>App and Profile</option>
              </select></label>
              {homeScope === 'App and Profile' && <label className="form-label">Profile<select className="form-control" value={homeProfileId} onChange={(event) => setHomeProfileId(event.target.value)}>
                <option value="">Select a profile…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </select></label>}
              <div className="form-label">Devices</div>
              <div className="form-options">{(['Desktop', 'Phone', 'Tablet', 'Custom'] as const).map((factor) => <label className="checkbox-row" key={factor}>
                <input type="checkbox" disabled={(factor==='Desktop'||factor==='Phone')&&!page.devices.includes(factor)} checked={homeFormFactors.includes(factor)}
                  onChange={() => setHomeFormFactors((current) => current.includes(factor) ? current.filter((item) => item !== factor) : [...current, factor])} />
                {factor}
              </label>)}</div>
              <button className="btn btn-full" type="button" onClick={addHomeAssignment}>Add Home Page Assignment</button>
            </div>}
            {advancedEditor!=='assignments' && <p className="properties-help">Device, dimensions and orientation are selected when creating a page. Create another page for a different layout size.</p>}

          </>}
        </aside>, ribbonPropertyHost)}
  </>;
}
