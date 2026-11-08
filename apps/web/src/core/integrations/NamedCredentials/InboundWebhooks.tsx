import {generateMetadataApiName,metadataNameConflict,suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';

type Endpoint={id:string;apiName:string;appApiName:string;flowApi:string;executionUserId:string;
 enabled:boolean;callbackUrl:string;eventCount:number};
type Options={apps:string[];flows:string[];users:Array<{id:string;email:string}>};
const empty={apiName:'',appApiName:'',flowApi:'',executionUserId:'',
 verifyToken:'',appSecret:'',provider:'Meta',enabled:false};
export default function InboundWebhooks(){
 const [items,setItems]=useState<Endpoint[]>([]);
 const [options,setOptions]=useState<Options>({apps:[],flows:[],users:[]});
 const [draft,setDraft]=useState({...empty});
 const [editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [allowed,setAllowed]=useState(true);
 const load=async()=>{
  const [list,choices]=await Promise.all([
   apiRequest<{endpoints:Endpoint[]}>('/metadata/inbound-webhooks'),
   apiRequest<Options>('/metadata/inbound-webhooks/options')]);
  setItems(list.endpoints??[]);setOptions(choices);
 };
 useEffect(()=>{let live=true;void load().catch(e=>{
  if(live){setAllowed(false);setError(e instanceof Error?e.message:String(e));}
 });return()=>{live=false;};},[]);
 const save=async()=>{
  setBusy(true);setError('');setNotice('');
  try{
   const created=await apiRequest<{id:string;callbackUrl:string}>('/metadata/inbound-webhooks',{
    method:'POST',body:JSON.stringify(draft)});
   await load();setDraft({...empty});setEditing(false);
   setNotice('Webhook endpoint created. Callback URL: '+created.callbackUrl);
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const toggle=async(item:Endpoint)=>{
  setBusy(true);setError('');
  try{await apiRequest('/metadata/inbound-webhooks/'+encodeURIComponent(item.id),{
   method:'PATCH',body:JSON.stringify({enabled:!item.enabled})});await load();}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 if(!allowed)return <section className="surface"><h2>Inbound Webhook Endpoints</h2>
  <p>Webhook administration requires OneEngine WebhookSubscription permissions.</p></section>;
 return <section className="surface object-setting-surface" aria-label="Inbound Webhook Endpoints"
  style={{marginTop:24,padding:20}}>
  <div className="section-toolbar"><div><h2>Inbound Webhook Endpoints</h2>
  <p>Receive verified events from WhatsApp or other installed apps; route to a permitted OneEngine Flow.</p></div>
  <button type="button" className="btn btn-brand" onClick={()=>setEditing(v=>!v)}>
   {editing?'Close':'New Webhook Endpoint'}</button></div>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div style={{display:'grid',gap:12}}>
   {items.map(item=><div key={item.id} style={{border:'1px solid #d9e2e5',padding:12,borderRadius:12}}>
    <strong>{item.apiName}</strong> — {item.appApiName} → {item.flowApi}
    <p><small>Executed as user: {options.users.find(u=>u.id===item.executionUserId)?.email??item.executionUserId}</small></p>
    <label>Callback URL
     <input className="form-control" readOnly value={item.callbackUrl} onFocus={e=>e.target.select()}/></label>
    <p>Verified deliveries: {item.eventCount} · {item.enabled?'Enabled':'Disabled'}</p>
    <button type="button" className="btn" disabled={busy} onClick={()=>void toggle(item)}>
     {item.enabled?'Disable':'Enable'}</button>
   </div>)}
   {!items.length&&<p>No inbound endpoints configured.</p>}
  </div>
  {editing&&<form onSubmit={e=>{e.preventDefault();void save();}} style={{display:'grid',gap:12,marginTop:20}}>
   <details><summary>Advanced: API Name</summary><label>API name <input className="form-control" required pattern="[A-Za-z][A-Za-z0-9_]*"
    value={draft.apiName} onChange={e=>setDraft(v=>({...v,apiName:e.target.value}))}/></label></details>
   <p>API Name: {draft.apiName||'Select a Flow to generate a name'}</p>
   {metadataNameConflict(draft.apiName,items.map(item=>item.apiName))&&
    <p role="alert">API Name already in use. <button type="button" className="btn"
     onClick={()=>setDraft(v=>({...v,apiName:suggestMetadataApiName(v.apiName,items.map(item=>item.apiName))}))}>Use suggested name</button></p>}
   <label>Assigned application
    <select className="form-control" required value={draft.appApiName}
     onChange={e=>setDraft(v=>({...v,appApiName:e.target.value}))}>
     <option value="">Select installed app</option>{options.apps.map(a=><option key={a}>{a}</option>)}
    </select></label>
   <label>Verification provider<select className="form-control" value={draft.provider}
      onChange={e=>setDraft(v=>({...v,provider:e.target.value}))}>
      <option value="Meta">Meta (WhatsApp / Facebook)</option><option value="HmacSha256">Generic HMAC-SHA256</option>
    </select></label>
   <label>Target Autolaunched Flow
    <select className="form-control" required value={draft.flowApi}
     onChange={e=>setDraft(v=>({...v,flowApi:e.target.value,apiName:v.apiName||suggestMetadataApiName(generateMetadataApiName(e.target.value),items.map(item=>item.apiName))}))}>
     <option value="">Select active Flow</option>{options.flows.map(a=><option key={a}>{a}</option>)}
    </select></label>
   <label>Flow execution user
    <select className="form-control" required value={draft.executionUserId}
     onChange={e=>setDraft(v=>({...v,executionUserId:e.target.value}))}>
     <option value="">Select authorised user</option>{options.users.map(u=>
      <option key={u.id} value={u.id}>{u.email}</option>)}
    </select></label>
   <label>Webhook verify token (24+ characters)
    <input className="form-control" type="password" minLength={24} required autoComplete="new-password"
     value={draft.verifyToken} onChange={e=>setDraft(v=>({...v,verifyToken:e.target.value}))}/></label>
   <label>Provider signing secret (Meta App Secret)
    <input className="form-control" type="password" minLength={16} required autoComplete="new-password"
     value={draft.appSecret} onChange={e=>setDraft(v=>({...v,appSecret:e.target.value}))}/></label>
   <label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft(v=>({...v,enabled:e.target.checked}))}/>
    Enable callback after saving</label>
   <p>Secrets are encrypted or hashed in tenant SQL and are never displayed again.
    Meta sends a GET verification challenge and signs POST events with X-Hub-Signature-256.</p>
   <button className="btn btn-brand" type="submit" disabled={busy||!draft.appApiName||!draft.flowApi||!draft.executionUserId}>
    {busy?'Saving…':'Create Endpoint'}</button>
  </form>}
 </section>;
}
