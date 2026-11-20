import {applyNumpadKey,normalizeNumpadValue,numpadSettings} from "../../smart_numpad/numpadValue.mjs";

/** On-screen keypad for a Text box whose Keypad setting is number, decimal or date.
 * A till has no keyboard: tapping the box opens these keys under it (above it when
 * there is no room). It is plain DOM on <body>, so a scaled or clipped page frame
 * never hides it. One keypad is open at a time. */
const STYLE_ID="smart-keypad-popover-styles";
const styles=`.smart-keypad-popover{position:fixed;z-index:2147483000;width:264px;padding:10px;box-sizing:border-box;
 background:#fff;border-radius:16px;box-shadow:0 18px 48px rgba(15,23,42,.28);display:grid;
 grid-template-columns:repeat(3,1fr);gap:8px;font:600 22px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;touch-action:manipulation}
.smart-keypad-popover button{height:56px;border:1px solid #e3e7ed;border-radius:12px;background:#f2f2f7;color:#1d1d1f;
 font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.smart-keypad-popover button:active{background:#dbeafe}
.smart-keypad-popover .smart-keypad-done{grid-column:1/-1;height:48px;background:#007aff;border-color:#007aff;color:#fff;font-size:17px}`;
let open=null;

export function closeKeypad(){
 if(!open)return;
 open.element.remove();
 document.removeEventListener("pointerdown",open.outside,true);
 document.removeEventListener("keydown",open.escape,true);
 open=null;
}

export function openKeypad(input,mode,getValue,setValue){
 if(typeof document==="undefined"||!input)return;
 if(open?.input===input)return;
 closeKeypad();
 if(!document.getElementById(STYLE_ID)){
  const style=document.createElement("style");
  style.id=STYLE_ID;style.textContent=styles;document.head.appendChild(style);
 }
 const settings=numpadSettings({numpadInputMode:mode==="number"?"integer":mode,numpadMaxDigits:mode==="date"?8:12});
 const keys=["7","8","9","4","5","6","1","2","3",mode==="decimal"?".":"C","0","backspace"];
 const element=document.createElement("div");
 element.className="smart-keypad-popover";
 element.setAttribute("role","group");
 element.setAttribute("aria-label",mode==="date"?"Date keypad":"Number keypad");
 const press=key=>{
  const next=applyNumpadKey(normalizeNumpadValue(getValue(),settings),key,settings);
  setValue(next);
 };
 for(const key of keys){
  const button=document.createElement("button");
  button.type="button";
  button.textContent=key==="backspace"?"⌫":key;
  button.setAttribute("aria-label",key==="backspace"?"Backspace":key==="C"?"Clear":key==="."?"Decimal point":key);
  // Keep focus in the box (no blur, no OS keyboard).
  button.addEventListener("pointerdown",event=>event.preventDefault());
  button.addEventListener("click",()=>press(key));
  element.appendChild(button);
 }
 const done=document.createElement("button");
 done.type="button";done.className="smart-keypad-done";done.textContent="Done";
 done.addEventListener("pointerdown",event=>event.preventDefault());
 done.addEventListener("click",()=>{closeKeypad();input.blur();});
 element.appendChild(done);
 document.body.appendChild(element);
 const box=input.getBoundingClientRect(),own=element.getBoundingClientRect();
 const below=box.bottom+8+own.height<=window.innerHeight;
 element.style.top=Math.max(8,below?box.bottom+8:box.top-8-own.height)+"px";
 element.style.left=Math.max(8,Math.min(window.innerWidth-own.width-8,box.left))+"px";
 const outside=event=>{if(!element.contains(event.target)&&event.target!==input)closeKeypad();};
 const escape=event=>{if(event.key==="Escape")closeKeypad();};
 document.addEventListener("pointerdown",outside,true);
 document.addEventListener("keydown",escape,true);
 open={input,element,outside,escape};
}
