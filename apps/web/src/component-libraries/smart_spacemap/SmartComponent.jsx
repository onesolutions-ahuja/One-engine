import {useTenantImageSource} from "../shared/TenantImage.jsx";
import {runComponentFormula} from "../shared/formulaCodeLookup.js";
import {disabledWhen,hiddenByShowWhen} from "../shared/showWhen.js";
import icons from "../smart_icon/iconCatalog.json";

const dimensions={x:0,y:0,width:96,height:72,rotation:0};
const fieldName=value=>String(value??"").split(".").pop();
function geometry(p,row){
 return Object.fromEntries(Object.entries(dimensions).map(([key,fallback])=>{
  const raw=row[fieldName(p[key+"Field"])];
  return [key,raw!=null&&Number.isFinite(Number(raw))?Number(raw):fallback];
 }));
}
export default function SmartComponent(p){
 const image=useTenantImageSource(p.mapBackground==='Image'?p.mapBackgroundAsset:'',p.loadAsset);
 const rows=p.records??p.items??[], edit=p.mapMode==="Edit"&&!p.builderPreview&&!p.previewOnly;
 const viewport=React.useRef(null),gesture=React.useRef(null),timer=React.useRef(null);
 const [draft,setDraft]=React.useState(null),[selected,select]=React.useState(null),[error,setError]=React.useState("");
 const [size,setSize]=React.useState({width:0,height:0});
 React.useEffect(()=>{const el=viewport.current;if(!el)return;
  const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));
  observer.observe(el);return ()=>{observer.disconnect();clearTimeout(timer.current);};},[]);
 const width=Math.max(1,...rows.map(r=>{const g=geometry(p,r);return g.x+g.width;}));
 const height=Math.max(1,...rows.map(r=>{const g=geometry(p,r);return g.y+g.height;}));
 const scale=p.zoomToFit&&size.width&&size.height?Math.min(size.width/width,size.height/height):1;
 const step=Math.max(1,Number(p.gridSize)||1),snap=n=>Math.round(n/step)*step;
 const fire=(event,row)=>{if(!p.previewOnly&&!p.builderPreview)p.onAction?.({event,value:{record:row,recordId:row.Id}});};
 const write=async(method,row,values)=>{
  try{await p.writeMapRecord(method,row?.Id,values);setError("");return true;}
  catch(e){setError(e.message||"Could not save the record");return false;}
 };
 const start=(e,row)=>{
  if(e.button!==0||gesture.current)return;
  e.currentTarget.setPointerCapture(e.pointerId);
  gesture.current={id:row.Id,pointer:e.pointerId,x:e.clientX,y:e.clientY,start:geometry(p,row),mode:e.target.dataset.handle||"move"};
  select(row.Id);
  if(!edit)timer.current=setTimeout(()=>{if(gesture.current){gesture.current.held=true;fire("longPress",row);}},550);
 };
 const move=e=>{
  const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
  const dx=(e.clientX-g.x)/scale,dy=(e.clientY-g.y)/scale;
  if(Math.abs(dx)+Math.abs(dy)<3&&!g.moved)return;
  clearTimeout(timer.current);g.moved=true;if(!edit)return;
  const next={...g.start};
  if(g.mode==="resize"){next.width=Math.max(step,snap(next.width+dx));next.height=Math.max(step,snap(next.height+dy));}
  else if(g.mode==="rotate"){next.rotation=Math.round(next.rotation+dx);}
  else{next.x=Math.max(0,snap(next.x+dx));next.y=Math.max(0,snap(next.y+dy));}
  g.next=next;setDraft({id:g.id,...next});
 };
 const end=async(e,row)=>{
  const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
  clearTimeout(timer.current);gesture.current=null;setDraft(null);
  if(e.type==="pointercancel")return;
  if(!edit){if(!g.held&&!g.moved)fire("click",row);return;}
  if(!g.next)return;
  const values={};
  for(const key of Object.keys(dimensions))if(g.next[key]!==g.start[key]&&p[key+"Field"])
   values[fieldName(p[key+"Field"])]=g.next[key];
  if(Object.keys(values).length&&await write("PUT",row,values))fire("change",{...row,...values});
 };
 const read=(row,key)=>runComponentFormula(p,p[key],row).value;
 if(hiddenByShowWhen(p))return <span data-smart-hidden="true" hidden/>;
 const disabled=p.disabled||disabledWhen(p);
 return <section className="space-map" style={{fontFamily:p.fontFamily}} aria-disabled={disabled||undefined} ref={node=>{if(node)node.inert=Boolean(disabled);}}>
  {edit&&<header><button type="button" onClick={()=>{const name=window.prompt("Item name");if(name)void write("POST",null,{[fieldName(p.labelField)||"Name"]:name});}}>Add item</button>
   <button type="button" disabled={!selected} onClick={()=>{if(window.confirm("Delete selected item?"))void write("DELETE",{Id:selected}).then(ok=>{if(ok)select(null);});}}>Delete item</button></header>}
  {error&&<div role="alert">{error}</div>}
  <div ref={viewport} className="space-map-viewport" data-background={p.mapBackground} style={{backgroundImage:image?"url("+JSON.stringify(image)+")":undefined,backgroundSize:image?"contain":step*scale+"px "+step*scale+"px",backgroundRepeat:image?"no-repeat":undefined}}>
   <div style={{position:"relative",transformOrigin:"0 0",transform:"scale("+scale+")"}}>
    {rows.map(row=>{const g=draft?.id===row.Id?draft:geometry(p,row);
     const shape=row[fieldName(p.shapeField)]||p.mapShape||"Rectangle",icon=icons.find(i=>i.id===p.iconId);
     const badge=read(row,"badgeFormula");
     return <button key={row.Id} type="button" className="space-map-tile" data-shape={shape} aria-pressed={selected===row.Id}
      data-pulse={String(read(row,"pulseWhen")).toLowerCase()==="true"} style={{left:g.x,top:g.y,width:g.width,height:["Square","Round"].includes(shape)?g.width:g.height,
       transform:"rotate("+g.rotation+"deg)",background:read(row,"colourFormula")||p.backgroundColor||"white",color:p.labelColor,
       borderColor:read(row,"borderFormula")||p.borderColor,borderRadius:["Round","Oval"].includes(shape)?"50%":p.radius??10,
       fontSize:p.textSize,boxShadow:p.shadow==="none"?"none":undefined}}
      onPointerDown={e=>start(e,row)} onPointerMove={move} onPointerUp={e=>void end(e,row)} onPointerCancel={e=>void end(e,row)}
      onClick={e=>{if(e.detail===0&&!edit){select(row.Id);fire("click",row);}}}>
      {shape==="Icon"&&icon&&<img alt="" src={"/smart-icons/"+(icon.file||icon.id+".svg")}/>}
      <strong>{row[fieldName(p.labelField)||"Name"]}</strong><small>{row[fieldName(p.subLabelField)]}</small>{badge!==""&&<span>{badge}</span>}
      {edit&&<><i data-handle="resize" title="Resize">↘</i><i data-handle="rotate" title="Rotate">↻</i></>}
     </button>;})}
   </div>
  </div>
 </section>;
}
