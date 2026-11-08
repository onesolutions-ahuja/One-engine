/** Shared metadata contract for a Loop's current Record variable.
 * A Flow may explicitly declare a loop item as a Record resource. Reuse that
 * declaration when it agrees with the source collection; reject mismatches.
 * No application-specific behaviour or implicit persistence is introduced.
 */
type FlowResource={name:string;type:string;dataType:string};
type LoopElement={type:string;config:Record<string,unknown>};

const objectName=/^[A-Za-z][A-Za-z0-9_]*$/;

export function resolveFlowLoopResources(
 elements:readonly LoopElement[], resources:readonly FlowResource[]
):FlowResource[]{
 const inferred:FlowResource[]=[];
 for(const element of elements){
  if(element.type!=='Loop'||typeof element.config.loopVariable!=='string')continue;
  const name=element.config.loopVariable;
  if(!objectName.test(name))throw new Error('Invalid Loop variable');
  const collection=resources.find(resource=>
   resource.name===element.config.collection&&resource.type==='Record Collection');
  if(!collection||!objectName.test(collection.dataType))
   throw new Error('Loop source has no valid Record Collection Object');
  const existing=[...resources,...inferred].find(resource=>resource.name===name);
  if(existing){
   if(existing.type!=='Record'||existing.dataType!==collection.dataType)
    throw new Error('Loop variable conflicts with a declared Flow resource');
   continue;
  }
  inferred.push({name,type:'Record',dataType:collection.dataType});
 }
 return inferred;
}
