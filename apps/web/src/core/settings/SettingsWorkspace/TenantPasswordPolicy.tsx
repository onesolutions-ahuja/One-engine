import {useEffect,useState} from 'react';
import SettingsViewRow from '../SettingsViewRow/SettingsViewRow';

type Policy={min_length:number;require_uppercase:boolean;require_lowercase:boolean;require_number:boolean;
 require_symbol:boolean;max_age_days:number;history_count:number;max_failed_attempts:number;lockout_minutes:number};
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
const fields:ReadonlyArray<{key:keyof Policy;label:string;min?:number;max?:number}>=[
 {key:'min_length',label:'Minimum password length',min:12,max:128},
 {key:'require_uppercase',label:'Require uppercase letter'},
 {key:'require_lowercase',label:'Require lowercase letter'},
 {key:'require_number',label:'Require number'},
 {key:'require_symbol',label:'Require symbol'},
 {key:'max_age_days',label:'Password lifetime in days (0 disables expiry)',min:0,max:365},
 {key:'history_count',label:'Previous passwords to prevent reusing',min:0,max:24},
 {key:'max_failed_attempts',label:'Failed attempts before lockout',min:3,max:20},
 {key:'lockout_minutes',label:'Lockout duration in minutes',min:1,max:1440}
];
/** Core security settings reuse the shared read-first settings component. */
export default function TenantPasswordPolicy({request,canManage}:{request:Request;canManage:boolean}){
 const [policy,setPolicy]=useState<Policy|null>(null),[draft,setDraft]=useState<Policy|null>(null);
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;
  void request<Policy>('/auth/password-policy').then(p=>{if(active)setPolicy(p);})
   .catch(e=>{if(active)setMessage(e instanceof Error?e.message:String(e));});
  return()=>{active=false;};
 },[request]);
 const policyChanged=Boolean(draft&&policy&&JSON.stringify(draft)!==JSON.stringify(policy));
 const policyValid=Boolean(draft&&fields.every(field=>{const v=draft[field.key];return typeof v==='boolean'||(Number.isInteger(v)&&v>=(field.min??0)&&v<=(field.max??Number.MAX_SAFE_INTEGER));}));
 const strongLength=Boolean(policy&&policy.min_length>=15);
 const recommended=()=>{if(!policy||busy)return;setDraft({...policy,min_length:Math.max(15,policy.min_length),history_count:Math.max(5,policy.history_count),max_failed_attempts:Math.min(policy.max_failed_attempts,5)});setMessage('Review the recommended values, then Save changes if appropriate for your tenant.');};
 const save=async()=>{
  if(!draft||busy||!policyValid||!policyChanged)return;setBusy(true);setMessage('');
  try{setPolicy(await request<Policy>('/auth/password-policy',{method:'PUT',body:JSON.stringify(draft)}));
   setDraft(null);setMessage('Password policy saved.');
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 return <section className="surface permission-section">
  <h2>Password and login policy</h2>
  <p>Tenant-wide rules apply to password changes and recovery. Avoid automatically expiring passwords unless your security policy requires it; review the strength of your configured baseline.</p>
  {policy&&!strongLength&&<div className="info-callout" role="status">
   The current minimum length is {policy.min_length} characters. A longer passphrase baseline (15+ characters) is recommended for password-only authentication.
   {canManage&&<button type="button" className="btn" onClick={recommended} disabled={busy}>Review stronger baseline</button>}
  </div>}
  {policy?<div className={draft?'settings-read-first-section md-admin-password-grid':'settings-read-first-section'}>{fields.map(field=>{
   const value=(draft??policy)[field.key];
   return draft?(typeof value==='boolean'?<label key={field.key} className="checkbox-row md-admin-boolean-option"><input type="checkbox" checked={value} disabled={busy}
     onChange={e=>setDraft({...draft,[field.key]:e.target.checked})}/>{field.label}</label>
     :<label key={field.key} className="form-label md-admin-field-short">{field.label}
      <input className="form-control" type="number" min={field.min} max={field.max} step={1}
       value={value} disabled={busy} onChange={e=>setDraft({...draft,[field.key]:Number(e.target.value)})}/></label>):<SettingsViewRow key={field.key} label={field.label} value={typeof value==='boolean'?(value?'Yes':'No'):value}
    canEdit={canManage} onEdit={()=>{setDraft({...policy});setMessage('');}}/>;
  })}</div>:<p>Loading policy…</p>}
  {draft&&<div className="settings-read-first-toolbar md-recovery-save-bar">
   <span>{policyChanged?'Unsaved password policy changes':'No unsaved changes'}</span>
   <button type="button" className="btn" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button>
   <button type="button" className="btn btn-brand" disabled={busy||!policyValid||!policyChanged} onClick={()=>void save()}>{busy?'Saving…':'Save changes'}</button>
  </div>}
  {draft&&!policyValid&&<p className="form-error" role="alert">Check all numeric policy limits before saving.</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
