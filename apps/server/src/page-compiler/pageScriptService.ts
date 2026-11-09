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
export type PageScriptTicket={tenantId:string;userId:string;apiName:string;variant:string;expires:number};
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
 constructor(private readonly now:()=>number=()=>Date.now()){}

 issueTicket(tenantId:string,userId:string,apiName:string,variant:string):string{
  if(!apiNamePattern.test(apiName))throw new Error('Invalid page API name');
  const now=this.now();
  for(const [id,entry] of this.tickets)if(entry.expires<=now)this.tickets.delete(id);
  if(this.tickets.size>=MAX_TICKETS)this.tickets.delete(this.tickets.keys().next().value!);
  const id=randomBytes(32).toString('base64url');
  this.tickets.set(id,{tenantId,userId,apiName,variant,expires:now+TICKET_MS});
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
 /** The server's own compiled action for a saved revision, if that revision is built. */
 action(key:PageScriptKey,revision:number,actionKey:string):CompiledServerAction|null{
  if(!compiledActionKeyPattern.test(actionKey))return null;
  return this.built.get(PageScriptService.cacheKey(key,revision))?.actions.get(actionKey)??null;
 }
}
