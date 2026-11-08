import type {FlowNodeContext,FlowActionResult} from './NodeContext.js';
import {enforceRecordOverlap,enforceUniqueRecordInput} from './RecordOverlapGuard.js';
import {enforceRecordAvailability} from './RecordAvailabilityGuard.js';
import {enforceFlowBusinessCalendar} from '../../flow-engine/FlowBusinessCalendarGuard.js';
import type {SqlPersistence} from '../sql-persistence.js';
import {defaultDocumentLineTotalsConfig,enforceDocumentConversion,enforceDocumentSourceLink,prepareDocumentLineMutation,recalculateDocumentLineTotals} from './DocumentFinancialGuard.js';
import {enforceManualPaymentGuard,enforceCashLedgerReversal} from './RecordPaymentGuard.js';
async function enforceCashLedgerReversalIfConfigured(context:FlowNodeContext,guard:unknown,
 fields:Record<string,unknown>){
 if(guard!==null&&guard!==undefined)
  await enforceCashLedgerReversal(context,guard,fields);
}
export async function executeCreateRecordsNode(context:FlowNodeContext):Promise<FlowActionResult>{
 const {tenantId,userId,client,node,records,vars,evaluate,set,recordValues,scalar}=context;
 const config=node.config;
 const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;
    const objectApi=String(config.object??config.objectApi??'');
    if(!apiName.test(objectApi))throw new Error('Invalid Flow Object');
    const lineTotalsConfig=(objectApi==='QuotationLine'||objectApi==='InvoiceLine')
      ?config.documentLineTotals??defaultDocumentLineTotalsConfig(objectApi):null;
    if(config.recordSource==='collection'){
      const source=recordValues(vars[String(config.collection??'')]);
      const created:Record<string,unknown>[]=[];
      for(const item of source){
        const fields:Record<string,unknown>={};
        if(Object.keys(item).filter(field=>field!=='Id').length>100)
          throw new Error('Create Records collection items may contain at most 100 fields');
        for(const [field,value] of Object.entries(item)){
          if(field==='Id')continue;
          if(!apiName.test(field)||!scalar(value))
            throw new Error('Invalid Create Records collection field: '+field);
          fields[field]=value;
        }
        const lineMutation=objectApi==='QuotationLine'||objectApi==='InvoiceLine'
          ?await prepareDocumentLineMutation(context,lineTotalsConfig,undefined,fields):null;
      await enforceFlowBusinessCalendar(client as unknown as SqlPersistence,tenantId,config.businessCalendarGuard,fields);
      await enforceRecordOverlap(client,tenantId,objectApi,config.overlapGuard,fields);
      await enforceUniqueRecordInput(client,tenantId,objectApi,config.uniqueInputGuard,fields);
        await enforceRecordAvailability(client,tenantId,config.availabilityGuard,fields);
        await enforceDocumentConversion(context,config.documentConversion,fields);
      await enforceDocumentSourceLink(context,config.sourceLinkGuard,fields);
      await enforceManualPaymentGuard(context,config.manualPaymentGuard,fields);
      await enforceCashLedgerReversalIfConfigured(context,config.cashReversalGuard,fields);
      const id=await records.createInTransaction(client,tenantId,userId,objectApi,fields);
      if(lineMutation)await recalculateDocumentLineTotals(context,lineTotalsConfig,lineMutation.newParent);
      created.push({...fields,Id:id});
      }
      if(typeof config.resultVariable==='string'&&config.resultVariable)
        vars[config.resultVariable]=created;
    }else{
      const fields:Record<string,unknown>={};
      const assignments=Array.isArray(config.fieldValues)?config.fieldValues:[];
      if(assignments.length<1||assignments.length>100)
        throw new Error('Create Records requires between 1 and 100 field assignments');
      for(const item of assignments as Array<Record<string,unknown>>){
        const field=String(item.field??item.apiName??'');
        if(!apiName.test(field))throw new Error('Invalid Flow Field');
        const value=evaluate(item.value??null);
        if(!scalar(value))throw new Error('Create Records values must be scalar');
        fields[field]=value;
      }
      const lineMutation=objectApi==='QuotationLine'||objectApi==='InvoiceLine'
        ?await prepareDocumentLineMutation(context,config.documentLineTotals,undefined,fields):null;
      await enforceFlowBusinessCalendar(client as unknown as SqlPersistence,tenantId,config.businessCalendarGuard,fields);
      await enforceRecordOverlap(client,tenantId,objectApi,config.overlapGuard,fields);
      await enforceUniqueRecordInput(client,tenantId,objectApi,config.uniqueInputGuard,fields);
        await enforceRecordAvailability(client,tenantId,config.availabilityGuard,fields);
      await enforceDocumentConversion(context,config.documentConversion,fields);
      await enforceDocumentSourceLink(context,config.sourceLinkGuard,fields);
      await enforceManualPaymentGuard(context,config.manualPaymentGuard,fields);
      await enforceCashLedgerReversalIfConfigured(context,config.cashReversalGuard,fields);
      const id=await records.createInTransaction(client,tenantId,userId,objectApi,fields);
      if(lineMutation)await recalculateDocumentLineTotals(context,config.documentLineTotals,lineMutation.newParent);
      // Make the newly created record available to subsequent steps as {!record<stepId>.Id}.
      // The optional scalar resultVariable retains its existing Id-only contract.
      vars['record'+node.id]={...fields,Id:id};
      if(typeof config.resultVariable==='string'&&config.resultVariable)
        set(config.resultVariable,id);
    }
    return {handled:true,clearHistory:true};
}
