import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,PanelsTopLeft} from 'lucide-react';
import {primaryPageLayout,pageLayoutOptionLabel,type PageLayoutSummary,type PageLayoutVariantName} from './pageLayoutSummary';

type Props={
  label:string;
  summary?:PageLayoutSummary|null;
  onOpenDefault:()=>void;
  onOpenLayout:(variant:PageLayoutVariantName)=>void;
};

type MenuPosition={top:number;left:number;width:number};

/** The icon opens the primary design; the arrow opens an independent device-layout menu.
 * Portalling the menu outside the scrollable table prevents clipping and row text bleed-through. */
export default function PageDesignSplitAction({label,summary,onOpenDefault,onOpenLayout}:Props){
  const primary=primaryPageLayout(summary);
  const ordered=[primary,...(['Desktop','Mobile','Tablet','Custom'] as const).filter(variant=>variant!==primary)];
  const [menuPosition,setMenuPosition]=useState<MenuPosition|null>(null);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const menuOpen=menuPosition!==null;

  const closeMenu=()=>setMenuPosition(null);
  const openMenu=()=>{
    if(menuOpen){closeMenu();return;}
    const rect=buttonRef.current?.getBoundingClientRect();
    if(!rect)return;
    const width=240;
    const estimatedHeight=ordered.length*38+12;
    const top=window.innerHeight-rect.bottom<estimatedHeight && rect.top>estimatedHeight
      ? rect.top-estimatedHeight-4 : rect.bottom+4;
    setMenuPosition({top:Math.max(4,top),left:Math.max(4,Math.min(rect.left,window.innerWidth-width-4)),width});
  };

  useEffect(()=>{
    if(!menuOpen)return;
    const onPointerDown=(event:PointerEvent)=>{
      if(event.target instanceof Node
        && !buttonRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target))closeMenu();
    };
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){closeMenu();buttonRef.current?.focus();}
    };
    const onScroll=()=>closeMenu();
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    window.addEventListener('scroll',onScroll,true);
    window.addEventListener('resize',onScroll);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('scroll',onScroll,true);
      window.removeEventListener('resize',onScroll);
    };
  },[menuOpen]);

  return <span className="page-manager-design-split">
    <button className="page-manager-icon-action" type="button"
      aria-label={'Design '+label} title={'Open '+primary+' page designer'}
      onClick={event=>{event.stopPropagation();onOpenDefault();}}><PanelsTopLeft size={16}/></button>
    <button ref={buttonRef} className="page-manager-design-layout-trigger" type="button"
      aria-label={'Choose design layout for '+label} aria-haspopup="menu"
      aria-expanded={menuOpen} onClick={event=>{event.stopPropagation();openMenu();}}><ChevronDown size={13}/></button>
    {menuPosition && createPortal(
      <div ref={menuRef} className="page-manager-design-layout-menu" role="menu"
        aria-label={'Design layout for '+label} style={menuPosition}>
        {ordered.map(variant=><button key={variant} type="button" role="menuitem"
          className="page-manager-design-layout-option"
          onClick={event=>{event.stopPropagation();closeMenu();onOpenLayout(variant);}}>
          {pageLayoutOptionLabel(variant,summary)}
        </button>)}
      </div>,document.body)}
  </span>;
}
