#!/usr/bin/env node
/**
 * One-time relocation of the retired "src/one" source namespace.
 * Moves source verbatim, preserves component API names and tenant SQL data,
 * then rewrites repository-local import/descriptor/source references.
 * Idempotent: rerunning after migration is a no-op.
 */
import { existsSync } from 'node:fs';
import { readdir, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const oldRoot=path.join(root,'apps/web/src/one');
const newRoot=path.join(root,'apps/web/src/component-libraries');
const oldPrefix='apps/web/src/one/';
const newPrefix='apps/web/src/component-libraries/';
const supported=new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.json','.css','.scss','.md','.yaml','.yml','.html']);
const skip=new Set(['node_modules','.git','dist','dist-system','coverage','.next','.turbo','build','.cache']);
const isFile=async p=>{try{return (await import('node:fs/promises')).stat(p).then(x=>x.isFile())}catch{return false}};
const walk=async(dir,out=[])=>{
 for(const e of await readdir(dir,{withFileTypes:true})){
  if(skip.has(e.name))continue;
  const p=path.join(dir,e.name);
  if(e.isDirectory())await walk(p,out);
  else if(e.isFile()&&supported.has(path.extname(e.name)))out.push(p);
 }
 return out;
};
if(!existsSync(oldRoot)){
 if(!existsSync(newRoot))throw Error('Neither old nor new component source directory exists');
 console.log('Component namespace already relocated');
 process.exit(0);
}
if(existsSync(newRoot)){
 // SharedRuntime was created by earlier cleanup; the top-level new library
 // must not already be present to avoid overwriting tenant-specific code.
 throw Error('Destination already exists: '+newRoot);
}
await mkdir(path.dirname(newRoot),{recursive:true});
await rename(oldRoot,newRoot);
const files=await walk(root);
let changed=0;
for(const file of files){
 if(file===path.join(root,'scripts/relocate-retired-component-source.mjs'))continue;
 const original=await readFile(file,'utf8');
 let next=original;
 // Absolute repository paths, followed by paths relative to apps/web and src.
 next=next.replaceAll(oldPrefix,newPrefix)
          .replaceAll('src/one/','src/component-libraries/')
          .replace(/(^|[\\/\"'`])one\\//gm, '$1component-libraries/');
 // Identifiers for the source root in build and layout-check scripts.
 next=next.replace(/(path\.join\(webSourceRoot,\s*['"])one(['"]\))/g,'$1component-libraries$2')
          .replace(/(path\.join\(webSourceRoot,\s*['"])one(['"],)/g,'$1component-libraries$2')
          .replace(/(path\.join\(webSourceRoot,\s*['"])one(['"])/g,'$1component-libraries$2');
 if(file.endsWith('scripts/verify-web-source-layout.mjs')){
  next=next.replace("['core', 'one']","['component-libraries', 'core']");
 }
 if(next!==original){await writeFile(file,next);changed++;}
}
if(existsSync(oldRoot))throw Error('Legacy source directory still exists');
const catalog=await readFile(path.join(root,'scripts/component-catalog.mjs'),'utf8');
if(catalog.includes("path.join(webSourceRoot, 'component-libraries')"))throw Error('Catalog still points at retired source root');
console.log('Relocated component source; rewritten files:',changed);
