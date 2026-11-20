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

/** Data sources that show another device's rows (their filter reads MirrorKey). */
export function mirrorSources(sources:readonly CompiledDataSource[]):CompiledDataSource[]{
 return sources.filter(source=>{
  const text=(source.filterFormula??'')+' '+(source.filters==null?'':JSON.stringify(source.filters));
  return MIRROR.test(text);
 });
}

type Target={
 reload(id:string,fresh?:boolean):Promise<void>;
 /** Move to the mirrored device's current sale when it changed (before the rows are read). */
 followSale?():Promise<void>;
 loadSets?():Promise<void>;
 refreshTotals?():Promise<void>|void;
 subscribeDevice?(listener:()=>void):()=>void;
};
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
 const mirrored=mirrorSources(sources);
 if(!mirrored.length&&!codeMirrors)return ()=>undefined;
 let busy=false,stopped=false;
 const refresh=async()=>{
  // One read at a time: a slow network never piles requests up behind each other.
  if(stopped||busy||!clock.visible())return;
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
 const timer=clock.setInterval(tick,intervalMs);
 const unlisten=clock.listen(tick);
 // The server tells a display which Till it follows a moment after the page opens.
 const unsubscribe=target.subscribeDevice?.(tick);
 return ()=>{stopped=true;clock.clearInterval(timer);unlisten();unsubscribe?.();};
}
