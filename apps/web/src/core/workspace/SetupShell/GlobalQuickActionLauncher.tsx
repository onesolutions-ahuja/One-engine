import * as React from 'react';
import {useEffect,useState} from 'react';
import type {LibraryComponentMetadata} from '../../metadata/Definitions/metadata';
import type {AppRoute} from '../Navigation/appRouting';
import {Plus} from 'lucide-react';

const ComponentOverlay=React.lazy(()=>import('../../records/QuickActionComponentOverlay'));
type Action={id:string;label:string;behavior:'Create Record'|'Run Flow'|'Open Component'|'Send Email';
 targetObjectApi?:string};
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

export default function GlobalQuickActionLauncher({
 request,onNavigate,onLaunchFlow,libraryComponents,appId
}:{
 request:Request;
 onNavigate:(route:AppRoute)=>void;
 onLaunchFlow:(flow:string,inputs?:Record<string,unknown>)=>void;
 libraryComponents:LibraryComponentMetadata[];
 appId?:string;
}){
 const [actions,setActions]=useState<Action[]>([]);
 const [expanded,setExpanded]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [component,setComponent]=useState<{
   label:string;presentation:'Modal'|'Side Panel';
   definition:LibraryComponentMetadata;inputs:Record<string,unknown>
 }|null>(null);
 useEffect(()=>{
   let active=true;
   void request<{actions:Action[]}>('/actions/global').then(result=>{
     if(active)setActions((result.actions??[]).filter(a=>a.behavior!=='Send Email'));
   }).catch(()=>{if(active)setActions([]);});
   return()=>{active=false;};
 },[request]);
 const launch=async(action:Action)=>{
   setExpanded(false);setError('');
   if(action.behavior==='Create Record'){
     if(!action.targetObjectApi)return;
     onNavigate({kind:'record-list',objectApiName:action.targetObjectApi,
       appId:appId??'Records',globalCreation:{actionId:action.id}});
     return;
   }
   setBusy(true);
   try{
     if(action.behavior==='Run Flow'){
       const result=await request<{flowApiName:string;inputs:Record<string,unknown>}>(
         `/actions/global/${encodeURIComponent(action.id)}/flow-launch`);
       onLaunchFlow(result.flowApiName,result.inputs);
       return;
     }
     if(action.behavior==='Open Component'){
       const result=await request<{componentApiName:string;presentation:'Modal'|'Side Panel';
         definition?:LibraryComponentMetadata|null;inputs:Record<string,unknown>}>(
           `/actions/global/${encodeURIComponent(action.id)}/component-launch`);
       const definition=result.definition??libraryComponents.find(c=>
         c.apiName===result.componentApiName&&c.status!=='Draft');
       if(!definition)throw Error('Published Component is unavailable');
       setComponent({label:action.label,presentation:result.presentation,
         definition,inputs:result.inputs});
     }
   }catch(cause){
     setError(cause instanceof Error?cause.message:'Quick Action could not start');
   }finally{setBusy(false);}
 };
 return <>
   {actions.length>0&&<div style={{position:'relative'}}>
     <button type="button" className="btn" aria-label="Global actions"
       aria-haspopup="menu" aria-expanded={expanded} disabled={busy}
       onClick={()=>setExpanded(value=>!value)}><Plus size={14}/> Actions</button>
     {expanded&&<div role="menu" aria-label="Global Quick Actions" className="surface"
       style={{position:'absolute',right:0,top:'100%',zIndex:30,minWidth:190,
         padding:8,boxShadow:'0 8px 24px rgba(0,0,0,.14)',borderRadius:8}}>
       {actions.map(action=><button type="button" className="btn" role="menuitem"
         style={{display:'block',width:'100%',textAlign:'left'}} key={action.id}
         onClick={()=>void launch(action)}>{action.label}</button>)}
     </div>}
   </div>}
   {error&&<span role="alert" className="records-message">{error}</span>}
   {component&&<React.Suspense fallback={<div role="status">Loading action…</div>}>
     <ComponentOverlay {...component} onClose={()=>setComponent(null)}
       onLaunchFlow={onLaunchFlow}/>
   </React.Suspense>}
 </>;
}
