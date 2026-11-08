import {generateMetadataApiName,suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import {useEffect,useState} from 'react';
import {Plus,X} from 'lucide-react';
import QuickActionBindingsEditor from './QuickActionBindingsEditor';
import {confirmDestructiveAction} from '../../components/ConfirmAction/confirmDestructiveAction';
import type {ObjectMetadata,FlowDefinitionMetadata,QuickActionComponentBinding} from '../../metadata/Definitions/metadata';

/** Optional Builder-only editor. Published runtime does not load this component. */
export default function GlobalQuickActionsEditor({
 apiRequest,objects,flows,components,onNotify
}:{
 apiRequest:<T>(path:string,init?:RequestInit)=>Promise<T>;
 objects:ObjectMetadata[];flows:FlowDefinitionMetadata[];components:Array<{apiName:string;label:string}>;onNotify:(message:string)=>void
}){
  type GlobalActionDraft={id:string;label:string;enabled:boolean;
    behavior:'Create Record'|'Run Flow'|'Open Component'|'Send Email';targetObjectApi?:string;
    flowApiName?:string;componentApiName?:string;presentation?:'Modal'|'Side Panel';
    componentBindings?:QuickActionComponentBinding[];credentialId?:string;fromEmail?:string};
  const [globalActions,setGlobalActions] = useState<GlobalActionDraft[]>([]);
  const [globalActionName,setGlobalActionName] = useState('');
  const [globalActionBehavior,setGlobalActionBehavior] = useState<GlobalActionDraft['behavior']>('Create Record');
  const [globalActionTarget,setGlobalActionTarget] = useState('');
  const [globalActionFlow,setGlobalActionFlow] = useState('');
  const [globalActionComponent,setGlobalActionComponent] = useState('');
  const [globalActionPresentation,setGlobalActionPresentation] = useState<'Modal'|'Side Panel'>('Modal');
  const [globalActionBindings,setGlobalActionBindings] = useState<QuickActionComponentBinding[]>([]);
  const [globalActionsError,setGlobalActionsError] = useState('');
  useEffect(()=>{
    let active=true;
    void apiRequest<{actions:GlobalActionDraft[]}>('/metadata/global-actions')
      .then(result=>{if(active)setGlobalActions(result.actions);})
      .catch(error=>{if(active)setGlobalActionsError(error instanceof Error?error.message:'Global actions unavailable');});
    return ()=>{active=false;};
  },[]);
  const saveGlobalActions=async()=>{
    try{
      await apiRequest('/metadata/global-actions',{method:'PUT',body:JSON.stringify({actions:globalActions})});
      setGlobalActionsError('');onNotify('Tenant global Quick Actions saved.');
    }catch(error){
      setGlobalActionsError(error instanceof Error?error.message:'Cannot save global actions');
    }
  };

 return <div className="metadata-card">
        <div className="section-toolbar"><div><h3>Global Quick Actions</h3>
          <p>Available throughout the tenant, subject to per-action OneEngine permissions.</p></div>
          <button className="btn btn-brand" type="button" onClick={()=>void saveGlobalActions()}>Save Global Actions</button>
        </div>
        {globalActionsError&&<div className="records-message" role="alert">{globalActionsError}</div>}
        {globalActions.map(action=><div className="metadata-card" key={action.id}>
          <div className="metadata-row"><label>{action.label} · {action.behavior}</label>
            <label><input type="checkbox" checked={action.enabled}
              onChange={event=>setGlobalActions(current=>current.map(a=>a.id===action.id?{...a,enabled:event.target.checked}:a))}/> Enabled</label>
            <button className="row-menu" type="button" aria-label={`Remove global action ${action.label}`}
              onClick={()=>{ if (!confirmDestructiveAction('Remove','Global Quick Action "'+action.label+'"','Save Global Actions to apply this removal.')) return; setGlobalActions(current=>current.filter(a=>a.id!==action.id)); }}><X size={14}/></button>
          </div>
          {action.behavior==='Create Record'&&<select className="form-control"
            aria-label={`Target object for global ${action.label}`} value={action.targetObjectApi??''}
            onChange={event=>setGlobalActions(current=>current.map(a=>a.id===action.id?{...a,targetObjectApi:event.target.value}:a))}>
            <option value="">Choose Object</option>
            {objects.map(o=><option key={o.apiName} value={o.apiName}>{o.label}</option>)}
          </select>}
          {action.behavior==='Run Flow'&&<select className="form-control"
            aria-label={`Flow for global ${action.label}`} value={action.flowApiName??''}
            onChange={event=>setGlobalActions(current=>current.map(a=>a.id===action.id?{...a,flowApiName:event.target.value}:a))}>
            <option value="">Choose Flow</option>
            {flows.filter(f=>f.status==='Active'&&(f.flowType==='Screen Flow'||f.flowType==='Autolaunched Flow')).map(f=><option key={f.apiName} value={f.apiName}>{f.label}</option>)}
          </select>}
          {action.behavior==='Open Component'&&<>
            <select className="form-control" aria-label={`Component for global ${action.label}`}
              value={action.componentApiName??''} onChange={event=>setGlobalActions(current=>current.map(a=>a.id===action.id?{...a,componentApiName:event.target.value}:a))}>
              <option value="">Choose published Component</option>
              {components.map(c=><option key={c.apiName} value={c.apiName}>{c.label}</option>)}
            </select>
            <select className="form-control" aria-label={`Presentation for global ${action.label}`}
              value={action.presentation??'Modal'} onChange={event=>setGlobalActions(current=>current.map(a=>a.id===action.id?{...a,presentation:event.target.value as 'Modal'|'Side Panel'}:a))}>
              <option value="Modal">Modal</option><option value="Side Panel">Side Panel</option>
            </select>
            <QuickActionBindingsEditor scope="global" bindings={action.componentBindings??[]}
              onChange={bindings=>setGlobalActions(current=>current.map(a=>a.id===action.id
                ?{...a,componentBindings:bindings}:a))}/>
          </>}
          {action.behavior==='Send Email'&&<label className="form-label">HTTPS Delivery Flow
             <select className="form-control" aria-label={`Email Flow for global ${action.label}`}
               value={action.flowApiName??''}
               onChange={event=>setGlobalActions(current=>current.map(a=>a.id===action.id?{...a,flowApiName:event.target.value}:a))}>
               <option value="">Choose active Email Flow</option>
               {flows.filter(f=>f.status==='Active').map(f=><option key={f.apiName} value={f.apiName}>{f.label}</option>)}
             </select>
           </label>}
         </div>)}
        <div className="record-type-create">
          <input className="form-control" aria-label="New global action name" maxLength={80}
            placeholder="Action label" value={globalActionName}
            onChange={event=>setGlobalActionName(event.target.value)}/>
          <select className="form-control" aria-label="New global action behavior" value={globalActionBehavior}
            onChange={event=>setGlobalActionBehavior(event.target.value as GlobalActionDraft['behavior'])}>
            <option value="Create Record">Create Record</option>
            <option value="Run Flow">Run Flow</option>
            <option value="Open Component">Open Component</option>
            <option value="Send Email">Send Email</option>
          </select>
          {globalActionBehavior==='Create Record'&&<select className="form-control"
            aria-label="Global action target Object" value={globalActionTarget} onChange={event=>setGlobalActionTarget(event.target.value)}>
            <option value="">Choose Object</option>
            {objects.map(o=><option key={o.apiName} value={o.apiName}>{o.label}</option>)}
          </select>}
          {globalActionBehavior==='Run Flow'&&<select className="form-control" aria-label="Global action Flow"
            value={globalActionFlow} onChange={event=>setGlobalActionFlow(event.target.value)}>
            <option value="">Choose Flow</option>
            {flows.filter(f=>f.status==='Active'&&(f.flowType==='Screen Flow'||f.flowType==='Autolaunched Flow')).map(f=><option key={f.apiName} value={f.apiName}>{f.label}</option>)}
          </select>}
          {globalActionBehavior==='Open Component'&&<>
            <select className="form-control" aria-label="Global action Component"
              value={globalActionComponent} onChange={event=>setGlobalActionComponent(event.target.value)}>
              <option value="">Choose published Component</option>
              {components.map(c=><option key={c.apiName} value={c.apiName}>{c.label}</option>)}
            </select>
            <select className="form-control" aria-label="Global action presentation"
              value={globalActionPresentation} onChange={event=>setGlobalActionPresentation(event.target.value as 'Modal'|'Side Panel')}>
              <option value="Modal">Modal</option><option value="Side Panel">Side Panel</option>
            </select>
            <QuickActionBindingsEditor scope="global" bindings={globalActionBindings}
              onChange={setGlobalActionBindings}/>
          </>}
          {globalActionBehavior==='Send Email'&&<label className="form-label">HTTPS Delivery Flow
             <select className="form-control" aria-label="Global action email Flow"
               value={globalActionFlow} onChange={event=>setGlobalActionFlow(event.target.value)}>
               <option value="">Choose active Email Flow</option>
               {flows.filter(f=>f.status==='Active').map(f=><option key={f.apiName} value={f.apiName}>{f.label}</option>)}
             </select>
           </label>}
           <button className="btn" type="button" disabled={!globalActionName.trim()
            ||(globalActionBehavior==='Create Record'&&!globalActionTarget)
            ||(globalActionBehavior==='Run Flow'&&!globalActionFlow)
            ||(globalActionBehavior==='Open Component'&&!globalActionComponent)
            ||(globalActionBehavior==='Send Email'&&!globalActionFlow)}
            onClick={()=>{
              const label=globalActionName.trim();
              if(globalActions.some(a=>a.label.toLowerCase()===label.toLowerCase())){
                onNotify('Global action labels must be unique');return;
              }
              const baseName='Global_'+(generateMetadataApiName(label)||'Action');
              const apiName=suggestMetadataApiName(baseName,globalActions.map(a=>a.id),100);
              if(!apiName){onNotify('Could not generate an available global action API Name');return;}
              setGlobalActions(current=>[...current,{id:apiName,
                label,enabled:true,behavior:globalActionBehavior,
                ...(globalActionBehavior==='Create Record'?{targetObjectApi:globalActionTarget}:{}),
                ...(globalActionBehavior==='Run Flow'?{flowApiName:globalActionFlow}:{}),
                ...(globalActionBehavior==='Open Component'?{componentApiName:globalActionComponent,
                  presentation:globalActionPresentation,componentBindings:globalActionBindings}:{}),
                ...(globalActionBehavior==='Send Email'?{flowApiName:globalActionFlow}:{})}]);
              setGlobalActionName('');setGlobalActionComponent('');setGlobalActionBindings([]);
            }}><Plus size={14}/>Add Global Action</button>
        </div>
      </div>;
}
