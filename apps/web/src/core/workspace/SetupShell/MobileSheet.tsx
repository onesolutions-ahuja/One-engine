import * as React from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import './MobileAppNavigation.css';
import './MobileSheet.css';

/** Shared accessible phone sheet. Focus is restored after dismissal; body scroll
 * is locked while open. Pull down on the header/handle to close. */
export function MobileSheet({title,onClose,children,footer}:{
 title:string;onClose:()=>void;children:React.ReactNode;footer?:React.ReactNode;
}){
 const root=React.useRef<HTMLElement>(null),closeRef=React.useRef<HTMLButtonElement>(null);
 const drag=React.useRef<{y:number;id:number}|null>(null);
 React.useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  closeRef.current?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();onClose();return;}
   if(event.key!=='Tab'||!root.current)return;
   const nodes=[...root.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
     .filter(el=>el.offsetParent!==null);
   if(!nodes.length)return;
   const first=nodes[0],last=nodes[nodes.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',onKey);
  return ()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',onKey);previous?.focus?.();};
 },[onClose]);
 return createPortal(<div className="md-mobile-sheet-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={root} className="md-mobile-sheet" role="dialog" aria-modal="true" aria-label={title}>
   <header style={{touchAction:'pan-y'}} onPointerDown={e=>{
      if((e.target as HTMLElement).closest('button'))return;
      drag.current={y:e.clientY,id:e.pointerId};
    }} onPointerUp={e=>{
      if(drag.current?.id===e.pointerId && e.clientY-drag.current.y>80)onClose();
      drag.current=null;
    }} onPointerCancel={()=>{drag.current=null;}}>
    <span className="md-mobile-sheet-grabber" aria-hidden="true"/><strong>{title}</strong>
    <button type="button" ref={closeRef} aria-label={'Close '+title} onClick={onClose}><X size={20}/></button>
   </header>
   <div className="md-mobile-sheet-content">{children}</div>
   {footer&&<footer className="md-mobile-sheet-footer">{footer}</footer>}
  </section>
 </div>, document.body);
}
