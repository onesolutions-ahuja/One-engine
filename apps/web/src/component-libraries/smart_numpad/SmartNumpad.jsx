import {smartShapeAppearance} from "../smart/shared/SmartShapeAppearance.js";
import {applyNumpadKey,normalizeNumpadValue,numpadSettings} from "./numpadValue.mjs";
const size=(value,defaultValue,min=0,max=2000)=>{
 const n=Number(value);
 return Number.isFinite(n)?Math.max(min,Math.min(max,n)):defaultValue;
};
const shadow=value=>value==="large"?"0 8px 20px #0003":value==="medium"?"0 3px 9px #0003":"none";
const labels=["7","8","9","4","5","6","1","2","3","C","0","backspace"];
export default function SmartNumpad({p,fire,sourceValue,buttonLabels}){
 const settings=numpadSettings(p);
 const serial=JSON.stringify(settings);
 const [value,setValue]=React.useState(()=>normalizeNumpadValue(sourceValue,settings));
 const valueRef=React.useRef(value);
 const dirty=React.useRef(false);
 const sourceRef=React.useRef(String(sourceValue??""));
 const [focusedKey,setFocusedKey]=React.useState("");
 const inputRef=React.useRef(null);
 React.useEffect(()=>{
  const incoming=normalizeNumpadValue(sourceValue,settings);
  const prior=sourceRef.current;
  // A newly evaluated formula must not silently replace an actively edited value.
  if(!dirty.current||valueRef.current===prior){
   valueRef.current=incoming;
   setValue(incoming);
   dirty.current=false;
  }
  sourceRef.current=incoming;
 },[sourceValue,serial]);
 const update=(next,event)=>{
  if(p.disabled||p.readonly===true||p.previewOnly===true)return;
  valueRef.current=next;dirty.current=true;setValue(next);
  // The shared Page Runtime publishes the edited value and invokes any
  // configured On Change action once. Never dispatch an unconfigured Flow.
  if(!p.builderPreview&&typeof p.onChange==="function")p.onChange(next);
  else if(p.actionFlows?.change)fire("change",next);
  if(event&&p.actionFlows?.[event])fire(event,next);
 };
 const press=key=>{
  if(p.disabled||p.readonly===true)return;
  const event=key==="C"?"clear":key==="backspace"?"backspace":null;
  update(applyNumpadKey(valueRef.current,key,settings),event);
 };
 const isPin=settings.mode==="pin"||p.numpadMask===true;
 const headerAlign=["left","center","right"].includes(p.headerAlignment)?p.headerAlignment:"right";
 const headerStyle={
  width:p.numpadHeaderWidth?size(p.numpadHeaderWidth,100,50,100)+"%":"100%",height:size(p.headerBoxHeight,60,30,300),
  background:p.headerBodyColor||"#fff",border:"1px solid "+(p.headerBorderColor||"#cbd5e1"),
  borderRadius:size(p.numpadHeaderRadius,8,0,128),boxShadow:shadow(p.numpadHeaderShadow),
  color:p.headerTextColor||"#0f172a",fontSize:size(p.headerTextSize,26,10,96),
  fontWeight:p.headerBold===false?400:700,textAlign:headerAlign,
  minWidth:0,padding:"8px "+(p.numpadSuffix?"42px":"12px")+" 8px "+(p.numpadPrefix?"42px":"12px"),boxSizing:"border-box"
 };
 const baseKey={
  background:p.numpadKeyFill||"#f1f5f9",border:"1px solid "+(p.numpadKeyBorderColor||"#cbd5e1"),
  color:p.numpadKeyTextColor||"#0f172a",fontSize:size(p.numpadKeyTextSize,20,10,96),
  fontWeight:p.numpadKeyBold===true?700:400,
  borderRadius:size(p.numpadKeyRadius,9,0,128),boxShadow:shadow(p.numpadKeyShadow),
  height:size(p.numpadKeyHeight,52,28,200),
  width:p.numpadKeyWidth?size(p.numpadKeyWidth,100,20,400)+"px":"100%",maxWidth:"100%",
  justifySelf:"center",minWidth:0,justifyContent:p.numpadKeyAlignment==="left"?"flex-start":p.numpadKeyAlignment==="right"?"flex-end":"center",
  ...smartShapeAppearance(p.numpadKeyShape||"shape:rectangle",size(p.numpadKeyRadius,9,0,128))
 };
 const focusStyle={
  background:p.numpadFocusedFill||"#dbeafe",
  borderColor:p.numpadFocusedBorderColor||"#2563eb",
  color:p.numpadFocusedTextColor||"#1d4ed8",
  boxShadow:shadow(p.numpadFocusedShadow),
  borderRadius:size(p.numpadFocusedRadius,9,0,128),
  fontSize:size(p.numpadFocusedTextSize,20,10,96),fontWeight:p.numpadFocusedBold===true?700:400
 };
 const sharedButton=(key,label,style,onClick,custom=false)=><button
  key={key} type="button" className="smart-numpad-key"
  disabled={p.disabled===true||p.readonly===true||p.previewOnly===true}
  aria-label={key==="backspace"?"Backspace":key==="C"?"Clear":custom?label:key}
  data-numpad-key={key} data-numpad-custom={custom?"true":undefined}
  data-md-bind={p.builderPreview&&custom?key+"Label":undefined}
  data-md-bind-titles={p.builderPreview&&custom?"Custom button label":undefined}
  onFocus={()=>setFocusedKey(key)} onBlur={()=>setFocusedKey(previous=>previous===key?"":previous)}
  onPointerDown={()=>setFocusedKey(key)} onPointerLeave={()=>setFocusedKey(previous=>previous===key?"":previous)}
  onClick={onClick}
  style={{...style,...(focusedKey===key?focusStyle:{})}}>{label}</button>;
 const bodyStyle={
  background:p.backgroundColor||"transparent",border:p.borderColor?"1px solid "+p.borderColor:"none",
  borderRadius:size(p.radius,12,0,128),boxShadow:shadow(p.shadow),
  gap:size(p.numpadGap,8,0,48),padding:size(p.numpadPadding,10,0,80)
 };
 const customStyle=index=>{
  const prefix="customButton"+index;
  return {
   ...baseKey,
   background:p[prefix+"Fill"]||baseKey.background,
   border:"1px solid "+(p[prefix+"BorderColor"]||p.numpadKeyBorderColor||"#cbd5e1"),
   borderRadius:size(p[prefix+"Radius"],9,0,128),
   height:size(p[prefix+"Height"],52,28,200),
   width:p[prefix+"Width"]?size(p[prefix+"Width"],100,20,400)+"px":"100%",maxWidth:"100%",
   color:p[prefix+"TextColor"]||baseKey.color,
   fontSize:size(p[prefix+"TextSize"],16,10,96),
   fontWeight:p[prefix+"Bold"]===true?700:400,
   boxShadow:shadow(p[prefix+"Shadow"]),
   justifyContent:p[prefix+"Alignment"]==="left"?"flex-start":p[prefix+"Alignment"]==="right"?"flex-end":"center",
   ...smartShapeAppearance(p[prefix+"Shape"]||"shape:rectangle",size(p[prefix+"Radius"],9,0,128))
  };
 };
 return <div className="smart-numpad" style={bodyStyle} aria-label="Numeric keypad">
  <div className="smart-numpad-input-wrap" style={{position:"relative"}}>
   {p.numpadPrefix&&!isPin&&<span className="smart-numpad-prefix" aria-hidden="true">{p.numpadPrefix}</span>}
   <input ref={inputRef} type={isPin?"password":"text"}
    className="smart-numpad-input" style={headerStyle}
    data-md-bind={p.builderPreview?"textSource":undefined}
    data-md-bind-titles={p.builderPreview?"Initial input value":undefined}
    inputMode={settings.mode==="decimal"?"decimal":"numeric"} autoComplete="off"
    aria-label={isPin?"PIN input":"Numpad input"}
    placeholder={String(p.numpadPlaceholder||"Enter number")}
    value={value}
    disabled={p.disabled===true||p.readonly===true||p.previewOnly===true}
    onChange={event=>update(normalizeNumpadValue(event.target.value,settings))}
    onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();
     if(p.actionFlows?.click)fire("click",valueRef.current);}}}/>
   {p.numpadSuffix&&!isPin&&<span className="smart-numpad-suffix" aria-hidden="true">{p.numpadSuffix}</span>}
  </div>
  <div className="smart-numpad-grid" style={{gap:size(p.numpadGap,8,0,48)}}>
   {labels.map(key=>sharedButton(key,key==="backspace"?"⌫":key,baseKey,()=>press(key)))}
  </div>
  <div className="smart-numpad-custom-row" style={{gap:size(p.numpadGap,8,0,48)}}>
   {[1,2,3].filter(index=>p["customButton"+index+"Visible"]!==false).map(index=>sharedButton("customButton"+index,
    String(buttonLabels[index-1]||"Custom "+index),customStyle(index),
    ()=>{const event="customButton"+index;
     if(p.actionFlows?.[event])fire(event,valueRef.current);},true))}
  </div>
 </div>;
}
