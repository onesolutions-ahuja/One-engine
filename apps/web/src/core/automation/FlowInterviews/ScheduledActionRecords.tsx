import {useCallback,useEffect,useState} from 'react';

type ActionRow={
 id:string;scheduled_by:string;origin_session_id:string|null;status:string;
 execute_at:string;next_step:number;created_at:string;finished_at:string|null;error_code:string|null
};
type HistoryRow={
 step_number:number|null;action_name:string|null;event_type:string;
 actor_user_id:string|null;detail_code:string|null;occurred_at:string
};
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

/** Read-only execution history with explicit cancellation/completion of pending work. */
export default function ScheduledActionRecords({request}:{request:Request}){
 const [records,setRecords]=useState<ActionRow[]>([]);
 const [history,setHistory]=useState<HistoryRow[]>([]);
 const [selected,setSelected]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState('');
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const response=await request<{records:ActionRow[]}>('/scheduled-actions');
   setRecords(response.records);
  }catch(reason){setError(reason instanceof Error?reason.message:'Unable to load ScheduledAction records');}
  finally{setLoading(false);}
 },[request]);
 useEffect(()=>{void refresh()},[refresh]);
 const showHistory=async(id:string)=>{
  if(selected===id){setSelected('');setHistory([]);return;}
  setBusy(id);setError('');
  try{
   const response=await request<{history:HistoryRow[]}>('/scheduled-actions/'+encodeURIComponent(id)+'/history');
   setHistory(response.history);setSelected(id);
  }catch(reason){setError(reason instanceof Error?reason.message:'Unable to load ScheduledAction history');}
  finally{setBusy('');}
 };
 const close=async(id:string,decision:'cancel'|'complete')=>{
  const reason=decision==='cancel'?'Cancel this pending action sequence?':'Mark this sequence complete without executing the remaining actions?';
  if(!window.confirm(reason))return;
  setBusy(id);setError('');
  try{
   await request('/scheduled-actions/'+encodeURIComponent(id)+'/'+decision,{method:'POST'});
   await refresh();
   if(selected===id)await showHistory(id);
  }catch(error){setError(error instanceof Error?error.message:'Unable to update ScheduledAction');}
  finally{setBusy('');}
 };
 return <section className="setup-card" aria-label="ScheduledAction records">
  <div className="page-heading">
   <div><h2>Scheduled Actions</h2>
    <p>Action Formula WAIT jobs continue on the server after logout. Completed and cancelled jobs remain in history.</p></div>
   <button type="button" className="btn btn-small" onClick={()=>void refresh()} disabled={loading||!!busy}>Refresh</button>
  </div>
  {error&&<p role="alert">{error}</p>}
  {loading?<p>Loading scheduled actions…</p>:records.length===0?<p>No scheduled actions recorded.</p>:
   <div className="records-table-wrap" role="region" aria-label="Scheduled Action job records" tabIndex={0}>
    <table className="records-table"><thead><tr>
     <th scope="col">Created</th><th scope="col">Execute at</th><th scope="col">Status</th>
     <th scope="col">Scheduled by</th><th scope="col">Next step</th><th scope="col">Controls</th>
    </tr></thead><tbody>{records.map(row=><tr key={row.id}>
     <td>{new Date(row.created_at).toLocaleString()}</td>
     <td>{new Date(row.execute_at).toLocaleString()}</td>
     <td>{row.status}{row.error_code?' · '+row.error_code:''}</td>
     <td title={row.scheduled_by}>{row.scheduled_by.slice(0,8)}…</td>
     <td>{row.next_step+1}</td>
     <td><div className="toolbar-actions">
      <button type="button" className="btn btn-small" onClick={()=>void showHistory(row.id)}
       disabled={busy===row.id} aria-expanded={selected===row.id}>History</button>
      {row.status==='Pending'&&<>
       <button type="button" className="btn btn-small" disabled={!!busy}
        onClick={()=>void close(row.id,'cancel')}>Cancel</button>
       <button type="button" className="btn btn-small" disabled={!!busy}
        onClick={()=>void close(row.id,'complete')}>Mark complete</button>
      </>}
     </div></td>
    </tr>)}</tbody></table>
   </div>}
  {selected&&<section className="setup-card" aria-label="ScheduledAction execution history">
   <h3>Execution history</h3>
   {history.length===0?<p>No history entries.</p>:<ol>{history.map((event,index)=><li key={index}>
    {new Date(event.occurred_at).toLocaleString()} — {event.event_type}
    {event.action_name?' · '+event.action_name:''}
    {event.detail_code?' · '+event.detail_code:''}
   </li>)}</ol>}
  </section>}
 </section>;
}
