import { insertFlowElementAtPath } from './flowInsertElement.mjs';

/**
 * Safe metadata-only graph operations shared by pointer, keyboard and toolbox UX.
 * Never infer an outcome, fault, scheduled or async path from array position.
 */
function node(flow,id) {
  const found=flow.elements.find(item=>item.id===id);
  if(!found)throw Error('Flow element no longer exists.');
  return found;
}
function edges(flow,id) {
  return {
    incoming:flow.connectors.filter(item=>item.to===id),
    outgoing:flow.connectors.filter(item=>item.from===id)
  };
}
export function canBypassFlowElement(flow,id) {
  const target=node(flow,id);
  if(target.type==='Start'||target.type==='End')return false;
  const {incoming,outgoing}=edges(flow,id);
  // Multiple branches cannot be collapsed without choosing an outcome.
  if(outgoing.length>1)return false;
  if(incoming.length>0&&outgoing.length!==1)return false;
  if(outgoing.length===1) {
    if(outgoing[0].kind!=='normal'||outgoing[0].to===id)return false;
    if(incoming.some(edge=>edge.from===outgoing[0].to||edge.from===id))return false;
    // Preserve incoming semantics; never silently merge distinct configured paths.
    if(incoming.some(edge=>flow.connectors.some(other=>other.from===edge.from
      &&other.to===outgoing[0].to&&other.kind===edge.kind
      &&other.label===edge.label&&other.id!==edge.id)))return false;
  }
  return true;
}
export function removeFlowGraphElement(flow,id) {
  if(!canBypassFlowElement(flow,id))
    throw Error('Cannot remove a branched or terminal element. Disconnect or select its paths first.');
  const {outgoing}=edges(flow,id);
  const successor=outgoing[0]?.to;
  return {
    ...flow,
    elements:flow.elements.filter(item=>item.id!==id),
    connectors:flow.connectors.filter(item=>item.from!==id)
      .filter(item=>item.to!==id||successor!==undefined)
      .map(item=>item.to===id?{...item,to:successor}:item)
  };
}
export function duplicateFlowGraphElement(flow,id,connectorId,newId,newConnectorId) {
  const source=node(flow,id);
  if(source.type==='Start'||source.type==='End')
    throw Error('Start and End cannot be duplicated.');
  const {outgoing}=edges(flow,id);
  if(outgoing.length>1&&!connectorId)
    throw Error('Choose the branch path to insert the duplicate.');
  const copy={...source,id:newId,label:source.label+' Copy',
    config:structuredClone(source.config??{})};
  // Stored freeform positions are per-node authoring metadata.
  delete copy.config.canvasPosition;
  return insertFlowElementAtPath(flow,id,copy,connectorId,newConnectorId);
}
export function retargetFlowGraphConnector(flow,connectorId,targetId) {
  const connector=flow.connectors.find(item=>item.id===connectorId);
  if(!connector)throw Error('Connector no longer exists.');
  const target=node(flow,targetId);
  if(target.type==='Start'||targetId===connector.from)
    throw Error('A connector cannot target Start or its own source.');
  if(flow.connectors.some(item=>item.id!==connectorId&&item.from===connector.from
    &&item.to===targetId&&item.label===connector.label&&item.kind===connector.kind))
    throw Error('A matching connector already exists on this path.');
  return {...flow,connectors:flow.connectors.map(item=>
    item.id===connectorId?{...item,to:targetId}:item)};
}
export function flowGraphDiagnostics(flow) {
  const ids=new Set(flow.elements.map(item=>item.id));
  const start=flow.elements.find(item=>item.type==='Start');
  const reachable=new Set();
  const queue=start?[start.id]:[];
  while(queue.length) {
    const id=queue.shift();
    if(reachable.has(id))continue;
    reachable.add(id);
    for(const edge of flow.connectors.filter(item=>item.from===id))
      if(ids.has(edge.to)&&!reachable.has(edge.to))queue.push(edge.to);
  }
  const problems=[];
  for(const edge of flow.connectors) {
    if(!ids.has(edge.from)||!ids.has(edge.to))
      problems.push({nodeId:ids.has(edge.from)?edge.from:undefined,
        description:'Connector '+edge.id+' points to a missing element'});
  }
  for(const item of flow.elements) {
    if(!reachable.has(item.id))
      problems.push({nodeId:item.id,description:item.label+' is not reachable from Start'});
    if(item.type!=='End'&&!flow.connectors.some(edge=>edge.from===item.id))
      problems.push({nodeId:item.id,description:item.label+' has no outgoing path'});
  }
  return problems;
}
