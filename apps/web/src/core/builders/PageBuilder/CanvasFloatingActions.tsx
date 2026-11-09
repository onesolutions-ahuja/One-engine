import {useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import './CanvasFloatingActions.css';

/** Builder chrome is portalled outside the transformed canvas stacking context.
 * Authored component z-order stays unchanged, including send-back/bring-front. */
export default function CanvasFloatingActions({componentId,viewportRef,children,enabled=true}:{
  componentId:string;
  enabled?:boolean;
  viewportRef:RefObject<HTMLDivElement|null>;
  children:ReactNode;
}){
  const floatingRef=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({top:0,left:0,visible:false});
  // Portal effects must run after the canvas anchor has been attached to its viewport.
  useEffect(()=>{
    const viewport=viewportRef.current;
    if(!viewport||!enabled)return;
    const anchor=Array.from(viewport.querySelectorAll<HTMLElement>('.free-canvas-component[data-component-id]'))
      .find(element=>element.dataset.componentId===componentId);
    if(!anchor)return;
    let frame=0;
    const reposition=()=>{
      frame=0;
      const target=anchor.getBoundingClientRect();
      const visible=viewport.getBoundingClientRect();
      const panel=floatingRef.current?.getBoundingClientRect();
      const width=panel?.width||200,height=panel?.height||44;
      const isVisible=target.bottom>visible.top&&target.top<visible.bottom
        &&target.right>visible.left&&target.left<visible.right;
      // Anchor to the visible portion, not a huge offscreen component bottom.
      // Otherwise tall carts/grids send the action toolbar to the window edge.
      const visibleTop=Math.max(target.top,visible.top);
      const visibleBottom=Math.min(target.bottom,visible.bottom);
      const viewportTop=Math.max(8,visible.top+8);
      const viewportBottom=Math.min(window.innerHeight-8,visible.bottom-8);
      const above=visibleTop-height-12>=viewportTop;
      const below=visibleBottom+height+12<=viewportBottom;
      const top=above?visibleTop-height-12
        :below?visibleBottom+12:visibleTop+12;
      const next={
        top:Math.max(8,Math.min(window.innerHeight-height-8,top)),
        left:Math.max(8,Math.min(window.innerWidth-width-8,target.left+target.width/2-width/2)),
        visible:isVisible
      };
      setPosition(previous=>previous.top===next.top&&previous.left===next.left
        &&previous.visible===next.visible?previous:next);
    };
    const schedule=()=>{
      if(frame)return;
      frame=window.requestAnimationFrame(reposition);
    };
    // Hovering cannot move the anchor; only a pressed pointer (move/resize) can.
    const whilePressed=(event:PointerEvent)=>{if(event.buttons)schedule();};
    reposition();
    const observer=new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(viewport);
    if(floatingRef.current)observer.observe(floatingRef.current);
    window.addEventListener('resize',schedule);
    // A capture listener sees scrolling in the page, nested panels, or document.
    window.addEventListener('scroll',schedule,true);
    // Keep the toolbar attached while a selected component is moved/resized.
    window.addEventListener('pointermove',whilePressed,true);
    return()=>{
      if(frame)window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize',schedule);
      window.removeEventListener('scroll',schedule,true);
      window.removeEventListener('pointermove',whilePressed,true);
    };
  },[componentId,viewportRef,enabled]);
  if(!enabled)return <>{children}</>;
  if(typeof document==='undefined')return null;
  return createPortal(<div className="canvas-unified-builder canvas-floating-actions-host"
    ref={floatingRef} data-canvas-actions-for={componentId}
    style={{top:position.top,left:position.left,visibility:position.visible?'visible':'hidden'}}>
    {children}
  </div>,document.body);
}
