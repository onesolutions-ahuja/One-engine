// Physical keyboard for Smart Numpad: only the numpad the user last tapped or clicked
// (the "selected" one) takes keys, like the till lock pad. Tapping anywhere else
// clears the selection, so with many numpads on a page only one ever types.
let selected=null;
const listeners=new Set();
const notify=()=>listeners.forEach(fn=>fn(selected));
export const selectedNumpad=()=>selected;
export function selectNumpad(id){if(selected!==id){selected=id;notify();}}
export function onNumpadSelection(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
if(typeof document!=="undefined"&&!globalThis.__uneNumpadPointer){
 globalThis.__uneNumpadPointer=true;
 document.addEventListener("pointerdown",event=>{
  const pad=event.target instanceof Element?event.target.closest("[data-numpad-id]"):null;
  selectNumpad(pad?pad.getAttribute("data-numpad-id"):null);
 },true);
}
/** Key → numpad action, or null when the numpad should ignore it. */
export function numpadKeyAction(key,mode){
 if(/^[0-9]$/.test(key))return key;
 if((key==="."||key===",")&&mode==="decimal")return ".";
 if(key==="Backspace")return "backspace";
 if(key==="Delete"||key==="Escape")return "C";
 if(key==="Enter")return "enter";
 return null;
}
/** Typing into a text box elsewhere must reach that box, not the numpad. */
export function typingElsewhere(target,ownInput){
 if(!(target instanceof Element)||target===ownInput)return false;
 return target.closest("input,textarea,select,[contenteditable=''],[contenteditable='true']")!==null;
}
