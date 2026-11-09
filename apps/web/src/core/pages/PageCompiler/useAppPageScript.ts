import {useEffect,useState} from 'react';
import {loadAppPageScript,type LoadedPageScript} from './serverPageScript';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type AppPageScriptState={status:'off'|'loading'|'failed'}|{status:'ready';script:LoadedPageScript};

/** Published pages run their converted file. Anything that fails (old server,
 * network, a page the compiler rejects) falls back to the classic engine.
 * Add ?pageEngine=classic to a page URL to force the classic engine. */
export function useAppPageScript(request:Request,appId:string,page:{apiName:string;layoutVariant?:string}|null,
 enabled:boolean):AppPageScriptState{
 const classic=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('pageEngine')==='classic';
 const active=enabled&&!classic&&Boolean(page);
 const [state,setState]=useState<{page:unknown;value:AppPageScriptState}>({page:null,value:{status:'off'}});
 useEffect(()=>{
  if(!active||!page)return;
  let live=true;
  setState({page,value:{status:'loading'}});
  loadAppPageScript(request,appId,page,page.layoutVariant??'Desktop').then(script=>{
   if(live)setState({page,value:{status:'ready',script}});
  },error=>{
   console.warn('[PageScript] classic engine used:',error instanceof Error?error.message:error);
   if(live)setState({page,value:{status:'failed'}});
  });
  return ()=>{live=false;};
 },[active,page,appId,request]);
 if(!active)return {status:'off'};
 return state.page===page?state.value:{status:'loading'};
}
