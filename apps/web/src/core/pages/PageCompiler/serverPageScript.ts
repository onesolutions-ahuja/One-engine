import {apiBase} from '../../authentication/Client/authClient';
import type {CompiledPage} from './compilePage';
import {scriptFormulaLibrary,scriptFormulaOperators} from './pageScriptHost';

/**
 * Loads the page's server-built compiled.js (fix 4). The server builds it from
 * the SAVED page; the browser loads it as a script from this site, which the
 * strict Content-Security-Policy allows. A one-time ticket stands in for the
 * login token, which a script request cannot carry.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type CompiledActionFn=(ctx:Record<string,unknown>,event:Record<string,unknown>)=>Promise<unknown>;
export type PageScriptModule={
 plan:CompiledPage;
 PLANS:Record<string,{formula:string;serverDataSteps:number;totalSteps:number;writes:string[]}>;
 createActions(host:unknown):Record<string,CompiledActionFn>;
 createFormulas(host:unknown):Record<string,(ctx:unknown)=>unknown>;
};
export type LoadedPageScript={apiName:string;variant:string;revision:number;plan:CompiledPage;
 /** Set when the file was converted from the Builder's current (unsaved) page. */
 previewId?:string;
 actions:Record<string,CompiledActionFn>;formulas:Record<string,(ctx:unknown)=>unknown>};

const ticketPattern=/^[A-Za-z0-9_-]{43}$/;
async function scriptUrl(request:Request,apiName:string,variant:string):Promise<string>{
 const {ticket}=await request<{ticket?:string}>('/pages/'+encodeURIComponent(apiName)+'/script-ticket',
  {method:'POST',body:JSON.stringify({variant})});
 if(typeof ticket!=='string'||!ticketPattern.test(ticket))throw Error('The server did not issue a page script ticket');
 return apiBase+'/page-scripts/'+ticket+'.js';
}
/** Host the compiled file runs on: the shared Une formula library. */
const host={operators:scriptFormulaOperators,formulaLibrary:scriptFormulaLibrary};

export async function loadServerPageScript(request:Request,apiName:string,variant:string):Promise<LoadedPageScript>{
 const url=await scriptUrl(request,apiName,variant);
 const module=await import(/* @vite-ignore */ url) as Partial<PageScriptModule>;
 const plan=module.plan;
 if(!plan||plan.apiName!==apiName||typeof module.createActions!=='function'||typeof module.createFormulas!=='function'
   ||typeof plan.revision!=='number')throw Error('The server page script is not valid for this page');
 return {apiName,variant,revision:plan.revision,plan,actions:module.createActions(host),formulas:module.createFormulas(host)};
}
/** Convert the page exactly as the Builder shows it now (no Save needed) and load it. */
async function previewTicket(request:Request,page:unknown,apiName:string,variant:string):Promise<{url:string;previewId:string}>{
 const answer=await request<{ticket?:string;previewId?:string}>('/pages/'+encodeURIComponent(apiName)+'/preview-script',
  {method:'POST',body:JSON.stringify({variant,page})});
 if(typeof answer.ticket!=='string'||!ticketPattern.test(answer.ticket)||typeof answer.previewId!=='string')
  throw Error('The server did not convert this page');
 return {url:apiBase+'/page-scripts/'+answer.ticket+'.js',previewId:answer.previewId};
}
export async function loadPreviewPageScript(request:Request,page:{apiName:string},variant:string):Promise<LoadedPageScript>{
 const {url,previewId}=await previewTicket(request,page,page.apiName,variant);
 const module=await import(/* @vite-ignore */ url) as Partial<PageScriptModule>;
 const plan=module.plan;
 if(!plan||plan.apiName!==page.apiName||typeof module.createActions!=='function'||typeof module.createFormulas!=='function')
  throw Error('The server page script is not valid for this page');
 return {apiName:page.apiName,variant,revision:typeof plan.revision==='number'?plan.revision:0,plan,previewId,
  actions:module.createActions(host),formulas:module.createFormulas(host)};
}
/** The exact bytes of the Preview file (same draft → same file). */
export async function fetchPreviewPageScriptSource(request:Request,page:{apiName:string},variant:string):Promise<string>{
 const {url}=await previewTicket(request,page,page.apiName,variant);
 const response=await fetch(url,{credentials:'omit'});
 if(!response.ok)throw Error('Unable to download the page script ('+response.status+')');
 return response.text();
}
/** The exact bytes Preview runs, for Download. */
export async function fetchServerPageScriptSource(request:Request,apiName:string,variant:string):Promise<string>{
 const response=await fetch(await scriptUrl(request,apiName,variant),{credentials:'omit'});
 if(!response.ok)throw Error('Unable to download the page script ('+response.status+')');
 return response.text();
}
