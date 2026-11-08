import {template,uuid,type ActionContext} from './ActionNodeShared.js';
export async function executeQuickActionNode(context:ActionContext) {
 const {client,rbac,tenantId,userId,config,resolve,records}=context;
 const objectApi=config.objectApiName,actionId=config.quickActionId;
 const recordId=template(config.recordId,resolve);
 if(typeof objectApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)
   ||typeof actionId!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(actionId)
   ||!uuid.test(recordId)||!records)
  throw new Error('Invalid Quick Action configuration');
 await rbac.require(tenantId,userId,'ObjectDefinition','read');
 const {rows}=await client.query<{field_api:string;value_text:string}>(`
  SELECT field_api,value_text FROM md_object_actions
  WHERE tenant_id=$1 AND object_api=$2 AND action_id=$3 AND action_type='Custom'
   AND enabled=true AND behavior='Set Field Value' FOR SHARE
 `,[tenantId,objectApi,actionId]);
 const action=rows[0];
 if(!action)throw new Error('Quick Action is unavailable');
 await records.update(tenantId,userId,objectApi,recordId,{[action.field_api]:action.value_text},undefined,client);
}

