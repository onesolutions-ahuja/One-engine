import {useEffect,useState} from 'react';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Seeder={id:string;label:string;description:string;objectCount:number};
type Preview={seedId:string;missingObjects:string[];missingFields:string[];unresolvedReferences:string[];upToDate:boolean;provisioningOnly?:boolean;status?:string;createdObjects?:string[];createdFields?:string[]};

/** Platform-controlled, metadata-only seeder UI. Tenant selection is made in Tenant Management. */
export default function SeederManager({request,tenantId}:{request:Request;tenantId:string}) {
 const [seeders,setSeeders]=useState<Seeder[]>([]);
 const [seedId,setSeedId]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const base='/platform/tenants/'+encodeURIComponent(tenantId)+'/seeders/';
 useEffect(()=>{
  let active=true;
  request<{seeders:Seeder[]}>('/platform/seeders').then(result=>{
   if(active){setSeeders(result.seeders);setSeedId(result.seeders[0]?.id??'');}
  }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load seeders');});
  return ()=>{active=false;};
 },[request,tenantId]);
 useEffect(()=>{
  if(!seedId){setPreview(null);return;}
  let active=true;
  setPreview(null);setError('');setNotice('');
  request<Preview>(base+encodeURIComponent(seedId)+'/preview')
   .then(result=>{if(active)setPreview(result);})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to preview seeder');});
  return ()=>{active=false;};
 },[request,base,seedId]);
 async function apply(){
  if(!preview||busy||preview.upToDate||preview.provisioningOnly||preview.unresolvedReferences.length)return;
  if(!window.confirm('Create missing metadata for tenant '+tenantId+' using '+seedId+'? Existing definitions will be preserved.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await request<Preview>(base+encodeURIComponent(seedId)+'/apply',{method:'POST'});
   setPreview(result);
   setNotice('Created '+(result.createdObjects?.length??0)+' objects and '+(result.createdFields?.length??0)+' fields. Existing metadata was unchanged.');
  }catch(e){setError(e instanceof Error?e.message:'Seeder failed');}
  finally{setBusy(false);}
 }
 return <section className="tenant-seeder-manager" aria-label="Seeder Manager">
  <h2>Seeder Manager</h2>
  <p>Selected tenant: <strong>{tenantId}</strong>. Select another tenant from the Tenant Management list to switch targets.</p>
  <label className="form-label">Available seeder
   <select className="form-control" value={seedId} onChange={event=>setSeedId(event.target.value)}>
    {seeders.map(seed=><option key={seed.id} value={seed.id}>{seed.label}</option>)}
   </select>
  </label>
  {seeders.find(x=>x.id===seedId)&&<p>{seeders.find(x=>x.id===seedId)?.description}</p>}
  {error&&<p role="alert" className="error-text">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {preview&&<>
   <h3>{preview.provisioningOnly?'Provisioning status':'Dry-run preview'}</h3>
   {preview.status&&<p role="status">{preview.status}</p>}
   {!preview.provisioningOnly&&<p>{preview.missingObjects.length} missing objects · {preview.missingFields.length} missing fields</p>}
   {preview.missingObjects.length>0&&<details open><summary>Objects to create</summary><ul>{preview.missingObjects.map(x=><li key={x}>{x}</li>)}</ul></details>}
   {preview.missingFields.length>0&&<details><summary>Fields to create</summary><ul>{preview.missingFields.map(x=><li key={x}>{x}</li>)}</ul></details>}
   {preview.unresolvedReferences.length>0&&<p role="alert">Missing reference targets: {preview.unresolvedReferences.join(', ')}. Apply is disabled until dependencies exist.</p>}
   {preview.upToDate&&!preview.provisioningOnly&&<p role="status">Already up to date. No changes needed.</p>}
   {!preview.provisioningOnly&&<div className="modal-actions"><button type="button" className="btn btn-brand" disabled={busy||preview.upToDate||preview.unresolvedReferences.length>0} onClick={()=>void apply()}>{busy?'Applying…':'Apply missing metadata'}</button></div>}
  </>}
 </section>;
}
