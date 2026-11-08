import type {Express} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';
import {DurableJobService} from '../system-support/durable-job-service.js';
import {registerFlowJobApiRoutes} from './FlowJobApiRoutes.js';
import {PlatformEventService} from '../system-support/platform-event-service.js';
export function registerFlowApiController(app:Express,db:SqlPersistence,rbac:RbacEngine,flows:FlowRuntime){
 const jobs=new DurableJobService(db);
 const platformEvents=new PlatformEventService(db,rbac);
  app.post('/api/platform-events/:apiName/publish',wrap(async(req,res)=>{
    const actor=authenticated(req);
    const result=await platformEvents.publish(actor.tenant_id,actor.user_id,req.params.apiName,req.body);
    res.status(202).json(result);
  }));
  registerFlowJobApiRoutes(app,rbac,jobs);

  // Frontends discover executable tenant Flows without FlowDefinition read access.
  // Product-prefixed Flow API names are an authoring convention, not UI business logic.
  app.get('/api/flows/available-actions',wrap(async(req,res)=>{
    const actor=authenticated(req);
    const product=req.query.product;
    if(typeof product!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(product))
      throw new Error('Invalid product');
    const {rows}=await db.query<{api_name:string;label:string}>(`
      SELECT DISTINCT ON (api_name) api_name,label
      FROM md_flow_definitions
      WHERE tenant_id=$1 AND active=true AND archived=false
        AND lower(api_name) LIKE lower($2) || '%'
      ORDER BY api_name,version DESC LIMIT 100`,[actor.tenant_id,product]);
    const permitted=await rbac.allowedMany(actor.tenant_id,actor.user_id,
      rows.map(row=>({resource:'Flow:'+row.api_name,action:'execute'})));
    res.setHeader('Cache-Control','private, no-store');
    res.json({actions:rows.filter((_,index)=>permitted[index]).map(row=>({apiName:row.api_name,label:row.label}))});
  }));

  app.post('/api/flows/:apiName/schedule',wrap(async(req,res)=>{
    const actor=authenticated(req),flowName=req.params.apiName;
    if(!api.test(flowName))throw new Error('Invalid Flow name');
    await rbac.require(actor.tenant_id,actor.user_id,'Flow:'+flowName,'execute');
    const active=await flows.loadActive(actor.tenant_id,flowName);
    if(!active)throw new Error('Active flow not found');
    const body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid schedule');
    const at=body.runAt;
    if(typeof at!=='string'||!/Z$|[+-][0-9]{2}:[0-9]{2}$/.test(at))throw new Error('Invalid schedule time');
    const date=new Date(at);
    if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()-1000)
      throw new Error('Invalid schedule time');
    const app=body.appApiName;
    if(app!==undefined){
      if(typeof app!=='string'||!api.test(app))throw new Error('Invalid app');
      const {rows}=await db.query(`
        SELECT 1 FROM md_apps a
        JOIN md_app_installations i ON i.tenant_id=$1 AND i.app_id=a.id
        JOIN md_app_entitlements e ON e.tenant_id=$1 AND e.app_id=a.id
        WHERE a.api_name=$2 AND a.enabled=true AND e.active=true
        AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)`,
       [actor.tenant_id,app]);
      if(!rows.length)throw new Error('App not installed or entitled');
    }
    if(body.idempotencyKey!==undefined&&(typeof body.idempotencyKey!=='string'
      ||body.idempotencyKey.length>128))throw new Error('Invalid idempotency key');
    if(body.recurrenceSeconds!==undefined&&(!Number.isInteger(body.recurrenceSeconds)||
      body.recurrenceSeconds<60||body.recurrenceSeconds>31536000))
      throw new Error('Invalid recurring interval');
    const id=await jobs.enqueue(actor.tenant_id,'flow.execute',{
      actorUserId:actor.user_id,resourceId:flowName,resourceVersion:active.version,appApiName:app,
      scheduledAt:date,idempotencyKey:body.idempotencyKey,
      recurrenceSeconds:body.recurrenceSeconds
    });
    res.status(201).json({id,status:'queued'});
  }));

  const debug=wrap(async(req,res)=>{
    const actor=authenticated(req);
    if(!api.test(req.params.apiName))throw new Error('Invalid Flow name');
    const recordTriggered=req.path.endsWith('/debug-record');
    res.setHeader('Cache-Control','private, no-store');
    res.json(await flows.debugGraph(actor.tenant_id,actor.user_id,req.params.apiName,
      req.body?.inputs??req.body??{},recordTriggered));
  });
  app.post('/api/flows/:apiName/debug',debug);
  app.post('/api/flows/:apiName/debug-record',debug);}
