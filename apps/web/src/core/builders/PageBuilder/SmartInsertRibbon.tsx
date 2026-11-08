import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight,Grid2X2} from 'lucide-react';
import './SmartInsertRibbon.css';

/** The Insert ribbon shows only tenant-registered Smart components.
 * Use the existing SQL-backed Page Builder palette and insert action.
 * App/standard components, search and category selectors are not shown.
 */
export type SmartInsertItem={
 type:string;
 label:string;
 description?:string;
};
export function isSmartInsertItem(item:SmartInsertItem){
 return /^Custom:smart_[A-Za-z0-9_]+$/.test(item.type);
}
export default function SmartInsertRibbon({items,onInsert,renderIcon}:{
 items:readonly SmartInsertItem[];
 onInsert:(type:string)=>void;
 renderIcon:(item:SmartInsertItem)=>ReactNode;
}){
 const scroll=useRef<HTMLDivElement>(null);
 const [arrows,setArrows]=useState({left:false,right:false});
 const visible=items.filter(isSmartInsertItem);
 const measure=()=>{
  const node=scroll.current;
  if(!node)return;
  setArrows({left:node.scrollLeft>2,right:node.scrollLeft+node.clientWidth<node.scrollWidth-2});
 };
 const move=(offset:number)=>{scroll.current?.scrollBy({left:offset,behavior:'smooth'});};
 useEffect(()=>{
  measure();
  const update=()=>measure();
  window.addEventListener('resize',update);
  return()=>window.removeEventListener('resize',update);
 },[visible.length]);
 return <div className="smart-insert-ribbon" aria-label="Insert Smart components">
  <div className="smart-insert-gallery">
   <div className="smart-insert-gallery-row">
    {(arrows.left||arrows.right)&&<button className="smart-insert-pager" type="button" title="Previous Smart components"
      aria-label="Previous Smart components" disabled={!arrows.left}
      onClick={()=>move(-500)}><ChevronLeft size={16}/></button>}
    <div className="smart-insert-tiles" ref={scroll} onScroll={measure}>
     {visible.map(item=><button className="smart-insert-tile" type="button"
       key={item.type} title={'Insert '+item.label+(item.description?': '+item.description:'')}
       onClick={()=>onInsert(item.type)}>
       <span className="smart-insert-tile-icon">{renderIcon(item)}</span>
       <span className="smart-insert-tile-label">{item.label}</span>
     </button>)}
     {visible.length===0&&<div role="status" className="smart-insert-empty">
       <Grid2X2 size={17}/>{items.length===0
         ?'No available components were returned by the component library.'
         :'No Smart components are installed for this tenant.'}
     </div>}
    </div>
    {(arrows.left||arrows.right)&&<button className="smart-insert-pager" type="button" title="Next Smart components"
      aria-label="Next Smart components" disabled={!arrows.right}
      onClick={()=>move(500)}><ChevronRight size={16}/></button>}
   </div>
  </div>
 </div>;
}
