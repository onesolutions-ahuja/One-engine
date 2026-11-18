import {useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import {isStandalonePagePresentation,pageCanvasPresentationStyle} from './pageRuntimePresentation';
import {runtimeCanvasWidthScale,runtimeCanvasExtraWidth,settleCanvasWidth} from './runtimeCanvasSizing';
import {flowPrintCanvas} from './printTemplateFlow';

/**
 * Published pages and compiled Builder Preview use the same width-first layout.
 * A screen narrower than the authored canvas scales the whole page uniformly;
 * height never forces an extra shrink. Taller pages scroll naturally.
 *
 * When the viewport is wider than the authored canvas, the background fills
 * the available width while authored controls keep their native size. Large
 * surfaces/right-hand panels adapt via the shared canvas-extra CSS variable.
 */
export default function ResponsivePageCanvas({
  page,children
}:{
  page:Pick<LightningPageMetadata,'canvasWidth'|'canvasHeight'|'layoutMode'|'components'>&{pageType?:string};
  children:ReactNode;
}) {
  const frame=useRef<HTMLDivElement>(null);
  const [availableWidth,setAvailableWidth]=useState(page.canvasWidth);
  // Last small width step (a scrollbar appearing/disappearing), to stop a loop:
  // new width -> new scale -> new height -> scrollbar toggles -> width flips back.
  const lastStep=useRef<{from:number;at:number}|null>(null);

  useLayoutEffect(()=>{
    const target=frame.current;
    if(!target)return;
    const update=()=>{
      // Layout width, not getBoundingClientRect(): the parent preview device
      // frame can be transformed to fit the editor without changing CSS pixels.
      const next=Math.max(1,target.clientWidth||page.canvasWidth);
      setAvailableWidth(previous=>settleCanvasWidth(previous,next,lastStep.current,
        typeof performance!=='undefined'?performance.now():Date.now(),step=>{lastStep.current=step;}));
    };
    update();
    const observer=new ResizeObserver(update);
    observer.observe(target);
    return()=>observer.disconnect();
  },[page.canvasWidth]);

  // Print templates fit their content (see printTemplateFlow): lists grow or shrink to their rows.
  const printTemplate=page.pageType==='Print Template';
  const canvasRef=useRef<HTMLDivElement>(null);
  const [fittedHeight,setFittedHeight]=useState<number|null>(null);
  useLayoutEffect(()=>{
   const canvas=canvasRef.current;
   if(!printTemplate||!canvas)return;
   let frameId=0;
   const fit=()=>{cancelAnimationFrame(frameId);frameId=requestAnimationFrame(()=>{
    observer.disconnect();
    const height=flowPrintCanvas(canvas);
    setFittedHeight(previous=>previous===height?previous:height);
    observer.observe(canvas,{childList:true,subtree:true,characterData:true});
   });};
   const observer=new MutationObserver(fit);
   fit();
   return()=>{cancelAnimationFrame(frameId);observer.disconnect();};
  },[printTemplate]);
  const canvasHeight=printTemplate&&fittedHeight?fittedHeight:page.canvasHeight;
  const standalone=isStandalonePagePresentation(page);
  const scale=standalone?1:runtimeCanvasWidthScale(page.canvasWidth,availableWidth);
  const extra=standalone?0:runtimeCanvasExtraWidth(page.canvasWidth,availableWidth);
  const canvasStyle: CSSProperties & { '--md-runtime-canvas-extra': string }={
    ...pageCanvasPresentationStyle(page),
    ...(printTemplate&&fittedHeight?{height:fittedHeight}:{}),
    ...(!standalone && extra > 0 ? {width:'100%'} : {}),
    '--md-runtime-canvas-extra':extra+'px',
    transform:scale<1?`scale(${scale})`:undefined,
    transformOrigin:'top left'
  };

  return <div ref={frame} className="page-responsive-canvas-frame" style={{
    position:'relative',width:'100%',minWidth:0,
    height:standalone?'100dvh':Math.ceil(canvasHeight*scale),
    overflow:'hidden'
  }}>
    <div ref={canvasRef} className="free-canvas-runtime" data-layout-mode="free-canvas"
     data-print-template={printTemplate?'true':undefined} style={canvasStyle}>
      {children}
    </div>
  </div>;
}
