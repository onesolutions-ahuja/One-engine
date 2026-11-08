import {useState,useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AlignLeft,AlignCenter,AlignRight,ChevronDown,Expand} from 'lucide-react';

type Choice={value:string;label:string;icon:ReactNode};
type IconKind='align'|'shadow'|'imageFill'|'imagePlacement'|'badgeAlignment';

// Design 2 image-placement preview from the approved ribbon reference:
// a short image-edge rule and two content rectangles, not a generic panel icon.
// The control still uses the exact SQL 40x26 slot and stores top/left/right/bottom.
function ImagePlacementIcon({value}:{value:string}){
 const horizontal=value==='top'||value==='bottom';
 return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
   {horizontal
    ?<g fill="currentColor">
      <rect x="2" y={value==='top'?2:20} width="20" height="2" rx=".5"/>
      <rect x="4" y={value==='top'?6:4} width="8" height="12" rx=".6"/>
      <rect x="14" y={value==='top'?6:8} width="7" height="8" rx=".6"/>
     </g>
    :<g fill="currentColor">
      <rect x={value==='left'?2:20} y="2" width="2" height="20" rx=".5"/>
      <rect x={value==='left'?6:4} y="4" width="8" height="12" rx=".6"/>
      <rect x={value==='left'?15:13} y="4" width="5" height="8" rx=".6"/>
     </g>}
 </svg>;
}
// The screenshot's Fill/Fit dropdown uses a picture/mountains glyph.
// Keep the existing imageFill enum unchanged; only replace its presentation.
function ImageFitIcon({value}:{value:string}){
 if(value==='stretch')return <Expand size={18}/>;
 return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
   <rect x="2.5" y="3" width="19" height="18" rx="2" fill="none"
      stroke="currentColor" strokeWidth="1.5"/>
   <path d={value==='fit'
      ?'M5 17l4-5 3 3 3-5 4 7H5'
      :'M4 19l6-9 3 4 4-7 4 12H4'}
      fill="currentColor"/>
 </svg>;
}
const shadowStyle=(name:string)=>({boxShadow:name==='none'?'none':name==='medium'?'1px 2px 3px #64748b':'2px 4px 8px #64748b'});
const choices=(kind:IconKind):Choice[]=>{
 if(kind==='align')return [
   {value:'left',label:'Left',icon:<AlignLeft size={16}/>},
   {value:'center',label:'Centre',icon:<AlignCenter size={16}/>},
   {value:'right',label:'Right',icon:<AlignRight size={16}/>}
 ];
 if(kind==='shadow')return ['none','medium','large'].map(value=>({
   value,label:value[0].toUpperCase()+value.slice(1),
   icon:<span className="smart-shadow-swatch" style={shadowStyle(value)}/>
 }));
 if(kind==='imageFill')return [
   {value:'fill',label:'Fill',icon:<ImageFitIcon value="fill"/>},
   {value:'fit',label:'Fit',icon:<ImageFitIcon value="fit"/>},
   {value:'stretch',label:'Stretch',icon:<ImageFitIcon value="stretch"/>}
 ];
 if(kind==='imagePlacement')return [
   {value:'top',label:'Top',icon:<ImagePlacementIcon value="top"/>},
   {value:'left',label:'Left',icon:<ImagePlacementIcon value="left"/>},
   {value:'right',label:'Right',icon:<ImagePlacementIcon value="right"/>},
   {value:'bottom',label:'Bottom',icon:<ImagePlacementIcon value="bottom"/>}
 ];
 const icon=(direction:string)=>direction.endsWith('left')?<AlignLeft size={16}/>:
   direction.endsWith('right')?<AlignRight size={16}/>:<AlignCenter size={16}/>;
 return [
   'image-top-left','image-top-center','image-top-right','image-center',
   'image-bottom-left','image-bottom-center','image-bottom-right',
   'text-left','text-center','text-right','text-bottom'
 ].map(value=>({value,label:value.replaceAll('-',' '),icon:icon(value)}));
};

/** Shared keyboard-accessible icon dropdown; popup uses a portal to avoid ribbon clipping. */
export default function SmartIconDropdown({kind,value,label,disabled,onChange,allowedValues}:{
 kind:IconKind;value:string;label:string;disabled:boolean;onChange:(value:string)=>void;
 /** Preserve the actual component's SQL choices (e.g. Cart only left/right). */
 allowedValues?:readonly string[];
}){
 const [open,setOpen]=useState(false);
 const [position,setPosition]=useState({top:0,left:0});
 const trigger=useRef<HTMLButtonElement>(null);
 const popup=useRef<HTMLDivElement>(null);
 const allOptions=choices(kind);
 const options=allowedValues?.length
   ?allOptions.filter(option=>allowedValues.includes(option.value)):allOptions;
 const selected=options.find(item=>item.value===value)??options[0]??{
   value:'',label:'Unavailable',icon:<span aria-hidden="true">—</span>
 };
 const widePopup=options.length>4;
 const popupWidth=widePopup?148:Math.max(102,options.length*34+10);
 useEffect(()=>{
  if(!open)return;
  const reposition=()=>{
   const rect=trigger.current?.getBoundingClientRect();
   if(!rect)return;
   setPosition({top:Math.min(rect.bottom+3,window.innerHeight-42),
    left:Math.max(4,Math.min(rect.left,window.innerWidth-popupWidth-4))});
  };
  const outside=(event:PointerEvent)=>{
   const node=event.target as Node;
   if(!trigger.current?.contains(node)&&!popup.current?.contains(node))setOpen(false);
  };
  const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};
  reposition();
  document.addEventListener('pointerdown',outside);
  document.addEventListener('keydown',keyboard);
  window.addEventListener('resize',reposition);
  window.addEventListener('scroll',reposition,true);
  return()=>{
   document.removeEventListener('pointerdown',outside);
   document.removeEventListener('keydown',keyboard);
   window.removeEventListener('resize',reposition);
   window.removeEventListener('scroll',reposition,true);
  };
 },[open]);
 return <>
  <button ref={trigger} type="button" className="smart-icon-dropdown-trigger"
   data-icon-kind={kind} disabled={disabled||options.length===0}
   aria-label={label+': '+selected.label} title={label+': '+selected.label}
   aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   {selected.icon}<ChevronDown size={9} aria-hidden="true"/>
  </button>
  {open&&createPortal(<div ref={popup} className="smart-icon-dropdown-popup" role="menu"
    aria-label={label} style={{top:position.top,left:position.left,
      ...(widePopup?{display:'grid',gridTemplateColumns:'repeat(4,30px)'}:{})}}>
    {options.map(option=><button key={option.value} type="button" role="menuitemradio"
      aria-label={label+': '+option.label} title={option.label}
      aria-checked={option.value===value} onClick={()=>{onChange(option.value);setOpen(false);trigger.current?.focus();}}>
      {option.icon}
    </button>)}
   </div>,document.body)}
 </>;
}
