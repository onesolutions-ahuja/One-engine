import {useState} from 'react';
import type {ReportFolderMetadata,ReportMetadata,ReportRunMetadata} from '../../metadata/Definitions/metadata';
import {FileText,Play,RefreshCw} from 'lucide-react';

/** Read-only report runtime: deliberately has no save, clone, delete or schema editors. */
export default function ReportReadOnlyView({reports,folders,onRun}:{
  reports:ReportMetadata[];
  folders:ReportFolderMetadata[];
  onRun:(apiName:string,filters?:any[],offset?:number,limit?:number)=>Promise<ReportRunMetadata>;
}){
  const [selected,setSelected]=useState('');
  const [result,setResult]=useState<ReportRunMetadata|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const active=reports.find(report=>report.apiName===selected)??reports[0];
  const run=async(apiName:string,offset=0)=>{
    setSelected(apiName);setBusy(true);setError('');
    try{setResult(await onRun(apiName,[],offset,100));}
    catch(e){setResult(null);setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const shown=result?.report.apiName===active?.apiName?result:null;
  const columns=shown?.report.fieldApiNames??[];
  const cell=(value:unknown)=>value===null||value===undefined?'—':
    typeof value==='object'?JSON.stringify(value):String(value);
  return <section className="report-page" aria-label="Reports View">
    <div className="report-titlebar"><div className="back-title"><div className="eyebrow">Analytics / Reports View</div><h1>Reports</h1></div></div>
    <div className="report-builder-layout md-builder-frame">
      <aside className="report-outline" aria-label="Available reports">
        {reports.length===0&&<p>No reports are shared with your account.</p>}
        {reports.map(report=><button className={active?.apiName===report.apiName?'outline-field selected':'outline-field'}
          key={report.apiName} type="button" onClick={()=>void run(report.apiName)}>
          <FileText size={14}/><span>{report.label}</span>
          <small>{folders.find(folder=>folder.id===report.folderId)?.label??report.folderName??''}</small>
        </button>)}
      </aside>
      <div className="report-preview">
        {active&&<div className="report-toolbar">
          <strong>{active.label}</strong>
          <button className="btn btn-brand" disabled={busy} type="button" onClick={()=>void run(active.apiName)}>
            {busy?<RefreshCw size={14}/>:<Play size={14}/>} {busy?'Running…':'Run report'}
          </button>
        </div>}
        {error&&<p role="alert">{error}</p>}
        {active&&!shown&&!busy&&<p>Choose Run report to view the permitted records.</p>}
        {shown&&<><p role="status">{shown.totalRows} records · {shown.generatedAt}</p>
          <div className="slds-table-container" style={{overflowX:'auto'}}>
            <table className="slds-table"><thead><tr>
              {columns.map(col=><th key={col} scope="col">{col}</th>)}
            </tr></thead><tbody>
              {shown.rows.map((row,i)=><tr key={i}>{columns.map(col=>
                <td key={col}>{cell(row[col])}</td>)}</tr>)}
            </tbody></table>
          </div>
          <div className="toolbar-actions">
            <button className="btn" disabled={busy||shown.offset===0}
              onClick={()=>void run(active!.apiName,Math.max(0,shown.offset-100))}>Previous</button>
            <span>{shown.rows.length?shown.offset+1:0}–{shown.offset+shown.rows.length} of {shown.totalRows}</span>
            <button className="btn" disabled={busy||shown.offset+shown.rows.length>=shown.totalRows}
              onClick={()=>void run(active!.apiName,shown.offset+100)}>Next</button>
          </div>
        </>}
      </div>
    </div>
  </section>;
}
