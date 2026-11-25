import {screenPagePath} from '../PairedScreen/pairedScreen';

/**
 * Guest links (/guest/<token>, e.g. a table's QR code): open one app page with no sign-in,
 * as that record's guest. The link is kept on this device so a guest page whose session
 * ended (or a table tablet after a restart) opens the same link again, never /login.
 */
const TOKEN='md.guest.token';
const PATH='md.guest.path';
const tokenPattern=/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/;
const appPattern=/^[A-Za-z0-9_-]{1,80}$/;
const pagePattern=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
export type GuestAnswer={access_token:string;appId:string;pageApiName:string;recordId:string;objectApiName:string};

const read=(name:string)=>{try{return window.localStorage.getItem(name)??'';}catch{return '';}};
const write=(name:string,value:string|null)=>{
 try{if(value===null)window.localStorage.removeItem(name);else window.localStorage.setItem(name,value);}catch{/* private window */}
};
/** The token in /guest/<token>, or ''. */
export function guestTokenFromPath(pathname=window.location.pathname):string{
 const match=/^\/guest\/([^/?#]+)\/?$/.exec(pathname);
 return match&&tokenPattern.test(match[1])?match[1]:'';
}
/** Keep the link and its page; returns the page to open. */
export function rememberGuest(token:string,answer:GuestAnswer):string{
 if(!appPattern.test(answer.appId)||!pagePattern.test(answer.pageApiName))throw Error('This link has no page');
 const path=screenPagePath(answer.appId,answer.pageApiName);
 write(TOKEN,token);write(PATH,path);
 return path;
}
/** The link no longer works: forget it. */
export function forgetGuest(){write(TOKEN,null);write(PATH,null);}
/** True on the guest page this device opened from its link. */
export function onGuestPage(pathname=window.location.pathname):boolean{
 const path=read(PATH);
 return Boolean(path&&tokenPattern.test(read(TOKEN))&&pathname.replace(/\/$/,'')===path);
}
/** On the guest page, sign-in refresh and sign-out use the guest's own cookie, so a guest link
 * opened in a browser never replaces the staff sign-in there (and the reverse). */
export const guestSessionHeaders=():Record<string,string>=>onGuestPage()?{'X-Une-Guest':'1'}:{};
/** Where a guest page whose sign-in ended goes: its own link again. */
export const guestLinkPath=():string=>{const token=read(TOKEN);return tokenPattern.test(token)?'/guest/'+token:'';};
