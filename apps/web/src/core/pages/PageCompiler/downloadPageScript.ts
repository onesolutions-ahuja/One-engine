import type {CompiledPage} from './compilePage';
import {generatePageScript,type ScriptLanguage} from './generatePageScript';

/** Save the converted page as a .ts or .js file. */
export function downloadPageScript(compiled:CompiledPage,language:ScriptLanguage,fileStem=compiled.apiName):void{
 const code=generatePageScript(compiled,language);
 const url=URL.createObjectURL(new Blob([code],{type:'text/plain;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download=fileStem.replace(/[^A-Za-z0-9_-]+/g,'_')+'.page.'+language;
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
