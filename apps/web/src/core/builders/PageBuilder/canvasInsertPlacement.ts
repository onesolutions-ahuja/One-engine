/** Geometry only: choose insertion near the *visible* canvas, not the first
 * vacant location in an off-screen row. No page-specific metadata defaults. */
export type CanvasBounds={left:number;top:number;right:number;bottom:number};
export type CanvasBox={x:number;y:number;width:number;height:number};

const clamp=(value:number,max:number)=>Math.max(0,Math.min(max,value));
export function visibleCanvasBounds(
 stage:{left:number;top:number;width:number;height:number},
 viewport:{left:number;top:number;right:number;bottom:number},
 canvasWidth:number,canvasHeight:number
):CanvasBounds{
 const scaleX=stage.width>0?stage.width/canvasWidth:1;
 const scaleY=stage.height>0?stage.height/canvasHeight:1;
 const left=clamp((viewport.left-stage.left)/scaleX,canvasWidth);
 const top=clamp((viewport.top-stage.top)/scaleY,canvasHeight);
 return {
  left,top,
  right:Math.max(left,clamp((viewport.right-stage.left)/scaleX,canvasWidth)),
  bottom:Math.max(top,clamp((viewport.bottom-stage.top)/scaleY,canvasHeight))
 };
}
export function placeNewCanvasComponent(input:{
 canvasWidth:number;canvasHeight:number;width:number;height:number;
 used:readonly CanvasBox[];visible?:CanvasBounds;
}):{x:number;y:number}{
 const {canvasWidth,canvasHeight,width,height,used}=input;
 const maxX=Math.max(0,canvasWidth-width),maxY=Math.max(0,canvasHeight-height);
 const v=input.visible??{left:0,top:0,right:canvasWidth,bottom:canvasHeight};
 // Place at the centre of the *screenful the user is looking at*, not
 // the centre or the top of the full authored page.
 const targetX=clamp(Math.round((v.left+v.right-width)/2),maxX);
 const targetY=clamp(Math.round((v.top+v.bottom-height)/2),maxY);
 const clear=(x:number,y:number)=>used.every(item=>
  x+width<=item.x||item.x+item.width<=x||
  y+height<=item.y||item.y+item.height<=y);
 // Never search distant off-screen rows merely because the visible area is
 // occupied. Prefer an unoccupied position nearest the visible centre.
 const positions=(start:number,end:number,max:number,target:number)=>{
  const low=Math.max(0,Math.ceil(start)),high=Math.min(max,Math.floor(end));
  if(low>high)return [target]; // Small viewport: centre with partial visibility.
  const choices=new Set<number>([Math.max(low,Math.min(high,target)),low,high]);
  const step=high-low>2400?64:24;
  for(let n=low;n<=high;n+=step)choices.add(n);
  return [...choices].sort((a,b)=>Math.abs(a-target)-Math.abs(b-target));
 };
 const xs=positions(v.left,v.right-width,maxX,targetX);
 const ys=positions(v.top,v.bottom-height,maxY,targetY);
 for(const y of ys)for(const x of xs)if(clear(x,y))return{x,y};
 // A full viewport is still the user's insertion target; overlapping here is
 // more predictable than silently adding a component at the far end of a page.
 return{x:targetX,y:targetY};
}
