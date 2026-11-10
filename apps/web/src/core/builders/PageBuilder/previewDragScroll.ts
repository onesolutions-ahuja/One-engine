/** Touch-style scrolling for the Builder's Phone/Tablet Preview screen, like
 * Chrome's device mode: press and drag with the mouse (or trackpad click) to
 * scroll, and a quick flick keeps scrolling and slows down. Wheel and two-finger
 * trackpad scrolling keep working natively. A press that does not move stays a
 * normal click; a drag never clicks what it started on. */

/** Pixels the pointer must move before a press becomes a scroll. */
export const DRAG_START_PX=6;
/** Flick speed (px/ms) below which no fling happens. */
export const MIN_FLING_SPEED=0.05;
/** Fraction of speed kept per 16ms frame while flinging. */
export const FLING_FRICTION=0.95;

/** Inputs and editable text keep their own mouse behaviour (select text, drag sliders). */
const OWN_POINTER='input,textarea,select,[contenteditable="true"],[contenteditable=""],[data-no-drag-scroll]';

type Axis='x'|'y';

/** The axis a drag mostly moves along. */
export function dragAxis(dx:number,dy:number):Axis{
 return Math.abs(dx)>Math.abs(dy)?'x':'y';
}

/** Can this box scroll further in the direction the content would move? */
export function canScroll(box:{scrollTop:number;scrollLeft:number;scrollHeight:number;scrollWidth:number;
 clientHeight:number;clientWidth:number},axis:Axis,delta:number):boolean{
 if(axis==='y'){
  const max=box.scrollHeight-box.clientHeight;
  return max>0&&(delta>0?box.scrollTop<max:box.scrollTop>0);
 }
 const max=box.scrollWidth-box.clientWidth;
 return max>0&&(delta>0?box.scrollLeft<max:box.scrollLeft>0);
}

/** Speed (px/ms) from recent pointer samples, newest last, over the last ~100ms. */
export function flingSpeed(samples:ReadonlyArray<{t:number;x:number;y:number}>,axis:Axis):number{
 if(samples.length<2)return 0;
 const last=samples[samples.length-1];
 const first=samples.find(sample=>last.t-sample.t<=100)??samples[0];
 const time=last.t-first.t;
 if(time<=0)return 0;
 return ((axis==='x'?last.x-first.x:last.y-first.y))/time;
}

/** Next speed after one frame of friction; 0 once it is too slow to notice. */
export function nextFlingSpeed(speed:number,frameMs:number):number{
 const next=speed*Math.pow(FLING_FRICTION,frameMs/16);
 return Math.abs(next)<MIN_FLING_SPEED?0:next;
}

const scrollable=(element:Element,axis:Axis)=>{
 const style=getComputedStyle(element);
 const overflow=axis==='y'?style.overflowY:style.overflowX;
 return /(auto|scroll|overlay)/.test(overflow);
};

/** Nearest box from the pressed element up to the screen that can scroll this way
 * (a horizontal card row scrolls sideways, the page or an open popup page scrolls
 * up and down). Nothing scrollable that way → the drag does nothing. */
function scrollTarget(from:Element|null,root:HTMLElement,axis:Axis,delta:number):HTMLElement|null{
 for(let node=from;node&&node!==root;node=node.parentElement){
  if(node instanceof HTMLElement&&scrollable(node,axis)&&canScroll(node,axis,delta))return node;
 }
 return null;
}

/** Wire drag-to-scroll on the Preview screen. Returns a cleanup function. */
export function attachPreviewDragScroll(root:HTMLElement):()=>void{
 let fling=0;
 const stopFling=()=>{if(fling)cancelAnimationFrame(fling);fling=0;};
 const down=(event:PointerEvent)=>{
  stopFling();
  // Touch and pen already scroll natively; only the mouse needs help.
  if(event.pointerType!=='mouse'||event.button!==0)return;
  const start=event.target as Element|null;
  if(start?.closest?.(OWN_POINTER))return;
  const startX=event.clientX,startY=event.clientY;
  let lastX=startX,lastY=startY,dragging=false,axis:Axis='y';
  let target:HTMLElement|null=null;
  const samples:{t:number;x:number;y:number}[]=[];
  const move=(next:PointerEvent)=>{
   const dx=next.clientX-startX,dy=next.clientY-startY;
   if(!dragging){
    if(Math.hypot(dx,dy)<DRAG_START_PX)return;
    dragging=true;
    axis=dragAxis(dx,dy);
    // Content moves with the finger: dragging up scrolls down.
    target=scrollTarget(start,root,axis,axis==='y'?-dy:-dx);
    root.setAttribute('data-drag-scrolling','true');
    window.getSelection?.()?.removeAllRanges();
    try{root.setPointerCapture(next.pointerId);}catch{/* pointer already released */}
   }
   next.preventDefault();
   const stepX=next.clientX-lastX,stepY=next.clientY-lastY;
   lastX=next.clientX;lastY=next.clientY;
   if(target){if(axis==='y')target.scrollTop-=stepY;else target.scrollLeft-=stepX;}
   samples.push({t:next.timeStamp,x:next.clientX,y:next.clientY});
   if(samples.length>12)samples.shift();
  };
  const end=(next:PointerEvent)=>{
   window.removeEventListener('pointermove',move);
   window.removeEventListener('pointerup',end);
   window.removeEventListener('pointercancel',end);
   if(!dragging)return;
   root.removeAttribute('data-drag-scrolling');
   try{root.releasePointerCapture(next.pointerId);}catch{/* already released */}
   // The press became a scroll: swallow the click it would otherwise produce.
   const swallow=(click:MouseEvent)=>{click.preventDefault();click.stopPropagation();};
   root.addEventListener('click',swallow,{capture:true,once:true});
   setTimeout(()=>root.removeEventListener('click',swallow,{capture:true}),0);
   if(next.type==='pointercancel'||!target)return;
   const box=target;
   let speed=-flingSpeed(samples,axis);
   let previous=performance.now();
   const step=(now:number)=>{
    const frame=Math.min(48,now-previous);previous=now;
    if(axis==='y')box.scrollTop+=speed*frame;else box.scrollLeft+=speed*frame;
    speed=nextFlingSpeed(speed,frame);
    fling=speed?requestAnimationFrame(step):0;
   };
   if(Math.abs(speed)>=MIN_FLING_SPEED)fling=requestAnimationFrame(step);
  };
  // On the window, so a release outside the screen still ends the drag.
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
 };
 // A wheel or two-finger trackpad scroll stops any fling.
 root.addEventListener('pointerdown',down);
 root.addEventListener('wheel',stopFling,{passive:true});
 return ()=>{
  stopFling();
  root.removeEventListener('pointerdown',down);
  root.removeEventListener('wheel',stopFling);
 };
}
