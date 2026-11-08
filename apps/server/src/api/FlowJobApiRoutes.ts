import type {Express} from 'express';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {DurableJobService} from '../system-support/durable-job-service.js';
import {authenticated,wrap} from './ApiAuthenticationGuard.js';
/** Durable job control routes shared by published Flow execution. */
export function registerFlowJobApiRoutes(app:Express,rbac:RbacEngine,jobs:DurableJobService){
  app.get('/api/jobs/:id',wrap(async(req,res)=>{
    const actor=authenticated(req);
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','manage');
    if(!/^[0-9a-f-]{36}$/i.test(req.params.id))throw new Error('Invalid job ID');
    res.setHeader('Cache-Control','private, no-store');
    res.json({job:await jobs.inspect(actor.tenant_id,req.params.id)});
  }));
  app.post('/api/jobs/:id/cancel-failed',wrap(async(req,res)=>{
    const actor=authenticated(req);
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','manage');
    if(!/^[0-9a-f-]{36}$/i.test(req.params.id))throw new Error('Invalid job ID');
    await jobs.cancelFailed(actor.tenant_id,req.params.id);
    res.json({cancelled:true});
  }));

  app.post('/api/jobs/:id/reconcile',wrap(async(req,res)=>{
    const actor=authenticated(req);
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','manage');
    if(!/^[0-9a-f-]{36}$/i.test(req.params.id))throw new Error('Invalid job ID');
    const decision=req.body?.decision;
    if(decision!=='acknowledge'&&decision!=='retry')throw new Error('Invalid job reconciliation');
    // Explicit confirmation is mandatory because retry may duplicate irreversible effects.
    if(req.body?.reviewedExternalEffects!==true)throw new Error('Invalid reconciliation confirmation');
    await jobs.reconcileFailed(actor.tenant_id,req.params.id,actor.user_id,decision);
    res.setHeader('Cache-Control','private, no-store');
    res.json({resolved:true,decision});
  }));

}
