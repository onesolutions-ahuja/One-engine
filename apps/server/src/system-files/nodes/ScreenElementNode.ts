import type {PoolClient} from 'pg';
import {persistFlowInterviewPause} from '../flow-interview-persistence.js';
import {screenRecordPayload} from '../flow-screen-record-selection.js';
import {hydrateFlowScreenChoices} from '../flow-screen-choice-runtime.js';
/** Pause a Screen Flow and return its server-validated screen presentation. */
export async function executeScreenElementNode<T>(input:{
 client:PoolClient;tenantId:string;runId:string;current:number;history:number[];
 steps:number;loopIndexes:Map<number,number>;vars:Record<string,unknown>;
 node:{id:number;type:string;label:string;config:Record<string,unknown>};
 resources:Array<{name:string;type:string;dataType:string;value?:unknown}>;
 persistenceResources:Array<{name:string;type:string;dataType:string;value?:unknown}>;
 flowType:string;outcomes:T;
}){
 const {client,tenantId,runId,current,history,steps,loopIndexes,vars,node,resources,persistenceResources,flowType,outcomes}=input;
 if(flowType==='Record-Triggered Flow')throw new Error('Record-Triggered Flows cannot pause at a Screen');
 await persistFlowInterviewPause(client,tenantId,runId,current,history,steps+1,loopIndexes,vars,persistenceResources);
 const screenPayload=screenRecordPayload(node,vars,persistenceResources);
 return {interviewId:runId,screen:hydrateFlowScreenChoices(node,resources),outcomes,canGoBack:history.length>0,...screenPayload};
}
