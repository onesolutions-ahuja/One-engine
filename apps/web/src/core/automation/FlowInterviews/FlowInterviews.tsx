import ResponsiveDataList from '../../records/ResponsiveDataList/ResponsiveDataList';
import { RefreshCw, XCircle } from 'lucide-react';
import {useEffect,useState} from 'react';
import type { FlowInterviewMetadata } from '../../metadata/Definitions/metadata';

type FailedFlowJob={
 id:string;jobType:string;resourceId:string|null;versionNumber:number|null;
 attempts:number;maxAttempts:number;error:string|null;updatedAt:string
};
type FlowInterviewsProps = {
  interviews: FlowInterviewMetadata[];
  loading: boolean;
  canManage: boolean;
  onRefresh: () => void;
  onCancel: (interview: FlowInterviewMetadata) => void;
  onOpenFlow: (apiName: string) => void;
  request: <T>(path:string,init?:RequestInit)=>Promise<T>;
};

function interviewState(interview: FlowInterviewMetadata): string {
  if (interview.kind === 'screen') return `Paused on ${interview.screenLabel ?? 'Screen'}`;
  if (interview.kind === 'scheduled') return 'Scheduled path';
  if (interview.kind === 'async') return interview.retryAt ? 'Async path retry' : 'Queued async path';
  if (interview.kind === 'orchestration') return `Awaiting approval · ${interview.screenLabel ?? 'Orchestration Stage'}`;
  return interview.retryAt ? 'Waiting to retry' : 'Waiting';
}

export default function FlowInterviews({
  interviews, loading, canManage, onRefresh, onCancel, onOpenFlow, request
}: FlowInterviewsProps) {
  const [failedJobs,setFailedJobs]=useState<FailedFlowJob[]>([]);
  const [failedLoading,setFailedLoading]=useState(false);
  const [failedError,setFailedError]=useState('');
  const [busyJob,setBusyJob]=useState('');
  const refreshFailed=async()=>{
    if(!canManage)return;
    setFailedLoading(true);setFailedError('');
    try{
      const payload=await request<{jobs:Array<{
        id:string;job_type:string;resource_id:string|null;resource_version:number|null;
        attempt:number;max_attempts:number;error_code:string|null;updated_at:string
      }>}>('/job-admin/jobs?status=failed');
      setFailedJobs(payload.jobs.filter(job=>job.job_type.startsWith('flow.')).map(job=>({
        id:job.id,jobType:job.job_type,resourceId:job.resource_id,
        versionNumber:job.resource_version,attempts:job.attempt,
        maxAttempts:job.max_attempts,error:job.error_code,updatedAt:job.updated_at
      })));
    }catch(error){setFailedError(error instanceof Error?error.message:'Unable to load failed Flow jobs');}
    finally{setFailedLoading(false);}
  };
  useEffect(()=>{void refreshFailed();},[canManage]);
  const reconcile=async(job:FailedFlowJob,decision:'retry'|'acknowledge')=>{
    if(!canManage||busyJob)return;
    const risk=decision==='retry'
      ?'A previous attempt may have already performed external actions. Investigate the error and provider state before explicitly retrying this Flow job. Retry?'
      :'Acknowledge this failed Flow job and permanently stop automated replay?';
    if(!window.confirm(risk))return;
    setBusyJob(job.id);
    try{
      await request('/job-admin/jobs/'+encodeURIComponent(job.id)+'/reconcile',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({decision,...(decision==='retry'?{acknowledgedReplayRisk:true}:{})})
      });
      await refreshFailed();
    }catch(error){setFailedError(error instanceof Error?error.message:'Unable to reconcile Flow job');}
    finally{setBusyJob('');}
  };
  return (
    <div className="workspace">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SETUP / AUTOMATION</div>
          <h1>Paused and Waiting Interviews</h1>
          <p>Inspect active Screen Flow interviews, waits, scheduled paths, asynchronous paths and human-approval orchestration stages. Cancel an interview to prevent it from resuming.</p>
        </div>
        <button className="btn" type="button" onClick={()=>{
          onRefresh();void refreshFailed();
        }} disabled={loading||failedLoading}>
          <RefreshCw size={14} />Refresh
        </button>
      </div>
      {!canManage && <div className="info-callout">You need metadata write or Flow management permission to cancel interviews.</div>}
      <section className="surface">
        <div className="list-view-header">
          <div>
            <div className="list-view-label">ACTIVE INTERVIEWS</div>
            <h2>Pending Work</h2>
            <span>{loading ? 'Loading interviews…' : `${interviews.length} pending ${interviews.length === 1 ? 'interview' : 'interviews'}`}</span>
          </div>
        </div>
        {interviews.length>0&&<ResponsiveDataList rows={interviews} getId={item=>item.id}
          label="Pending Flow interviews" onOpen={item=>onOpenFlow(item.flowApiName)} openLabel="Open Flow"
          columns={[
            {apiName:'flow',label:'Flow',phoneRole:'title',render:item=>item.flowLabel},
            {apiName:'version',label:'Version',render:item=>'Version '+item.versionNumber},
            {apiName:'state',label:'State',phoneRole:'badge',render:item=>interviewState(item)},
            {apiName:'user',label:'User',phoneRole:'subtitle',render:item=>item.userName},
            {apiName:'date',label:'Created',phoneRole:'trailing',render:item=>new Date(item.createdAt).toLocaleString()},
            {apiName:'record',label:'Record',render:item=>item.recordId??'—'},
            {apiName:'attempts',label:'Attempts',render:item=>item.attempts},
            {apiName:'action',label:'Action',render:item=><button type="button" className="btn btn-danger"
              disabled={!canManage} onClick={()=>onCancel(item)}>Cancel</button>}
          ]}/>}
        {loading ? <div className="records-loading">Loading Flow interviews…</div>
          : interviews.length === 0 ? <div className="records-empty">There are no paused or waiting Flow interviews.</div>
            : <div className="records-table-wrap md-mobile-table-replaced" role="region" aria-label="Paused and waiting Flow interviews" tabIndex={0}><table className="records-table">
                <thead><tr><th scope="col">Flow</th><th scope="col">Version</th><th scope="col">State</th><th scope="col">Running User</th><th scope="col">Record</th><th scope="col">Created</th><th scope="col">Resume / Expiry</th><th scope="col">Attempts</th><th scope="col">Actions</th></tr></thead>
                <tbody>{interviews.map((interview) => <tr key={interview.id}>
                  <td><button className="text-action" type="button" onClick={() => onOpenFlow(interview.flowApiName)}>{interview.flowLabel}</button></td><td>Version {interview.versionNumber}</td>
                  <td>{interviewState(interview)}</td>
                  <td>{interview.userName}</td>
                  <td>{interview.recordId ?? '—'}</td>
                  <td>{new Date(interview.createdAt).toLocaleString()}</td>
                  <td>{interview.retryAt ? `Retry ${new Date(interview.retryAt).toLocaleString()}`
                    : interview.waitUntil ? new Date(interview.waitUntil).toLocaleString()
                      : new Date(interview.expiresAt).toLocaleString()}</td>
                  <td>{interview.attempts}</td>
                  <td><button className="btn btn-danger" type="button" disabled={!canManage} onClick={() => onCancel(interview)}>
                    <XCircle size={14} />Cancel
                  </button></td>
                </tr>)}</tbody>
              </table></div>}
      </section>
      {canManage&&<section className="surface" aria-label="Failed durable Flow jobs">
        <div className="list-view-header">
          <div><h2>Failed durable Flow jobs</h2>
            <p>Tenant administrators can review failed or outcome-ambiguous jobs. Replays require explicit operator approval and are audited.</p>
          </div>
        </div>
        {failedError&&<div className="info-callout" role="alert">{failedError}</div>}
        {failedJobs.length>0&&<ResponsiveDataList rows={failedJobs} getId={job=>job.id}
          label="Failed durable Flow jobs"
          columns={[
            {apiName:'jobType',label:'Job type',phoneRole:'title',render:job=>job.jobType},
            {apiName:'error',label:'Error',phoneRole:'badge',render:job=>job.error??'Unknown failure'},
            {apiName:'resource',label:'Resource',phoneRole:'subtitle',render:job=>job.resourceId??'—'},
            {apiName:'updated',label:'Updated',phoneRole:'trailing',render:job=>new Date(job.updatedAt).toLocaleString()},
            {apiName:'attempts',label:'Attempts',render:job=>job.attempts+' / '+job.maxAttempts},
            {apiName:'recovery',label:'Recovery',render:job=><div className="toolbar-actions">
              <button type="button" className="btn btn-small" disabled={Boolean(busyJob)}
                onClick={()=>void reconcile(job,'retry')}>Approve retry</button>
              <button type="button" className="btn btn-small" disabled={Boolean(busyJob)}
                onClick={()=>void reconcile(job,'acknowledge')}>Acknowledge failure</button>
            </div>}
          ]}/>}
        {failedLoading?<p>Loading failed work…</p>
          :failedJobs.length===0?<p>No failed Flow jobs are awaiting reconciliation.</p>
          :<div className="records-table-wrap md-mobile-table-replaced" role="region" aria-label="Failed durable Flow jobs" tabIndex={0}><table className="records-table">
            <thead><tr><th scope="col">Job type</th><th scope="col">Resource</th><th scope="col">Error</th><th scope="col">Attempts</th><th scope="col">Updated</th><th scope="col">Recovery</th></tr></thead>
            <tbody>{failedJobs.map(job=><tr key={job.id}>
              <td>{job.jobType}</td>
              <td>{job.resourceId??'—'}{job.versionNumber?' · v'+job.versionNumber:''}</td>
              <td>{job.error??'Unknown failure'}</td>
              <td>{job.attempts} / {job.maxAttempts}</td>
              <td>{new Date(job.updatedAt).toLocaleString()}</td>
              <td><div className="toolbar-actions">
                <button type="button" className="btn btn-small" disabled={Boolean(busyJob)}
                  onClick={()=>void reconcile(job,'retry')}>Approve retry</button>
                <button type="button" className="btn btn-small" disabled={Boolean(busyJob)}
                  onClick={()=>void reconcile(job,'acknowledge')}>Acknowledge failure</button>
              </div></td>
            </tr>)}</tbody>
          </table></div>}
      </section>}
    </div>
  );
}
