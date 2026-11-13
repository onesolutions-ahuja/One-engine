// Pure Smart Keyboard logic: layouts and text editing. No DOM, no React,
// so the same rules run in the Page Runtime, the Builder preview and tests.

export const keyboardLayouts=["text","email","url","number"];
export const returnLabels=["return","done","go","search","next","send"];

const letters=["qwertyuiop","asdfghjkl","zxcvbnm"];
const numbers=["1234567890","-/:;()£&@\"",".,?!'"];
const symbols=["[]{}#%^*+=","_\\|~<>€$¥•",".,?!'"];

/** Normalised settings from component properties; unknown values fall back safely. */
export function keyboardSettings(p={}){
 return {
  layout:keyboardLayouts.includes(p.keyboardLayout)?p.keyboardLayout:"text",
  returnLabel:returnLabels.includes(p.keyboardReturnLabel)?p.keyboardReturnLabel:"return",
  autoCapitalize:p.keyboardAutoCapitalize!==false,
  showOnFocus:p.keyboardShowOnFocus===true,
  hideDeviceKeyboard:p.keyboardHideDeviceKeyboard!==false
 };
}

/** Rows of keys for a page ("letters" | "numbers" | "symbols").
 * Each key is {key,label,kind,width} where width is in letter-key units. */
export function keyboardRows(page,settings,shift="off"){
 const upper=shift!=="off";
 const chars=page==="numbers"?numbers:page==="symbols"?symbols:letters;
 const row=(text)=>[...text].map(ch=>{
  const value=page==="letters"&&upper?ch.toUpperCase():ch;
  return {key:value,label:value,kind:"char",width:1};
 });
 const first=row(chars[0]);
 const second=row(chars[1]);
 const third=[
  page==="letters"
   ?{key:"shift",label:shift==="lock"?"⇪":"⇧",kind:"shift",width:1.4}
   :{key:page==="numbers"?"symbols":"numbers",label:page==="numbers"?"#+=":"123",kind:"page",width:1.4},
  ...row(chars[2]),
  {key:"backspace",label:"⌫",kind:"backspace",width:1.4}
 ];
 const toggle={key:page==="letters"?"numbers":"letters",label:page==="letters"?"123":"ABC",kind:"page",width:1.4};
 const ret={key:"return",label:settings.returnLabel,kind:"return",width:2};
 const bottom=settings.layout==="email"
  ?[toggle,{key:"space",label:"space",kind:"space",width:3.6},
    {key:"@",label:"@",kind:"char",width:1},{key:".",label:".",kind:"char",width:1},ret]
  :settings.layout==="url"
   ?[toggle,{key:"/",label:"/",kind:"char",width:1},{key:".",label:".",kind:"char",width:1},
     {key:".com",label:".com",kind:"char",width:1.6},{key:"space",label:"space",kind:"space",width:2},ret]
   :[toggle,{key:"space",label:"space",kind:"space",width:5.6},ret];
 return [first,second,third,bottom];
}

/** First page shown for a layout. */
export const startPage=settings=>settings.layout==="number"?"numbers":"letters";

/** Apply one key to a value with a selection. Returns the new value and caret. */
export function applyKeyboardKey(value,key,start,end){
 const text=value===null||value===undefined?"":String(value);
 const from=Math.max(0,Math.min(text.length,Number.isInteger(start)?start:text.length));
 const to=Math.max(from,Math.min(text.length,Number.isInteger(end)?end:from));
 if(key==="backspace"){
  if(from!==to)return {value:text.slice(0,from)+text.slice(to),caret:from};
  if(from===0)return {value:text,caret:0};
  // Remove a whole surrogate pair (e.g. an emoji or €-like astral char) at once.
  const code=text.charCodeAt(from-1);
  const size=from>1&&code>=0xdc00&&code<=0xdfff?2:1;
  return {value:text.slice(0,from-size)+text.slice(to),caret:from-size};
 }
 const insert=key==="space"?" ":key==="newline"?"\n":String(key);
 return {value:text.slice(0,from)+insert+text.slice(to),caret:from+insert.length};
}

/** Whether the next letter should start capitalised (start of text or sentence). */
export function shouldAutoCapitalize(value,caret){
 const before=String(value??"").slice(0,Number.isInteger(caret)?caret:undefined);
 return before.trim()===""||/[.!?]\s+$/.test(before)||/\n$/.test(before);
}

/** Shift cycles off → once → (double tap) lock → off. */
export function nextShift(current,doubleTap){
 if(current==="lock")return "off";
 if(current==="once")return doubleTap?"lock":"off";
 return "once";
}
