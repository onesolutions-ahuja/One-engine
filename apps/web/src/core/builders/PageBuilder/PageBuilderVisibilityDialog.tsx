import {createPortal} from 'react-dom';
import type {FieldMetadata} from '../../metadata/Definitions/metadata';
import {validateVisibilityRule,type ComponentVisibilityRule} from '../../components/Properties/componentVisibility';
import ComponentVisibilityEditor from '../ComponentProperties/ComponentVisibilityEditor';

/** Reuses the same filter-dialog presentation as RecordFilterEditor, while
 * retaining the dedicated runtime visibility-rule contract. */
export default function PageBuilderVisibilityDialog({
  label,rules,onChange,fields,allowRecordFields,profiles,recordTypes,onApply,onClose
}:{
  label:string;
  rules:ComponentVisibilityRule|undefined;
  onChange:(rules:ComponentVisibilityRule|undefined)=>void;
  fields:FieldMetadata[];
  allowRecordFields:boolean;
  profiles:Array<{id:string;label:string}>;
  recordTypes:Array<{id:string;label:string}>;
  onApply:()=>void;
  onClose:()=>void;
}){
  const invalid=validateVisibilityRule(rules,fields,allowRecordFields).length>0;
  return createPortal(<div className="smart-dialog-backdrop smart-filter-backdrop"
    role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)onClose();}}>
    <section className="smart-dialog smart-filter-dialog" role="dialog" aria-modal="true"
      aria-label="Conditional visibility filters" onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
      <header><div><strong>Conditional Visibility</strong>
        <span>{label} · Show the component when conditions match</span></div>
        <div className="page-builder-visibility-modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" autoFocus disabled={invalid} onClick={onApply}>Apply</button>
        </div></header>
      <div className="smart-filter-dialog-body">
        <ComponentVisibilityEditor rules={rules} onChange={onChange} fields={fields}
          allowRecordFields={allowRecordFields} profiles={profiles} recordTypes={recordTypes}/>
      </div>
    </section></div>,document.body);
}
