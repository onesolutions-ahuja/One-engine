/**
 * Print templates fit their content: a receipt with 1 line uses little paper, 100 lines
 * use more. Every list (a box that scrolls on screen: table, cart) takes the height of its
 * rows, everything placed below it moves up or down by the same amount, and the page ends
 * just under the last component. Positions are the authored ones each time (idempotent).
 */
export type FlowBox={top:number;height:number;delta:number};
/** New tops/heights for boxes, given each box's content change (delta, + grows / - shrinks). */
export function flowBoxes(boxes:readonly FlowBox[]):Array<{top:number;height:number}>{
 const order=boxes.map((box,index)=>({box,index})).sort((a,b)=>a.box.top-b.box.top);
 const out=boxes.map(box=>({top:box.top,height:box.height}));
 for(const {box,index} of order){
  if(!box.delta)continue;
  const bottom=box.top+box.height;
  out[index].height=Math.max(24,box.height+box.delta);
  const moved=out[index].height-box.height;
  // Everything that starts at or below this list's authored bottom moves with it.
  boxes.forEach((other,i)=>{if(i!==index&&other.top>=bottom-1)out[i].top+=moved;});
 }
 return out;
}
/** The page height: just under the lowest component, plus the authored bottom margin. */
export function flowedHeight(boxes:ReadonlyArray<{top:number;height:number}>,margin=20):number{
 return Math.ceil(boxes.reduce((most,box)=>Math.max(most,box.top+box.height),0)+margin);
}

const scrolls=(element:HTMLElement)=>{const y=getComputedStyle(element).overflowY;return y==='auto'||y==='scroll';};
/** How much taller (or shorter) a component's lists need to be to show all their rows. */
function contentDelta(wrapper:HTMLElement):number{
 const changes:number[]=[];
 for(const element of wrapper.querySelectorAll<HTMLElement>('*')){
  if(!scrolls(element)||element.clientHeight<8)continue;
  const height=element.style.height;
  element.style.height='0px';
  const natural=element.scrollHeight;
  element.style.height=height;
  changes.push(natural-element.clientHeight);
 }
 // Several lists in one component: it grows for the longest, shrinks by the least.
 return changes.length?Math.max(...changes):0;
}
/** Apply to a rendered free-canvas print template; returns the fitted page height. */
export function flowPrintCanvas(canvas:HTMLElement):number{
 const wrappers=[...canvas.querySelectorAll<HTMLElement>(':scope > .free-canvas-runtime-component')];
 const boxes=wrappers.map(wrapper=>{
  wrapper.dataset.printTop??=String(parseFloat(wrapper.style.top)||0);
  wrapper.dataset.printHeight??=String(parseFloat(wrapper.style.height)||wrapper.offsetHeight);
  return {top:Number(wrapper.dataset.printTop),height:Number(wrapper.dataset.printHeight),delta:0};
 });
 // Measure at authored size first, so repeated runs give the same answer.
 wrappers.forEach((wrapper,i)=>{wrapper.style.top=boxes[i].top+'px';wrapper.style.height=boxes[i].height+'px';});
 wrappers.forEach((wrapper,i)=>{boxes[i].delta=contentDelta(wrapper);});
 const next=flowBoxes(boxes);
 wrappers.forEach((wrapper,i)=>{wrapper.style.top=next[i].top+'px';wrapper.style.height=next[i].height+'px';});
 return flowedHeight(next);
}
