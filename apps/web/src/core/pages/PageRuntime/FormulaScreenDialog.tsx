import * as React from 'react';
import type {PopupScreen} from './screenFormula';

const modalStyles=`dialog.formula-screen-modal{padding:0;border:0;border-radius:12px;overflow:auto;scrollbar-gutter:stable;
 max-width:94vw;max-height:94vh;box-shadow:0 24px 64px rgba(0,0,0,.35);background:#fff}
dialog.formula-screen-modal::backdrop{background:rgba(15,23,42,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
dialog.formula-screen-modal>.formula-screen-close{position:absolute;top:8px;right:8px;z-index:2;width:36px;height:36px;
 border:0;border-radius:50%;background:rgba(15,23,42,.08);font-size:20px;line-height:36px;cursor:pointer}
dialog.formula-screen-modal.formula-screen-page{width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;border-radius:0;box-shadow:none}
dialog.formula-screen-modal.formula-screen-page::backdrop{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}
.formula-screen-page{display:flex;flex-direction:column;background:#fff}
.formula-screen-page>.formula-screen-bar{flex:0 0 auto;display:flex;align-items:center;height:48px;padding:0 8px;
 border-bottom:1px solid rgba(15,23,42,.1);background:#fff}
.formula-screen-page>.formula-screen-bar>button{display:inline-flex;align-items:center;gap:4px;min-height:40px;padding:0 10px;
 border:0;border-radius:8px;background:transparent;color:#2563eb;font-family:inherit;font-size:16px;font-weight:600;line-height:1;cursor:pointer}
.formula-screen-page>.formula-screen-body{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain}
.formula-screen-frame{position:absolute;inset:0;z-index:1200}
.formula-screen-frame-backdrop{position:absolute;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;
 background:rgba(15,23,42,.45)}
.formula-screen-frame-backdrop>.formula-screen-card{position:relative;max-width:94%;max-height:94%;overflow:auto;scrollbar-gutter:stable;
 border-radius:12px;background:#fff;box-shadow:0 24px 64px rgba(0,0,0,.35)}
.formula-screen-card>.formula-screen-close{position:absolute;top:8px;right:8px;z-index:2;width:36px;height:36px;
 border:0;border-radius:50%;background:rgba(15,23,42,.08);font-size:20px;line-height:36px;cursor:pointer}`;

/** Phones show a SCREEN(...,popup) page as a full-screen page with Back, not a popup. */
const phoneWidth=()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'
 &&window.matchMedia('(max-width: 599px)').matches;

/** Popup width that keeps the popup page's canvas aspect inside the viewport. */
export function formulaScreenWidth(canvas?:{canvasWidth?:number;canvasHeight?:number}){
 const width=Number(canvas?.canvasWidth),height=Number(canvas?.canvasHeight);
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return '85vw';
 // 4px under the 94vh cap: the scaled canvas rounds its height up, and touching
 // the cap made a scrollbar flicker on and off.
 return `min(94vw, ${Math.round(width)}px, calc((94vh - 4px) * ${(width/height).toFixed(4)}))`;
}

/** macOS-style genie: the popup pinches into the bottom centre (and grows back out). */
const GENIE:Keyframe[]=[
 {transform:'translateY(0) scale(1,1)',clipPath:'polygon(0 0,100% 0,100% 100%,0 100%)',opacity:1},
 {transform:'translateY(12%) scale(.86,.9)',clipPath:'polygon(0 0,100% 0,64% 100%,36% 100%)',opacity:1,offset:.45},
 {transform:'translateY(60vh) scale(.06,.12)',clipPath:'polygon(32% 0,68% 0,52% 100%,48% 100%)',opacity:0}
];
const reducedMotion=()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'
 &&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function genie(el:HTMLElement|null|undefined,closing:boolean,done?:()=>void){
 if(!el||typeof el.animate!=='function'||reducedMotion()){done?.();return;}
 el.style.transformOrigin='50% 100%';
 const animation=el.animate(closing?GENIE:[...GENIE].reverse().map(frame=>frame.offset===undefined?frame:{...frame,offset:1-Number(frame.offset)}),
  {duration:closing?300:340,easing:closing?'cubic-bezier(.5,0,.75,.15)':'cubic-bezier(.2,.8,.3,1)',fill:closing?'forwards':'none'});
 if(!done)return;
 let finished=false;
 const finish=()=>{if(!finished){finished=true;done();}};
 animation.onfinish=finish;animation.oncancel=finish;
 window.setTimeout(finish,450);
}

/**
 * Formula SCREEN(...,popup) host. Popups are true modals: the rest of the page is
 * blurred and inert until the popup closes (Close button, Escape or CLOSESCREEN()).
 * Print previews keep the non-modal dialog used by the print stylesheet.
 */
export function FormulaScreenDialog({screen,canvas,onClose,children,frameDevice}:{
 screen:PopupScreen;canvas?:{canvasWidth?:number;canvasHeight?:number};
 onClose:()=>void;children:React.ReactNode;
 /** Set when the popup opens inside the Builder's Phone/Tablet Preview screen. */
 frameDevice?:string
}){
 const inFrame=frameDevice==='Phone'||frameDevice==='Tablet';
 // On a phone (or the Phone Preview screen) a popup is a page you go Back from.
 const [fullPage]=React.useState(()=>frameDevice==='Phone'||(!inFrame&&phoneWidth()));
 const ref=React.useRef<HTMLDialogElement>(null);
 const frameRef=React.useRef<HTMLDivElement>(null);
 const closing=React.useRef(false);
 const popupBox=()=>inFrame?frameRef.current?.querySelector<HTMLElement>('.formula-screen-card'):ref.current;
 // Every close path (×, Back, Escape, CLOSESCREEN) plays the genie, then closes.
 const animatedClose=()=>{
  if(closing.current)return;
  closing.current=true;
  if(fullPage||screen.print)onClose();else genie(popupBox(),true,onClose);
 };
 const close=React.useRef(animatedClose);
 close.current=animatedClose;
 React.useEffect(()=>{if(!fullPage&&!screen.print)genie(popupBox(),false);},[]);
 React.useEffect(()=>{
  const dialog=ref.current;
  // A print preview opened from a popup (Reprint receipt) must sit above that popup,
  // so it is also shown as a modal (top layer) rather than a plain open dialog.
  if(!dialog||inFrame)return;
  try{if(!dialog.open)dialog.showModal();}catch{dialog.setAttribute('open','');}
  return ()=>{try{dialog.close();}catch{/* already closed */}};
 },[inFrame]);
 React.useEffect(()=>{
  // Inside the Preview screen there is no native dialog: Escape closes it here.
  if(!inFrame||screen.print)return;
  const key=(event:KeyboardEvent)=>{
   if(event.key!=='Escape')return;
   // Only the top (last opened) popup closes.
   const open=document.querySelectorAll('[data-formula-screen-frame]');
   if(open[open.length-1]!==frameRef.current)return;
   event.preventDefault();close.current();
  };
  window.addEventListener('keydown',key);
  return ()=>window.removeEventListener('keydown',key);
 },[inFrame,screen.print]);
 React.useEffect(()=>{
  // CLOSESCREEN() inside the popup page targets this popup by its runtime instance.
  const closeRequest=(event:Event)=>{
   const detail=(event as CustomEvent<{pageSessionKey?:string}>).detail;
   if(detail?.pageSessionKey!==screen.instance)return;
   event.preventDefault();
   close.current();
  };
  window.addEventListener('metadrive:close-formula-screen',closeRequest);
  return ()=>window.removeEventListener('metadrive:close-formula-screen',closeRequest);
 },[screen.instance]);
 if(screen.print)return <dialog ref={inFrame?undefined:ref} open={inFrame||undefined} className="formula-print-preview" aria-label={screen.page}
  onCancel={event=>{event.preventDefault();screen.failed?.(Error('Preview closed'));onClose();}}
  style={{width:formulaScreenWidth(canvas),maxHeight:'90vh',overflow:'auto',padding:16,border:0,borderRadius:12,background:'#fff'}}>
  <button type="button" onClick={()=>{screen.failed?.(Error('Preview closed'));onClose();}}>Close</button>
  <button type="button" onClick={()=>window.print()}>Print / Save PDF</button>
  {children}
 </dialog>;
 const back=<div className="formula-screen-bar">
  <button type="button" aria-label="Back" onClick={()=>close.current()}><span aria-hidden="true">‹</span> Back</button>
 </div>;
 if(inFrame)return fullPage
  ?<div ref={frameRef} data-formula-screen-frame="" className="formula-screen-frame formula-screen-page" role="dialog" aria-modal="true" aria-label={screen.page}>
    <style>{modalStyles}</style>{back}<div className="formula-screen-body">{children}</div>
   </div>
  :<div ref={frameRef} data-formula-screen-frame="" className="formula-screen-frame-backdrop" role="presentation">
    <style>{modalStyles}</style>
    <div className="formula-screen-card" role="dialog" aria-modal="true" aria-label={screen.page}
     style={{width:formulaScreenWidth(canvas)}}>
     <button type="button" className="formula-screen-close" aria-label="Close" onClick={()=>close.current()}>×</button>
     {children}
    </div>
   </div>;
 return <dialog ref={ref} className={'formula-screen-modal'+(fullPage?' formula-screen-page':'')}
  aria-label={screen.page} aria-modal="true"
  style={fullPage?undefined:{width:formulaScreenWidth(canvas)}}
  onCancel={event=>{event.preventDefault();close.current();}}>
  <style>{modalStyles}</style>
  {fullPage?<>{back}<div className="formula-screen-body">{children}</div></>:<>
   <button type="button" className="formula-screen-close" aria-label="Close" onClick={()=>close.current()}>×</button>
   {children}</>}
 </dialog>;
}
