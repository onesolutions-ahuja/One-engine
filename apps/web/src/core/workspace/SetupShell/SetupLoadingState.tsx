import {useEffect,useState} from 'react';
import './SetupLoadingState.css';

/** Readable loading state for slow SQL-backed setup metadata.
 * A timeout exposes Retry without ever treating incomplete data as an empty tenant. */
export default function SetupLoadingState({label}:{label:string}) {
 const [slow,setSlow]=useState(false);
 useEffect(()=>{setSlow(false);const timer=window.setTimeout(()=>setSlow(true),10000);return()=>window.clearTimeout(timer)},[label]);
 return <section className="setup-card md-setup-loading-state" role="status" aria-live="polite">
  <h2>Loading {label}…</h2>
  <p>{slow?'This is taking longer than expected. Your data has not been changed.':'Loading the latest authorised information.'}</p>
  {label.startsWith('Page Builder') ? <div className="md-page-list-loading" aria-hidden="true">
    <div className="md-page-list-loading-toolbar"><span/><span/><span/></div>
    <div className="md-page-list-loading-head"><span/><span/><span/></div>
    {Array.from({length:6},(_,index)=><div className="md-page-list-loading-row" key={index}><span/><span/><span/></div>)}
  </div> : <div className="md-setup-loading-skeleton" aria-hidden="true">
    <span/><span/><span/><span/>
  </div>}
  {slow&&<button type="button" className="btn" onClick={()=>window.location.reload()}>Retry loading {label}</button>}
 </section>;
}
