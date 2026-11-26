import type {SqlPersistence} from '../../system-files/sql-persistence.js';
import type {PageRuntime} from '../../system-files/page-runtime.js';
import {compilePage,type CompilerPage} from '../compilePage.js';
import {appPackageObjects,appsWithPackagedPage,bundleAppPackage} from './appPackage.js';
import {latestPageCodeVersion,recordPageCodeVersion} from './pageCodeVersionStore.js';
import {readPageSource} from './readPageSource.js';
import {serverCodeFromFiles} from './serverPageCodeFromFiles.js';
import {mirrorPagesSoon} from './pageCodeFolder.js';

/**
 * A developer edits a page's code files (the .tsx, .css, .formulas.ts, .actions.ts,
 * .data.ts, manifest.json of its newest version). Saved here as the NEWEST version, the app
 * runs them at once (its package is rebuilt). Publishing the page from Page Builder later
 * writes new files over them; the last 10 versions are kept, so an edit can be restored.
 *
 * Checked before saving (nothing is run on the server): every file is one of the page's
 * own files, the code builds for the device (only React, <Smart> and the formula library
 * can be imported), and the page read back from it compiles.
 */
type Result={ok:true;version:number;issues:string[];apps:string[]}|{ok:false;error:string;issues?:string[]};
/** Extra code files a developer may add next to the page's own (helpers the page imports). */
const EXTRA_FILE=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}\.(?:ts|tsx)$/;
const MAX_FILE=2_000_000,MAX_TOTAL=6_000_000;

async function saveFiles(db:SqlPersistence,pages:PageRuntime,input:{tenantId:string;pageApi:string;variant:string;
 actor:string|null;files:Record<string,string>;expectedVersion?:number;replaceAll?:boolean}):Promise<Result>{
 const latest=await latestPageCodeVersion(db,input.tenantId,input.pageApi,input.variant);
 if(!latest)return {ok:false,error:'This page has no code yet: publish it (or rebuild the app) first'};
 if(input.expectedVersion!==undefined&&input.expectedVersion!==latest.version)
  return {ok:false,error:'Version '+latest.version+' is newer than the one you edited ('+input.expectedVersion+'): start from it'};
 const allowed=new Set(Object.keys(latest.files));
 let total=0;
 for(const [path,content] of Object.entries(input.files)){
  if(!allowed.has(path)&&!EXTRA_FILE.test(path))return {ok:false,error:'Not a file of this page: '+path};
  if(typeof content!=='string'||content.length>MAX_FILE)return {ok:false,error:'File too large or not text: '+path};
  total+=content.length;
 }
 if(total>MAX_TOTAL)return {ok:false,error:'Files too large'};
 const files=input.replaceAll?{...input.files}:{...latest.files,...input.files};
 for(const required of Object.keys(latest.files).filter(path=>path.startsWith(input.pageApi+'.')||path==='manifest.json'))
  if(!(required in files))return {ok:false,error:'Missing file: '+required};
 const same=Object.keys(files).length===Object.keys(latest.files).length
  &&Object.entries(files).every(([path,content])=>latest.files[path]===content);
 if(same)return {ok:false,error:'unchanged'};
 const read=readPageSource(files,input.pageApi);
 if(!read.page.components.length)return {ok:false,error:'The .tsx has no <Smart> components',issues:read.issues};
 const objects=await appPackageObjects(input.tenantId);
 let plan;
 try{plan=compilePage(read.page as unknown as CompilerPage,objects,{strictLegacy:true});}
 catch(error){return {ok:false,error:'The page does not compile: '+(error instanceof Error?error.message:String(error)),issues:read.issues};}
 try{
  await bundleAppPackage('check',[{key:input.pageApi+'.'+input.variant,pageApi:input.pageApi,variant:input.variant,
   version:latest.version+1,files,page:read.page as never,plan,issues:read.issues}],{app:{},inScreen:{},custom:{}});
 }catch(error){return {ok:false,error:'The code does not build: '+(error instanceof Error?error.message:String(error)),issues:read.issues};}
 // The server runs the same actions: they must build and load for the server too.
 try{await serverCodeFromFiles(files,input.pageApi);}
 catch(error){return {ok:false,error:'The server code does not build: '+(error instanceof Error?error.message:String(error)),issues:read.issues};}
 const head=await db.query<{app_api:string|null}>(`SELECT app_api FROM md_page_code_versions
  WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 AND version=$4`,[input.tenantId,input.pageApi,input.variant,latest.version]);
 const version=await db.transaction(()=>recordPageCodeVersion(db,{tenantId:input.tenantId,pageApi:input.pageApi,
  variant:input.variant,appApi:head.rows[0]?.app_api??'',pageRevision:latest.pageRevision,actorId:input.actor,
  source:{files:Object.entries(files).map(([path,content])=>({path,content})).sort((a,b)=>a.path<b.path?-1:1),
   issues:read.issues.map(message=>({componentName:'',message}))}}));
 // Every app that shows this page runs the new code now.
 const apps=new Set(await appsWithPackagedPage(db,input.tenantId,input.pageApi).catch(()=>[] as string[]));
 if(head.rows[0]?.app_api)apps.add(head.rows[0].app_api);
 for(const appApi of apps)await pages.rebuildAppPackage(input.tenantId,appApi);
 mirrorPagesSoon(db,input.tenantId,[input.pageApi]);
 return {ok:true,version,issues:read.issues,apps:[...apps]};
}

export async function saveEditedPageCode(db:SqlPersistence,pages:PageRuntime,input:{tenantId:string;pageApi:string;
 variant:string;actor:string;baseVersion:number;files:unknown}):Promise<Result>{
 if(!input.files||typeof input.files!=='object'||Array.isArray(input.files))return {ok:false,error:'files must be { path: content }'};
 if(!Number.isInteger(input.baseVersion)||input.baseVersion<1)return {ok:false,error:'baseVersion is required'};
 return saveFiles(db,pages,{...input,files:input.files as Record<string,string>,expectedVersion:input.baseVersion});
}

export async function restorePageCodeVersion(db:SqlPersistence,pages:PageRuntime,input:{tenantId:string;pageApi:string;
 variant:string;actor:string;version:number}):Promise<Result>{
 const {rows}=await db.query<{path:string;content:string}>(`SELECT path,content FROM md_page_code_version_files
  WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 AND version=$4`,[input.tenantId,input.pageApi,input.variant,input.version]);
 if(!rows.length)return {ok:false,error:'Version '+input.version+' is not kept (only the last 10 are)'};
 return saveFiles(db,pages,{...input,files:Object.fromEntries(rows.map(row=>[row.path,row.content]))});
}

/** The code folder on the server: the folder's files ARE the page's files (added or removed too). */
export async function saveFolderFiles(db:SqlPersistence,pages:PageRuntime,input:{tenantId:string;pageApi:string;
 variant:string;files:Record<string,string>}):Promise<Result>{
 return saveFiles(db,pages,{...input,actor:null,replaceAll:true});
}
