import {useEffect,useState,type ChangeEvent} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';

type Asset={id:string;name:string;contentType:string;size:number;assetRef:string};
const safe=/^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxBytes=5*1024*1024;
/** Shared tenant-safe upload service for ribbon direct file selection and library UI. */
export async function uploadTenantImageFile(file:File):Promise<string>{
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)
    ||!file.size||file.size>maxBytes)
    throw new Error('Choose a JPG, PNG, GIF or WebP image up to 5 MB.');
  const contentBase64=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Image could not be read'));
    reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
    reader.readAsDataURL(file);
  });
  const item=await apiRequest<Asset>('/media-assets',{method:'POST',body:JSON.stringify({
    name:file.name,contentType:file.type,contentBase64
  })});
  return item.assetRef;
}
export default function TenantMediaPicker({value,onChange,disabled=false,assetOnly=false,initiallyOpen=false}:{
  value:string;onChange:(value:string)=>void;disabled?:boolean;assetOnly?:boolean;initiallyOpen?:boolean
}) {
  const [assets,setAssets]=useState<Asset[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [opened,setOpened]=useState(initiallyOpen);
  const refresh=async()=>{
    const result=await apiRequest<{assets:Asset[]}>('/media-assets');
    setAssets(result.assets.filter(item=>item.contentType.startsWith('image/')));
  };
  useEffect(()=>{
    if(!opened)return;
    let active=true;
    void apiRequest<{assets:Asset[]}>('/media-assets')
      .then(result=>{if(active)setAssets(result.assets.filter(item=>item.contentType.startsWith('image/')));})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to list images');});
    return()=>{active=false;};
  },[opened]);
  const upload=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    setBusy(true);setError('');
    try{
      const assetRef=await uploadTenantImageFile(file);
      await refresh();
      onChange(assetRef);
    }catch(reason){setError(reason instanceof Error?reason.message:'Image upload failed');}
    finally{setBusy(false);}
  };
  return <div className="metadata-array-property">
    {!assetOnly&&<input className="form-control" value={value} disabled={disabled}
      aria-label="Image URL or selected tenant asset" placeholder="https://… or select an uploaded image"
      onChange={event=>onChange(event.target.value)} />}
    <button type="button" className="btn btn-small" disabled={disabled}
      onClick={()=>setOpened(previous=>!previous)}>
      {opened?'Close media library':'Choose/upload image'}
    </button>
    {safe.test(value)&&<small className="properties-help">Tenant image selected: {value.slice(6)}</small>}
    {opened&&<div className="metadata-array-property">
      <label className="form-label">Upload a tenant-owned image
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          disabled={disabled||busy} onChange={event=>void upload(event)}/>
      </label>
      <label className="form-label">Existing approved images
        <select className="form-control" value={safe.test(value)?value:''}
          disabled={disabled||busy} onChange={event=>onChange(event.target.value)}>
          <option value="">Select an asset</option>
          {assets.map(asset=><option key={asset.id} value={asset.assetRef}>{asset.name}</option>)}
        </select>
      </label>
      {busy&&<span role="status">Saving image…</span>}
      {error&&<div role="alert" className="auth-error">{error}</div>}
    </div>}
  </div>;
}
