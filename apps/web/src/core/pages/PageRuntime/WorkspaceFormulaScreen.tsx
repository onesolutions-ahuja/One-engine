import * as React from 'react';
import {createPortal} from 'react-dom';
import type {PopupScreen} from './screenFormula';
import {FormulaScreenDialog} from './FormulaScreenDialog';

type Request={appId:string;screen:PopupScreen};
/** Device of the Builder Preview screen the popup opened in ('Phone'/'Tablet'), if any. */
type RenderRequest=Request&{frameDevice?:string};
/** Size of the popup's page canvas, so a popup is as wide as the page it shows (not 85% of the screen). */
type CanvasOf=(page:string)=>{canvasWidth?:number;canvasHeight?:number}|undefined;
export default function WorkspaceFormulaScreen({render,canvasOf}:{render:(request:RenderRequest)=>React.ReactNode;canvasOf?:CanvasOf}){
 const [requests,setRequests]=React.useState<Request[]>([]);
 React.useEffect(()=>{
  const open=(event:Event)=>{
   const detail=(event as CustomEvent<Request>).detail;
   event.preventDefault();
   setRequests(current=>[...current,detail]);
  };
  window.addEventListener('metadrive:workspace-formula-screen',open);
  return ()=>window.removeEventListener('metadrive:workspace-formula-screen',open);
 },[]);
 return <>{requests.map(request=>{
  const {screen}=request;
  const close=()=>{
   setRequests(current=>current.filter(item=>item!==request));
   // The popup saved records under its own page session; reload the page that
   // opened it (cart totals, lists) so it shows what the popup changed.
   if(screen.parentKey&&!screen.print)window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',
    {detail:{pageSessionKey:screen.parentKey,sessionId:screen.sessionId}}));
  };
  // Builder Preview of a Phone/Tablet layout: open inside the device screen.
  const host=typeof document!=='undefined'
   ?document.querySelector<HTMLElement>('[data-formula-screen-host]'):null;
  return createPortal(<FormulaScreenDialog screen={screen} onClose={close} canvas={canvasOf?.(screen.page)}
    frameDevice={host?.dataset.device}>
    <React.Suspense fallback={null}>{render({...request,frameDevice:host?.dataset.device})}</React.Suspense>
   </FormulaScreenDialog>,host??document.body,screen.instance);
 })}</>;
}
