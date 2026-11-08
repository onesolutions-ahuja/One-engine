import {useEffect,useRef,useState} from 'react';
import {useViewportWidth} from '../../workspace/Responsive/useViewportWidth';
import TenantConnectedApps from './TenantConnectedApps';
import TenantLicenses from './TenantLicenses';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Audit={id:string;actor_user_id:string|null;table_name:string;operation:string;row_identifier:string;changed_fields:string[];created_at:string};
export default function TenantGovernance({request,canManage,initialTab='audit',focusOnMount=false}:{request:Request;canManage:boolean;initialTab?:string;focusOnMount?:boolean}){
 const [tab,setTab]=useState(initialTab);
 const rootRef=useRef<HTMLElement>(null);
 useEffect(()=>setTab(initialTab),[initialTab]);
 useEffect(()=>{if(focusOnMount)rootRef.current?.scrollIntoView({block:'start',behavior:'auto'});},[focusOnMount,initialTab]);
 return <section ref={rootRef} className="surface permission-section md-security-governance"><h2>Security governance</h2><div className="permission-tabs md-admin-tabstrip" role="tablist" aria-label="Security governance views">{(['audit','monitoring','licences','connected apps'] as const).map(t=><button type="button" role="tab" id={'governance-tab-'+t.replace(' ','-')} aria-controls={'governance-panel-'+t.replace(' ','-')} aria-selected={tab===t} className={tab===t?'active':''} key={t} onClick={()=>setTab(t)}>{({audit:'Audit Trail',monitoring:'Monitoring',licences:'Licences','connected apps':'Connected Apps'} as const)[t]}</button>)}</div>
 <div role="tabpanel" id={'governance-panel-'+tab.replace(' ','-')} aria-labelledby={'governance-tab-'+tab.replace(' ','-')} className="md-admin-tabpanel">{tab==='audit'&&<AuditTrail request={request}/>}{tab==='monitoring'&&<Monitoring request={request}/>}{tab==='licences'&&<TenantLicenses request={request} canManage={canManage}/>}{tab==='connected apps'&&<TenantConnectedApps request={request}/>}</div>
 </section>;
}
function AuditTrail({request}:{request:Request}){
 const width=useViewportWidth();
 const pageSize=width>0&&width<=600?10:25;
 const [page,setPage]=useState(0);
 const [auditDraft,setAuditDraft]=useState({actor:'',from:'',to:''});
 const [auditFilters,setAuditFilters]=useState({actor:'',from:'',to:''});
 const [auditFilterError,setAuditFilterError]=useState('');
 const [events,setEvents]=useState<Audit[]>([]),[next,setNext]=useState<string|null>(null),[exportCursor,setExportCursor]=useState<string|null>(null),[table,setTable]=useState(''),[global,setGlobal]=useState(false),[tables,setTables]=useState<{table_name:string}[]>([]),[message,setMessage]=useState('');
 const params=(forExport=false)=>new URLSearchParams({...table?{table}:{},...global?{global:'true'}:{},...auditFilters.actor?{actor:auditFilters.actor}:{},...auditFilters.from?{from:auditFilters.from}:{},...auditFilters.to?{to:auditFilters.to}:{},...forExport?{}:{limit:String(pageSize)}});
 const applyAuditFilters=()=>{
  if(auditDraft.from&&auditDraft.to&&auditDraft.from>auditDraft.to){setAuditFilterError('From date must be on or before To date.');return;}
  if(auditDraft.actor.trim()&&!/^[a-f0-9-]{2,36}$/i.test(auditDraft.actor.trim())){setAuditFilterError('Enter part of an actor user ID (at least 2 hexadecimal characters).');return;}
  setAuditFilterError('');setAuditFilters({...auditDraft,actor:auditDraft.actor.trim()});
 };
 const load=async(before?:string)=>{const p=params();if(before)p.set('before',before);const r=await request<{events:Audit[];nextCursor:string|null}>('/security/audit?'+p);setEvents(before?[...events,...r.events]:r.events);setNext(r.nextCursor);};
 useEffect(()=>{void request<{tables:typeof tables}>('/security/audit/coverage').then(r=>setTables(r.tables)).catch(e=>setMessage(String(e)));},[]);
 useEffect(()=>{setExportCursor(null);setPage(0);void load().catch(e=>setMessage(String(e)));},[table,global,auditFilters,pageSize]);
 const download=async()=>{const p=params(true);if(exportCursor)p.set('before',exportCursor);const r=await request<{csv:string;nextCursor:string|null}>('/security/audit/export?'+p);const url=URL.createObjectURL(new Blob([r.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='setup-audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setExportCursor(r.nextCursor);setMessage(r.nextCursor?'More export rows are available. Download the next page.':'Export complete for this page range.');};
 return <><h3>Setup Audit Trail</h3><p>Append-only history of setup row changes. Values and secrets are excluded. Each change records its actor and correlation ID; background and migration changes can have no user actor.</p>
 <div className="md-admin-toolbar"><label className="form-label md-admin-field-medium">Setup table<select className="form-control" value={table} onChange={e=>setTable(e.target.value)}><option value="">All setup tables</option>{tables.map(t=><option key={t.table_name}>{t.table_name}</option>)}</select></label>
 <label className="checkbox-row"><input type="checkbox" checked={global} onChange={e=>setGlobal(e.target.checked)}/>Global setup (platform permission required)</label>
 <label className="form-label md-admin-field-medium">Actor ID<input className="form-control" type="search" placeholder="Filter by user ID" value={auditDraft.actor} onChange={e=>setAuditDraft(p=>({...p,actor:e.target.value}))}/></label>
 <label className="form-label">From date<input type="date" className="form-control" value={auditDraft.from} onChange={e=>setAuditDraft(p=>({...p,from:e.target.value}))}/></label>
 <label className="form-label">To date<input type="date" className="form-control" value={auditDraft.to} onChange={e=>setAuditDraft(p=>({...p,to:e.target.value}))}/></label>
 <button type="button" className="btn btn-brand" onClick={applyAuditFilters}>Apply filters</button>
 <button type="button" className="btn" onClick={()=>{const blank={actor:'',from:'',to:''};setAuditDraft(blank);setAuditFilters(blank);setAuditFilterError('');}}>Clear</button>
 <button type="button" className="btn" onClick={()=>void download().catch(e=>setMessage(String(e)))}>{exportCursor?'Download next 5,000 CSV rows':'Export CSV (up to 5,000 rows)'}</button></div>
 {auditFilterError&&<p role="alert" className="form-error">{auditFilterError}</p>}
 {message&&<p role="status">{message}</p>}<div className="md-admin-table-wrap" role="region" aria-label="Setup audit events" tabIndex={0}><table className="data-table md-admin-table md-audit-table"><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Setup table</th><th scope="col">Operation</th><th scope="col">Row</th><th scope="col">Changed fields</th></tr></thead><tbody>{events.slice(page*pageSize,(page+1)*pageSize).map(e=><tr key={e.id}><td data-label="Time">{new Date(e.created_at).toLocaleString()}</td><td data-label="Actor">{e.actor_user_id??'System'}</td><td data-label="Setup table">{e.table_name}</td><td data-label="Operation">{e.operation}</td><td data-label="Row" data-long-id title={e.row_identifier}>{e.row_identifier}</td><td data-label="Changed fields">{e.changed_fields.join(', ')}</td></tr>)}{events.length===0&&<tr><td colSpan={6} className="md-admin-empty-row">No setup changes match these filters.</td></tr>}</tbody></table></div>
 <div className="md-admin-pagination" role="group" aria-label="Audit event pages">
  <button type="button" className="btn" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous {pageSize}</button>
  <span>Page {page+1} · {events.length} events loaded</span>
  <button type="button" className="btn" disabled={(page+1)*pageSize>=events.length&&!next}
   onClick={()=>{if((page+1)*pageSize<events.length)setPage(p=>p+1);else if(next)void load(next).then(()=>setPage(p=>p+1)).catch(e=>setMessage(String(e)));}}>Next {pageSize}</button>
 </div></>;
}
type Rule={id?:string;label:string;enabled:boolean;event_type:string;method:string;path_prefix:string;threshold:number;window_seconds:number;response:string;flow_api:string|null;service_user_id:string|null};
type Monitor={events:{id:string;created_at:string;event_type:string;resource:string;method:string;status_code:number;elapsed_ms:number}[];rules:Rule[];settings:{enabled:boolean;retention_days:number};summary:{requests:number;errors:number;average_ms:number};nextCursor:string|null};
const emptyRule=():Rule=>({label:'',enabled:false,event_type:'api',method:'*',path_prefix:'/api',threshold:100,window_seconds:60,response:'Block',flow_api:null,service_user_id:null});
function Monitoring({request}:{request:Request}){
 const width=useViewportWidth();
 const pageSize=width>0&&width<=600?10:25;
 const [page,setPage]=useState(0);
 useEffect(()=>setPage(0),[pageSize]);
 const [eventQuery,setEventQuery]=useState('');
 const [eventStatus,setEventStatus]=useState('all');
 const [ruleBusy,setRuleBusy]=useState(false);
 const [pruneOpen,setPruneOpen]=useState(false),[pruneConfirmation,setPruneConfirmation]=useState(''),[pruning,setPruning]=useState(false);
 const [prunePreview,setPrunePreview]=useState<{eligible:number;retentionDays:number}|null>(null);
 const [persistedSettings,setPersistedSettings]=useState<Monitor['settings']|null>(null);
 const [data,setData]=useState<Monitor|null>(null),[draft,setDraft]=useState<Rule>(emptyRule),[message,setMessage]=useState(''),[users,setUsers]=useState<{id:string;email:string}[]>([]),[flows,setFlows]=useState<{apiName:string;label:string}[]>([]);
 const load=async(before?:string)=>{
   const params=new URLSearchParams({limit:String(pageSize)});
   if(before)params.set('before',before);
   const result=await request<Monitor>('/security/monitoring?'+params);
   setData(previous=>before&&previous?{...result,events:[...previous.events,...result.events]}:result);
   if(!before){setPage(0);setPersistedSettings(result.settings);}
  };
 useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[pageSize]);
 useEffect(()=>{
   void request<{users:typeof users}>('/security/licenses').then(r=>setUsers(Array.isArray(r?.users)?r.users:[])).catch(()=>setUsers([]));
   void request<{flows:typeof flows}>('/metadata/flows/list?page=1&search=').then(r=>setFlows(Array.isArray(r?.flows)?r.flows:[])).catch(()=>setFlows([]));
 },[]);
 const save=(path:string,input:unknown)=>{setMessage('');void request(path,{method:'PUT',body:JSON.stringify(input)}).then(()=>load()).then(()=>setMessage('Saved')).catch(e=>setMessage(String(e)));};
 const savedRule=data?.rules.find(item=>item.id===draft.id);
 const ruleChanged=!savedRule||JSON.stringify(savedRule)!==JSON.stringify(draft);
 const saveRule=async()=>{
  if(ruleBusy||!ruleValid||!ruleChanged)return;
  setRuleBusy(true);setMessage('');
  try{await request('/security/monitoring/rules',{method:'PUT',body:JSON.stringify(draft)});
   await load();setMessage('Transaction rule saved.');}
  catch(e){setMessage('Unable to save transaction rule: '+String(e));}
  finally{setRuleBusy(false);}
 };
 const eventFilter=eventQuery.trim().toLocaleLowerCase();
 const filteredEvents=(data?.events??[]).filter(event=>{
   if(eventStatus==='errors'&&event.status_code<400)return false;
   if(eventStatus==='success'&&(event.status_code<200||event.status_code>=400))return false;
   return !eventFilter||[event.event_type,event.resource,event.method,String(event.status_code)]
    .some(value=>value.toLocaleLowerCase().includes(eventFilter));
 });
 const visibleEvents=filteredEvents.slice(page*pageSize,(page+1)*pageSize);
 const ruleValid=draft.label.trim().length>0&&draft.path_prefix.startsWith('/')&&Number.isFinite(draft.threshold)&&draft.threshold>=1
  &&Number.isFinite(draft.window_seconds)&&draft.window_seconds>=1
  &&(draft.response!=='Flow'||Boolean(draft.flow_api&&draft.service_user_id));
 const settingsValid=Boolean(data&&Number.isInteger(data.settings.retention_days)&&data.settings.retention_days>=90
  &&data.settings.retention_days<=3650);
 const settingsChanged=Boolean(data&&persistedSettings&&(data.settings.enabled!==persistedSettings.enabled
  ||data.settings.retention_days!==persistedSettings.retention_days));
 const prune=async()=>{
  if(pruning||pruneConfirmation!=='PRUNE'||!prunePreview)return;
  setPruning(true);setMessage('');
  try{
   await request('/security/monitoring/prune',{method:'POST',
    body:JSON.stringify({confirmation:'PRUNE',expectedRetentionDays:prunePreview.retentionDays})});
   await load();setMessage('Retention cleanup completed. Events older than the saved retention policy were removed.');
   setPruneOpen(false);setPruneConfirmation('');setPrunePreview(null);
  }catch(e){setMessage('Unable to remove older events: '+String(e));}
  finally{setPruning(false);}
 };
 return <><h3>Event Monitoring and Transaction Security</h3><p>Rules count authenticated requests per user and time window. Blocking starts at the threshold. Flow responses run once per window through the durable Flow worker, using the selected service identity.</p>{message&&<p role="status">{message}</p>}
 {data&&<><p>Last 24 hours: {data.summary.requests} requests, {data.summary.errors} errors, average {data.summary.average_ms} ms</p>
 <div className="md-admin-settings-block"><div className="md-admin-form-grid"><label className="checkbox-row md-admin-span-all"><input type="checkbox" checked={data.settings.enabled} onChange={e=>setData({...data,settings:{...data.settings,enabled:e.target.checked}})}/>Record request events (rules remain enforced)</label>
 <label className="form-label md-admin-field-short">Event retention days<input className="form-control" type="number" min="90" max="3650" value={data.settings.retention_days} onChange={e=>setData({...data,settings:{...data.settings,retention_days:Number(e.target.value)}})}/></label>
 </div><div className="md-admin-actions"><button type="button" className="btn btn-brand" disabled={!settingsValid||!settingsChanged||pruning} onClick={()=>save('/security/monitoring',data.settings)}>Save monitoring settings</button><button type="button" className="btn" disabled={pruning} onClick={()=>{
   setPruneConfirmation('');setPruneOpen(true);setPrunePreview(null);
   void request<{eligible:number;retentionDays:number}>('/security/monitoring/prune-preview')
     .then(setPrunePreview).catch(e=>{setMessage('Could not load cleanup preview: '+String(e));setPruneOpen(false);});
  }}>Remove events older than retention</button></div>
 {pruneOpen&&<div className="md-prune-confirmation" role="group" aria-label="Confirm removal of old security events">
  <strong>Confirm permanent event removal</strong>
  <p>{prunePreview
     ?`${prunePreview.eligible.toLocaleString()} security events older than ${prunePreview.retentionDays} days (before ${new Date(Date.now()-prunePreview.retentionDays*86400000).toLocaleDateString()}) will be permanently removed.`
     :'Loading the saved retention policy and event count…'}
   This cannot be undone. Unsaved retention changes do not affect the cutoff.</p>
  <label className="form-label">Type PRUNE to confirm<input className="form-control" value={pruneConfirmation} disabled={pruning} onChange={e=>setPruneConfirmation(e.target.value)}/></label>
  <div className="md-admin-actions"><button type="button" className="btn" disabled={pruning} onClick={()=>{setPruneOpen(false);setPruneConfirmation('');}}>Cancel</button>
   <button type="button" className="btn btn-danger" disabled={pruning||!prunePreview||pruneConfirmation!=='PRUNE'} onClick={()=>void prune()}>{pruning?'Removing…':'Remove old events'}</button>
  </div>
 </div>}</div><h4 className="md-admin-subheading">Transaction rule</h4><div className="md-admin-form-grid">
 <label className="form-label">Transaction rule<select className="form-control" value={draft.id??''} onChange={e=>setDraft(data.rules.find(r=>r.id===e.target.value)??emptyRule())}><option value="">New rule</option>{data.rules.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
 <label className="form-label">Rule name (required)<input className="form-control" required value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
 <label className="checkbox-row"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Enabled</label>
 {(['event_type','method','response'] as const).map((key,i)=><label className="form-label" key={key}>{['Event','HTTP method','Response'][i]}<select className="form-control" value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}>{[['api','metadata','login'],['*','GET','POST','PUT','PATCH','DELETE'],['Block','RevokeSessions','Flow']][i].map(v=><option key={v}>{v}</option>)}</select></label>)}
 <label className="form-label">Request path prefix (must start with /)<input className="form-control" required value={draft.path_prefix} onChange={e=>setDraft({...draft,path_prefix:e.target.value})}/></label>
 {(['threshold','window_seconds'] as const).map((key,i)=><label className="form-label" key={key}>{['Request threshold','Window in seconds'][i]}<input className="form-control" type="number" min="1" value={draft[key]} onChange={e=>setDraft({...draft,[key]:Number(e.target.value)})}/></label>)}
 {draft.response==='Flow'&&<><label className="form-label">Published Flow<select className="form-control" value={draft.flow_api??''} onChange={e=>setDraft({...draft,flow_api:e.target.value||null})}><option value="">Select Flow</option>{flows.map(f=><option key={f.apiName} value={f.apiName}>{f.label||f.apiName}</option>)}</select></label><label className="form-label">Service user<select className="form-control" value={draft.service_user_id??''} onChange={e=>setDraft({...draft,service_user_id:e.target.value||null})}><option value="">Select user</option>{users.map(u=><option key={u.id} value={u.id}>{u.email}</option>)}</select></label></>}
 </div><div className="md-admin-actions"><button type="button" className="btn btn-brand" disabled={!ruleValid||!ruleChanged||ruleBusy} onClick={()=>void saveRule()}>{ruleBusy?'Saving…':'Save rule'}</button></div><h4 className="md-admin-subheading">Recent requests</h4>
 <p className="permission-help">Filters below apply to requests already loaded on this page. Use Next to load older requests.</p>
 <div className="md-admin-toolbar">
  <label className="form-label">Filter loaded requests<input type="search" className="form-control" value={eventQuery}
    placeholder="Path, method, status or event" onChange={e=>{setEventQuery(e.target.value);setPage(0);}}/></label>
  <label className="form-label" htmlFor="monitoring-event-status-filter">Status</label><select id="monitoring-event-status-filter" aria-label="Monitoring event status" className="form-control" value={eventStatus}
    onChange={e=>{setEventStatus(e.target.value);setPage(0);}}>
    <option value="all">All loaded statuses</option><option value="errors">Errors (400+)</option>
    <option value="success">Successful (200–399)</option>
   </select>
  <span role="status">{filteredEvents.length} matching of {data.events.length} loaded requests</span>
 </div>
 <div className="md-admin-table-wrap" role="region" aria-label="Security monitoring events" tabIndex={0}><table className="data-table md-admin-table md-audit-table"><thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Milliseconds</th></tr></thead><tbody>{visibleEvents.map(e=><tr key={e.id}><td data-label="Time">{new Date(e.created_at).toLocaleString()}</td><td data-label="Event">{e.event_type}</td><td data-label="Request">{e.method} {e.resource}</td><td data-label="Status">{e.status_code||'In progress'}</td><td data-label="Milliseconds">{e.elapsed_ms}</td></tr>)}{visibleEvents.length===0&&<tr><td colSpan={5} className="md-admin-empty-row">{data.events.length===0?'No recent requests recorded.':'No loaded requests match these filters.'}</td></tr>}</tbody></table></div>
 <div className="md-admin-pagination" role="group" aria-label="Monitoring event pages">
   <button type="button" className="btn" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous {pageSize}</button>
   <span>Page {page+1} · {filteredEvents.length} matching loaded requests</span>
   <button type="button" className="btn" disabled={(page+1)*pageSize>=filteredEvents.length}
    onClick={()=>setPage(p=>p+1)}>Next {pageSize}</button>
   {data.nextCursor&&<button type="button" className="btn" onClick={()=>void load(data.nextCursor!).catch(e=>setMessage(String(e)))}>Load older requests</button>}
  </div></>}
 </>;
}
