import type {FlowNodeContext,FlowActionResult} from './NodeContext.js';
const name=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
/** One generic Context action for every business Object, with actor-only selections. */
export async function executeBusinessContextNode(ctx:FlowNodeContext):Promise<FlowActionResult>{
 const {tenantId,userId,client,node,records,evaluate,vars}=ctx;
 const api=String(node.config.contextApiName??'');
 if(!name.test(api))throw Error('Select a Context definition');
 const found=await client.query<{object_api:string}>(
  'SELECT object_api FROM md_context_definitions WHERE tenant_id=$1 AND api_name=$2',
  [tenantId,api]);
 const objectApi=found.rows[0]?.object_api;
 if(!objectApi)throw Error('Context definition not found');
 if(node.type==='Get Context'){
  const output=String(node.config.outputVariable??'');
  if(!name.test(output))throw Error('Select a Context output Variable');
  const result=await client.query<{record_id:string}>(
   'SELECT record_id FROM md_user_context_selections WHERE tenant_id=$1 AND user_id=$2 AND context_api=$3',
   [tenantId,userId,api]);
  if(result.rows[0])await records.get(tenantId,userId,objectApi,result.rows[0].record_id,client);
  vars[output]=result.rows[0]?.record_id??null;
 }else if(node.type==='Set Context'){
  const id=evaluate(node.config.recordId);
  if(typeof id!=='string'||!uuid.test(id))throw Error('Context requires a valid Record Id');
  await records.get(tenantId,userId,objectApi,id,client);
  await client.query(
   'INSERT INTO md_user_context_selections(tenant_id,user_id,context_api,record_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,user_id,context_api) DO UPDATE SET record_id=EXCLUDED.record_id,updated_at=now()',
   [tenantId,userId,api,id]);
 }else if(node.type==='Clear Context'){
  await client.query(
   'DELETE FROM md_user_context_selections WHERE tenant_id=$1 AND user_id=$2 AND context_api=$3',
   [tenantId,userId,api]);
 }else return {handled:false};
 return {handled:true};
}
