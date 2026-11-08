import { Plus, X } from 'lucide-react';
import FlowReferenceInput from '../FlowReferenceInput/FlowReferenceInput';
import { rowsFrom, displayValue, type ConfigRow } from './flowEditorData';
import type { FieldMetadata, FlowDefinitionMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';

type Common={flow:FlowDefinitionMetadata;elementId:number;objects:ObjectMetadata[]};
export function FlowConditionRows({flow,elementId,objects,rows,fields,onChange}:Common & {
 rows:ConfigRow[];fields:FieldMetadata[];onChange:(value:ConfigRow[])=>void;
}){
 const change=(index:number,patch:Partial<ConfigRow>)=>onChange(rows.map((r,i)=>i===index?{...r,...patch}:r));
 const selected=flow.elements.find(element=>element.id===elementId);
 const targetObjectApiName=typeof selected?.config.object==='string' ? selected.config.object : flow.triggerObject??undefined;
 const idField:FieldMetadata={apiName:'Id',label:'Record ID',dataType:'Id',required:true,unique:true};
 const ownerField:FieldMetadata={apiName:'OwnerId',label:'Owner',dataType:'Id',required:false,unique:false};
 return <div className="flow-config-list">
  {rows.map((condition,index)=><div className="flow-config-row" key={index}>
    <select className="form-control" aria-label="Condition field" value={displayValue(condition.field)}
      onChange={event=>change(index,{field:event.target.value})}>
      <option value="">Select field or resource</option>
      <optgroup label="Record Fields">{!fields.some(field=>field.apiName==='Id') && <option value="Id">Record ID</option>}{!fields.some(field=>field.apiName==='OwnerId') && <option value="OwnerId">Owner</option>}{fields.map(field=>
        <option key={field.apiName} value={field.apiName}>{field.label}</option>)}</optgroup>
      <optgroup label="Flow Resources">{flow.resources.map(resource=>
        <option key={resource.name} value={`{${resource.name}}`}>{resource.label}</option>)}</optgroup>
    </select>
    <select className="form-control" aria-label="Condition operator"
      value={displayValue(condition.operator)||'Equals'}
      onChange={event=>change(index,{operator:event.target.value,
        ...(['Is Changed','Was Set'].includes(event.target.value)?{value:''}:{})})}>
      {['Equals','Not Equals','Is Null','Is Not Null','Greater Than','Less Than','Contains','Starts With',
        ...(flow.flowType==='Record-Triggered Flow'?['Is Changed','Was Set']:[])]
        .map(operator=><option key={operator}>{operator}</option>)}
    </select>
    {!['Is Null','Is Not Null','Is Changed','Was Set'].includes(String(condition.operator)) &&
      <FlowReferenceInput ariaLabel="Condition value" value={displayValue(condition.value)}
        flow={flow} elementId={elementId} objects={objects}
        field={fields.find(field=>field.apiName===condition.field)??(condition.field==='Id'?idField:condition.field==='OwnerId'?ownerField:undefined)}
        targetObjectApiName={targetObjectApiName}
        onChange={value=>change(index,{value})}/>}
    <button type="button" className="row-menu" aria-label="Remove condition"
      onClick={()=>onChange(rows.filter((_,i)=>i!==index))}><X size={14}/></button>
  </div>)}
  <button type="button" className="text-action"
    onClick={()=>onChange([...rows,{field:'',operator:'Equals',value:''}])}><Plus size={13}/>Add Condition</button>
 </div>;
}
export function FlowFieldAssignments({flow,elementId,objects,object,config,onChange}:Common & {
 object?:ObjectMetadata;config:Record<string,unknown>;onChange:(value:ConfigRow[])=>void;
}) {
 const stored=rowsFrom(config.fieldValues);
 const rows=stored.length?stored:typeof config.field==='string'?[{field:config.field,value:config.value}]:[];
 const change=(index:number,patch:Partial<ConfigRow>)=>onChange(rows.map((r,i)=>i===index?{...r,...patch}:r));
 return <div className="flow-config-list">
   {rows.map((assignment,index)=><div className="flow-config-row" key={index}>
     <select className="form-control" aria-label="Field to assign" value={displayValue(assignment.field)}
       onChange={event=>change(index,{field:event.target.value})}>
       <option value="">Select field</option>{object?.fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
     </select>
     <FlowReferenceInput ariaLabel="Assigned value" value={displayValue(assignment.value)}
       flow={flow} elementId={elementId} objects={objects}
       field={object?.fields.find(field=>field.apiName===assignment.field)}
       onChange={value=>change(index,{value})}/>
     <button type="button" className="row-menu" aria-label="Remove field value"
       onClick={()=>onChange(rows.filter((_,i)=>i!==index))}><X size={14}/></button>
   </div>)}
   <button type="button" className="text-action"
     onClick={()=>onChange([...rows,{field:'',value:''}])}><Plus size={13}/>Add Field</button>
 </div>;
}
