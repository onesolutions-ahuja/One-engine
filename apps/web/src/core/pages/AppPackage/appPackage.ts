import {apiBase} from '../../authentication/Client/authClient';
import type {CompiledPage} from '../PageCompiler/compilePage';
import type {LoadedPageScript} from '../PageCompiler/serverPageScript';
import {scriptFormulaLibrary,scriptFormulaOperators} from '../PageCompiler/pageScriptHost';
import type {PageCode} from '../PageCompiler/pageCodeRuntime';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import {F,O} from '../../../../../server/src/page-compiler/code/formulaLibrary.js';

/**
 * The published app package: ONE script file per app, kept by the device.
 *
 * When a tenant turns "Run app from published code" on (App Manager), opening the app
 * fetches /apps/<app>/package once and adds the file as a script. Every screen of that app
 * then opens from that file: no page-definition request and no page-script ticket. The file
 * holds the page design only (layout, plan, page code) — records still go through the
 * record API with the user's own access checks.
 *
 * Nothing here runs code from a string: the file is a normal <script src> the CSP allows.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

/** One page inside the package file (written by the server's package builder). */
type PackagePageEntry={page:LightningPageMetadata;css:string;plan:CompiledPage;
 createActions(host:unknown):LoadedPageScript['actions'];
 createFormulas(host:unknown):LoadedPageScript['formulas'];
 createCode?(f:unknown,o:unknown):PageCode;codeVersion?:number};
type PackageFile={version:number;app:string;variant:string;
 pages:Record<string,PackagePageEntry>;css:string};

type Loaded={hash:string;pages:Record<string,PackagePageEntry>;builds:Record<string,string>};
const byApp=new Map<string,Loaded>();
const loading=new Map<string,Promise<boolean>>();
const scripts=new Map<string,{hash:string;value:{page:LightningPageMetadata;script:LoadedPageScript}}>();
const styleElements=new Map<string,HTMLStyleElement>();

const keyOf=(appId:string,variant:string):string=>appId+'\u0000'+variant;

function addStyle(appId:string,variant:string,css:string):void{
 if(typeof document==='undefined'||!css)return;
 const key=keyOf(appId,variant);
 let element=styleElements.get(key);
 if(!element){
  element=document.createElement('style');
  element.setAttribute('data-une-app-package',appId);
  document.head.appendChild(element);
  styleElements.set(key,element);
 }
 if(element.textContent!==css)element.textContent=css;
}

/** Add the package file once (the URL carries the hash, so the browser keeps it). */
function addScript(url:string):Promise<void>{
 return new Promise((resolve,reject)=>{
  if(typeof document==='undefined'){reject(Error('No document'));return;}
  const existing=[...document.querySelectorAll('script[data-une-app-package]')]
   .find(item=>(item as HTMLScriptElement).src.endsWith(url));
  if(existing){resolve();return;}
  const element=document.createElement('script');
  const origin=apiBase.endsWith('/api')?apiBase.slice(0,-4):apiBase;
  element.src=url.startsWith('http')?url:origin+url;
  element.async=false;
  element.setAttribute('data-une-app-package','true');
  element.onload=()=>resolve();
  element.onerror=()=>reject(Error('The published app code is unavailable'));
  document.head.appendChild(element);
 });
}

/**
 * Load (once) the app's published package. Safe to call on every app open: the hash is
 * checked, so nothing is downloaded again unless the app was republished.
 */
export async function loadAppPackage(request:Request,appId:string,variant='Desktop'):Promise<boolean>{
 const key=keyOf(appId,variant);
 const pending=loading.get(key);
 if(pending)return pending;
 const run=(async()=>{
  try{
   const answer=await request<{hash?:string;url?:string;builds?:Record<string,string>}>
    ('/apps/'+encodeURIComponent(appId)+'/package?variant='+encodeURIComponent(variant));
   if(!answer||typeof answer.url!=='string'||!answer.url)return false;
   const hash=String(answer.hash??'');
   const known=byApp.get(key);
   if(known&&known.hash===hash)return true;
   await addScript(answer.url);
   const file=(window as unknown as {__uneAppPackage?:PackageFile}).__uneAppPackage;
   if(!file||!file.pages||file.app!==appId||typeof file.pages!=='object')return false;
   addStyle(appId,variant,String(file.css??''));
   byApp.set(key,{hash,pages:file.pages,builds:answer.builds&&typeof answer.builds==='object'?answer.builds:{}});
   scripts.delete(key+'|');
   return true;
  }catch{return false;}
 })();
 loading.set(key,run);
 try{return await run;}finally{loading.delete(key);}
}

/** The loaded package's page (its saved metadata + plan), or null: the page is fetched as before. */
export function appPackagePage(appId:string,pageApi:string|undefined,variant='Desktop'):
 {page:LightningPageMetadata;script:LoadedPageScript}|null{
 if(!pageApi)return null;
 const key=keyOf(appId,variant);
 const loaded=byApp.get(key);
 if(!loaded)return null;
 const entry=loaded.pages[pageApi];
 if(!entry||!entry.plan)return null;
 const cacheKey=key+'|'+pageApi;
 const cached=scripts.get(cacheKey);
 if(cached&&cached.hash===loaded.hash)return cached.value;
 const host={operators:scriptFormulaOperators,formulaLibrary:scriptFormulaLibrary};
 const code=typeof entry.createCode==='function'?entry.createCode(F,O):undefined;
 const buildId=loaded.builds[pageApi]??'';
 const script:LoadedPageScript={
  apiName:entry.page?.apiName??pageApi,variant,
  revision:Number((entry.plan as {revision?:number}).revision??0),
  plan:entry.plan,
  // The app + build let a button's action run on the server without another page request.
  ...(buildId?{app:{appId,buildId}}:{}),
  actions:entry.createActions(host),formulas:entry.createFormulas(host),...(code?{code}:{})
 };
 const value={page:entry.page,script};
 scripts.set(cacheKey,{hash:loaded.hash,value});
 return value;
}

/** Component types used by every page in the package (to preload their renderers). */
export function appPackageComponentTypes(appId:string,variant='Desktop'):string[]{
 const loaded=byApp.get(keyOf(appId,variant));
 if(!loaded)return [];
 const types=new Set<string>();
 for(const entry of Object.values(loaded.pages))
  for(const component of entry.page?.components??[])
   if(typeof component.type==='string'&&component.type)types.add(component.type);
 return [...types];
}

/** Forget a package (the app was republished and the device must reload it). */
export function forgetAppPackage(appId:string,variant='Desktop'):void{
 const key=keyOf(appId,variant);
 byApp.delete(key);
 for(const cacheKey of [...scripts.keys()])if(cacheKey.startsWith(key+'|'))scripts.delete(cacheKey);
}
