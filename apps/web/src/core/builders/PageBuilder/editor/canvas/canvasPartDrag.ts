import type * as React from 'react';
import { nextPartOffset, partOffsetKeys, partSnapLabel, partSnapRule, snapPartValue, withPartOffset } from '../../canvasPartSnap';

/** Builder controls drawn inside a component keep their own pointer handling. */
const EDITOR_CONTROLS='.canvas-element-actions,.canvas-drop-zone,.free-canvas-resize-handle,'+
 '.template-component-resize-handle,.template-placement-handle,.canvas-data-bindings,.canvas-move-grip';

/** The component's own Design part under the pointer (not one of a nested component). */
export function partUnderPointer(host:HTMLElement,x:number,y:number):HTMLElement|undefined{
 const under=typeof document.elementsFromPoint==='function'?document.elementsFromPoint(x,y):[];
 return under.find((node):node is HTMLElement=>node instanceof HTMLElement&&Boolean(node.dataset.designArea)
  &&host.contains(node)&&node.closest('[data-component-id]')===host);
}

/** Press on a draggable part of the SELECTED component and drag it:
 * - plain drag moves it freely; its X/Y offset is saved (no number boxes);
 * - Shift+drag snaps it to the nearest place its dropdown offers (offset cleared).
 * A press without movement stays a normal click (selects that part). Esc cancels.
 * Returns true when the press belongs to a part, so the component does not move. */
export function startCanvasPartDrag(
 event:React.PointerEvent<HTMLElement>,
 componentType:string,
 properties:Readonly<Record<string,unknown>>,
 handlers:{chooseArea:(area:string)=>void;suppressClick:()=>void;onDrop:(next:Record<string,unknown>)=>void}
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
 const scale=host.offsetWidth>0?frame.width/host.offsetWidth:1;
 const keys=partOffsetKeys(rule);
 const current={x:properties[keys.x],y:properties[keys.y]};
 // The part may already be moved: keep its saved translate and add the drag to it.
 const savedTranslate=part.style.getPropertyValue('translate');
 const start=nextPartOffset(current,0,0);
 let dragging=false,snap=false,value='',dx=0,dy=0;
 const finish=(commit:boolean)=>{
  window.removeEventListener('pointermove',move);
  window.removeEventListener('pointerup',up);
  window.removeEventListener('pointercancel',cancel);
  window.removeEventListener('keydown',key,true);
  if(savedTranslate)part.style.setProperty('translate',savedTranslate);
  else part.style.removeProperty('translate');
  part.removeAttribute('data-part-dragging');
  part.removeAttribute('data-part-snap');
  if(!dragging)return;
  handlers.suppressClick();
  if(!commit)return;
  if(snap&&value)handlers.onDrop(withPartOffset({...properties,[rule.property]:value},rule,{x:0,y:0}));
  else if(!snap)handlers.onDrop(withPartOffset(properties,rule,nextPartOffset(current,dx,dy)));
 };
 const move=(next:PointerEvent)=>{
  const screenX=next.clientX-startX,screenY=next.clientY-startY;
  if(!dragging){
   if(Math.hypot(screenX,screenY)<4)return;
   dragging=true;
   handlers.chooseArea(area);
   part.setAttribute('data-part-dragging','true');
  }
  // Page pixels: canvas zoom/fit is undone so the saved offset is the real one.
  dx=screenX/scale;dy=screenY/scale;
  snap=next.shiftKey;
  part.style.setProperty('translate',(start.x+dx)+'px '+(start.y+dy)+'px');
  if(snap){
   value=snapPartValue(rule.mode,{x:next.clientX,y:next.clientY},box.getBoundingClientRect());
   part.setAttribute('data-part-snap','Snap: '+partSnapLabel(value));
  }else{
   const offset=nextPartOffset(current,dx,dy);
   part.setAttribute('data-part-snap',offset.x||offset.y?'X '+offset.x+'  Y '+offset.y:'Original place');
  }
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
