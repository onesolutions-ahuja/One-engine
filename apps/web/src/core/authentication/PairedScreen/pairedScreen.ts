import {PAIRED_MIRROR} from '../TillDevice/deviceTill';

/**
 * A paired screen (customer display, order-status screen...) on this browser. /display
 * pairs it; the screen then opens its app page signed in as the person who paired it.
 * Only this browser holds the screen key; the server keeps its hash.
 */
export const SCREEN_KEY='md.screen.key';
const SCREEN_PATH='md.screen.path';
const keyPattern=/^[A-Za-z0-9_-]{43}$/;
const appPattern=/^[A-Za-z0-9_-]{1,80}$/;
const pagePattern=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const mirrorPattern=/^[A-Za-z0-9_-]{16,128}$/;
export type ScreenAnswer={access_token:string;appId:string;pageApiName:string;deviceName:string;mirrorKey:string;key?:string};

const read=(name:string)=>{try{return window.localStorage.getItem(name)??'';}catch{return '';}};
const write=(name:string,value:string|null)=>{
 try{if(value===null)window.localStorage.removeItem(name);else window.localStorage.setItem(name,value);}catch{/* private window */}
};
export const savedScreenKey=():string=>{const key=read(SCREEN_KEY);return keyPattern.test(key)?key:'';};
/** The app page this screen shows (where it opens after pairing or a restart). */
export function screenPagePath(appId:string,pageApiName:string):string{
 return '/une/apps/'+encodeURIComponent(appId)+'/pages/'+encodeURIComponent(pageApiName);
}
/** True on this browser's paired screen page: a lost sign-in goes back to /display, not /login. */
export function onPairedScreenPage(pathname=window.location.pathname):boolean{
 const path=read(SCREEN_PATH);
 return Boolean(path&&savedScreenKey()&&pathname.replace(/\/$/,'')===path);
}
/** Keep what the server sent; returns the page to open. */
export function rememberScreen(answer:ScreenAnswer):string{
 if(!appPattern.test(answer.appId)||!pagePattern.test(answer.pageApiName))throw Error('This screen was paired without a page');
 if(answer.key){if(!keyPattern.test(answer.key))throw Error('Invalid screen key');write(SCREEN_KEY,answer.key);}
 write(PAIRED_MIRROR,mirrorPattern.test(answer.mirrorKey)?answer.mirrorKey:null);
 const path=screenPagePath(answer.appId,answer.pageApiName);
 write(SCREEN_PATH,path);
 return path;
}
/** Unpaired (or the person can no longer sign in): this browser forgets the screen. */
export function forgetScreen(){write(SCREEN_KEY,null);write(SCREEN_PATH,null);write(PAIRED_MIRROR,null);}

/** A customer must not leave the screen with Back: it stays on its page. */
export function holdScreenPage():()=>void{
 if(typeof window==='undefined')return ()=>undefined;
 const stay=()=>{window.history.pushState({pairedScreen:true},'',window.location.href);};
 stay();
 window.addEventListener('popstate',stay);
 return ()=>window.removeEventListener('popstate',stay);
}
