import {useEffect,useRef} from 'react';

/** Shared runtime dialog focus containment. Business actions stay with the calling app. */
export function useModalFocus<T extends HTMLElement=HTMLElement>(active:boolean,onEscape?:()=>void){
 const ref=useRef<T>(null);
 const escapeRef=useRef(onEscape);
 escapeRef.current=onEscape;
 useEffect(()=>{
  if(!active)return;
  const dialog=ref.current;
  if(!dialog)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const focusables=()=>Array.from(dialog.querySelectorAll<HTMLElement>(
   'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )).filter(element=>element.getClientRects().length>0&&!element.closest('[inert]'));
  const initial=focusables()[0];
  if(initial)initial.focus();
  else{dialog.setAttribute('tabindex','-1');dialog.focus();}
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    if(escapeRef.current){event.preventDefault();event.stopPropagation();escapeRef.current();}
    return;
   }
   if(event.key!=='Tab')return;
   const choices=focusables();
   if(!choices.length){event.preventDefault();dialog.focus();return;}
   const first=choices[0],last=choices[choices.length-1];
   if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){
    event.preventDefault();last.focus();
   }else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){
    event.preventDefault();first.focus();
   }
  };
  document.addEventListener('keydown',onKey,true);
  return()=>{
   document.removeEventListener('keydown',onKey,true);
   if(previous?.isConnected)previous.focus();
  };
 },[active]);
 return ref;
}
