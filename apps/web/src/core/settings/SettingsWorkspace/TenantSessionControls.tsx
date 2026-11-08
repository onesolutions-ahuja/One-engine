import {useEffect,useState} from 'react';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Policy={access_minutes:number;refresh_minutes:number;idle_minutes:number;require_mfa:boolean;frame_policy:'DENY'|'SAMEORIGIN';csp_enabled:boolean};
type Range={profile_id:string|null;kind:'login'|'trusted';network:string};
type Hours={profile_id:string|null;weekday:number;start_minute:number;end_minute:number;timezone:string};
type Settings={policy:Policy;ranges:Range[];hours:Hours[];profiles:Array<{id:string;label:string}>};
const time=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const minute=(s:string)=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
export default function TenantSessionControls({request,canManage}:{request:Request;canManage:boolean}){
 const [value,setValue]=useState<Settings|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const load=()=>request<Settings>('/auth/session-policy').then(setValue);
 useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[]);
 if(!value)return <section className="surface permission-section"><h2>Session and login restrictions</h2><p role="status">{message||'Loading…'}</p></section>;
 const scope=(id:string|null,onChange:(id:string|null)=>void)=><label className="form-label">Applies to<select className="form-control" disabled={!editing||busy} value={id??''} onChange={e=>onChange(e.target.value||null)}>
  <option value="">Whole tenant</option>{value.profiles.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>;
 return <section className="surface permission-section"><h2>Session and login restrictions</h2>
  <p>Tenant and profile restrictions both apply. A scope with no rules allows all IPs or hours; trusted ranges never override a restriction or MFA.</p>
  <div className="md-admin-form-grid md-admin-form-grid--3">{(['access_minutes','refresh_minutes','idle_minutes'] as const).map((key,i)=><label className="form-label" key={key}>
   {['Access token lifetime (minutes)','Maximum sign-in lifetime (minutes)','Inactivity timeout (minutes)'][i]}
   <input className="form-control" type="number" min={5} max={key==='refresh_minutes'?43200:1440} disabled={!editing||busy} value={value.policy[key]}
    onChange={e=>setValue({...value,policy:{...value.policy,[key]:Number(e.target.value)}})}/></label>)}</div>
  <label className="checkbox-row"><input type="checkbox" disabled={!editing||busy} checked={value.policy.require_mfa} onChange={e=>setValue({...value,policy:{...value.policy,require_mfa:e.target.checked}})}/>Require MFA assurance for every session</label>
  <label className="form-label md-admin-field-medium">Page framing<select className="form-control" disabled={!editing||busy} value={value.policy.frame_policy} onChange={e=>setValue({...value,policy:{...value.policy,frame_policy:e.target.value as Policy['frame_policy']}})}>
   <option value="DENY">Deny framing</option><option value="SAMEORIGIN">Same origin only</option></select></label>
  <label className="checkbox-row"><input type="checkbox" disabled={!editing||busy} checked={value.policy.csp_enabled} onChange={e=>setValue({...value,policy:{...value.policy,csp_enabled:e.target.checked}})}/>Enable Content Security Policy</label>
  <h3>Login and trusted IP ranges</h3>
  {value.ranges.map((r,i)=><div key={i} className="settings-edit-row md-admin-restriction-grid">
   {scope(r.profile_id,id=>setValue({...value,ranges:value.ranges.map((v,n)=>n===i?{...v,profile_id:id}:v)}))}
   <label className="form-label">Range type<select className="form-control" disabled={!editing||busy} value={r.kind} onChange={e=>setValue({...value,ranges:value.ranges.map((v,n)=>n===i?{...v,kind:e.target.value as Range['kind']}:v)})}><option value="login">Allowed login range</option><option value="trusted">Trusted range</option></select></label>
   <label className="form-label">IP or CIDR range<input className="form-control" disabled={!editing||busy} placeholder="203.0.113.0/24" value={r.network} onChange={e=>setValue({...value,ranges:value.ranges.map((v,n)=>n===i?{...v,network:e.target.value}:v)})}/></label>
   {editing&&<button type="button" className="btn" onClick={()=>setValue({...value,ranges:value.ranges.filter((_,n)=>n!==i)})}>Remove range</button>}
  </div>)}
  {editing&&<div className="md-admin-actions"><button type="button" className="btn" onClick={()=>setValue({...value,ranges:[...value.ranges,{profile_id:null,kind:'login',network:''}]})}>Add IP range</button></div>}
  <h3>Allowed login hours</h3>
  <p>Each row allows one day and time window in its named time zone. End 24:00 means midnight; split overnight windows across two days.</p>
  {value.hours.map((h,i)=>{
   const update=(patch:Partial<Hours>)=>setValue({...value,hours:value.hours.map((v,n)=>n===i?{...v,...patch}:v)});
   return <div className="settings-edit-row md-admin-restriction-grid md-admin-restriction-hours" key={i}>{scope(h.profile_id,id=>update({profile_id:id}))}
    <label className="form-label">Day<select className="form-control" disabled={!editing||busy} value={h.weekday} onChange={e=>update({weekday:Number(e.target.value)})}>{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d,n)=><option key={d} value={n+1}>{d}</option>)}</select></label>
    <label className="form-label">From (HH:MM)<input className="form-control" disabled={!editing||busy} defaultValue={time(h.start_minute)} onBlur={e=>update({start_minute:minute(e.target.value)})}/></label>
    <label className="form-label">Until (HH:MM)<input className="form-control" disabled={!editing||busy} defaultValue={time(h.end_minute)} onBlur={e=>update({end_minute:minute(e.target.value)})}/></label>
    <label className="form-label">Time zone<input className="form-control" disabled={!editing||busy} value={h.timezone} onChange={e=>update({timezone:e.target.value})}/></label>
    {editing&&<button type="button" className="btn" onClick={()=>setValue({...value,hours:value.hours.filter((_,n)=>n!==i)})}>Remove hours</button>}
   </div>;
  })}
  {editing&&<div className="md-admin-actions"><button type="button" className="btn" onClick={()=>setValue({...value,hours:[...value.hours,{profile_id:null,weekday:1,start_minute:540,end_minute:1020,timezone:'Europe/London'}]})}>Add login hours</button></div>}
  {canManage&&!editing&&<button type="button" className="btn" onClick={()=>setEditing(true)}>Edit restrictions</button>}
  {editing&&<><button type="button" className="btn" disabled={busy} onClick={()=>{setEditing(false);void load();}}>Cancel</button>
   <button type="button" className="btn btn-brand" disabled={busy} onClick={()=>{
    setBusy(true);setMessage('');void request<Settings>('/auth/session-policy',{method:'PUT',body:JSON.stringify({policy:value.policy,ranges:value.ranges,hours:value.hours})})
     .then(v=>{setValue(v);setEditing(false);setMessage('Policy saved. Login restrictions apply immediately.');})
     .catch(e=>setMessage(e instanceof Error?e.message:String(e))).finally(()=>setBusy(false));
   }}>Save restrictions</button></>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
