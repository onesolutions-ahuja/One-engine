import * as React from 'react';
import type {PopupScreen} from './screenFormula';

const modalStyles=`dialog.formula-screen-modal{padding:0;border:0;border-radius:12px;overflow:auto;
 max-width:94vw;max-height:94vh;box-shadow:0 24px 64px rgba(0,0,0,.35);background:#fff}
dialog.formula-screen-modal::backdrop{background:rgba(15,23,42,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
dialog.formula-screen-modal>.formula-screen-close{position:absolute;top:8px;right:8px;z-index:2;width:36px;height:36px;
 border:0;border-radius:50%;background:rgba(15,23,42,.08);font-size:20px;line-height:36px;cursor:pointer}`;

/** Popup width that keeps the popup page's canvas aspect inside the viewport. */
export function formulaScreenWidth(canvas?:{canvasWidth?:number;canvasHeight?:number}){
 const width=Number(canvas?.canvasWidth),height=Number(canvas?.canvasHeight);
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return '85vw';
 return `min(94vw, ${Math.round(width)}px, calc(94vh * ${(width/height).toFixed(4)}))`;
}

/**
 * Formula SCREEN(...,popup) host. Popups are true modals: the rest of the page is
 * blurred and inert until the popup closes (Close button, Escape or CLOSESCREEN()).
 * Print previews keep the non-modal dialog used by the print stylesheet.
 */
export function FormulaScreenDialog({screen,canvas,onClose,children}:{
 screen:PopupScreen;canvas?:{canvasWidth?:number;canvasHeight?:number};
 onClose:()=>void;children:React.ReactNode
}){
 const ref=React.useRef<HTMLDialogElement>(null);
 const close=React.useRef(onClose);
 close.current=onClose;
 React.useEffect(()=>{
  const dialog=ref.current;
  if(!dialog||screen.print)return;
  try{if(!dialog.open)dialog.showModal();}catch{dialog.setAttribute('open','');}
  return ()=>{try{dialog.close();}catch{/* already closed */}};
 },[screen.print]);
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
 if(screen.print)return <dialog open className="formula-print-preview" aria-label={screen.page}
  style={{position:'fixed',inset:0,zIndex:1200,width:'85vw',height:'85vh',overflow:'auto'}}>
  <button type="button" onClick={()=>{screen.failed?.(Error('Preview closed'));onClose();}}>Close</button>
  <button type="button" onClick={()=>window.print()}>Print / Save PDF</button>
  {children}
 </dialog>;
 return <dialog ref={ref} className="formula-screen-modal" aria-label={screen.page} aria-modal="true"
  style={{width:formulaScreenWidth(canvas)}}
  onCancel={event=>{event.preventDefault();onClose();}}>
  <style>{modalStyles}</style>
  <button type="button" className="formula-screen-close" aria-label="Close" onClick={onClose}>×</button>
  {children}
 </dialog>;
}
