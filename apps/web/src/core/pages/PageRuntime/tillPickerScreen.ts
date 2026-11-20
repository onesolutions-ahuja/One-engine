import {assignDeviceTill,deviceTillState,loadDeviceTill} from '../../authentication/TillDevice/deviceTill';

/** "Which till is this?": shown once on a device that is not set up as a Till yet, on a
 * page that reads @ThisPage.Till. Picking one sets the device up for everyone who signs
 * in on it (needs edit access to Till). "Not now" leaves the page usable without a Till. */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
const styles=`dialog.une-till-picker{padding:0;border:0;border-radius:12px;width:min(420px,92vw);
 box-shadow:0 18px 50px rgba(0,0,0,.28);background:#fff;color:#1d1d1f;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
dialog.une-till-picker::backdrop{background:rgba(15,23,42,.35)}
.une-till-picker h2{margin:0;padding:18px 20px 4px;font-size:17px;text-align:center}
.une-till-picker p{margin:0;padding:0 20px 12px;text-align:center;color:#6e6e73}
.une-till-picker ul{list-style:none;margin:0;padding:0 12px 12px;max-height:50vh;overflow:auto}
.une-till-picker li button{width:100%;min-height:44px;margin:4px 0;border:1px solid rgba(60,60,67,.18);border-radius:10px;
 background:#fff;color:#1d1d1f;font:inherit;font-size:15px;text-align:left;padding:8px 12px;cursor:pointer}
.une-till-picker li button:hover,.une-till-picker li button:focus-visible{background:rgba(0,122,255,.08);outline:none}
.une-till-picker .une-till-error{color:#b42318}
.une-till-picker footer{display:flex;border-top:1px solid rgba(60,60,67,.18)}
.une-till-picker footer button{flex:1;min-height:44px;border:0;background:transparent;color:#007aff;font:inherit;font-size:15px;cursor:pointer}
.une-till-picker footer button+button{border-left:1px solid rgba(60,60,67,.18);font-weight:600}
.une-till-picker .une-pair-code{margin:4px 20px 8px;text-align:center;font:600 44px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em}
.une-till-picker input.une-pair-input{display:block;box-sizing:border-box;width:calc(100% - 40px);margin:4px 20px 14px;min-height:52px;
 border:1px solid rgba(60,60,67,.3);border-radius:10px;text-align:center;font:600 28px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.3em}`;
/** The till's small dialogs (which till, display pairing) share one look. */
export function ensureTillDialogStyles(){
 if(typeof document==='undefined'||document.getElementById('une-till-picker-styles'))return;
 const style=document.createElement('style');
 style.id='une-till-picker-styles';style.textContent=styles;
 document.head.appendChild(style);
}
let asked=false;
/** "Not now" is remembered on this device: the question is asked once, not on every page. */
const NOT_NOW='une.tillPicker.notNow';
const declined=()=>{try{return window.localStorage.getItem(NOT_NOW)==='1';}catch{return false;}};

export async function askWhichTill(request:Request):Promise<void>{
 if(asked||typeof document==='undefined'||declined())return;
 const state=await loadDeviceTill(request);
 if(state.status!=='unset'||asked)return;
 asked=true;
 ensureTillDialogStyles();
 const dialog=document.createElement('dialog');
 dialog.className='une-till-picker';
 dialog.setAttribute('aria-modal','true');
 dialog.setAttribute('aria-labelledby','une-till-picker-title');
 const title=document.createElement('h2');
 title.id='une-till-picker-title';title.textContent='Which till is this?';
 const help=document.createElement('p');
 help.textContent=deviceTillState().tills.length
  ?'Set this device up once. Everyone who signs in here then uses this till.'
  :'There are no active tills yet. Ask a manager to add a Named Device of type POS Terminal.';
 const list=document.createElement('ul');
 for(const till of deviceTillState().tills){
  const item=document.createElement('li');
  const button=document.createElement('button');
  button.type='button';
  button.textContent=till.Name+(till.Code?' ('+till.Code+')':'');
  // A till in use on another open device needs the code in the corner of its display
  // (proof the person is at that counter); no manager and no forced sign-out.
  const code=document.createElement('input');
  code.className='une-pair-input';code.inputMode='numeric';code.maxLength=4;code.hidden=true;
  code.setAttribute('aria-label','Code in the corner of '+till.Name+"'s customer display");
  code.addEventListener('input',()=>{code.value=code.value.replace(/\D/g,'').slice(0,4);});
  code.addEventListener('keydown',event=>{if(event.key==='Enter')button.click();});
  button.addEventListener('click',async()=>{
   button.disabled=true;
   try{await assignDeviceTill(request,String(till.Id),code.hidden?'':code.value.trim());dialog.close();dialog.remove();}
   catch(error){
    const message=error instanceof Error?error.message:'This device could not be set up';
    help.className='une-till-error';
    if(/in use on another device/.test(message)){
     help.textContent=message.replace(/^[^:]*: /,'')+'.';
     code.hidden=false;code.focus();
    }else help.textContent=message+'. A manager can set it up on this device.';
    button.disabled=false;
   }
  });
  item.append(button,code);list.appendChild(item);
 }
 const footer=document.createElement('footer');
 const later=document.createElement('button');
 later.type='button';later.textContent='Not now';
 later.addEventListener('click',()=>{
  try{window.localStorage.setItem(NOT_NOW,'1');}catch{/* private window: asked again next visit */}
  dialog.close();dialog.remove();
 });
 footer.appendChild(later);
 dialog.append(title,help,list,footer);
 document.body.appendChild(dialog);
 dialog.showModal();
}
