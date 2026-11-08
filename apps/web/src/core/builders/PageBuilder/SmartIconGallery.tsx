import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Shapes,ChevronDown} from 'lucide-react';
import icons from '../../../component-libraries/smart_icon/iconCatalog.json';
import {smartShapes,SmartShapeGlyph} from '../../../component-libraries/smart_icon/SmartShapes';
import './SmartIconGallery.css';

const shapeGroups=[...new Set(smartShapes.map(item=>item.category))];
const iconGroups=[...new Set(icons.map(icon=>icon.category))];
export default function SmartIconGallery({value,onChange,disabled=false,allowIcons=true}:{value:string;onChange:(iconId:string)=>void;disabled?:boolean;allowIcons?:boolean}){
 const [open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null);
 const panel=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState({top:0,left:0});
 const select=(id:string)=>{if(disabled)return;onChange(id);setOpen(false);button.current?.focus();};
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{
  if(!open)return;
  const update=()=>{const rect=button.current?.getBoundingClientRect();if(rect)setPosition({
   top:Math.max(4,Math.min(rect.bottom+4,window.innerHeight-380)),
   left:Math.max(4,Math.min(rect.left,window.innerWidth-410))});};
  const outside=(event:PointerEvent)=>{if(!button.current?.contains(event.target as Node)
    &&!panel.current?.contains(event.target as Node))setOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);button.current?.focus();}};
  update();window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);
   document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 const icon=(item:{id:string;label:string})=>item.id.startsWith('shape:')
  ?<SmartShapeGlyph id={item.id} size={21}/>
  :<span className="smart-icon-gallery-glyph" aria-hidden="true"
     style={{WebkitMaskImage:'url(/smart-icons/'+item.id+'.svg)',
      maskImage:'url(/smart-icons/'+item.id+'.svg)'}}/>;
 return <div className="smart-icon-gallery" aria-label="Shapes and icons">
  <button ref={button} type="button" className="smart-shapes-trigger"
    aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
    title={disabled?'Not shared by every selected component':allowIcons?'Choose shape or icon':'Choose shape'}
    onClick={()=>setOpen(!open)}><Shapes size={18}/><span>Shapes</span><ChevronDown size={13}/></button>
  {open&&createPortal(<div ref={panel} className="smart-shapes-popup" role="dialog"
    aria-label="Choose shape or icon" style={{position:'fixed',top:position.top,left:position.left}}>
    {shapeGroups.map(group=><section key={group}><strong>{group}</strong>
     <div className="smart-shapes-grid">{smartShapes.filter(item=>item.category===group).map(item=>
      <button type="button" key={item.id} title={item.label} aria-label={item.label}
       aria-pressed={value===item.id} onClick={()=>select(item.id)}>{icon(item)}</button>)}</div>
    </section>)}
    {allowIcons&&<section><strong>Icons</strong>{iconGroups.map(group=><div key={group}>
      <small>{group}</small><div className="smart-shapes-grid">
       {icons.filter(item=>item.category===group).map(item=>
        <button type="button" key={item.id} title={item.label} aria-label={item.label}
         aria-pressed={value===item.id} onClick={()=>select(item.id)}>{icon(item)}</button>)}
      </div></div>)}
    </section>}
  </div>,document.body)}
 </div>;
}
