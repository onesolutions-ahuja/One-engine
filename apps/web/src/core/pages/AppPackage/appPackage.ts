import {apiBase} from '../../authentication/Client/authClient';
import type {CompiledPage} from '../PageCompiler/compilePage';
import type {LoadedPageScript} from '../PageCompiler/serverPageScript';
import type {PageCode} from '../PageCompiler/pageCodeRuntime';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import * as React from 'react';
import {F,O} from '../../../../../server/src/page-compiler/code/formulaLibrary.js';
import {screenFromCode,type PackageScreenCode} from '../../../../../server/src/page-compiler/source/pageSourceShape.js';

/**
 * The published app package: ONE script file per app, kept by the device.
 *
 * When a tenant turns "Run app from published code" on (App Manager), opening the app
 * fetches /apps/<app>/package once and adds the file as a script. The file is the app's
 * pages AS CODE (each page's .tsx, .formulas.ts, .actions.ts, .data.ts and .css, as
 * published or as a developer edited them). A screen runs its Page(): its <Smart> elements
 * are the components drawn, its formulas and actions are what run. No page definition and
 * no page script is fetched. Records still go through the record API with the user's own
 * access checks; the server runs its own copy of each action.
 *
 * Nothing here runs code from a string: the file is a normal <script src> the CSP allows.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

/** One screen inside the package file: its code (bundled) and the plan the server built from it. */
type PackagePageEntry=PackageScreenCode&{plan:CompiledPage};
type Device='Desktop'|'Tablet'|'Mobile'|'Custom';
/** Which screen each page opens on each layout: decided by the server's own page rules. */
type Routes={app:Record<string,Partial<Record<Device,string>>>;inScreen:Record<string,Partial<Record<Device,string>>>;
 custom:Record<string,{key:string;min:number;max:number}>};
type PackageFile={version:number;app:string;screens:Record<string,PackagePageEntry>;routes?:Routes};

type Loaded={hash:string;pages:Record<string,PackagePageEntry>;routes:Routes;builds:Record<string,string>};
/** One package per app holds every layout. */
const PACKAGE_VARIANT='All';
const files=new Map<string,PackageFile>();
const changeListeners=new Set<()=>void>();
/** Something on the device shows a package screen: tell it when the app was republished. */
export function subscribeAppPackage(listener:()=>void):()=>void{
 changeListeners.add(listener);
 return ()=>{changeListeners.delete(listener);};
}
const byApp=new Map<string,Loaded>();
const loading=new Map<string,Promise<boolean>>();
const scripts=new Map<string,{hash:string;value:{page:LightningPageMetadata;script:LoadedPageScript}}>();

const keyOf=(appId:string,variant:string):string=>appId+'\u0000'+variant;

/** <Smart> in a page's .tsx: describes one component (the runtime draws it, so it renders nothing itself). */
export function Smart():null{return null;}
/** What a page's code may import: React, <Smart> and the formula library (nothing is bundled twice). */
function provideModules():void{
 const holder=window as unknown as {__une?:{modules?:Record<string,unknown>}};
 holder.__une??={};
 holder.__une.modules={...(holder.__une.modules??{}),react:React,'@une/smart':{Smart},'@une/formula-library':{F,O}};
}

/** Add the package file once (the URL carries the hash, so the browser keeps it) and keep
 * what it defined for that URL (another app's package may load after it). */
function addScript(url:string):Promise<PackageFile|null>{
 const kept=files.get(url);
 if(kept)return Promise.resolve(kept);
 return new Promise((resolve,reject)=>{
  if(typeof document==='undefined'){reject(Error('No document'));return;}
  provideModules();
  const element=document.createElement('script');
  const origin=apiBase.endsWith('/api')?apiBase.slice(0,-4):apiBase;
  element.src=url.startsWith('http')?url:origin+url;
  element.async=false;
  element.setAttribute('data-une-app-package','true');
  element.onload=()=>{
   const holder=window as unknown as {__uneAppPackage?:PackageFile};
   const file=holder.__uneAppPackage??null;
   delete holder.__uneAppPackage;
   element.remove();
   if(file)files.set(url,file);
   resolve(file);
  };
  element.onerror=()=>{element.remove();reject(Error('The published app code is unavailable'));};
  document.head.appendChild(element);
 });
}

/**
 * Load (once) the app's published package. Safe to call on every app open: the hash is
 * checked, so nothing is downloaded again unless the app was republished.
 */
export async function loadAppPackage(request:Request,appId:string):Promise<boolean>{
 const key=keyOf(appId,PACKAGE_VARIANT);
 const pending=loading.get(key);
 if(pending)return pending;
 const run=(async()=>{
  try{
   const answer=await request<{hash?:string;url?:string;builds?:Record<string,string>}>
    ('/apps/'+encodeURIComponent(appId)+'/package');
   if(!answer||typeof answer.url!=='string'||!answer.url)return false;
   const hash=String(answer.hash??'');
   const known=byApp.get(key);
   if(known&&known.hash===hash)return true;
   const file=await addScript(answer.url);
   if(!file||file.version!==3||file.app!==appId||!file.screens||typeof file.screens!=='object'||!file.routes)return false;
   byApp.set(key,{hash,pages:file.screens,routes:file.routes,
    builds:answer.builds&&typeof answer.builds==='object'?answer.builds:{}});
   watchRepublish(request,appId);
   if(known)for(const listener of [...changeListeners])listener();
   return true;
  }catch{return false;}
 })();
 loading.set(key,run);
 try{return await run;}finally{loading.delete(key);}
}

/** A page of the app was published: the package was rebuilt in the same save, so fetch the
 * new one (shortly after, a burst of publishes is one fetch). Screens switch to it at once. */
const watching=new Set<string>();
function watchRepublish(request:Request,appId:string):void{
 if(watching.has(appId))return;
 watching.add(appId);
 let timer:ReturnType<typeof setTimeout>|undefined;
 void import('../PageCompiler/liveChanges').then(live=>live.subscribeLiveChanges(event=>{
  if(event.kind!=='page'||event.page.published===null)return;
  const loaded=byApp.get(keyOf(appId,PACKAGE_VARIANT));
  if(!loaded||!Object.values(loaded.pages).some(entry=>entry.page?.apiName===event.page.page))return;
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>{void loadAppPackage(request,appId);},300);
 })).catch(()=>watching.delete(appId));
}

/** The package screen key the server would answer for this page, layout and window width. */
function routeKey(routes:Routes,pageApi:string,layout:string,inScreen:boolean,viewportWidth?:number):string|undefined{
 const device=(['Desktop','Tablet','Mobile','Custom'].includes(layout)?layout:'Desktop') as Device;
 if(inScreen)return routes.inScreen[pageApi]?.[device];
 const custom=routes.custom[pageApi];
 const width=Number(viewportWidth);
 if(device!=='Custom'&&custom&&Number.isInteger(width)&&width>=320&&width<=10000
  &&width>=custom.min&&width<=custom.max)return custom.key;
 return routes.app[pageApi]?.[device];
}

/** The loaded package's page (its saved metadata + plan), or null: the page is fetched as before. */
export function appPackagePage(appId:string,pageApi:string|undefined,
 options:{layout:string;inScreen:boolean;viewportWidth?:number}):
 {page:LightningPageMetadata;script:LoadedPageScript}|null{
 if(!pageApi)return null;
 const key=keyOf(appId,PACKAGE_VARIANT);
 const loaded=byApp.get(key);
 if(!loaded)return null;
 const screen=routeKey(loaded.routes,pageApi,options.layout,options.inScreen,options.viewportWidth);
 const entry=screen?loaded.pages[screen]:undefined;
 if(!screen||!entry||!entry.plan)return null;
 const cacheKey=key+'|'+screen;
 const cached=scripts.get(cacheKey);
 if(cached&&cached.hash===loaded.hash)return cached.value;
 // Run the screen's code: Page() gives the components, its files the formulas and actions.
 let made:ReturnType<typeof screenFromCode>;
 try{made=screenFromCode(entry,Smart);}
 catch(error){console.error('[AppPackage] screen code failed: '+screen,error);return null;}
 if(made.issues.length)console.warn('[AppPackage] '+screen+': '+made.issues.join('; '));
 const page=made.page as unknown as LightningPageMetadata;
 const variant=String((page as {layoutVariant?:string}).layoutVariant??options.layout);
 const buildId=loaded.builds[screen]??'';
 const script:LoadedPageScript={
  apiName:page.apiName??pageApi,variant,
  revision:Number((entry.plan as {revision?:number}).revision??0),
  plan:entry.plan,
  // The app + build let a button's action run on the server without another page request.
  ...(buildId?{app:{appId,buildId}}:{}),
  // Everything runs from the page's code (no older page-script functions).
  actions:{},formulas:{},code:made.code as unknown as PageCode
 };
 const value={page,script};
 scripts.set(cacheKey,{hash:loaded.hash,value});
 return value;
}

/** Component types used by every page in the package (to preload their renderers). */
export function appPackageComponentTypes(appId:string):string[]{
 const loaded=byApp.get(keyOf(appId,PACKAGE_VARIANT));
 if(!loaded)return [];
 const types=new Set<string>();
 for(const entry of Object.values(loaded.pages))
  for(const match of String(entry.Page).matchAll(/type:\s*"(Custom:[A-Za-z0-9_]+)"/g))types.add(match[1]);
 return [...types];
}

/** Forget a package (the app was republished and the device must reload it). */
export function forgetAppPackage(appId:string):void{
 const key=keyOf(appId,PACKAGE_VARIANT);
 byApp.delete(key);
 for(const cacheKey of [...scripts.keys()])if(cacheKey.startsWith(key+'|'))scripts.delete(cacheKey);
}
