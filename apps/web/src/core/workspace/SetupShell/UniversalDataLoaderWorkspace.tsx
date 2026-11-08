import React,{useEffect,useMemo,useState,type ChangeEvent} from 'react';
import {Download,Upload,CheckCircle2,AlertTriangle,Database,Table2,SlidersHorizontal} from 'lucide-react';
import UniversalMetadataLoader from '../../builders/ObjectManager/UniversalMetadataLoader';

type Field={apiName:string;label:string;dataType:string;externalId?:boolean};
type ObjectInfo={apiName:string;label:string;fields:Field[]};
type Api=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Row={excelRow:number;action:string;status:string;message:string;result:string;cells?:Record<string,string>};
type Report={digest?:string;summary:{total:number;valid:number;success:number;error:number;skipped:number};
 rows:Row[];report:string};
function saveXlsx(base64:string,name:string){
 const binary=atob(base64),data=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);
 const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const link=document.createElement('a');link.href=url;link.download=name;
 document.body.appendChild(link);link.click();link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function loadXlsx(event:ChangeEvent<HTMLInputElement>){
 const file=event.target.files?.[0];
 if(!file)return null;
 if(file.size>10_000_000||!/\.xlsx$/i.test(file.name))throw Error('Select a .xlsx Excel workbook smaller than 10 MB');
 const source=await new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
  reader.onerror=()=>reject(Error('Unable to read workbook'));
  reader.readAsDataURL(file);
 });
 return {source,name:file.name};
}
function ExcelWorkflow({apiRequest,category,options,filename,onSuccess}:{
 apiRequest:Api;category:'records'|'ribbon';options:Record<string,unknown>;filename:string;onSuccess?:()=>void;
}){
 const [file,setFile]=useState<{source:string;name:string}|null>(null);
 const [validation,setValidation]=useState<Report|null>(null);
 const [execution,setExecution]=useState<Report|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const report=execution??validation;
 const exportSheet=async()=>{
  setBusy(true);setError('');setNotice('');
  try{
   const result=await apiRequest<{workbook:string;filename?:string;count?:number;total?:number;truncated?:boolean}>(
    '/data-loader/'+category+'/export',{method:'POST',body:JSON.stringify(options)});
   saveXlsx(result.workbook,result.filename??filename);
   setNotice('Downloaded '+(result.filename??filename)+'.');
   if(result.truncated)setError('Export contains '+result.count+' of '+result.total+
    ' records (the maximum per file). The workbook is incomplete; do not treat it as a full backup.');
  }catch(e){setError(e instanceof Error?e.message:'Export failed');}
  finally{setBusy(false);}
 };
 const validate=async()=>{
  if(!file)return;
  setBusy(true);setError('');setValidation(null);setExecution(null);
  try{
   const result=await apiRequest<Report>('/data-loader/'+category+'/validate',{
    method:'POST',body:JSON.stringify({...options,workbook:file.source})});
   setValidation(result);
  }catch(e){setError(e instanceof Error?e.message:'Validation failed');}
  finally{setBusy(false);}
 };
 const execute=async()=>{
  if(!file||!validation?.digest)return;
  setBusy(true);setError('');
  try{
   const result=await apiRequest<Report>('/data-loader/'+category+'/execute',{
    method:'POST',body:JSON.stringify({...options,workbook:file.source,
     digest:validation.digest,confirmation:'PROCEED_EXCLUDING_ERRORS'})});
   setExecution(result);onSuccess?.();
  }catch(e){setError(e instanceof Error?e.message:'Execution failed');}
  finally{setBusy(false);}
 };
 return <section className="surface" style={{padding:22,borderRadius:12}}>
  <div className="section-toolbar">
   <div><h3>Download, edit and re-upload Excel</h3>
    <p>Keep the exported API names. Upload validation makes no changes.</p></div>
   <button className="btn" type="button" disabled={busy} onClick={()=>void exportSheet()}>
    <Download size={16}/> Download current workbook
   </button>
  </div>
  {notice&&<p role="status">{notice}</p>}
  <label className="form-label">Upload edited Excel workbook
   <input className="form-control" type="file" accept=".xlsx" aria-label="Choose Excel workbook" style={{minWidth:0,maxWidth:'100%',width:'100%',boxSizing:'border-box'}}
    onChange={event=>{
     setValidation(null);setExecution(null);setFile(null);setError('');
     void loadXlsx(event).then(v=>setFile(v)).catch(e=>setError(e instanceof Error?e.message:'Cannot read file'));
    }}/>
  </label>
  {file&&<p>Selected: <strong>{file.name}</strong></p>}
  <div className="toolbar-actions" style={{marginTop:10}}>
   <button type="button" className="btn btn-brand" disabled={busy||!file} aria-describedby={!file?'data-loader-validate-hint':undefined} onClick={()=>void validate()}>
    <Upload size={15}/> Validate first
   </button>
  </div>
  {!file&&<small id="data-loader-validate-hint">Choose an exported workbook to enable validation.</small>}
  {error&&<p role="alert" style={{color:'#b42318'}}><AlertTriangle size={16}/> {error}</p>}
  {report&&<section className="metadata-card" style={{marginTop:18}}>
   <h3>{execution?'Execution report':'Validation results'}</h3>
   <div style={{display:'flex',gap:18,flexWrap:'wrap'}}>
    <span>Total: {report.summary.total}</span><span>Valid: {report.summary.valid}</span>
    <span>Success: {report.summary.success}</span><span>Errors: {report.summary.error}</span>
    <span>Skipped: {report.summary.skipped}</span>
   </div>
   <div className="table-scroll" style={{maxHeight:330,overflow:'auto',marginTop:12}}>
    <table className="slds-table"><thead><tr>
     <th>Excel Row</th><th>Action</th><th>Status</th><th>Result</th><th>Error / Message</th>
    </tr></thead>
     <tbody>{report.rows.map((row,i)=><tr key={row.excelRow+'-'+i}>
      <td>{row.excelRow}</td><td>{row.action??row.cells?.Action??'Upsert'}</td>
      <td>{row.status}</td><td>{row.result}</td><td>{row.message}</td>
     </tr>)}</tbody>
    </table>
   </div>
   <div className="toolbar-actions" style={{marginTop:14,display:'flex',flexWrap:'wrap',gap:10}}>
    {!execution&&<button type="button" className="btn btn-brand" disabled={busy||!validation?.summary.valid}
     onClick={()=>void execute()}><CheckCircle2 size={15}/>
      Proceed excluding error rows ({validation?.summary.valid??0})</button>}
    <button type="button" className="btn" onClick={()=>{
     saveXlsx(report.report,execution?category+'_Execution_Report.xlsx':category+'_Validation_Report.xlsx');
     if(!execution){setValidation(null);}
    }}><Download size={15}/>{execution?'Download final report':'Cancel & download error report'}</button>
    {!execution&&<button type="button" className="btn" onClick={()=>{setValidation(null);setExecution(null);}}>
     Cancel without changes</button>}
   </div>
  </section>}
  <small>Metadata and record writes retain OneEngine permissions. Only successful rows are changed.</small>
 </section>;
}
export default function UniversalDataLoaderWorkspace({apiRequest,objects,onMetadataChanged}:{
 apiRequest:Api;objects:ObjectInfo[];onMetadataChanged?:()=>void;
}){
 const [tab,setTab]=useState<'objects'|'records'|'ribbon'>('objects');
 const [objectList,setObjectList]=useState(objects);
 useEffect(()=>setObjectList(objects),[objects]);
 const [objectApi,setObjectApi]=useState('');
 const [externalField,setExternalField]=useState('');
 const [componentApi,setComponentApi]=useState('smart_cart');
 const active=useMemo(()=>objectList.find(x=>x.apiName===objectApi)??objectList[0],
  [objectApi,objectList]);
 const selectedObject=active?.apiName??'';
 const externalIds=active?.fields.filter(f=>f.externalId)??[];
 return <div className="object-manager surface" aria-label="Universal Data Loader" style={{padding:24}}>
  <div className="section-toolbar">
   <div><h1>Universal Data Loader</h1>
    <p>Export, edit, validate and upsert Object Metadata, Records or Smart Ribbon Properties.</p></div>
  </div>
  <nav role="tablist" aria-label="Data Loader categories" style={{display:'flex',gap:8,flexWrap:'nowrap',overflowX:'auto',width:'calc(100% - 48px)',maxWidth:1052,marginLeft:24,marginBottom:18,paddingBlock:4,scrollSnapType:'x mandatory'}}>
   {([
    ['objects','Objects & Fields',Database],
    ['records','Records',Table2],
    ['ribbon','Smart Component Property Library',SlidersHorizontal]
   ] as const).map(([key,label,Icon])=><button key={key} type="button"
    className={tab===key?'btn btn-brand':'btn'} role="tab" aria-selected={tab===key} aria-controls={'data-loader-panel-'+key} id={'data-loader-tab-'+key}
    tabIndex={tab===key?0:-1} style={{flexShrink:0,minHeight:44,scrollSnapAlign:'start'}}
    onKeyDown={event=>{const keys=['objects','records','ribbon'] as const;const index=keys.indexOf(key);const next=event.key==='ArrowRight'?keys[(index+1)%keys.length]:event.key==='ArrowLeft'?keys[(index+keys.length-1)%keys.length]:undefined;if(next){event.preventDefault();setTab(next);document.getElementById('data-loader-tab-'+next)?.focus();}}}
    onPointerUp={event=>{if(event.pointerType==='mouse')setTab(key);}}
    onClick={()=>setTab(key)}><Icon size={16}/>{label}</button>)}
  </nav>
  <div id={"data-loader-panel-"+tab} role="tabpanel" aria-labelledby={"data-loader-tab-"+tab} style={{maxWidth:1100,minWidth:0}}>
   {tab==='objects'&&<UniversalMetadataLoader inline apiRequest={apiRequest}
    currentObject={selectedObject} availableObjects={objectList}
    onObjectChange={apiName=>{setObjectApi(apiName);setExternalField('');}}
    onClose={()=>{}} onChanged={()=>{
     void apiRequest<{objects:ObjectInfo[]}>('/metadata/objects').then(result=>setObjectList(result.objects.filter(o=>o.apiName!=='User')));
     onMetadataChanged?.();
    }}/>}
   {tab==='records'&&<>
    <section className="metadata-card" style={{marginBottom:16}}>
     <h2>Record Data</h2>
     <label className="form-label">Choose object
      <select className="form-control" value={selectedObject} onChange={e=>{setObjectApi(e.target.value);setExternalField('');}}>
       {objectList.map(o=><option key={o.apiName} value={o.apiName}>{o.label} ({o.apiName})</option>)}
      </select>
     </label>
     <label className="form-label">Upsert matching
      <select className="form-control" value={externalField} onChange={e=>setExternalField(e.target.value)}>
       <option value="">By record Id; rows without Id create new records</option>
       {externalIds.map(f=><option key={f.apiName} value={f.apiName}>External ID — {f.label} ({f.apiName})</option>)}
      </select>
     </label>
     <p>Leave Id blank to create a record, or choose an External ID to match existing records.
      Blank update cells keep their value; use <code>&lt;CLEAR&gt;</code> to clear a nullable field.
      Read-only fields cannot be written.</p>
    </section>
    {selectedObject&&<ExcelWorkflow key={'records:'+selectedObject+':'+externalField}
     apiRequest={apiRequest} category="records" options={{objectApi:selectedObject,externalIdField:externalField}}
     filename={selectedObject+'_Records.xlsx'}/>}
   </>}
   {tab==='ribbon'&&<>
    <section className="metadata-card" style={{marginBottom:16}}>
     <h2>Smart Ribbon Property Visibility</h2>
     <label className="form-label">Component API
      <input className="form-control" value={componentApi} onChange={e=>setComponentApi(e.target.value)}
       placeholder="Leave blank to download all Smart Components"/>
     </label>
     <p>Download registered property rows, change <strong>Enabled</strong> to TRUE or FALSE,
      then upload. For example <code>smart_cart</code> + <code>selectedRowBorderColor</code>
      + <code>FALSE</code> hides the selected-row border color control in the ribbon.
      It does not remove saved page data or change Design 2 slot positions.</p>
    </section>
    <ExcelWorkflow key={'ribbon:'+componentApi} apiRequest={apiRequest} category="ribbon"
     options={{componentApi:componentApi.trim()}} filename="Smart_Ribbon_Properties.xlsx"/>
   </>}
  </div>
 </div>;
}
