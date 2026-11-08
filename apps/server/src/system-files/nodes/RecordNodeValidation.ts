import type {FlowRecordCondition} from '../flow-record-query.js';

const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;
const scalar=(value:unknown):value is string|number|boolean|null=>
  value===null||typeof value==='string'||typeof value==='boolean'
  ||typeof value==='number'&&Number.isFinite(value);

export function conditionsFrom(value:unknown,evaluate:(value:unknown)=>unknown):FlowRecordCondition[] {
  if(value===undefined)return [];
  if(!Array.isArray(value))throw new Error('Flow record conditions must be a list');
  if(value.length>50)throw new Error('Flow record actions support at most 50 conditions');
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid Flow record condition');
    const condition=item as Record<string,unknown>;
    if(typeof condition.field!=='string'||!apiName.test(condition.field))
      throw new Error('Invalid Flow record condition field');
    const compared=condition.value===undefined?undefined:evaluate(condition.value);
    if(compared!==undefined&&compared!==null&&!scalar(compared))
      throw new Error('Flow record condition values must be scalar');
    return {field:condition.field,operator:condition.operator,value:compared};
  });
}

export function recordValues(value:unknown):Record<string,unknown>[] {
  if(!Array.isArray(value)||value.length>200)
    throw new Error('Flow record collection must contain at most 200 records');
  for(const item of value)
    if(!item||typeof item!=='object'||Array.isArray(item))
      throw new Error('Flow record collection items must be records');
  return value as Record<string,unknown>[];
}

export {scalar as isFlowRecordScalar};
