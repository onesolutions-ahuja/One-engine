/**
 * Which Till this device is (@ThisPage.Till.*). People sign in on any device (BYOD), so
 * the DEVICE, not the person, decides the Till and its Location (the number prefix).
 *  - Device key: the installed app passes the OS vendor id (window.__uneDeviceKey);
 *    a browser makes a random key once and keeps it here. It is not a secret.
 *  - The server maps the key to a Till (Till.DeviceKey). Until a device is set up, the
 *    till page asks once "Which till is this?".
 */
export type DeviceTill={Id:string;Name:string;Code:string;Location:string;LocationCode:string};
export type DeviceTillChoice={Id:string;Name:string;Code:string;Location:string};
export type DeviceTillState={status:'unknown'|'loading'|'set'|'unset'|'error';till:DeviceTill|null;
 tills:DeviceTillChoice[];error?:string;
 /** The device whose sale this screen shows (a customer display: its Till's key). */
 mirrorKey?:string};
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

const KEY='md.device.key';
const pattern=/^[A-Za-z0-9_-]{16,128}$/;
let state:DeviceTillState={status:'unknown',till:null,tills:[]};
const listeners=new Set<()=>void>();
const publish=(next:DeviceTillState)=>{state=next;listeners.forEach(listener=>listener());};
let loading:Promise<DeviceTillState>|null=null;

export function tillDeviceKey():string{
 const injected=typeof window==='undefined'?undefined:(window as {__uneDeviceKey?:unknown}).__uneDeviceKey;
 if(typeof injected==='string'&&pattern.test(injected))return injected;
 try{
  const saved=window.localStorage.getItem(KEY);
  if(saved&&pattern.test(saved))return saved;
  const made=crypto.randomUUID();
  window.localStorage.setItem(KEY,made);
  return made;
 }catch{return '';}
}
export const deviceTillState=()=>state;
/** A customer display opened from a till ("Open display", SCREEN(…, "second")) shows that
 * till's sale: the opener passes its own key as ?mirror=, kept for reloads of this window.
 * It wins over the server's guess, so no setup is needed for a display opened this way. */
const MIRROR='md.device.mirror';
export function openerMirrorKey():string{
 try{
  const fromUrl=new URLSearchParams(window.location.search).get('mirror');
  if(fromUrl&&pattern.test(fromUrl)){window.sessionStorage.setItem(MIRROR,fromUrl);return fromUrl;}
  const saved=window.sessionStorage.getItem(MIRROR);
  if(saved&&pattern.test(saved))return saved;
  // A screen paired at /display follows the device it was paired with, across restarts.
  const paired=window.localStorage.getItem(PAIRED_MIRROR);
  return paired&&pattern.test(paired)?paired:'';
 }catch{return '';}
}
/** Set by /display when a till pairs this screen (see pairedScreen.ts). */
export const PAIRED_MIRROR='md.screen.mirror';
/** @ThisPage.Device.MirrorKey in the browser: the opening till, else what the server says, else this device. */
export function mirrorDeviceKey():string{return openerMirrorKey()||state.mirrorKey||tillDeviceKey();}
export function subscribeDeviceTill(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
/** @ThisPage.Till.<field> as the browser knows it ('' until known; the server decides on save). */
export function deviceTillValue(field:string):string{
 const value=state.till?.[field as keyof DeviceTill];
 return typeof value==='string'?value:'';
}

/** Ask the server once per page load (again after a set-up). */
export function loadDeviceTill(request:Request,force=false):Promise<DeviceTillState>{
 if(loading&&!force)return loading;
 if(!force&&(state.status==='set'||state.status==='unset'))return Promise.resolve(state);
 const deviceKey=tillDeviceKey();
 publish({...state,status:'loading'});
 loading=request<{till:DeviceTill|null;tills?:DeviceTillChoice[];mirrorKey?:string}>('/till-device/current',
  {method:'POST',body:JSON.stringify({deviceKey})})
  .then(answer=>{publish({status:answer.till?'set':'unset',till:answer.till,tills:answer.tills??[],
   mirrorKey:typeof answer.mirrorKey==='string'&&pattern.test(answer.mirrorKey)?answer.mirrorKey:undefined});return state;})
  .catch(error=>{publish({status:'error',till:null,tills:[],error:error instanceof Error?error.message:'Till unavailable'});return state;})
  .finally(()=>{loading=null;});
 return loading;
}

/** Set this device up as one Till (needs edit access to Till, e.g. a manager). */
export async function assignDeviceTill(request:Request,tillId:string,takeoverCode=''):Promise<DeviceTill>{
 const answer=await request<{till:DeviceTill}>('/till-device/assign',
  {method:'POST',body:JSON.stringify({deviceKey:tillDeviceKey(),tillId,...(takeoverCode?{takeoverCode}:{})})});
 publish({status:'set',till:answer.till,tills:[]});
 return answer.till;
}

/** Tests only. */
export function resetDeviceTillForTests(next:DeviceTillState={status:'unknown',till:null,tills:[]}){state=next;loading=null;}
