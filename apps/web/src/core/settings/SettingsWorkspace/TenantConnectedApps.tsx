import {useEffect,useState} from 'react';
import './TenantConnectedApps.css';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Client={id?:string;label:string;enabled:boolean;client_type:'public'|'confidential';require_mfa:boolean;redirects:string[];scopes:string[];users:string[]};
type Scope={scope:string;label:string;description:string;risk:string;assignable:boolean};
type ScopeGroup={key:string;label:string;scopes:Scope[]};
type Data={clients:Client[];users:{id:string;email:string}[];scopes:string[];scopeGroups?:ScopeGroup[];
 mcpUrl?:string|null;secretEndings?:Record<string,string>};
/** Redirect URLs AI assistants use when they connect to this MCP server (shown as setup help). */
const AI_REDIRECTS=['https://claude.ai/api/mcp/auth_callback','https://claude.com/api/mcp/auth_callback'];
const MASK='••••••••••••••••';
function CopyButton({value,label}:{value:string;label:string}){
 const [copied,setCopied]=useState(false);
 return <button type="button" className="btn connected-apps-icon-btn" aria-label={label} title={label}
  onClick={()=>{void navigator.clipboard?.writeText(value).then(()=>{setCopied(true);window.setTimeout(()=>setCopied(false),1500);}).catch(()=>{});}}>
  {copied?'Copied':'Copy'}</button>;
}
/** A one-time secret: hidden by default, eye to show, copy without showing. */
function SecretValue({value}:{value:string}){
 const [shown,setShown]=useState(false);
 return <span className="connected-apps-secret-value">
  <code aria-label={shown?'Client secret':'Client secret (hidden)'}>{shown?value:MASK}</code>
  <button type="button" className="btn connected-apps-icon-btn" aria-pressed={shown} aria-label={shown?'Hide secret':'Show secret'}
   title={shown?'Hide secret':'Show secret'} onClick={()=>setShown(v=>!v)}>
   <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>{shown&&<path d="M4 4l16 16"/>}
   </svg></button>
  <CopyButton value={value} label="Copy secret"/>
 </span>;
}
const fresh=():Client=>({label:'',enabled:false,client_type:'public',require_mfa:true,redirects:[],scopes:['records:read'],users:[]});
export default function TenantConnectedApps({request}:{request:Request}){
 const [data,setData]=useState<Data|null>(null),[draft,setDraft]=useState<Client>(fresh),[message,setMessage]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[scopeSearch,setScopeSearch]=useState('');
 const [directoryOpen,setDirectoryOpen]=useState(true),[appSearch,setAppSearch]=useState(''),[userSearch,setUserSearch]=useState('');
 const load=()=>request<Data>('/security/connected-apps').then(setData);
 useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[]);
 const toggle=(key:'scopes'|'users',v:string)=>setDraft(prev=>({...prev,
  [key]:prev[key].includes(v)?prev[key].filter(x=>x!==v):[...prev[key],v]}));
 const groups:ScopeGroup[]=data?.scopeGroups??[{key:'legacy',label:'Connection permissions',
  scopes:(data?.scopes??[]).map(scope=>({scope,label:scope,description:'Legacy OAuth scope',risk:'standard',assignable:true}))}];
 const setGroup=(group:ScopeGroup,enable:boolean)=>{
  const allowed=(groups.find(item=>item.key===group.key)??group).scopes
   .filter(s=>s.assignable).map(s=>s.scope);
  setDraft(prev=>({...prev,scopes:enable
   ?[...new Set([...prev.scopes,...allowed])]
   :prev.scopes.filter(s=>!allowed.includes(s))}));
 };
 const search=scopeSearch.trim().toLocaleLowerCase();
 const visibleGroups=groups.map(group=>({...group,
  scopes:group.scopes.filter(s=>!search||[s.scope,s.label,s.description,group.label]
   .some(v=>v.toLocaleLowerCase().includes(search)))
 })).filter(group=>group.scopes.length>0);
 const selectedTotal=draft.scopes.length;
 const existingClient=data?.clients.find(client=>client.id===draft.id);
 const changed=!existingClient||JSON.stringify(existingClient)!==JSON.stringify(draft);
 const redirectsValid=draft.redirects.length>0&&draft.redirects.every(value=>{
   try {const parsed=new URL(value.trim());return parsed.protocol==='https:'&&Boolean(parsed.hostname)&&!parsed.username&&!parsed.password;}
   catch {return false;}
 });
 const canSave=draft.label.trim().length>0&&redirectsValid&&changed&&!busy;
 const discard=()=>{if(changed&&draft.label.trim()&&!window.confirm('Discard unsaved connected app changes?'))return;setDraft(fresh());setDirectoryOpen(true);setMessage('');setSecret('');};
 const matchingClients=(data?.clients??[]).filter(c=>[c.label,c.id,c.client_type].some(v=>v?.toLowerCase().includes(appSearch.trim().toLowerCase())));
 const matchingUsers=(data?.users??[]).filter(u=>u.email.toLowerCase().includes(userSearch.trim().toLowerCase()));
 const selectApp=(client:Client)=>{setDraft({...client});setDirectoryOpen(false);setSecret('');setMessage('');};
 return <section className="surface permission-section connected-apps-section">
  <h2>Connected Apps</h2>
  <p className="connected-apps-help">OAuth authorization code with PKCE (S256), explicit user consent and rotating refresh tokens. Editing an app revokes existing consents. A secret is shown once, then only its last 4 characters.</p>
  {message&&<p role="status" className="connected-apps-status">{message}</p>}
  {secret&&<div role="status" className="connected-apps-status connected-apps-secret">
   <span>Save this client secret now. It is shown only once; afterwards only its last 4 characters are shown.</span>
   <SecretValue value={secret}/> <button type="button" className="btn" onClick={()=>setSecret('')}>Dismiss</button></div>}
  {data&&<>
  {data.mcpUrl&&<div className="connected-apps-mcp" aria-label="MCP server">
   <div className="connected-apps-mcp-row"><strong>MCP server URL</strong><code>{data.mcpUrl}</code><CopyButton value={data.mcpUrl} label="Copy MCP server URL"/></div>
   <p className="connected-apps-help">Paste this URL into an AI assistant's custom connector, with this app's Client ID and secret.
    Give the app the <code>mcp:access</code> scope and add the assistant's redirect URL, for example {AI_REDIRECTS.map((uri,i)=><span key={uri}>{i?' and ':''}<code>{uri}</code></span>)}.</p>
  </div>}
  {data.clients.length>0&&<div className="connected-apps-directory" aria-label="Existing OAuth applications">
   <div className="md-admin-actions"><button type="button" className="btn btn-brand" onClick={()=>{setDraft(fresh());setDirectoryOpen(false);setSecret('');}}>New connected app</button>
    {!directoryOpen&&<button type="button" className="btn" onClick={discard}>Browse applications</button>}</div>
   {directoryOpen&&<><label className="form-label">Find connected app
    <input className="form-control" type="search" value={appSearch} onChange={e=>setAppSearch(e.target.value)} placeholder="Search by app name or client ID"/>
   </label><div className="connected-apps-directory-grid">{matchingClients.map(client=><button type="button" className="connected-apps-directory-item" key={client.id} onClick={()=>selectApp(client)}>
    <strong>{client.label}</strong><small>{client.client_type} · {client.enabled?'Enabled':'Disabled'}</small><code>{client.id}</code>
   </button>)}</div>{!matchingClients.length&&<p role="status">No matching applications.</p>}</>}
  </div>}
  {(!directoryOpen||data.clients.length===0)&&<>
  <label className="form-label">Application
    <select className="form-control" value={draft.id??''} onChange={e=>{const selected=data.clients.find(c=>c.id===e.target.value);if(selected)selectApp(selected);else {setDraft(fresh());setSecret('');}}}>
      <option value="">New connected app</option>
      {data.clients.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  </label>
  {draft.id&&<p className="connected-apps-meta">Client ID: <code>{draft.id}</code> <CopyButton value={draft.id} label="Copy client ID"/></p>}
  {draft.id&&draft.client_type==='confidential'&&<p className="connected-apps-meta">Client secret: <code>{'••••••••'+(data.secretEndings?.[draft.id]??'')}</code>
   {!data.secretEndings?.[draft.id]&&<small> (rotate once to see its last 4 characters here)</small>}</p>}
  {draft.id&&draft.client_type==='confidential'&&(
    <button type="button" className="btn" disabled={busy} onClick={()=>{if(!window.confirm('Rotate this client secret? Existing user consents will be revoked.'))return;setBusy(true);void request<{clientSecret:string}>('/security/connected-apps/rotate-secret',{method:'POST',body:JSON.stringify({id:draft.id})}).then(r=>{setSecret(r.clientSecret);setMessage('Secret rotated; existing consents revoked.');}).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));}}>
      Rotate client secret and revoke consents
    </button>
  )}
  <div className="md-admin-form-grid"><label className="form-label">Name (required)
    <input className="form-control" required value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/>
  </label>
  <label className="form-label">Client type
    <select className="form-control" disabled={Boolean(draft.id)} value={draft.client_type} onChange={e=>setDraft({...draft,client_type:e.target.value as Client['client_type']})}>
      <option value="public">Public (browser or native app)</option>
      <option value="confidential">Confidential (server stores a secret)</option>
    </select>
  </label></div>
  <label className="form-label">Exact HTTPS redirect URLs, one per line
    <textarea className="form-control" required value={draft.redirects.join('\n')} onChange={e=>setDraft({...draft,redirects:e.target.value.split('\n')})} rows={3}/>
  </label>
  {!redirectsValid&&<p className="permission-help">Enter at least one valid HTTPS redirect URL. Each URL must be on its own line.</p>}
  <div className="connected-apps-toggles">
    <label className="checkbox-row"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Enabled</label>
    <label className="checkbox-row"><input type="checkbox" checked={draft.require_mfa} onChange={e=>setDraft({...draft,require_mfa:e.target.checked})}/>Require MFA at consent</label>
  </div>
  <section className="oauth-scope-selector" aria-label="Allowed OAuth scopes">
   <div className="oauth-scope-heading">
    <div><h3>Allowed OAuth scopes</h3><p>Choose the smallest permissions this application needs. OneEngine RBAC is enforced separately.</p></div>
    <span className="oauth-scope-count">{selectedTotal} selected</span>
   </div>
   <label className="form-label">Find a permission
    <input className="form-control" type="search" placeholder="Search groups, capabilities or scope names"
     value={scopeSearch} onChange={event=>setScopeSearch(event.target.value)}/>
   </label>
   <div className="oauth-scope-groups">
    {visibleGroups.map(group=>{
     const enabled=(groups.find(item=>item.key===group.key)??group).scopes.filter(s=>s.assignable);
     const totalSelected=enabled.filter(s=>draft.scopes.includes(s.scope)).length;
     return <details key={group.key} className="oauth-scope-group" open={scopeSearch?true:undefined}>
      <summary><strong>{group.label}</strong><span>{totalSelected}/{enabled.length} selected</span></summary>
      <div className="oauth-scope-group-body">
       <div className="oauth-scope-group-actions">
        <button type="button" className="btn" disabled={enabled.length===0||totalSelected===enabled.length}
         onClick={()=>setGroup(group,true)}>Select entire group</button>
        <button type="button" className="btn" disabled={totalSelected===0}
         onClick={()=>setGroup(group,false)}>Clear group</button>
       </div>
       {group.scopes.map(item=><label className={'oauth-scope-option'+(!item.assignable?' oauth-scope-reserved':'')} key={item.scope}>
        <input type="checkbox" checked={draft.scopes.includes(item.scope)} disabled={!item.assignable}
         onChange={()=>toggle('scopes',item.scope)}/>
        <span><strong>{item.label}</strong><code>{item.scope}</code>
         <small>{item.description}</small></span>
        <em>{!item.assignable?'Reserved':item.risk==='critical'?'Sensitive':item.risk==='elevated'?'Elevated':''}</em>
       </label>)}
      </div>
     </details>;
    })}
   </div>
   {visibleGroups.length===0&&<p role="status">No matching permissions.</p>}
   <p className="oauth-scope-help">Reserved entries are visible for future applications but cannot be granted until supported by an authorised API or MCP operation. Saving changes revokes existing consent; connected users must reauthorise.</p>
  </section>
  <div className="connected-apps-group" role="group" aria-labelledby="connected-apps-users-label">
    <div id="connected-apps-users-label" className="connected-apps-group-title">Allowed users ({draft.users.length} selected)</div>
    <label className="form-label">Find user<input type="search" className="form-control" value={userSearch} onChange={e=>setUserSearch(e.target.value)} placeholder="Search allowed users by email"/></label>
    <div className="connected-apps-checklist">
      {matchingUsers.map(u=><label className="checkbox-row" key={u.id} title={u.email}><input type="checkbox" checked={draft.users.includes(u.id)} onChange={()=>toggle('users',u.id)}/><span className="connected-apps-email">{u.email}</span></label>)}
    </div>{matchingUsers.length===0&&<p role="status">No matching users.</p>}
  </div>
  <div className="connected-apps-actions">
    <button type="button" className="btn" disabled={busy} onClick={discard}>Cancel / Discard</button>
    <button type="button" className="btn btn-brand" disabled={!canSave} onClick={()=>{if(draft.id&&data.clients.some(client=>client.id===draft.id)&&JSON.stringify(data.clients.find(client=>client.id===draft.id))!==JSON.stringify(draft)&&!window.confirm('Save changes to this app? Existing user consents will be revoked and users must reauthorise.'))return;setBusy(true);setMessage('');void request<{id:string;clientSecret?:string}>('/security/connected-apps',{method:'PUT',body:JSON.stringify(draft)}).then(async r=>{setDraft({...draft,id:r.id});setSecret(r.clientSecret??'');setMessage('Saved');await load();}).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));}}>
      Save connected app
    </button>
  </div>
  </>}
  </>}
 </section>;
}
