import type {CompiledPage} from './compilePage';
import {generatePageScript,type ScriptLanguage} from './generatePageScript';

/** Save code text as a file. */
export function downloadCode(code:string,fileName:string):void{
 const url=URL.createObjectURL(new Blob([code],{type:'text/javascript;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download=fileName.replace(/[^A-Za-z0-9_.-]+/g,'_');
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** Save the browser-compiled page (used only while edits are unsaved). */
export function downloadPageScript(compiled:CompiledPage,language:ScriptLanguage,fileStem=compiled.apiName):void{
 downloadCode(generatePageScript(compiled,language),fileStem+'.page.'+language);
}
