import {executeCountCollectionNode} from './CountCollectionNode.js';
import {executeFilterCollectionNode} from './FilterCollectionNode.js';
import {executeSortCollectionNode} from './SortCollectionNode.js';
import {executeTransformNode} from './TransformNode.js';
import {executeDeleteRecordsNode} from './DeleteRecordsNode.js';
import {executeUpdateRecordsNode} from './UpdateRecordsNode.js';
import {executeGetRecordsNode} from './GetRecordsNode.js';
import {executeAvailableSlotsNode} from './AvailableSlotsNode.js';
import {executeParseJsonNode} from './ParseJsonNode.js';
import {executeBusinessContextNode} from './BusinessContextNode.js';
import {executeCreateRecordsNode} from './CreateRecordsNode.js';
import {executeLoopNode} from './LoopNode.js';
import type {PoolClient} from 'pg';
import type {RecordEngine} from '../record-engine.js';
import type {FlowRecordQuery} from '../flow-record-query.js';
import {conditionsFrom,recordValues,isFlowRecordScalar as scalar} from './RecordNodeValidation.js';
import {evaluateFlowDecisionOutcome} from '../flow-decision-runtime.js';

type FlowNode={id:number;type:string;config:Record<string,unknown>};
type FlowActionResult={handled:boolean;selected?:string;clearHistory?:boolean};
type Context={
  tenantId:string;userId:string;client:PoolClient;node:FlowNode;
  records:RecordEngine;recordQuery:FlowRecordQuery;vars:Record<string,unknown>;
  loops:Map<number,number>;evaluate:(value:unknown)=>unknown;
  set:(name:unknown,value:string|number|boolean|null)=>void;
};
const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;

/** Shared pure collection operations, used by both execution and read-only debug. */
export function evaluateFlowCollectionStep(type:string,config:Record<string,unknown>,
  source:unknown,evaluate:(value:unknown)=>unknown):Record<string,unknown>[] {
  const records=recordValues(source);
  if(type==='Collection Filter')return executeFilterCollectionNode(config,records,evaluate,conditionsFrom);
  if(type==='Collection Sort')return executeSortCollectionNode(config,records);
  return executeTransformNode(config,records);
}

export async function executeFlowDataAction(context:Context):Promise<FlowActionResult> {
  const {tenantId,userId,client,node,records,recordQuery,vars,loops,evaluate,set}=context;
  const config=node.config;
  if(['Get Context','Set Context','Clear Context'].includes(node.type))return executeBusinessContextNode({...context,conditionsFrom,recordValues,scalar});
  if(node.type==='Parse JSON')return executeParseJsonNode({...context,conditionsFrom,recordValues,scalar});
  if(node.type==='Get Available Slots')return executeAvailableSlotsNode({...context,conditionsFrom,recordValues,scalar});
  if(node.type==='Get Records')return executeGetRecordsNode({...context,conditionsFrom,recordValues,scalar});
  if(node.type==='Update Records')return executeUpdateRecordsNode({...context,conditionsFrom,recordValues,scalar});
  if(node.type==='Delete Records')return executeDeleteRecordsNode({...context,conditionsFrom,recordValues,scalar});
  if(node.type==='Loop')return executeLoopNode({node,vars,loops});
  if(node.type==='Count Collection'){
    const output=String(config.outputVariable??'');
    if(!apiName.test(output))throw new Error('Invalid Count Collection output variable');
    vars[output]=executeCountCollectionNode(vars[String(config.collection??'')]);
    return {handled:true};
  }
  if(node.type==='Collection Filter'||node.type==='Collection Sort'||node.type==='Transform'){
    const output=String(config.outputCollection??'');
    if(!apiName.test(output))throw new Error('Invalid collection output variable');
    vars[output]=evaluateFlowCollectionStep(node.type,config,
      vars[String(config.collection??'')],evaluate);
    return {handled:true};
  }
  if(node.type==='Create Records'||node.type==='CreateRecord')return executeCreateRecordsNode({...context,conditionsFrom,recordValues,scalar});
  return {handled:false};
}
