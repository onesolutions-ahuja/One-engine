import type {FlowNodeContext,FlowActionResult} from './NodeContext.js';
export async function resolveMutationTargets(context:FlowNodeContext):Promise<{objectApi:string;targets:Record<string,unknown>[]}>{
 const {tenantId,userId,client,node,recordQuery,vars,evaluate,conditionsFrom,recordValues}=context;
 const config=node.config;
 const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;
    const objectApi=String(config.object??'');
    if(!apiName.test(objectApi))throw new Error('Invalid record mutation Object');
    const configuredId=config.recordId===undefined?'':evaluate(config.recordId);
    let targets:Record<string,unknown>[];
    if(config.recordSource==='collection'){
      targets=recordValues(vars[String(config.collection??'')]);
    }else if(config.recordSource==='record'){
      const record=vars[String(config.recordVariable??'')];
      if(!record||typeof record!=='object'||Array.isArray(record))
        throw new Error('Record mutation requires a single record variable');
      targets=[record as Record<string,unknown>];
    }else if(typeof configuredId==='string'&&configuredId){
      targets=[{Id:configuredId}];
    }else{
      const conditions=conditionsFrom(config.conditions,evaluate);
      if(!conditions.length)throw new Error('Record mutation requires an ID, record collection, or filter condition');
      targets=await recordQuery.find(tenantId,userId,objectApi,conditions,
        typeof config.conditionLogic==='string'?config.conditionLogic:undefined,
        {limit:200},client);
    }
    if(targets.length>200)throw new Error('Flow record mutation exceeds the 200-record limit');
 return {objectApi,targets};
}
