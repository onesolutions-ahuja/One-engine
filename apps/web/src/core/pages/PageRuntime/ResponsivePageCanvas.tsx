import {useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import {isStandalonePagePresentation,pageCanvasPresentationStyle} from './pageRuntimePresentation';
import {runtimeCanvasWidthScale,runtimeCanvasExtraWidth,settleCanvasWidth,runtimeAppScreenScale,runtimeCanvasExtra} from './runtimeCanvasSizing';
import {flowPrintCanvas} from './printTemplateFlow';
import {openerMirrorKey} from '../../authentication/TillDevice/deviceTill';
import {onPairedScreenPage} from '../../authentication/PairedScreen/pairedScreen';

/** A display screen (customer display, kitchen screen...) shows the whole page with no
 * scrolling: it scales to fit the window's height as well as its width. */
function shownAsScreen():boolean{
  try{return typeof window!=='undefined'&&(Boolean(openerMirrorKey())||onPairedScreenPage());}catch{return false;}
}

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
  const [screen]=useState(shownAsScreen);
  const [availableHeight,setAvailableHeight]=useState(0);
  // A published app (not Builder Preview, print or a paired display) fills the whole screen:
  // no grey band to the right or below the page, whatever the screen size.
  const [appScreen,setAppScreen]=useState(false);
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
    const app=!screen&&Boolean(target.closest('.md-app-runtime'));
    setAppScreen(app);
    // The scrolling area the page sits in (the app workspace), else the window.
    const scroller=app?target.closest<HTMLElement>('.workspace-records'):null;
    const updateHeight=()=>{
      if(!screen&&!app)return;
      if(scroller){
        const top=target.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop;
        setAvailableHeight(Math.max(1,scroller.clientHeight-Math.max(0,top)));
        return;
      }
      const top=Math.max(0,target.getBoundingClientRect().top+window.scrollY);
      setAvailableHeight(Math.max(1,window.innerHeight-top));
    };
    update();updateHeight();
    const observer=new ResizeObserver(()=>{update();updateHeight();});
    observer.observe(target);
    if(scroller)observer.observe(scroller);
    if(screen||app)window.addEventListener('resize',updateHeight);
    return()=>{observer.disconnect();window.removeEventListener('resize',updateHeight);};
  },[page.canvasWidth,screen]);

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
  const fillsScreen=appScreen&&!standalone&&!printTemplate&&availableHeight>0;
  const widthScale=standalone?1:runtimeCanvasWidthScale(page.canvasWidth,availableWidth);
  const scale=fillsScreen?runtimeAppScreenScale(page.canvasWidth,canvasHeight,availableWidth,availableHeight)
    :screen&&!standalone&&!printTemplate&&availableHeight>0
    ?Math.min(widthScale,runtimeCanvasWidthScale(canvasHeight,availableHeight)):widthScale;
  const heightFitted=!fillsScreen&&scale<widthScale;
  // App screen: whatever is left over on either side becomes part of the page (see
  // runtimeResponsiveComponentStyle / runtimeVerticalComponentStyle), never a grey band.
  const fill=fillsScreen?runtimeCanvasExtra(page.canvasWidth,canvasHeight,scale,availableWidth,availableHeight):{x:0,y:0};
  const extra=fillsScreen?fill.x:standalone||heightFitted?0:runtimeCanvasExtraWidth(page.canvasWidth,availableWidth);
  const shownHeight=canvasHeight+fill.y;
  const canvasStyle: CSSProperties & { '--md-runtime-canvas-extra': string; '--md-runtime-canvas-extra-y': string }={
    ...pageCanvasPresentationStyle(page),
    ...(printTemplate&&fittedHeight?{height:fittedHeight}:{}),
    ...(fillsScreen?{width:page.canvasWidth+fill.x,height:shownHeight}
      :!standalone && extra > 0 ? {width:'100%'} : {}),
    '--md-runtime-canvas-extra':extra+'px',
    '--md-runtime-canvas-extra-y':fill.y+'px',
    transform:scale<1?`scale(${scale})`:undefined,
    transformOrigin:'top left',
    // Fitted to a screen's height: centre the page across the spare width.
    ...(heightFitted?{marginLeft:Math.max(0,Math.floor((availableWidth-page.canvasWidth*scale)/2))}:{})
  };

  return <div ref={frame} className="page-responsive-canvas-frame" style={{
    position:'relative',width:'100%',minWidth:0,
    height:standalone?'100dvh':fillsScreen?Math.floor(shownHeight*scale):Math.ceil(canvasHeight*scale),
    overflow:'hidden'
  }}>
    <div ref={canvasRef} className="free-canvas-runtime" data-layout-mode="free-canvas"
     data-print-template={printTemplate?'true':undefined}
     // The designed paper size: PRINT() prints at exactly this size (see printPaper.ts).
     data-print-width={printTemplate?page.canvasWidth:undefined}
     data-print-height={printTemplate?page.canvasHeight:undefined} style={canvasStyle}>
      {children}
    </div>
  </div>;
}
