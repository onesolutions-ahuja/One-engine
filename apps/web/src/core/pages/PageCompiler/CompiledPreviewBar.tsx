import * as React from 'react';
import {useMemo,useState} from 'react';
import type {CompiledPage} from './compilePage';
import {generatePageScript,type ScriptLanguage} from './generatePageScript';
import {downloadPageScript} from './downloadPageScript';
import './CompiledPreviewBar.css';

/** Shown above Preview: the page is running its compiled code. */
export default function CompiledPreviewBar({compiled}:{compiled:CompiledPage}){
 const [open,setOpen]=useState(false);
 const language:ScriptLanguage='ts';
 const code=useMemo(()=>open?generatePageScript(compiled,language):'',[open,compiled,language]);
 const s=compiled.stats;
 const errors=compiled.diagnostics.filter(item=>item.level==='error');
 const legacy=compiled.components.filter(item=>item.mode==='legacy');
 return <div className="compiled-preview-bar" role="status" aria-label="Compiled page">
  <span className="compiled-preview-summary">
   <strong>Running compiled code</strong>
   {' · '}{s.compiled} compiled · {s.static} static{s.legacy?' · '+s.legacy+' on previous runtime':''}
   {' · '}{s.dataSources} data load{s.dataSources===1?'':'s'} for {s.componentsWithData} component{s.componentsWithData===1?'':'s'}
   {s.aggregateCalls?<span> · {s.aggregateCalls} total call{s.aggregateCalls===1?'':'s'} → {s.distinctAggregates} asked once</span>:null}
   {errors.length?<span className="compiled-preview-errors"> · {errors.length} issue{errors.length===1?'':'s'} to fix</span>:null}
  </span>
  <span className="compiled-preview-actions">
   <button type="button" className="btn btn-small" onClick={()=>setOpen(true)}>View code</button>
   <button type="button" className="btn btn-small" onClick={()=>downloadPageScript(compiled,'ts')}>Download readable copy</button>
  </span>
  {open&&<div className="compiled-preview-dialog" role="dialog" aria-modal="true" aria-label="Compiled page code">
   <div className="compiled-preview-dialog-body">
    <header>
     <strong>{compiled.label} — compiled code</strong>
     <button type="button" className="btn btn-small" onClick={()=>void navigator.clipboard?.writeText(code)}>Copy</button>
     <button type="button" className="btn btn-small" onClick={()=>downloadPageScript(compiled,language)}>Download</button>
     <button type="button" className="btn btn-small" onClick={()=>setOpen(false)}>Close</button>
    </header>
    {(errors.length>0||legacy.length>0)&&<ul className="compiled-preview-notes">
     {errors.map((item,index)=><li key={'e'+index} className="is-error">{item.componentId}: {item.message}</li>)}
     {legacy.map(item=><li key={item.id}>{item.label||item.id}: previous runtime ({item.legacyReasons.join(', ')})</li>)}
    </ul>}
    <pre className="compiled-preview-code"><code>{code}</code></pre>
   </div>
  </div>}
 </div>;
}
