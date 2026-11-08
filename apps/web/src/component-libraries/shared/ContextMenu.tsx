import * as React from 'react';
import { useEffect, useRef } from 'react';
import './ContextMenu.css';

/** One role="menu" primitive for authorised actions supplied by the caller.
 * No new app workflow or permission interpretation lives in this control. */
export type ContextMenuAction = {
  id: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

export default function ContextMenu({x,y,actions,label,onClose}:{
  x:number;y:number;actions:ReadonlyArray<ContextMenuAction>;
  label:string;onClose:()=>void;
}){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const focusFirst=()=>root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    focusFirst();
    const dismiss=(event:PointerEvent)=>{
      if(event.target instanceof Node&&!root.current?.contains(event.target))onClose();
    };
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();onClose();return;
      }
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      const options=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);
      if(!options.length)return;
      event.preventDefault();
      const current=options.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?options.length-1
        :event.key==='ArrowDown'?(current+1)%options.length
          :(current-1+options.length)%options.length;
      options[next]?.focus();
    };
    document.addEventListener('pointerdown',dismiss,true);
    document.addEventListener('keydown',keys,true);
    return()=>{
      document.removeEventListener('pointerdown',dismiss,true);
      document.removeEventListener('keydown',keys,true);
    };
  },[onClose]);
  return <div ref={root} className="md-context-menu" role="menu" aria-label={label}
    style={{left:Math.max(8,Math.min(x,window.innerWidth-232)),top:Math.max(8,Math.min(y,window.innerHeight-actions.length*38-16))}}>
    {actions.filter(action=>Boolean(action.label)).map(action=><button type="button" key={action.id}
      role="menuitem" disabled={action.disabled}
      className={action.destructive?'md-context-danger':''}
      onClick={()=>{onClose();action.onSelect();}}>{action.label}</button>)}
  </div>;
}
