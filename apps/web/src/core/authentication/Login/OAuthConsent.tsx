import {useEffect,useState} from 'react';
import {apiRequest} from '../Client/authClient';
export default function OAuthConsent(){
 const [preview,setPreview]=useState<{label:string;scopes:string[];requireMfa:boolean}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const request=Object.fromEntries(new URLSearchParams(window.location.search));
 useEffect(()=>{void apiRequest<{label:string;scopes:string[];requireMfa:boolean}>('/oauth/consent/preview',{method:'POST',body:JSON.stringify(request)}).then(setPreview).catch(e=>setError(String(e)));},[]);
 const submit=async(approved:boolean)=>{setBusy(true);setError('');try{const result=await apiRequest<{redirect:string}>('/oauth/consent',{method:'POST',body:JSON.stringify({request,approved})});window.location.assign(result.redirect);}catch(e){setError(String(e));setBusy(false);}};
 return <main className="auth-loading"><section className="surface"><h1>Connect an application</h1>{error&&<p role="alert">{error}</p>}{preview&&<>
  <h2>{preview.label}</h2><p>This application requests these actions using your account:</p><ul>{preview.scopes.map(s=><li key={s}>{s.replace(':',': ')}</li>)}</ul>
  <p>Your current permissions and licence still apply. {preview.requireMfa?'An MFA-verified session is required.':''}</p>
  <button className="btn btn-brand" disabled={busy} onClick={()=>void submit(true)}>Allow access</button> <button className="btn" disabled={busy} onClick={()=>void submit(false)}>Deny</button>
 </>}</section></main>;
}
