import {createHash} from 'node:crypto';
import {watch,type FSWatcher} from 'node:fs';
import {mkdir,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,sep} from 'node:path';
import type {SqlPersistence} from '../../system-files/sql-persistence.js';
import type {PageRuntime} from '../../system-files/page-runtime.js';
import {saveFolderFiles} from './editedPageCode.js';

/**
 * The code folder on the server (UNE_PAGE_CODE_ROOT, on a disk kept across deploys):
 *
 *   <root>/<company>/<APP>/pages/<page>/<layout>/      the code the app runs (edit here)
 *   <root>/<company>/<APP>/versions/<page>/<layout>/vN/ the last 10 versions (copy one back to restore)
 *
 * Publishing in Page Builder writes the files. A change saved in a pages/ folder is checked
 * and becomes the newest version within a second or two; the app runs it at once. If it is
 * not accepted, ERRORS.txt in that folder says why (the app keeps running the last good code).
 * The database keeps the same versions, so nothing is lost if the folder is.
 */
const SAFE=/^[A-Za-z0-9_.-]{1,120}$/;
const FILE=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}\.(?:tsx|ts|css|json)$/;
const VARIANTS=new Set(['Desktop','Tablet','Mobile','Custom']);
const MARK='.une-version';

export function pageCodeRoot():string|null{
 const root=String(process.env.UNE_PAGE_CODE_ROOT??'').trim();
 return root&&isAbsolute(root)?root:null;
}
const hashFiles=(files:Record<string,string>)=>createHash('sha256')
 .update(JSON.stringify(Object.keys(files).sort().map(path=>[path,files[path]]))).digest('hex');

const slugs=new Map<string,string>(),tenants=new Map<string,string>();
async function tenantSlug(db:SqlPersistence,tenantId:string):Promise<string|null>{
 if(slugs.has(tenantId))return slugs.get(tenantId)!;
 const {rows}=await db.query<{slug:string}>('SELECT slug FROM md_tenants WHERE id=$1',[tenantId]);
 const slug=rows[0]?.slug;
 if(!slug||!SAFE.test(slug))return null;
 slugs.set(tenantId,slug);tenants.set(slug,tenantId);
 return slug;
}
async function tenantBySlug(db:SqlPersistence,slug:string):Promise<string|null>{
 if(tenants.has(slug))return tenants.get(slug)!;
 const {rows}=await db.query<{id:string}>('SELECT id FROM md_tenants WHERE slug=$1',[slug]);
 if(!rows[0])return null;
 tenants.set(slug,rows[0].id);slugs.set(rows[0].id,slug);
 return rows[0].id;
}

/** What this server wrote last into each pages/ folder (its own writes are not edits). */
const written=new Map<string,string>();

async function writeFolder(folder:string,files:Record<string,string>,version:number):Promise<void>{
 await mkdir(folder,{recursive:true});
 for(const name of await readdir(folder))
  if(FILE.test(name)&&!Object.prototype.hasOwnProperty.call(files,name))await rm(join(folder,name),{force:true});
 for(const [path,content] of Object.entries(files))if(FILE.test(path))await writeFile(join(folder,path),content,'utf8');
 await writeFile(join(folder,MARK),String(version)+'\n','utf8');
}

/** Write a page's newest code (and its kept versions) to the folder. No folder set: nothing. */
export async function mirrorPageToFolder(db:SqlPersistence,tenantId:string,pageApi:string):Promise<void>{
 const root=pageCodeRoot();
 if(!root||!SAFE.test(pageApi))return;
 const slug=await tenantSlug(db,tenantId);
 if(!slug)return;
 const {rows}=await db.query<{layout_variant:string;version:number;app_api:string|null}>(
  `SELECT layout_variant,version,app_api FROM md_page_code_versions WHERE tenant_id=$1 AND page_api=$2
   ORDER BY layout_variant,version DESC`,[tenantId,pageApi]);
 const newest=new Map<string,number>();
 for(const row of rows){
  if(!VARIANTS.has(row.layout_variant))continue;
  const app=row.app_api&&SAFE.test(row.app_api)?row.app_api:'_pages';
  const files:Record<string,string>={};
  const found=await db.query<{path:string;content:string}>(`SELECT path,content FROM md_page_code_version_files
   WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 AND version=$4`,[tenantId,pageApi,row.layout_variant,row.version]);
  for(const file of found.rows)files[file.path]=file.content;
  const versionFolder=join(root,slug,app,'versions',pageApi,row.layout_variant,'v'+row.version);
  const exists=await stat(versionFolder).then(()=>true,()=>false);
  if(!exists)await writeFolder(versionFolder,files,row.version);
  if(!newest.has(row.layout_variant)){
   newest.set(row.layout_variant,row.version);
   const current=join(root,slug,app,'pages',pageApi,row.layout_variant);
   written.set(current,hashFiles(files));
   await writeFolder(current,files,row.version);
   await rm(join(current,'ERRORS.txt'),{force:true});
  }
 }
 // Only the last 10 versions are kept (as in the database).
 for(const [variant] of newest){
  for(const app of new Set(rows.map(row=>row.app_api&&SAFE.test(row.app_api)?row.app_api:'_pages'))){
   const dir=join(root,slug,app,'versions',pageApi,variant);
   const kept=new Set(rows.filter(row=>row.layout_variant===variant).map(row=>'v'+row.version));
   for(const name of await readdir(dir).catch(()=>[] as string[]))
    if(/^v\d+$/.test(name)&&!kept.has(name))await rm(join(dir,name),{recursive:true,force:true});
  }
 }
}

/** Mirror after a save; a folder problem never fails the save. */
export function mirrorPagesSoon(db:SqlPersistence,tenantId:string,pageApis:Iterable<string>):void{
 if(!pageCodeRoot())return;
 const list=[...new Set(pageApis)];
 void (async()=>{for(const page of list)await mirrorPageToFolder(db,tenantId,page).catch(error=>console.error('code folder write failed',page,error));})();
}

async function readFolderFiles(folder:string):Promise<Record<string,string>>{
 const files:Record<string,string>={};
 for(const name of await readdir(folder).catch(()=>[] as string[]))
  if(FILE.test(name))files[name]=await readFile(join(folder,name),'utf8');
 return files;
}
/** A pages/<page>/<layout> folder changed: check it and make it the newest version. */
async function importPagesFolder(db:SqlPersistence,pages:PageRuntime,root:string,folder:string):Promise<void>{
 const parts=relative(root,folder).split(sep);
 // <company>/<APP>/pages/<page>/<layout>
 if(parts.length!==5||parts[2]!=='pages')return;
 const [slug,,,pageApi,variant]=parts;
 if(!SAFE.test(slug)||!SAFE.test(pageApi)||!VARIANTS.has(variant))return;
 const files=await readFolderFiles(folder);
 if(!Object.keys(files).length)return;
 const hash=hashFiles(files);
 if(written.get(folder)===hash)return;
 const tenantId=await tenantBySlug(db,slug);
 if(!tenantId)return;
 const result=await saveFolderFiles(db,pages,{tenantId,pageApi,variant,files});
 if(result.ok){
  written.set(folder,hash);
  await rm(join(folder,'ERRORS.txt'),{force:true});
  await mirrorPageToFolder(db,tenantId,pageApi);
  console.info('code folder: '+slug+'/'+pageApi+'/'+variant+' is now version '+result.version);
 }else if(result.error!=='unchanged'){
  await writeFile(join(folder,'ERRORS.txt'),'Not used - the app keeps running the last good version.\n\n'
   +result.error+'\n'+(result.issues??[]).map(issue=>'- '+issue).join('\n')+'\n','utf8');
  console.warn('code folder: '+slug+'/'+pageApi+'/'+variant+' refused: '+result.error);
 }
}

let watcher:FSWatcher|null=null;
/** Start once with the server: take in edits made while it was down, then watch for edits. */
export async function startPageCodeFolder(db:SqlPersistence,pages:PageRuntime):Promise<void>{
 const root=pageCodeRoot();
 if(!root||watcher)return;
 await mkdir(root,{recursive:true});
 const pending=new Map<string,ReturnType<typeof setTimeout>>();
 const queue=(folder:string)=>{
  clearTimeout(pending.get(folder));
  pending.set(folder,setTimeout(()=>{
   pending.delete(folder);
   void importPagesFolder(db,pages,root,folder).catch(error=>console.error('code folder import failed',folder,error));
  },1200));
 };
 // Edits made while the server was down (or before a deploy).
 for(const slug of await readdir(root).catch(()=>[] as string[]))
  for(const app of await readdir(join(root,slug)).catch(()=>[] as string[]))
   for(const page of await readdir(join(root,slug,app,'pages')).catch(()=>[] as string[]))
    for(const variant of await readdir(join(root,slug,app,'pages',page)).catch(()=>[] as string[]))
     queue(join(root,slug,app,'pages',page,variant));
 watcher=watch(root,{recursive:true},(_event,name)=>{
  if(typeof name!=='string')return;
  const parts=name.split(sep);
  if(parts.length!==6||parts[2]!=='pages'||!FILE.test(parts[5]))return;
  queue(join(root,...parts.slice(0,5)));
 });
 watcher.on('error',error=>console.error('code folder watch failed',error));
}
