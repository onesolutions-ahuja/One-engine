import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import {generateMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';

type Process={
 apiName:string;label:string;statusField:string;values:string[];active:boolean;revision:number;
};
type Version={version:number;label:string;statusField:string;values:string[];active:boolean;createdAt:string};
const blank=():Process=>({apiName:'',label:'',statusField:'',values:[],active:true,revision:0});

/** A SQL-backed status process is explicitly copied to Record Type picklist
 * restrictions; generic RecordEngine remains the only enforcement path. */
export default function BusinessProcessesPanel({object,onApply}:{
 object:ObjectMetadata;
 onApply:(process:Process,recordTypeId:string)=>void;
}){
 const [processes,setProcesses]=useState<Process[]>([]);
 const [draft,setDraft]=useState<Process|null>(null);
 const [recordTypeId,setRecordTypeId]=useState('');
 const [historyFor,setHistoryFor]=useState('');
 const [history,setHistory]=useState<Version[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const base='/metadata/objects/'+encodeURIComponent(object.apiName)+'/business-processes';
 const reload=async()=>{const data=await apiRequest<{processes:Process[]}>(base);setProcesses(data.processes);};
 useEffect(()=>{let active=true;setProcesses([]);setDraft(null);setRecordTypeId('');setHistoryFor('');setHistory([]);
  apiRequest<{processes:Process[]}>(base).then(data=>{if(active)setProcesses(data.processes);})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load processes');});
  return()=>{active=false;};
 },[base]);
 const save=async()=>{
  if(!draft)return;
  setBusy(true);setError('');
  try{
   const data=await apiRequest<{saved:boolean;revision:number}>(base+'/'+encodeURIComponent(draft.apiName),
    {method:'PUT',body:JSON.stringify(draft)});
   if(!data.saved)throw Error('Business process was not saved');
   await reload();setDraft(null);
  }catch(e){setError(e instanceof Error?e.message:'Unable to save business process');}
  finally{setBusy(false);}
 };
 const remove=async(process:Process)=>{
  if(!window.confirm('Delete '+process.label+'? Assigned processes cannot be deleted.'))return;
  setBusy(true);setError('');
  try{await apiRequest(base+'/'+encodeURIComponent(process.apiName),{method:'DELETE'});await reload();}
  catch(e){setError(e instanceof Error?e.message:'Unable to delete business process');}
  finally{setBusy(false);}
 };
 const showHistory=async(process:Process)=>{
  if(historyFor===process.apiName){setHistoryFor('');setHistory([]);return;}
  setBusy(true);setError('');
  try{
   const data=await apiRequest<{history:Version[]}>(
    base+'/'+encodeURIComponent(process.apiName)+'/history');
   setHistory(data.history);setHistoryFor(process.apiName);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load history');}
  finally{setBusy(false);}
 };
 const restore=async(process:Process,version:number)=>{
  if(!window.confirm('Restore version '+version+' of '+process.label+
    '? This restores the process definition only. Record Type status values stay unchanged until explicitly applied and saved.'))return;
  setBusy(true);setError('');
  try{
   const result=await apiRequest<{restored:boolean;revision:number}>(
    base+'/'+encodeURIComponent(process.apiName)+'/restore',
    {method:'POST',body:JSON.stringify({version,expectedRevision:process.revision})});
   if(!result.restored)throw new Error('Business process was not restored');
   await reload();setHistoryFor('');setHistory([]);
  }catch(e){setError(e instanceof Error?e.message:'Unable to restore process');}
  finally{setBusy(false);}
 };
 const available=object.fields.filter(field=>field.dataType==='Picklist'&&Boolean(field.picklistValues?.length));
 const statusField=available.find(field=>field.apiName===draft?.statusField);
 const types=object.recordTypes??[];
 return <div className="metadata-card" aria-label="Business Process Presets">
  <div className="section-toolbar"><div><h3>Business Processes</h3>
   <p>Reusable named Picklist stage selections. Applying a process updates a Record Type draft;
    use Save above to publish the selected allowed values through the shared Record Engine.</p></div>
   {!draft&&<button type="button" className="btn" onClick={()=>setDraft(blank())}>New process</button>}
  </div>
  {error&&<p role="alert">{error}</p>}
  {!draft&&processes.map(process=><div key={process.apiName} className="metadata-row">
   <div><strong>{process.label}</strong><small>{process.statusField} · {process.values.join(', ')}
    {' '}· revision {process.revision}</small></div>
   <div className="toolbar-actions">
    <button type="button" className="btn" disabled={busy}
     onClick={()=>setDraft({...process,values:[...process.values]})}>Edit</button>
    <button type="button" className="btn" disabled={busy}
     onClick={()=>void showHistory(process)}>{historyFor===process.apiName?'Hide history':'History'}</button>
    <button type="button" className="btn" disabled={busy} onClick={()=>void remove(process)}>Delete</button>
   </div>
   {historyFor===process.apiName&&<div className="metadata-card" aria-label="Business process version history">
    <p className="permission-help">Historic process versions do not overwrite published Record Type restrictions.</p>
    {history.map(item=><div className="metadata-row" key={item.version}>
     <div><strong>Revision {item.version}</strong>
      <small> {item.label} · {item.statusField} · {item.values.join(', ')}
       {' '}· {new Date(item.createdAt).toLocaleString()}</small></div>
     <button className="btn" type="button" disabled={busy||item.version===process.revision}
      onClick={()=>void restore(process,item.version)}>Restore process</button>
    </div>)}
    {!history.length&&<p>No previous versions.</p>}
   </div>}
   {process.active&&<div className="settings-grid">
    <label className="form-label">Apply to Record Type
     <select className="form-control" value={recordTypeId} onChange={e=>setRecordTypeId(e.target.value)}>
      <option value="">Select record type</option>{types.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
     </select></label>
    <button type="button" className="btn" disabled={!recordTypeId}
     onClick={()=>{onApply(process,recordTypeId);setRecordTypeId('');}}>
     Apply to Record Type Draft</button>
   </div>}
  </div>)}
  {!draft&&!processes.length&&<p>No business processes defined for this object.</p>}
  {draft&&<div className="metadata-card">
   <label className="form-label">Label<input className="form-control" value={draft.label}
    onChange={e=>setDraft({...draft,label:e.target.value,
      apiName:draft.revision>0?draft.apiName:generateMetadataApiName(e.target.value)})}/></label>
   <label className="form-label">API Name<input className="form-control" value={draft.apiName}
    disabled={draft.revision>0} onChange={e=>setDraft({...draft,apiName:e.target.value})}/></label>
   <label className="form-label">Status field<select className="form-control" value={draft.statusField}
    onChange={e=>setDraft({...draft,statusField:e.target.value,values:[]})}>
    <option value="">Choose Picklist field</option>
    {available.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
   </select></label>
   {statusField&&<div className="permission-check-grid">
    {(statusField.picklistValues??[]).map(value=><label className="checkbox-row" key={value}>
     <input type="checkbox" checked={draft.values.includes(value)}
      onChange={e=>setDraft({...draft,values:e.target.checked
       ?[...draft.values,value]:draft.values.filter(x=>x!==value)})}/>
     {value}</label>)}
   </div>}
   <label className="checkbox-row"><input type="checkbox" checked={draft.active}
    onChange={e=>setDraft({...draft,active:e.target.checked})}/>Active</label>
   <div className="toolbar-actions">
    <button type="button" className="btn" onClick={()=>setDraft(null)}>Cancel</button>
    <button type="button" className="btn btn-brand" disabled={busy||!draft.apiName||!draft.label.trim()
     ||!draft.statusField||!draft.values.length} onClick={()=>void save()}>
     {busy?'Saving…':'Save process'}</button>
   </div>
  </div>}
 </div>;
}
