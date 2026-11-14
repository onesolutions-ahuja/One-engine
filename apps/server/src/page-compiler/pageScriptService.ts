import {createHash,randomBytes} from 'node:crypto';
import {compilePage,type CompiledPage,type CompilerObject,type CompilerPage} from './compilePage.js';
import {generatePageScript} from './generatePageScript.js';

/**
 * Server-built page scripts.
 *
 * The server compiles each SAVED page (never code sent by a browser) into one
 * JavaScript module. The browser loads that module as a script from this server,
 * which the strict Content-Security-Policy (script-src 'self') allows.
 *
 * A browser cannot attach the bearer token to a module import, so the signed-in
 * user first asks for a ticket: random, single use, valid for 60 seconds, bound
 * to tenant + user + page + layout. The script route re-checks permissions.
 *
 * Record saves from that script name only "component:event"; the server runs the
 * action from ITS compiled copy of the same page revision.
 */
export type PageScriptTicket={tenantId:string;userId:string;apiName:string;variant:string;expires:number;
 /** Preview of unsaved edits: serve this user's draft build instead of the saved page. */
 previewId?:string;
 /** Published app page: a tenant-shared build, opened by anyone who can open the App. */
 buildId?:string;appId?:string};
export type PageScriptKey={tenantId:string;apiName:string;variant:string};
export type CompiledServerAction={formula:string;serverDataSteps:number;totalSteps:number};
type Built={revision:number|null;code:string;etag:string;objectStamp:string;compiled:CompiledPage;
 actions:ReadonlyMap<string,CompiledServerAction>};

const TICKET_MS=60_000;
const MAX_TICKETS=2_000;
const MAX_BUILT=200;
const apiNamePattern=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const ticketPattern=/^[A-Za-z0-9_-]{43}$/;
/** component id (ids may contain - . _) + ":" + event name. */
export const compiledActionKeyPattern=/^[A-Za-z0-9_.-]{1,160}:[A-Za-z][A-Za-z0-9_]{0,63}$/;

export class PageScriptService{
 private readonly tickets=new Map<string,PageScriptTicket>();
 private readonly built=new Map<string,Built>();
 /** Preview builds of unsaved edits, per tenant + user (never shared, never published). */
 private readonly previews=new Map<string,Built&{tenantId:string;userId:string;apiName:string;variant:string}>();
 constructor(private readonly now:()=>number=()=>Date.now()){}

 issueTicket(tenantId:string,userId:string,apiName:string,variant:string,previewId?:string,
  published?:{buildId:string;appId:string}):string{
  if(!apiNamePattern.test(apiName))throw new Error('Invalid page API name');
  const now=this.now();
  for(const [id,entry] of this.tickets)if(entry.expires<=now)this.tickets.delete(id);
  if(this.tickets.size>=MAX_TICKETS)this.tickets.delete(this.tickets.keys().next().value!);
  const id=randomBytes(32).toString('base64url');
  this.tickets.set(id,{tenantId,userId,apiName,variant,expires:now+TICKET_MS,...(previewId?{previewId}:{}),
   ...(published?{buildId:published.buildId,appId:published.appId}:{})});
  return id;
 }
 /** Single use: a ticket works once, then is gone. */
 consumeTicket(id:string):PageScriptTicket|null{
  if(!ticketPattern.test(id))return null;
  const entry=this.tickets.get(id);
  this.tickets.delete(id);
  return entry&&entry.expires>this.now()?entry:null;
 }

 private static cacheKey(key:PageScriptKey,revision:number|null):string{
  return [key.tenantId,key.apiName,key.variant,String(revision)].join('\u0000');
 }
 /** Compile + generate once per saved revision; later calls reuse it. */
 build(key:PageScriptKey,page:CompilerPage,objects:readonly CompilerObject[]):Built{
  const revision=page.draftRevision??page.revision??page.publishedRevision??null;
  const cacheKey=PageScriptService.cacheKey(key,revision);
  const hit=this.built.get(cacheKey);
  // An Object change (new field, renamed relationship) must rebuild: compare the input.
  const objectStamp=createHash('sha256').update(JSON.stringify(objects)).digest('base64url');
  if(hit&&hit.objectStamp===objectStamp)return hit;
  const compiled=compilePage(page,objects,{strictLegacy:true});
  const code=generatePageScript(compiled,'js');
  const actions=new Map<string,CompiledServerAction>();
  for(const component of compiled.components)for(const action of component.actions)
   if(action.kind==='ActionPlan'&&!action.error&&action.formula)
    actions.set(component.id+':'+action.event,{formula:action.formula,
     serverDataSteps:action.serverDataSteps,totalSteps:action.totalSteps});
  const etag='"'+createHash('sha256').update(code).digest('base64url').slice(0,24)+'.'+objectStamp.slice(0,12)+'"';
  const entry:Built={revision,code,etag,objectStamp,compiled,actions};
  this.built.delete(cacheKey);
  if(this.built.size>=MAX_BUILT)this.built.delete(this.built.keys().next().value!);
  this.built.set(cacheKey,entry);
  return entry;
 }
 /** Compile what the Builder shows right now (unsaved edits) for Preview. The page
  * metadata is compiled by the server exactly like a saved page; nothing is stored
  * or published. Returns an id the same user's ticket and saves refer to. */
 buildPreview(tenantId:string,userId:string,apiName:string,variant:string,page:CompilerPage,
  objects:readonly CompilerObject[]):{previewId:string;built:Built}{
  if(!apiNamePattern.test(apiName)||page.apiName!==apiName)throw new Error('Preview page does not match');
  const compiled=compilePage(page,objects,{strictLegacy:true});
  const code=generatePageScript(compiled,'js');
  const actions=new Map<string,CompiledServerAction>();
  for(const component of compiled.components)for(const action of component.actions)
   if(action.kind==='ActionPlan'&&!action.error&&action.formula)
    actions.set(component.id+':'+action.event,{formula:action.formula,
     serverDataSteps:action.serverDataSteps,totalSteps:action.totalSteps});
  const hash=createHash('sha256').update(code).digest('base64url');
  // Same user + same draft → same id (repeat Previews reuse it).
  const previewId=createHash('sha256').update([tenantId,userId,apiName,variant,hash].join('\u0000')).digest('base64url').slice(0,32);
  const built={revision:compiled.revision,code,etag:'"p.'+hash.slice(0,24)+'"',objectStamp:'',compiled,actions,
   tenantId,userId,apiName,variant};
  this.previews.delete(previewId);
  if(this.previews.size>=MAX_BUILT)this.previews.delete(this.previews.keys().next().value!);
  this.previews.set(previewId,built);
  return {previewId,built};
 }
 /** Published app pages: one build per tenant + app + page content, shared by its users. */
 private readonly appBuilds=new Map<string,Built&{tenantId:string;appId:string;apiName:string}>();
 /** Same page content converted recently: reuse its build without reloading every
  * Object definition and compiling again (the slow part of opening a page). */
 private readonly recentAppInputs=new Map<string,{buildId:string;at:number}>();
 static appInputKey(tenantId:string,appId:string,variant:string,page:unknown):string{
  return createHash('sha256').update([tenantId,appId,variant,JSON.stringify(page)].join('\u0000')).digest('base64url');
 }
 recentAppBuild(inputKey:string,maxAgeMs:number):{buildId:string;built:Built}|null{
  const recent=this.recentAppInputs.get(inputKey);
  if(!recent||this.now()-recent.at>maxAgeMs)return null;
  const built=this.appBuilds.get(recent.buildId);
  return built?{buildId:recent.buildId,built}:null;
 }
 rememberAppInput(inputKey:string,buildId:string):void{
  this.recentAppInputs.delete(inputKey);
  if(this.recentAppInputs.size>=MAX_BUILT*2)this.recentAppInputs.delete(this.recentAppInputs.keys().next().value!);
  this.recentAppInputs.set(inputKey,{buildId,at:this.now()});
 }
 buildAppPage(tenantId:string,appId:string,page:CompilerPage,objects:readonly CompilerObject[]):{buildId:string;built:Built}{
  if(!apiNamePattern.test(page.apiName??''))throw new Error('Invalid page API name');
  const compiled=compilePage(page,objects,{strictLegacy:true});
  const code=generatePageScript(compiled,'js');
  const hash=createHash('sha256').update(code).digest('base64url');
  const buildId=createHash('sha256').update([tenantId,appId,hash].join('\u0000')).digest('base64url').slice(0,32);
  const hit=this.appBuilds.get(buildId);
  if(hit){this.appBuilds.delete(buildId);this.appBuilds.set(buildId,hit);return {buildId,built:hit};}
  const actions=new Map<string,CompiledServerAction>();
  for(const component of compiled.components)for(const action of component.actions)
   if(action.kind==='ActionPlan'&&!action.error&&action.formula)
    actions.set(component.id+':'+action.event,{formula:action.formula,
     serverDataSteps:action.serverDataSteps,totalSteps:action.totalSteps});
  const built={revision:compiled.revision,code,etag:'"a.'+hash.slice(0,24)+'"',objectStamp:'',compiled,actions,
   tenantId,appId,apiName:page.apiName};
  if(this.appBuilds.size>=MAX_BUILT)this.appBuilds.delete(this.appBuilds.keys().next().value!);
  this.appBuilds.set(buildId,built);
  return {buildId,built};
 }
 appBuild(tenantId:string,appId:string,buildId:string):(Built&{apiName:string})|null{
  const entry=this.appBuilds.get(buildId);
  return entry&&entry.tenantId===tenantId&&entry.appId===appId?entry:null;
 }
 appAction(tenantId:string,appId:string,buildId:string,actionKey:string):CompiledServerAction|null{
  if(!compiledActionKeyPattern.test(actionKey))return null;
  return this.appBuild(tenantId,appId,buildId)?.actions.get(actionKey)??null;
 }
 /** A preview build, only for the user who made it. */
 preview(tenantId:string,userId:string,previewId:string):(Built&{apiName:string;variant:string})|null{
  const entry=this.previews.get(previewId);
  return entry&&entry.tenantId===tenantId&&entry.userId===userId?entry:null;
 }
 previewAction(tenantId:string,userId:string,apiName:string,previewId:string,actionKey:string):CompiledServerAction|null{
  if(!compiledActionKeyPattern.test(actionKey))return null;
  const entry=this.preview(tenantId,userId,previewId);
  return entry&&entry.apiName===apiName?entry.actions.get(actionKey)??null:null;
 }
 /** The server's own compiled action for a saved revision, if that revision is built. */
 action(key:PageScriptKey,revision:number,actionKey:string):CompiledServerAction|null{
  if(!compiledActionKeyPattern.test(actionKey))return null;
  return this.built.get(PageScriptService.cacheKey(key,revision))?.actions.get(actionKey)??null;
 }
}
