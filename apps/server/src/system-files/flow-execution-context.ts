import type {PoolClient} from 'pg';
import type {RbacEngine} from './rbac-engine.js';
import type {SqlExecutor} from './sql-persistence.js';

export type FlowExecutionMode='User'|'System';
export type FlowExecutionActor={mode:FlowExecutionMode;actorUserId:string};

export function flowExecutionMode(value:unknown):FlowExecutionMode {
 if(value===undefined||value===null||value==='User')return 'User';
 if(value==='System')return 'System';
 throw new Error('Unsupported Flow execution context');
}

export async function resolveFlowExecutionActor(db:SqlExecutor|undefined,rbac:RbacEngine,
 tenantId:string,flowApi:string,requestedBy:string,mode:FlowExecutionMode,
 approvedBy:string|null):Promise<FlowExecutionActor> {
 if(mode==='User')return {mode,actorUserId:requestedBy};
 if(!db)throw new Error('System-context Flow execution is not configured');
 if(!approvedBy)throw new Error('System-context Flow has no recorded administrator approval');
 await rbac.require(tenantId,approvedBy,'FlowDefinition','system-context');
 const {rows}=await db.query<{flow_service_user_id:string}>(`
  SELECT s.flow_service_user_id FROM md_tenant_automation_settings s
  JOIN md_users u ON u.tenant_id=s.tenant_id AND u.id=s.flow_service_user_id AND u.enabled=true
  WHERE s.tenant_id=$1 AND s.flow_service_user_id IS NOT NULL`,
 [tenantId]);
 const actorUserId=rows[0]?.flow_service_user_id;
 if(!actorUserId)throw new Error('System-context Flow requires an enabled tenant automation user');
 await rbac.require(tenantId,actorUserId,'Flow:'+flowApi,'execute');
 return {mode,actorUserId};
}

export async function authorizeSystemFlowContext(db:SqlExecutor,rbac:RbacEngine,
 tenantId:string,flowApi:string,approvedBy:string) {
 await rbac.require(tenantId,approvedBy,'FlowDefinition','system-context');
 const {rows}=await db.query<{flow_service_user_id:string}>(`
  SELECT s.flow_service_user_id FROM md_tenant_automation_settings s
  JOIN md_users u ON u.tenant_id=s.tenant_id AND u.id=s.flow_service_user_id AND u.enabled=true
  WHERE s.tenant_id=$1 AND s.flow_service_user_id IS NOT NULL`,
 [tenantId]);
 const actorUserId=rows[0]?.flow_service_user_id;
 if(!actorUserId)throw new Error('System-context Flow requires an enabled tenant automation user');
 await rbac.require(tenantId,actorUserId,'Flow:'+flowApi,'execute');
 return actorUserId;
}

export async function auditSystemFlowContext(client:PoolClient,tenantId:string,flowId:string,
 actorUserId:string,initiatingUserId:string,event:'system-context-approved'|'system-context-run',
 runId?:string) {
 await client.query(`
  INSERT INTO md_flow_execution_audit
   (tenant_id,flow_id,run_id,actor_user_id,initiating_user_id,event)
  VALUES($1,$2,$3,$4,$5,$6)`,
 [tenantId,flowId,runId??null,actorUserId,initiatingUserId,event]);
}
