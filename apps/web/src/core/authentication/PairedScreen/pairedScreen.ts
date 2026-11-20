import {PAIRED_MIRROR,PAIRED_PATH} from '../TillDevice/deviceTill';

/**
 * A paired screen (customer display, order-status screen...). /display pairs it; the screen
 * then opens its app page signed in as the person who paired it.
 *
 * Each display WINDOW is its own screen, with its own screen id, not the browser's device
 * key: two tabs in one browser, two browsers on one PC, or another device are all separate
 * screens. The window keeps its screen in sessionStorage (survives a refresh); the last
 * paired screen is also kept in localStorage so a dedicated display device reconnects after
 * a restart. Only hashes of the screen key are on the server.
 */
export const SCREEN_KEY='md.screen.key';
const SCREEN_ID='md.screen.id';
const WINDOW='md.screen.window';
const keyPattern=/^[A-Za-z0-9_-]{43}$/;
const idPattern=/^[A-Za-z0-9_-]{16,128}$/;
const appPattern=/^[A-Za-z0-9_-]{1,80}$/;
const pagePattern=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const mirrorPattern=/^[A-Za-z0-9_-]{16,128}$/;
export type ScreenAnswer={access_token:string;appId:string;pageApiName:string;deviceName:string;mirrorKey:string;key?:string};
type WindowScreen={id:string;key?:string;path?:string;mirror?:string};

const read=(name:string)=>{try{return window.localStorage.getItem(name)??'';}catch{return '';}};
const write=(name:string,value:string|null)=>{
 try{if(value===null)window.localStorage.removeItem(name);else window.localStorage.setItem(name,value);}catch{/* private window */}
};
function windowScreen():WindowScreen|null{
 try{
  const value=JSON.parse(window.sessionStorage.getItem(WINDOW)??'null') as WindowScreen|null;
  return value&&idPattern.test(value.id)?value:null;
 }catch{return null;}
}
function saveWindow(value:WindowScreen|null){
 try{if(value)window.sessionStorage.setItem(WINDOW,JSON.stringify(value));else window.sessionStorage.removeItem(WINDOW);}
 catch{/* private window */}
}
const newId=()=>{
 const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
 return 'scr_'+Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
};

/** This window's screen id (sent as screenKey): its own, never the browser's device key. */
export function screenWindowId():string{
 const current=windowScreen();
 if(current)return current.id;
 const id=newId();
 saveWindow({id});
 return id;
}
/** The screen key this window signs in with: its own, else (after a restart) the last paired. */
export const savedScreenKey=():string=>{
 const own=windowScreen()?.key;
 if(own&&keyPattern.test(own))return own;
 const last=read(SCREEN_KEY);
 return keyPattern.test(last)?last:'';
};
/** After a restart the window takes the last paired screen's id with its key (corner code). */
export function adoptSavedScreen(){
 const current=windowScreen();
 if(current?.key)return;
 const key=read(SCREEN_KEY),id=read(SCREEN_ID);
 if(keyPattern.test(key)&&idPattern.test(id))saveWindow({id,key,path:read(PAIRED_PATH)||undefined,mirror:read(PAIRED_MIRROR)||undefined});
}
/** /display?new: this window becomes a new screen (a second display in the same browser). */
export function startNewScreen(){saveWindow({id:newId()});}
/** The app page this screen shows (where it opens after pairing or a restart). */
export function screenPagePath(appId:string,pageApiName:string):string{
 return '/une/apps/'+encodeURIComponent(appId)+'/pages/'+encodeURIComponent(pageApiName);
}
/** True on this window's paired screen page: a lost sign-in goes back to /display, not /login. */
export function onPairedScreenPage(pathname=window.location.pathname):boolean{
 const own=windowScreen();
 const path=own?.key?own.path:(savedScreenKey()?read(PAIRED_PATH):'');
 return Boolean(path&&pathname.replace(/\/$/,'')===path);
}
/** Keep what the server sent; returns the page to open. */
export function rememberScreen(answer:ScreenAnswer):string{
 if(!appPattern.test(answer.appId)||!pagePattern.test(answer.pageApiName))throw Error('This screen was paired without a page');
 if(answer.key&&!keyPattern.test(answer.key))throw Error('Invalid screen key');
 const path=screenPagePath(answer.appId,answer.pageApiName);
 const mirror=mirrorPattern.test(answer.mirrorKey)?answer.mirrorKey:'';
 const id=screenWindowId();
 const key=answer.key??windowScreen()?.key??read(SCREEN_KEY);
 saveWindow({id,key,path,mirror:mirror||undefined});
 // The last paired screen, for a restart of a dedicated display device.
 write(SCREEN_KEY,key||null);write(SCREEN_ID,id);write(PAIRED_PATH,path);write(PAIRED_MIRROR,mirror||null);
 return path;
}
/** Unpaired (or the person can no longer sign in): this window forgets the screen. */
export function forgetScreen(){
 const own=windowScreen();
 if(own?.key===read(SCREEN_KEY)||!own?.key){write(SCREEN_KEY,null);write(SCREEN_ID,null);write(PAIRED_PATH,null);write(PAIRED_MIRROR,null);}
 saveWindow(own?{id:own.id}:null);
}

/** A customer must not leave the screen with Back: it stays on its page. */
export function holdScreenPage():()=>void{
 if(typeof window==='undefined')return ()=>undefined;
 const stay=()=>{window.history.pushState({pairedScreen:true},'',window.location.href);};
 stay();
 window.addEventListener('popstate',stay);
 return ()=>window.removeEventListener('popstate',stay);
}
