import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';

/** Generic metadata-driven multi-select choice control. Uses existing SQL choices and values. */
export default function SmartMultiSelect({label,choices,value,disabled,onChange}:{
 label:string;choices:readonly string[];value:readonly string[];
 disabled:boolean;onChange:(next:string[])=>void;
}){
 const [open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null);
 const popup=useRef<HTMLDivElement>(null);
 const [place,setPlace]=useState({top:0,left:0,width:0});
 useLayoutEffect(()=>{
  if(!open)return;
  const update=()=>{
   const r=button.current?.getBoundingClientRect();if(!r)return;
   setPlace({top:Math.max(6,Math.min(r.bottom+3,window.innerHeight-240)),
    left:Math.max(6,Math.min(r.left,window.innerWidth-215)),width:Math.max(175,r.width)});
  };
  const outside=(event:PointerEvent)=>{
   if(!button.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))
    setOpen(false);
  };
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);button.current?.focus();}};
  update();window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);
   document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 const checked=new Set(value);
 const summary=checked.size===choices.length?'All '+choices.length+' selected':
   checked.size===0?'None selected':checked.size+' of '+choices.length+' selected';
 const toggle=(choice:string,enabled:boolean)=>onChange(choices.filter(item=>
  item===choice?enabled:checked.has(item)));
 return <div className="smart-multiselect">
  <button ref={button} type="button" className="smart-multiselect-trigger"
   aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
   onClick={()=>setOpen(value=>!value)}>
   <span>{summary}</span><ChevronDown size={14} aria-hidden="true"/>
  </button>
  {open&&createPortal(<div ref={popup} className="smart-multiselect-popup" role="dialog"
   aria-label={label} style={{top:place.top,left:place.left,minWidth:place.width}}>
   <div role="group" aria-label={label+' options'}>
    {choices.map(choice=><label key={choice} className="smart-multiselect-option">
     <input type="checkbox" checked={checked.has(choice)}
      onChange={event=>toggle(choice,event.target.checked)}/><span>{choice}</span>
    </label>)}
   </div>
   <button type="button" className="smart-multiselect-done" onClick={()=>{setOpen(false);button.current?.focus()}}>
    Done</button>
  </div>,document.body)}
 </div>;
}
