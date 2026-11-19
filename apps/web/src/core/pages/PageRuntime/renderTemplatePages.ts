/** Canvas rasterisation of the *rendered* Print Template, including resolved
 * Smart Components and live record values. Uses ordinary Canvas2D primitives:
 * SVG foreignObject is intentionally avoided because it taints browser canvas.
 */
type Rect={x:number;y:number;width:number;height:number};
function rectWithin(node:Element,origin:DOMRect,scale:number):Rect{
 const rect=node.getBoundingClientRect();
 return {x:(rect.left-origin.left)*scale,y:(rect.top-origin.top)*scale,
  width:rect.width*scale,height:rect.height*scale};
}
const visible=(element:Element,style:CSSStyleDeclaration)=>{
 if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||
   style.opacity==='0')return false;
 if(element instanceof HTMLButtonElement&&element.closest('dialog.formula-print-preview'))return false;
 return !element.hasAttribute('data-print-hide');
};
function paintSurface(ctx:CanvasRenderingContext2D,rect:Rect,style:CSSStyleDeclaration,scale=1){
 const {x,y,width,height}=rect;
 if(width<=0||height<=0)return;
 const alpha=Math.max(0,Math.min(1,Number(style.opacity)||1));
 ctx.save();ctx.globalAlpha=alpha;
 if(style.backgroundColor&&style.backgroundColor!=='transparent'&&
   style.backgroundColor!=='rgba(0, 0, 0, 0)'){
  ctx.fillStyle=style.backgroundColor;ctx.fillRect(x,y,width,height);
 }
 const borders:[string,string,string,string,number,number,number,number]=[
  style.borderTopColor,style.borderRightColor,style.borderBottomColor,style.borderLeftColor,
  (parseFloat(style.borderTopWidth)||0)*scale,(parseFloat(style.borderRightWidth)||0)*scale,
  (parseFloat(style.borderBottomWidth)||0)*scale,(parseFloat(style.borderLeftWidth)||0)*scale
 ];
 // Dashed and dotted borders (receipt line separators) keep their pattern.
 const edge=(kind:string,colour:string,ex:number,ey:number,ew:number,eh:number)=>{
  if(kind==='none'||kind==='hidden'||ew<=0||eh<=0)return;
  ctx.fillStyle=colour;
  if(kind!=='dashed'&&kind!=='dotted'){ctx.fillRect(ex,ey,ew,eh);return;}
  const across=ew>=eh,thick=across?eh:ew,length=across?ew:eh;
  const dash=kind==='dotted'?thick:Math.max(3,thick*3),step=dash*2;
  for(let at=0;at<length;at+=step){
   const piece=Math.min(dash,length-at);
   if(across)ctx.fillRect(ex+at,ey,piece,eh);else ctx.fillRect(ex,ey+at,ew,piece);
  }
 };
 edge(style.borderTopStyle,borders[0],x,y,width,borders[4]);
 edge(style.borderRightStyle,borders[1],x+width-borders[5],y,borders[5],height);
 edge(style.borderBottomStyle,borders[2],x,y+height-borders[6],width,borders[6]);
 edge(style.borderLeftStyle,borders[3],x,y,borders[7],height);
 ctx.restore();
}
function font(style:CSSStyleDeclaration,scale=1):string{
 const fontSize=(parseFloat(style.fontSize)||14)*scale;
 const weight=style.fontWeight||'400';
 const family=style.fontFamily||'Arial,sans-serif';
 return (style.fontStyle==='italic'?'italic ':'')+weight+' '+fontSize+'px '+family;
}
function paintText(ctx:CanvasRenderingContext2D,node:Text,style:CSSStyleDeclaration,origin:DOMRect,scale:number){
 const text=node.textContent??'';
 if(!text.trim())return;
 const range=document.createRange();
 ctx.save();ctx.fillStyle=style.color||'#111';ctx.font=font(style,scale);
 ctx.textAlign='left';ctx.textBaseline='alphabetic';
 let measured=0,offset=0;
 for(const character of text){
  const start=offset;offset+=character.length;
  if(++measured>15000)throw Error('Print Template text length exceeds export limit');
  if(/\s/.test(character)&&character!==' '&&character!=='\u00a0')continue;
  range.setStart(node,start);range.setEnd(node,offset);
  const box=range.getBoundingClientRect();
  if(!box.width||!box.height)continue;
  const x=(box.left-origin.left)*scale;
  const y=(box.bottom-origin.top)*scale-(parseFloat(style.fontSize)||14)*.16*scale;
  ctx.fillText(character,x,y);
 }
 range.detach();
 ctx.restore();
}
async function waitImage(source:HTMLImageElement){
 if(source.complete){
  if(!source.naturalWidth)throw Error('Print Template contains a broken image');
  return;
 }
 await new Promise<void>((resolve,reject)=>{
  source.addEventListener('load',()=>resolve(),{once:true});
  source.addEventListener('error',()=>reject(Error('Print Template image did not load')),{once:true});
 });
}
async function paintMedia(ctx:CanvasRenderingContext2D,node:Element,rect:Rect,style:CSSStyleDeclaration){
 if(rect.width<1||rect.height<1)return;
 if(node instanceof HTMLImageElement){
  await waitImage(node);
  const fit=style.objectFit;
  if(fit==='contain'||fit==='scale-down'||fit==='cover'){
   const rW=rect.width/node.naturalWidth,rH=rect.height/node.naturalHeight;
   const ratio=fit==='cover'?Math.max(rW,rH):Math.min(rW,rH);
   const w=node.naturalWidth*ratio,h=node.naturalHeight*ratio;
   ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
   ctx.drawImage(node,rect.x+(rect.width-w)/2,rect.y+(rect.height-h)/2,w,h);ctx.restore();
  }else ctx.drawImage(node,rect.x,rect.y,rect.width,rect.height);
 }else if(node instanceof HTMLCanvasElement)ctx.drawImage(node,rect.x,rect.y,rect.width,rect.height);
 else if(node instanceof SVGSVGElement){
  const serialized=new XMLSerializer().serializeToString(node);
  if(serialized.length>500000)throw Error('Print Template icon exceeds size limit');
  const url=URL.createObjectURL(new Blob([serialized],{type:'image/svg+xml'}));
  try{
   const icon=new Image();
   await new Promise<void>((resolve,reject)=>{
    icon.onload=()=>resolve();icon.onerror=()=>reject(Error('Print Template SVG icon could not be rendered'));
    icon.src=url;
   });
   ctx.drawImage(icon,rect.x,rect.y,rect.width,rect.height);
  }finally{URL.revokeObjectURL(url);}
 }
}
function paintValue(ctx:CanvasRenderingContext2D,node:Element,rect:Rect,style:CSSStyleDeclaration,scale=1){
 if(!(node instanceof HTMLInputElement)&&!(node instanceof HTMLTextAreaElement)&&
    !(node instanceof HTMLSelectElement))return;
 const value=node instanceof HTMLInputElement
  ?node.type==='password'?'••••':node.value
  :node instanceof HTMLSelectElement?node.selectedOptions[0]?.textContent??'':node.value;
 if(!value)return;
 ctx.save();ctx.fillStyle=style.color||'#111';ctx.font=font(style,scale);
 ctx.textBaseline='middle';ctx.fillText(value,rect.x+5*scale,rect.y+rect.height/2,Math.max(0,rect.width-10*scale));
 ctx.restore();
}
function collect(root:Element,origin:DOMRect,scale:number){
 const nodes=[root,...root.querySelectorAll('*')];
 const visibleNodes:Array<{node:Element;rect:Rect;style:CSSStyleDeclaration}>=[];
 for(const node of nodes){
  const style=getComputedStyle(node);
  if(!visible(node,style)||node.closest('button,[data-print-hide]'))continue;
  const rect=rectWithin(node,origin,scale);
  if(rect.width>0&&rect.height>0)visibleNodes.push({node,rect,style});
 }
 return visibleNodes;
}
type Painted=ReturnType<typeof collect>;
async function paintNodes(ctx:CanvasRenderingContext2D,nodes:Painted,origin:DOMRect,scale:number,from:number,to:number){
 for(const {node,rect,style} of nodes){
  if(rect.y>to||rect.y+rect.height<from)continue;
  paintSurface(ctx,rect,style,scale);
  await paintMedia(ctx,node,rect,style);
  paintValue(ctx,node,rect,style,scale);
  for(const child of node.childNodes){
   if(child.nodeType===Node.TEXT_NODE)
    paintText(ctx,child as Text,style,origin,scale);
  }
 }
}
/** The whole rendered Print Template as one image `width` pixels wide and as tall as its
 * content (a receipt roll has no pages). Used for printing straight to a receipt printer. */
export async function renderTemplateCanvas(root:Element,width:number):Promise<HTMLCanvasElement>{
 if(!Number.isInteger(width)||width<8||width>10000)throw Error('Invalid Print Template width');
 const origin=root.getBoundingClientRect();
 if(origin.width<1)throw Error('Print Template is not visible');
 const scale=width/origin.width;
 const nodes=collect(root,origin,scale);
 const height=Math.ceil(Math.max(origin.height*scale,
  nodes.reduce((end,{rect})=>Math.max(end,rect.y+rect.height),1)));
 if(height>30000)throw Error('Print Template is too long to print');
 const canvas=document.createElement('canvas');
 canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('Canvas is unavailable');
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
 await paintNodes(ctx,nodes,origin,scale,0,height);
 return canvas;
}
export async function renderTemplatePages(root:Element,width:number,height:number):Promise<Uint8Array[]>{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<100||height<100||
   width>10000||height>10000)throw Error('Invalid Print Template page dimensions');
 const origin=root.getBoundingClientRect();
 if(origin.width<1)throw Error('Print Template is not visible');
 const scale=width/origin.width;
 const nodes=collect(root,origin,scale);
 const lastY=nodes.reduce((end,{rect})=>Math.max(end,rect.y+rect.height),height);
 const count=Math.ceil(lastY/height);
 if(count>100)throw Error('Print Template exceeds 100 pages');
 const results:Uint8Array[]=[];
 for(let page=0;page<count;page++){
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas is unavailable');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
  ctx.save();ctx.translate(0,-page*height);
  await paintNodes(ctx,nodes,origin,scale,height*page,height*(page+1));
  ctx.restore();
  const blob=await new Promise<Blob>((resolve,reject)=>{
   canvas.toBlob(file=>file?resolve(file):reject(Error('Unable to capture print page')),
    'image/jpeg',.92);
  });
  results.push(new Uint8Array(await blob.arrayBuffer()));
 }
 return results;
}
