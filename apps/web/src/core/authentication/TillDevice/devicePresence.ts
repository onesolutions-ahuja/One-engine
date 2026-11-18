/**
 * Keeps one connection open while the app is open in this tab (any page), so the server
 * knows this device's open sale is still being worked on (device-presence-service).
 * Started once per tab; reconnects after a drop; ends when the tab closes.
 */
import {apiStream} from '../Client/authClient';
import {tillDeviceKey} from './deviceTill';

let started=false;
export function startDevicePresence():void{
 if(started||typeof window==='undefined')return;
 const key=tillDeviceKey();
 if(!key)return;
 started=true;
 void (async()=>{
  for(;;){
   try{
    const response=await apiStream('/device-presence?key='+encodeURIComponent(key),new AbortController().signal);
    const reader=response.body?.getReader();
    if(reader)while(!(await reader.read()).done){/* pings only */}
   }catch{/* offline or signed out: try again shortly */}
   await new Promise(resolve=>window.setTimeout(resolve,10_000));
  }
 })();
}
