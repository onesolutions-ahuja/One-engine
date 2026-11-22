import {useEffect,useState} from 'react';
import {RECEIPT_SETTINGS} from '../../../../../server/src/system-support/company-receipt-settings';
import {refreshTenantBrand} from '../../branding/tenantBrandLoader';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Profile=Record<string,unknown>;
/** Company Settings → Receipts. Saved with the company profile; page formulas read each value
 * as @ThisTenant.Company.<Key> (receipt templates, pay actions, cash rounding, card surcharge). */
export default function ReceiptSettings({request}:{request:Request}){
 const [profile,setProfile]=useState<Profile|null>(null);
 const [draft,setDraft]=useState<Profile>({});
 const [editing,setEditing]=useState(false);
 const [status,setStatus]=useState('');
 const [saving,setSaving]=useState(false);
 const load=async()=>{
  try{const value=await request<{profile:Profile|null}>('/tenant/company-profile');setProfile(value.profile??{});setStatus('');}
  catch(error){setStatus(error instanceof Error?error.message:String(error));}
 };
 useEffect(()=>{void load();},[request]);
 const save=async()=>{
  if(!profile)return;
  setSaving(true);setStatus('');
  try{
   const body:Profile={...profile};
   for(const setting of RECEIPT_SETTINGS){
    const value=draft[setting.key];
    if(value===undefined||value===''||value===null)delete body[setting.key];
    else body[setting.key]=setting.kind==='number'?Number(value):value;
   }
   const saved=await request<{profile:Profile}>('/tenant/company-profile',{method:'PUT',body:JSON.stringify(body)});
   setProfile(saved.profile);setEditing(false);setStatus('Receipt settings saved.');
   void refreshTenantBrand();
  }catch(error){setStatus(error instanceof Error?error.message:String(error));}
  finally{setSaving(false);}
 };
 const shown=(key:string,kind:string)=>{
  const value=profile?.[key];
  if(kind==='yesno')return value===true?'Yes':'No';
  return value===undefined||value===null||value===''?'Not set':String(value);
 };
 return <section className="company-workspace-card md-receipt-settings" aria-label="Receipts">
  <div className="section-toolbar"><div><h2>Receipts</h2>
   <p>What receipts show and how tills print them. Page formulas read each value as @ThisTenant.Company.Name of the setting.</p></div>
   {profile&&!editing&&<button type="button" className="btn" onClick={()=>{setDraft(Object.fromEntries(RECEIPT_SETTINGS.map(s=>[s.key,profile[s.key]??(s.kind==='yesno'?false:'')])));setEditing(true);}}>Edit receipts</button>}
  </div>
  {!profile?<p>{status||'Loading receipt settings…'}</p>:<div className="company-profile-grid">
   {RECEIPT_SETTINGS.map(setting=><div className="company-profile-field" key={setting.key} data-company-field={setting.key}>
    <label htmlFor={'receipt-'+setting.key}>{setting.label}</label>
    {!editing?<p>{shown(setting.key,setting.kind)}</p>
     :setting.kind==='yesno'?<select id={'receipt-'+setting.key} className="form-control" value={draft[setting.key]===true?'yes':'no'}
       onChange={event=>setDraft(prev=>({...prev,[setting.key]:event.target.value==='yes'}))}>
       <option value="yes">Yes</option><option value="no">No</option></select>
     :<input id={'receipt-'+setting.key} className="form-control" type={setting.kind==='number'?'number':'text'}
       min={setting.min} max={setting.max} step={setting.kind==='number'?'any':undefined}
       value={String(draft[setting.key]??'')} onChange={event=>setDraft(prev=>({...prev,[setting.key]:event.target.value}))}/>}
    <small>@ThisTenant.Company.{setting.key[0].toUpperCase()+setting.key.slice(1)}{setting.help?' · '+setting.help:''}</small>
   </div>)}
  </div>}
  {editing&&<div className="settings-read-first-toolbar">
   <button type="button" className="btn" disabled={saving} onClick={()=>setEditing(false)}>Cancel</button>
   <button type="button" className="btn btn-brand" disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Save receipts'}</button></div>}
  {profile&&status&&<p role="status">{status}</p>}
 </section>;
}
