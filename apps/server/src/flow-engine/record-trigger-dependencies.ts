/** Stable shared ordering of active record-triggered flows for one record event.
 * Dependencies constrain sequence only for flows that match this event; they
 * do not make an otherwise ineligible flow run. Cycle errors fail the record
 * transaction before any Flow executes. */
export type TriggerDependency={apiName:string;order:number;runAfterFlows:readonly string[]};
const identifier=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
export function validateTriggerDependencies(value:unknown,self:string):string[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>20
   ||value.some(name=>typeof name!=='string'||!identifier.test(name)||name===self)
   ||new Set(value).size!==value.length)
  throw new Error('Run-after Flows must be up to 20 distinct Flow names, excluding this Flow');
 return value as string[];
}
export function orderTriggeredFlows<T extends TriggerDependency>(items:readonly T[]):T[]{
 const map=new Map(items.map(item=>[item.apiName,item]));
 if(map.size!==items.length)throw new Error('Duplicate active Flow identities');
 const indegree=new Map<string,number>(),followers=new Map<string,string[]>();
 const comparator=(a:T,b:T)=>a.order-b.order||a.apiName.localeCompare(b.apiName);
 for(const item of items){
  const dependency=validateTriggerDependencies(item.runAfterFlows,item.apiName);
  indegree.set(item.apiName,dependency.filter(name=>map.has(name)).length);
  for(const name of dependency){
   if(!map.has(name))continue;
   followers.set(name,[...(followers.get(name)??[]),item.apiName]);
  }
 }
 const queue=items.filter(item=>indegree.get(item.apiName)===0).sort(comparator);
 const ordered:T[]=[];
 while(queue.length){
  const item=queue.shift()!;
  ordered.push(item);
  for(const name of followers.get(item.apiName)??[]){
   const next=(indegree.get(name)??0)-1;indegree.set(name,next);
   if(next===0){queue.push(map.get(name)!);queue.sort(comparator);}
  }
 }
 if(ordered.length!==items.length)
  throw new Error('Record-Triggered Flow run-after dependency cycle detected');
 return ordered;
}
