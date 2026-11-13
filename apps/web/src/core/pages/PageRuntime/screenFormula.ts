import {parseScreenAction} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import {resolvePageActionRoute,type PageActionRoutingContext,type PageActionRoute} from './pageActionRouting';
import {appRoutePath} from '../../workspace/Navigation/appRouting';

export type PopupScreen={page:string;sessionId:string;recordId:string;instance:string;inScreen:boolean;
 /** Page session that opened the popup: refreshed when the popup closes. */
 parentKey?:string;print?:boolean;ready?:()=>void;failed?:(reason:Error)=>void};
/** SCREEN(Page[,mode[,record]]). The optional record (for example
 * $component.Cart2.recordId) is evaluated by the caller's resolveRecord with the
 * page's own formula context; the popup reads it as $state.recordId. The popup
 * shares the session ($session.*) and gets its own Page State. */
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
  else window.open(appRoutePath(route),'_blank','noopener');
 }
 return {navigated:true};
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
