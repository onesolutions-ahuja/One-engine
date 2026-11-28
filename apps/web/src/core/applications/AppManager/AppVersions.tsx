import {Fragment,useEffect,useState} from 'react';
import {listAppVersions,publishAppVersion,type AppVersion} from '../../builders/PageBuilder/editor/management/appVersions';
import './AppVersions.css';

/** App Manager > Versions: the last 10 saves of the app. Green = published, red = has broken
 * links (cannot be published). Publish makes that version's pages live. */
export default function AppVersions({appApiName,request}:{
 appApiName:string;request:<T>(path:string,init?:RequestInit)=>Promise<T>;
}){
 const [versions,setVersions]=useState<AppVersion[]|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(0);
 const [open,setOpen]=useState(0);
 useEffect(()=>{
  let active=true;
  setVersions(null);setError('');
  listAppVersions(request,appApiName).then(rows=>{if(active)setVersions(rows);})
   .catch(failure=>{if(active){setVersions([]);setError(failure instanceof Error?failure.message:'Unable to load versions');}});
  return ()=>{active=false;};
 },[appApiName,request]);
 const publish=async(version:number)=>{
  setBusy(version);setError('');
  try{setVersions(await publishAppVersion(request,appApiName,version));}
  catch(failure){setError(failure instanceof Error?failure.message:'Unable to publish this version');}
  finally{setBusy(0);}
 };
 const when=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?'':date.toLocaleString();};
 if(versions===null)return <p className="permission-help" role="status">Loading versions…</p>;
 return <div className="app-versions">
  <p className="permission-help">Every Save in Page Builder is a version of the whole app. The last 10 are kept (and always the published one).</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!versions.length?<p className="permission-help">No versions yet. Save the app in Page Builder to create one.</p>:
  <table className="app-versions-table">
   <thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Created by</th><th>Last modified</th><th>Modified by</th><th/></tr></thead>
   <tbody>{versions.map(item=><Fragment key={item.version}>
    <tr className={item.published?'is-published':item.errorCount?'has-errors':undefined}>
     <td>v{item.version} <small>{item.pages} page{item.pages===1?'':'s'}</small></td>
     <td>{item.published?<span className="app-version-badge published">Published</span>
      :item.errorCount?<button type="button" className="app-version-badge errors" aria-expanded={open===item.version}
        onClick={()=>setOpen(current=>current===item.version?0:item.version)}>
        {item.errorCount} broken link{item.errorCount===1?'':'s'}</button>
      :<span className="app-version-badge saved">Saved</span>}</td>
     <td>{when(item.createdAt)}</td><td>{item.createdBy||'—'}</td>
     <td>{when(item.modifiedAt)}</td><td>{item.modifiedBy||'—'}</td>
     <td><button type="button" className="btn btn-small" disabled={item.published||item.errorCount>0||busy>0}
      title={item.errorCount?'Fix the broken links, save, then publish the new version':item.published?'Already published':'Make this version live'}
      onClick={()=>void publish(item.version)}>{busy===item.version?'Publishing…':'Publish'}</button></td>
    </tr>
    {open===item.version&&item.errors.length>0&&<tr className="app-version-errors">
     <td colSpan={7}><ul>{item.errors.map((line,index)=><li key={index}>{line}</li>)}</ul></td></tr>}
   </Fragment>)}</tbody>
  </table>}
 </div>;
}
