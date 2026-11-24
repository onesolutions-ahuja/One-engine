/**
 * Shared-till saved sign-ins on this device. Each entry holds a random device key from the
 * server (never a password or PIN). The key + that person's PIN gives them their own session.
 */
export type TillPerson={userId:string;name:string;key:string;expiresAt:string};
const PEOPLE='md.till.people';
const ACTIVE='md.till.active';
const STASH='md.till.cart.';
const PAGE_SESSION='metadrive-page-session:';
export const TILL_MAX_PEOPLE=8;
export const TILL_LOCK_EVENT='md:till-lock';
const LOCK_APPS='md.till.lockApps';
const LOCKED='md.till.locked';
const appInPath=/^\/une\/apps\/([A-Za-z][A-Za-z0-9_]*)(?:\/|$)/;

const read=(storage:Storage|undefined,key:string)=>{try{return storage?.getItem(key)??null;}catch{return null;}};
const write=(storage:Storage|undefined,key:string,value:string|null)=>{
 try{if(value===null)storage?.removeItem(key);else storage?.setItem(key,value);}catch{/* storage can be disabled */}
};
const local=()=>typeof window==='undefined'?undefined:window.localStorage;
const tab=()=>typeof window==='undefined'?undefined:window.sessionStorage;

export function tillPeople():TillPerson[]{
 try{
  const list=JSON.parse(read(local(),PEOPLE)??'[]') as TillPerson[];
  const now=Date.now();
  return Array.isArray(list)?list.filter(p=>p&&typeof p.key==='string'&&typeof p.userId==='string'
   &&Date.parse(p.expiresAt)>now).slice(0,TILL_MAX_PEOPLE):[];
 }catch{return [];}
}
const savePeople=(list:TillPerson[])=>write(local(),PEOPLE,list.length?JSON.stringify(list):null);
/** Newest first; one entry per person; at most TILL_MAX_PEOPLE. */
export function saveTillPerson(person:TillPerson){
 const rest=tillPeople().filter(p=>p.userId!==person.userId);
 savePeople([person,...rest].slice(0,TILL_MAX_PEOPLE));
 setActiveTillUser(person.userId);
}
/** Removes the person here; the caller also tells the server so the key stops working. */
export function forgetTillPerson(userId:string):TillPerson|undefined{
 const list=tillPeople();
 const person=list.find(p=>p.userId===userId);
 savePeople(list.filter(p=>p.userId!==userId));
 write(tab(),STASH+userId,null);
 if(activeTillUser()===userId)setActiveTillUser(null);
 return person;
}
export const activeTillUser=()=>read(tab(),ACTIVE);
export const setActiveTillUser=(userId:string|null)=>write(tab(),ACTIVE,userId);
/** Move this tab's page sessions (open cart etc.) aside for the person who is locking. */
export function stashTillWork(userId:string|null){
 const store=tab();if(!store)return;
 const saved:Record<string,string>={};
 try{
  for(let i=store.length-1;i>=0;i--){
   const key=store.key(i);
   if(key?.startsWith(PAGE_SESSION)){saved[key]=store.getItem(key)??'';store.removeItem(key);}
  }
 }catch{return;}
 if(userId&&Object.keys(saved).length)write(store,STASH+userId,JSON.stringify(saved));
}
/** Bring back the person's own page sessions, so their open cart comes back with them. */
export function restoreTillWork(userId:string){
 const store=tab();if(!store)return;
 stashTillWork(null);
 try{
  const saved=JSON.parse(read(store,STASH+userId)??'{}') as Record<string,string>;
  for(const [key,value] of Object.entries(saved))if(key.startsWith(PAGE_SESSION))store.setItem(key,value);
 }catch{/* nothing saved */}
 write(store,STASH+userId,null);
}
export const initials=(name:string)=>name.split(/[\s._-]+/).filter(Boolean).slice(0,2).map(p=>p[0]!.toUpperCase()).join('')||'?';
/** LOCKSCREEN() action and the till's Lock button. */
export function lockTillScreen(){
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(TILL_LOCK_EVENT));
}

type LockApp={apiName:string;lockScreen?:{enabled:boolean;idleMinutes:number}};
/** Remember (on this device) which apps have the lock screen on, so it also works while signed out. */
export function rememberAppLocks(apps:LockApp[]){
 const on:Record<string,number>={};
 for(const app of apps)if(app?.lockScreen?.enabled)on[app.apiName]=Math.max(0,Number(app.lockScreen.idleMinutes)||0);
 write(local(),LOCK_APPS,Object.keys(on).length?JSON.stringify(on):null);
}
/** The lock-screen app whose page is open here, or undefined (Page Builder, Setup, apps without the lock). */
export function appLockHere(pathname=typeof window==='undefined'?'':window.location.pathname):{app:string;idleMinutes:number}|undefined{
 const app=appInPath.exec(pathname)?.[1];
 if(!app)return undefined;
 try{
  const on=JSON.parse(read(local(),LOCK_APPS)??'{}') as Record<string,number>;
  return typeof on[app]==='number'?{app,idleMinutes:on[app]}:undefined;
 }catch{return undefined;}
}
/** Set when this tab was locked (LOCKSCREEN(), Lock button, idle); cleared on sign-in. */
export const tillLocked=()=>read(tab(),LOCKED)==='1';
export const setTillLocked=(locked:boolean)=>write(tab(),LOCKED,locked?'1':null);
/** The PIN lock applies on this screen: a lock-screen app's page, or this tab was just locked. */
export const tillLockApplies=()=>Boolean(appLockHere())||tillLocked();
