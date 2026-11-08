import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';

type Revision={revision:number;at:string;action:string};
type Snapshot={apiName:string;pageLayouts?:Array<{id:string;label:string}>;pageLayoutAssignments?:unknown[]};

/** Lazy, SQL-backed Object history. Restores legacy layouts, never published Pages
 * or business records, through the same optimistic Object edit engine. */
export default function ObjectChangeHistory({object,onRestored,onNotify}:{
 object:ObjectMetadata;onRestored:()=>Promise<void>;onNotify:(message:string)=>void
}){
 const [history,setHistory]=useState<Revision[]>([]);
 const [selected,setSelected]=useState<{revision:number;after:Snapshot}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const endpoint='/metadata/objects/'+encodeURIComponent(object.apiName)+'/history';
 useEffect(()=>{let active=true;setSelected(null);setError('');
  void apiRequest<{history:Revision[]}>(endpoint).then(result=>{
   if(active)setHistory(result.history);
  }).catch(err=>{if(active)setError(err instanceof Error?err.message:'Could not load history')});
  return()=>{active=false};
 },[endpoint,object.revision]);
 const inspect=async(revision:number)=>{
  setBusy(true);setError('');
  try{
   const result=await apiRequest<{change:{after:Snapshot}}>(endpoint+'/'+revision);
   setSelected({revision,after:result.change.after});
  }catch(err){setError(err instanceof Error?err.message:'Could not load revision')}
  finally{setBusy(false)}
 };
 const restore=async()=>{
  if(!selected)return;
  if(typeof object.revision!=='number'||!Number.isSafeInteger(object.revision)){
   setError('The current Object revision must be loaded before restoring');return;
  }
  if(!window.confirm('Restore the legacy layouts from revision '+selected.revision+
   '? This creates a new revision. Published Record Pages, fields and Record Types stay unchanged.'))return;
  setBusy(true);setError('');
  try{
   await apiRequest(endpoint+'/'+selected.revision+'/restore-layouts',{
    method:'POST',headers:{'If-Match':'"'+object.revision+'"'}
   });
   await onRestored();
   setSelected(null);
   onNotify('Legacy layouts restored as a new SQL metadata revision');
  }catch(err){setError(err instanceof Error?err.message:'Layout restore failed')}
  finally{setBusy(false)}
 };
 return <section className="surface object-setting-surface">
  <div className="section-toolbar"><div><h2>Object Change History</h2>
   <p>Review saved SQL revisions and safely restore legacy page layouts. Published Record Pages,
    Record Types, fields and settings are not rolled back.</p></div></div>
  {error&&<p role="alert">{error}</p>}
  {!history.length&&<p>No Object layout revisions have been saved.</p>}
  {!!history.length&&<div className="table-scroll"><table className="slds-table">
   <thead><tr><th>Revision</th><th>Saved</th><th>Action</th><th>Review</th></tr></thead>
   <tbody>{history.map(entry=><tr key={entry.revision}>
    <td>{entry.revision}</td><td>{new Date(entry.at).toLocaleString()}</td>
    <td>{entry.action}</td>
    <td><button className="btn" type="button" disabled={busy}
      onClick={()=>void inspect(entry.revision)}>View</button></td>
   </tr>)}</tbody></table></div>}
  {selected&&<div className="metadata-card">
   <h3>Revision {selected.revision}</h3>
   <p>Legacy layouts: {selected.after.pageLayouts?.map(layout=>layout.label).join(', ')||'Not available'}</p>
   <p>Restore creates a new version and preserves current fields, Record Types, business data and published Pages.</p>
   <button className="btn btn-brand" type="button" disabled={busy
     ||!selected.after.pageLayouts?.length||typeof object.revision!=='number'
     ||selected.revision>=(object.revision??0)}
    onClick={()=>void restore()}>Restore legacy layouts</button>
  </div>}
 </section>;
}
