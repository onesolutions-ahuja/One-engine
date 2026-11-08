import {useEffect,useState} from 'react';
import {formatRecordValue} from './recordCsvUtils';

/** Bounded, read-only cross-object field adapter. The parent resolves one
 * metadata-declared lookup and checks both field grants before passing props.
 * The Record API performs tenant, object and record authorization.
 */
export default function CrossObjectRecordField({objectApi,recordId,fieldApi,label,request}:{
 objectApi:string;recordId:string;fieldApi:string;label:string;
 request:<T>(path:string,init?:RequestInit)=>Promise<T>;
}){
 const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
 const [value,setValue]=useState<unknown>(undefined);
 useEffect(()=>{
  if(!objectApi||!recordId||!fieldApi){setStatus('unavailable');return;}
  let active=true;setStatus('loading');setValue(undefined);
  void request<{record:Record<string,unknown>}>(
    '/records/'+encodeURIComponent(objectApi)+'/'+encodeURIComponent(recordId))
    .then(result=>{
      if(!active)return;
      if(!result.record||!Object.prototype.hasOwnProperty.call(result.record,fieldApi)){
        setStatus('unavailable');return;
      }
      setValue(result.record[fieldApi]);setStatus('ready');
    }).catch(()=>{if(active)setStatus('unavailable');});
  return()=>{active=false;};
 },[objectApi,recordId,fieldApi,request]);
 return <section className="record-fields-card surface record-single-field">
  <div className="record-fields-heading"><h2>{label}</h2></div>
  {status==='loading'?<p role="status">Loading related field…</p>
   :status==='unavailable'?<p role="status">Related field is unavailable.</p>
   :<dl className="record-fields-grid columns-1"><div className="record-field">
     <dt>{label}</dt><dd>{formatRecordValue(value)}</dd></div></dl>}
 </section>;
}
