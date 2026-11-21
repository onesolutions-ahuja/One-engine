#!/usr/bin/env node
/**
 * Every page converts to page code (no formula is left for another engine).
 *
 *   node --import tsx scripts/check-page-formulas.mjs --url https://unesolutions.co.uk --token <bearer>
 *   node --import tsx scripts/check-page-formulas.mjs --file pages.json
 *
 * --url: reads every page (each layout: Desktop, Tablet, Phone, Custom) and the Object
 *        definitions of the signed-in tenant through the normal API (RBAC applies).
 * --file: {"objects":[...],"pages":[page, ...]} as the editor API returns them.
 * Prints each formula that does not convert and exits 1 when there is any.
 */
import {readFileSync} from 'node:fs';
import {checkPageFormulas} from '../apps/server/src/page-compiler/code/checkPageFormulas.ts';

const arg=name=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:undefined;};
async function fromSite(base,token){
 const get=async path=>{
  const response=await fetch(base.replace(/\/$/,'')+'/api'+path,{headers:{authorization:'Bearer '+token}});
  if(!response.ok)throw new Error(path+': HTTP '+response.status);
  return response.json();
 };
 const objects=(await get('/metadata/objects')).objects??[];
 const list=(await get('/metadata/pages')).pages??[];
 const pages=[];
 for(const item of list)for(const variant of ['Desktop','Tablet','Phone','Custom']){
  try{
   const answer=await get('/metadata/pages/'+encodeURIComponent(item.apiName)+'/layouts/'+variant+'/editor');
   const page=answer.page??answer;
   if(Array.isArray(page?.components)&&page.components.length)pages.push({...page,apiName:item.apiName,__variant:variant});
  }catch{/* no such layout */}
 }
 return {objects,pages};
}
const file=arg('file'),url=arg('url');
if(!file&&!url){console.error('Use --file pages.json or --url <site> --token <bearer>');process.exit(2);}
const {objects,pages}=file?JSON.parse(readFileSync(file,'utf8')):await fromSite(url,arg('token')??process.env.UNE_TOKEN??'');
let issues=0;
for(const page of pages){
 const found=checkPageFormulas(page,objects);
 issues+=found.length;
 for(const issue of found)console.log([page.apiName+(page.__variant?' ('+page.__variant+')':''),issue.componentId,issue.where,issue.source,issue.error].join(' | '));
}
console.log(pages.length+' page layout(s) checked, '+issues+' formula(s) not converted');
process.exit(issues?1:0);
