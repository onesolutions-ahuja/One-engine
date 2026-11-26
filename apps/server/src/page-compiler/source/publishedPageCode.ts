import type {PageCode} from '../code/pageCode.js';
import {generatePageSource,type PageComponentLike} from './generatePageSource.js';
import {recordPageCodeVersion,type SqlClient} from './pageCodeVersionStore.js';

/** Turns a saved page into its PageCode + module text, using the existing page converter (set once at start-up). */
export type PublishedCodeBuilder=(tenantId:string,page:unknown)=>Promise<{pageCode:PageCode;moduleText:string}>;
let builder:PublishedCodeBuilder|null=null;
export function setPublishedCodeBuilder(next:PublishedCodeBuilder|null):void{builder=next;}
/** Why the last code version of a page could not be stored (shown by the app rebuild). */
const lastErrors=new Map<string,string>();
export function publishedPageCodeError(tenantId:string,pageApi:string,variant:string):string{
 return lastErrors.get([tenantId,pageApi,variant].join('\u0000'))??'';
}

type Variant='Desktop'|'Tablet'|'Mobile'|'Custom';

/**
 * Called by the publish methods, INSIDE their transaction, after the layout is published.
 * Publishing must never fail because of this: any error is logged and swallowed. A SAVEPOINT
 * makes sure a failed SQL statement does not leave the publish transaction aborted.
 * Returns the new version number, or null when nothing was stored.
 */
export async function recordPublishedPageCode(client:SqlClient,input:{
 tenantId:string;pageApi:string;variant:Variant;actor?:string|null;
 /** Loads the just-published page (called inside the SAVEPOINT, so a failed read cannot abort the publish). */
 loadPage:()=>Promise<unknown>;
}):Promise<number|null>{
 const errorKey=[input.tenantId,input.pageApi,input.variant].join('\u0000');
 if(!builder){lastErrors.set(errorKey,'converter not registered');console.error('page code version failed','converter not registered');return null;}
 let saved=false;
 try{
  await client.query('SAVEPOINT page_code_version');
  saved=true;
  const loaded=(await input.loadPage()??{}) as {canvasWidth?:number;canvasHeight?:number;layoutMode?:string;
   components?:PageComponentLike[];revision?:number;activationAssignments?:Array<{appId?:string|null}>};
  const appApi=(loaded.activationAssignments??[]).map(a=>a?.appId).find(id=>typeof id==='string'&&id)??'';
  const pageRevision=Number.isInteger(loaded.revision)?Number(loaded.revision):null;
  const {pageCode,moduleText}=await builder(input.tenantId,loaded);
  const source=generatePageSource({appApi,pageApi:input.pageApi,variant:input.variant,
   page:{...(loaded as Record<string,unknown>),components:Array.isArray(loaded.components)?loaded.components:[]},
   pageCode,pageCodeModuleText:moduleText});
  const version=await recordPageCodeVersion(client,{tenantId:input.tenantId,pageApi:input.pageApi,variant:input.variant,
   appApi,pageRevision,actorId:input.actor??null,source});
  await client.query('RELEASE SAVEPOINT page_code_version');
  lastErrors.delete(errorKey);
  return version;
 }catch(error){
  console.error('page code version failed',error);
  lastErrors.set(errorKey,error instanceof Error?error.message:String(error));
  if(saved){
   try{await client.query('ROLLBACK TO SAVEPOINT page_code_version');await client.query('RELEASE SAVEPOINT page_code_version');}
   catch(rollbackError){console.error('page code version rollback failed',rollbackError);}
  }
  return null;
 }
}
