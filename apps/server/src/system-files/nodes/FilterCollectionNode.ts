import {evaluateFlowDecisionOutcome} from '../flow-decision-runtime.js';
import type {FlowRecordCondition} from '../flow-record-query.js';
export function executeFilterCollectionNode(config:Record<string,unknown>, records:Record<string,unknown>[],evaluate:(value:unknown)=>unknown,conditionsFrom:(value:unknown,evaluate:(value:unknown)=>unknown)=>FlowRecordCondition[]):Record<string,unknown>[] {
 const conditions=conditionsFrom(config.conditions,evaluate);
 if(conditions.length===0)throw new Error('Collection Filter requires at least one condition');
 return records.filter(item=>{
  const rows=conditions.map(condition=>({...condition,field:item[String(condition.field)]}));
  return evaluateFlowDecisionOutcome(rows,typeof config.conditionLogic==='string'?config.conditionLogic:undefined,value=>value);
 });
}
