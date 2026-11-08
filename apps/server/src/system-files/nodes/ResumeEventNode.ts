import type {FlowRuntime} from '../flow-runtime.js';
/** Durable resume adapter. Jobs are authorised and replay-guarded before resumption. */
export async function executeResumeEventNode(input:{
  attempt:number;tenantId:string;userId:string;runId:string;version:number;
  authorize:()=>Promise<boolean>;flows:FlowRuntime;
}):Promise<void>{
  const {attempt,tenantId,userId,runId,version,authorize,flows}=input;
  if(attempt>1)throw new Error('Flow replay requires explicit reconciliation');
  if(!await authorize())throw new Error('Job authorization changed');
  await flows.resumeWaitingInterview(tenantId,userId,runId,version);
}
