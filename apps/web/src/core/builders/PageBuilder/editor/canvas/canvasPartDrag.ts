import type * as React from 'react';
import { partSnapLabel, partSnapRule, snapPartValue } from '../../canvasPartSnap';

/** Builder controls drawn inside a component keep their own pointer handling. */
const EDITOR_CONTROLS='.canvas-element-actions,.canvas-drop-zone,.free-canvas-resize-handle,'+
 '.template-component-resize-handle,.template-placement-handle,.canvas-data-bindings,.canvas-move-grip';

/** The component's own Design part under the pointer (not one of a nested component). */
export function partUnderPointer(host:HTMLElement,x:number,y:number):HTMLElement|undefined{
 const under=typeof document.elementsFromPoint==='function'?document.elementsFromPoint(x,y):[];
 return under.find((node):node is HTMLElement=>node instanceof HTMLElement&&Boolean(node.dataset.designArea)
  &&host.contains(node)&&node.closest('[data-component-id]')===host);
}

/** Press on a draggable part of the SELECTED component, drag, and drop: the part
 * snaps to the nearest allowed place and the existing property is updated.
 * A press without movement stays a normal click (selects that part).
 * Returns true when the press belongs to a part, so the component does not move. */
export function startCanvasPartDrag(
 event:React.PointerEvent<HTMLElement>,
 componentType:string,
 handlers:{chooseArea:(area:string)=>void;suppressClick:()=>void;onDrop:(property:string,value:string)=>void}
):boolean{
 if(event.button!==0||event.pointerType==='touch')return false;
 const host=event.currentTarget;
 const target=event.target as Element|null;
 if(target?.closest?.(EDITOR_CONTROLS))return false;
 const part=partUnderPointer(host,event.clientX,event.clientY);
 const area=part?.dataset.designArea??'';
 const rule=partSnapRule(componentType,area);
 if(!part||!rule)return false;
 // The badge floats over the card; everything else moves inside its row/box.
 const box=(rule.mode==='badge'?part.offsetParent??part.parentElement:part.parentElement) as HTMLElement|null;
 if(!box)return false;
 event.preventDefault();
 event.stopPropagation();
 const startX=event.clientX,startY=event.clientY;
 const frame=host.getBoundingClientRect();
 // Canvas zoom/fit scales the page; translate is in the part's own pixels.
 const scale=host.offsetWidth>0?frame.width/host.offsetWidth:1;
 let dragging=false,value='';
 const finish=(commit:boolean)=>{
  window.removeEventListener('pointermove',move);
  window.removeEventListener('pointerup',up);
  window.removeEventListener('pointercancel',cancel);
  window.removeEventListener('keydown',key,true);
  part.style.removeProperty('translate');
  part.removeAttribute('data-part-dragging');
  part.removeAttribute('data-part-snap');
  if(!dragging)return;
  handlers.suppressClick();
  if(commit&&value)handlers.onDrop(rule.property,value);
 };
 const move=(next:PointerEvent)=>{
  const dx=next.clientX-startX,dy=next.clientY-startY;
  if(!dragging){
   if(Math.hypot(dx,dy)<4)return;
   dragging=true;
   handlers.chooseArea(area);
   part.setAttribute('data-part-dragging','true');
  }
  part.style.setProperty('translate',(dx/scale)+'px '+(dy/scale)+'px');
  value=snapPartValue(rule.mode,{x:next.clientX,y:next.clientY},box.getBoundingClientRect());
  part.setAttribute('data-part-snap',partSnapLabel(value));
 };
 const up=()=>finish(true);
 const cancel=()=>finish(false);
 const key=(next:KeyboardEvent)=>{if(next.key==='Escape'){next.stopPropagation();finish(false);}};
 window.addEventListener('pointermove',move);
 window.addEventListener('pointerup',up);
 window.addEventListener('pointercancel',cancel);
 window.addEventListener('keydown',key,true);
 return true;
}
