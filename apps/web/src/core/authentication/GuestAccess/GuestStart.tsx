import {useEffect,useState} from 'react';
import {apiRequest,ApiRequestError} from '../Client/authClient';
import {forgetGuest,guestTokenFromPath,rememberGuest,type GuestAnswer} from './guestAccess';
import '../PairedScreen/pairedScreen.css';

/** /guest/<token>: a QR code's link. Signs in as the record's guest and opens its page. */
export default function GuestStart(){
 const [message,setMessage]=useState('Opening…');
 useEffect(()=>{
  let timer:number|undefined;
  const token=guestTokenFromPath();
  const open=async()=>{
   if(!token){setMessage('This link is not complete. Scan the QR code again.');return;}
   try{
    const answer=await apiRequest<GuestAnswer>('/auth/guest/open',{method:'POST',body:JSON.stringify({token})});
    window.location.replace(rememberGuest(token,answer));
   }catch(error){
    if(error instanceof ApiRequestError&&(error.status===410||error.status===429)){
     if(error.status===410)forgetGuest();
     setMessage(error.message||'This link is no longer valid. Ask a member of staff for help.');
     return;
    }
    setMessage('Cannot reach the server. Retrying…');
    timer=window.setTimeout(()=>void open(),10_000);
   }
  };
  void open();
  return ()=>window.clearTimeout(timer);
 },[]);
 return <main className="paired-screen-start" aria-live="polite">
  <p className="paired-screen-note">{message}</p>
 </main>;
}
