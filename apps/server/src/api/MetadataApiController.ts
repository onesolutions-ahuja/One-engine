import type {Express} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';
export function registerMetadataApiController(app:Express,db:SqlPersistence,rbac:RbacEngine,records:RecordEngine){
  app.get('/api/metadata/dashboards/:apiName/data/:objectApi',wrap(async(req,res)=>{
    const actor=authenticated(req),dashboard=req.params.apiName,object=req.params.objectApi;
    if(!api.test(dashboard)||!api.test(object))throw new Error('Invalid dashboard or object');
    await rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:dashboards','read');
    await rbac.require(actor.tenant_id,actor.user_id,object,'read');
    const {rows}=await db.query<{properties:Record<string,unknown>}>(`
      SELECT properties FROM md_system_definitions
      WHERE tenant_id=$1 AND kind='dashboards' AND api_name=$2 AND enabled=true`,
      [actor.tenant_id,dashboard]);
    const definition=rows[0]?.properties;
    if(!definition)throw new Error('Dashboard not found');
    if(definition.status!=='Deployed')throw new Error('Dashboard is not deployed');
    if(!Array.isArray(definition.components)||
      !definition.components.some(item=>item&&typeof item==='object'&&
        (item as {objectApiName?:unknown}).objectApiName===object))
      throw new Error('Object is not a dashboard data source');
    // The RecordEngine enforces Record, Object and Field rights and is the only CRUD path.
    const result=await records.list(actor.tenant_id,actor.user_id,object,100,0);
    res.setHeader('Cache-Control','private, no-store');
    res.json({records:result.records});
  }));

}
