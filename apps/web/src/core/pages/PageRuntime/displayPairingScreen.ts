import {deviceTillState,loadDeviceTill,openerMirrorKey,pairDisplayWithCode,requestDisplayCode,unpairTillDisplay} from '../../authentication/TillDevice/deviceTill';
import {ensureTillDialogStyles} from './tillPickerScreen';

/**
 * Pairing a customer display with a Till by a 6-digit code: works the same on any browser,
 * Android or iOS tablet, because it is only the display page signed in on that device.
 *  - On the till: PAIRDISPLAY() (a button the page builder adds) shows a code for 5 minutes.
 *  - On the display: when it cannot tell which till to follow (more than one till, not
 *    paired, not opened by a till), it asks for that code once.
 * A shop with one till needs none of this: its displays follow that till already.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

function dialogShell(titleText:string,helpText:string){
 ensureTillDialogStyles();
 const dialog=document.createElement('dialog');
 dialog.className='une-till-picker';
 dialog.setAttribute('aria-modal','true');
 const title=document.createElement('h2');
 title.id='une-pair-title-'+Math.random().toString(36).slice(2);
 title.textContent=titleText;
 dialog.setAttribute('aria-labelledby',title.id);
 const help=document.createElement('p');help.textContent=helpText;
 const footer=document.createElement('footer');
 const close=()=>{dialog.close();dialog.remove();};
 const button=(label:string,run:()=>void)=>{
  const item=document.createElement('button');item.type='button';item.textContent=label;
  item.addEventListener('click',run);footer.appendChild(item);return item;
 };
 return {dialog,title,help,footer,close,button,
  show(...body:HTMLElement[]){dialog.append(title,help,...body,footer);document.body.appendChild(dialog);dialog.showModal();}};
}
const fail=(help:HTMLElement,error:unknown,fallback:string)=>{
 help.className='une-till-error';
 help.textContent=error instanceof Error&&error.message?error.message:fallback;
};

/** PAIRDISPLAY() on the till. */
export async function showDisplayPairingCode(request:Request):Promise<void>{
 if(typeof document==='undefined')return;
 const box=dialogShell('Pair a customer display','Getting a code…');
 const code=document.createElement('div');code.className='une-pair-code';code.setAttribute('aria-live','polite');
 box.button('Unpair display',async()=>{
  try{await unpairTillDisplay(request);box.help.className='';box.help.textContent='This till has no customer display now.';code.textContent='';}
  catch(error){fail(box.help,error,'The display could not be unpaired');}
 });
 box.button('Done',box.close);
 box.show(code);
 try{
  const answer=await requestDisplayCode(request);
  code.textContent=answer.code;
  const until=new Date(answer.expiresAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  box.help.textContent='On the customer display (tablet, phone or browser), open the display page and type this code. It works once, until '+until+'.';
 }catch(error){fail(box.help,error,'No code: this device is not set up as a till');}
}

let asked=false;
/** True when a display cannot tell which till it shows, so it should ask for a code. */
export function displayNeedsPairing():boolean{
 const state=deviceTillState();
 return state.status==='unset'&&!state.displayFor&&!openerMirrorKey()&&state.tills.length>1;
}
/** On a customer display page: ask for the till's code when it cannot tell which till to follow. */
export async function askToPairDisplay(request:Request,force=false):Promise<void>{
 if((asked&&!force)||typeof document==='undefined')return;
 await loadDeviceTill(request);
 if(!force&&(!displayNeedsPairing()||asked))return;
 asked=true;
 const box=dialogShell('Which till is this display for?','On the till, tap Pair display, then type the 6-digit code here.');
 const input=document.createElement('input');
 input.className='une-pair-input';input.inputMode='numeric';input.autocomplete='one-time-code';
 input.maxLength=6;input.pattern='[0-9]{6}';input.setAttribute('aria-label','6-digit code from the till');
 box.button('Not now',box.close);
 const pair=box.button('Pair',async()=>{
  if(!/^\d{6}$/.test(input.value.trim())){fail(box.help,null,'Type the 6 digits shown on the till');input.focus();return;}
  pair.disabled=true;
  try{
   await pairDisplayWithCode(request,input.value);
   box.close();
  }catch(error){fail(box.help,error,'That code did not work. Get a new code on the till');pair.disabled=false;input.select();}
 });
 input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,6);});
 input.addEventListener('keydown',event=>{if(event.key==='Enter')pair.click();});
 box.show(input);
 input.focus();
}
