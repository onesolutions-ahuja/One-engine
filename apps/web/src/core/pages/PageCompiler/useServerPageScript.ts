import {useEffect,useState} from 'react';
import {loadServerPageScript,type LoadedPageScript} from './serverPageScript';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type ServerPageScriptState=
 |{status:'off'}
 |{status:'loading'}
 |{status:'ready';script:LoadedPageScript}
 |{status:'failed';error:string};

/** Load the server-built file for a saved page revision (Preview). */
export function useServerPageScript(request:Request,apiName:string,variant:string,revision:number|null,
 enabled:boolean):ServerPageScriptState{
 const key=enabled&&revision!==null?[apiName,variant,revision].join('|'):'';
 const [state,setState]=useState<{key:string;value:ServerPageScriptState}>({key:'',value:{status:'off'}});
 useEffect(()=>{
  if(!key)return;
  let active=true;
  setState({key,value:{status:'loading'}});
  loadServerPageScript(request,apiName,variant).then(script=>{
   if(!active)return;
   setState({key,value:script.revision===revision?{status:'ready',script}
    :{status:'failed',error:'The server has a different saved version of this page. Save again.'}});
  },error=>{
   if(active)setState({key,value:{status:'failed',error:error instanceof Error?error.message:'Unable to load the page script'}});
  });
  return ()=>{active=false;};
 },[key,request]);
 if(!key)return {status:'off'};
 return state.key===key?state.value:{status:'loading'};
}
