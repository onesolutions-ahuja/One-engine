import type {FlowDefinitionMetadata,FlowResourceMetadata} from '../../metadata/Definitions/metadata';
import {getSubflowMapping,setSubflowMapping} from './flowSubflowMappings';

type Props={
  selectedFlowApiName:string;
  flows:FlowDefinitionMetadata[];
  parentResources:FlowResourceMetadata[];
  inputValues:unknown;
  outputValues:unknown;
  onChange:(key:'inputValues'|'outputValues',value:string)=>void;
};

export default function FlowSubflowMappingEditor({
  selectedFlowApiName,flows,parentResources,inputValues,outputValues,onChange
}:Props){
  const child=flows.find(flow=>flow.apiName===selectedFlowApiName
    &&flow.flowType==='Autolaunched Flow'&&flow.status==='Active');
  const scalarParent=parentResources.filter(resource=>!resource.isCollection
    &&resource.type!=='Record'&&resource.type!=='Record Collection');
  const outputParents=scalarParent.filter(resource=>resource.type==='Variable');
  if(!child)return <p className="info-callout">Choose an active Autolaunched Flow to configure its input and output mappings.</p>;
  const inputs=child.resources.filter(resource=>resource.availableForInput&&!resource.isCollection
    &&resource.type!=='Record'&&resource.type!=='Record Collection');
  const outputs=child.resources.filter(resource=>resource.availableForOutput&&!resource.isCollection
    &&resource.type!=='Record'&&resource.type!=='Record Collection');
  return <>
    <h3>Input Mappings</h3>
    {inputs.length===0&&<p className="settings-panel-copy">The selected flow does not expose scalar input resources.</p>}
    {inputs.map(resource=><label className="form-label" key={'in-'+resource.name}>
      {resource.label} ({resource.name})
      <select className="form-control" aria-label={'Subflow input '+resource.name}
        value={getSubflowMapping(inputValues,resource.name)}
        onChange={event=>onChange('inputValues',
          setSubflowMapping(inputValues,resource.name,event.target.value))}>
        <option value="">Leave unmapped</option>
        {scalarParent.filter(parent=>parent.dataType===resource.dataType)
          .map(parent=><option key={parent.name} value={'{!'+parent.name+'}'}>
            {parent.label} ({parent.name})
          </option>)}
      </select>
    </label>)}
    <h3>Output Mappings</h3>
    {outputs.length===0&&<p className="settings-panel-copy">The selected flow does not expose scalar output resources.</p>}
    {outputs.map(resource=><label className="form-label" key={'out-'+resource.name}>
      {resource.label} ({resource.name})
      <select className="form-control" aria-label={'Subflow output '+resource.name}
        value={getSubflowMapping(outputValues,resource.name)}
        onChange={event=>onChange('outputValues',
          setSubflowMapping(outputValues,resource.name,event.target.value))}>
        <option value="">Do not assign output</option>
        {outputParents.filter(parent=>parent.dataType===resource.dataType)
          .map(parent=><option key={parent.name} value={parent.name}>
            {parent.label} ({parent.name})
          </option>)}
      </select>
    </label>)}
    <p className="settings-panel-copy">
      Only scalar resources with matching data types are listed. Mark child resources
      available for input or output in the child Flow's Manager, and create matching
      parent variables before configuring mappings.
    </p>
  </>;
}
