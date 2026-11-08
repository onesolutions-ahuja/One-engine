import type {FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';

export type RecordTriggerSummary={
 apiName:string;label:string;status:'Active'|'Draft';
 phase:'Before save'|'After save'|'After delete';
 operation:string;order:number;scheduledPathCount:number;runAfterFlows:string[];
};

/** Read authoritative saved Start node metadata; the shared Flow Engine executes it. */
export function describeRecordTrigger(flow:FlowDefinitionMetadata):RecordTriggerSummary{
 if(flow.flowType!=='Record-Triggered Flow')throw new Error('Not a record-triggered Flow');
 const start=flow.elements.find(item=>item.type==='Start');
 if(!start||!start.config||typeof start.config!=='object')
  throw new Error('Record-Triggered Flow has no saved Start configuration');
 const config=start.config as Record<string,unknown>;
 const rawOrder=config.triggerOrder??1000;
 const order=Number(rawOrder);
 if(!Number.isSafeInteger(order)||order<1||order>2000)
  throw new Error('Invalid saved Flow trigger order');
 const runAfterFlows=config.runAfterFlows===undefined?[]
  :Array.isArray(config.runAfterFlows)&&config.runAfterFlows.length<=20
    &&config.runAfterFlows.every(name=>typeof name==='string'
      &&/^[A-Za-z][A-Za-z0-9_]*$/.test(name)&&name!==flow.apiName)
    &&new Set(config.runAfterFlows).size===config.runAfterFlows.length
      ?config.runAfterFlows as string[]:(()=>{throw Error('Invalid run-after Flow dependencies')})();
 const trigger=typeof config.trigger==='string'?config.trigger:'created-or-updated';
 if(!['created','updated','created-or-updated','deleted'].includes(trigger))
  throw new Error('Unsupported record trigger');
 const runWhen=config.runWhen??'after-save';
 if(runWhen!=='before-save'&&runWhen!=='after-save')
  throw new Error('Unsupported record trigger phase');
 if(trigger==='deleted'&&runWhen==='before-save')
  throw new Error('Before-delete Flow execution is not supported');
 const phase=trigger==='deleted'?'After delete'
  :runWhen==='before-save'?'Before save':'After save';
 const operation=trigger==='created'?'Created':trigger==='updated'?'Updated'
  :trigger==='deleted'?'Deleted':'Created or updated';
 return {
  apiName:flow.apiName,label:flow.label,status:flow.status,phase,operation,order,runAfterFlows,
  scheduledPathCount:flow.connectors.filter(item=>item.kind==='scheduled'
   &&item.scheduledPath!==undefined).length
 };
}

export function orderRecordTriggers(items:RecordTriggerSummary[]):RecordTriggerSummary[]{
 const phase=(value:RecordTriggerSummary['phase'])=>value==='Before save'?0
  :value==='After save'?1:2;
 return [...items].sort((a,b)=>phase(a.phase)-phase(b.phase)||a.order-b.order
  ||a.apiName.localeCompare(b.apiName));
}
