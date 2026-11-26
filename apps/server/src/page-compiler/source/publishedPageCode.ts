
import type {PageCode} from '../code/pageCode.js';
import {generatePageSource,type PageComponentLike} from './generatePageSource.js';
import {recordPageCodeVersion,type SqlClient} from './pageCodeVersionStore.js';

/** Turns a saved page into its PageCode + module text, using the existing page converter (set once at start-up). */
export type PublishedCodeBuilder=(tenantId:string,page:unknown)=>Promise<{pageCode:PageCode;moduleText:string}>;
let builder:PublishedCodeBuilder|null=null;
export function setPublishedCodeBuilder(next:PublishedCodeBuilder|null):void{builder=next;}

type Variant='Desktop'|'Tablet'|'Mobile'|'Custom';

/**
 * Called by the publish methods, INSIDE their transaction, after the layout is published.
 * Publishing must never fail because of this: any error is logged and swallowed. A SAVEPOINT
 * makes sure a failed SQL statement does not leave the publish transaction aborted.
 * Returns the new version number, or null when nothing was stored.
 */
export async function recordPublishedPageCode(client:SqlClient,input:{
 tenantId:string;pageApi:string;variant:Variant;appApi:string;pageRevision:number|null;actorId:string|null;
 page:unknown;
}):Promise<number|null>{
 if(!builder){console.error('page code version failed','converter not registered');return null;}
 let saved=false;
 try{
  const page=(input.page??{}) as {canvasWidth?:number;canvasHeight?:number;layoutMode?:string;components?:PageComponentLike[]};
  const {pageCode,moduleText}=await builder(input.tenantId,input.page);
  const source=generatePageSource({appApi:input.appApi,pageApi:input.pageApi,variant:input.variant,
   page:{canvasWidth:page.canvasWidth,canvasHeight:page.canvasHeight,layoutMode:page.layoutMode,
    components:Array.isArray(page.components)?page.components:[]},
   pageCode,pageCodeModuleText:moduleText});
  await client.query('SAVEPOINT page_code_version');
  saved=true;
  const version=await recordPageCodeVersion(client,{tenantId:input.tenantId,pageApi:input.pageApi,variant:input.variant,
   appApi:input.appApi,pageRevision:input.pageRevision,actorId:input.actorId,source});
  await client.query('RELEASE SAVEPOINT page_code_version');
  return version;
 }catch(error){
  console.error('page code version failed',error);
  if(saved){
   try{await client.query('ROLLBACK TO SAVEPOINT page_code_version');}
   catch(rollbackError){console.error('page code version rollback failed',rollbackError);}
  }
  return null;
 }
}
