import {useEffect,useRef,useState} from 'react';
import {apiRequest,ApiRequestError} from '../Client/authClient';
import {tillDeviceKey} from '../TillDevice/deviceTill';
import {forgetScreen,rememberScreen,savedScreenKey,type ScreenAnswer} from './pairedScreen';
import './pairedScreen.css';

/**
 * /display: any device (a tablet, a phone, a PC browser) becomes a paired screen with no
 * sign-in. It shows a 4-digit code; a signed-in person types it on their till (or kiosk).
 * The screen then opens that app's page, signed in as that person. After a restart the
 * saved screen key signs it in again, so the code is needed only once.
 */
type Start={code:string;poll:string;expiresAt:string};
type Poll={status:'waiting'|'expired'}|({status:'paired'}&ScreenAnswer);
const POLL_MS=2000;

export default function PairedScreenStart(){
 const [code,setCode]=useState('');
 const [message,setMessage]=useState('Getting a code…');
 const stopped=useRef(false);
 useEffect(()=>{
  stopped.current=false;
  let timer:number|undefined;
  const open=(answer:ScreenAnswer)=>{
   const path=rememberScreen(answer);
   stopped.current=true;
   window.location.replace(path);
  };
  const begin=async()=>{
   if(stopped.current)return;
   try{
    const started=await apiRequest<Start>('/auth/screen/start',{method:'POST',body:JSON.stringify({screenKey:tillDeviceKey()})});
    setCode(started.code);setMessage('');
    const ask=async()=>{
     if(stopped.current)return;
     try{
      const answer=await apiRequest<Poll>('/auth/screen/poll',{method:'POST',body:JSON.stringify({poll:started.poll})});
      if(answer.status==='paired'){open(answer);return;}
      if(answer.status==='expired'){void begin();return;}
     }catch{setMessage('Waiting for the connection…');}
     timer=window.setTimeout(()=>void ask(),POLL_MS);
    };
    timer=window.setTimeout(()=>void ask(),POLL_MS);
   }catch(error){
    setCode('');
    setMessage(error instanceof Error&&error.message?error.message:'Cannot reach the server. Retrying…');
    timer=window.setTimeout(()=>void begin(),10_000);
   }
  };
  const resume=async()=>{
   const key=savedScreenKey();
   if(!key){void begin();return;}
   setMessage('Connecting…');
   try{open(await apiRequest<ScreenAnswer>('/auth/screen/resume',{method:'POST',body:JSON.stringify({key})}));}
   catch(error){
    if(error instanceof ApiRequestError&&error.status===410){forgetScreen();void begin();return;}
    setMessage('Cannot reach the server. Retrying…');
    timer=window.setTimeout(()=>void resume(),10_000);
   }
  };
  void resume();
  return ()=>{stopped.current=true;window.clearTimeout(timer);};
 },[]);
 return <main className="paired-screen-start" aria-live="polite">
  <h1>Pair this screen</h1>
  {code?<>
   <p className="paired-screen-code" aria-label={'Pairing code '+code.split('').join(' ')}>{code}</p>
   <p>On the till, tap <strong>Pair screen</strong> and type this code.</p>
  </>:null}
  {message?<p className="paired-screen-note">{message}</p>:null}
 </main>;
}
