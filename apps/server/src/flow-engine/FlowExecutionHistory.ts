import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses=new Set(['pending','waiting','completed','failed','cancelled']);
type RunRow={
  id:string;api_name:string;label:string|null;version:number;flow_type:string;
  started_by:string;started_at:Date|string;finished_at:Date|string|null;
  error_code:string|null;status:string
};

/** Tenant-scoped, bounded, paged SQL history; no input, resource or credential values stored. */
export async function flowRunHistory(db:SqlPersistence,rbac:RbacEngine|undefined,
  tenantId:string,userId:string,
  filters:{status?:unknown;limit?:unknown;cursor?:unknown}={}){
  if(!rbac)throw new Error('Flow permissions not configured');
  await rbac.require(tenantId,userId,'FlowDefinition','read');
  const status=filters.status===undefined||filters.status===''?null:filters.status;
  if(status!==null&&(typeof status!=='string'||!statuses.has(status)))
    throw new Error('Invalid Flow status filter');
  const limit=filters.limit===undefined?50:Number(filters.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw new Error('Flow history limit must be between 1 and 100');
  const params:unknown[]=[tenantId,limit+1];
  const clauses=['r.tenant_id=$1'];
  if(status!==null){params.push(status);clauses.push('r.status=$'+params.length);}
  if(filters.cursor!==undefined&&filters.cursor!==''){
    if(typeof filters.cursor!=='string'||filters.cursor.length>100)
      throw new Error('Invalid Flow history cursor');
    const [timestamp,id,...extra]=filters.cursor.split('|');
    if(extra.length||!timestamp||!id||!uuid.test(id)
      ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)
      ||Number.isNaN(Date.parse(timestamp)))
      throw new Error('Invalid Flow history cursor');
    params.push(timestamp,id);
    clauses.push('(r.started_at,r.id)<($'+(params.length-1)+'::timestamptz,$'+params.length+'::uuid)');
  }
  const {rows}=await db.query<RunRow>(`
    SELECT r.id,f.api_name,f.label,f.version,f.flow_type,r.started_by,
      r.started_at,r.finished_at,r.error_code,r.status
    FROM md_flow_runs r
    JOIN md_flow_definitions f ON f.id=r.flow_id AND f.tenant_id=r.tenant_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY r.started_at DESC,r.id DESC LIMIT $2
  `,params);
  const page=rows.slice(0,limit);
  const last=page.at(-1);
  const nextCursor=rows.length>limit&&last
    ?new Date(last.started_at).toISOString()+'|'+last.id:null;
  return {runs:page.map(row=>{
    const startedAt=new Date(row.started_at),finishedAt=row.finished_at?new Date(row.finished_at):null;
    return {
      id:row.id,flowApiName:row.api_name,flowLabel:row.label??row.api_name,
      versionNumber:row.version,flowType:row.flow_type,status:row.status,
      startedAt:startedAt.toISOString(),finishedAt:finishedAt?.toISOString()??null,
      durationMs:finishedAt?Math.max(0,finishedAt.getTime()-startedAt.getTime()):null,
      error:row.error_code??null,userId:row.started_by
    };
  }),nextCursor};
}

/** Legacy failure-log format for existing Flow monitoring screens. */
export async function failedFlowLogs(db:SqlPersistence,rbac:RbacEngine|undefined,tenantId:string,userId:string) {
    if(!rbac)throw new Error('Flow permissions not configured');
    await rbac.require(tenantId,userId,'FlowDefinition','read');
    const {rows}=await db.query<{
      id:string;api_name:string;label:string|null;started_by:string;finished_at:Date|null;
      started_at:Date;error_code:string|null
    }>(`
      SELECT r.id,f.api_name,f.label,r.started_by,r.finished_at,r.started_at,r.error_code
      FROM md_flow_runs r JOIN md_flow_definitions f ON f.id=r.flow_id AND f.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 AND r.status='failed'
      ORDER BY r.started_at DESC LIMIT 100
    `,[tenantId]);
    return {logs:rows.map(r=>({
      id:r.id,flowApiName:r.api_name,flowLabel:r.label??r.api_name,
      trigger:'Manual' as const,failedAt:new Date(r.finished_at??r.started_at).toISOString(),
      error:r.error_code??'Execution failed',userId:r.started_by
    }))};
  }

export async function pendingFlowInterviews(db:SqlPersistence,rbac:RbacEngine|undefined,tenantId:string,userId:string) {
    if(!rbac)throw new Error('Flow permissions not configured');
    await rbac.require(tenantId,userId,'FlowDefinition','read');
    const {rows}=await db.query<{
      id:string;api_name:string;label:string|null;version:number;flow_type:string;
      wait_kind:string;
      started_by:string;email:string;started_at:Date;wait_until:Date|null
    }>(`
      SELECT r.id,f.api_name,f.label,f.version,f.flow_type,r.wait_kind,
        r.started_by,u.email,r.started_at,r.wait_until
      FROM md_flow_runs r JOIN md_flow_definitions f ON f.id=r.flow_id AND f.tenant_id=r.tenant_id
      JOIN md_users u ON u.id=r.started_by AND u.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 AND r.status IN ('pending','waiting')
      ORDER BY r.started_at DESC LIMIT 100
    `,[tenantId]);
    return {interviews:rows.map(r=>({
      id:r.id,flowApiName:r.api_name,flowLabel:r.label??r.api_name,
      versionNumber:r.version,kind:r.flow_type==='Screen Flow'?'screen' as const
        :r.wait_kind==='scheduled-path'?'scheduled' as const
        :r.wait_kind==='orchestration'?'orchestration' as const:'wait' as const,
      userId:r.started_by,userName:r.email,screenLabel:null,recordId:null,
      createdAt:new Date(r.started_at).toISOString(),
      expiresAt:new Date(new Date(r.started_at).getTime()+86400000).toISOString(),
      waitUntil:r.wait_until?new Date(r.wait_until).toISOString():null,retryAt:null,attempts:0
    }))};
  }
