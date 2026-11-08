import type {FlowNodeContext,FlowActionResult} from './NodeContext.js';
export async function executeGetRecordsNode(context:FlowNodeContext):Promise<FlowActionResult>{
 const {tenantId,userId,client,node,recordQuery,vars,evaluate,conditionsFrom}=context;
 const config=node.config;
 const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;
    const objectApi=String(config.object??'');
    const conditions=conditionsFrom(config.conditions,evaluate);
    const rawLimit=config.recordLimit??'1';
    const limit=rawLimit==='all'?200:Number(rawLimit);
    if(!Number.isSafeInteger(limit)||limit<1||limit>200)
      throw new Error('Get Records limit must be between 1 and 200');
    const output=typeof config.outputVariable==='string'&&config.outputVariable
      ?config.outputVariable:'record'+node.id;
    if(!apiName.test(output))throw new Error('Invalid Get Records output variable');
    const found=await recordQuery.find(tenantId,userId,objectApi,conditions,
      typeof config.conditionLogic==='string'?config.conditionLogic:undefined,
      {sortField:typeof config.sortField==='string'&&config.sortField?config.sortField:undefined,
        sortOrder:typeof config.sortOrder==='string'?config.sortOrder:undefined,limit,
        ownerScope:typeof config.ownerScope==='string'
          ?config.ownerScope as 'all'|'own'|'direct'|'descendants':undefined},client);
    if(config.requireNonEmpty===true&&!found.length)
      throw Error('Required records are missing or unavailable');
    const selectedFields=Array.isArray(config.fields)
      ?new Set(config.fields.filter((field):field is string=>typeof field==='string')):undefined;
    const projected=found.map(record=>!selectedFields?record:Object.fromEntries(Object.entries(record)
      .filter(([field])=>['Id','CreatedAt','LastModifiedDate','OwnerId','RecordTypeId'].includes(field)
        ||selectedFields.has(field))));
    // Optional metadata-driven reference enrichment for operational lists (e.g. held carts).
    // Related records are always read through the shared RBAC-aware Flow query.
    const enrichments=config.referenceEnrichments;
    let resolved=projected;
    if(enrichments!==undefined){
      if(!Array.isArray(enrichments)||enrichments.length>4)
        throw Error('Invalid reference enrichment metadata');
      const cache=new Map<string,Record<string,unknown>>();
      resolved=[];
      for(const record of projected){
        const enriched:Record<string,unknown>={...record};
        for(const raw of enrichments){
          if(!raw||typeof raw!=='object'||Array.isArray(raw))
            throw Error('Invalid reference lookup');
          const lookup=raw as Record<string,unknown>;
          const field=String(lookup.referenceField??''),object=String(lookup.object??'');
          const mappings=lookup.fields;
          if(!apiName.test(field)||!apiName.test(object)||!mappings
            ||typeof mappings!=='object'||Array.isArray(mappings)
            ||Object.keys(mappings).length>20)
            throw Error('Invalid reference lookup properties');
          const id=record[field];
          if(typeof id!=='string'||!id)throw Error('Related record reference is missing');
          const key=object+':'+id;
          let related=cache.get(key);
          if(!related){
            const matches=await recordQuery.find(tenantId,userId,object,
              [{field:'Id',operator:'Equals',value:id}],undefined,{limit:1},client);
            if(!matches[0])throw Error('Related record cannot be read');
            related=matches[0];
            cache.set(key,related);
          }
          for(const [target,source] of Object.entries(mappings as Record<string,unknown>)){
            if(!apiName.test(target)||target==='Id'||typeof source!=='string'||!apiName.test(source))
              throw Error('Invalid reference projection');
            if(!Object.hasOwn(related,source))throw Error('Related record field is not readable');
            enriched[target]=related[source];
          }
        }
        resolved.push(enriched);
      }
    }
    vars[output]=limit===1?resolved[0]??null:resolved;
    return {handled:true};
}
