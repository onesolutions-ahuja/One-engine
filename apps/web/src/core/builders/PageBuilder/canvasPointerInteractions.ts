/** Shared Page Builder gesture rules: scrollbars are controls, content is movable.
 * The Page Builder frame (not its embedded app) owns geometry on a free canvas.
 */
export type CanvasRect = {x:number;y:number;width:number;height:number};
export type CanvasDimensions = {width:number;height:number};

/** A slide and the shapes on it are separate geometries.
 * A drag/resize can only update a shape inside the user's configured page.
 * Enlarging a component must NEVER alter the page width or height.
 */
export function constrainCanvasRect(rect:CanvasRect,page:CanvasDimensions):CanvasRect {
 const w=Math.max(1,Math.floor(page.width)),h=Math.max(1,Math.floor(page.height));
 const x=Math.max(0,Math.min(w-1,Math.round(rect.x)));
 const y=Math.max(0,Math.min(h-1,Math.round(rect.y)));
 return {x,y,width:Math.max(1,Math.min(w-x,Math.round(rect.width))),
   height:Math.max(1,Math.min(h-y,Math.round(rect.height)))};
}

export type CanvasScrollMetrics={
 rect:{left:number;top:number;right:number;bottom:number};
 scrollHeight:number;clientHeight:number;offsetHeight:number;
 scrollWidth:number;clientWidth:number;offsetWidth:number;
 overflowY:string;overflowX:string;direction:string;
};

/** Test the genuine rail, not all of the content in a scrollable component. */
export function canvasScrollbarRailHit(
 m:CanvasScrollMetrics,clientX:number,clientY:number
):boolean {
 const vertical=m.scrollHeight>m.clientHeight+1;
 const horizontal=m.scrollWidth>m.clientWidth+1;
 const width=Math.max(8,m.offsetWidth-m.clientWidth);
 const height=Math.max(8,m.offsetHeight-m.clientHeight);
 const inside=clientX>=m.rect.left&&clientX<=m.rect.right
   &&clientY>=m.rect.top&&clientY<=m.rect.bottom;
 if(!inside)return false;
 return (vertical&&['auto','scroll'].includes(m.overflowY)
  &&(clientX>=m.rect.right-width||m.direction==='rtl'&&clientX<=m.rect.left+width))
  ||(horizontal&&['auto','scroll'].includes(m.overflowX)
    &&clientY>=m.rect.bottom-height);
}

/** Check every scrollable descendant through the frame, including native item
 * grids, smart carts/tabs/calendars, and future component types.
 */
export function canvasScrollbarHit(
  target:Element,clientX:number,clientY:number,container:Element
):boolean {
 let node:Element|null=target;
 while(node&&node!==container){
   if(node instanceof HTMLElement){
     const rect=node.getBoundingClientRect();
     const styles=getComputedStyle(node);
     if(canvasScrollbarRailHit({
       rect,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,
       offsetHeight:node.offsetHeight,scrollWidth:node.scrollWidth,
       clientWidth:node.clientWidth,offsetWidth:node.offsetWidth,
       overflowY:styles.overflowY,overflowX:styles.overflowX,
       direction:styles.direction
     },clientX,clientY))return true;
   }
   node=node.parentElement;
 }
 return false;
}
