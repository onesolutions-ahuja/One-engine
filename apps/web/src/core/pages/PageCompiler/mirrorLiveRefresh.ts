import type {CompiledDataSource} from './compilePage';

/**
 * A customer display shows a sale that ANOTHER screen (the Till) is ringing up, so nothing
 * on the display itself tells it when to read again. Its rows are the ones whose filter
 * names @ThisPage.Device.MirrorKey. While the display is visible those rows, the page's
 * held record sets and the totals over them are read again every couple of seconds,
 * straight from the server (no short-lived read cache), and at once when the display
 * learns which Till it follows. No page setting is needed: reading MirrorKey is the signal.
 */
export const MIRROR_REFRESH_MS=2000;
/** True while this screen follows the mirrored device's current sale (its page session). */
let followingSale=false;
export const followsMirroredSale=():boolean=>followingSale;
export function setFollowingSale(value:boolean){followingSale=value;}
const MIRROR=/@ThisPage\.Device\.MirrorKey/i;

/** A selling page: its rows belong to its own page session (a session-scoped cart, or a
 * filter on @ThisPage.Session.Id such as `session_key__c = @ThisPage.Session.Id`). It tells
 * the server which sale this device is on, so paired screens show that sale only.
 * A display (it reads @ThisPage.Device.MirrorKey anywhere) never sells: its session is the
 * till's sale it follows, so it must not report it as its own. */
export function sellsBySession(sources:readonly CompiledDataSource[],readsMirror=false):boolean{
 if(readsMirror||mirrorSources(sources).length)return false;
 return sources.some(source=>source.scope.kind==='auto'||readsSession(source));
}
const SESSION=/@ThisPage\.Session\.Id\b/i;
const sourceText=(source:CompiledDataSource)=>
 (source.filterFormula??'')+' '+(source.filters==null?'':JSON.stringify(source.filters));
const readsSession=(source:CompiledDataSource)=>SESSION.test(sourceText(source));
/** True when this window was opened by its till with ?screenSession= (SCREEN(page,"second")):
 * it already shares the till's sale. */
export function openedWithScreenSession():boolean{
 try{return /^[0-9a-f-]{36}$/i.test(new URLSearchParams(window.location.search).get('screenSession')??'');}
 catch{return false;}
}
/** One step of following: ask the server which sale the mirrored till is on and move to it.
 * The till may be THIS device (a second monitor on the same computer): it still follows. */
export async function followMirroredSale(deps:{mirrorKey:string;openedWithSession:boolean;
 request:<T>(path:string,init?:RequestInit)=>Promise<T>;sessionId():string;resetSession(next?:string):void;
 /** SCREEN(page, n) run on the mirrored device: the layer each page shows (lower-case page names). */
 onLayers?(layers:Record<string,number>):void;
 onPayment?(payment:Record<string,unknown>|null):void}):Promise<void>{
 if(!deps.mirrorKey){setFollowingSale(deps.openedWithSession);return;}
 const {sessionId,layers,payment}=await deps.request<{sessionId:string;layers?:Record<string,number>;
  payment?:Record<string,unknown>|null}>('/screens/current-session',
  {method:'POST',body:JSON.stringify({mirrorKey:deps.mirrorKey})});
 // No sale reported yet: a window opened by the till already shares its sale.
 setFollowingSale(Boolean(sessionId)||deps.openedWithSession);
 if(sessionId&&sessionId!==deps.sessionId())deps.resetSession(sessionId);
 if(layers&&typeof layers==='object')deps.onLayers?.(layers);
 deps.onPayment?.(payment??null);
}
/** Data sources that show another device's rows: their filter reads MirrorKey, or, on a
 * display (followsSale), the page session, which is the till's current sale. A display cart
 * can then use the till's own filter (`session_key__c = @ThisPage.Session.Id`). */
export function mirrorSources(sources:readonly CompiledDataSource[],followsSale=false):CompiledDataSource[]{
 return sources.filter(source=>MIRROR.test(sourceText(source))||followsSale&&readsSession(source));
}

/** With the live stream up, the display's timer re-reads at most this often. */
export const LIVE_FALLBACK_MS=30_000;
type Target={
 reload(id:string,fresh?:boolean):Promise<void>;
 /** Move to the mirrored device's current sale when it changed (before the rows are read). */
 followSale?():Promise<void>;
 loadSets?():Promise<void>;
 refreshTotals?():Promise<void>|void;
 subscribeDevice?(listener:()=>void):()=>void;
 /** The live stream is up (changes arrive by themselves). */
 isLive?():boolean;
 /** Live events that concern this display: 'screen' (its device changed sale or layer)
  * or 'resync' (the stream came back; anything may have changed). */
 subscribeLive?(listener:(kind:'screen'|'resync')=>void):()=>void;
 /** Taps are on their way (predicted, not answered yet): a re-read now would draw an older
  * saved value over them, so it waits until they are answered. */
 tapsWaiting?():boolean;
};
/** How soon a re-read that waited for taps is tried again. */
export const TAPS_RETRY_MS=150;
type Clock={
 setInterval(run:()=>void,ms:number):unknown;clearInterval(handle:unknown):void;
 visible():boolean;listen(run:()=>void):()=>void;
};
const browserClock=():Clock=>({
 setInterval:(run,ms)=>window.setInterval(run,ms),
 clearInterval:handle=>window.clearInterval(handle as number),
 visible:()=>document.visibilityState==='visible',
 listen(run){
  window.addEventListener('focus',run);document.addEventListener('visibilitychange',run);
  return ()=>{window.removeEventListener('focus',run);document.removeEventListener('visibilitychange',run);};
 }
});

/** Start the display's refresh loop; returns stop. Does nothing for a page that mirrors nothing. */
export function startMirrorLiveRefresh(sources:readonly CompiledDataSource[],codeMirrors:boolean,target:Target,
 clock:Clock=browserClock(),intervalMs=MIRROR_REFRESH_MS):()=>void{
 const display=codeMirrors||mirrorSources(sources).length>0;
 if(!display)return ()=>undefined;
 const mirrored=mirrorSources(sources,true);
 let busy=false,stopped=false;
 let last=0;
 let retry:ReturnType<typeof setTimeout>|null=null;
 const refresh=async()=>{
  // One read at a time: a slow network never piles requests up behind each other.
  if(stopped||busy||!clock.visible())return;
  if(target.tapsWaiting?.()){
   if(!retry)retry=setTimeout(()=>{retry=null;void refresh();},TAPS_RETRY_MS);
   return;
  }
  // Only a read that really ran counts for the live safety net (a hidden tab's skipped
  // ticks must not delay the read once it is shown).
  last=Date.now();
  busy=true;
  try{
   await target.followSale?.().catch(()=>undefined);
   await Promise.all([
    ...mirrored.map(source=>target.reload(source.id,true).catch(()=>undefined)),
    ...(codeMirrors&&target.loadSets?[target.loadSets().catch(()=>undefined)]:[]),
    ...(codeMirrors&&target.refreshTotals?[Promise.resolve(target.refreshTotals()).catch(()=>undefined)]:[])
   ]);
  }finally{busy=false;}
 };
 const tick=()=>{void refresh();};
 // With the live stream up, the Till's changes arrive by themselves: the timer is only a
 // slow safety net. Without it (offline, a proxy that blocks streams) it checks every 2 s.
 // Even with live Object events, a remote customer screen needs the till's layer and
 // receipt state. Follow its lightweight device record, without re-reading cart rows.
 const timed=()=>{
  if(target.isLive?.()&&Date.now()-last<LIVE_FALLBACK_MS){
   if(target.followSale)void follow();return;
  }
  tick();
 };
 const timer=clock.setInterval(timed,intervalMs);
 const unlisten=clock.listen(tick);
 // The server tells a display which Till it follows a moment after the page opens.
 const unsubscribe=target.subscribeDevice?.(tick);
 // Live: the followed device changed sale or layer (SCREEN on the till, often on every tap):
 // only ask which sale and layer; a new sale reloads everything (resetSession), the rows of
 // the same sale come by the live stream. The stream came back: read everything again.
 let following=false;
 const follow=async()=>{
  if(stopped||following)return;
  following=true;
  try{await target.followSale?.().catch(()=>undefined);}finally{following=false;}
 };
 const unsubscribeLive=target.subscribeLive?.(kind=>{if(kind==='screen'&&target.followSale)void follow();else tick();});
 return ()=>{stopped=true;if(retry)clearTimeout(retry);clock.clearInterval(timer);unlisten();unsubscribe?.();unsubscribeLive?.();};
}
