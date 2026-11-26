import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import './CanvasFloatingActions.css';

/** In-place rename box drawn exactly over a MultiPage tab in the designer.
 * Enter or clicking away keeps the name; Esc cancels. */
export default function MultiPageTabRename({multiPageId,tabKey,name,viewportRef,onDone}:{
 multiPageId:string;tabKey:string;name:string;
 viewportRef:RefObject<HTMLDivElement|null>;
 onDone:(name:string|null)=>void;
}){
 const [box,setBox]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 const input=useRef<HTMLInputElement>(null);
 const done=useRef(false);
 const finish=(value:string|null)=>{if(done.current)return;done.current=true;onDone(value);};
 useLayoutEffect(()=>{
  const host=Array.from(viewportRef.current?.querySelectorAll<HTMLElement>('.free-canvas-component[data-component-id]')??[])
   .find(node=>node.dataset.componentId===multiPageId);
  const tab=Array.from(host?.querySelectorAll<HTMLElement>('[data-multipage-tab]')??[])
   .find(node=>node.dataset.multipageTab===tabKey);
  if(!tab){finish(null);return;}
  tab.scrollIntoView({block:'nearest',inline:'nearest'});
  const rect=tab.getBoundingClientRect();
  setBox({left:rect.left,top:rect.top,width:Math.max(96,rect.width),height:Math.max(26,rect.height)});
 },[multiPageId,tabKey]); // eslint-disable-line react-hooks/exhaustive-deps
 useLayoutEffect(()=>{if(box){input.current?.focus();input.current?.select();}},[box]);
 if(!box||typeof document==='undefined')return null;
 return createPortal(<input ref={input} className="multipage-tab-rename" aria-label="Tab name" defaultValue={name}
  style={{position:'fixed',left:box.left,top:box.top,width:box.width,height:box.height,zIndex:11001}}
  onKeyDown={event=>{
   event.stopPropagation();
   if(event.key==='Enter'){event.preventDefault();finish(event.currentTarget.value);}
   else if(event.key==='Escape'){event.preventDefault();finish(null);}
  }}
  onBlur={event=>finish(event.currentTarget.value)}/>,document.body);
}
