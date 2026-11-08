/**
 * Progressive phone-only sheet behaviour for existing admin dialogs.
 * Preserves original React form, submit and close handlers; never replaces them
 * or changes desktop. Keyboard navigation and safe dismissal are shared.
 */
const selector=[
 '.modal-backdrop > [role="dialog"][aria-modal="true"]',
 '.report-type-modal-backdrop > [role="dialog"][aria-modal="true"]',
 '.app-builder-settings-backdrop > [role="dialog"][aria-modal="true"]',
 ' .exchange-backdrop > [role="dialog"][aria-modal="true"]'.trim(),
 ' .profile-password-backdrop > [role="dialog"][aria-modal="true"]'.trim()
].join(', ');
const focusable='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function installMobileAdminSheets():()=>void {
 const phone=window.matchMedia('(max-width:599px), (max-height:500px) and (pointer:coarse)');
 let active:HTMLElement|null=null,previous:HTMLElement|null=null,oldOverflow='';
 const visible=(node:HTMLElement)=>node.getClientRects().length>0;
 const closeButton=(dialog:HTMLElement)=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>
  !button.disabled&&/^(close|cancel)(\s|$)/i.test(button.getAttribute('aria-label')||button.getAttribute('title')||button.textContent?.trim()||''));
 const current=():HTMLElement|null=>{
  if(!phone.matches||document.querySelector('.md-mobile-sheet-backdrop'))return null;
  const dialogs=[...document.querySelectorAll<HTMLElement>(selector)].filter(visible);
  return dialogs.at(-1)??null;
 };
 const update=()=>{
  const top=current();
  if(top===active)return;
  if(active&&!top) {
   document.body.style.overflow=oldOverflow;
   active=null;previous?.focus?.();previous=null;
   return;
  }
  if(!active&&top) {
   oldOverflow=document.body.style.overflow;
   previous=document.activeElement as HTMLElement|null;
  }
  active=top;
  if(top) {
   document.body.style.overflow='hidden';
   if(!top.contains(document.activeElement)){
    const initial=top.querySelector<HTMLElement>('[autofocus]')??top.querySelector<HTMLElement>(focusable);
    (initial??top).focus();
   }
  }
 };
 const observer=new MutationObserver(update);
 observer.observe(document.body,{subtree:true,childList:true});
 const keydown=(event:KeyboardEvent)=>{
  const top=current();
  if(!top)return;
  if(event.key==='Escape'){
   const button=closeButton(top);
   if(button){event.preventDefault();event.stopPropagation();button.click();}
  }
  if(event.key==='Tab'){
   const nodes=[...top.querySelectorAll<HTMLElement>(focusable)].filter(visible);
   if(!nodes.length){event.preventDefault();top.focus();return;}
   const first=nodes[0],last=nodes[nodes.length-1];
   if(event.shiftKey&&(!top.contains(document.activeElement)||document.activeElement===first)){
    event.preventDefault();last.focus();
   } else if(!event.shiftKey&&(!top.contains(document.activeElement)||document.activeElement===last)){
    event.preventDefault();first.focus();
   }
  }
 };
 let start:{pointer:number;y:number;dialog:HTMLElement}|null=null;
 const onDown=(event:PointerEvent)=>{
  const top=current();
  if(!top||!(event.target instanceof Element)||!top.contains(event.target)
   ||event.target.closest('button,input,select,textarea,a'))return;
  const rect=top.getBoundingClientRect();
  if(event.clientY-rect.top>65||top.scrollTop>0)return;
  start={pointer:event.pointerId,y:event.clientY,dialog:top};
 };
 const onUp=(event:PointerEvent)=>{
  if(start&&event.pointerId===start.pointer&&current()===start.dialog
    &&event.clientY-start.y>110){
   closeButton(start.dialog)?.click();
  }
  start=null;
 };
 const clear=()=>{start=null};
 document.addEventListener('keydown',keydown,true);
 document.addEventListener('pointerdown',onDown,true);
 document.addEventListener('pointerup',onUp,true);
 document.addEventListener('pointercancel',clear,true);
 phone.addEventListener('change',update);
 update();
 return ()=>{
  observer.disconnect();phone.removeEventListener('change',update);
  document.removeEventListener('keydown',keydown,true);
  document.removeEventListener('pointerdown',onDown,true);
  document.removeEventListener('pointerup',onUp,true);
  document.removeEventListener('pointercancel',clear,true);
  if(active){document.body.style.overflow=oldOverflow;previous?.focus?.();}
 };
}
