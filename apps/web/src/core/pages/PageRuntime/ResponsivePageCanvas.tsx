import {useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import {isStandalonePagePresentation,pageCanvasPresentationStyle} from './pageRuntimePresentation';
import {runtimeCanvasWidthScale,runtimeCanvasExtraWidth} from './runtimeCanvasSizing';

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
  page:Pick<LightningPageMetadata,'canvasWidth'|'canvasHeight'|'layoutMode'|'components'>;
  children:ReactNode;
}) {
  const frame=useRef<HTMLDivElement>(null);
  const [availableWidth,setAvailableWidth]=useState(page.canvasWidth);

  useLayoutEffect(()=>{
    const target=frame.current;
    if(!target)return;
    const update=()=>{
      // Layout width, not getBoundingClientRect(): the parent preview device
      // frame can be transformed to fit the editor without changing CSS pixels.
      const next=Math.max(1,target.clientWidth||page.canvasWidth);
      setAvailableWidth(previous=>Math.abs(previous-next)<.5?previous:next);
    };
    update();
    const observer=new ResizeObserver(update);
    observer.observe(target);
    return()=>observer.disconnect();
  },[page.canvasWidth]);

  const standalone=isStandalonePagePresentation(page);
  const scale=standalone?1:runtimeCanvasWidthScale(page.canvasWidth,availableWidth);
  const extra=standalone?0:runtimeCanvasExtraWidth(page.canvasWidth,availableWidth);
  const canvasStyle={
    ...pageCanvasPresentationStyle(page),
    ...(!standalone && extra > 0 ? {width:'100%'} : {}),
    '--md-runtime-canvas-extra':extra+'px',
    transform:scale<1?`scale(${scale})`:undefined,
    transformOrigin:'top left'
  } as CSSProperties;

  return <div ref={frame} className="page-responsive-canvas-frame" style={{
    position:'relative',width:'100%',minWidth:0,
    height:standalone?'100dvh':Math.ceil(page.canvasHeight*scale),
    overflow:'hidden'
  }}>
    <div className="free-canvas-runtime" data-layout-mode="free-canvas" style={canvasStyle}>
      {children}
    </div>
  </div>;
}
