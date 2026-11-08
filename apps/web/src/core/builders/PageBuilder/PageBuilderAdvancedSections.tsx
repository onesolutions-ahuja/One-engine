import {useEffect,useState} from 'react';
import type {AdvancedFeature} from './PageBuilderAdvancedRibbon';

type Option={value:string;label:string};
type Assignment={
  enabled:boolean;assigned:boolean;isDefault:boolean;
  onAdd:()=>void;
};
type Properties={
  selected:boolean;nameEditable:boolean;apiName:string;instanceName:string;visible:boolean;
  validateInstanceName:(value:string)=>string|null;
  onInstanceName:(value:string)=>void;
  readOnly:boolean;canReadOnly:boolean;
  onVisible:(value:boolean)=>void;onReadOnly:(value:boolean)=>void;
};
type Nesting={
  accepted:boolean;canChange:boolean;onAccepted:(value:boolean)=>void;
};
/** Switch the open device layout, or fill it from another layout. */
type LayoutSwitch={
  current:string;options:Option[];busy:boolean;
  onSwitch:(variant:string)=>void;
  copySource:string;onCopySource:(variant:string)=>void;onCopy:()=>void;
};
type Props={
  section:AdvancedFeature|null;onInspectorHost:(node:HTMLDivElement|null)=>void;
  assignment:Assignment;properties:Properties;nesting:Nesting;layout?:LayoutSwitch;
};

/** Advanced contains only component controls and a link to page activation.
 * Page device eligibility belongs to Edit Page; component columns and custom
 * viewport breakpoints retain their dedicated metadata editors. */
export default function PageBuilderAdvancedSections({
  onInspectorHost,assignment,properties,nesting,layout
}:Props){
  // The former Advanced editor portalled the entire inspector into the ribbon.
  // Never leave a stale portal attached after switching from another tab.
  useEffect(()=>onInspectorHost(null),[onInspectorHost]);
  const [nameDraft,setNameDraft]=useState(properties.instanceName);
  const [nameTouched,setNameTouched]=useState(false);
  useEffect(()=>{setNameDraft(properties.instanceName);setNameTouched(false);},[properties.instanceName]);
  const nameError=properties.selected&&nameDraft!==properties.instanceName
    ?properties.validateInstanceName(nameDraft):null;
  const commitName=()=>{
    if(!properties.nameEditable||nameDraft===properties.instanceName)return;
    setNameTouched(true);
    if(nameError)return;
    properties.onInstanceName(nameDraft.trim());
  };
  return <div className="page-builder-advanced-inline" aria-label="Advanced ribbon fixed sections">
    {assignment.enabled&&<section className="advanced-fixed-group advanced-activation" aria-label="Activation Assignments">
      <div className="advanced-fixed-field advanced-assigned">
        <label><input type="checkbox" checked={assignment.assigned} readOnly disabled
          title="Shows whether the page has activation assignments"/>Assigned</label>
        <button type="button" disabled={!assignment.enabled} onClick={assignment.onAdd}
          title="Edit activation assignments in Page Properties" aria-label="Edit activation assignments">Edit</button>
      </div>
      <label className="advanced-fixed-field advanced-default">Default
        <input type="checkbox" checked={assignment.isDefault} readOnly disabled
          title="Default assignment status is edited in Page Properties"/>
      </label>
      <span className="advanced-fixed-caption">Activation Assignments</span>
    </section>}
    <section className="advanced-fixed-group advanced-properties" aria-label="Advanced Properties">
      <label className="advanced-fixed-field advanced-api-name">API Name
        <input value={properties.apiName} readOnly disabled title="Component API identity is immutable"/>
      </label>
      <label className="advanced-fixed-field advanced-visible">Visible
        <input type="checkbox" checked={properties.visible} disabled={!properties.selected}
          onChange={event=>properties.onVisible(event.target.checked)}/>
      </label>
      <label className="advanced-fixed-field advanced-readonly">Readonly
        <input type="checkbox" checked={properties.readOnly} disabled={!properties.canReadOnly}
          onChange={event=>properties.onReadOnly(event.target.checked)}/>
      </label>
      <span className="advanced-fixed-caption">Advanced Properties</span>
    </section>
    <section className="advanced-fixed-group advanced-nesting" aria-label="Component Nesting">
      <label className="advanced-fixed-field advanced-accept">Accept nested components
        <input type="checkbox" checked={nesting.accepted}
          disabled={!nesting.canChange} onChange={event=>nesting.onAccepted(event.target.checked)}/>
      </label>
      <span className="advanced-fixed-caption">Component Nesting</span>
    </section>
    <section className="advanced-fixed-group advanced-technical" aria-label="Component Identity">
      <label className="advanced-fixed-field advanced-component-name">Component Name
        <input aria-label="Component Name" value={nameDraft} maxLength={80}
          disabled={!properties.nameEditable} spellCheck={false}
          aria-invalid={!!nameError}
          aria-describedby={nameError&&nameTouched?'component-name-validation':undefined}
          title="Unique name on this page, also used by component CSV export and upload"
          onChange={event=>{setNameDraft(event.target.value);setNameTouched(true);}}
          onBlur={commitName}
          onKeyDown={event=>{
            if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
            if(event.key==='Escape'){event.preventDefault();setNameDraft(properties.instanceName);setNameTouched(false);}
          }}/>
      </label>
      {nameError&&nameTouched&&<span id="component-name-validation" role="alert"
        className="advanced-component-name-error">{nameError}</span>}
      <span className="advanced-fixed-caption">Component Identity</span>
    </section>
    {layout&&<section className="advanced-fixed-group advanced-layout" aria-label="Device Layout">
      <label className="advanced-fixed-field advanced-layout-open">Layout
        <select aria-label="Open device layout" value={layout.current} disabled={layout.busy}
          title="Switch the layout you are designing. Save first: unsaved edits are not carried over."
          onChange={event=>layout.onSwitch(event.target.value)}>
          {layout.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="advanced-fixed-field advanced-layout-copy">Copy from
        <select aria-label="Copy components from layout" value={layout.copySource} disabled={layout.busy}
          title="Fill this layout with another layout’s components (unsaved, undoable)"
          onChange={event=>layout.onCopySource(event.target.value)}>
          <option value="">Choose…</option>
          {layout.options.filter(option=>option.value!==layout.current)
            .map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" aria-label="Copy layout components" disabled={layout.busy||!layout.copySource}
          onClick={layout.onCopy}>Copy</button>
      </label>
      <span className="advanced-fixed-caption">Device Layout</span>
    </section>}
  </div>;
}
