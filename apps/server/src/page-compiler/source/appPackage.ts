import {readNames,uiImports} from './pageCodeNames.js';
import {createHash} from 'node:crypto';
import {build,type Plugin} from 'esbuild';
import {compilePage,type CompiledPage,type CompilerObject,type CompilerPage} from '../compilePage.js';
import {publishedPageCodeError,recordPublishedPageCode} from './publishedPageCode.js';
import {latestPageCodeVersion,type SqlClient} from './pageCodeVersionStore.js';
import {readPageSource} from './readPageSource.js';
import {serverCodeFromFiles} from './serverPageCodeFromFiles.js';

/**
 * The app package: ONE script file per app that every device keeps. It is built from the
 * pages' CODE FILES (each page's newest code version: what Page Builder published, or what a
 * developer edited after that): the .tsx, .formulas.ts, .actions.ts and .data.ts of every
 * screen are bundled by esbuild, the .css goes with them. The device runs that code; no page
 * definition and no page script is fetched.
 *
 * The server never runs that code. It reads the same files as plain data (readPageSource)
 * and builds from them the screen plan (which rows each component shows) and its own copy
 * of every action (from each action's formula), which runs in one transaction with the
 * user's access checks. Records are never in the package.
 *
 * Kept per tenant + app; the newest 10 are kept.
 */
export type AppPackageObjectsLoader=(tenantId:string)=>Promise<readonly CompilerObject[]>;
let objectsLoader:AppPackageObjectsLoader|null=null;
/** Registered once at start-up (the same Object definitions the page script uses). */
export function setAppPackageObjectsLoader(next:AppPackageObjectsLoader|null):void{objectsLoader=next;}
/** The tenant's Object definitions (what the page plan is compiled against). */
export async function appPackageObjects(tenantId:string):Promise<readonly CompilerObject[]>{
 return objectsLoader?objectsLoader(tenantId):[];
}

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
const SAFE_PAGE=/^[A-Za-z0-9_.-]{1,120}$/;

/** sha256 of the file, base64url, first 32 chars: the same code always has the same URL. */
export function appPackageHash(code:string):string{
 return createHash('sha256').update(code).digest('base64url').slice(0,32);
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

/** One screen of the package: its code files and the page read back from them. */
export type PackageScreen={key:string;pageApi:string;variant:string;version:number;
 files:Record<string,string>;page:Record<string,unknown>&{components:unknown[]};plan:CompiledPage;issues:string[]};

const VARIANTS=new Set(['Desktop','Tablet','Mobile','Custom']);
/**
 * The code files a screen runs from: the page's newest code version, unless the published
 * page is newer (published before code versions existed): then its code is generated now and
 * stored as a version, like a publish does.
 */
async function screenFiles(client:SqlClient,tenantId:string,key:string,published:Record<string,unknown>):
 Promise<{pageApi:string;variant:string;version:number;files:Record<string,string>}|null>{
 const pageApi=String(published.apiName??key.split('.')[0]);
 const variant=String(published.layoutVariant??key.split('.').slice(1).join('.')??'Desktop');
 if(!SAFE_PAGE.test(pageApi)||!VARIANTS.has(variant))return null;
 const revision=Number.isInteger(published.revision)?Number(published.revision):null;
 let latest=await latestPageCodeVersion(client,tenantId,pageApi,variant);
 if(!latest||(revision!==null&&latest.pageRevision!==null&&latest.pageRevision<revision)){
  await recordPublishedPageCode(client,{tenantId,pageApi,variant:variant as 'Desktop',loadPage:async()=>published});
  latest=await latestPageCodeVersion(client,tenantId,pageApi,variant);
  if(!latest)throw new Error('Code files could not be made: '+(publishedPageCodeError(tenantId,pageApi,variant)||'unknown'));
 }
 return {pageApi,variant,version:latest.version,files:latest.files};
}

/** esbuild: the screens' code files are virtual files; React, the components and the formula
 * library are the ones already on the device (window.__une.modules). */
function packagePlugin(screens:readonly PackageScreen[]):Plugin{
 const byDir=new Map(screens.map((screen,index)=>['s'+index,screen.files]));
 const EXTENSIONS=['','.tsx','.ts','.css'];
 return {name:'une-app-package',setup(on){
  on.onResolve({filter:/^(react|@une\/smart|@une\/formula-library)$/},args=>({path:args.path,namespace:'une-global'}));
  // '@une/ui': the components (<Button>, <CardGrid>, …). Each tag the screens import is one
  // component of the device's own library (window.__une.modules['@une/ui'].tag(name)).
  on.onResolve({filter:/^@une\/ui$/},()=>({path:'@une/ui',namespace:'une-ui'}));
  on.onLoad({filter:/.*/,namespace:'une-ui'},()=>{
   const tags=new Set<string>();
   for(const screen of screens)for(const content of Object.values(screen.files))
    for(const tag of uiImports(content).values())tags.add(tag);
   return {loader:'js',contents:'var ui = window.__une.modules["@une/ui"];\nmodule.exports = {'
    +[...tags].sort().map(tag=>JSON.stringify(tag)+': ui.tag('+JSON.stringify(tag)+')').join(', ')+'};'};
  });
  on.onLoad({filter:/.*/,namespace:'une-global'},args=>({loader:'js',
   contents:'module.exports = window.__une.modules['+JSON.stringify(args.path)+'];'}));
  on.onResolve({filter:/^screen:/},args=>({path:args.path.slice('screen:'.length),namespace:'screen'}));
  on.onResolve({filter:/^\.\//,namespace:'screen'},args=>{
   const dir=args.importer.split('/')[0],files=byDir.get(dir)??{};
   const name=args.path.slice(2);
   const found=EXTENSIONS.map(ext=>name+ext).find(candidate=>Object.prototype.hasOwnProperty.call(files,candidate));
   if(!found)return {errors:[{text:'Not a file of this page: '+args.path}]};
   return {path:dir+'/'+found,namespace:'screen'};
  });
  on.onResolve({filter:/.*/,namespace:'screen'},args=>({errors:[{text:'Only the page\'s own files, react, @une/ui, @une/smart and @une/formula-library can be imported: '+args.path}]}));
  on.onLoad({filter:/.*/,namespace:'screen'},args=>{
   const [dir,...rest]=args.path.split('/'),name=rest.join('/');
   const content=byDir.get(dir)?.[name];
   if(content===undefined)return {errors:[{text:'Missing file '+name}]};
   // The .css is delivered as text with the screen (the look is read from it).
   if(name.endsWith('.css'))return {loader:'js',contents:''};
   return {loader:name.endsWith('.tsx')?'tsx':'ts',contents:content};
  });
 }};
}

/** The device file: every screen's code bundled into one classic script (window.__uneAppPackage). */
export async function bundleAppPackage(appApi:string,screens:readonly PackageScreen[],routes:AppPackageRoutes):Promise<string>{
 const imports:string[]=[],entries:string[]=[];
 screens.forEach((screen,index)=>{
  const base='screen:s'+index+'/'+screen.pageApi;
  imports.push('import P'+index+' from '+JSON.stringify(base+'.tsx')+';',
   'import {formulas as F'+index+'} from '+JSON.stringify(base+'.formulas.ts')+';',
   'import {actions as A'+index+'} from '+JSON.stringify(base+'.actions.ts')+';',
   'import {recordSets as D'+index+'} from '+JSON.stringify(base+'.data.ts')+';');
  entries.push(JSON.stringify(screen.key)+': {Page: P'+index+', formulas: F'+index+', actions: A'+index
   +', recordSets: D'+index+', version: '+screen.version+', css: '+JSON.stringify(screen.files[screen.pageApi+'.css']??'')
   +', settings: '+JSON.stringify(Object.fromEntries(Object.entries(screen.page).filter(([field])=>field!=='components')))
   +', names: '+JSON.stringify(readNames(screen.files['manifest.json']))
   +', plan: '+JSON.stringify(screen.plan)+'}');
 });
 const entry=imports.join('\n')+'\nwindow.__uneAppPackage = {version: 3, app: '+JSON.stringify(appApi)
  +', routes: '+JSON.stringify(sortedRoutes(routes))+', screens: {\n'+entries.join(',\n')+'\n}};\n';
 const result=await build({stdin:{contents:entry,sourcefile:'app-package.js',loader:'js',resolveDir:'/'},
  bundle:true,write:false,format:'iife',minify:true,target:'es2020',legalComments:'none',charset:'utf8',
  jsx:'transform',jsxFactory:'__une_h',jsxFragment:'__une_fragment',
  banner:{js:'/* GENERATED by Une publish: the app\'s screens, built from their code files. */\n'
   +'var __une_h=window.__une.modules.react.createElement,__une_fragment=window.__une.modules.react.Fragment;'},
  plugins:[packagePlugin(screens)],logLevel:'silent'});
 return result.outputFiles[0].text;
}

/** Build (not store) the package for an app. Returns null when there is nothing to build.
 * `pagesJson` keeps every screen's code files (and the page read from them): the server
 * runs the same code for each screen's actions (also after a restart). */
export async function buildAppPackage(client:SqlClient,input:{tenantId:string;appApi:string;
 resolver:AppPackageResolver}):Promise<{code:string;hash:string;pages:string[];pagesJson:string;issues:Record<string,string[]>}|null>{
 if(!objectsLoader)return {code:'',hash:'',pages:[],pagesJson:'{}',issues:{'(app)':['Page converter not started']}};
 const resolved=await resolveAppPackagePages(client,input);
 if(!resolved)return {code:'',hash:'',pages:[],pagesJson:'{}',issues:{'(app)':['No screens found for this app (App Page tabs or pages assigned to it)']}};
 const objects=await objectsLoader(input.tenantId);
 if(!objects.length)return {code:'',hash:'',pages:[],pagesJson:'{}',issues:{'(app)':['No Objects for this company']}};
 const screens:PackageScreen[]=[];
 const issues:Record<string,string[]>={};
 for(const key of [...resolved.pages.keys()].sort()){
  try{
   const found=await screenFiles(client,input.tenantId,key,resolved.pages.get(key)!);
   if(!found){issues[key]=['No code files'];continue;}
   const read=readPageSource(found.files,found.pageApi);
   const plan=compilePage(read.page as unknown as CompilerPage,objects,{strictLegacy:true});
   // The server runs the screen's own actions: they must build for the server too.
   await serverCodeFromFiles(found.files,found.pageApi);
   screens.push({key,...found,page:read.page as PackageScreen['page'],plan,issues:read.issues});
   if(read.issues.length)issues[key]=read.issues;
  }catch(error){issues[key]=[error instanceof Error?error.message:String(error)];}
 }
 if(!screens.length)return {code:'',hash:'',pages:[],pagesJson:'{}',issues};
 // A screen whose code does not build is left out (it opens the old way) and reported.
 let code:string;
 try{code=await bundleAppPackage(input.appApi,screens,resolved.routes);}
 catch(error){
  const kept:PackageScreen[]=[];
  for(const screen of screens){
   try{await bundleAppPackage(input.appApi,[screen],{app:{},inScreen:{},custom:{}});kept.push(screen);}
   catch(single){(issues[screen.key]??=[]).push('Code does not build: '+(single instanceof Error?single.message:String(single)));}
  }
  if(!kept.length)throw error;
  const keys=new Set(kept.map(screen=>screen.key));
  const routes=filterRoutes(resolved.routes,keys);
  code=await bundleAppPackage(input.appApi,kept,routes);
  screens.splice(0,screens.length,...kept);
 }
 const pagesJson=JSON.stringify(Object.fromEntries(screens.map(screen=>[screen.key,
  {pageApi:screen.pageApi,variant:screen.variant,version:screen.version,page:screen.page,files:screen.files}])));
 return {code,hash:appPackageHash(code),pages:screens.map(screen=>screen.key),pagesJson,issues};
}
/** Routes that only name screens kept in the package. */
function filterRoutes(routes:AppPackageRoutes,keys:ReadonlySet<string>):AppPackageRoutes{
 const keep=(map:Record<string,Partial<Record<PackageDevice,string>>>)=>Object.fromEntries(Object.entries(map)
  .map(([page,devices])=>[page,Object.fromEntries(Object.entries(devices).filter(([,key])=>keys.has(String(key))))])
  .filter(([,devices])=>Object.keys(devices as object).length));
 return {app:keep(routes.app),inScreen:keep(routes.inScreen),
  custom:Object.fromEntries(Object.entries(routes.custom).filter(([,item])=>keys.has(item.key)))};
}

/** What the last build of an app reported per screen (shown by the rebuild route). */
const lastIssues=new Map<string,Record<string,string[]>>();
export function appPackageIssues(tenantId:string,appApi:string):Record<string,string[]>{
 return lastIssues.get(tenantId+'\u0000'+appApi)??{};
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
  if(built?.code){
   await client.query(
    `INSERT INTO md_app_packages(tenant_id,app_api,layout_variant,hash,code,pages_json)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,app_api,layout_variant,hash)
     DO UPDATE SET created_at=now(),pages_json=EXCLUDED.pages_json`,
    [input.tenantId,input.appApi,PACKAGE_VARIANT,built.hash,built.code,built.pagesJson]);
   await trimAppPackages(client,input.tenantId,input.appApi,PACKAGE_VARIANT);
  }
  await client.query('RELEASE SAVEPOINT app_package');
  if(built&&Object.keys(built.issues).length)console.warn('app package issues',input.appApi,JSON.stringify(built.issues).slice(0,4000));
  lastIssues.set(input.tenantId+'\u0000'+input.appApi,built?.issues??{});
  return built?.code?built.hash:null;
 }catch(error){
  console.error('app package failed',error);
  lastIssues.set(input.tenantId+'\u0000'+input.appApi,{'(build)':[error instanceof Error?error.message+' | '+String(error.stack??'').split('\n').slice(1,4).join(' | '):String(error)]});
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
/** One screen kept with a package: its code files and the page read from them. */
export type StoredScreen={pageApi:string;variant:string;version:number;page:Record<string,unknown>;files:Record<string,string>};
export async function latestAppPackage(client:SqlClient,tenantId:string,appApi:string,variant:string=PACKAGE_VARIANT):
 Promise<{hash:string;code:string;createdAt:string;pages:Record<string,StoredScreen>}|null>{
 const found=await client.query(
  `SELECT hash,code,created_at,pages_json FROM md_app_packages WHERE tenant_id=$1 AND app_api=$2 AND layout_variant=$3
   ORDER BY created_at DESC, hash LIMIT 1`,[tenantId,appApi,variant]);
 if(!found.rows.length)return null;
 const row=found.rows[0];
 let pages:Record<string,StoredScreen>={};
 try{
  const parsed=JSON.parse(String(row.pages_json??'{}'))??{};
  // Only packages built from code files (older ones held page metadata only).
  for(const [key,value] of Object.entries(parsed as Record<string,StoredScreen>))
   if(value&&typeof value==='object'&&value.files&&typeof value.files==='object'&&typeof value.pageApi==='string')pages[key]=value;
 }catch{pages={};}
 return {hash:String(row.hash),code:String(row.code),pages,
  createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at)};
}
