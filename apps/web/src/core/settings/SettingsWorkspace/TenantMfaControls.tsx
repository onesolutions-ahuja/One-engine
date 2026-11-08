import {useEffect,useState} from 'react';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export default function TenantMfaControls({request,canManage,onReauthenticate}:{request:Request;canManage:boolean;onReauthenticate:()=>void}){
 const [status,setStatus]=useState<{mode:string;enrolled:boolean}|null>(null),[mode,setMode]=useState('Off');
 const [password,setPassword]=useState(''),[code,setCode]=useState(''),[setup,setSetup]=useState<{setup_secret:string;enrollment_token:string}|null>(null);
 const [codes,setCodes]=useState<string[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [keys,setKeys]=useState<Array<{credential_id:string;label:string}>>([]),[label,setLabel]=useState('My passkey');
 const [users,setUsers]=useState<Array<{id:string;name:string;email:string}>>([]),[target,setTarget]=useState('');
 const load=async()=>{const s=await request<{mode:string;enrolled:boolean}>('/auth/mfa/status');setStatus(s);setMode(s.mode);
  setKeys((await request<{credentials:typeof keys}>('/auth/passkeys')).credentials);};
 useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[]);
 useEffect(()=>{if(canManage)void request<{users:typeof users}>('/auth/user-locks').then(r=>setUsers(r.users)).catch(e=>setMessage(String(e)));},[canManage]);
 const run=async(fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const post=<T,>(path:string,body:unknown)=>request<T>(path,{method:'POST',body:JSON.stringify(body)});
 return <section className="surface permission-section"><h2>Multi-factor authentication</h2>
  <p>Policy: {status?.mode??'Loading…'} · {status?.enrolled?'A factor is enrolled':'No factor enrolled'}</p>
  {canManage&&<div className="md-admin-form-grid"><label className="form-label md-admin-field-medium">Tenant MFA policy<select className="form-control" value={mode} onChange={e=>setMode(e.target.value)}>
   {['Off','Optional','Required'].map(m=><option key={m}>{m}</option>)}</select></label>
   <div className="md-admin-actions"><button className="btn btn-brand" type="button" disabled={busy||!status} onClick={()=>void run(async()=>{await request('/auth/mfa/policy',{method:'PUT',body:JSON.stringify({mode})});if(mode==='Required'){onReauthenticate();return;}await load();setMessage('MFA policy saved.');})}>Save policy</button></div>
  </div>}
  <div className="md-admin-form-grid"><label className="form-label">Current password<input className="form-control" autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
  <label className="form-label">Fresh authenticator code<input className="form-control" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} maxLength={6}/></label></div>
  <button className="btn" type="button" disabled={busy||!password} onClick={()=>void run(async()=>setSetup(await post('/auth/mfa/enroll',{password})))}>Set up authenticator</button>
  {setup&&<div><p>Enter this key in your authenticator: <code>{setup.setup_secret}</code></p>
   <button className="btn" type="button" disabled={busy||!code} onClick={()=>void run(async()=>{await post('/auth/mfa/enroll/confirm',{enrollment_token:setup.enrollment_token,code});setSetup(null);setCode('');setPassword('');onReauthenticate();})}>Confirm enrollment and sign out</button></div>}
  <button className="btn" type="button" disabled={busy||!password||code.length!==6} onClick={()=>void run(async()=>{
   const result=await post<{codes:string[]}>('/auth/mfa/backup-codes',{password,code});setCodes(result.codes);setCode('');setPassword('');
  })}>Generate new backup codes</button>
  {codes.length>0&&<div><p>Save these codes privately. Each works once; generating another set revokes this set.</p><pre>{codes.join('\n')}</pre>
   <button className="btn" type="button" onClick={()=>setCodes([])}>I saved these codes</button></div>}
  <h3>Passkeys</h3>
  <label className="form-label">Passkey name<input className="form-control" value={label} onChange={e=>setLabel(e.target.value)} maxLength={100}/></label>
  <button className="btn" type="button" disabled={busy||!password||!label} onClick={()=>void run(async()=>{
   const {startRegistration}=await import('@simplewebauthn/browser');
   const r=await post<{options:Parameters<typeof startRegistration>[0]['optionsJSON'];token:string}>('/auth/passkeys/register/options',{password});
   const response=await startRegistration({optionsJSON:r.options});await post('/auth/passkeys/register',{token:r.token,response,label});setPassword('');await load();
  })}>Register passkey</button>
  {keys.map(k=><div key={k.credential_id}>{k.label} <button type="button" className="btn" disabled={busy||!password} onClick={()=>void run(async()=>{
   await post('/auth/passkeys/remove',{id:k.credential_id,password});onReauthenticate();
  })}>Remove and sign out</button></div>)}
  <p>Passkeys require HTTPS. Trusted IP addresses do not bypass MFA. Backup codes require an enrolled authenticator to generate.</p>
  {status?.mode!=='Required'&&<button type="button" className="btn btn-danger" disabled={busy||!password||code.length!==6} onClick={()=>void run(async()=>{
   await post('/auth/mfa/disable',{password,code});onReauthenticate();
  })}>Disable authenticator and sign out</button>}
  {canManage&&<div><h3>Administrator MFA recovery</h3><p>Reset another user's authenticators, backup codes and passkeys. This signs them out and invalidates pending recovery challenges. A required-MFA tenant will require enrollment on their next login. Your current password and fresh authenticator code above are required.</p>
   <label className="form-label">User needing recovery<select className="form-control mfa-recovery-user-select" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose user</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select></label>
   <button type="button" className="btn btn-danger" disabled={busy||!target||!password||code.length!==6} onClick={()=>void run(async()=>{
    await post('/auth/mfa/admin-reset',{userId:target,password,code});setCode('');setPassword('');setTarget('');setMessage('User MFA factors reset and sessions revoked.');
   })}>Reset selected user's MFA factors</button></div>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
