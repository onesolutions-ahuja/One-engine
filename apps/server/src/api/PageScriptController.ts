import type {Express,Response} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {PageRuntime} from '../system-files/page-runtime.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import {pageLayoutVariant} from '../system-files/page-layout-version-runtime.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';
import {tenantServerFormulaEnabled,executeServerDataAction} from '../system-support/formula-data-action-runtime.js';
import {PageScriptService,compiledActionKeyPattern} from '../page-compiler/pageScriptService.js';
import type {CompilerObject,CompilerPage} from '../page-compiler/compilePage.js';

/**
 * Compiled page scripts (Page Builder Preview).
 *
 *  POST /api/pages/:apiName/script-ticket            signed-in: one-time 60 s ticket
 *  GET  /api/page-scripts/:ticket.js                 the server-built module (ticket = login)
 *  POST /api/pages/:apiName/compiled-actions/execute a save, run from the server's compiled copy
 *
 * Scripts are built only from SAVED page metadata, so nothing a browser sends
 * becomes code. Every request re-checks the user's permissions.
 */
export type PageScriptDeps={db:SqlPersistence;rbac:RbacEngine;records:RecordEngine;pages:PageRuntime;
 definitions:ObjectDefinitionService;scripts:PageScriptService};

const scopeKey=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
/** Same scope rules as /api/action-formulas/execute-data. */
export function validActionScope(scope:unknown):scope is Record<string,unknown>{
 return Boolean(scope&&typeof scope==='object'&&!Array.isArray(scope)
  &&Object.keys(scope).length<=80
  &&Object.keys(scope).every(key=>scopeKey.test(key)&&!['constructor','prototype','__proto__'].includes(key)));
}
const asCompilerPage=(page:unknown)=>page as CompilerPage;
const asCompilerObjects=(objects:unknown)=>objects as CompilerObject[];

/** Registered BEFORE the /api bearer-token guard: the ticket is the login. */
export function registerPageScriptPublicRoute(app:Express,deps:PageScriptDeps){
 app.get('/api/page-scripts/:ticket',wrap(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const ticket=deps.scripts.consumeTicket(String(req.params.ticket??'').replace(/\.js$/,''));
  if(!ticket){res.status(404).type('text/plain').send('Not found');return;}
  await deps.rbac.require(ticket.tenantId,ticket.userId,'PageDefinition','read');
  await deps.rbac.require(ticket.tenantId,ticket.userId,'ObjectDefinition','read');
  const variant=pageLayoutVariant(ticket.variant);
  const page=await deps.pages.editor(ticket.tenantId,ticket.apiName,variant);
  const objects=await deps.definitions.list(ticket.tenantId);
  const built=deps.scripts.build({tenantId:ticket.tenantId,apiName:ticket.apiName,variant},
   asCompilerPage(page),asCompilerObjects(objects));
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  res.setHeader('ETag',built.etag);
  res.send(built.code);
 }));
}

export function registerPageScriptRoutes(app:Express,deps:PageScriptDeps){
 app.post('/api/pages/:apiName/script-ticket',wrap(async(req,res)=>{
  const actor=authenticated(req);
  if(!api.test(req.params.apiName))throw new Error('Invalid page API name');
  await deps.rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
  const variant=pageLayoutVariant(req.body?.variant??'Desktop');
  res.setHeader('Cache-Control','private, no-store');
  const ticket=deps.scripts.issueTicket(actor.tenant_id,actor.user_id,req.params.apiName,variant);
  res.json({ticket,url:'/api/page-scripts/'+ticket+'.js'});
 }));
 app.post('/api/pages/:apiName/compiled-actions/execute',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const unsupported=(response:Response)=>{response.json({supported:false});};
  if(!api.test(req.params.apiName))throw new Error('Invalid page API name');
  if(!await tenantServerFormulaEnabled(deps.db,actor.tenant_id)){unsupported(res);return;}
  await deps.rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
  const body=(req.body??{}) as Record<string,unknown>;
  const variant=pageLayoutVariant(body.variant??'Desktop');
  const key=String(body.key??''),revision=Number(body.revision),steps=body.dataSteps;
  if(!compiledActionKeyPattern.test(key)||!Number.isSafeInteger(revision)||!Number.isSafeInteger(steps)
    ||(steps as number)<1||!validActionScope(body.scope)){unsupported(res);return;}
  const target={tenantId:actor.tenant_id,apiName:req.params.apiName,variant};
  let plan=deps.scripts.action(target,revision,key);
  if(!plan){
   // Not built yet on this server: build from the saved page, but only for that exact revision.
   const page=asCompilerPage(await deps.pages.editor(actor.tenant_id,req.params.apiName,variant));
   const saved=page.draftRevision??page.revision??page.publishedRevision??null;
   if(saved!==revision){unsupported(res);return;}
   deps.scripts.build(target,page,asCompilerObjects(await deps.definitions.list(actor.tenant_id)));
   plan=deps.scripts.action(target,revision,key);
  }
  // The browser asks for the data prefix it expects; anything else is not this action.
  if(!plan||plan.serverDataSteps!==steps){unsupported(res);return;}
  const started=performance.now();
  const stats={operations:0,reusedReads:0,steps:[] as string[]};
  const result=await executeServerDataAction(deps.db,deps.records,actor,plan.formula,body.scope,plan.serverDataSteps,deps.rbac,stats);
  res.setHeader('Server-Timing','action;dur='+(performance.now()-started).toFixed(1)
   +',ops;desc="'+stats.operations+' operations, '+stats.reusedReads+' reused reads"');
  res.json(result);
 }));
}
