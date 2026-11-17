import {genie} from './FormulaScreenDialog';

/** CONFIRMSCREEN / INFOSCREEN: a small reusable box, like Excel's MsgBox.
 * Resolves true for Yes/OK, false for No/Escape. The box always closes itself. */
export type MessageScreen={kind:'confirm'|'info';message:string;yesLabel?:string;noLabel?:string};

const styles=`dialog.une-message-screen{padding:0;border:0;border-radius:12px;width:min(380px,92vw);
 box-shadow:0 18px 50px rgba(0,0,0,.28);background:#fff;color:#1d1d1f;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
dialog.une-message-screen::backdrop{background:rgba(15,23,42,.35)}
.une-message-screen p{margin:0;padding:20px 20px 16px;white-space:pre-line;text-align:center;font-size:15px}
.une-message-screen footer{display:flex;border-top:1px solid rgba(60,60,67,.18)}
.une-message-screen button{flex:1;min-height:44px;border:0;background:transparent;color:#007aff;font:inherit;font-size:15px;cursor:pointer}
.une-message-screen button+button{border-left:1px solid rgba(60,60,67,.18)}
.une-message-screen button.is-primary{font-weight:600}
.une-message-screen button:hover,.une-message-screen button:focus-visible{background:rgba(0,122,255,.08);outline:none}`;

export function showMessageScreen({kind,message,yesLabel,noLabel}:MessageScreen):Promise<boolean>{
 return new Promise(resolve=>{
  if(typeof document==='undefined'){resolve(kind==='info');return;}
  if(!document.getElementById('une-message-screen-styles')){
   const style=document.createElement('style');
   style.id='une-message-screen-styles';style.textContent=styles;
   document.head.appendChild(style);
  }
  const dialog=document.createElement('dialog');
  dialog.className='une-message-screen';
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('role',kind==='confirm'?'alertdialog':'dialog');
  const text=document.createElement('p');
  text.textContent=message;
  text.id='une-message-'+Math.random().toString(36).slice(2);
  dialog.setAttribute('aria-describedby',text.id);
  const footer=document.createElement('footer');
  const button=(label:string,answer:boolean,primary:boolean)=>{
   const item=document.createElement('button');
   item.type='button';item.textContent=label;
   if(primary)item.className='is-primary';
   item.addEventListener('click',()=>finish(answer));
   footer.appendChild(item);
   return item;
  };
  let done=false;
  const finish=(answer:boolean)=>{
   if(done)return;done=true;
   genie(dialog,true,()=>{try{dialog.close();}catch{/* closed */}dialog.remove();resolve(answer);});
  };
  if(kind==='confirm')button(noLabel||'No',false,false);
  const primary=button(kind==='confirm'?yesLabel||'Yes':yesLabel||'OK',true,true);
  dialog.append(text,footer);
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(kind==='info');});
  document.body.appendChild(dialog);
  try{dialog.showModal();}catch{dialog.setAttribute('open','');}
  primary.focus();
  genie(dialog,false);
 });
}

// Action-plan steps ask through a window event (the formula engine has no DOM access).
if(typeof window!=='undefined'&&!(window as unknown as {__uneMessageScreen?:boolean}).__uneMessageScreen){
 (window as unknown as {__uneMessageScreen?:boolean}).__uneMessageScreen=true;
 window.addEventListener('metadrive:message-screen',event=>{
  const detail=(event as CustomEvent<MessageScreen&{resolve:(yes:boolean)=>void}>).detail;
  if(!detail||typeof detail.resolve!=='function')return;
  event.preventDefault();
  void showMessageScreen(detail).then(detail.resolve);
 });
}
