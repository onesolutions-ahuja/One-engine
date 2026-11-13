import {applyKeyboardKey,keyboardRows,keyboardSettings,nextShift,shouldAutoCapitalize,startPage} from "./keyboardValue.mjs";

const size=(value,fallback,min=0,max=2000)=>{
 const n=Number(value);
 return Number.isFinite(n)&&value!==""&&value!==null?Math.max(min,Math.min(max,n)):fallback;
};
const shadow=value=>value==="large"?"0 8px 20px #0003":value==="medium"?"0 3px 9px #0003":undefined;
const textTypes=new Set(["","text","search","email","url","tel","password","number"]);
const isEditable=el=>!!el&&el.nodeType===1&&!el.closest?.(".smart-keyboard")&&(
 (el.tagName==="INPUT"&&textTypes.has(String(el.getAttribute("type")||"").toLowerCase())&&!el.readOnly&&!el.disabled)||
 (el.tagName==="TEXTAREA"&&!el.readOnly&&!el.disabled)||el.isContentEditable);

/** Write a value into a page field so its own React onChange and actions run. */
const writeField=(el,key)=>{
 if(el.isContentEditable){
  el.focus();
  if(key==="backspace")document.execCommand("delete");
  else document.execCommand("insertText",false,key==="space"?" ":key==="newline"?"\n":key);
  return el.textContent??"";
 }
 let start=null,end=null;
 // email/number inputs do not expose a selection; edit at the end instead.
 try{start=el.selectionStart;end=el.selectionEnd;}catch{/* no selection API */}
 const next=applyKeyboardKey(el.value,key,start??undefined,end??undefined);
 const proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(proto,"value")?.set?.call(el,next.value);
 try{el.setSelectionRange(next.caret,next.caret);}catch{/* no selection API */}
 el.dispatchEvent(new Event("input",{bubbles:true}));
 return next.value;
};

const focusNextField=from=>{
 const fields=[...document.querySelectorAll("input,textarea,[contenteditable='true']")].filter(isEditable);
 const index=fields.indexOf(from);
 const next=fields[index+1];
 if(next){next.focus();return true;}
 return false;
};

/** iOS-style on-screen keyboard. It types into the text field the user last
 * tapped on the page; with no field it keeps its own value and publishes it
 * through On Change like Smart Numpad does. */
export default function SmartKeyboard({p,fire}){
 const settings=keyboardSettings(p);
 const preview=p.builderPreview===true||p.previewOnly===true;
 const [page,setPage]=React.useState(()=>startPage(settings));
 const [shift,setShift]=React.useState(()=>settings.autoCapitalize&&settings.layout==="text"?"once":"off");
 const [visible,setVisible]=React.useState(!settings.showOnFocus);
 const [pressed,setPressed]=React.useState("");
 const target=React.useRef(null);
 const own=React.useRef("");
 const lastShift=React.useRef(0);
 React.useEffect(()=>{setPage(startPage(settings));},[settings.layout]);
 React.useEffect(()=>{if(!settings.showOnFocus)setVisible(true);},[settings.showOnFocus]);

 // Follow the field the user is typing in. Keys never take focus away from it.
 React.useEffect(()=>{
  if(preview||typeof document==="undefined")return;
  const release=el=>{
   if(el&&el.dataset.smartKeyboardInputmode!==undefined){
    const prior=el.dataset.smartKeyboardInputmode;
    if(prior)el.setAttribute("inputmode",prior);else el.removeAttribute("inputmode");
    delete el.dataset.smartKeyboardInputmode;
   }
  };
  const attach=event=>{
   const el=event.target;
   if(!isEditable(el))return;
   if(target.current!==el)release(target.current);
   target.current=el;
   if(settings.hideDeviceKeyboard&&el.dataset.smartKeyboardInputmode===undefined){
    el.dataset.smartKeyboardInputmode=el.getAttribute("inputmode")||"";
    el.setAttribute("inputmode","none");
   }
   if(settings.showOnFocus)setVisible(true);
   if(settings.autoCapitalize&&settings.layout==="text"&&!el.isContentEditable)
    setShift(s=>s==="lock"?s:shouldAutoCapitalize(el.value,el.selectionStart)?"once":"off");
  };
  const detach=()=>{
   // Wait for the next focus target before deciding the field was left.
   setTimeout(()=>{
    const active=document.activeElement;
    if(isEditable(active))return;
    if(settings.showOnFocus)setVisible(false);
   },0);
  };
  document.addEventListener("focusin",attach);
  document.addEventListener("focusout",detach);
  return ()=>{
   document.removeEventListener("focusin",attach);
   document.removeEventListener("focusout",detach);
   release(target.current);
  };
 },[preview,settings.hideDeviceKeyboard,settings.showOnFocus,settings.autoCapitalize,settings.layout]);

 const publish=value=>{
  if(preview)return;
  if(typeof p.onChange==="function")p.onChange(value);
  else if(p.actionFlows?.change)fire("change",value);
 };
 const type=key=>{
  const field=target.current&&document.contains(target.current)?target.current:null;
  let value;
  if(field)value=writeField(field,key);
  else{
   value=applyKeyboardKey(own.current,key).value;
   own.current=value;
  }
  publish(value);
  return value;
 };
 const press=item=>{
  if(preview||p.disabled===true||p.readonly===true)return;
  if(item.kind==="shift"){
   const now=Date.now();
   setShift(s=>nextShift(s,now-lastShift.current<350));
   lastShift.current=now;
   return;
  }
  if(item.kind==="page"){setPage(item.key);return;}
  if(item.kind==="hide"){
   target.current?.blur?.();
   setVisible(false);
   if(p.actionFlows?.dismiss)fire("dismiss",own.current);
   return;
  }
  const field=target.current&&document.contains(target.current)?target.current:null;
  if(item.kind==="return"){
   if(field?.tagName==="TEXTAREA"&&settings.returnLabel==="return"){type("newline");return;}
   const value=field?(field.isContentEditable?field.textContent:field.value):own.current;
   if(settings.returnLabel==="next"&&field)focusNextField(field);
   if(p.actionFlows?.click)fire("click",value);
   return;
  }
  const value=type(item.kind==="space"?"space":item.key);
  if(item.kind==="char"||item.kind==="space"||item.kind==="backspace"){
   if(shift==="once"&&item.kind==="char")setShift("off");
   // A space typed from 123 returns to letters, so check capitals for that too.
   const onLetters=page==="letters"||(item.kind==="space"&&settings.layout!=="number");
   if(settings.autoCapitalize&&settings.layout==="text"&&shift!=="lock"&&onLetters){
    const caret=field&&!field.isContentEditable?field.selectionStart:value.length;
    if(shouldAutoCapitalize(value,caret))setShift("once");
   }
  }
  // iOS returns to letters after a space typed from the numbers page.
  if(item.kind==="space"&&page!=="letters"&&settings.layout!=="number")setPage("letters");
 };

 if(!visible&&!preview)return <div className="smart-keyboard smart-keyboard-hidden" aria-hidden="true"/>;
 const rows=keyboardRows(page,settings,shift);
 if(settings.showOnFocus)rows[3]=[...rows[3],{key:"hide",label:"⌄",kind:"hide",width:1.2}];
 const keyHeight=size(p.numpadKeyHeight,42,24,160);
 const radius=size(p.numpadKeyRadius,6,0,64);
 const letterStyle={
  background:p.numpadKeyFill||"#fff",color:p.numpadKeyTextColor||"#000",
  border:p.numpadKeyBorderColor?"1px solid "+p.numpadKeyBorderColor:"0",
  borderRadius:radius,height:keyHeight,fontSize:size(p.numpadKeyTextSize,22,10,64),
  fontWeight:p.numpadKeyBold===true?700:400,boxShadow:shadow(p.numpadKeyShadow)??"0 1px 0 rgb(0 0 0 / .3)"
 };
 const specialStyle={
  ...letterStyle,background:p.customButton1Fill||"#abb0ba",color:p.customButton1TextColor||letterStyle.color,
  border:p.customButton1BorderColor?"1px solid "+p.customButton1BorderColor:letterStyle.border,
  fontSize:size(p.customButton1TextSize,16,10,64),fontWeight:p.customButton1Bold===true?700:400,
  borderRadius:size(p.customButton1Radius,radius,0,64)
 };
 const returnStyle={
  ...specialStyle,background:p.customButton3Fill||"#007aff",color:p.customButton3TextColor||"#fff",
  border:p.customButton3BorderColor?"1px solid "+p.customButton3BorderColor:"0",
  fontSize:size(p.customButton3TextSize,16,10,64),fontWeight:p.customButton3Bold===false?400:600,
  borderRadius:size(p.customButton3Radius,radius,0,64)
 };
 const pressedStyle={
  background:p.numpadFocusedFill||"#d1d5db",color:p.numpadFocusedTextColor||undefined
 };
 const gap=size(p.numpadGap,6,0,24);
 const body={
  background:p.backgroundColor||"#d1d4d9",border:p.borderColor?"1px solid "+p.borderColor:"0",
  borderRadius:size(p.radius,12,0,64),boxShadow:shadow(p.shadow),
  padding:size(p.numpadPadding,6,0,48),gap
 };
 return <div className="smart-keyboard" role="group" aria-label="On-screen keyboard"
   data-keyboard-page={page} data-keyboard-shift={shift} style={body}>
  {rows.map((row,index)=><div key={page+index} className="smart-keyboard-row"
    data-keyboard-row={index} style={{gap}}>
   {index===1&&page==="letters"&&<span className="smart-keyboard-spacer" aria-hidden="true"/>}
   {row.map(item=>{
    const special=item.kind==="shift"||item.kind==="backspace"||item.kind==="page"||item.kind==="hide";
    const style=item.kind==="return"?returnStyle:special?specialStyle:letterStyle;
    const active=pressed===item.key+index||(item.kind==="shift"&&shift!=="off");
    return <button key={item.key} type="button" className={"smart-keyboard-key is-"+item.kind}
     aria-label={item.kind==="backspace"?"Delete":item.kind==="shift"?(shift==="lock"?"Caps lock on":"Shift"):
      item.kind==="space"?"Space":item.kind==="hide"?"Hide keyboard":item.label}
     aria-pressed={item.kind==="shift"?shift!=="off":undefined}
     data-design-area={p.builderPreview?(item.kind==="return"?"Button 4":special?"Button 2":"Button"):undefined}
     disabled={p.disabled===true||p.readonly===true}
     style={{...style,flexGrow:item.width,...(active?pressedStyle:{}),
      ...(item.kind==="shift"&&shift!=="off"?{background:"#fff",color:"#000"}:{})}}
     // Keep focus in the page field the user is typing into.
     onPointerDown={event=>{event.preventDefault();setPressed(item.key+index);}}
     onPointerUp={()=>setPressed("")} onPointerLeave={()=>setPressed("")}
     onClick={()=>press(item)}>
      {item.kind==="char"&&pressed===item.key+index&&item.label.length===1&&
       <span className="smart-keyboard-callout" aria-hidden="true">{item.label}</span>}
      <span className="smart-keyboard-label">{item.label}</span>
    </button>;
   })}
   {index===1&&page==="letters"&&<span className="smart-keyboard-spacer" aria-hidden="true"/>}
  </div>)}
 </div>;
}
