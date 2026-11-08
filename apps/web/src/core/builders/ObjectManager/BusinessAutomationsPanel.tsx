import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import {generateMetadataApiName,metadataNameConflict,suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import type {ObjectMetadata,FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';
import {describeRecordTrigger,orderRecordTriggers,type RecordTriggerSummary} from './flowTriggerExplorer';
import {appRoutePath} from '../../workspace/Navigation/appRouting';
import {buildAutomationFlow,type AutomationKind,type RecipeInput} from './businessAutomationRecipes';
const empty=(objectApi:string):RecipeInput=>({
 kind:'Assignment',objectApi,apiName:'',label:'',trigger:'created',
 conditions:[],offsetAmount:1,offsetUnit:'Days'
});
export default function BusinessAutomationsPanel({object}:{object:ObjectMetadata}){
 const [draft,setDraft]=useState<RecipeInput>(()=>empty(object.apiName));
 const [manualApiName,setManualApiName]=useState(false);
 const [mode,setMode]=useState<'list'|'view'|'new'>('list');
 const [selectedFlowApiName,setSelectedFlowApiName]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [users,setUsers]=useState<Array<{Id:string;Name?:string;Email?:string;IsActive?:boolean}>>([]);
 const [flows,setFlows]=useState<Array<{apiName:string;label:string;flowType:string;status:string;triggerObject?:string}>>([]);
 const [explorer,setExplorer]=useState<{items:RecordTriggerSummary[];failed:number}|null>(null);
 const [explorerBusy,setExplorerBusy]=useState(false);
 useEffect(()=>{
   let active=true;
   void Promise.allSettled([
     apiRequest<{records:Array<{Id:string;Name?:string;Email?:string;IsActive?:boolean}>}>('/records/User?limit=100'),
     apiRequest<{flows:Array<{apiName:string;label:string;flowType:string;status:string;triggerObject?:string}>}>('/metadata/flows')
   ]).then(results=>{
     if(!active)return;
     if(results[0].status==='fulfilled')setUsers(results[0].value.records);
     if(results[1].status==='fulfilled')setFlows(results[1].value.flows);
   });
   return()=>{active=false};
 },[]);
 const inspectTriggers=async()=>{
  setExplorerBusy(true);setError('');
  const matching=flows.filter(flow=>flow.flowType==='Record-Triggered Flow'
   &&flow.triggerObject===object.apiName);
  const items:RecordTriggerSummary[]=[];
  let failed=0;
  try{
   // Inspect the SQL-backed saved definition; never guess a missing trigger order.
   for(let offset=0;offset<matching.length;offset+=10){
    const results=await Promise.allSettled(matching.slice(offset,offset+10).map(flow=>
     apiRequest<{flow:FlowDefinitionMetadata}>('/metadata/flows/'+encodeURIComponent(flow.apiName))));
    for(const result of results){
     if(result.status==='rejected'){failed++;continue;}
     try{
      if(result.value.flow.triggerObject===object.apiName)
       items.push(describeRecordTrigger(result.value.flow));
      else failed++;
     }catch{failed++;}
    }
   }
   setExplorer({items:orderRecordTriggers(items),failed});
  }catch(e){setError(e instanceof Error?e.message:'Unable to inspect triggers');}
  finally{setExplorerBusy(false);}
 };
 const fields=object.fields;
 const dateFields=fields.filter(f=>['Date','Date/Time','DateTime'].includes(f.dataType));
 const change=(values:Partial<RecipeInput>)=>setDraft(current=>({...current,...values}));
 const create=async()=>{
  setBusy(true);setError('');
  try{
   const payload=buildAutomationFlow({...draft,objectApi:object.apiName});
   const validation=await apiRequest<{valid:boolean;errors?:string[]}>(
     '/metadata/flows/'+encodeURIComponent(payload.apiName)+'/validate',
     {method:'POST',body:JSON.stringify(payload)});
   if(!validation.valid)throw Error((validation.errors??['Automation Flow validation failed']).join('; '));
   const response=await apiRequest<{flow:{apiName:string}}>(
     '/metadata/flows/'+encodeURIComponent(payload.apiName),
     {method:'PUT',body:JSON.stringify(payload)});
   if(!response.flow?.apiName)throw Error('Flow draft was not returned');
   window.location.assign(appRoutePath({kind:'setup',workspace:'flow-builder',resourceApiName:response.flow.apiName}));
  }catch(e){setError(e instanceof Error?e.message:'Unable to create Flow draft');setBusy(false);}
 };
 return <section className="surface object-setting-surface">
  <div className="section-toolbar"><div><h2>Business Automations</h2>
    <p>Existing automations are shared Flows. New automation recipes create a Flow draft.</p></div>
    {mode==='list'&&<button type="button" className="btn btn-brand"
      onClick={()=>{setDraft(empty(object.apiName));setMode('new')}}>New Automation</button>}
  </div>
  {error&&<p role="alert">{error}</p>}
  {mode==='list'&&<div className="metadata-card"><h3>Existing record automations</h3>
    <p>These are managed in the shared Flow Builder. Activation and deactivation retain Flow version history.</p>
    {flows.filter(f=>f.flowType==='Record-Triggered Flow'&&f.triggerObject===object.apiName)
      .map(flow=><div key={flow.apiName} className="metadata-row">
      <span><strong>{flow.label}</strong><small>{flow.status} · {flow.apiName}</small></span>
      <button className="btn" type="button" onClick={()=>{setSelectedFlowApiName(flow.apiName);setMode('view')}}>View</button>
      </div>)}
    {flows.filter(f=>f.flowType==='Record-Triggered Flow'&&f.triggerObject===object.apiName).length===0
     &&<p>No record-triggered Flows for this object.</p>}
  </div>}
  {mode==='list'&&<div className="metadata-card">
   <div className="section-toolbar"><div><h3>Flow Trigger Explorer</h3>
    <p>Inspect saved record triggers and execution order. Flow Builder edits and
     activates versions; the shared Flow runtime remains authoritative.</p></div>
    <button type="button" className="btn" disabled={explorerBusy}
     onClick={()=>void inspectTriggers()}>{explorerBusy?'Inspecting…':'Inspect Trigger Order'}</button>
   </div>
   {explorer&&<>
    {explorer.failed>0&&<p role="alert">{explorer.failed} Flow definitions could not be verified.
     Their order has not been guessed.</p>}
    <div className="table-scroll"><table className="slds-table">
     <thead><tr><th>Flow</th><th>Phase</th><th>Event</th><th>Order</th><th>Run after Flows</th><th>Scheduled paths</th><th>Status</th><th>Edit</th></tr></thead>
     <tbody>{explorer.items.map(item=><tr key={item.apiName}>
      <td>{item.label}</td><td>{item.phase}</td><td>{item.operation}</td>
      <td>{item.order}</td><td>{item.runAfterFlows.join(', ')||'None'}</td><td>{item.scheduledPathCount}</td><td>{item.status}</td>
      <td><a className="btn" href={appRoutePath({kind:'setup',workspace:'flow-builder',
       resourceApiName:item.apiName})}>Open Flow</a></td>
     </tr>)}</tbody></table></div>
    {explorer.items.length===0&&explorer.failed===0&&<p>No record-triggered Flows.</p>}
   </>}
  </div>}
  {mode==='view'&&(()=>{
    const current=flows.find(flow=>flow.apiName===selectedFlowApiName);
    return current?<div className="metadata-card">
      <div className="section-toolbar"><div><h3>{current.label}</h3><p>Read only</p></div>
        <div className="toolbar-actions"><button className="btn" type="button" onClick={()=>setMode('list')}>Back to list</button>
          <a className="btn btn-brand" href={appRoutePath({kind:'setup',workspace:'flow-builder',resourceApiName:current.apiName})}>Edit in Flow Builder</a>
        </div></div>
      <div className="metadata-row"><span>API name</span><strong>{current.apiName}</strong></div>
      <div className="metadata-row"><span>Type</span><strong>{current.flowType}</strong></div>
      <div className="metadata-row"><span>Status</span><strong>{current.status}</strong></div>
      </div>:<div className="empty-state">Automation no longer exists. <button type="button" className="btn" onClick={()=>setMode('list')}>Back</button></div>;
  })()}
  {mode==='new'&&<>
  <div className="toolbar-actions"><button className="btn" type="button" onClick={()=>setMode('list')}>Cancel / Back to list</button></div>
  <label className="form-label">Automation type<select className="form-control" value={draft.kind}
   onChange={e=>{setManualApiName(false);setDraft({...empty(object.apiName),kind:e.target.value as AutomationKind});}}>
   <option>Assignment</option><option>Escalation</option>
  </select></label>
  <label className="form-label">Label<input className="form-control" value={draft.label}
   onChange={e=>change({label:e.target.value,...(!manualApiName?{apiName:generateMetadataApiName(e.target.value)}:{})})}/></label>
  <details><summary>Advanced: API Name</summary><label className="form-label">API name<input className="form-control" value={draft.apiName} onChange={e=>{setManualApiName(true);change({apiName:e.target.value});}}/></label></details>
  {metadataNameConflict(draft.apiName,flows.map(flow=>flow.apiName))&&<p role="alert" className="form-error">API Name is in use. <button type="button" className="btn" onClick={()=>change({apiName:suggestMetadataApiName(draft.apiName,flows.map(flow=>flow.apiName))})}>Use suggested name</button></p>}
  {draft.kind!=='Escalation'&&<label className="form-label">Run when<select className="form-control" value={draft.trigger}
   onChange={e=>change({trigger:e.target.value as RecipeInput['trigger']})}>
   <option value="created">Record created</option><option value="updated">Record updated</option>
   <option value="created-or-updated">Created or updated</option></select></label>}
  <div className="metadata-card"><h3>Entry conditions</h3>
   <p>Optional; matching records enter the Flow. Use Flow Builder to add more complex decisions.</p>
   {draft.conditions.map((condition,i)=><div key={i} className="form-options">
    <select className="form-control" value={condition.field} onChange={e=>change({conditions:draft.conditions.map((c,j)=>j===i?{...c,field:e.target.value}:c)})}>
     <option value="">Select field</option>{fields.map(f=><option key={f.apiName} value={f.apiName}>{f.label}</option>)}</select>
    <select className="form-control" value={condition.operator} onChange={e=>change({conditions:draft.conditions.map((c,j)=>j===i?{...c,operator:e.target.value}:c)})}>
     <option value="Equals">Equals</option><option value="Not Equal To">Not equal</option>
     <option value="Contains">Contains</option></select>
    <input className="form-control" value={condition.value} onChange={e=>change({conditions:draft.conditions.map((c,j)=>j===i?{...c,value:e.target.value}:c)})}/>
    <button className="btn" onClick={()=>change({conditions:draft.conditions.filter((_,j)=>j!==i)})}>Remove</button>
   </div>)}
   <button className="btn" disabled={draft.conditions.length>=20} onClick={()=>change({conditions:[...draft.conditions,{field:'',operator:'Equals',value:''}]})}>Add condition</button>
  </div>
  {draft.kind==='Assignment'&&<div className="metadata-card">
   <h3>Assign record</h3>
   <label className="form-label">Assign to user<select className="form-control" value={draft.assigneeId??''}
    onChange={e=>change({assigneeId:e.target.value})}>
    <option value="">Select user</option>{users.filter(u=>u.IsActive!==false).map(user=>
      <option key={user.Id} value={user.Id}>{user.Name??user.Email??user.Id}</option>)}
   </select></label>
   <p>Owner is updated through the shared RecordEngine and its permission checks.
    Use a creation trigger to avoid reassignment loops.</p>
  </div>}
  {draft.kind==='Escalation'&&<div className="metadata-card"><h3>Durable scheduled escalation</h3>
   <label className="form-label">Date/time field<select className="form-control" value={draft.dueField??''} onChange={e=>change({dueField:e.target.value})}>
    <option value="">Select field</option>{dateFields.map(f=><option key={f.apiName} value={f.apiName}>{f.label}</option>)}</select></label>
   <label className="form-label">Offset<input type="number" className="form-control" value={draft.offsetAmount??1}
    onChange={e=>change({offsetAmount:Number(e.target.value)})}/></label>
   <label className="form-label">Unit<select className="form-control" value={draft.offsetUnit??'Days'} onChange={e=>change({offsetUnit:e.target.value})}>
    <option>Minutes</option><option>Hours</option><option>Days</option></select></label>
   <label className="form-label">Escalation task subject<input className="form-control" value={draft.taskSubject??''} onChange={e=>change({taskSubject:e.target.value})}/></label>
  </div>}
  <div className="modal-actions"><button className="btn btn-brand" disabled={busy||!draft.label||!draft.apiName}
   onClick={()=>void create()}>{busy?'Creating…':'Create Flow Draft'}</button></div>
  </>}
 </section>;
}
