import {useEffect,useState} from 'react';
import {loadDevices,makeDefault,type NamedDevice} from './NamedDevices';
import './NamedDevices.css';

/** Company Settings → Payments: which card reader the till's Card button uses.
 * The choice is the Default flag on Named Devices, so CALLOUT finds it with no formula input.
 * With one active reader nothing needs choosing: it is used automatically. */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export default function PaymentDefaults({request}:{request:Request}){
 const [devices,setDevices]=useState<NamedDevice[]>([]);
 const [qr,setQr]=useState<string[]>([]);
 const [status,setStatus]=useState('');
 const reload=async()=>{
  try{setDevices((await loadDevices(request)).filter(item=>item.Active&&item.DeviceType==='Card Reader'));}
  catch(e){setStatus(e instanceof Error?e.message:String(e));}
 };
 useEffect(()=>{
  void reload();
  void request<Array<{apiName:string}>>('/action-formulas/callouts').then(items=>setQr([...new Set((Array.isArray(items)?items:[])
   .filter(item=>/\.CreateOrder$/.test(item.apiName)&&item.apiName.startsWith('PayPal')).map(item=>item.apiName.split('.')[0]))]))
   .catch(()=>setQr([]));
 },[request]);
 const current=devices.find(item=>item.IsDefault)??(devices.length===1?devices[0]:undefined);
 return <section className="company-workspace-card md-payment-defaults" aria-label="Payments">
  <h2>Payments</h2>
  <label>Default card reader
   <select value={current?.Id??''} disabled={devices.length<2} onChange={async e=>{
    const chosen=devices.find(item=>item.Id===e.target.value);
    if(!chosen)return;
    try{await makeDefault(request,devices,chosen);setStatus('Saved.');await reload();}
    catch(error){setStatus(error instanceof Error?error.message:String(error));}
   }}>
    {devices.length===0&&<option value="">No card reader yet</option>}
    {devices.length>1&&!current&&<option value="">Choose…</option>}
    {devices.map(item=><option key={item.Id} value={item.Id}>{item.Name} ({String(item.Connector).replace(/Connector$/,'')})</option>)}
   </select></label>
  <p>{devices.length===1?'Only one card reader, so it is used automatically.':'Add or pair card readers in Setup → Named Devices.'}</p>
  <p>QR payments: {qr.length?qr.join(', ')+' installed':'install the PayPal Connector from AppExchange'}.</p>
  {status&&<p role="status">{status}</p>}
 </section>;
}
