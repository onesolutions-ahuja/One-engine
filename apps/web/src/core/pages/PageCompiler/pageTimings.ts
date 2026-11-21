/**
 * Page speed timings, kept in this window only (no network): how long a page takes to
 * show rows (from the local copy and from the server), a tap to change the screen, and
 * a live change to be drawn. Read them in the console: `window.__unePageTimings`
 * (last 50). Set localStorage 'une.timings' to '1' to also log each one.
 */
export type TimingKind='open→local rows'|'open→server rows'|'tap→screen'|'tap→saved'|'live→drawn';
export type PageTiming={page:string;kind:TimingKind;ms:number;at:number;detail?:string};

const LIMIT=50;
const entries:PageTiming[]=[];
const opened=new Map<string,{at:number;seen:Set<TimingKind>}>();
let clock:()=>number=()=>(typeof performance!=='undefined'?performance.now():Date.now());

/** Tests: a fake clock. */
export function setTimingClock(next:()=>number):void{clock=next;}
export function pageTimings():readonly PageTiming[]{return entries;}
export function clearPageTimings():void{entries.length=0;opened.clear();}
export const timingNow=()=>clock();

function record(page:string,kind:TimingKind,ms:number,detail?:string){
 const entry:PageTiming={page,kind,ms:Math.round(ms*10)/10,at:Date.now(),...(detail?{detail}:{})};
 entries.push(entry);
 if(entries.length>LIMIT)entries.splice(0,entries.length-LIMIT);
 try{
  if(typeof window!=='undefined'){
   (window as unknown as Record<string,unknown>).__unePageTimings=entries;
   if(window.localStorage?.getItem('une.timings')==='1')console.debug('[timing]',page,kind,entry.ms+' ms',detail??'');
  }
 }catch{/* storage blocked: the list is still kept */}
}

/** A page starts opening (its runtime is built). */
export function markPageOpen(page:string):void{opened.set(page,{at:clock(),seen:new Set()});}
/** A list of the page drew its rows: the first from the local copy and the first from the server count. */
export function notePageRows(page:string,from:'local'|'server'):void{
 const open=opened.get(page);
 const kind:TimingKind=from==='local'?'open→local rows':'open→server rows';
 if(!open||open.seen.has(kind))return;
 open.seen.add(kind);
 record(page,kind,clock()-open.at);
}
/** A tap started: call the result when the screen shows its change, and again when saved. */
export function startTap(page:string,action:string){
 const started=clock();
 let shown=false;
 return {
  shown(predicted:boolean){if(shown)return;shown=true;record(page,'tap→screen',clock()-started,(predicted?'predicted ':'server ')+action);},
  saved(){record(page,'tap→saved',clock()-started,action);}
 };
}
/** A live change received at `receivedAt` (timingNow()) is on screen now. */
export function noteLiveDrawn(page:string,receivedAt:number,object:string):void{
 record(page,'live→drawn',clock()-receivedAt,object);
}
