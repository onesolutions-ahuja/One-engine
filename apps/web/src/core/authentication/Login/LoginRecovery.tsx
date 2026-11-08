import {useEffect,useState,type FormEvent} from 'react';
import {apiRequest} from '../Client/authClient';

type Channel='email'|'whatsapp'|'sms';
type RecoveryStep='choose'|'verify'|'reset'|'done';
type Options={otpLength:4|6;method:'OTP'|'LINK';channels:Record<Channel,boolean>};
const defaults:Options={otpLength:6,method:'OTP',channels:{email:false,whatsapp:false,sms:false}};
const channelButtons:Array<{channel:Channel;label:string}>=[
 {channel:'email',label:'Send OTP by Email'},
 {channel:'whatsapp',label:'Send OTP by WhatsApp'},
 {channel:'sms',label:'Send OTP by SMS'}
];
export default function LoginRecovery({onClose}:{onClose:()=>void}){
 const initial=new URLSearchParams(window.location.search);
 const [email,setEmail]=useState(initial.get('resetEmail')??'');
 const [resetToken,setResetToken]=useState(initial.get('resetToken')??'');
 const [step,setStep]=useState<RecoveryStep>(initial.get('resetToken')?'reset':'choose');
 const [channel,setChannel]=useState<Channel>('email');
 const [code,setCode]=useState('');
 const [password,setPassword]=useState('');
 const [confirm,setConfirm]=useState('');
 const [options,setOptions]=useState<Options>(defaults);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [loadingOptions,setLoadingOptions]=useState(true);
 const [optionsFailed,setOptionsFailed]=useState(false);
 const availableChannels=channelButtons.filter(item=>options.channels[item.channel]);
 const loadOptions=async()=>{
  setLoadingOptions(true);setOptionsFailed(false);setMessage('');
  try{setOptions(await apiRequest<Options>('/auth/password-reset/options'));}
  catch{setOptions(defaults);setOptionsFailed(true);setMessage('Recovery methods could not be loaded.');}
  finally{setLoadingOptions(false);}
 };
 useEffect(()=>{
  // Clear sensitive link tokens immediately; never keep them in browser history.
  const params=new URLSearchParams(window.location.search);
  if(params.has('resetToken')){
   params.delete('resetToken');params.delete('resetEmail');params.set('recover','1');
   window.history.replaceState(null,'',window.location.pathname+
    (params.size?'?'+params.toString():'')+window.location.hash);
  }
  void loadOptions();
 },[]);
 const request=async(selected:Channel)=>{
  if(!email.trim()||busy||!options.channels[selected])return;
  setBusy(true);setMessage('');setChannel(selected);
  try{
   const response=await apiRequest<{message:string}>('/auth/password-reset/request',{
    method:'POST',body:JSON.stringify({email:email.trim(),channel:selected})
   });
   if(options.method==='OTP')setStep('verify');
   setMessage(options.method==='LINK'?'If your account exists, check your email for a reset link.':response.message);
  }catch(error){setMessage(error instanceof Error?error.message:'Recovery request failed');}
  finally{setBusy(false);}
 };
 const verify=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(busy)return;
  setBusy(true);setMessage('');
  try{
   const result=await apiRequest<{resetToken:string}>('/auth/password-reset/verify',{
    method:'POST',body:JSON.stringify({email:email.trim(),code})
   });
   setResetToken(result.resetToken);setCode('');setStep('reset');
  }catch(error){setMessage(error instanceof Error?error.message:'Incorrect or expired code');}
  finally{setBusy(false);}
 };
 const reset=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(busy)return;
  if(password!==confirm){setMessage('Passwords must match.');return;}
  setBusy(true);setMessage('');
  try{
   const result=await apiRequest<{message:string}>('/auth/password-reset/confirm',{
    method:'POST',body:JSON.stringify({email:email.trim(),token:resetToken,newPassword:password})
   });
   setResetToken('');setPassword('');setConfirm('');setStep('done');setMessage(result.message);
  }catch(error){setMessage(error instanceof Error?error.message:'Password reset failed');}
  finally{setBusy(false);}
 };
 return <section className="auth-recovery">
  <h1>Recover your password</h1>
  {step==='choose'&&<>
   <p>Enter your registered email to request a password reset.</p>
   {availableChannels.length>0&&<label className="form-label">Account email
    <input className="form-control" type="email" autoComplete="username"
     value={email} onChange={event=>setEmail(event.target.value)} required/>
   </label>}
   {loadingOptions?<p role="status">Loading recovery options…</p>:
    availableChannels.length>0?<div className="auth-recovery-channels" role="group" aria-label="Available recovery methods">
     {availableChannels.map(item=><button key={item.channel} type="button"
      className="btn auth-recovery-channel" disabled={busy||!email.trim()}
      onClick={()=>void request(item.channel)}>{options.method==='LINK'&&item.channel==='email'?'Send reset link by Email':item.label}</button>)}
    </div>:<div className="auth-recovery-unavailable" role="status">
      <p>Password self-service is currently unavailable. Contact your organisation administrator or <a href="mailto:support@unesolutions.co.uk">UNE Solutions support</a> for assistance.</p>
      {optionsFailed&&<button className="btn" type="button" onClick={()=>void loadOptions()}>Retry loading methods</button>}
    </div>}
  </>}
  {step==='verify'&&<>
   <p>Enter the {options.otpLength}-digit code delivered to your registered {channel==='email'?'email':'phone'}.</p>
   <form onSubmit={event=>void verify(event)}>
    <label className="form-label">Verification code
     <input className="form-control" inputMode="numeric" autoComplete="one-time-code"
      type="text" pattern="[0-9]*" maxLength={options.otpLength}
      value={code} onChange={event=>setCode(event.target.value.replace(/[^0-9]/g,'').slice(0,options.otpLength))}
      required/>
    </label>
    <button className="btn btn-brand" type="submit" disabled={busy||code.length!==options.otpLength}>
     {busy?'Checking…':'Verify code'}
    </button>
   </form>
   <button className="text-action" type="button" onClick={()=>{setStep('choose');setCode('');setMessage('');}}>
    Choose another method or resend
   </button>
  </>}
  {step==='reset'&&<>
   <p>Verification complete. Set a new password.</p>
   <form onSubmit={event=>void reset(event)}>
    <label className="form-label">New password
     <input className="form-control" type="password" autoComplete="new-password"
      minLength={12} value={password} onChange={event=>setPassword(event.target.value)} required/>
    </label>
    <label className="form-label">Confirm new password
     <input className="form-control" type="password" autoComplete="new-password"
      minLength={12} value={confirm} onChange={event=>setConfirm(event.target.value)} required/>
    </label>
    <button className="btn btn-brand" type="submit" disabled={busy}>{busy?'Saving…':'Reset password'}</button>
   </form>
  </>}
  {step==='done'&&<p>Your password has been changed. Return to sign in.</p>}
  {message&&<p role="status">{message}</p>}
  <p>MFA remains required after recovery. Use your authenticator, backup code or passkey when signing in.</p>
  <button className="text-action" type="button" onClick={onClose}>Return to sign in</button>
 </section>;
}
