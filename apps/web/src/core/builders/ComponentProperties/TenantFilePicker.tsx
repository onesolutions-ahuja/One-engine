import {useEffect,useState,type ChangeEvent} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';

type Asset={id:string;name:string;contentType:string;size:number;assetRef:string};
const asset=/^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supported=new Set(['application/pdf','image/jpeg','image/png','image/gif','image/webp']);
const maxBytes=5*1024*1024;
export default function TenantFilePicker({value,onChange,disabled=false}:{
 value:string;onChange:(assetRef:string)=>void;disabled?:boolean
}){
 const [assets,setAssets]=useState<Asset[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [opened,setOpened]=useState(false);
 const reload=async()=>setAssets((await apiRequest<{assets:Asset[]}>('/media-assets'))
  .assets.filter(item=>supported.has(item.contentType)));
 useEffect(()=>{if(opened)void reload().catch(e=>setError(e instanceof Error?e.message:'Unable to list files'));},[opened]);
 const upload=async(event:ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(!supported.has(file.type)||!file.size||file.size>maxBytes){
   setError('Choose a PDF or image up to 5 MB.');return;
  }
  setBusy(true);setError('');
  try{
   const contentBase64=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('File could not be read'));
    reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
    reader.readAsDataURL(file);
   });
   const saved=await apiRequest<Asset>('/media-assets',{method:'POST',body:JSON.stringify({
    name:file.name,contentType:file.type,contentBase64
   })});
   await reload();onChange(saved.assetRef);
  }catch(e){setError(e instanceof Error?e.message:'File upload failed');}
  finally{setBusy(false);}
 };
 const download=async()=>{
  if(!asset.test(value))return;
  setBusy(true);setError('');
  try{
   const data=await apiRequest<{name:string;contentType:string;contentBase64:string}>(
    '/media-assets/'+encodeURIComponent(value.slice(6)));
   if(!supported.has(data.contentType))throw new Error('File type unavailable');
   const bytes=Uint8Array.from(atob(data.contentBase64),c=>c.charCodeAt(0));
   const url=URL.createObjectURL(new Blob([bytes],{type:data.contentType}));
   const link=document.createElement('a');
   link.href=url;link.download=data.name.replace(/[^A-Za-z0-9._ -]/g,'_');
   document.body.appendChild(link);link.click();link.remove();
   window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:'File download failed');}
  finally{setBusy(false);}
 };
 return <div className="metadata-array-property">
  {asset.test(value)&&<small>Selected tenant file: {assets.find(item=>item.assetRef===value)?.name??value.slice(6)}</small>}
  {asset.test(value)&&<button type="button" className="btn btn-small"
    disabled={busy} onClick={()=>void download()}>Download selected file</button>}
  <button type="button" className="btn btn-small" disabled={disabled}
   onClick={()=>setOpened(value=>!value)}>{opened?'Close files':'Choose/upload file'}</button>
  {opened&&<>
   <label className="form-label">Upload tenant-owned file
    <input type="file" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
     disabled={disabled||busy} onChange={e=>void upload(e)}/>
   </label>
   <label className="form-label">Available files
    <select className="form-control" disabled={disabled||busy}
     value={asset.test(value)?value:''} onChange={e=>onChange(e.target.value)}>
      <option value="">Select file</option>
      {assets.map(item=><option value={item.assetRef} key={item.id}>{item.name}</option>)}
    </select>
   </label>
   {busy&&<span role="status">Uploading file…</span>}
   {error&&<div role="alert">{error}</div>}
  </>}
 </div>;
}
