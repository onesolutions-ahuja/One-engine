import {metadataReference,metadataSelection} from '../../../metadata/Definitions/metadataReferences';
import type {ObjectMetadata} from '../../../metadata/Definitions/metadata';
export default function ObjectFieldMapPropertyEditor({id,label,value,disabled,fields,name,onChange}:{id:string;label:string;value:unknown;disabled:boolean;fields:readonly ObjectMetadata['fields'][number][];name:string;onChange:(value:string)=>void}){
 return <label className="form-label" htmlFor={id}>{label}<select id={id} className="form-control" disabled={disabled} value={metadataSelection(fields,value)?.apiName??String(value??'')} onChange={event=>{const field=fields.find(item=>item.apiName===event.target.value);onChange(field?.id?metadataReference(field.id):event.target.value)}}>
 <option value="">Select field…</option>{(name==='optionValueFieldApiName'||name==='recordValueFieldApiName')&&<option value="Id">Record ID</option>}{fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
 </select></label>;
}
