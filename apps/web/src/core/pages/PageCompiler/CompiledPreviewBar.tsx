import * as React from 'react';
import {useEffect,useState} from 'react';
import type {CompiledPage} from './compilePage';
import {generatePageScript} from './generatePageScript';
import {downloadCode} from './downloadPageScript';
import {fetchPreviewPageScriptSource,fetchServerPageScriptSource,type LoadedPageScript} from './serverPageScript';
import './CompiledPreviewBar.css';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
/** Shown above Preview: which compiled file is running, with View code and Download. */
export default function CompiledPreviewBar({compiled,request,variant,script,note,page}:{
 compiled:CompiledPage;request?:Request;variant?:string;script?:LoadedPageScript|null;note?:string;
 /** The page as shown in the Builder: View code / Download give its converted file. */
 page?:{apiName:string};
}){
 const [open,setOpen]=useState(false);
 const [code,setCode]=useState('');
 const [error,setError]=useState('');
 const s=compiled.stats;
 const errors=compiled.diagnostics.filter(item=>item.level==='error');
 const fileName=compiled.apiName+'.page.js';
 // The exact file Preview runs, byte for byte.
 const source=async():Promise<string>=>script&&request
  ?script.previewId&&page?fetchPreviewPageScriptSource(request,page,variant??'Desktop')
   :fetchServerPageScriptSource(request,compiled.apiName,variant??'Desktop')
  :generatePageScript(compiled,'js');
 useEffect(()=>{
  if(!open)return;
  let active=true;
  setCode('');setError('');
  source().then(text=>{if(active)setCode(text);},failure=>{if(active)setError(failure instanceof Error?failure.message:'Unable to load the code');});
  return ()=>{active=false;};
 },[open,script,compiled]);
 const download=()=>{source().then(text=>downloadCode(text,fileName),failure=>setError(failure instanceof Error?failure.message:'Download failed'));};
 return <div className="compiled-preview-bar" role="status" aria-label="Compiled page">
  <span className="compiled-preview-summary">
   <strong>{script?'Running the converted page file (built by the server from this page)':'Running the browser plan'}</strong>
   {' · '}{s.compiled} compiled · {s.static} static
   {' · '}{s.dataSources} data load{s.dataSources===1?'':'s'} for {s.componentsWithData} component{s.componentsWithData===1?'':'s'}
   {s.aggregateCalls?<span> · {s.aggregateCalls} total call{s.aggregateCalls===1?'':'s'} → {s.distinctAggregates} asked once</span>:null}
   {errors.length?<span className="compiled-preview-errors"> · {errors.length} issue{errors.length===1?'':'s'} to fix</span>:null}
   {note?<span className="compiled-preview-errors"> · {note}</span>:null}
   {error&&!open?<span className="compiled-preview-errors"> · {error}</span>:null}
  </span>
  <span className="compiled-preview-actions">
   <button type="button" className="btn btn-small" onClick={()=>setOpen(true)}>View code</button>
   <button type="button" className="btn btn-small" onClick={download}>Download .js</button>
  </span>
  {open&&<div className="compiled-preview-dialog" role="dialog" aria-modal="true" aria-label="Compiled page code">
   <div className="compiled-preview-dialog-body">
    <header>
     <strong>{compiled.label} — {script?'converted page file (the code Preview runs)':'browser plan'}</strong>
     <button type="button" className="btn btn-small" disabled={!code} onClick={()=>void navigator.clipboard?.writeText(code)}>Copy</button>
     <button type="button" className="btn btn-small" disabled={!code} onClick={()=>downloadCode(code,fileName)}>Download</button>
     <button type="button" className="btn btn-small" onClick={()=>setOpen(false)}>Close</button>
    </header>
    {errors.length>0&&<ul className="compiled-preview-notes">
     {errors.map((item,index)=><li key={'e'+index} className="is-error">{item.componentId}: {item.message}</li>)}
    </ul>}
    <pre className="compiled-preview-code"><code>{error||code||'Loading…'}</code></pre>
   </div>
  </div>}
 </div>;
}
