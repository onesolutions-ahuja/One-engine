import {useState} from 'react';
import type {PermissionSetMetadata} from '../../metadata/Definitions/metadata';
// Use the shared metadata contract so patches are valid for both profiles and permission sets.
type Policy=Pick<PermissionSetMetadata,'systemPermissions'|'deniedPermissions'|'advancedRules'|'objectPermissions'|'fieldPermissions'>;
export default function AdvancedPermissionRules({policy,onChange,systemPermissionKeys,actionOptions=[]}:{policy:Policy;systemPermissionKeys:string[];onChange:(patch:Partial<Policy>)=>void;actionOptions?:Array<{resource:string;label:string}>}){
 const [resource,setResource]=useState(''),[action,setAction]=useState('read'),[effect,setEffect]=useState<'allow'|'deny'>('deny');
 const controlled=(token:string)=>policy.systemPermissions.includes('*:*')&&(systemPermissionKeys.includes(token)||
  Object.hasOwn(policy.objectPermissions??{},token.slice(0,token.lastIndexOf(':')))||
  Object.hasOwn(policy.fieldPermissions??{},token.slice(0,token.lastIndexOf(':')))||/^(RecordType:|App:|Tab:)/.test(token));
 const add=()=>{
  if(!resource.trim()||!action.trim())return;
  onChange({advancedRules:[...(policy.advancedRules??[]).filter(r=>r.resource!==resource.trim()||r.action!==action.trim()),
   {resource:resource.trim(),action:action.trim(),effect}]});
  setResource('');
 };
 return <section aria-label="Advanced permission rules">
  <h3 className="permission-section-heading">Advanced permission rules</h3>
  <p className="permission-help">Explicit denials take precedence over all grants. Changing your own assignments or increasing your own effective access is blocked. A second authorized administrator can restore a revoked permission.</p>
  <label className="checkbox-row"><input type="checkbox" checked={policy.systemPermissions.includes('*:*')}
   onChange={e=>onChange({systemPermissions:e.target.checked?[...policy.systemPermissions,'*:*']:policy.systemPermissions.filter(p=>p!=='*:*')})}/>
   Full starting access, with individual restrictions</label>
  {(policy.deniedPermissions??[]).map(token=><div key={token} className="settings-row">
   <span>Deny {token}</span><button type="button" className="btn" disabled={controlled(token)} title={controlled(token)?'Restore with the corresponding permission checkbox':'Remove explicit denial'}
    onClick={()=>onChange({deniedPermissions:policy.deniedPermissions?.filter(p=>p!==token)})}>Remove explicit denial</button>
  </div>)}
  {(policy.advancedRules??[]).map((r,index)=><div key={r.resource+':'+r.action} className="settings-row">
   <span>{r.effect} {r.resource} / {r.action}</span><button type="button" className="btn"
    onClick={()=>onChange({advancedRules:policy.advancedRules?.filter((_,i)=>i!==index)})}>Remove rule</button>
  </div>)}
  <p className="permission-help">For restrictions on full starting access, restore the corresponding checkbox above. Resource and action names also support existing custom Flow and record policies.</p>
  <div className="permission-form-grid">
   {actionOptions.length>0&&<label className="form-label">Quick Action permission
     <select className="form-control" aria-label="Choose Quick Action permission" value=""
       onChange={event=>{if(!event.target.value)return;setResource(event.target.value);setAction('execute');}}>
       <option value="">Choose configured Action</option>
       {actionOptions.map(option=><option value={option.resource} key={option.resource}>{option.label}</option>)}
     </select>
   </label>}
   <label className="form-label">Resource<input className="form-control" value={resource} onChange={e=>setResource(e.target.value)} placeholder="Flow:Checkout"/></label>
   <label className="form-label">Action<input className="form-control" value={action} onChange={e=>setAction(e.target.value)} list="rbac-actions"/>
    <datalist id="rbac-actions">{['read','create','edit','delete','execute','manage','viewAll','modifyAll'].map(a=><option key={a} value={a}/>)}</datalist></label>
   <label className="form-label">Effect<select className="form-control" value={effect} onChange={e=>setEffect(e.target.value as 'allow'|'deny')}>
    <option value="deny">Deny</option><option value="allow">Allow</option></select></label>
   <button type="button" className="btn" disabled={!resource.trim()||!action.trim()} onClick={add}>Add permission rule</button>
  </div>
 </section>;
}
