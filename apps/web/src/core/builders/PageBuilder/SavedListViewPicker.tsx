import {useEffect,useState} from 'react';
type SavedView={id:string;label:string};
export default function SavedListViewPicker({objectApi,savedViewId,request,onChange}:{
 objectApi:string;savedViewId:string;
 request:<T>(path:string,init?:RequestInit)=>Promise<T>;
 onChange:(id:string)=>void;
}){
 const [views,setViews]=useState<SavedView[]>([]);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
   if(!objectApi){setViews([]);setError('');return;}
   let active=true;setLoading(true);setError('');setViews([]);
   void request<{views:SavedView[]}>('/records/'+encodeURIComponent(objectApi)+'/list-views')
     .then(result=>{if(active)setViews(Array.isArray(result.views)?result.views:[]);})
     .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Unable to load saved views');})
     .finally(()=>{if(active)setLoading(false);});
   return()=>{active=false;};
 },[objectApi,request]);
 return <label className="form-label">Saved List View
   <select className="form-control" aria-label="Saved List View" value={savedViewId}
     disabled={!objectApi||loading||Boolean(error)}
     onChange={event=>onChange(event.target.value)}>
     <option value="">All authorised records (no saved view)</option>
     {savedViewId&&!views.some(view=>view.id===savedViewId)&&
       <option value={savedViewId} disabled>Saved view unavailable</option>}
     {views.map(view=><option key={view.id} value={view.id}>{view.label}</option>)}
   </select>
   {loading&&<small role="status">Loading authorised saved views…</small>}
   {error&&<small role="alert">{error}</small>}
 </label>;
}
