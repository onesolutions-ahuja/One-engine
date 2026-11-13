import {useEffect,useState} from 'react';
import {X,Delete} from 'lucide-react';
import {apiRequest,ApiRequestError,setAccessToken} from '../Client/authClient';
import {forgetTillPerson,initials,restoreTillWork,setActiveTillUser,tillPeople,type TillPerson} from './tillDevice';
import './tillLock.css';

/** Shared-till lock screen: people saved on this device sign back in with their PIN. */
export function TillLockScreen({onUnlocked,onUseEmail}:{
 onUnlocked:(session:{access_token:string;landingAppApi?:string})=>void;onUseEmail:()=>void;
}){
 const [people,setPeople]=useState<TillPerson[]>(()=>tillPeople());
 const [chosen,setChosen]=useState<TillPerson|null>(()=>tillPeople().length===1?tillPeople()[0]!:null);
 const [pin,setPin]=useState('');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{document.title='Till locked';},[]);
 const remove=async(person:TillPerson)=>{
  forgetTillPerson(person.userId);
  void apiRequest('/auth/till-device/remove',{method:'POST',body:JSON.stringify({key:person.key})}).catch(()=>{});
  const next=tillPeople();setPeople(next);
  if(chosen?.userId===person.userId){setChosen(null);setPin('');}
  if(!next.length)onUseEmail();
 };
 const submit=async(value:string)=>{
  if(!chosen||busy)return;
  setBusy(true);setMessage('');
  try{
   const session=await apiRequest<{access_token:string;landingAppApi?:string}>('/auth/till-device/unlock',
    {method:'POST',body:JSON.stringify({key:chosen.key,pin:value})});
   setAccessToken(session.access_token);
   restoreTillWork(chosen.userId);setActiveTillUser(chosen.userId);
   onUnlocked(session);
  }catch(error){
   setPin('');
   if(error instanceof ApiRequestError&&error.status===410){
    forgetTillPerson(chosen.userId);setPeople(tillPeople());setChosen(null);
    setMessage(chosen.name+' needs to sign in with email again.');
   }else setMessage(error instanceof ApiRequestError&&error.status===401?'Wrong PIN. Try again.'
    :'Cannot reach the server. Check the connection and try again.');
  }finally{setBusy(false);}
 };
 const press=(digit:string)=>{
  if(!chosen||busy)return;
  const next=(pin+digit).slice(0,8);setPin(next);setMessage('');
 };
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(/^[0-9]$/.test(event.key))press(event.key);
   else if(event.key==='Backspace')setPin(p=>p.slice(0,-1));
   else if(event.key==='Enter'&&pin.length>=4)void submit(pin);
  };
  window.addEventListener('keydown',key);
  return ()=>window.removeEventListener('keydown',key);
 });
 return <main className="till-lock" aria-label="Till locked">
  <section className="till-lock-people">
   <div className="till-lock-eyebrow">TILL LOCKED</div>
   <h1>Who's on till?</h1>
   <ul className="till-lock-list">
    {people.map(person=><li key={person.userId} className={chosen?.userId===person.userId?'is-chosen':''}>
     <button type="button" className="till-lock-person" aria-pressed={chosen?.userId===person.userId}
      onClick={()=>{setChosen(person);setPin('');setMessage('');}}>
      <span className="till-lock-avatar" aria-hidden="true">{initials(person.name)}</span>
      <span className="till-lock-name">{person.name}</span>
     </button>
     <button type="button" className="till-lock-remove" aria-label={'Remove '+person.name+' from this till'}
      title="Remove from this till" onClick={()=>void remove(person)}><X size={14} aria-hidden="true"/></button>
    </li>)}
   </ul>
   <button type="button" className="till-lock-email" onClick={onUseEmail}>Sign in with email</button>
  </section>
  <section className="till-lock-pad" aria-live="polite">
   <h2>{chosen?'Enter '+chosen.name+"'s PIN":'Choose your name'}</h2>
   <div className="till-lock-dots" aria-label={pin.length+' digits entered'}>
    {Array.from({length:Math.max(4,pin.length)},(_,i)=><span key={i} className={i<pin.length?'is-filled':''}/>)}
   </div>
   {message&&<p className="till-lock-message" role="alert">{message}</p>}
   <div className="till-lock-keys">
    {['1','2','3','4','5','6','7','8','9'].map(d=><button key={d} type="button" disabled={!chosen||busy} onClick={()=>press(d)}>{d}</button>)}
    <button type="button" className="till-lock-key-text" disabled={!chosen||busy||pin.length<4} onClick={()=>void submit(pin)}>OK</button>
    <button type="button" disabled={!chosen||busy} onClick={()=>press('0')}>0</button>
    <button type="button" className="till-lock-key-text" aria-label="Delete digit" disabled={!pin||busy} onClick={()=>setPin(p=>p.slice(0,-1))}><Delete size={26} aria-hidden="true"/></button>
   </div>
  </section>
 </main>;
}
