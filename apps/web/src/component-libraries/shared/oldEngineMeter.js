/** Counts what still runs on the previous formula engine, per kind and formula text,
 * so it can be converted and then removed. Read in the browser: window.__uneOldEngine. */
export function noteOldEngine(kind,source){
 try{
  const g=globalThis,meter=g.__uneOldEngine||(g.__uneOldEngine={});
  const key=kind+' | '+String(source??'').slice(0,160);
  meter[key]=(meter[key]||0)+1;
 }catch{/* metering never breaks a page */}
}
