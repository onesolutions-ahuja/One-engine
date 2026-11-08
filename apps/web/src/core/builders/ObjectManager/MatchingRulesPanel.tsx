import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import {generateMetadataApiName,metadataNameConflict,suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import {supportsMatchingInput} from './matchingFieldTypes';
type Rule={apiName:string;label:string;active:boolean;action:'Alert'|'Block';matchMode:'All'|'Any';targetObjectApi?:string|null;
 fields:Array<{fieldApi:string;caseSensitive:boolean;matchType?:'Exact'|'Normalized'|'Fuzzy';maxDistance?:1|2;targetFieldApi?:string|null}>};
const empty:Rule={apiName:'',label:'',active:false,action:'Alert',matchMode:'All',fields:[]};
export default function MatchingRulesPanel({object,objects}: {object:ObjectMetadata;objects:ObjectMetadata[]}){
 const [rules,setRules]=useState<Rule[]>([]);
 const [draft,setDraft]=useState<Rule|null>(null);
 const [mode,setMode]=useState<'list'|'view'|'edit'>('list');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const url='/metadata/objects/'+encodeURIComponent(object.apiName)+'/matching-rules';
 const load=async()=>{const data=await apiRequest<{rules:Rule[]}>(url);setRules(data.rules)};
 useEffect(()=>{let mounted=true;apiRequest<{rules:Rule[]}>(url)
  .then(x=>{if(mounted){setRules(x.rules);setError('')}})
  .catch(e=>{if(mounted)setError(e instanceof Error?e.message:'Unable to load rules')});
  return()=>{mounted=false}},[url]);
 const execute=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');
  try{await fn();await load();setDraft(null);setMode('list')}catch(e){setError(e instanceof Error?e.message:'Save failed')}
  finally{setBusy(false)}};
 const candidates=object.fields.filter(f=>supportsMatchingInput(f.dataType));
 const targetObject=objects.find(other=>other.apiName===draft?.targetObjectApi
   &&other.apiName!==object.apiName);
 const targetFields=targetObject?.fields.filter(f=>
   supportsMatchingInput(f.dataType))??[];
 return <section className="surface object-setting-surface">
  <div className="section-toolbar"><div><h2>Duplicate & Matching Rules</h2>
   <p>Compare selected fields to existing records. Block a match or save it as a duplicate alert.</p></div>
   {mode==='list'&&<button className="btn btn-brand" onClick={()=>{setDraft({...empty,fields:[]});setMode('edit')}}>New Rule</button>}</div>
  {error&&<p role="alert">{error}</p>}
  {mode==='list'&&<div className="table-scroll"><table className="slds-table"><thead><tr><th>Name</th><th>Criteria</th><th>Action</th><th>Status</th><th>Manage</th></tr></thead>
   <tbody>{rules.map(rule=><tr key={rule.apiName}>
    <td><button className="field-link" type="button" onClick={()=>{setDraft({...rule,fields:rule.fields.map(f=>({...f}))});setMode('view')}}>{rule.label}</button>
      <small className="api-name"> {rule.apiName}</small></td>
    <td>{rule.targetObjectApi&&rule.targetObjectApi!==object.apiName
       ?'Against '+rule.targetObjectApi+' · ':''}{rule.matchMode}: {rule.fields.map(f=>f.fieldApi+(f.matchType==='Normalized'?' (normalised)':f.matchType==='Fuzzy'?' (fuzzy)':'')).join(', ')}</td>
    <td>{rule.action}</td><td>{rule.active?'Active':'Inactive'}</td>
    <td><button className="btn" onClick={()=>{setDraft({...rule,fields:rule.fields.map(f=>({...f}))});setMode('view')}}>View</button></td>
   </tr>)}</tbody></table></div>}
  {mode==='view'&&draft&&<div className="metadata-card">
    <div className="section-toolbar"><div><h3>{draft.label}</h3><p>Read only</p></div>
      <div className="toolbar-actions">
        <button type="button" className="btn" onClick={()=>{setDraft(null);setMode('list')}}>Back to list</button>
        <button type="button" className="btn btn-brand" onClick={()=>setMode('edit')}>Edit</button>
      </div>
    </div>
    <div className="metadata-row"><span>API name</span><strong>{draft.apiName}</strong></div>
    <div className="metadata-row"><span>Match criteria</span><strong>{draft.matchMode}</strong></div>
    <div className="metadata-row"><span>Compare with object</span>
      <strong>{draft.targetObjectApi??object.label}</strong></div>
    <div className="metadata-row"><span>Fields</span><strong>{draft.fields.map(f=>f.fieldApi).join(', ')}</strong></div>
    <div className="metadata-row"><span>Duplicate action</span><strong>{draft.action}</strong></div>
    <div className="metadata-row"><span>Status</span><strong>{draft.active?'Active':'Inactive'}</strong></div>
    <button type="button" className="btn" disabled={busy} onClick={()=>{
      if(!window.confirm('Delete matching rule "'+draft.label+'"?'))return;
      void execute(()=>apiRequest(url+'/'+encodeURIComponent(draft.apiName),{method:'DELETE'}));
    }}>Delete</button>
  </div>}
  {mode==='edit'&&draft&&<div className="metadata-card"><h3>{draft.apiName?'Edit matching rule':'Create matching rule'}</h3>
   <label className="form-label">Label<input className="form-control" value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value,
     apiName:rules.some(r=>r.apiName===draft.apiName)||draft.apiName!==generateMetadataApiName(draft.label)?draft.apiName:generateMetadataApiName(e.target.value)})}/></label>
   <details><summary>Advanced: API Name</summary><label className="form-label">API Name<input className="form-control" disabled={rules.some(r=>r.apiName===draft.apiName)}
    value={draft.apiName} onChange={e=>setDraft({...draft,apiName:e.target.value})}/></label></details>
   {!rules.some(r=>r.apiName===draft.apiName)&&metadataNameConflict(draft.apiName,rules.map(r=>r.apiName))&&
     <p role="alert" className="form-error">Duplicate API Name. <button type="button" className="btn"
       onClick={()=>setDraft({...draft,apiName:suggestMetadataApiName(draft.apiName,rules.map(r=>r.apiName))})}>Use suggested name</button></p>}
   <label className="form-label">Compare with records from
    <select className="form-control" value={draft.targetObjectApi??''}
     onChange={e=>setDraft({...draft,targetObjectApi:e.target.value||null,
       fields:draft.fields.map(field=>({...field,targetFieldApi:undefined}))})}>
     <option value="">This object ({object.label})</option>
     {objects.filter(other=>other.apiName!==object.apiName).map(other=>
      <option key={other.apiName} value={other.apiName}>{other.label} ({other.apiName})</option>)}
    </select>
   </label>
   <label className="form-label">When fields match<select className="form-control" value={draft.matchMode}
    onChange={e=>setDraft({...draft,matchMode:e.target.value as Rule['matchMode']})}>
     <option value="All">All selected fields</option><option value="Any">Any selected field</option></select></label>
   <label className="form-label">On duplicate<select className="form-control" value={draft.action}
    onChange={e=>setDraft({...draft,action:e.target.value as Rule['action']})}>
     <option value="Alert">Alert: allow save and log duplicate</option><option value="Block">Block: reject save</option></select></label>
   <div className="form-label">Matching fields</div>
   {candidates.map(f=>{const current=draft.fields.find(item=>item.fieldApi===f.apiName);
    return <div className="checkbox-row" key={f.apiName}>
     <label><input type="checkbox" checked={Boolean(current)} onChange={e=>setDraft({...draft,
      fields:e.target.checked?[...draft.fields,{fieldApi:f.apiName,caseSensitive:false,matchType:'Exact' as const}]:draft.fields.filter(item=>item.fieldApi!==f.apiName)})}/>{f.label}</label>
     {current&&targetObject&&<label>Match against field in {targetObject.label}
       <select className="form-control" value={current.targetFieldApi??''}
        onChange={e=>setDraft({...draft,fields:draft.fields.map(item=>item.fieldApi===f.apiName
         ?{...item,targetFieldApi:e.target.value}:item)})}>
        <option value="">Choose a target field</option>
        {targetFields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
       </select>
     </label>}
     {current&&<label>Comparison<select className="form-control" value={current.matchType??'Exact'}
      onChange={e=>{const matchType=e.target.value as 'Exact'|'Normalized'|'Fuzzy';setDraft({...draft,
       fields:draft.fields.map(item=>item.fieldApi===f.apiName?{...item,matchType,
        caseSensitive:matchType!=='Exact'?false:item.caseSensitive}:item)})}}>
       <option value="Exact">Exact value (case option below)</option>
       <option value="Normalized">Ignore case, spaces and punctuation (Unicode text)</option>
       <option value="Fuzzy">Fuzzy near match (same first letter, 4–64 letters or digits)</option>
      </select></label>}
     {current&&current.matchType==='Fuzzy'&&<label>Allowed typos
      <select className="form-control" value={current.maxDistance??1}
       onChange={e=>setDraft({...draft,fields:draft.fields.map(item=>item.fieldApi===f.apiName
         ?{...item,maxDistance:Number(e.target.value) as 1|2}:item)})}>
       <option value={1}>One character</option><option value={2}>Two characters</option>
      </select></label>}
     {current&&(!current.matchType||current.matchType==='Exact')&&<label><input type="checkbox" checked={current.caseSensitive} onChange={e=>setDraft({...draft,
      fields:draft.fields.map(item=>item.fieldApi===f.apiName?{...item,caseSensitive:e.target.checked}:item)})}/>Case sensitive</label>}
    </div>})}
   <label className="checkbox-row"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Active</label>
   <div className="modal-actions"><button className="btn" onClick={()=>setMode(draft.apiName&&rules.some(rule=>rule.apiName===draft.apiName)?'view':'list')}>Cancel</button>
    <button className="btn btn-brand" disabled={busy||!draft.label.trim()||!draft.apiName||!draft.fields.length||
      Boolean(targetObject&&draft.fields.some(field=>!field.targetFieldApi))}
     onClick={()=>void execute(()=>apiRequest(url+'/'+encodeURIComponent(draft.apiName),{method:'PUT',body:JSON.stringify(draft)}))}>Save Rule</button>
   </div></div>}
 </section>;
}
