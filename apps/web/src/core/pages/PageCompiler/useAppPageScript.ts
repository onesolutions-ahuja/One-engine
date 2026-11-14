import {useEffect,useState} from 'react';
import {loadAppPageScript,type IssuedAppPageScript,type LoadedPageScript} from './serverPageScript';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type AppPageScriptState={status:'off'|'loading'|'failed'}|{status:'ready';script:LoadedPageScript};
type PageInput={apiName:string;layoutVariant?:string};

/** Converted page files already loaded in this browser tab. Reopening a page or
 * popup, zooming or resizing reuses the same file instead of asking the server
 * to convert the page again (three round trips before any data loads). */
const MAX_SCRIPTS=60;
const byPage=new WeakMap<object,string>();
/** Script tickets the server issued together with a page (single use, ~60 s). */
const issuedWith=new WeakMap<object,{issued:IssuedAppPageScript;at:number}>();
export function primeAppPageScript(page:object,issued:IssuedAppPageScript|null):void{
 if(issued)issuedWith.set(page,{issued,at:Date.now()});
}
const scripts=new Map<string,{promise:Promise<LoadedPageScript>;script?:LoadedPageScript}>();
function scriptKey(appId:string,page:PageInput,variant:string):string{
 const known=byPage.get(page);
 if(known!==undefined&&known.startsWith(appId+'\u0000'+variant+'\u0000'))return known;
 const key=appId+'\u0000'+variant+'\u0000'+JSON.stringify(page);
 byPage.set(page,key);
 return key;
}
function loadScript(request:Request,appId:string,page:PageInput,variant:string,key:string){
 const hit=scripts.get(key);
 if(hit){scripts.delete(key);scripts.set(key,hit);return hit;}
 const primed=issuedWith.get(page);
 issuedWith.delete(page);
 const issued=primed&&Date.now()-primed.at<50_000?primed.issued:null;
 const entry:{promise:Promise<LoadedPageScript>;script?:LoadedPageScript}={promise:loadAppPageScript(request,appId,page,variant,issued)};
 entry.promise.then(script=>{entry.script=script;},()=>{if(scripts.get(key)===entry)scripts.delete(key);});
 if(scripts.size>=MAX_SCRIPTS)scripts.delete(scripts.keys().next().value!);
 scripts.set(key,entry);
 return entry;
}

/** Published pages run their converted file. Anything that fails (old server,
 * network, a page the compiler rejects) falls back to the classic engine.
 * Add ?pageEngine=classic to a page URL to force the classic engine. */
export function useAppPageScript(request:Request,appId:string,page:PageInput|null,
 enabled:boolean):AppPageScriptState{
 const classic=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('pageEngine')==='classic';
 const active=enabled&&!classic&&Boolean(page);
 const variant=page?.layoutVariant??'Desktop';
 const key=active&&page?scriptKey(appId,page,variant):'';
 const ready=key?scripts.get(key)?.script:undefined;
 const [state,setState]=useState<{key:string;value:AppPageScriptState}>({key:'',value:{status:'off'}});
 useEffect(()=>{
  if(!key||!page||ready)return;
  let live=true;
  loadScript(request,appId,page,variant,key).promise.then(script=>{
   if(live)setState({key,value:{status:'ready',script}});
  },error=>{
   console.warn('[PageScript] classic engine used:',error instanceof Error?error.message:error);
   if(live)setState({key,value:{status:'failed'}});
  });
  return ()=>{live=false;};
 },[key,page,ready,appId,variant,request]);
 if(!active)return {status:'off'};
 // Already converted in this tab: run it straight away, no loading screen.
 if(ready)return {status:'ready',script:ready};
 return state.key===key?state.value:{status:'loading'};
}
