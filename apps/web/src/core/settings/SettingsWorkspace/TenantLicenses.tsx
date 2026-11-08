import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import {useEffect,useState} from 'react';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Entitlement={id:string;label:string;kind:string;enabled:boolean;used_seats:number;seat_limit:number|null;expires_at:string|null};
type Data={entitlements:Entitlement[];users:{id:string;email:string}[];permissionSets:{id:string;api_name:string}[];assignments:{user_id:string;entitlement_id:string}[];requirements:{permission_set_id:string;entitlement_id:string}[]};
export default function TenantLicenses({request,canManage}:{request:Request;canManage:boolean}){
 const [data,setData]=useState<Data|null>(null),[user,setUser]=useState(''),[set,setSet]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=()=>request<Data>('/security/licenses').then(result=>setData({
  entitlements:Array.isArray(result?.entitlements)?result.entitlements:[],
  users:Array.isArray(result?.users)?result.users:[],
  permissionSets:Array.isArray(result?.permissionSets)?result.permissionSets:[],
  assignments:Array.isArray(result?.assignments)?result.assignments:[],
  requirements:Array.isArray(result?.requirements)?result.requirements:[]
 }));
 useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[]);
 const save=(path:string,value:unknown)=>{setBusy(true);setMessage('');void request('/security/licenses/'+path,{method:'PUT',body:JSON.stringify(value)}).then(load).then(()=>setMessage('Saved. Affected user sessions must sign in again.')).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));};
 return <section className="surface permission-section"><h2>User and permission-set licences</h2><p>Licences limit access; permission sets grant access separately. Disabled or expired licences stop access immediately. Only platform administrators can issue licence pools.</p>
  {message&&<p role="status">{message}</p>}{data&&<>
  <ResponsiveDataList rows={data.entitlements} getId={e=>e.id} label="Licence pools"
    columns={[
      {apiName:'label',label:'Licence',phoneRole:'title',render:e=>e.label},
      {apiName:'kind',label:'Type',phoneRole:'subtitle',render:e=>e.kind},
      {apiName:'status',label:'Status',phoneRole:'badge',render:e=>e.enabled?'Enabled':'Disabled'},
      {apiName:'seats',label:'Seats',phoneRole:'trailing',render:e=>e.used_seats+' / '+(e.seat_limit??'Unlimited')},
      {apiName:'expiry',label:'Expires',render:e=>e.expires_at?new Date(e.expires_at).toLocaleDateString():'No expiry'}
    ]}/>
  <div className="md-mobile-table-replaced md-admin-table-wrap" role="region" aria-label="Licence pools" tabIndex={0}><table className="data-table md-admin-table"><thead><tr><th>Licence</th><th>Type</th><th>Seats used</th><th>Expires</th><th>Status</th></tr></thead><tbody>{data.entitlements.map(e=><tr key={e.id}><td>{e.label}</td><td>{e.kind}</td><td>{e.used_seats} / {e.seat_limit??'Unlimited'}</td><td>{e.expires_at?new Date(e.expires_at).toLocaleString():'No expiry'}</td><td>{e.enabled?'Enabled':'Disabled'}</td></tr>)}</tbody></table></div>
  <p className="permission-help">Select a user or permission set, then check the appropriate licence. Each checkbox saves immediately and may require affected users to sign in again.</p>
  <div className="md-admin-licence-assignments"><section className="md-admin-settings-block" aria-label="User licence assignments"><label className="form-label md-admin-field-medium">User<select className="form-control" value={user} onChange={e=>setUser(e.target.value)}><option value="">Select user</option>{data.users.map(u=><option key={u.id} value={u.id}>{u.email}</option>)}</select></label>
  {user&&<div className="md-admin-checkbox-grid">{data.entitlements.map(e=><label className="checkbox-row" key={e.id}><input type="checkbox" disabled={!canManage||busy} checked={data.assignments.some(a=>a.user_id===user&&a.entitlement_id===e.id)} onChange={v=>save('assignment',{user_id:user,entitlement_id:e.id,assigned:v.target.checked})}/>{e.label}</label>)}</div>}</section>
  <section className="md-admin-settings-block" aria-label="Permission-set licence requirements"><label className="form-label md-admin-field-medium">Permission set<select className="form-control" value={set} onChange={e=>setSet(e.target.value)}><option value="">Select permission set</option>{data.permissionSets.map(p=><option key={p.id} value={p.id}>{p.api_name}</option>)}</select></label>
  {set&&<div className="md-admin-checkbox-grid">{data.entitlements.filter(e=>e.kind==='PermissionSet').map(e=><label className="checkbox-row" key={e.id}><input type="checkbox" disabled={!canManage||busy} checked={data.requirements.some(a=>a.permission_set_id===set&&a.entitlement_id===e.id)} onChange={v=>save('requirement',{permission_set_id:set,entitlement_id:e.id,required:v.target.checked})}/>Require {e.label}</label>)}</div>}</section></div>
  </>}
  <PlatformLicenseIssuer request={request}/>
 </section>;
}
function PlatformLicenseIssuer({request}:{request:Request}){
 const [capabilitySearch,setCapabilitySearch]=useState(''),[issuing,setIssuing]=useState(false);
 const [tenants,setTenants]=useState<{id:string;name:string;slug:string}[]>([]),[tenant,setTenant]=useState(''),[label,setLabel]=useState(''),[key,setKey]=useState(''),[kind,setKind]=useState('User'),[seats,setSeats]=useState(''),[expiry,setExpiry]=useState(''),[auto,setAuto]=useState(false),[capabilities,setCapabilities]=useState<{permission_key:string;label:string;resource:string;action:string}[]>([]),[selected,setSelected]=useState<string[]>([]),[message,setMessage]=useState('');
 useEffect(()=>{void request<{tenants:{id:string;name:string;slug:string}[]}>('/security/licenses/tenants').then(r=>setTenants(Array.isArray(r?.tenants)?r.tenants:[])).catch(e=>setMessage('Unable to load tenant licence catalog: '+String(e)));void request<{permissions:typeof capabilities}>('/security/permissions').then(r=>setCapabilities(Array.isArray(r?.permissions)?r.permissions:[])).catch(()=>setCapabilities([]));},[]);
 const [pools,setPools]=useState<Array<Entitlement&{license_key:string;auto_assign:boolean;capabilities:{resource:string;action:string}[]}>>([]),[poolId,setPoolId]=useState(''),[enabled,setEnabled]=useState(true),[customCaps,setCustomCaps]=useState<{resource:string;action:string}[]>([]);
 useEffect(()=>{setPools([]);setPoolId('');if(tenant)void request<{entitlements:typeof pools}>('/security/licenses/tenants?tenant='+encodeURIComponent(tenant)).then(r=>setPools(Array.isArray(r?.entitlements)?r.entitlements:[])).catch(e=>setMessage(String(e)));},[tenant]);
 const validPool=Boolean(tenant.trim()&&label.trim()&&/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key.trim())
  &&(seats===''||(Number.isInteger(Number(seats))&&Number(seats)>=0))
  &&(!expiry||Number.isFinite(Date.parse(expiry))));
 const displayedCapabilities=capabilities.filter(p=>(p.label+' '+p.permission_key).toLowerCase().includes(capabilitySearch.trim().toLowerCase()));
 const chosenCapabilities=selected.includes('*')?[{resource:'*',action:'*'}]
  :capabilities.filter(p=>selected.includes(p.permission_key)).map(p=>({resource:p.resource,action:p.action}));
 const effectiveCapabilities=[...chosenCapabilities,...customCaps];
 const existingPool=pools.find(p=>p.id===poolId);
 const compareCapabilities=(list:Array<{resource:string;action:string}>)=>
  [...new Set(list.map(c=>c.resource+':'+c.action))].sort().join('|');
 const poolChanged=!existingPool||existingPool.label!==label.trim()
  ||existingPool.kind!==kind||existingPool.enabled!==enabled
  ||existingPool.seat_limit!==(seats===''?null:Number(seats))
  ||(existingPool.expires_at?Date.parse(existingPool.expires_at):null)!==(expiry?Date.parse(expiry):null)
  ||existingPool.auto_assign!==auto
  ||compareCapabilities(Array.isArray(existingPool.capabilities)?existingPool.capabilities:[])!==compareCapabilities(effectiveCapabilities);
 const toggleVisible=(add:boolean)=>setSelected(prev=>add?[...new Set([...prev,...displayedCapabilities.map(p=>p.permission_key)])]:prev.filter(k=>!displayedCapabilities.some(p=>p.permission_key===k)));
 const issue=async()=>{
  if(!validPool||!poolChanged||issuing)return;setIssuing(true);setMessage('');
  const caps=effectiveCapabilities;
  try{await request('/security/licenses/issue',{method:'POST',body:JSON.stringify({...(poolId?{id:poolId}:{}),tenantId:tenant,license_key:key.trim(),label:label.trim(),kind,enabled,seat_limit:seats===''?null:Number(seats),expires_at:expiry?new Date(expiry).toISOString():null,auto_assign:auto,capabilities:caps})});
   setMessage('Licence pool saved.');const response=await request<{entitlements:typeof pools}>('/security/licenses/tenants?tenant='+encodeURIComponent(tenant));setPools(Array.isArray(response?.entitlements)?response.entitlements:[]);
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}
  finally{setIssuing(false);}
 };
 if(!tenants.length)return null;
 return <details className="md-admin-issuer"><summary>Platform: issue licence pool</summary><p>For restricted user licences, choose the permitted system operations. Object and field access is still limited by permission sets. A full platform licence permits all resource types.</p>
 <div className="md-admin-form-grid"><label className="form-label">Tenant<select className="form-control" value={tenant} onChange={e=>setTenant(e.target.value)}><option value="">Select tenant</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name||t.slug}</option>)}</select></label>
 <label className="form-label">Licence pool<select className="form-control" value={poolId} onChange={e=>{const p=pools.find(p=>p.id===e.target.value);setPoolId(e.target.value);setKey(p?.license_key??'');setLabel(p?.label??'');setKind(p?.kind??'User');setSeats(p?.seat_limit==null?'':String(p.seat_limit));setExpiry(p?.expires_at?new Date(new Date(p.expires_at).getTime()-new Date(p.expires_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'');setAuto(p?.auto_assign??false);setEnabled(p?.enabled??true);setCustomCaps(p?.capabilities.filter(c=>!(c.resource==='*'&&c.action==='*')&&!capabilities.some(v=>v.resource===c.resource&&v.action===c.action))??[]);setSelected(p?.capabilities.map(c=>c.resource==='*'&&c.action==='*'?'*':capabilities.find(v=>v.resource===c.resource&&v.action===c.action)?.permission_key??'').filter(Boolean)??[]);}}><option value="">New pool</option>{pools.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
 <label className="checkbox-row md-admin-span-all"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enabled</label>
 <label className="form-label">Licence key<input disabled={Boolean(poolId)} className="form-control" value={key} onChange={e=>setKey(e.target.value)}/></label><label className="form-label">Label<input className="form-control" value={label} onChange={e=>setLabel(e.target.value)}/></label>
 <label className="form-label">Type<select className="form-control" disabled={Boolean(poolId)} value={kind} onChange={e=>setKind(e.target.value)}><option>User</option><option>PermissionSet</option></select></label>
 <label className="form-label">Seat limit (blank means unlimited)<input type="number" min="0" className="form-control" value={seats} onChange={e=>setSeats(e.target.value)}/></label>
 <label className="form-label">Expiry (optional)<input type="datetime-local" className="form-control" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
 <label className="checkbox-row md-admin-span-all"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/>Automatically assign new users</label></div>
 <fieldset><legend>Permitted operations (user licence)</legend>
 <label className="form-label">Find permitted operations<input className="form-control" type="search" value={capabilitySearch} placeholder="Search 300+ available permissions" onChange={e=>setCapabilitySearch(e.target.value)}/></label>
 <div className="md-admin-actions">
  <button type="button" className="btn" disabled={!displayedCapabilities.length} onClick={()=>toggleVisible(true)}>Select matching permissions</button>
  <button type="button" className="btn" disabled={!displayedCapabilities.length} onClick={()=>toggleVisible(false)}>Clear matching permissions</button>
  <span>{selected.length} selected</span>
 </div>
 <div className="md-admin-checkbox-grid md-admin-capability-options">{[{permission_key:'*',label:'Full platform resource coverage',resource:'*',action:'*'},...displayedCapabilities].map(p=><label className="checkbox-row" key={p.permission_key}><input type="checkbox" checked={selected.includes(p.permission_key)} onChange={()=>setSelected(selected.includes(p.permission_key)?selected.filter(v=>v!==p.permission_key):[...selected,p.permission_key])}/>{p.label}</label>)}</div></fieldset>
 {customCaps.map((c,i)=><p key={c.resource+':'+c.action}>Additional coverage: {c.resource} / {c.action} <button className="btn" onClick={()=>setCustomCaps(customCaps.filter((_,n)=>n!==i))}>Remove coverage</button></p>)}
 <div className="md-admin-actions"><button type="button" className="btn btn-brand" disabled={!validPool||!poolChanged||issuing} onClick={()=>void issue()}>{issuing?'Saving…':'Save licence pool'}</button></div>{message&&<p role="status">{message}</p>}
 </details>;
}
