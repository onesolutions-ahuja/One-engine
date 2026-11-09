import {useEffect,useState,type RefObject,type PointerEvent as ReactPointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {canvasResizeOverlayGeometry,type OverlayGeometry,type OverlayEdge} from './canvasResizeOverlayGeometry';
import './CanvasFloatingActions.css';

export type CanvasResizeEdge=OverlayEdge;
const empty:OverlayGeometry={points:[],clip:{left:0,top:0,right:0,bottom:0}};

/** Portal out of component stacking contexts, but CLIP to the actual scrollable
 * designer viewport. A component may scroll behind the fixed ribbon; its grips
 * must never appear there. Scroll the fixed-size page to reach the true edge.
 */
export default function CanvasFloatingResizeHandles({componentId,componentLabel,viewportRef,onStart,onMove,onEnd,onCancel}:{
 componentId:string;
 componentLabel:string;
 viewportRef:RefObject<HTMLDivElement|null>;
 onStart:(event:ReactPointerEvent<HTMLButtonElement>,edge:CanvasResizeEdge)=>void;
 onMove:(event:ReactPointerEvent<HTMLButtonElement>)=>void;
 onEnd:(event:ReactPointerEvent<HTMLButtonElement>)=>void;
 onCancel:(event:ReactPointerEvent<HTMLButtonElement>)=>void;
}){
 const [geometry,setGeometry]=useState<OverlayGeometry>(empty);
 useEffect(()=>{
  const viewport=viewportRef.current;
  const anchor=Array.from(viewport?.querySelectorAll<HTMLElement>('.free-canvas-component[data-component-id]')??[])
   .find(el=>el.dataset.componentId===componentId);
  if(!anchor||!viewport)return;
  let frame=0;
  const reposition=()=>{
   frame=0;
   const result=canvasResizeOverlayGeometry(
    anchor.getBoundingClientRect(),viewport.getBoundingClientRect(),
    {width:window.innerWidth,height:window.innerHeight});
   setGeometry(old=>JSON.stringify(old)===JSON.stringify(result)?old:result);
  };
  const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(reposition);};
  // Hovering cannot move the anchor; only a pressed pointer (move/resize) can.
  const whilePressed=(event:PointerEvent)=>{if(event.buttons)schedule();};
  reposition();
  const observer=new ResizeObserver(schedule);
  observer.observe(anchor);observer.observe(viewport);
  window.addEventListener('scroll',schedule,true);
  window.addEventListener('resize',schedule);
  window.addEventListener('pointermove',whilePressed,true);
  return()=>{
   if(frame)window.cancelAnimationFrame(frame);
   observer.disconnect();
   window.removeEventListener('scroll',schedule,true);
   window.removeEventListener('resize',schedule);
   window.removeEventListener('pointermove',whilePressed,true);
  };
 },[componentId,viewportRef]);
 if(typeof document==='undefined')return null;
 const {clip,points}=geometry;
 return createPortal(<div className="canvas-floating-resize-overlay" data-canvas-resize-for={componentId}
   style={{clipPath:`inset(${clip.top}px ${Math.max(0,window.innerWidth-clip.right)}px ${Math.max(0,window.innerHeight-clip.bottom)}px ${clip.left}px)`}}>
   {points.map(point=><button key={point.edge} type="button"
    className={`free-canvas-resize-handle floating-resize-${point.edge}`}
    style={{left:point.left,top:point.top}}
    aria-label={`Resize ${componentLabel} ${point.edge}`}
    title={`Drag ${point.edge} corner or edge to resize` }
    onPointerDown={event=>onStart(event,point.edge)}
    onPointerMove={onMove} onPointerUp={onEnd}
    onPointerCancel={onCancel} onLostPointerCapture={onCancel}
    onClick={event=>event.stopPropagation()}/>)}
 </div>,document.body);
}
