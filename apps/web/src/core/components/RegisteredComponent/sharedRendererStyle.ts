import {useInsertionEffect} from 'react';

/** Shared style rule for published trusted renderer instances.
 * The same versioned CSS can be mounted by dozens of Text/Cart/Grid instances.
 * One node per Document+content avoids duplicate parsing and selector rebuilding.
 * React's insertion effect installs styles before layout, and reference counting
 * removes them after the last instance unmounts (including Strict Mode).
 * No shared tenant records, user values or runtime assets are retained here.
 */
type Entry={element:HTMLStyleElement;references:number};
const documents=new WeakMap<Document,Map<string,Entry>>();

export function useSharedRendererStyle(css:string):void {
 useInsertionEffect(()=>{
  if(!css||typeof document==='undefined')return;
  const doc=document;
  let entries=documents.get(doc);
  if(!entries){entries=new Map();documents.set(doc,entries);}
  let entry=entries.get(css);
  if(entry){
   entry.references++;
  }else{
   const element=doc.createElement('style');
   element.setAttribute('data-metadrive-shared-renderer-style','');
   element.textContent=css;
   doc.head.appendChild(element);
   entry={element,references:1};
   entries.set(css,entry);
  }
  return ()=>{
   const current=entries!.get(css);
   if(!current)return;
   current.references--;
   if(current.references===0){
    current.element.remove();
    entries!.delete(css);
   }
  };
 },[css]);
}
