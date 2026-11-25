import {tillDeviceKey} from '../../authentication/TillDevice/deviceTill';
import {ensureTillDialogStyles} from './tillPickerScreen';
import {ensureSecondScreen,openSecondScreen} from './screenFormula';

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

/** PAIRDISPLAY(Page): screens for this device. PAIRGUEST(App, RecordId): a record's tablet (a table's):
 * it signs in as that record's guest, never as the person pairing it, and shows App's guest page. */
export async function showScreenPairing(request:Request,appId:string,pageApiName:string,
 guest?:{recordId:string}):Promise<void>{
 const forGuest=guest?{guestRecordId:guest.recordId}:{};
 if(typeof document==='undefined')return;
 ensureTillDialogStyles();
 const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{
  const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;
 };
 const button=(text:string,className='')=>{const node=make('button',text,className);node.type='button';return node;};
 const dialog=make('dialog','','une-till-picker une-pair-screens');
 dialog.setAttribute('aria-modal','true');
 dialog.setAttribute('aria-labelledby','une-pair-screen-title');
 const title=make('h2',guest?'Tablets for this table':'Customer displays');title.id='une-pair-screen-title';
 const help=make('p','On the other screen open '+window.location.host+'/display, then type the code it shows.');
 const input=make('input','','une-pair-input');input.inputMode='numeric';input.maxLength=4;input.autocomplete='off';
 input.placeholder='0000';input.setAttribute('aria-label','4-digit code from the screen');
 const name=make('input','','une-pair-name');name.maxLength=60;name.placeholder=guest?'Name, e.g. Table 3 tablet':'Name, e.g. Counter';
 name.setAttribute('aria-label','Screen name (optional)');
 const pair=button('Pair','une-primary');
 const addRow=make('div','','une-pair-add');addRow.append(input,name,pair);
 // This device only: open the display on this computer's second monitor when the till opens.
 const auto=make('label','','une-pair-auto');
 const autoBox=make('input');autoBox.type='checkbox';autoBox.checked=autoOpenPage(appId)===pageApiName;
 auto.append(autoBox,make('span',"Open on this computer's second screen"));
 autoBox.addEventListener('change',()=>{
  setAutoOpen(appId,autoBox.checked?pageApiName:'');
  if(autoBox.checked)void openCustomerDisplay(pageApiName,'');
 });
 const list=make('ul','','une-pair-list');
 const footer=make('footer');
 const close=button('Close');
 footer.append(close);
 const say=(text:string,error=false)=>{help.className=error?'une-till-error':'';help.textContent=text;};

 const refresh=async()=>{
  try{
   const answer=await post<{screens:Screen[]}>(request,'/screens/list',forGuest);
   list.replaceChildren();
   if(!answer.screens.length)list.append(make('li',guest?'No tablets paired yet.':'No displays paired yet.','une-pair-empty'));
   for(const screen of answer.screens){
    const item=make('li');
    const dot=make('span','',screen.online?'une-dot une-online':'une-dot');dot.setAttribute('aria-hidden','true');
    const label=make('span',screen.name,'une-pair-screen-name');
    const status=make('span',screen.online?'Online':when(screen.lastSeenAt),'une-pair-status');
    const rename=button('Rename');
    const unpair=button('Unpair','une-danger');
    rename.addEventListener('click',()=>{
     const box=make('input','','une-pair-name');box.maxLength=60;box.value=screen.name;
     box.setAttribute('aria-label','New name for '+screen.name);
     const save=button('Save','une-primary');
     const done=async()=>{
      save.disabled=true;
      try{await post(request,'/screens/rename',{id:screen.id,name:box.value});void refresh();}
      catch(error){say(reason(error,'The screen could not be renamed'),true);save.disabled=false;}
     };
     save.addEventListener('click',()=>void done());
     box.addEventListener('keydown',event=>{if(event.key==='Enter')void done();if(event.key==='Escape')void refresh();});
     label.replaceWith(box);rename.replaceWith(save);box.focus();box.select();
    });
    unpair.addEventListener('click',async()=>{
     unpair.disabled=true;
     try{await post(request,'/screens/revoke',{id:screen.id});say(screen.name+' unpaired. It shows a new code now.');void refresh();}
     catch(error){say(reason(error,'The screen could not be unpaired'),true);unpair.disabled=false;}
    });
    item.append(dot,label,status,rename,unpair);list.appendChild(item);
   }
  }catch(error){say(reason(error,'Set this device up first'),true);}
 };
 pair.addEventListener('click',async()=>{
  const code=input.value.trim();
  if(!/^\d{4}$/.test(code)){say('Type the 4 digits shown on the screen',true);input.focus();return;}
  pair.disabled=true;
  try{
   await post(request,'/screens/approve',{code,name:name.value.trim(),appId,pageApiName,...forGuest});
   input.value='';name.value='';say('Paired. The screen opens in a moment.');void refresh();
  }catch(error){say(reason(error,'That code did not work'),true);input.select();}
  finally{pair.disabled=false;}
 });
 input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,4);});
 input.addEventListener('keydown',event=>{if(event.key==='Enter')pair.click();});
 name.addEventListener('keydown',event=>{if(event.key==='Enter')pair.click();});
 const shut=()=>{dialog.close();dialog.remove();};
 close.addEventListener('click',shut);
 dialog.addEventListener('cancel',shut);
 dialog.append(...(guest?[title,help,addRow,list,footer]:[title,help,addRow,auto,list,footer]));
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
type BridgeDetail={action?:unknown;code?:unknown;name?:unknown;page?:unknown;id?:unknown;on?:unknown;
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
    case 'autoOpen:get':return autoOpenPage(currentAppId())===String(detail.page??'');
    case 'autoOpen:set':setAutoOpen(currentAppId(),detail.on===true?String(detail.page??''):'');
     // Turned On by a click: open it now too (a click is allowed to open a window).
     if(detail.on===true)void openCustomerDisplay(String(detail.page??''),'');
     return autoOpenPage(currentAppId())!=='';
    default:throw Error('Unknown screen action');
   }
  };
  run().then(value=>reply({ok:true,value}),error=>reply({ok:false,error:reason(error,'Screens are unavailable')}));
 });
}

/**
 * "Customer display on second screen" (per device, On/Off, default Off): when On, this
 * device's till opens the display page on its second monitor every time it loads. Off: no
 * window, no load (single-screen tills). Kept on this device only (localStorage).
 */
const AUTO_OPEN='md.screen.autoOpen';
const pagePattern=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
function autoOpenSettings():Record<string,string>{
 try{const value=JSON.parse(window.localStorage.getItem(AUTO_OPEN)??'{}');return value&&typeof value==='object'?value:{};}
 catch{return {};}
}
export function autoOpenPage(appId:string):string{
 const page=autoOpenSettings()[appId];
 return typeof page==='string'&&pagePattern.test(page)?page:'';
}
export function setAutoOpen(appId:string,page:string){
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(appId))return;
 const settings=autoOpenSettings();
 if(pagePattern.test(page))settings[appId]=page;else delete settings[appId];
 try{window.localStorage.setItem(AUTO_OPEN,JSON.stringify(settings));}catch{/* private window */}
}
const pagePath=(appId:string,page:string)=>'/une/apps/'+encodeURIComponent(appId)+'/pages/'+encodeURIComponent(page);
async function openCustomerDisplay(page:string,sessionId:string):Promise<void>{
 const appId=currentAppId();
 if(!appId||!pagePattern.test(page))return;
 if(await ensureSecondScreen(pagePath(appId,page),sessionId))return;
 // The browser blocked the window (no click yet, or pop-ups not allowed): one button.
 if(document.getElementById('une-open-display'))return;
 const button=document.createElement('button');
 button.id='une-open-display';button.type='button';
 button.textContent='Open customer display';
 button.title='Allow pop-ups for this site to open it automatically';
 Object.assign(button.style,{position:'fixed',right:'16px',bottom:'16px',zIndex:'2147483000',padding:'10px 14px',
  border:'0',borderRadius:'10px',background:'#007aff',color:'#fff',font:'600 14px -apple-system,Segoe UI,sans-serif',
  boxShadow:'0 4px 16px rgba(0,0,0,.18)',cursor:'pointer'});
 button.addEventListener('click',()=>{void openSecondScreen(pagePath(appId,page),sessionId);button.remove();});
 document.body.appendChild(button);
}
let autoOpened=false;
/** On a selling page: open this device's customer display if its setting is On. */
export function autoOpenCustomerDisplay(sessionId:string){
 if(autoOpened||typeof window==='undefined')return;
 const page=autoOpenPage(currentAppId());
 if(!page)return;
 autoOpened=true;
 void openCustomerDisplay(page,sessionId);
}
