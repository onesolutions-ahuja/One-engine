import React,{useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {MobileSheet} from '../../workspace/SetupShell/MobileSheet';
import './ObjectPermissionPhoneList.css';
export type ObjectPermission='read'|'create'|'edit'|'delete'|'viewAll'|'modifyAll';
const permissions:ReadonlyArray<{key:ObjectPermission;label:string}>=[
 {key:'read',label:'Read'},{key:'create',label:'Create'},{key:'edit',label:'Edit'},
 {key:'delete',label:'Delete'},{key:'viewAll',label:'View All'},{key:'modifyAll',label:'Modify All'}
];
export function ObjectPermissionPhoneList({objects,values,onToggle,subject}:{
 objects:readonly {apiName:string;label:string}[];
 values:Record<string,Partial<Record<ObjectPermission,boolean>>>;
 onToggle:(objectApi:string,permission:ObjectPermission)=>void;
 subject:string;
}) {
 const [open,setOpen]=useState<string|null>(null);
 const target=objects.find(o=>o.apiName===open);
 return <div className="permission-phone-object-list">
  <div className="permission-phone-inset-list">
   {objects.map(object=>{
     const grants=permissions.filter(p=>values[object.apiName]?.[p.key]).length;
     return <button key={object.apiName} type="button" className="permission-phone-object" onClick={()=>setOpen(object.apiName)}
       aria-haspopup="dialog" aria-label={'Edit '+subject+' permissions for '+object.label}>
       <span><strong>{object.label}</strong><small>{object.apiName}</small></span>
       <small>{grants} / {permissions.length}</small><ChevronRight size={20} aria-hidden="true"/>
     </button>;
   })}
  </div>
  {target&&<MobileSheet title={target.label+' permissions'} onClose={()=>setOpen(null)}>
    <p className="permission-phone-help">Changes to {subject} still use the existing OneEngine permission controls.</p>
    <div className="permission-phone-switches">
     {permissions.map(p=><label key={p.key}>
       <span>{p.label}</span><input type="checkbox" role="switch"
         aria-label={subject+' '+target.label+' '+p.label}
         checked={Boolean(values[target.apiName]?.[p.key])}
         onChange={()=>onToggle(target.apiName,p.key)}/>
     </label>)}
    </div>
  </MobileSheet>}
 </div>;
}
