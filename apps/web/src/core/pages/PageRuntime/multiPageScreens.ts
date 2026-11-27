import {useEffect,useState} from 'react';

/**
 * SCREEN(page, MultiPage, n): open tab n (the tab's own id, like an Excel sheet id) of a
 * MultiPage on that page. Where the page already shows (this window, the second screen,
 * paired displays) it switches there; a page opened by SCREEN starts on that tab.
 * Requests are keyed by MultiPage name (lower case); each new request has a new `n` so the
 * same tab asked for twice still wins over a tab tapped in between.
 */
export const SCREEN_TAB_EVENT='metadrive:set-multipage-tab';
export type ScreenTabRequest={tab:number;n:number};
export type ScreenTabRequests=Readonly<Record<string,ScreenTabRequest>>;

export function tabNumber(value:unknown):number|null{
 const number=typeof value==='string'&&value.trim()!==''?Number(value):value;
 return typeof number==='number'&&Number.isInteger(number)&&number>=0&&number<=9999?number:null;
}
const PENDING='md.page.tab:';
let counter=0;
const next=()=>++counter;
/** SCREEN(page, MultiPage, n) that opens page here: the page starts on that tab. */
export function rememberRequestedTab(page:string,multiPage:string,tab:number){
 try{window.sessionStorage.setItem(PENDING+page.toLowerCase(),JSON.stringify({[multiPage.toLowerCase()]:tab}));}catch{/* private window */}
}
/** True when the address bar is this page (/…/pages/<page>), or no page is named. */
export function addressShowsPage(page:string,path=window.location.pathname):boolean{
 if(!page)return true;
 const last=decodeURIComponent(path.replace(/\/+$/,'').split('/').pop()??'');
 return last.toLowerCase()===page.toLowerCase();
}
/** Tabs a page opens on: the ones SCREEN asked for, else ?tab=MultiPage:n in its own address. */
export function requestedTabs(page=''):Record<string,ScreenTabRequest>{
 const out:Record<string,ScreenTabRequest>={};
 try{
  const key=PENDING+page.toLowerCase();
  const pending=window.sessionStorage.getItem(key);
  if(pending){
   window.sessionStorage.removeItem(key);
   for(const [name,tab] of Object.entries(JSON.parse(pending) as Record<string,unknown>)){
    const number=tabNumber(tab);if(number!==null)out[name.toLowerCase()]={tab:number,n:next()};
   }
   return out;
  }
  // ?tab= belongs to the page in the address only, never to a popup opened over it.
  if(!addressShowsPage(page))return out;
  for(const value of new URLSearchParams(window.location.search).getAll('tab')){
   const [name,tab]=value.split(':');const number=tabNumber(tab);
   if(name&&number!==null)out[name.toLowerCase()]=({tab:number,n:next()});
  }
 }catch{/* no storage */}
 return out;
}
/** Open tab `tab` of `multiPage` on `page` if that page is open in this window. True when it was. */
export function showMultiPageTab(page:string,multiPage:string,tab:number,mirror=false):boolean{
 return !window.dispatchEvent(new CustomEvent(SCREEN_TAB_EVENT,{cancelable:true,detail:{page,multiPage,tab,mirror}}));
}
/** The tabs SCREEN asked a running page to show: starts from the address and follows showMultiPageTab. */
export function useScreenTabs(pageApiName:string|undefined):ScreenTabRequests{
 const [tabs,setTabs]=useState<ScreenTabRequests>({});
 useEffect(()=>{
  if(!pageApiName)return;
  setTabs(requestedTabs(pageApiName));
  const name=pageApiName.toLowerCase();
  const take=(detail:{page?:unknown;multiPage?:unknown;tab?:unknown;mirror?:unknown}|null|undefined)=>{
   if(String(detail?.page??'').toLowerCase()!==name||typeof detail?.multiPage!=='string')return false;
   const tab=tabNumber(detail.tab);if(tab===null)return false;
   const key=detail.multiPage.toLowerCase();
   // A paired screen re-reads the same tab each time it checks: only a change switches it.
   setTabs(old=>detail.mirror===true&&old[key]?.tab===tab?old:{...old,[key]:{tab,n:next()}});
   return true;
  };
  const onTab=(event:Event)=>{if(take((event as CustomEvent).detail))event.preventDefault();};
  // A window that opened this one (a till and its customer display) can switch it too.
  const onMessage=(event:MessageEvent)=>{
   if(event.origin!==window.location.origin)return;
   const data=event.data as {type?:string}|null;
   if(data?.type===SCREEN_TAB_EVENT)take(data as never);
  };
  window.addEventListener(SCREEN_TAB_EVENT,onTab);
  window.addEventListener('message',onMessage);
  return ()=>{window.removeEventListener(SCREEN_TAB_EVENT,onTab);window.removeEventListener('message',onMessage);};
 },[pageApiName]);
 return tabs;
}
/** Paired screens: the tabs the followed device asked for, keyed "page|multipage". */
export function showMirroredTabs(page:string,tabs:Record<string,unknown>){
 const prefix=page.toLowerCase()+'|';
 for(const [key,tab] of Object.entries(tabs)){
  const number=tabNumber(tab);
  if(key.startsWith(prefix)&&number!==null)showMultiPageTab(page,key.slice(prefix.length),number,true);
 }
}
