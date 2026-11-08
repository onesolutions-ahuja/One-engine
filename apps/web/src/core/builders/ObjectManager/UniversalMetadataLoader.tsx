import React,{useRef,useState,type ChangeEvent} from 'react';
import {Download,Upload,FileSpreadsheet,AlertTriangle,CheckCircle2,X} from 'lucide-react';

type Row={sheet:string;excelRow:number;objectApi:string;fieldApi?:string;action:string;
 status:'Valid'|'Error'|'Skipped'|'Success';result?:string;message:string};
type Report={digest?:string;summary:{total:number;valid?:number;success?:number;error:number;skipped:number};
 rows:Row[];report:string};
type ExportableObject={apiName:string;label:string};
type Props={apiRequest:<T>(path:string,init?:RequestInit)=>Promise<T>;currentObject:string;onClose:()=>void;
 onChanged:()=>void;inline?:boolean;availableObjects?:ExportableObject[];
 onObjectChange?:(apiName:string)=>void};
function saveXlsx(base64:string,filename:string){
 const bytes=atob(base64);const data=new Uint8Array(bytes.length);
 for(let i=0;i<bytes.length;i++)data[i]=bytes.charCodeAt(i);
 const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;
 document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function UniversalMetadataLoader({apiRequest,currentObject,onClose,onChanged,inline=false,
 availableObjects,onObjectChange}:Props){
 const [workbook,setWorkbook]=useState(''),[fileName,setFileName]=useState('');
 const [validation,setValidation]=useState<Report|null>(null);
 const [execution,setExecution]=useState<Report|null>(null);
 const [exportMode,setExportMode]=useState<'current'|'all'>('current');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [exporting,setExporting]=useState(false);
 const [notice,setNotice]=useState('');
 const fileRef=useRef<HTMLInputElement>(null);
 const hasWorkbook=Boolean(workbook);
 const report=execution??validation;
 const selectFile=async(e:ChangeEvent<HTMLInputElement>)=>{
  setError('');setValidation(null);setExecution(null);
  const file=e.target.files?.[0];if(!file)return;
  if(file.size>10_000_000){setError('Maximum upload size is 10 MB');return;}
  if(!/\.xlsx$/i.test(file.name)){setError('Choose a .xlsx Excel workbook');return;}
  try{
   const base64=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
    reader.onerror=()=>reject(Error('Unable to read workbook'));
    reader.readAsDataURL(file);
   });
   setWorkbook(base64);setFileName(file.name);
  }catch(e){setError(e instanceof Error?e.message:'Unable to read workbook');}
 };
 const validate=async()=>{
  if(!hasWorkbook)return;
  setBusy(true);setError('');setExecution(null);setValidation(null);
  try{setValidation(await apiRequest<Report>('/metadata/loader/validate',{
   method:'POST',body:JSON.stringify({workbook})}));}
  catch(e){setError(e instanceof Error?e.message:'Unable to validate workbook');}
  finally{setBusy(false);}
 };
 const execute=async()=>{
  if(!validation?.digest)return;
  setBusy(true);setError('');
  try{
   const result=await apiRequest<Report>('/metadata/loader/execute',{
    method:'POST',body:JSON.stringify({workbook,digest:validation.digest,
     confirmation:'PROCEED_EXCLUDING_ERRORS'})});
   setExecution(result);onChanged();
  }catch(e){setError(e instanceof Error?e.message:'Unable to execute workbook');}
  finally{setBusy(false);}
 };
 const exportWorkbook=async()=>{
  if(exportMode==='current'&&!currentObject){setError('Choose an object before exporting');return;}
  setBusy(true);setExporting(true);setError('');setNotice('');
  try{
   const result=await apiRequest<{workbook:string}>('/metadata/loader/export',{
    method:'POST',body:JSON.stringify({objects:exportMode==='current'?[currentObject]:[]})});
   const downloadedName=exportMode==='current'?'MetaDrive_'+currentObject+'_Metadata.xlsx':'MetaDrive_All_Metadata.xlsx';
   saveXlsx(result.workbook,downloadedName);
   setNotice('Downloaded '+downloadedName+'.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to export metadata');}
  finally{setBusy(false);setExporting(false);}
 };
 return <div role={inline?'region':'dialog'} aria-modal={inline?undefined:true} aria-label="Object Metadata Loader"
  style={inline?{width:'100%'}:{position:'fixed',inset:0,zIndex:10020,
   background:'rgba(15,23,42,.55)',display:'grid',placeItems:'center',padding:16}}>
  <section className="surface" style={{width:inline?'100%':'min(1040px,100%)',maxHeight:inline?undefined:'94vh',overflowY:'auto',padding:24,
   background:'var(--surface,#fff)',borderRadius:12,boxShadow:'0 12px 48px #0004'}}>
   <div className="section-toolbar" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
    <div><h2>Universal Data Loader — Objects &amp; Fields</h2>
     <p>Export, edit, validate, then upsert or delete metadata with row-wise results.</p></div>
    {!inline&&<button className="btn" type="button" aria-label="Close loader" onClick={onClose}><X size={18}/></button>}
   </div>
   <section className="metadata-card" style={{marginBottom:16}}>
    <h3><Download size={17}/> Download existing metadata</h3>
    <fieldset style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:12,minWidth:0,border:0,padding:0,margin:0}}>
     <legend className="form-label">Export scope</legend>
     <label><input name="metadata-export-scope" type="radio" checked={exportMode==='current'} onChange={()=>setExportMode('current')}
      disabled={!currentObject}/> Selected object{!availableObjects?.length||!onObjectChange?' ('+(currentObject||'none')+')':''}</label>
     {availableObjects&&onObjectChange&&<select className="form-control" aria-label="Select object for metadata export"
      style={{width:260,maxWidth:'100%'}} value={currentObject}
      onChange={event=>onObjectChange(event.target.value)} disabled={busy||exportMode==='all'}>
      {availableObjects.map(item=><option key={item.apiName} value={item.apiName}>
       {item.label} ({item.apiName})</option>)}
     </select>}
     <label><input name="metadata-export-scope" type="radio" checked={exportMode==='all'} onChange={()=>setExportMode('all')}/> All permitted objects</label>
     <button className="btn" type="button" onClick={()=>void exportWorkbook()}
      aria-busy={exporting} aria-describedby={exporting?'metadata-loader-export-status':undefined}
      disabled={busy||(exportMode==='current'&&!currentObject)}>
      <FileSpreadsheet size={16}/> {exporting?'Preparing Excel…':'Download Excel'}</button>
    </fieldset>
    {exporting&&<p id="metadata-loader-export-status" role="status">Preparing the Excel workbook for download…</p>}
    {notice&&<p role="status">{notice}</p>}
    <p className="properties-help">This object selection controls only the download. Upload an Objects/Fields workbook for any permitted object, regardless of the selected export object. The export includes API names and revisions; removing a row never deletes metadata.</p>
   </section>
   <section className="metadata-card" style={{marginBottom:16}}>
    <h3><Upload size={17}/> Upload workbook</h3>
    <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:12}}>
     <input ref={fileRef} type="file" accept=".xlsx" aria-label="Upload metadata Excel workbook" style={{minWidth:0,maxWidth:"100%",width:"100%",boxSizing:"border-box"}}
      onChange={e=>void selectFile(e)}/>
     <button type="button" className="btn btn-brand" onClick={()=>void validate()}
      disabled={busy||!hasWorkbook} aria-describedby={!hasWorkbook?"metadata-loader-validate-hint":undefined}>1. Validate first</button>
    </div>
    {!hasWorkbook&&<small id="metadata-loader-validate-hint">Select an exported workbook to enable validation.</small>}
    <p className="properties-help">{fileName||'Upload an exported .xlsx workbook with Objects and/or Fields sheets. Actions: Create, Update, Upsert, Delete, HardDelete.'}</p>
   </section>
   {error&&<p role="alert" style={{color:'var(--color-danger,#b42318)'}}><AlertTriangle size={15}/> {error}</p>}
   {report&&<section className="metadata-card">
    <h3>{execution?'Execution report':'Validation results'}</h3>
    <div style={{display:'flex',flexWrap:'wrap',gap:18}}>
     <strong>Total: {report.summary.total}</strong>
     <span>Valid: {report.summary.valid??0}</span>
     <span>Successful: {report.summary.success??0}</span>
     <span>Errors: {report.summary.error}</span>
     <span>Skipped: {report.summary.skipped}</span>
    </div>
    <div className="table-scroll" style={{maxHeight:300,overflow:'auto',marginTop:12}}>
     <table className="slds-table"><thead><tr><th>Sheet</th><th>Excel row</th><th>Object</th>
      <th>Field</th><th>Action</th><th>Status</th><th>Message</th></tr></thead>
      <tbody>{report.rows.map((row,index)=><tr key={row.sheet+'-'+row.excelRow+'-'+index}>
       <td>{row.sheet}</td><td>{row.excelRow}</td><td>{row.objectApi}</td>
       <td>{row.fieldApi??'—'}</td><td>{row.action}</td><td>{row.status}</td>
       <td>{row.message}</td>
      </tr>)}</tbody></table>
    </div>
    <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:12,marginTop:14}}>
     {!execution&&<button type="button" className="btn btn-brand" onClick={()=>void execute()}
      disabled={busy||!validation?.summary.valid}>
      <CheckCircle2 size={16}/> 2. Proceed excluding error rows ({validation?.summary.valid??0})</button>}
     <button type="button" className="btn" onClick={()=>{
      saveXlsx(report.report,execution?'Metadata_Execution_Report.xlsx':'Metadata_Validation_Errors.xlsx');
      if(!execution){setValidation(null);}
     }}>
      <Download size={16}/>{execution?'Download final row-wise report':'Cancel and download error report'}</button>
     {!execution&&<button type="button" className="btn" onClick={()=>{setValidation(null);setExecution(null);}}>
      Cancel without changes</button>}
    </div>
    {execution&&<p className="properties-help">Executed rows are listed above and in the Excel report. Refresh Object Manager to see newly created definitions.</p>}
   </section>}
   <p className="properties-help">Hard Delete requires a separate OneEngine RBAC grant, an exported revision, and dependency checks. Dependent metadata may prevent permanent deletion.</p>
  </section>
 </div>;
}
