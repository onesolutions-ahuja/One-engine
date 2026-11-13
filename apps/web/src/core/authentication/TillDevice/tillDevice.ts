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
