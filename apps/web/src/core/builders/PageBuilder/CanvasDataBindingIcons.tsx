import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Database} from 'lucide-react';
import type {BuilderRibbonProperty} from './builderPropertyInventory';
import {bindingDisplayLabel,type CanvasBindingTarget} from './canvasDataBindingTargets';
import './CanvasDataBindingIcons.css';

type Target=Pick<CanvasBindingTarget,'propertyKey'|'itemIndex'|'itemId'>;
type BindingEntry=Target&{key:string;label:string};
type IconPosition=BindingEntry&{x:number;y:number};
type OverflowPosition={x:number;y:number;viewportWidth:number;viewportHeight:number};
type Rect={left:number;top:number;right:number;bottom:number;width:number;height:number};
const ICON_SIZE=22;
const SPACING=4;
const validRect=(r:Rect)=>Number.isFinite(r.left)&&Number.isFinite(r.top)&&r.width>0&&r.height>0;
const overlaps=(a:{x:number;y:number},b:{x:number;y:number})=>
 Math.abs(a.x-b.x)<ICON_SIZE+SPACING&&Math.abs(a.y-b.y)<ICON_SIZE+SPACING;
function clipRect(element:HTMLElement,host:HTMLElement):Rect|null{
 const actual=element.getBoundingClientRect();
 if(!validRect(actual))return null;
 let left=actual.left,top=actual.top,right=actual.right,bottom=actual.bottom;
 for(let node=element.parentElement;node&&node!==host;node=node.parentElement){
  const style=getComputedStyle(node);
  if(!/(auto|scroll|hidden|clip)/.test(style.overflowX+' '+style.overflowY))continue;
  const clip=node.getBoundingClientRect();
  left=Math.max(left,clip.left);top=Math.max(top,clip.top);
  right=Math.min(right,clip.right);bottom=Math.min(bottom,clip.bottom);
 }
 if(right-left<8||bottom-top<8)return null;
 return {left,top,right,bottom,width:right-left,height:bottom-top};
}
function textRect(element:HTMLElement):Rect|null{
 // Bind an icon to the visible caption, rather than the far edge of a large
 // card, column or container. Inputs have no measurable caption text nodes.
 for(const node of element.childNodes){
  if(node.nodeType!==Node.TEXT_NODE||!(node.textContent??'').trim())continue;
  const range=document.createRange();
  range.selectNodeContents(node);
  const rect=range.getBoundingClientRect();
  if(validRect(rect))return rect;
 }
 return null;
}
type Box={w:number;h:number};
/** Positions are computed in the host's own (unscaled) CSS pixels so icons
 * stay on their field at every canvas zoom level. */
function local(anchor:Rect,host:Rect,sx:number,sy:number):Rect{
 const left=(anchor.left-host.left)/sx,top=(anchor.top-host.top)/sy;
 const width=anchor.width/sx,height=anchor.height/sy;
 return {left,top,right:left+width,bottom:top+height,width,height};
}
function spot(box:Box,a:Rect,propertyKey:string,index:number,caption:boolean,used:IconPosition[]){
 const step=index*(ICON_SIZE+SPACING);
 const middle=a.top+(a.height-ICON_SIZE)/2;
 const centreX=a.left+(a.width-ICON_SIZE)/2;
 const large=a.width>=ICON_SIZE*3&&a.height>=ICON_SIZE*2;
 const candidates:{x:number;y:number}[]=propertyKey==='tabCaptionFormula'
  // Tabs always keep their source icon in their own caption box.
  ?[{x:a.right-ICON_SIZE-2-step,y:a.top+2}]
  :caption
  // Text: directly after the visible caption, vertically centred on it.
  ?[{x:a.right+SPACING+step,y:middle},{x:a.left-ICON_SIZE-SPACING-step,y:middle},
    {x:a.right-ICON_SIZE-2-step,y:middle}]
  // Image / box / input: centred in the field when there is room, otherwise
  // inside its right edge, vertically centred.
  :large
  ?[{x:centreX+step,y:middle},{x:centreX-step,y:middle}]
  :[{x:a.right-ICON_SIZE-4-step,y:middle},{x:a.right+SPACING+step,y:middle}];
 const fits=(c:{x:number;y:number})=>c.x>=2&&c.y>=2&&
  c.x+ICON_SIZE<=box.w-2&&c.y+ICON_SIZE<=box.h-2;
 for(const candidate of candidates){
  if(!fits(candidate))continue;
  if(used.some(other=>overlaps(other,candidate)))continue;
  return candidate;
 }
 // Still anchored to the field: clamp its first spot inside the component.
 const first=candidates[0];
 if(first){
  const clamped={x:Math.min(Math.max(2,first.x),box.w-ICON_SIZE-2),
   y:Math.min(Math.max(2,first.y),box.h-ICON_SIZE-2)};
  if(fits(clamped)&&!used.some(other=>overlaps(other,clamped)))return clamped;
 }
 return null; // Never manufacture a grid of unanchored fallback icons.
}
/** Builder-only overlay. Metadata selects eligible properties; visible runtime
 * field anchors select their actual positions. No icon exists without a field. */
export default function CanvasDataBindingIcons({componentId,api,definitions,properties,active,onChoose}:{
 componentId:string;api:string;definitions:readonly BuilderRibbonProperty[];
 properties?:Readonly<Record<string,unknown>>;
 active?:CanvasBindingTarget|null;
 onChoose:(target:Omit<CanvasBindingTarget,'componentId'|'requestId'>)=>void;
}){
 const root=useRef<HTMLDivElement>(null);
 const [icons,setIcons]=useState<IconPosition[]>([]);
 const [overflow,setOverflow]=useState<BindingEntry[]>([]);
 const [overflowPosition,setOverflowPosition]=useState<OverflowPosition|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [query,setQuery]=useState('');
 const overflowButton=useRef<HTMLButtonElement>(null);
 const overflowPanel=useRef<HTMLDivElement>(null);
 const menuId=useId();
 // Show the configured expression for this particular component, including
 // SQL metadata properties that store values under a different key.
 const sourceFor=(key:string):string=>{
  const definition=definitions.find(property=>property.id===key);
  const stored=properties?.[definition?.valueKeys?.[api]??key];
  return stored===null||stored===undefined?'':String(stored).trim();
 };
 const labelFor=(entry:BindingEntry):string=>{
  if(api!=='smart_cart')return entry.label;
  const labelKeys:Record<string,string>={
   subtotalValue:'subtotalLabel',totalValue:'totalLabel',
   taxValue:'taxLabel',discountValue:'discountLabel'
  };
  const value=properties?.[labelKeys[entry.propertyKey]];
  // Literal custom cart captions can identify a summary; expressions cannot.
  return typeof value==='string'&&value.trim()&&!/^[=@$]/.test(value.trim())
   ?value.trim()+' amount':entry.label;
 };
 const highlighted=useRef<HTMLElement[]>([]);
 const highlightField=(key:string|null)=>{
  for(const element of highlighted.current)element.removeAttribute('data-canvas-binding-hover');
  highlighted.current=[];
  if(!key)return;
  const host=root.current?.closest<HTMLElement>('[data-component-id]');
  if(!host)return;
  for(const element of host.querySelectorAll<HTMLElement>('[data-md-bind]')){
   if(element.closest('[data-component-id]')!==host)continue;
   if(!(element.dataset.mdBind??'').trim().split(/\s+/).includes(key))continue;
   element.setAttribute('data-canvas-binding-hover','true');
   highlighted.current.push(element);
  }
 };
 useEffect(()=>()=>{for(const element of highlighted.current)
  element.removeAttribute('data-canvas-binding-hover');},[componentId]);
 useEffect(()=>{if(!expanded){
  for(const element of highlighted.current)element.removeAttribute('data-canvas-binding-hover');
  highlighted.current=[];
 }},[expanded]);
 useEffect(()=>{setExpanded(false);setQuery('');},[componentId,api]);
 useEffect(()=>{
  if(!expanded)return;
  const dismiss=(event:PointerEvent)=>{
   const target=event.target;
   if(target instanceof Node&&!overflowButton.current?.contains(target)
     &&!overflowPanel.current?.contains(target))setExpanded(false);
  };
  const escape=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){setExpanded(false);overflowButton.current?.focus();}
  };
  document.addEventListener('pointerdown',dismiss,true);
  document.addEventListener('keydown',escape,true);
  return ()=>{document.removeEventListener('pointerdown',dismiss,true);
   document.removeEventListener('keydown',escape,true);};
 },[expanded]);
 useLayoutEffect(()=>{
  const overlay=root.current,host=overlay?.closest<HTMLElement>('[data-component-id]');
  if(!host)return;
  const allowed=new Map(definitions.filter(p=>p.tab==='Data'&&p.components.includes(api)&&
   p.id!=='collectionFormula'&&(p.kindOverrides?.[api]??p.kind)==='expression')
   .map(p=>[p.id,bindingDisplayLabel(api,p.id,p.label)]));
  let frame=0;
  const position=()=>{
   frame=0;
   const hostRect=host.getBoundingClientRect();
   if(!validRect(hostRect)){setIcons([]);return;}
   // Canvas zoom scales the host with a transform; undo it for positioning.
   const sx=host.offsetWidth>0?hostRect.width/host.offsetWidth:1;
   const sy=host.offsetHeight>0?hostRect.height/host.offsetHeight:1;
   const box={w:host.offsetWidth||hostRect.width,h:host.offsetHeight||hostRect.height};
   const watched=new Set<Element>();
   const next:IconPosition[]=[];
   const selected=new Set<string>();
   // A compact component must not lose editable data properties just because
   // its renderer clipped the anchor. Unanchored metadata fields go into the
   // overflow picker, never into an unrelated on-canvas icon grid.
   const available=new Map<string,BindingEntry>();
   for(const [propertyKey,label] of allowed){
    if(propertyKey!=='tabCaptionFormula')
     available.set(propertyKey+':shared',{key:propertyKey+':shared',propertyKey,label});
   }
   for(const element of host.querySelectorAll<HTMLElement>('[data-md-bind]')){
    // Nested components manage their own bindings when selected.
    if(element.closest('[data-component-id]')!==host)continue;
    watched.add(element);
    const clipped=clipRect(element,host);
    const caption=clipped?textRect(element):null;
    const isCaption=element.dataset.mdBind!=='tabCaptionFormula'&&Boolean(caption&&validRect(caption));
    const anchor=clipped?local(isCaption?caption!:clipped,hostRect,sx,sy):null;
    const properties=(element.dataset.mdBind??'').trim().split(/\s+/).filter(Boolean);
    const titles=(element.dataset.mdBindTitles??'').split('|');
    properties.forEach((propertyKey,index)=>{
     const label=allowed.get(propertyKey);
     if(!label)return;
     const displayLabel=titles[index]?.trim()||label;
     const indexText=element.dataset.mdBindIndex;
     const itemIndex=indexText===undefined?undefined:Number(indexText);
     const itemId=element.dataset.mdBindItem||undefined;
     // Repeated record rows are ONE binding. Static tabs instead have one
     // independent caption formula per tab (stable item identity).
     const perItem=propertyKey==='tabCaptionFormula';
     const identity=perItem?itemId??String(itemIndex??0):'shared';
     const key=propertyKey+':'+identity;
     available.set(key,{key,propertyKey,label:displayLabel,
      ...(perItem?{itemIndex:Number.isFinite(itemIndex)?itemIndex:undefined,itemId}: {})});
     if(selected.has(key)||!anchor)return;
     const pos=spot(box,anchor,propertyKey,index,isCaption,next);
     // Try the next visible row/card if this one has no room for the icon.
     if(!pos)return;
     selected.add(key);
     next.push({key,propertyKey,label:displayLabel,x:pos.x,y:pos.y,
      ...(perItem?{itemIndex:Number.isFinite(itemIndex)?itemIndex:undefined,itemId}: {})});
    });
   }
   let remaining=[...available.values()].filter(target=>!selected.has(target.key));
   // Reserve the upper-right corner for the always-hittable overflow button.
   // This is especially important for 20px-high text and dense Cart layouts.
   if(remaining.length){
    const displaced=next.filter(icon=>icon.x>box.w-46&&icon.y<38);
    for(const icon of displaced)selected.delete(icon.key);
    for(const icon of displaced){
     const index=next.findIndex(entry=>entry.key===icon.key);
     if(index>=0)next.splice(index,1);
    }
    remaining=[...available.values()].filter(target=>!selected.has(target.key));
   }
   // Fields that load or resize later (images, async records) re-position.
   for(const element of watched)if(!observedFields.has(element)){observedFields.add(element);resize.observe(element);}
   setIcons(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
   setOverflow(old=>JSON.stringify(old)===JSON.stringify(remaining)?old:remaining);
   const withinViewport=hostRect.right>0&&hostRect.bottom>0&&
    hostRect.left<window.innerWidth&&hostRect.top<window.innerHeight;
   setOverflowPosition(remaining.length&&withinViewport?{
    x:Math.max(8,Math.min(window.innerWidth-34,hostRect.right-30)),
    y:Math.max(8,Math.min(window.innerHeight-34,hostRect.top+3)),
    viewportWidth:window.innerWidth,viewportHeight:window.innerHeight
   }:null);
  };
  const observedFields=new WeakSet<Element>();
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(position);};
  const resize=new ResizeObserver(schedule);
  resize.observe(host);
  const observer=new MutationObserver(mutations=>{
   // Moving one of our own buttons must not trigger a re-render feedback loop.
   if(mutations.every(change=>change.target instanceof Element&&
     change.target.closest('.canvas-data-bindings')))return;
   schedule();
  });
  observer.observe(host,{childList:true,subtree:true,characterData:true,
   attributes:true,attributeFilter:['data-md-bind','style','class','src']});
  // Images change size without DOM mutations once they finish loading.
  host.addEventListener('load',schedule,true);
  host.addEventListener('scroll',schedule,true);
  window.addEventListener('resize',schedule);
  // The canvas scroll container is often an ancestor, not the selected host.
  window.addEventListener('scroll',schedule,true);
  schedule();
  return ()=>{
   if(frame)cancelAnimationFrame(frame);
   resize.disconnect();observer.disconnect();
   host.removeEventListener('scroll',schedule,true);
   host.removeEventListener('load',schedule,true);
   window.removeEventListener('resize',schedule);
   window.removeEventListener('scroll',schedule,true);
  };
 },[componentId,api,definitions]);
 const menuWidth=overflowPosition?Math.min(340,overflowPosition.viewportWidth-16):340;
 const panelLeft=overflowPosition?Math.max(8,Math.min(
  overflowPosition.viewportWidth-menuWidth-8,overflowPosition.x+26-menuWidth)):8;
 const below=overflowPosition?overflowPosition.viewportHeight-overflowPosition.y-34:0;
 const above=overflowPosition?overflowPosition.y-8:0;
 const openAbove=below<Math.min(260,48+overflow.length*36)&&above>below;
 const panelHeight=Math.min(360,Math.max(80,(openAbove?above:below)-8));
 const panelTop=overflowPosition?(openAbove?Math.max(8,overflowPosition.y-panelHeight-5):
  overflowPosition.y+30):0;
 const filtered=overflow.filter(target=>(
  labelFor(target)+' '+target.label+' '+target.propertyKey+' '+sourceFor(target.propertyKey)
 ).toLowerCase().includes(query.trim().toLowerCase()));
 return <><div ref={root} className="canvas-data-bindings" role="group" aria-label="Selected component data bindings">
  {icons.map(icon=><button key={icon.key} type="button"
   className={'canvas-data-icon-button'+(active?.componentId===componentId&&
    active.propertyKey===icon.propertyKey&&(active.itemId??null)===(icon.itemId??null)&&
    (active.itemIndex??null)===(icon.itemIndex??null)?' is-active':'')}
   aria-pressed={active?.componentId===componentId&&active.propertyKey===icon.propertyKey}
   style={{left:icon.x,top:icon.y}} data-binding-property={icon.propertyKey}
   data-binding-item={icon.itemId??icon.itemIndex}
   title={'Edit '+icon.label+' in Data formula bar'}
   aria-label={'Edit '+icon.label+' data source'}
   draggable={false}
   onPointerDown={event=>event.stopPropagation()}
   onMouseDown={event=>event.stopPropagation()}
   onDragStart={event=>{event.preventDefault();event.stopPropagation();}}
   onClick={event=>{event.preventDefault();event.stopPropagation();
    onChoose({propertyKey:icon.propertyKey,itemIndex:icon.itemIndex,itemId:icon.itemId,displayLabel:icon.label});}}>
   <Database aria-hidden="true" size={14}/>
  </button>)}
 </div>
 {overflowPosition&&overflow.length>0&&typeof document!=='undefined'&&createPortal(
  <>
   <button ref={overflowButton} type="button" className="canvas-data-overflow-trigger"
    style={{left:overflowPosition.x,top:overflowPosition.y}}
    aria-label={'Choose data fields ('+overflow.length+' additional)'}
    title={overflow.length+' data fields: open searchable formula bindings'}
    aria-haspopup="dialog" aria-controls={menuId} aria-expanded={expanded}
    onPointerDown={event=>event.stopPropagation()}
    onMouseDown={event=>event.stopPropagation()}
    onClick={event=>{event.preventDefault();event.stopPropagation();setQuery('');setExpanded(value=>!value);}}>
    <Database size={14} aria-hidden="true"/>
    <span className="canvas-data-overflow-count">{overflow.length}</span>
   </button>
   {expanded&&<div ref={overflowPanel} id={menuId} className="canvas-data-overflow-panel"
    role="dialog" aria-label="Choose component data field"
    style={{left:panelLeft,top:panelTop,width:menuWidth,maxHeight:panelHeight}}
    onPointerDown={event=>event.stopPropagation()}
    onMouseDown={event=>event.stopPropagation()}
    onClick={event=>event.stopPropagation()}>
    <div className="canvas-data-overflow-title">Data fields ({overflow.length})</div>
    <div className="canvas-data-overflow-hint">Select a field to edit. Hover to locate it on the canvas.</div>
    <input type="search" autoFocus aria-label="Search data fields"
     placeholder="Search fields…" value={query} onChange={event=>setQuery(event.target.value)}/>
    <div className="canvas-data-overflow-list">
     {filtered.map(target=>{
      const label=labelFor(target);
      const source=sourceFor(target.propertyKey);
      return <button type="button" key={target.key}
       className={'canvas-data-overflow-choice'+(active?.propertyKey===target.propertyKey
        &&(active.itemId??null)===(target.itemId??null)
        &&(active.itemIndex??null)===(target.itemIndex??null)?' is-active':'')}
       title={'Edit '+label+' in Data formula bar'+(source?'\nCurrent source: '+source:'\nNo source configured')}
       onPointerEnter={()=>highlightField(target.propertyKey)}
       onPointerLeave={()=>highlightField(null)}
       onFocus={()=>highlightField(target.propertyKey)}
       onBlur={()=>highlightField(null)}
       onClick={()=>{highlightField(null);setExpanded(false);
        onChoose({propertyKey:target.propertyKey,itemIndex:target.itemIndex,
         itemId:target.itemId,displayLabel:label});}}>
       <Database size={14} aria-hidden="true"/>
       <span className="canvas-data-choice-copy">
        <strong>{label}{target.itemIndex!==undefined?' (tab '+(target.itemIndex+1)+')':''}</strong>
        <small title={source||'No source configured'}>{source?'Source: '+source:'No source configured'}</small>
       </span>
      </button>;
     })}
     {filtered.length===0&&<div className="canvas-data-overflow-empty">No matching fields</div>}
    </div>
   </div>}
  </>,document.body)}
 </>;
}
