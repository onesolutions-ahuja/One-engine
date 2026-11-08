import {useState} from 'react';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import './PageInventoryImportDialog.css';

type Issue={row:number;pageapi?:string;component_type?:string;component_name:string;component_property:string;value?:string;remark:string};
type Preview={valid:boolean;issues:Issue[];changes:number;skipped:number;
 draftRevisions:Record<string,number>;pageCount:number};
type ApplyResult=Preview&{updatedPages:LightningPageMetadata[]};
type Props={
 request:<T>(path:string,init?:RequestInit)=>Promise<T>;
 onClose:()=>void;
 onApplied:(pages:LightningPageMetadata[],changes:number)=>void;
};
const csvEscape=(value:unknown)=>{
 const s=String(value??'');
 return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
};
function downloadErrors(issues:Issue[],name:string){
 const csv=[['row','pageapi','component_type','component_name','propertyid','value','error_remarks'],
  ...issues.map(item=>[item.row,item.pageapi,item.component_type,item.component_name,item.component_property,item.value,item.remark])]
  .map(row=>row.map(csvEscape).join(',')).join('\r\n')+'\r\n';
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const anchor=document.createElement('a');
 anchor.href=url;anchor.download=name+'_inventory_errors.csv';document.body.append(anchor);
 anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function PageInventoryImportDialog({request,onClose,onApplied}:Props){
 const [fileName,setFileName]=useState('');
 const [csv,setCsv]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const loadFile=async(file:File|undefined)=>{
  setCsv('');setFileName(file?.name??'');setPreview(null);setError('');
  if(!file)return;
  if(!file.name.toLowerCase().endsWith('.csv')){setError('Choose a CSV file.');return;}
  if(file.size>1800000){setError('CSV files must be smaller than 1.8 MB.');return;}
  try{setCsv(await file.text());}catch{setError('Unable to read the CSV file.');}
 };
 const validate=async()=>{
  if(!csv||busy)return;
  setBusy(true);setError('');setPreview(null);
  try{
   const result=await request<Preview>(
    '/metadata/pages/inventory/batch/validate',
    {method:'POST',body:JSON.stringify({variant:'Desktop',csv})});
   setPreview(result);
  }catch(failure){setError(failure instanceof Error?failure.message:'Unable to validate the CSV file.');}
  finally{setBusy(false);}
 };
 const apply=async()=>{
  if(!csv||!preview?.valid||!preview.changes||busy)return;
  setBusy(true);setError('');
  try{
   const result=await request<ApplyResult>(
    '/metadata/pages/inventory/batch/apply',
    {method:'POST',body:JSON.stringify({variant:'Desktop',csv,expectedDraftRevisions:preview.draftRevisions})});
   if(!result.valid){setPreview(result);return;}
   if(!Array.isArray(result.updatedPages))throw Error('Server did not return the updated page drafts');
   onApplied(result.updatedPages,result.changes);
  }catch(failure){
   setPreview(null);
   setError(failure instanceof Error?failure.message:'Unable to apply CSV updates. Validate again.');
  }finally{setBusy(false);}
 };
 return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{
  if(event.target===event.currentTarget&&!busy)onClose();
 }}>
  <section className="modal page-inventory-import-dialog" role="dialog" aria-modal="true"
   aria-labelledby="page-inventory-import-title">
   <div className="modal-header">
    <h2 id="page-inventory-import-title">Upload component inventory CSV</h2>
    <button className="btn btn-small" type="button" onClick={onClose} disabled={busy}>Close</button>
   </div>
   <p className="modal-copy">The CSV pageapi column selects each existing page automatically, including multiple pages in one upload.
    Missing pages cause a validation error and are never created. Existing component names update their properties;
    missing component names create instances of installed component types. All pages validate before any change is saved.</p>
   <div className="page-inventory-import-fields">
    <div className="page-inventory-file">
     <p className="page-inventory-help"><strong>Layout column picks Desktop, Tablet, Mobile or Custom drafts · Multiple existing pages supported</strong></p>
     <label className="form-label" htmlFor="page-inventory-csv">Choose CSV file</label>
     <input id="page-inventory-csv" type="file" accept=".csv,text/csv" disabled={busy}
      onChange={e=>void loadFile(e.target.files?.[0])}/>
     <p className="page-inventory-file-name">{fileName||'No file selected'}</p>
     <p className="page-inventory-help">Expected: pageapi, component_type, component_name, propertyid, value, layout (optional), ribbon_tab (optional).
      A blank or missing layout means Desktop. Ribbon Tab is a reference column and ignored during upload.</p>
     <p className="page-inventory-help">Example rows: SAMPLEAPP,smart_card_grid,mygrid,backgroundColor,#ffffff,Custom
      and SMARTTILL,smart_button,PrintBill,label,Print Bill. Every page API must already exist.
      Component types must be installed and existing names must match their current types.</p>
    </div>
   </div>
   {error&&<p className="page-inventory-error" role="alert">{error}</p>}
   {preview&&<div className="page-inventory-validation" aria-live="polite">
    <p className={preview.valid?'page-inventory-valid':'page-inventory-error'}>
     {preview.valid?'Validation passed':'Validation failed'} · {preview.pageCount} page layouts ·
     {' '}{preview.changes} changes or new components · {preview.skipped} blank rows ignored ·
     {' '}{preview.issues.length} errors
    </p>
    {preview.issues.length>0&&<>
     <div className="page-inventory-issue-heading">
      <strong>CSV errors — no changes saved</strong>
      <button className="btn btn-small" type="button" onClick={()=>downloadErrors(preview.issues,'multipage')}>
       Download error report CSV
      </button>
     </div>
     <div className="page-inventory-error-table">
      <table className="records-table">
       <thead><tr><th>Row</th><th>Type</th><th>Component</th><th>Property</th><th>Value</th><th>Error remarks</th></tr></thead>
       <tbody>{preview.issues.map((item,index)=><tr key={index}>
        <td>{item.row}</td><td>{item.component_type||'—'}</td><td>{item.component_name||'—'}</td>
        <td>{item.component_property||'—'}</td><td>{item.value??'—'}</td><td>{item.remark}</td>
       </tr>)}</tbody>
      </table>
     </div>
    </>}
   </div>}
   <div className="modal-actions">
    <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button>
    <button className="btn" type="button" onClick={()=>void validate()}
     disabled={busy||!csv}>{busy?'Checking…':'Validate CSV'}</button>
    <button className="btn btn-brand" type="button" onClick={()=>void apply()}
     disabled={busy||!preview?.valid||!preview.changes}>Apply validated upsert</button>
   </div>
  </section>
 </div>;
}
