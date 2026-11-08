import {useState} from 'react';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import {applyFieldSecurity,type FieldAccess,type FieldAccessLevel} from './fieldSecurityWizard';

export default function FieldSecurityWizard({objects,policyName,fieldPermissions,onApply}:{
 objects:ObjectMetadata[];policyName:string;
 fieldPermissions:Record<string,FieldAccess>;
 onApply:(next:Record<string,FieldAccess>)=>void;
}){
 const [objectApi,setObjectApi]=useState('');
 const [selected,setSelected]=useState<string[]>([]);
 const [level,setLevel]=useState<FieldAccessLevel>('ReadOnly');
 const object=objects.find(item=>item.apiName===objectApi);
 const selectObject=(name:string)=>{setObjectApi(name);setSelected([]);};
 return <details className="permission-field-group">
  <summary>Field Security Wizard — {policyName}</summary>
  <p className="permission-help">Set access for several fields at once.
   Changes enter this permission profile or set; use Save to persist through OneEngine.
   A permission set grant cannot override an explicit server-side denial.</p>
  <div className="settings-grid">
   <label className="form-label">Object<select className="form-control"
    value={objectApi} onChange={e=>selectObject(e.target.value)}>
    <option value="">Choose object</option>
    {objects.map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
   </select></label>
   <label className="form-label">Access<select className="form-control" value={level}
    onChange={e=>setLevel(e.target.value as FieldAccessLevel)}>
    <option value="Hidden">Hidden (no field access)</option>
    <option value="ReadOnly">Read only</option>
    <option value="Edit">Read, create and edit</option>
   </select></label>
  </div>
  {object&&<>
   <div className="toolbar-actions">
    <button className="btn" type="button" onClick={()=>setSelected(object.fields.map(f=>f.apiName))}>
      Select all fields</button>
    <button className="btn" type="button" onClick={()=>setSelected([])}>Clear selection</button>
   </div>
   <div className="permission-check-grid">{object.fields.map(field=>
    <label key={field.apiName} className="checkbox-row">
     <input type="checkbox" checked={selected.includes(field.apiName)}
      onChange={e=>setSelected(cur=>e.target.checked?[...cur,field.apiName]
       :cur.filter(name=>name!==field.apiName))}/>
     {field.label}
    </label>)}</div>
   <button type="button" className="btn btn-brand" disabled={!selected.length}
    onClick={()=>{onApply(applyFieldSecurity(fieldPermissions,object.apiName,selected,level));setSelected([]);}}>
    Apply to {selected.length} selected fields</button>
  </>}
 </details>;
}
