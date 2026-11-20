import {tillDeviceKey} from '../../authentication/TillDevice/deviceTill';
import {ensureTillDialogStyles} from './tillPickerScreen';

/**
 * PAIRDISPLAY(Page) on a till, kiosk or any app device: pair a screen that shows /display.
 * The person types the 4-digit code from that screen; the screen then shows Page of this
 * app, signed in as this person and following this device's sale. The same box lists the
 * screens paired with this device, each with Unpair.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Screen={id:string;name:string;pageApiName:string;pairedAt:string;lastSeenAt:string|null;online:boolean};

const post=<T>(request:Request,path:string,body:Record<string,unknown>)=>
 request<T>(path,{method:'POST',body:JSON.stringify({deviceKey:tillDeviceKey(),...body})});
const reason=(error:unknown,fallback:string)=>error instanceof Error&&error.message?error.message:fallback;
const when=(iso:string|null)=>{
 if(!iso)return 'not opened yet';
 const minutes=Math.round((Date.now()-Date.parse(iso))/60000);
 return minutes<2?'online':minutes<60?minutes+' min ago':new Date(iso).toLocaleString([],{dateStyle:'short',timeStyle:'short'});
};

export async function showScreenPairing(request:Request,appId:string,pageApiName:string):Promise<void>{
 if(typeof document==='undefined')return;
 ensureTillDialogStyles();
 const dialog=document.createElement('dialog');
 dialog.className='une-till-picker';
 dialog.setAttribute('aria-modal','true');
 dialog.setAttribute('aria-labelledby','une-pair-screen-title');
 const title=document.createElement('h2');title.id='une-pair-screen-title';title.textContent='Pair a screen';
 const help=document.createElement('p');
 help.textContent='On the other screen open '+window.location.host+'/display, then type the code it shows.';
 const input=document.createElement('input');
 input.className='une-pair-input';input.inputMode='numeric';input.maxLength=4;input.autocomplete='off';
 input.setAttribute('aria-label','4-digit code from the screen');
 const list=document.createElement('ul');
 const footer=document.createElement('footer');
 const close=document.createElement('button');close.type='button';close.textContent='Close';
 const pair=document.createElement('button');pair.type='button';pair.textContent='Pair';
 footer.append(close,pair);
 const say=(text:string,error=false)=>{help.className=error?'une-till-error':'';help.textContent=text;};

 const refresh=async()=>{
  list.replaceChildren();
  try{
   const answer=await post<{screens:Screen[]}>(request,'/screens/list',{});
   for(const screen of answer.screens){
    const item=document.createElement('li');
    const unpair=document.createElement('button');unpair.type='button';
    unpair.textContent='Unpair '+screen.name+' ('+(screen.online?'online':when(screen.lastSeenAt))+')';
    unpair.addEventListener('click',async()=>{
     unpair.disabled=true;
     try{await post(request,'/screens/revoke',{id:screen.id});say('Screen unpaired. It shows a new code now.');void refresh();}
     catch(error){say(reason(error,'The screen could not be unpaired'),true);unpair.disabled=false;}
    });
    item.appendChild(unpair);list.appendChild(item);
   }
  }catch(error){say(reason(error,'Set this device up first'),true);}
 };
 pair.addEventListener('click',async()=>{
  const code=input.value.trim();
  if(!/^\d{4}$/.test(code)){say('Type the 4 digits shown on the screen',true);input.focus();return;}
  pair.disabled=true;
  try{
   await post(request,'/screens/approve',{code,appId,pageApiName});
   input.value='';say('Paired. The screen opens in a moment.');void refresh();
  }catch(error){say(reason(error,'That code did not work'),true);input.select();}
  finally{pair.disabled=false;}
 });
 input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,4);});
 input.addEventListener('keydown',event=>{if(event.key==='Enter')pair.click();});
 close.addEventListener('click',()=>{dialog.close();dialog.remove();});
 dialog.append(title,help,input,list,footer);
 document.body.appendChild(dialog);
 dialog.showModal();
 input.focus();
 void refresh();
}

/**
 * The Smart Paired Screens component (component libraries never call the API themselves)
 * asks Core through one window event: list, add, rename or unpair the screens of this
 * device, for the app whose page is open. Installed once per browser tab.
 */
export const PAIRED_SCREENS_EVENT='metadrive:paired-screens';
type BridgeDetail={action?:unknown;code?:unknown;name?:unknown;page?:unknown;id?:unknown;
 reply?:(result:{ok:true;value:unknown}|{ok:false;error:string})=>void};
let bridged=false;
const currentAppId=()=>{
 const match=/^\/une\/apps\/([^/]+)\//.exec(window.location.pathname);
 return match?decodeURIComponent(match[1]):'';
};
export function installPairedScreensBridge(request:Request):void{
 if(bridged||typeof window==='undefined')return;
 bridged=true;
 window.addEventListener(PAIRED_SCREENS_EVENT,event=>{
  const detail=(event as CustomEvent<BridgeDetail>).detail;
  if(!detail||typeof detail.reply!=='function')return;
  const reply=detail.reply;
  const run=async():Promise<unknown>=>{
   switch(detail.action){
    case 'list':return (await post<{screens:Screen[]}>(request,'/screens/list',{})).screens;
    case 'add':return post(request,'/screens/approve',{code:detail.code,name:detail.name,appId:currentAppId(),pageApiName:detail.page});
    case 'rename':return post(request,'/screens/rename',{id:detail.id,name:detail.name});
    case 'revoke':return post(request,'/screens/revoke',{id:detail.id});
    default:throw Error('Unknown screen action');
   }
  };
  run().then(value=>reply({ok:true,value}),error=>reply({ok:false,error:reason(error,'Screens are unavailable')}));
 });
}
