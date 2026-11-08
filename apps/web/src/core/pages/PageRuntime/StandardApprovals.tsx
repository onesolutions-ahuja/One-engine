import {useCallback,useEffect,useState} from 'react';
import type {ApprovalRequestMetadata} from '../../metadata/Definitions/metadata';
import {appRoutePath,type AppRoute} from '../../workspace/Navigation/appRouting';

/** Approval decisions use the existing central server approval engine, which
 * checks the logged-in approver and the ApprovalRequest permission. */
export default function StandardApprovals({
  request,appId,onNavigate
}:{
  request:<T>(path:string,init?:RequestInit)=>Promise<T>;
  appId:string;onNavigate:(route:AppRoute)=>void;
}) {
  const [items,setItems]=useState<ApprovalRequestMetadata[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [comments,setComments]=useState<Record<string,string>>({});
  const load=useCallback(async()=>{
    setError('');setLoading(true);
    try{
      const result=await request<{requests:ApprovalRequestMetadata[]}>('/approvals/inbox');
      setItems(result.requests??[]);
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Approvals are unavailable');
      setItems([]);
    }finally{setLoading(false);}
  },[request]);
  useEffect(()=>{void load();},[load]);
  const decide=async(id:string,decision:'Approved'|'Rejected')=>{
    setBusy(id);setError('');
    try{
      await request('/approvals/'+encodeURIComponent(id)+'/decision',{
        method:'POST',body:JSON.stringify({decision,comments:comments[id]??''})
      });
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Approval was not changed');}
    finally{setBusy('');}
  };
  return <section className="record-fields-card surface" aria-label="Items to Approve">
    <div className="record-fields-heading"><h2>Items to Approve</h2>
      <button type="button" className="btn" onClick={()=>void load()} disabled={loading}>Refresh</button>
    </div>
    {loading&&<p role="status">Loading approvals…</p>}
    {error&&<p role="alert">{error}</p>}
    {!loading&&!items.length&&!error&&<p>No pending approvals assigned to you.</p>}
    <ul className="record-approval-items">
      {items.map(item=><li key={item.id} className="record-fields-card">
        <strong>{item.recordName}</strong> <small>{item.objectLabel} · {item.flowApiName}</small>
        <p>Submitted by {item.submittedByName}</p>
        <a href={appRoutePath({kind:'record-detail',objectApiName:item.objectApiName,
          recordId:item.recordId,appId})} onClick={event=>{
            if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
            event.preventDefault();
            onNavigate({kind:'record-detail',objectApiName:item.objectApiName,
              recordId:item.recordId,appId});
          }}>Open record</a>
        <label className="form-label">Decision comment (optional)
          <textarea className="form-control" rows={2} maxLength={4000}
            value={comments[item.id]??''} disabled={busy===item.id}
            onChange={event=>setComments(current=>({...current,[item.id]:event.target.value}))}/>
        </label>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-brand" disabled={!!busy}
            onClick={()=>void decide(item.id,'Approved')}>Approve</button>
          <button type="button" className="btn" disabled={!!busy}
            onClick={()=>void decide(item.id,'Rejected')}>Reject</button>
        </div>
      </li>)}
    </ul>
  </section>;
}
