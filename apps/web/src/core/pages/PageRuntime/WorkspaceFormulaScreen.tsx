import * as React from 'react';
import {createPortal} from 'react-dom';
import type {PopupScreen} from './screenFormula';
import {FormulaScreenDialog} from './FormulaScreenDialog';

type Request={appId:string;screen:PopupScreen};
export default function WorkspaceFormulaScreen({render}:{render:(request:Request)=>React.ReactNode}){
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
  const close=()=>setRequests(current=>current.filter(item=>item!==request));
  return createPortal(<FormulaScreenDialog screen={screen} onClose={close}>
    <React.Suspense fallback={null}>{render(request)}</React.Suspense>
   </FormulaScreenDialog>,document.body,screen.instance);
 })}</>;
}
