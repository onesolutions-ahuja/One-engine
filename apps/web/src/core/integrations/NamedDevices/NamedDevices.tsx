import {useCallback,useEffect,useMemo,useState} from 'react';
import {browserSupports,findLocalDevice} from './deviceAccess';
import './NamedDevices.css';

/** Setup → Named Devices. One list for card readers reached through a connector (Cloud API)
 * and local devices on USB, Bluetooth, serial or the network. Uses the normal Record API,
 * so Profiles and Permission Sets decide who can see or change devices. */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type NamedDevice={Id?:string;Name:string;DeviceType:string;Connection:string;Connector:string;
 DeviceId:string;Address:string;IsDefault:boolean;Active:boolean;Notes:string};
type Callout={apiName:string;label:string;fields?:string[];outputs?:string[]};
const TYPES=['Card Reader','Receipt Printer','Label Printer','Cash Drawer','Barcode Scanner','Customer Display','Scale','Other'];
const CONNECTIONS=['Cloud API','USB','Bluetooth','Network','Serial'];
const blank:NamedDevice={Name:'',DeviceType:'Card Reader',Connection:'Cloud API',Connector:'',DeviceId:'',
 Address:'',IsDefault:false,Active:true,Notes:''};
const FIELDS=['Name','DeviceType','Connection','Connector','DeviceId','Address','IsDefault','Active','Notes'] as const;
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

export async function loadDevices(request:Request):Promise<NamedDevice[]>{
 const result=await request<{records?:NamedDevice[]}>('/records/NamedDevice?limit=200');
 return Array.isArray(result.records)?result.records:[];
}
/** Only one default per device type (and per connector for card readers). */
export async function makeDefault(request:Request,devices:readonly NamedDevice[],chosen:NamedDevice){
 for(const other of devices){
  if(!other.Id||other.Id===chosen.Id||!other.IsDefault||other.DeviceType!==chosen.DeviceType)continue;
  await request('/records/NamedDevice/'+encodeURIComponent(other.Id),{method:'PUT',body:JSON.stringify({IsDefault:false})});
 }
 if(chosen.Id)await request('/records/NamedDevice/'+encodeURIComponent(chosen.Id),{method:'PUT',body:JSON.stringify({IsDefault:true})});
}

export default function NamedDevices({request,canManage=true}:{request:Request;canManage?:boolean}){
 const [devices,setDevices]=useState<NamedDevice[]>([]);
 const [callouts,setCallouts]=useState<Callout[]>([]);
 const [draft,setDraft]=useState<NamedDevice|null>(null);
 const [status,setStatus]=useState('');
 const [error,setError]=useState('');
 const [pairing,setPairing]=useState<{code:string;id:string}|null>(null);
 const [busy,setBusy]=useState(false);
 const reload=useCallback(async()=>{
  try{setDevices(await loadDevices(request));setError('');}catch(e){setError(message(e));}
 },[request]);
 useEffect(()=>{
  void reload();
  void request<Callout[]>('/action-formulas/callouts').then(items=>setCallouts(Array.isArray(items)?items:[])).catch(()=>setCallouts([]));
 },[reload,request]);
 const connectors=useMemo(()=>[...new Set(callouts.map(item=>item.apiName.split('.')[0]))].sort(),[callouts]);
 const has=(connector:string,operation:string)=>callouts.some(item=>item.apiName===connector+'.'+operation);
 const callout=(operation:string,values:Record<string,unknown>)=>request<Record<string,unknown>>('/action-formulas/callout',
  {method:'POST',body:JSON.stringify({operation,values})});
 const edit=(patch:Partial<NamedDevice>)=>setDraft(current=>current?{...current,...patch}:current);

 async function find(){
  if(!draft)return;
  setBusy(true);setError('');setStatus('');
  try{
   if(draft.Connection==='Cloud API'){
    const c=draft.Connector;
    if(!c)throw Error('Choose the connector first');
    if(pairing&&has(c,'GetPairing')){
     // Square-style: the code was typed on the terminal; now read the device ID.
     const result=await callout(c+'.GetPairing',{PairingId:pairing.id});
     if(!result.DeviceId)throw Error('Not paired yet. Enter code '+pairing.code+' on the terminal, then try again.');
     edit({DeviceId:String(result.DeviceId)});setPairing(null);setStatus('Paired.');
    }else if(has(c,'PairReader')){
     const code=has(c,'GetPairing')?'':window.prompt('Enter the pairing code shown on the reader')??'';
     if(!has(c,'GetPairing')&&!code)return;
     const result=await callout(c+'.PairReader',{PairingCode:code,Name:draft.Name||'Till reader'});
     if(result.DeviceId){edit({DeviceId:String(result.DeviceId)});setStatus('Paired.');}
     else if(result.PairingCode){
      setPairing({code:String(result.PairingCode),id:String(result.PairingId??'')});
      setStatus('Enter code '+String(result.PairingCode)+' on the terminal, then press Find / pair again.');
     }
    }else{
     const list=['ListTerminals','ListReaders'].find(operation=>has(c,operation));
     if(!list)throw Error(c+' has no pairing or terminal list yet. Type the Device ID.');
     const result=await callout(c+'.'+list,{});
     if(!result.DeviceId)throw Error('No terminal found. Check the terminal is on and linked to this account.');
     edit({DeviceId:String(result.DeviceId),Name:draft.Name||String(result.Name??'')});setStatus('Found '+String(result.Name??result.DeviceId)+'.');
    }
   }else{
    const found=await findLocalDevice(draft.Connection);
    edit({Address:found.address,Name:draft.Name||found.name});setStatus('Found '+found.name+'.');
   }
  }catch(e){setError(message(e));}finally{setBusy(false);}
 }
 async function save(){
  if(!draft)return;
  if(!draft.Name.trim()){setError('Enter a name');return;}
  if(draft.Connection==='Cloud API'&&(!draft.Connector||!draft.DeviceId)){setError('Choose the connector and pair or type the Device ID');return;}
  setBusy(true);setError('');
  try{
   const Id=draft.Id;
   const values=Object.fromEntries(FIELDS.map(field=>[field,draft[field]]));
   const saved=Id
    ?await request<{record:NamedDevice}>('/records/NamedDevice/'+encodeURIComponent(Id),{method:'PUT',body:JSON.stringify(values)})
    :await request<{record:NamedDevice}>('/records/NamedDevice',{method:'POST',body:JSON.stringify(values)});
   const record={...draft,...(saved.record??{})};
   if(record.IsDefault)await makeDefault(request,devices,record);
   setDraft(null);setPairing(null);setStatus('Saved.');
   await reload();
  }catch(e){setError(message(e));}finally{setBusy(false);}
 }
 async function remove(device:NamedDevice){
  if(!device.Id||!window.confirm('Remove '+device.Name+'?'))return;
  try{await request('/records/NamedDevice/'+encodeURIComponent(device.Id),{method:'DELETE'});await reload();}
  catch(e){setError(message(e));}
 }
 const cloud=draft?.Connection==='Cloud API';
 return <section className="setup-card md-named-devices" aria-label="Named Devices">
  <header className="md-named-devices-head">
   <div><h1>Named Devices</h1>
    <p>Card readers, printers, cash drawers, scanners and customer screens. Card readers use an installed connector; other devices connect by USB, Bluetooth, serial or network.</p></div>
   {canManage&&<button type="button" className="btn btn-brand" onClick={()=>{setDraft({...blank});setPairing(null);setStatus('');setError('');}}>New device</button>}
  </header>
  {error&&<p role="alert" className="md-named-devices-error">{error}</p>}
  {status&&!error&&<p role="status" className="md-named-devices-status">{status}</p>}
  {draft&&<div className="md-named-devices-form" role="group" aria-label="Device details">
   <label>Name<input value={draft.Name} onChange={e=>edit({Name:e.target.value})} placeholder="Front till reader"/></label>
   <label>Device type<select value={draft.DeviceType} onChange={e=>edit({DeviceType:e.target.value})}>{TYPES.map(item=><option key={item}>{item}</option>)}</select></label>
   <label>Connection<select value={draft.Connection} onChange={e=>edit({Connection:e.target.value})}>{CONNECTIONS.map(item=><option key={item}>{item}</option>)}</select></label>
   {cloud&&<label>Connector<select value={draft.Connector} onChange={e=>edit({Connector:e.target.value})}>
    <option value="">Choose…</option>{connectors.map(item=><option key={item} value={item+'Connector'}>{item}</option>)}</select></label>}
   {cloud?<label>Device / Reader ID<input value={draft.DeviceId} onChange={e=>edit({DeviceId:e.target.value})}/></label>
    :<label>Address<input value={draft.Address} onChange={e=>edit({Address:e.target.value})} placeholder={draft.Connection==='Network'?'192.168.1.50:9100':'Use Find device'}/></label>}
   <label className="md-named-devices-check"><input type="checkbox" checked={draft.IsDefault} onChange={e=>edit({IsDefault:e.target.checked})}/>Default {draft.DeviceType.toLowerCase()}</label>
   <label className="md-named-devices-check"><input type="checkbox" checked={draft.Active} onChange={e=>edit({Active:e.target.checked})}/>Active</label>
   <div className="md-named-devices-actions">
    {(cloud||browserSupports(draft.Connection))&&<button type="button" className="btn" disabled={busy} onClick={()=>void find()}>
     {cloud?(pairing?'Check pairing':'Find / pair'):'Find device'}</button>}
    <button type="button" className="btn btn-brand" disabled={busy} onClick={()=>void save()}>Save</button>
    <button type="button" className="btn" onClick={()=>{setDraft(null);setPairing(null);}}>Cancel</button>
   </div>
  </div>}
  <table className="slds-table md-named-devices-table">
   <thead><tr><th>Name</th><th>Type</th><th>Connection</th><th>Connector / address</th><th>Default</th><th>Active</th><th/></tr></thead>
   <tbody>{devices.length===0&&<tr><td colSpan={7}>No devices yet.</td></tr>}
    {devices.map(device=><tr key={device.Id}>
     <td>{device.Name}</td><td>{device.DeviceType}</td><td>{device.Connection}</td>
     <td>{device.Connection==='Cloud API'?String(device.Connector??'').replace(/Connector$/,'')+' · '+(device.DeviceId??''):device.Address}</td>
     <td>{device.IsDefault?'Yes':''}</td><td>{device.Active?'Yes':'No'}</td>
     <td className="md-named-devices-row-actions">{canManage&&<>
      <button type="button" className="btn btn-small" onClick={()=>{setDraft({...blank,...device});setPairing(null);}}>Edit</button>
      <button type="button" className="btn btn-small" onClick={()=>void remove(device)}>Remove</button></>}</td>
    </tr>)}</tbody>
  </table>
 </section>;
}
