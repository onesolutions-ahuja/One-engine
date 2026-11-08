import type {FieldMetadata,QuickActionComponentBinding} from '../../metadata/Definitions/metadata';

export default function QuickActionBindingsEditor({
 bindings,onChange,scope,fields=[]
}:{
 bindings:QuickActionComponentBinding[];
 onChange:(bindings:QuickActionComponentBinding[])=>void;
 scope:'object'|'global';
 fields?:FieldMetadata[];
}){
 const update=(index:number,partial:Partial<QuickActionComponentBinding>)=>
   onChange(bindings.map((item,i)=>i===index?{...item,...partial}:item));
 return <div className="metadata-card" aria-label="Component input bindings">
   <div className="section-toolbar">
     <div><strong>Component inputs</strong>
       <p>Connect component properties to values without writing code.</p>
     </div>
     <button type="button" className="btn" disabled={bindings.length>=20}
       onClick={()=>onChange([...bindings,{property:'',source:'Literal',value:''}])}>
       Add input
     </button>
   </div>
   {bindings.map((item,index)=><div className="record-type-create" key={index}>
     <input className="form-control" aria-label={`Component input property ${index+1}`}
       placeholder="Component property" maxLength={64} value={item.property}
       onChange={event=>update(index,{property:event.target.value})}/>
     <select className="form-control" aria-label={`Component input source ${index+1}`}
       value={item.source} onChange={event=>onChange(bindings.map((b,i)=>i!==index?b:
         {property:b.property,source:event.target.value as QuickActionComponentBinding['source'],
           ...(event.target.value==='Literal'?{value:''}:{}),
           ...(event.target.value==='Record Field'?{fieldApiName:''}:{})}))}>
       <option value="Literal">Fixed value</option>
       {scope==='object'&&<option value="Record ID">Current record ID</option>}
       {scope==='object'&&<option value="Object API">Current Object</option>}
       {scope==='object'&&<option value="Record Field">Record field</option>}
     </select>
     {item.source==='Literal'&&<input className="form-control"
       aria-label={`Component input value ${index+1}`} placeholder="Value"
       maxLength={1000} value={item.value??''}
       onChange={event=>update(index,{value:event.target.value})}/>}
     {item.source==='Record Field'&&scope==='object'&&<select className="form-control"
       aria-label={`Component input field ${index+1}`} value={item.fieldApiName??''}
       onChange={event=>update(index,{fieldApiName:event.target.value})}>
       <option value="">Select readable field</option>
       {fields.filter(f=>f.dataType.toLowerCase()!=='encryptedtext').map(f=>
         <option key={f.apiName} value={f.apiName}>{f.label}</option>)}
     </select>}
     <button type="button" className="btn"
       aria-label={`Remove component input ${index+1}`}
       onClick={()=>onChange(bindings.filter((_,i)=>i!==index))}>Remove</button>
   </div>)}
 </div>;
}
