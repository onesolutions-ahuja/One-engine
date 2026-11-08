// Extracted Flow loop handler. Execution state remains owned by the caller.
const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;
export function executeLoopNode(input:{node:{id:number;config:Record<string,unknown>};vars:Record<string,unknown>;loops:Map<number,number>}):{handled:boolean;selected?:string}{
  const {node,vars,loops}=input;
  const config=node.config;
    const collection=vars[String(config.collection??'')];
    if(!Array.isArray(collection)||collection.length>200)
      throw new Error('Loop source must be a record collection of at most 200 records');
    const direction=config.direction==='Last to first'?-1:1;
    let index=loops.get(node.id);
    if(index===undefined)index=direction===1?0:collection.length-1;
    if(index<0||index>=collection.length){
      loops.delete(node.id);
      return {handled:true,selected:'After Last'};
    }
    const item=collection[index];
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Loop items must be records');
    if(typeof config.loopVariable!=='string'||!apiName.test(config.loopVariable))
      throw new Error('Invalid Loop variable');
    vars[config.loopVariable]=item;
    loops.set(node.id,index+direction);
    return {handled:true,selected:'For Each'};
}
