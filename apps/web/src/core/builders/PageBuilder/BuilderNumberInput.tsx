import {useState,type InputHTMLAttributes} from 'react';

/**
 * Shared numeric editor for the Page Builder's ribbon, Design dock and canvas.
 * Keep the user's literal draft (including an empty field) while editing.
 * Valid values still update metadata immediately; invalid intermediate text
 * never causes a controlled re-render to overwrite the caret or snap the value.
 */
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,
 'type'|'value'|'onChange'|'onBlur'|'onKeyDown'> & {
 value:number|string|null|undefined;
 onValueChange:(value:number)=>void;
 integer?:boolean;
 onBlur?:InputHTMLAttributes<HTMLInputElement>['onBlur'];
 onKeyDown?:InputHTMLAttributes<HTMLInputElement>['onKeyDown'];
};

export default function BuilderNumberInput({
 value,onValueChange,integer=false,min,max,disabled,onBlur,onKeyDown,...rest
}:Props){
 const [draft,setDraft]=useState<string|null>(null);
 const valid=(raw:string)=>{
  if(!raw.trim())return false;
  const next=Number(raw);
  return Number.isFinite(next)&&(!integer||Number.isInteger(next))
   &&(min===undefined||next>=Number(min))
   &&(max===undefined||next<=Number(max));
 };
 const invalid=draft!==null&&draft.trim()!==''&&!valid(draft);
 return <input {...rest} type="number" min={min} max={max} disabled={disabled}
  value={draft??String(value??'')} aria-invalid={invalid||undefined}
  onChange={event=>{
   const raw=event.currentTarget.value;
   setDraft(raw);
   if(!disabled&&valid(raw))onValueChange(Number(raw));
  }}
  onBlur={event=>{setDraft(null);onBlur?.(event);}}
  onKeyDown={event=>{
   if(event.key==='Escape'){
    event.preventDefault();
    setDraft(null);
    event.currentTarget.blur();
   }else if(event.key==='Enter'){
    event.preventDefault();
    event.currentTarget.blur();
   }
   onKeyDown?.(event);
  }}/>;
}
