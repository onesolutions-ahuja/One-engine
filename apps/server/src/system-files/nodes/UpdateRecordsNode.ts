import type {FlowNodeContext,FlowActionResult} from './NodeContext.js';

const validField=/^[A-Za-z][A-Za-z0-9_]*$/;

/** Reusable metadata-driven record mutation. Object, record and field RBAC remain in RecordEngine. */
export function fieldsFromRecord(record:Record<string,unknown>,
 scalar:(value:unknown)=>boolean):Record<string,unknown> {
 const entries=Object.entries(record).filter(([name])=>name!=='Id');
 if(!entries.length||entries.length>100)throw Error('Update Records needs between 1 and 100 fields');
 const fields:Record<string,unknown>={};
 for(const [field,value] of entries){
  if(!validField.test(field)||!scalar(value))throw Error('Invalid Update Records field: '+field);
  fields[field]=value;
 }
 return fields;
}

import {resolveMutationTargets} from './RecordMutationTargets.js';
import {enforceRecordOverlap} from './RecordOverlapGuard.js';
import {enforceRecordAvailability} from './RecordAvailabilityGuard.js';
import {defaultDocumentLineTotalsConfig,enforceDocumentIssue,prepareDocumentLineMutation,recalculateDocumentLineTotals} from './DocumentFinancialGuard.js';
export async function executeUpdateRecordsNode(context:FlowNodeContext):Promise<FlowActionResult>{
 const {tenantId,userId,client,records,evaluate,scalar}=context;
 const config=context.node.config;
 const {objectApi,targets}=await resolveMutationTargets(context);
 const lineTotalsConfig=(objectApi==='QuotationLine'||objectApi==='InvoiceLine')
  ?config.documentLineTotals??defaultDocumentLineTotalsConfig(objectApi):null;
 const dynamic=config.fieldSource==='record';
 if(dynamic&&config.recordSource!=='record'&&config.recordSource!=='collection')
  throw Error('Record-sourced updates require a record or collection target');
 const assignments=Array.isArray(config.fieldValues)?config.fieldValues:[];
 if(!dynamic&&(!assignments.length||assignments.length>100))
  throw Error('Update Records requires between 1 and 100 field assignments');
 const mapped:Record<string,unknown>={};
 if(!dynamic){
  for(const item of assignments as Array<Record<string,unknown>>){
   const field=String(item.field??item.apiName??'');
   if(!validField.test(field))throw Error('Invalid Update Records field');
   const value=evaluate(item.value??null);
   if(!scalar(value))throw Error('Update Records values must be scalar');
   mapped[field]=value;
  }
 }
 for(const record of targets){
  if(typeof record.Id!=='string')throw Error('Invalid Update Records target');
  const values=dynamic?fieldsFromRecord(record,scalar):mapped;
  const lineMutation=objectApi==='QuotationLine'||objectApi==='InvoiceLine'
   ?await prepareDocumentLineMutation(context,lineTotalsConfig,record.Id,values):null;
  await enforceRecordOverlap(client,tenantId,objectApi,config.overlapGuard,{...values,Id:record.Id});
        await enforceRecordAvailability(client,tenantId,config.availabilityGuard,{...values,Id:record.Id});
  await enforceDocumentIssue(context,config.documentIssue,record.Id,values);
  await records.update(tenantId,userId,objectApi,record.Id,values,undefined,client,true);
  if(lineMutation){
   if(lineMutation.oldParent)await recalculateDocumentLineTotals(context,lineTotalsConfig,lineMutation.oldParent);
   if(lineMutation.newParent!==lineMutation.oldParent)await recalculateDocumentLineTotals(context,lineTotalsConfig,lineMutation.newParent);
  }
 }
 return {handled:true,clearHistory:true};
}
