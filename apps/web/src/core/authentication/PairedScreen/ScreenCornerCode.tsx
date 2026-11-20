import {useEffect,useState} from 'react';
import {apiRequest} from '../Client/authClient';
import {mirrorDeviceKey,tillDeviceKey} from '../TillDevice/deviceTill';
import './pairedScreen.css';

/**
 * The small code in the corner of a paired screen, e.g. "Till 1 · 4827". It changes every
 * minute. A person who wants to use this till on another device types it there: only
 * someone standing at this counter can read it. Customers can ignore it.
 */
type Corner={code:string;device:string;secondsLeft:number};

export default function ScreenCornerCode(){
 const [corner,setCorner]=useState<Corner|null>(null);
 useEffect(()=>{
  let timer:number|undefined,stopped=false;
  const load=async()=>{
   if(stopped)return;
   let wait=30_000;
   try{
    const next=await apiRequest<Corner>('/screens/corner',{method:'POST',body:JSON.stringify({mirrorKey:mirrorDeviceKey(),screenKey:tillDeviceKey()})});
    setCorner(next);
    // Read again just after the minute turns, so the code on screen is always current.
    wait=Math.max(1,next.secondsLeft)*1000+500;
   }catch{setCorner(null);}
   timer=window.setTimeout(()=>void load(),wait);
  };
  void load();
  return ()=>{stopped=true;window.clearTimeout(timer);};
 },[]);
 if(!corner)return null;
 return <div className="paired-screen-corner" aria-label={'Screen code '+corner.code}>
  {corner.device?corner.device+' · ':''}{corner.code}
 </div>;
}
