import {useEffect,useState} from 'react';
import type * as React from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
type IndexedField={fieldApi:string;label:string;enabled:boolean;revision:number};

/** Optional exact equality indexes use one tenant-scoped SQL projection, not
 * per-tenant physical index DDL. This editor is builder-only and lazy-loaded. */
export default function FieldExactIndexesPanel({objectApi}: {objectApi:string}){
 const [fields,setFields]=useState<IndexedField[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState('');
 const [error,setError]=useState('');
 const url='/metadata/objects/'+encodeURIComponent(objectApi)+'/field-indexes';
 useEffect(()=>{
  let active=true;setLoading(true);setFields([]);setBusy('');setError('');
  void apiRequest<{indexes:IndexedField[]}>(url).then(data=>{
   if(active)setFields(data.indexes);
  }).catch(err=>{if(active)setError(err instanceof Error?err.message:'Unable to load indexes')})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[url]);
 const toggle=async(item:IndexedField)=>{
  setBusy(item.fieldApi);setError('');
  try{
   const result=await apiRequest<{enabled:boolean;revision:number}>(
    url+'/'+encodeURIComponent(item.fieldApi),{method:'PUT',
     body:JSON.stringify({enabled:!item.enabled,revision:item.revision})});
   setFields(previous=>previous.map(field=>field.fieldApi===item.fieldApi
    ?{...field,enabled:result.enabled,revision:result.revision}:field));
  }catch(err){setError(err instanceof Error?err.message:'Unable to save field index')}
  finally{setBusy('')}
 };
 const setAll=async(enabled:boolean)=>{
  const todo=fields.filter(field=>field.enabled!==enabled);
  if(!todo.length)return;
  if(enabled&&!window.confirm('Turn on fast lookup for '+todo.length+' field(s)? Each record save then does a little extra work for those fields.'))return;
  setBusy('*');setError('');
  try{
   for(const item of todo){
    const result=await apiRequest<{enabled:boolean;revision:number}>(
     url+'/'+encodeURIComponent(item.fieldApi),{method:'PUT',
      body:JSON.stringify({enabled,revision:item.revision})});
    setFields(previous=>previous.map(field=>field.fieldApi===item.fieldApi
     ?{...field,enabled:result.enabled,revision:result.revision}:field));
   }
  }catch(err){setError(err instanceof Error?err.message:'Unable to save field index')}
  finally{setBusy('')}
 };
 const row:React.CSSProperties={display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'10px 0',borderBottom:'1px solid #e5e9f0'};
 return <div className="metadata-card">
  <h3>Fast Lookup (Exact-Match Indexes)</h3>
  <p>Switch on a field to make searches that match its exact value much faster, for example
   finding a Cart by its Session Key. Turn it on for fields your pages or formulas use to
   look records up. Permissions are still enforced. Turning it off removes the index.</p>
  {loading&&<p>Loading field indexing preferences…</p>}
  {error&&<p role="alert">{error}</p>}
  {!loading&&fields.length===0&&<p>No eligible readable Text, Email, Phone, URL or Picklist fields.</p>}
  {fields.length>0&&<div style={{display:'flex',gap:8,margin:'4px 0 8px'}}>
   <button type="button" className="btn btn-small" disabled={!!busy} onClick={()=>void setAll(true)}>Turn all on</button>
   <button type="button" className="btn btn-small" disabled={!!busy} onClick={()=>void setAll(false)}>Turn all off</button>
   {busy==='*'&&<span style={{fontSize:13}}>Updating…</span>}
  </div>}
  <div>
  {fields.map(field=><div style={row} key={field.fieldApi}>
    <span><strong>{field.label}</strong> <small style={{opacity:.7}}>({field.fieldApi})</small></span>
    <span style={{display:'inline-flex',alignItems:'center',gap:10}}>
     <span style={{minWidth:70,textAlign:'right',fontSize:13}}>{busy===field.fieldApi?'Updating…':field.enabled?'On':'Off'}</span>
     <button type="button" role="switch" aria-checked={field.enabled}
      aria-label={'Fast lookup for '+field.label} disabled={!!busy} onClick={()=>void toggle(field)}
      style={{position:'relative',width:44,height:24,borderRadius:12,border:'none',padding:0,
       cursor:busy?'wait':'pointer',background:field.enabled?'#0b57d0':'#b8c2d0',transition:'background .15s'}}>
      <span aria-hidden="true" style={{position:'absolute',top:2,left:field.enabled?22:2,width:20,height:20,
       borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px #0003',transition:'left .15s'}}/>
     </button>
    </span>
  </div>)}
  </div>
 </div>;
}
