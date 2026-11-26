import {createHash} from 'node:crypto';
import {compilePage,type CompiledPage,type CompilerObject,type CompilerPage} from '../compilePage.js';
import {generatePageScript} from '../generatePageScript.js';
import {buildPageCode,pageCodeModule} from '../code/pageCode.js';
import {generatePageCss} from './generatePageCss.js';
import type {PageComponentLike} from './generatePageSource.js';
import type {SqlClient} from './pageCodeVersionStore.js';

/**
 * The app package: ONE script file that holds everything a published app needs to open
 * its screens with no page-definition request:
 *
 *  - `page`   the saved page metadata the runtime renders (same object /pages/… returns),
 *  - `plan`   the compiled page (which rows each component shows, who redraws whom),
 *  - `actions`/`formulas`/`createCode` the page code built from the same compiled page,
 *  - `css`    the page stylesheet generated from the same page (as in its code version).
 *
 * The file is a classic script (window.__uneAppPackage): the strict Content-Security-Policy
 * allows it, and nothing is evaluated from a string. It holds the page DESIGN only — never
 * records — so data still goes through the record engine with its usual access checks.
 *
 * Kept per tenant + app + layout; the newest 10 are kept, like page code versions.
 */

export type AppPackageObjectsLoader=(tenantId:string)=>Promise<readonly CompilerObject[]>;
let objectsLoader:AppPackageObjectsLoader|null=null;
/** Registered once at start-up (the same Object definitions the page script uses). */
export function setAppPackageObjectsLoader(next:AppPackageObjectsLoader|null):void{objectsLoader=next;}

/** One screen in the package: `pageApi` is its key (page + layout, e.g. `till_billing.Custom`). */
export type AppPackagePage={pageApi:string;page:AppPackagePageMetadata;plan:CompiledPage;
 moduleText:string;codeText:string;css:string};
/** The layouts the device can ask for (same names as the page routes' formFactor). */
export const PACKAGE_DEVICES=['Desktop','Tablet','Mobile','Custom'] as const;
export type PackageDevice=typeof PACKAGE_DEVICES[number];
/** One package per app holds every layout; the device picks the layout like the server does. */
export const PACKAGE_VARIANT='All';
/**
 * Which screen the device opens, decided at build time by the SAME server rules the page
 * routes use (activation, devices, layout fallbacks), so the device never asks:
 *  app[page][device]      what /apps/<app>/pages/<page>?formFactor=<device> answers,
 *  inScreen[page][device] what /apps/<app>/in-screen-pages/<page> answers (popups),
 *  custom[page]           the Custom layout a wide-enough window gets instead (its width range).
 */
export type AppPackageRoutes={app:Record<string,Partial<Record<PackageDevice,string>>>;
 inScreen:Record<string,Partial<Record<PackageDevice,string>>>;
 custom:Record<string,{key:string;min:number;max:number}>};
/** The server's own page resolvers (PageRuntime), so the package answers what the routes answer. */
export type AppPackageResolver={
 appPage(pageApi:string,device:PackageDevice,strictCustom:boolean):Promise<Record<string,unknown>|null>;
 inScreenPage(pageApi:string,device:PackageDevice):Promise<Record<string,unknown>|null>;
};
/** The fields of a saved page the browser runtime reads (a subset of the page route's answer). */
export type AppPackagePageMetadata={apiName:string;label:string;pageType?:string;layoutMode?:string;
 template?:string|null;canvasWidth?:number;canvasHeight?:number;canvasFillColor?:string;
 components:PageComponentLike[];activationAssignments?:unknown[]};

const PAGE_MARK='// ==== page: ';
const PAGE_MARK_END=' ====';
const PAGE_MARK_PATTERN=/^\/\/ ==== page: (.+) ====$/gm;
const SAFE_PAGE=/^[A-Za-z0-9_.-]{1,120}$/;
/** One line of generated code must never start an ES module export inside the package. */
const stripExports=(text:string):string=>{
 if(/^export default\b/m.test(text))throw new Error('Generated page code has a default export');
 return text.replace(/^export (?=(?:const|let|var|function|class)\b)/gm,'');
};

/** sha256 of the file, base64url, first 32 chars: the same code always has the same URL. */
export function appPackageHash(code:string):string{
 return createHash('sha256').update(code).digest('base64url').slice(0,32);
}

/** The page names inside a package file (used by the package route: no code is run). */
export function appPackagePages(code:string):string[]{
 const names:string[]=[];
 for(const match of String(code??'').matchAll(PAGE_MARK_PATTERN))names.push(match[1]);
 return names;
}

function pageText(input:AppPackagePage):string{
 const api=input.pageApi;
 if(!SAFE_PAGE.test(api))throw new Error('Page name is not file safe: '+api);
 return [
  PAGE_MARK+api+PAGE_MARK_END,
  'pages['+JSON.stringify(api)+']=(function(){',
  'var page='+JSON.stringify(input.page)+';',
  'var mod=(function(){',
  stripExports(input.moduleText),
  'return {plan:plan,createActions:createActions,createFormulas:createFormulas};',
  '})();',
  'var code=(function(){',
  stripExports(input.codeText),
  'return {createCode:createCode,codeVersion:codeVersion,codeIssues:codeIssues};',
  '})();',
  'return {page:page,css:'+JSON.stringify(input.css)+',plan:mod.plan,',
  ' createActions:mod.createActions,createFormulas:mod.createFormulas,',
  ' createCode:code.createCode,codeVersion:code.codeVersion,codeIssues:code.codeIssues};',
  '})();'
 ].join('\n');
}

/**
 * Pure: page sources -> the package file text and its hash. Deterministic (no clock, no
 * randomness), so republishing the same pages gives the same hash and the same URL.
 */
export function appPackageText(input:{appApi:string;variant:string;pages:AppPackagePage[];routes?:AppPackageRoutes}):{code:string;hash:string}{
 const api=String(input.appApi??'');
 if(!SAFE_PAGE.test(api))throw new Error('App name is not file safe: '+api);
 const pages=[...input.pages].sort((a,b)=>a.pageApi.localeCompare(b.pageApi));
 const code=[
  '/* GENERATED by Une publish from Page Builder. Do not edit: publishing again replaces this file.',
  ' * One file for the whole app: every published screen, its compiled plan, its page code and its styles.',
  ' * Design only — records are always read through the record engine with the user\'s access checks. */',
  'window.__uneAppPackage=(function(){',
  '"use strict";',
  'var pages={};',
  ...pages.map(pageText),
  'var allCss=[];for(var key in pages)if(pages[key])allCss.push(pages[key].css);',
  'return {version:2,app:'+JSON.stringify(api)+',variant:'+JSON.stringify(String(input.variant??'Desktop')),
  ' ,pages:pages,routes:'+JSON.stringify(sortedRoutes(input.routes))+',css:allCss.join("\\n")};',
  '})();',''
 ].join('\n');
 return {code,hash:appPackageHash(code)};
}

/** Routes with sorted keys: the same app always gives the same file (and hash). */
function sortedRoutes(routes?:AppPackageRoutes):AppPackageRoutes{
 const sort=<T>(value:Record<string,T>):Record<string,T>=>
  Object.fromEntries(Object.keys(value??{}).sort().map(key=>[key,value[key]]));
 const devices=(value:Record<string,Partial<Record<PackageDevice,string>>>)=>
  Object.fromEntries(Object.keys(value??{}).sort().map(key=>[key,sort(value[key] as Record<string,string>)]));
 return {app:devices(routes?.app??{}),inScreen:devices(routes?.inScreen??{}),custom:sort(routes?.custom??{})};
}

/** The tenant's app id for an app API name (tenant name wins over the catalogue name). */
export async function resolveAppId(client:SqlClient,tenantId:string,appApi:string):Promise<string|null>{
 const found=await client.query(
  `SELECT a.id FROM md_apps a
   JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
   LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
   WHERE COALESCE(m.api_name,a.api_name)=$2 AND a.enabled=true`,[tenantId,appApi]);
 return found.rows.length?String(found.rows[0].id):null;
}

/** Every page this app can reach: its App Page tabs and every page assigned to it in
 * Page Builder (activation, where SCREEN() popups and in-screen pages are assigned). */
export async function appPackagePageApis(client:SqlClient,tenantId:string,appId:string,appApi:string):Promise<string[]>{
 const found=await client.query(
  `SELECT DISTINCT p.api_name FROM md_page_definitions p
   LEFT JOIN md_tenant_app_navigation n ON n.tenant_id=p.tenant_id AND n.app_id=$2
     AND n.entry_type='App Page' AND n.api_name=p.api_name
   LEFT JOIN md_lightning_page_activation a ON a.tenant_id=p.tenant_id AND a.page_id=p.id AND a.app_api=$3
   WHERE p.tenant_id=$1 AND p.enabled=true AND (n.api_name IS NOT NULL OR a.app_api IS NOT NULL)
   ORDER BY p.api_name`,[tenantId,appId,appApi]);
 return found.rows.map(row=>String(row.api_name));
}

/** Pages a page opens by name: SCREEN(name, …) in any of its formulas. */
export function screenTargets(page:unknown):string[]{
 const text=JSON.stringify((page as {components?:unknown})?.components??[]);
 const names=new Set<string>();
 for(const match of text.matchAll(/SCREEN\(\s*(?:\\?["'])?([A-Za-z][A-Za-z0-9_]*)/g))names.add(match[1]);
 return [...names];
}

const layoutOf=(page:Record<string,unknown>,device:PackageDevice):string=>{
 const variant=String(page.layoutVariant??device);
 return /^[A-Za-z]{1,20}$/.test(variant)?variant:device;
};
/** Layout fallbacks of the page route (page-layout-fallback.ts): Mobile -> Tablet -> Desktop. */
const FALLBACKS:Record<PackageDevice,PackageDevice[]>={Desktop:[],Tablet:['Desktop'],Mobile:['Tablet','Desktop'],Custom:['Desktop']};

/**
 * Every screen of the app, resolved with the server's own rules for every layout. Pages its
 * pages open with SCREEN() are followed too (only those the resolvers allow for this app).
 */
export async function resolveAppPackagePages(client:SqlClient,input:{tenantId:string;appApi:string;
 resolver:AppPackageResolver}):Promise<{pages:Map<string,Record<string,unknown>>;routes:AppPackageRoutes}|null>{
 const appId=await resolveAppId(client,input.tenantId,input.appApi);
 if(!appId)return null;
 const queue=await appPackagePageApis(client,input.tenantId,appId,input.appApi);
 const seen=new Set(queue);
 const pages=new Map<string,Record<string,unknown>>();
 const routes:AppPackageRoutes={app:{},inScreen:{},custom:{}};
 const safe=async(load:()=>Promise<Record<string,unknown>|null>)=>{
  try{const page=await load();return page&&Array.isArray(page.components)?page:null;}catch{return null;}
 };
 const keep=(pageApi:string,device:PackageDevice,page:Record<string,unknown>):string=>{
  const key=pageApi+'.'+layoutOf(page,device);
  if(!pages.has(key))pages.set(key,page);
  for(const target of screenTargets(page))if(!seen.has(target)&&SAFE_PAGE.test(target)){seen.add(target);queue.push(target);}
  return key;
 };
 for(let index=0;index<queue.length&&index<200;index++){
  const pageApi=queue[index];
  for(const device of PACKAGE_DEVICES){
   let page:Record<string,unknown>|null=null;
   for(const tried of [device,...FALLBACKS[device]]){
    page=await safe(()=>input.resolver.appPage(pageApi,tried,false));
    if(page)break;
   }
   if(page)(routes.app[pageApi]??={})[device]=keep(pageApi,device,page);
   const popup=await safe(()=>input.resolver.inScreenPage(pageApi,device));
   if(popup)(routes.inScreen[pageApi]??={})[device]=keep(pageApi,device,popup);
  }
  // A wide-enough window gets the Custom layout instead (the page route's viewport rule).
  const custom=await safe(()=>input.resolver.appPage(pageApi,'Custom',true));
  if(custom?.customTargetEnabled===true)routes.custom[pageApi]={key:keep(pageApi,'Custom',custom),
   min:Number(custom.customTargetMinWidth??320),max:Number(custom.customTargetMaxWidth??10000)};
 }
 return pages.size?{pages,routes}:null;
}

/** Read one page the way the page route does, then compile it (same converter as the page script). */
function packagePageFrom(key:string,page:Record<string,unknown>,objects:readonly CompilerObject[]):AppPackagePage{
 const pageApi=String(page.apiName??key.split('.')[0]);
 const components=Array.isArray(page.components)?page.components as PageComponentLike[]:[];
 const compiled=compilePage(page as CompilerPage,objects,{strictLegacy:true});
 const pageCode=buildPageCode(compiled);
 const pageClass=pageApi.replace(/[^A-Za-z0-9_-]/g,'_');
 const css=generatePageCss({header:'/* GENERATED by Une publish from Page Builder. */',
  pageClass,canvasWidth:Number(page.canvasWidth),canvasHeight:Number(page.canvasHeight),components},[]);
 return {
  pageApi:key,
  page:{
   apiName:pageApi,label:String(page.label??pageApi),
   pageType:page.pageType===undefined?undefined:String(page.pageType),
   layoutMode:page.layoutMode===undefined?undefined:String(page.layoutMode),
   template:(page.template??null) as string|null,
   canvasWidth:Number(page.canvasWidth),canvasHeight:Number(page.canvasHeight),
   canvasFillColor:page.canvasFillColor===undefined?undefined:String(page.canvasFillColor),
   components:components.map(item=>({id:item.id,type:item.type,label:item.label,visible:item.visible,
    region:(item as {region?:string}).region,position:item.position,properties:item.properties})),
   activationAssignments:Array.isArray(page.activationAssignments)?page.activationAssignments:[]
  },
  plan:compiled,
  moduleText:generatePageScript(compiled,'js'),
  codeText:pageCodeModule(pageCode),
  css
 };
}

/** Build (not store) the package for an app. Returns null when there is nothing to build.
 * `pagesJson` is the page metadata of every screen, kept with the package so the server can
 * rebuild its own copy of each screen's actions (after a restart) from exactly that design. */
export async function buildAppPackage(client:SqlClient,input:{tenantId:string;appApi:string;
 resolver:AppPackageResolver}):Promise<{code:string;hash:string;pages:string[];pagesJson:string}|null>{
 if(!objectsLoader)return null;
 const resolved=await resolveAppPackagePages(client,input);
 if(!resolved)return null;
 const objects=await objectsLoader(input.tenantId);
 if(!objects.length)return null;
 const pages:AppPackagePage[]=[];
 const kept:Record<string,Record<string,unknown>>={};
 for(const key of [...resolved.pages.keys()].sort()){
  const page=resolved.pages.get(key)!;
  try{pages.push(packagePageFrom(key,page,objects));kept[key]=page;}
  catch(error){console.error('app package page skipped',key,error);}
 }
 if(!pages.length)return null;
 const built=appPackageText({appApi:input.appApi,variant:PACKAGE_VARIANT,pages,routes:resolved.routes});
 return {...built,pages:pages.map(page=>page.pageApi),pagesJson:JSON.stringify(kept)};
}

/** Keep the newest 10 packages per tenant + app + layout (old ones are dropped). */
export async function trimAppPackages(client:SqlClient,tenantId:string,appApi:string,variant:string,keep=10):Promise<void>{
 await client.query(
  `DELETE FROM md_app_packages WHERE tenant_id=$1 AND app_api=$2 AND layout_variant=$3
   AND hash NOT IN (SELECT hash FROM md_app_packages WHERE tenant_id=$1 AND app_api=$2
    AND layout_variant=$3 ORDER BY created_at DESC, hash LIMIT $4)`,
  [tenantId,appApi,variant,Math.max(1,Math.floor(keep))]);
}

/**
 * Rebuild and store the package INSIDE the publish transaction. Publishing never fails
 * because of it: any error is logged and swallowed. A SAVEPOINT keeps a failed statement
 * from leaving the publish transaction aborted.
 */
export async function rebuildAppPackage(client:SqlClient,input:{tenantId:string;appApi:string;
 resolver:AppPackageResolver}):Promise<string|null>{
 if(!input.appApi)return null;
 let saved=false;
 try{
  await client.query('SAVEPOINT app_package');
  saved=true;
  const built=await buildAppPackage(client,input);
  if(built){
   await client.query(
    `INSERT INTO md_app_packages(tenant_id,app_api,layout_variant,hash,code,pages_json)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,app_api,layout_variant,hash)
     DO UPDATE SET created_at=now(),pages_json=EXCLUDED.pages_json`,
    [input.tenantId,input.appApi,PACKAGE_VARIANT,built.hash,built.code,built.pagesJson]);
   await trimAppPackages(client,input.tenantId,input.appApi,PACKAGE_VARIANT);
  }
  await client.query('RELEASE SAVEPOINT app_package');
  return built?.hash??null;
 }catch(error){
  console.error('app package failed',error);
  if(saved){
   try{await client.query('ROLLBACK TO SAVEPOINT app_package');await client.query('RELEASE SAVEPOINT app_package');}
   catch(rollbackError){console.error('app package rollback failed',rollbackError);}
  }
  return null;
 }
}

/** Apps of a tenant whose stored package holds a screen of this page. */
export async function appsWithPackagedPage(client:SqlClient,tenantId:string,pageApi:string):Promise<string[]>{
 if(!SAFE_PAGE.test(pageApi))return [];
 const found=await client.query(
  `SELECT DISTINCT app_api FROM md_app_packages WHERE tenant_id=$1 AND layout_variant=$2
   AND strpos(pages_json,$3)>0`,[tenantId,PACKAGE_VARIANT,JSON.stringify(pageApi).slice(0,-1)+'.']);
 return found.rows.map(row=>String(row.app_api));
}

/** A stored package by hash (the public file route: the hash already names the code). */
export async function storedAppPackage(client:SqlClient,appApi:string,variant:string,hash:string):
 Promise<{hash:string;code:string}|null>{
 const found=await client.query(
  `SELECT hash,code FROM md_app_packages WHERE app_api=$1 AND layout_variant=$2 AND hash=$3 LIMIT 1`,
  [appApi,variant,hash]);
 return found.rows.length?{hash:String(found.rows[0].hash),code:String(found.rows[0].code)}:null;
}

/** The newest stored package for a tenant's app (the one its devices should keep). */
export async function latestAppPackage(client:SqlClient,tenantId:string,appApi:string,variant:string=PACKAGE_VARIANT):
 Promise<{hash:string;code:string;createdAt:string;pages:Record<string,Record<string,unknown>>}|null>{
 const found=await client.query(
  `SELECT hash,code,created_at,pages_json FROM md_app_packages WHERE tenant_id=$1 AND app_api=$2 AND layout_variant=$3
   ORDER BY created_at DESC, hash LIMIT 1`,[tenantId,appApi,variant]);
 if(!found.rows.length)return null;
 const row=found.rows[0];
 let pages:Record<string,Record<string,unknown>>={};
 try{pages=JSON.parse(String(row.pages_json??'{}'))??{};}catch{pages={};}
 return {hash:String(row.hash),code:String(row.code),pages,
  createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at)};
}
