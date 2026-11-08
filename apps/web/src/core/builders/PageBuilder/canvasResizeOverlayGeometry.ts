/** Resize grips show the true component bounds within the visible editor only.
 * Unlike temporary proxy grips, every visible handle is on its real edge.
 * Scroll the page viewport to reach a component edge outside the viewport.
 */
export type OverlayRect={left:number;top:number;right:number;bottom:number;width:number;height:number};
export type OverlayEdge='n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
const edges:OverlayEdge[]=['n','ne','e','se','s','sw','w','nw'];
const xRatio:Record<OverlayEdge,number>={n:.5,ne:1,e:1,se:1,s:.5,sw:0,w:0,nw:0};
const yRatio:Record<OverlayEdge,number>={n:0,ne:0,e:.5,se:1,s:1,sw:1,w:.5,nw:0};
export type OverlayPoint={edge:OverlayEdge;left:number;top:number;proxy:false};
export type OverlayGeometry={points:OverlayPoint[];clip:{left:number;top:number;right:number;bottom:number}};
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(value,high));
export function canvasResizeOverlayGeometry(
 box:OverlayRect,viewport:OverlayRect,screen:{width:number;height:number}
):OverlayGeometry {
 const clip={left:clamp(viewport.left,0,screen.width),top:clamp(viewport.top,0,screen.height),
  right:clamp(viewport.right,0,screen.width),bottom:clamp(viewport.bottom,0,screen.height)};
 const visible={left:Math.max(box.left,clip.left),top:Math.max(box.top,clip.top),
  right:Math.min(box.right,clip.right),bottom:Math.min(box.bottom,clip.bottom)};
 if(visible.right-visible.left<20||visible.bottom-visible.top<20)
  return {points:[],clip};
 const points:OverlayPoint[]=[];
 for(const edge of edges){
  const x=box.left+box.width*xRatio[edge];
  const y=box.top+box.height*yRatio[edge];
  // A PowerPoint-style grip always represents the actual component edge.
  // Never relocate an off-screen edge into the middle of the component.
  if(x<clip.left+10||x>clip.right-10||y<clip.top+10||y>clip.bottom-10)continue;
  points.push({edge,left:x,top:y,proxy:false});
 }
 return {points,clip};
}
