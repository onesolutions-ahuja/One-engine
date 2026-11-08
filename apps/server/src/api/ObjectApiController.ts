import type {Express} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';
export function registerObjectApiController(app:Express,records:RecordEngine){
  app.get('/api/records/:objectApi/typed-aggregate/:fieldApi',wrap(async(req,res)=>{
    const actor=authenticated(req);
    const result=await records.aggregateNumeric(actor.tenant_id,actor.user_id,
      req.params.objectApi,req.params.fieldApi);
    res.setHeader('Cache-Control','private, no-store');
    res.json(result);
  }));
  app.get('/api/records/:objectApi/typed-filter/:fieldApi',wrap(async(req,res)=>{
    const actor=authenticated(req);
    const op=req.query.op;
    const value=req.query.value;
    if(typeof op!=='string'||!['eq','lt','lte','gt','gte'].includes(op)||
      typeof value!=='string'||value.length>128)
      throw new Error('Invalid typed filter');
    const size=req.query.limit===undefined?50:Number(req.query.limit);
    const ids=await records.filterTyped(actor.tenant_id,actor.user_id,req.params.objectApi,
      req.params.fieldApi,op as 'eq'|'lt'|'lte'|'gt'|'gte',value,size,
      req.query.direction==='desc'?'desc':'asc');
    res.setHeader('Cache-Control','private, no-store');
    res.json({ids});
  }));

}
