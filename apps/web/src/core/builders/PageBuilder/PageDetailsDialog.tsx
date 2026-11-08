import {useEffect,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Pencil,LayoutTemplate,History,LockKeyhole} from 'lucide-react';
import type {LightningPageMetadata,LightningAppMetadata,PageActivationAssignmentMetadata,ProfileMetadata} from '../../metadata/Definitions/metadata';
import PageDetailsAssignmentEditor,{assignmentValidationError} from './PageDetailsAssignmentEditor';
import './PageDetailsDialog.css';
import {pageLayoutOptionLabel,primaryPageLayout,type PageLayoutSummary} from './pageLayoutSummary';

type Variant='Desktop'|'Tablet'|'Mobile'|'Custom';
type Version={version:number;createdAt:string;published:boolean;draft:boolean;archived:boolean};
const variants:Variant[]=['Desktop','Tablet','Mobile','Custom'];

/** Safe read-only canvas outline: historical metadata is never executed,
 * so old Flows and network-bound widgets cannot run during inspection. */
function HistoricalLayoutPreview({page}:{page:LightningPageMetadata}){
 const width=Math.max(320,page.canvasWidth||1200),height=Math.max(320,page.canvasHeight||800);
 const free=page.layoutMode==='free-canvas';
 return <div className="page-details-canvas-scroll">
  <div className={'page-details-canvas'+(free?' is-free':' is-template')}
   role="img" aria-label={'Historical '+page.layoutVariant+' layout'}
   style={{aspectRatio:width+'/'+height,background:page.canvasFillColor||'#ffffff'}}>
   {page.components.map((item,index)=>{
    const position=item.position;
    const style=free?{
     position:'absolute' as const,
     left:Math.max(0,Math.min(100,((position?.x??(index%4)*200)/width)*100))+'%',
     top:Math.max(0,Math.min(100,((position?.y??Math.floor(index/4)*130)/height)*100))+'%',
     width:Math.max(2,Math.min(100,((position?.width??180)/width)*100))+'%',
     height:Math.max(2,Math.min(100,((position?.height??100)/height)*100))+'%'
    }:undefined;
    return <div key={item.id} className={'page-details-canvas-component'+(item.visible===false?' is-hidden':'')}
     title={item.label+' · '+item.type} style={style}>
      <span>{item.label||item.type}</span>
      <small>{item.type}</small>
    </div>;
   })}
  </div>
 </div>;
}

/** Page identity, app assignment and immutable layout history.
 * Historical revisions can be inspected or restored to draft, never edited in place. */
export default function PageDetailsDialog({page,apps,profiles,recordTypes,disabled,request,onClose,onSave,onSaveAssignments,onOpenDesign,onReload,layoutSummary}:{
 page:LightningPageMetadata;
 apps:readonly LightningAppMetadata[];
 profiles:readonly ProfileMetadata[];
 recordTypes:readonly {id:string;label:string;active:boolean}[];
 disabled:boolean;
 request:<T>(path:string,init?:RequestInit)=>Promise<T>;
 onClose:()=>void;
 onSave:(apiName:string,label:string,appApiName:string|null,expectedLabel:string,nextApiName?:string,
  devices?:LightningPageMetadata['devices'],expectedDevices?:LightningPageMetadata['devices'])=>Promise<boolean>;
 onSaveAssignments:(page:LightningPageMetadata,assignments:PageActivationAssignmentMetadata[])=>Promise<LightningPageMetadata|false>;
 onOpenDesign:(apiName:string,layout:Variant)=>Promise<boolean>|boolean;
 onReload:(page:LightningPageMetadata)=>void;
 /** Which layouts the page has designed; the default opens the page's own layout. */
 layoutSummary?:PageLayoutSummary|null;
}){
 const dialogRef=useRef<HTMLElement>(null);
 const [activeSection,setActiveSection]=useState<'properties'|'history'>('properties');
 const originRef=useRef<HTMLElement|null>(typeof document==='undefined'?null:document.activeElement as HTMLElement);
 useEffect(()=>{
  return ()=>originRef.current?.focus();
 },[]);
 const dialogKeyDown=(event:ReactKeyboardEvent<HTMLElement>)=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onClose();return;}
  if(event.key!=='Tab')return;
  const focusable=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[]);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 };
 const [label,setLabel]=useState(page.label);
 const [apiName,setApiName]=useState(page.apiName);
 const apiNameValid=apiName===page.apiName||/^[a-z][a-z0-9_]{0,127}$/.test(apiName);
 const existing=(page.activationAssignments??[]).find(a=>a.scope==='App Default'&&a.appId)?.appId
   ??apps.find(app=>app.navigationPageApiNames.includes(page.apiName))?.apiName??'';
 const [appApiName,setAppApiName]=useState(existing);
 const [devices,setDevices]=useState<LightningPageMetadata['devices']>([...page.devices]);
 const deviceOptions=[{value:'Desktop',label:'Desktop enabled'},
  {value:'Tablet',label:'Tablet enabled'},{value:'Phone',label:'Mobile enabled'}] as const;
 const toggleDevice=(factor:LightningPageMetadata['devices'][number],enabled:boolean)=>
  setDevices(current=>enabled
   ?([...current,factor] as LightningPageMetadata['devices'])
   :current.filter(item=>item!==factor));
 const [assignments,setAssignments]=useState<PageActivationAssignmentMetadata[]>(page.activationAssignments??[]);
 const changedAssignments=page.pageType!=='App Page'&&page.pageType!=='In-Screen Page'&&page.pageType!=='Print Template'
  &&JSON.stringify(assignments)!==JSON.stringify(page.activationAssignments??[]);
 const assignmentError=changedAssignments?assignmentValidationError(page,assignments,apps,profiles,recordTypes):'';
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 // An open builder layout wins; from the page list, open the layout the page was designed in.
 const initialVariant:Variant=page.layoutVariant??primaryPageLayout(layoutSummary);
 const [variant,setVariant]=useState<Variant>(initialVariant);
 // Choosing a design layout is navigation, not a mutation of published metadata.
 const [designVariant,setDesignVariant]=useState<Variant>(initialVariant);
 // The summary may arrive after the dialog opens; follow it until the user picks.
 const [designTouched,setDesignTouched]=useState(false);
 useEffect(()=>{
  if(designTouched||page.layoutVariant)return;
  const primary=primaryPageLayout(layoutSummary);
  setDesignVariant(primary);setVariant(primary);
 },[layoutSummary,designTouched,page.layoutVariant]);
 const [versions,setVersions]=useState<Version[]>([]);
 const [loading,setLoading]=useState(false);
 const [showArchived,setShowArchived]=useState(false);
 const [preview,setPreview]=useState<{version:number;page:LightningPageMetadata}|null>(null);
 const valid=Boolean(apiNameValid&&label.trim()&&label.trim().length<=128&&devices.length>0&&
  !assignmentError&&(page.pageType!=='App Page'||apps.some(a=>a.apiName===appApiName)));
 const base=`/metadata/pages/${encodeURIComponent(page.apiName)}/layouts/${variant}`;
 useEffect(()=>{
  let active=true;
  setLoading(true);setPreview(null);setError('');
  request<{versions:Version[]}>(base+'/history')
   .then(result=>{if(active)setVersions(result.versions)})
   .catch(err=>{if(active)setError(err instanceof Error?err.message:'Unable to load versions')})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[page.apiName,variant,request]);
 const submit=async()=>{
  if(!valid||busy||disabled)return;
  setBusy(true);setError('');
  try{
   if(changedAssignments){
    const saved=await onSaveAssignments(page,assignments);
    if(!saved)throw new Error('Could not save activation assignments. Reload the page and retry.');
    onReload(saved);
   }
   const succeeded=await onSave(page.apiName,label.trim(),
    page.pageType==='App Page'?appApiName:null,page.label,apiName,devices,page.devices);
   if(succeeded)onClose();
   else setError('Could not save page details. Review the message and retry.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to update page');}
  finally{setBusy(false)}
 };
 const viewVersion=async(version:number)=>{
  if(busy)return;
  setBusy(true);setError('');
  try{
   const response=await request<{page:LightningPageMetadata}>(base+'/versions/'+version);
   setPreview({version,page:response.page});
  }catch(e){setError(e instanceof Error?e.message:'Unable to open version')}
  finally{setBusy(false)}
 };
 const restoreVersion=async(version:number)=>{
  if(busy||disabled||!window.confirm(
   'Restore version '+version+' to the editable draft? The published page stays unchanged until you publish.'))return;
  setBusy(true);setError('');
  try{
   const response=await request<{page:LightningPageMetadata}>(base+'/restore',{
    method:'POST',body:JSON.stringify({version})
   });
   onReload(response.page);
   if(await onOpenDesign(page.apiName,variant)!==false)onClose();
  }catch(e){setError(e instanceof Error?e.message:'Unable to restore version')}
  finally{setBusy(false)}
 };
 const copyVersion=async(version:number)=>{
  if(busy||disabled||!window.confirm(
   'Copy version '+version+' into a new editable draft? The currently published page will not change.'))return;
  setBusy(true);setError('');
  try{
   const result=await request<{page:LightningPageMetadata}>(base+'/versions/'+version+'/copy',{
    method:'POST'
   });
   onReload(result.page);
   if(await onOpenDesign(page.apiName,variant)!==false)onClose();
  }catch(e){setError(e instanceof Error?e.message:'Unable to copy this version')}
  finally{setBusy(false)}
 };
 const archiveVersion=async(version:number,archived:boolean)=>{
  if(busy||disabled)return;
  if(archived&&!window.confirm('Archive version v'+version+'? It will be hidden from the default list but can be restored later.'))return;
  setBusy(true);setError('');
  try{
   const result=await request<{versions:Version[]}>(base+'/versions/'+version+'/archive',{
    method:'PATCH',body:JSON.stringify({archived})
   });
   setVersions(result.versions);
   if(archived&&preview?.version===version)setPreview(null);
  }catch(e){setError(e instanceof Error?e.message:'Unable to update version archive')}
  finally{setBusy(false)}
 };
 const design=async()=>{
  if(busy)return;
  setBusy(true);setError('');
  try{
   if(await onOpenDesign(page.apiName,designVariant)!==false)onClose();
  }catch(e){setError(e instanceof Error?e.message:'Unable to open the selected layout')}
  finally{setBusy(false)}
 };
 return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <section ref={dialogRef} onKeyDown={dialogKeyDown} className="modal page-details-dialog" role="dialog" aria-modal="true"
   aria-label="Edit page properties and versions">
   <header className="modal-header page-details-header">
    <h2><Pencil size={19}/> Edit Page — {page.label}</h2>
    <button type="button" className="icon-button" aria-label="Close page details"
     onClick={onClose} disabled={busy}>×</button>
   </header>
   <div className="page-details-body">
    <div className="page-details-nav" role="tablist" aria-label="Page edit sections"
     onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const selected=event.key==='ArrowRight'||event.key==='End'?'history':'properties';
      setActiveSection(selected);
      dialogRef.current?.querySelector<HTMLButtonElement>('#page-details-tab-'+selected)?.focus();
     }}>
     <button id="page-details-tab-properties" type="button" role="tab"
       aria-selected={activeSection==='properties'} aria-controls="page-details-properties"
       tabIndex={activeSection==='properties'?0:-1}
       onClick={()=>setActiveSection('properties')}>Page Properties</button>
     <button id="page-details-tab-history" type="button" role="tab"
       aria-selected={activeSection==='history'} aria-controls="page-details-history"
       tabIndex={activeSection==='history'?0:-1}
       onClick={()=>setActiveSection('history')}>Versions</button>
    </div>
    <div id="page-details-properties" className="page-details-grid" role="tabpanel"
     aria-labelledby="page-details-tab-properties" hidden={activeSection!=='properties'}>
     <div className="page-details-main">
      <section className="page-details-section" aria-label="Basic Information">
       <h3>Basic Information</h3>
       <label className="form-label">Page Name
        <input className="form-control" aria-label="Page name" value={label}
         maxLength={128} onChange={e=>setLabel(e.target.value)} autoFocus/>
       </label>
       <label className="form-label">API Name
        <input className="form-control" aria-label="Page API name" value={apiName}
          maxLength={128} onChange={e=>setApiName(e.target.value.toLowerCase())}/>
        <small><LockKeyhole size={12}/> Lowercase only. Changing an existing identifier runs a tenant-scoped reference check; referenced pages cannot be renamed until dependencies are resolved.</small>
        {!apiNameValid&&<small role="alert">Use lowercase letters, numbers and underscores, starting with a letter.</small>}
       </label>
      </section>
      <section className="page-details-section" aria-label="Page Behaviour">
       <h3>Page Behaviour</h3>
       <div className="page-details-kv"><span>Page type</span><strong>{page.pageType}</strong></div>
       <div className="page-details-kv"><span>Layout mode</span><strong>{page.layoutMode}</strong></div>
       <div className="page-details-kv"><span>Related object</span><strong>{page.targetObject||'Not object-specific'}</strong></div>
       <label className="form-label">Open layout
        <select className="form-control" aria-label="Device layout to design"
         value={designVariant} disabled={busy}
         onChange={e=>{setDesignTouched(true);setDesignVariant(e.target.value as Variant);}}>
         {variants.map(item=><option key={item} value={item}>{pageLayoutOptionLabel(item,layoutSummary)}</option>)}
        </select>
        <small>Not a page setting: picks which layout the “Open … Design” button opens. Each layout keeps its own draft, components and published version. Switch layouts any time in the builder: Advanced › Device Layout.</small>
       </label>
      </section>
     </div>
     <aside className="page-details-side">
      <section className="page-details-section" aria-label="Application Assignment">
       <h3>Application Assignment</h3>
       {page.pageType==='App Page'?<label className="form-label">Application
        <select className="form-control" aria-label="Assign page to app" value={appApiName}
         onChange={e=>setAppApiName(e.target.value)}>
         <option value="">Select installed app…</option>
         {apps.map(app=><option key={app.apiName} value={app.apiName}>{app.label} ({app.apiName})</option>)}
        </select>
       </label>:page.pageType==='Record Page'||page.pageType==='Home Page'
        ?<PageDetailsAssignmentEditor page={page} apps={apps} profiles={profiles}
          recordTypes={recordTypes} assignments={assignments} onChange={setAssignments}
          disabled={disabled||busy}/>
        :<p>Activation is not configured for this page type.</p>}
       {page.pageType==='App Page'&&<small>
        {page.status==='Active'?'An active page appears in the selected app navigation.':
         'A draft page is assigned now; activate it to show it in the app navigation.'}
       </small>}
      </section>
      <section className="page-details-section" aria-label="Page Display and Activation">
       <h3>Display &amp; Activation</h3>
       <div className="page-details-kv"><span>Status</span><strong>{page.status}</strong></div>
       <div className="page-details-device-options" role="group" aria-label="Page enabled devices">
        {deviceOptions.map(factor=><label key={factor.value} className="page-details-device-option">
         <span>{factor.label}</span>
         <input type="checkbox" aria-label={factor.label} checked={devices.includes(factor.value)}
          disabled={disabled||busy} onChange={e=>toggleDevice(factor.value,e.target.checked)}/>
        </label>)}
       </div>
       {devices.includes('Custom')&&<small>Custom layout remains enabled and is configured independently.</small>}
       {!devices.length&&<small role="alert">Enable at least one device before saving.</small>}
       <small>Device eligibility is stored with the page. Layouts, publishing, and profile activation assignments remain independently managed.</small>
      </section>
     </aside>
    </div>
    <section id="page-details-history" className="page-details-section page-details-versions"
     role="tabpanel" aria-labelledby="page-details-tab-history" hidden={activeSection!=='history'}>
     <div className="page-details-version-heading">
      <h3><History size={17}/> Page Versions</h3>
      <label className="form-label">Layout
       <select className="form-control" value={variant} aria-label="Version layout"
        onChange={e=>setVariant(e.target.value as Variant)}>
        {variants.map(v=><option key={v}>{v}</option>)}
       </select>
      </label>
      <label className="page-details-archived-toggle">
       <input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>
       Show archived
      </label>
     </div>
     <p className="page-details-help">Historical versions are immutable and preserved by layout. Opening a version shows a read-only snapshot; restoring copies it into the editable draft without changing the live page.</p>
     <div className="page-details-table-scroll">
      <table className="records-table page-details-version-table" aria-label="Page version history">
       <thead><tr><th>Version</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead>
       <tbody>{versions.filter(v=>showArchived||!v.archived).map(v=><tr key={v.version}>
        <td>v{v.version}</td>
        <td>{new Date(v.createdAt).toLocaleString()}</td>
        <td>{v.archived?'Archived':v.published?'Published':v.draft?'Current draft':'Historical'}</td>
        <td>
         <div className="page-details-row-actions">
          <button type="button" className="btn btn-small" disabled={busy} onClick={()=>void viewVersion(v.version)}>View</button>
          <button type="button" className="btn btn-small" disabled={busy||disabled||v.archived}
           title="Create a new editable revision from this historical layout"
           onClick={()=>void copyVersion(v.version)}>Copy as New Version</button>
          <button type="button" className="btn btn-small" disabled={busy||disabled||v.draft||v.archived}
           title="Restore this version as the editable draft. Published layouts remain unchanged."
           onClick={()=>void restoreVersion(v.version)}>Restore &amp; Design</button>
          <button type="button" className="btn btn-small"
           disabled={busy||disabled||v.draft||v.published}
           title={v.archived?'Restore archived version to the history list':
            'Archive this historical version without deleting its snapshot'}
           onClick={()=>void archiveVersion(v.version,!v.archived)}>
           {v.archived?'Unarchive':'Archive'}</button>
         </div>
        </td>
       </tr>)}</tbody>
      </table>
      {!loading&&!versions.length&&<p>No saved versions for this layout.</p>}
      {!loading&&versions.length>0&&!versions.some(v=>showArchived||!v.archived)&&<p>All older versions are archived. Select Show archived to manage them.</p>}
      {loading&&<p role="status">Loading versions…</p>}
     </div>
     {preview&&<section className="page-details-preview" aria-label="Read-only version preview">
      <div className="page-details-preview-heading"><LayoutTemplate size={16}/>
       <strong>Version v{preview.version} — read-only layout summary</strong>
       <button className="btn btn-small" type="button" onClick={()=>setPreview(null)}>Close preview</button>
      </div>
      <p>Layout: {preview.page.layoutMode} · Canvas: {preview.page.canvasWidth} × {preview.page.canvasHeight} · Components: {preview.page.components.length}</p>
      <HistoricalLayoutPreview page={preview.page}/>
      <p>This is a read-only component layout outline. Restore as draft &amp; Design to open the complete page in the visual builder.</p>
     </section>}
    </section>
    {(error||assignmentError)&&<p role="alert" className="page-details-error">{error||assignmentError}</p>}
   </div>
   <footer className="office-ribbon-modal-actions page-details-footer">
    <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
    <button type="button" className="btn" disabled={busy}
     onClick={()=>void design()}>Open {designVariant} Design</button>
    <button type="button" className="btn btn-brand" disabled={busy||disabled||!valid}
     onClick={()=>void submit()}>{busy?'Saving…':'Save Changes'}</button>
   </footer>
  </section>
 </div>;
}
