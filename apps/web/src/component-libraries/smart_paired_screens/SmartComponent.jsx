import {convertedFormula} from "../shared/formulaCodeLookup.js";
import {evaluateFieldExpression} from "../shared/FieldExpression.js";
import {hiddenByShowWhen} from "../shared/showWhen.js";

/** Smart Paired Screens: the screens (customer displays, kitchen or order-status screens)
 * paired with this device, for ANY app's settings page. "+ Add display" pairs a screen that
 * shows /display by its 4-digit code. Text Source = the page those screens show (e.g.
 * ="smart_till_customer_display"); Label = the section title. Core does the work through
 * one window event, so this component holds no API code. */
const EVENT="metadrive:paired-screens";
const ask=(action,payload={})=>new Promise((resolve,reject)=>{
 window.dispatchEvent(new CustomEvent(EVENT,{detail:{action,...payload,
  reply:answer=>answer&&answer.ok?resolve(answer.value):reject(new Error(answer?.error||"Screens are unavailable"))}}));
 // No Core listener (e.g. the Page Builder canvas): say so instead of waiting forever.
 setTimeout(()=>reject(new Error("Open this page in the app to manage screens")),15000);
});
const ago=iso=>{
 if(!iso)return "Not opened yet";
 const minutes=Math.max(1,Math.round((Date.now()-Date.parse(iso))/60000));
 return minutes<60?"Offline · "+minutes+" min":"Offline · "+new Date(iso).toLocaleDateString();
};
const SAMPLE=[{id:"a",name:"Counter",online:true},{id:"b",name:"Kitchen",online:false,lastSeenAt:null}];

function pageToShow(p){
 const source=p.textSource;
 const code=p.__formulaCode&&p.__formulaCode.functions instanceof Map?p.__formulaCode.functions:null;
 const run=code&&source?convertedFormula(code,source):null;
 let value="";
 if(run){try{value=run(p.record||{});}catch{value="";}}
 else if(typeof source==="string"&&source)value=evaluateFieldExpression(source,p.record||{},{pageState:p.pageState,sessionId:p.sessionId,readComponent:p.readComponent});
 return String(value??"").replace(/^=?"?|"?$/g,"").trim();
}

export default function SmartComponent(p){
 const preview=Boolean(p.editing||p.designMode||p.builderPreview);
 const [screens,setScreens]=React.useState(preview?SAMPLE:[]);
 const [adding,setAdding]=React.useState(false);
 const [code,setCode]=React.useState("");const [name,setName]=React.useState("");
 const [renaming,setRenaming]=React.useState("");const [newName,setNewName]=React.useState("");
 const [message,setMessage]=React.useState("");const [busy,setBusy]=React.useState(false);
 const page=pageToShow(p);
 const refresh=React.useCallback(()=>{
  if(preview)return;
  ask("list").then(list=>setScreens(Array.isArray(list)?list:[]),error=>setMessage(error.message));
 },[preview]);
 React.useEffect(()=>{
  refresh();
  if(preview)return undefined;
  const timer=setInterval(refresh,15000);
  return ()=>clearInterval(timer);
 },[refresh,preview]);
 if(hiddenByShowWhen(p))return <span data-smart-hidden="true" hidden/>;
 const act=async(work,done)=>{
  if(preview||busy)return;
  setBusy(true);setMessage("");
  try{await work();done?.();refresh();}catch(error){setMessage(error.message);}finally{setBusy(false);}
 };
 const pair=()=>{
  if(!/^\d{4}$/.test(code)){setMessage("Type the 4 digits shown on the screen");return;}
  if(!page){setMessage("Set Text Source to the page the screen shows");return;}
  void act(()=>ask("add",{code,name,page}),()=>{setAdding(false);setCode("");setName("");setMessage("Paired. The screen opens in a moment.");});
 };
 const title=typeof p.label==="string"&&p.label?p.label:"Screens";
 return <section className="smart-paired-screens" aria-label={title}
  style={{background:p.backgroundColor,color:p.labelColor,borderRadius:p.radius,border:p.borderColor?"1px solid "+p.borderColor:undefined}}>
  <header>
   <h3 style={{color:p.headerTextColor,fontSize:p.headerTextSize}}>{title}</h3>
   {!adding&&<button type="button" className="sps-add" onClick={()=>{setAdding(true);setMessage("");}}>+ Add display</button>}
  </header>
  {adding&&<div className="sps-form">
   <p className="sps-help">On the screen open <strong>{typeof window!=="undefined"?window.location.host:""}/display</strong>, then type the code it shows.</p>
   <input className="sps-code" inputMode="numeric" maxLength={4} autoFocus aria-label="4-digit code from the screen"
    placeholder="0000" value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,"").slice(0,4))}
    onKeyDown={event=>{if(event.key==="Enter")pair();}}/>
   <input className="sps-name" maxLength={60} aria-label="Screen name (optional)" placeholder="Name, e.g. Counter"
    value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")pair();}}/>
   <div className="sps-actions">
    <button type="button" onClick={()=>{setAdding(false);setCode("");setName("");setMessage("");}}>Cancel</button>
    <button type="button" className="sps-primary" disabled={busy} onClick={pair}>Pair</button>
   </div>
  </div>}
  {screens.length===0&&!adding&&<p className="sps-empty">No screens yet.</p>}
  <ul>
   {screens.map(screen=><li key={screen.id}>
    <span className={"sps-dot"+(screen.online?" sps-online":"")} aria-hidden="true"/>
    {renaming===screen.id
     ?<input className="sps-name" maxLength={60} autoFocus aria-label={"New name for "+screen.name} value={newName}
       onChange={event=>setNewName(event.target.value)}
       onKeyDown={event=>{if(event.key==="Enter")void act(()=>ask("rename",{id:screen.id,name:newName}),()=>setRenaming(""));
        if(event.key==="Escape")setRenaming("");}}/>
     :<span className="sps-name-text">{screen.name}</span>}
    <span className="sps-status">{screen.online?"Online":ago(screen.lastSeenAt)}</span>
    {renaming===screen.id
     ?<button type="button" onClick={()=>void act(()=>ask("rename",{id:screen.id,name:newName}),()=>setRenaming(""))}>Save</button>
     :<button type="button" onClick={()=>{setRenaming(screen.id);setNewName(screen.name);}}>Rename</button>}
    <button type="button" className="sps-danger" disabled={busy}
     onClick={()=>void act(()=>ask("revoke",{id:screen.id}),()=>setMessage(screen.name+" unpaired."))}>Unpair</button>
   </li>)}
  </ul>
  {message&&<p className="sps-message" role="status">{message}</p>}
 </section>;
}
