import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Columns3,Rows3} from 'lucide-react';

type Mode='horizontal'|'vertical'|'placement'|'imageFill'|'orientation';
type Item={value:string;label:string;icon:ReactNode};

function PlacementGlyph({value}:{value:string}){
 const vertical=value==='left'||value==='center'||value==='right';
 const guide=vertical?(value==='left'?3:value==='right'?21:12):(value==='top'?3:value==='bottom'?21:12);
 const bars=vertical?
  <><rect x={value==='right'?12:value==='center'?7:5} y="6" width="7" height="5" rx="1"/>
    <rect x={value==='left'?5:value==='center'?10:10} y="13" width="9" height="5" rx="1"/></>
  :<><rect x="5" y={value==='bottom'?11:value==='middle'?7:5} width="6" height="9" rx="1"/>
    <rect x="13" y={value==='top'?5:value==='middle'?10:12} width="6" height="7" rx="1"/></>;
 return <svg width="22" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
  {vertical?<rect x={guide-1} y="2" width="2" height="20" rx="1"/>:
    <rect x="2" y={guide-1} width="20" height="2" rx="1"/>}{bars}</svg>;
}
function ImageFillGlyph({value}:{value:string}){
 return <svg width="23" height="20" viewBox="0 0 24 20" aria-hidden="true">
  <rect x="1" y="1" width="22" height="18" rx="2" fill="#fff" stroke="#7e9ab7" strokeWidth="1.5"/>
  <path d={value==='fit'?'M6 15l5-7 3 4 3-3 2 6z':
    value==='stretch'?'M2 17L9 4l4 7 4-5 5 11z':
    value==='center'?'M6 15l4-6 3 3 2-3 3 6z':'M2 17L9 5l4 6 3-4 6 10z'}
    fill="#195a9a"/><circle cx="17" cy="5" r="2" fill="#facb4b"/>
 </svg>;
}
function items(mode:Mode):Item[]{
 if(mode==='horizontal')return ['left','center','right'].map(value=>({
  value,label:value[0].toUpperCase()+value.slice(1),icon:<PlacementGlyph value={value}/>}));
 if(mode==='vertical')return ['top','middle','bottom'].map(value=>({
  value,label:value[0].toUpperCase()+value.slice(1),icon:<PlacementGlyph value={value}/>}));
 if(mode==='placement')return ['top','middle','bottom','left','center','right'].map(value=>({
  value,label:value[0].toUpperCase()+value.slice(1),icon:<PlacementGlyph value={value}/>}));
 if(mode==='orientation')return [
  {value:'horizontal',label:'Horizontal',icon:<Columns3 size={19}/>},
  {value:'vertical',label:'Vertical',icon:<Rows3 size={19}/>}];
 return ['center','fill','fit','stretch'].map(value=>({
  value,label:value[0].toUpperCase()+value.slice(1),icon:<ImageFillGlyph value={value}/>}));
}
/** Design 2 only: selected icon in the closed control, icon-and-label choices in its portal menu. */
export default function Design2IconDropdown({mode,label,value,disabled,onChange,allowed}:{
 mode:Mode;label:string;value:string;disabled:boolean;onChange:(value:string)=>void;allowed?:readonly string[];
}){
 const [open,setOpen]=useState(false);
 const [position,setPosition]=useState({top:0,left:0});
 const trigger=useRef<HTMLButtonElement>(null);
 const popup=useRef<HTMLDivElement>(null);
 const list=items(mode);
 const selected=list.find(item=>item.value===value)??list[0];
 useEffect(()=>{
  if(!open)return;
  const reposition=()=>{
   const bounds=trigger.current?.getBoundingClientRect();
   if(!bounds)return;
   setPosition({top:Math.min(bounds.bottom+3,window.innerHeight-38),
     left:Math.max(4,Math.min(bounds.left,window.innerWidth-148))});
  };
  const outside=(event:PointerEvent)=>{
   const node=event.target as Node;
   if(!trigger.current?.contains(node)&&!popup.current?.contains(node))setOpen(false);
  };
  const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};
  reposition();
  document.addEventListener('pointerdown',outside);
  document.addEventListener('keydown',keyboard);
  window.addEventListener('scroll',reposition,true);
  window.addEventListener('resize',reposition);
  return()=>{
   document.removeEventListener('pointerdown',outside);
   document.removeEventListener('keydown',keyboard);
   window.removeEventListener('scroll',reposition,true);
   window.removeEventListener('resize',reposition);
  };
 },[open]);
 return <>
  <button type="button" ref={trigger} className="design2-icon-trigger"
    data-icon-kind={mode==='placement'?'imagePlacement':mode==='imageFill'?'imageFill':mode}
    aria-label={label+': '+(selected?.label??'Select')} title={label+': '+(selected?.label??'Select')}
    aria-haspopup="menu" aria-expanded={open} disabled={disabled||!selected}
    onClick={()=>setOpen(current=>!current)}>
   {selected?.icon}<ChevronDown size={11} aria-hidden="true"/>
  </button>
  {open&&createPortal(<div ref={popup} className="design2-icon-popup" role="menu"
    aria-label={label} style={{top:position.top,left:position.left}}>
   {list.map(option=>{
    const permitted=!allowed?.length||allowed.includes(option.value);
    return <button key={option.value} type="button" role="menuitemradio"
      className={option.value===value?'is-selected':''}
      disabled={!permitted} title={permitted?option.label:option.label+' (not supported)'}
      aria-label={label+': '+option.label} aria-checked={option.value===value}
      onClick={()=>{if(!permitted)return;onChange(option.value);setOpen(false);trigger.current?.focus();}}>
     {option.icon}<span>{option.label}</span>
    </button>;
   })}
  </div>,document.body)}
 </>;
}
