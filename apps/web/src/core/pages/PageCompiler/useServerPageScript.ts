import {useEffect,useMemo,useState} from 'react';
import {loadPreviewPageScript,type LoadedPageScript} from './serverPageScript';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type ServerPageScriptState=
 |{status:'off'}
 |{status:'loading'}
 |{status:'ready';script:LoadedPageScript}
 |{status:'failed';error:string};

/** Preview: the server converts the page exactly as the Builder shows it (no Save
 * needed) and Preview runs that converted file. Re-converts when the page changes. */
export function useServerPageScript(request:Request,page:{apiName:string},variant:string,enabled:boolean):ServerPageScriptState{
 const draft=useMemo(()=>enabled?JSON.stringify(page):'',[enabled,page]);
 const key=draft?variant+'|'+draft.length+'|'+hash(draft):'';
 const [state,setState]=useState<{key:string;value:ServerPageScriptState}>({key:'',value:{status:'off'}});
 useEffect(()=>{
  if(!key)return;
  let active=true;
  setState({key,value:{status:'loading'}});
  loadPreviewPageScript(request,JSON.parse(draft) as {apiName:string},variant).then(script=>{
   if(active)setState({key,value:{status:'ready',script}});
  },error=>{
   if(active)setState({key,value:{status:'failed',error:error instanceof Error?error.message:'Unable to convert the page'}});
  });
  return ()=>{active=false;};
 },[key,request]);
 if(!key)return {status:'off'};
 return state.key===key?state.value:{status:'loading'};
}
function hash(text:string):string{
 let h=2166136261;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(36);
}
