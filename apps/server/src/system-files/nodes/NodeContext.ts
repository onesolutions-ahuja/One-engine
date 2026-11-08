import type {PoolClient} from 'pg';
import type {RecordEngine} from '../record-engine.js';
import type {FlowRecordQuery,FlowRecordCondition} from '../flow-record-query.js';
export type FlowNodeContext={
 tenantId:string;userId:string;client:PoolClient;
 node:{id:number;type:string;config:Record<string,unknown>};
 records:RecordEngine;recordQuery:FlowRecordQuery;
 vars:Record<string,unknown>;loops:Map<number,number>;
 evaluate:(value:unknown)=>unknown;
 set:(name:unknown,value:string|number|boolean|null)=>void;
 conditionsFrom:(value:unknown,evaluate:(value:unknown)=>unknown)=>FlowRecordCondition[];
 recordValues:(value:unknown)=>Record<string,unknown>[];
 scalar:(value:unknown)=>value is string|number|boolean|null;
};
export type FlowActionResult={handled:boolean;selected?:string;clearHistory?:boolean};
