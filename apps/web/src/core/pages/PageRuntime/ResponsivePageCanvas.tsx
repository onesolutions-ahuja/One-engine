import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import {isStandalonePagePresentation,pageCanvasPresentationStyle} from './pageRuntimePresentation';

/** Maintain authored pixel positions while scaling the *whole* canvas to the
 * runtime container. ResizeObserver avoids fixed viewport guesses or clipping. */
export default function ResponsivePageCanvas({
  page,children
}:{
  page:Pick<LightningPageMetadata,'canvasWidth'|'canvasHeight'|'layoutMode'|'components'>;
  children:ReactNode;
}) {
  const frame=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(page.canvasWidth);
  useEffect(()=>{
    const target=frame.current;
    if(!target)return;
    const update=()=>setWidth(target.getBoundingClientRect().width||page.canvasWidth);
    update();
    const observer=new ResizeObserver(update);
    observer.observe(target);
    return()=>observer.disconnect();
  },[page.canvasWidth]);
  const standalone=isStandalonePagePresentation(page);
  const scale=standalone?1:Math.min(1,Math.max(.1,width/page.canvasWidth));
  return <div ref={frame} className="page-responsive-canvas-frame" style={{
    position:'relative',width:'100%',
    height:standalone?'100dvh':Math.ceil(page.canvasHeight*scale),
    overflow:'hidden'
  }}>
    <div className="free-canvas-runtime" data-layout-mode="free-canvas" style={{
      ...pageCanvasPresentationStyle(page),
      transform:scale<1?`scale(${scale})`:undefined,transformOrigin:'top left'
    }}>
      {children}
    </div>
  </div>;
}
