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
  const [size,setSize]=useState({width:page.canvasWidth,height:Number.POSITIVE_INFINITY});
  // A landscape (screen-shaped) canvas is a fixed screen such as a till: fit
  // both width and height so nothing drops below the window. Taller canvases
  // are scrolling pages and keep fitting width only.
  const screenShaped=page.canvasHeight<=page.canvasWidth;
  useEffect(()=>{
    const target=frame.current;
    if(!target)return;
    const update=()=>{
      const box=target.getBoundingClientRect();
      setSize({width:box.width||page.canvasWidth,
        height:screenShaped&&typeof window!=='undefined'
          ?Math.max(200,window.innerHeight-Math.max(0,box.top)):Number.POSITIVE_INFINITY});
    };
    update();
    const observer=new ResizeObserver(update);
    observer.observe(target);
    if(typeof window!=='undefined')window.addEventListener('resize',update);
    return()=>{observer.disconnect();if(typeof window!=='undefined')window.removeEventListener('resize',update);};
  },[page.canvasWidth,page.canvasHeight,screenShaped]);
  const standalone=isStandalonePagePresentation(page);
  const scale=standalone?1:Math.min(1,Math.max(.1,size.width/page.canvasWidth,0),
    Math.max(.1,size.height/page.canvasHeight));
  return <div ref={frame} className="page-responsive-canvas-frame" style={{
    position:'relative',width:'100%',
    height:standalone?'100dvh':Math.ceil(page.canvasHeight*scale),
    overflow:'hidden'
  }}>
    <div className="free-canvas-runtime" data-layout-mode="free-canvas" style={{
      ...pageCanvasPresentationStyle(page),
      transform:scale<1?`scale(${scale})`:undefined,transformOrigin:'top left',
      // Centre a height-fitted screen horizontally instead of leaving a gap on the right.
      marginLeft:scale<1&&size.width>page.canvasWidth*scale+1?Math.floor((size.width-page.canvasWidth*scale)/2):undefined
    }}>
      {children}
    </div>
  </div>;
}
