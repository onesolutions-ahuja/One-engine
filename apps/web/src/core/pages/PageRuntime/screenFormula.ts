import './messageScreen';
import {parseScreenAction} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import {resolvePageActionRoute,type PageActionRoutingContext,type PageActionRoute} from './pageActionRouting';
import {appRoutePath} from '../../workspace/Navigation/appRouting';
import {tillDeviceKey} from '../../authentication/TillDevice/deviceTill';
import {LAYER_EVENT,rememberRequestedLayer,showPageLayer} from './pageLayers';

export type PopupScreen={page:string;sessionId:string;recordId:string;instance:string;inScreen:boolean;
 /** Page session that opened the popup: refreshed when the popup closes. */
 parentKey?:string;print?:boolean;ready?:()=>void;failed?:(reason:Error)=>void};
/** SCREEN(Page[,mode[,record]]). The optional record (for example
 * @ThisPage.Cart2.recordId) is evaluated by the caller's resolveRecord with the
 * page's own formula context; the popup reads it as @ThisPage.Input.recordId. The
 * popup shares the session (@ThisPage.Session.Id) and gets its own page values. */
export function openFormulaScreen(source:string,context:PageActionRoutingContext,
 onNavigate:(route:PageActionRoute)=>void,parentKey:string,sessionId:string,recordId:string,
 resolveRecord?:(formula:string)=>unknown){
 const parsed=parseScreenAction(source);
 const {mode,record}=parsed;
 // Page API names are lowercase; formulas may keep the label's casing.
 const page=context.pages.find(item=>item.apiName===parsed.page)?.apiName
  ??context.pages.find(item=>item.apiName.toLowerCase()===parsed.page.toLowerCase())?.apiName
  ??parsed.page;
 if(record!==undefined){
  if(!resolveRecord)throw Error('SCREEN record Id needs a page formula context');
  // The parser drops the @ of a mention (@recordId, @value): restore it, or the
  // bare name is read as text and the popup opens with record "=recordId".
  const value=resolveRecord(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(record)?'@'+record:record);
  recordId=value===null||value===undefined?'':String(value);
 }
 // SCREEN(Page, 3): switch Page where it shows, else open it here (openPageLayer).
 if(parsed.layer!==undefined&&mode==='current')return openPageLayer(page,parsed.layer,context,onNavigate);
 // A popup or other window opens on that layer.
 if(parsed.layer!==undefined)rememberRequestedLayer(page,parsed.layer);
 const inScreen=mode==='popup'&&context.pages.some(item=>
  item.apiName===page&&item.pageType==='In-Screen Page'&&item.status==='Active');
 const route=inScreen?null:resolvePageActionRoute({navigationTargetType:'App Page',navigationPageApiName:page},context);
 if(mode==='popup'){
  const screen:PopupScreen={page,sessionId,recordId,instance:crypto.randomUUID(),inScreen,parentKey};
  const handled=!window.dispatchEvent(new CustomEvent('metadrive:open-formula-screen',{
   detail:{parentKey,screen},cancelable:true
  }));
  if(!handled&&window.dispatchEvent(new CustomEvent('metadrive:workspace-formula-screen',{cancelable:true,detail:{appId:context.currentAppId,screen}})))throw Error('This page has no popup host');
 }else if(route){
  if(mode==='current')onNavigate(route);
  else{
   // Another window reads its layer from the address (?layer=).
   const path=appRoutePath(route)+(parsed.layer!==undefined?(appRoutePath(route).includes('?')?'&':'?')+'layer='+parsed.layer:'');
   if(mode==='second')void openSecondScreen(path,sessionId);
   else window.open(path,'_blank','noopener');
  }
 }
 return {navigated:true};
}

/** SCREEN(Page, n): show layer n of Page. Where Page is already showing (this window, the
 * second screen, or paired screens that follow this device) it switches there; only when
 * it shows nowhere does this window open Page on layer n. */
async function openPageLayer(page:string,layer:number,context:PageActionRoutingContext,
 onNavigate:(route:PageActionRoute)=>void):Promise<{navigated:true}>{
 if(showPageLayer(page,layer))return {navigated:true};
 let second=false;
 try{
  if(secondWindow&&!secondWindow.closed){
   second=new URL(secondWindow.location.href).pathname.toLowerCase().endsWith('/pages/'+page.toLowerCase());
   secondWindow.postMessage({type:LAYER_EVENT,page,layer},window.location.origin);
  }
 }catch{/* another site is open in it */}
 const device=tillDeviceKey();
 // Loaded here only: the sign-in client is not needed to open ordinary screens.
 const {apiRequest}=await import('../../authentication/Client/authClient');
 const {screens}=/^[A-Za-z0-9_-]{16,128}$/.test(device)
  ?await apiRequest<{screens:number}>('/screens/layer',{method:'POST',body:JSON.stringify({deviceKey:device,page,layer})})
   .catch(()=>({screens:0}))
  :{screens:0};
 if(second||screens>0)return {navigated:true};
 const route=resolvePageActionRoute({navigationTargetType:'App Page',navigationPageApiName:page},context);
 if(!route)throw Error('Page '+page+' is not in this app');
 rememberRequestedLayer(page,layer);
 onNavigate(route);
 return {navigated:true};
}

/** SCREEN(Page,"second"): one window on the second monitor (full size where the browser
 * allows), sharing this page's session so its formulas read the same cart. Calling it
 * again reuses (refreshes) the same window. */
let secondWindow:Window|null=null;
export async function openSecondScreen(path:string,sessionId:string){
 const url=new URL(path,window.location.origin);
 if(/^[0-9a-f-]{36}$/i.test(sessionId))url.searchParams.set('screenSession',sessionId);
 // The second screen (a customer display) follows the till that opened it.
 const own=tillDeviceKey();
 if(/^[A-Za-z0-9_-]{16,128}$/.test(own))url.searchParams.set('mirror',own);
 let features='popup=yes';
 try{
  // Chrome/Edge: asks once to "manage windows on all displays", then places it on monitor 2.
  const details=await (window as unknown as {getScreenDetails?:()=>Promise<{
   screens:Array<{availLeft:number;availTop:number;availWidth:number;availHeight:number}>;currentScreen:unknown}>})
   .getScreenDetails?.();
  const other=details?.screens.find(screen=>screen!==details.currentScreen);
  if(other)features='popup=yes,left='+other.availLeft+',top='+other.availTop
   +',width='+other.availWidth+',height='+other.availHeight;
 }catch{/* permission declined: a normal window the user drags across */}
 if(secondWindow&&!secondWindow.closed){secondWindow.location.href=url.href;secondWindow.focus();return;}
 secondWindow=window.open(url.href,'une-second-screen',features);
}
/** Open the second-screen window unless it is already open (a till reloading must not
 * reload its display). False when the browser blocked it (no click yet, pop-ups not allowed). */
export async function ensureSecondScreen(path:string,sessionId:string):Promise<boolean>{
 const url=new URL(path,window.location.origin);
 if(/^[0-9a-f-]{36}$/i.test(sessionId))url.searchParams.set('screenSession',sessionId);
 const own=tillDeviceKey();
 if(/^[A-Za-z0-9_-]{16,128}$/.test(own))url.searchParams.set('mirror',own);
 if(secondWindow&&!secondWindow.closed)return true;
 let features='popup=yes';
 try{
  const details=await (window as unknown as {getScreenDetails?:()=>Promise<{
   screens:Array<{availLeft:number;availTop:number;availWidth:number;availHeight:number}>;currentScreen:unknown}>})
   .getScreenDetails?.();
  const other=details?.screens.find(screen=>screen!==details.currentScreen);
  if(other)features='popup=yes,left='+other.availLeft+',top='+other.availTop
   +',width='+other.availWidth+',height='+other.availHeight;
 }catch{/* no permission yet: a normal window */}
 // An empty URL finds the window of that name if it is already open, without reloading it.
 const found=window.open('','une-second-screen',features);
 if(!found)return false;
 let blank=true;
 try{blank=found.location.href==='about:blank';}catch{blank=false;}
 if(blank)found.location.href=url.href;
 secondWindow=found;
 return true;
}
/** CLOSESCREEN("second"). */
export function closeSecondScreen(){
 if(secondWindow&&!secondWindow.closed)secondWindow.close();
 else{try{window.open('','une-second-screen')?.close();}catch{/* blocked */}}
 secondWindow=null;
 return {closed:true};
}

export function previewPrintTemplate(page:string,recordId:string,parentKey:string,sessionId:string,appId:string){
 return new Promise<void>((ready,failed)=>{
  const screen:PopupScreen={page,recordId,sessionId,instance:crypto.randomUUID(),inScreen:false,print:true,ready,failed};
  if(window.dispatchEvent(new CustomEvent('metadrive:open-formula-screen',{detail:{parentKey,screen},cancelable:true}))&&
     window.dispatchEvent(new CustomEvent('metadrive:workspace-formula-screen',{detail:{appId,screen},cancelable:true})))
   failed(Error('This page has no print preview host'));
 });
}

/** CLOSESCREEN(): closes the formula popup whose runtime instance is parentKey. */
export function closeFormulaScreen(pageSessionKey:string){
 const handled=!window.dispatchEvent(new CustomEvent('metadrive:close-formula-screen',{
  detail:{pageSessionKey},cancelable:true
 }));
 if(!handled)throw Error('CLOSESCREEN runs only inside a popup screen');
 return {closed:true};
}
