import SmartFormulaField from './SmartFormulaField';
import {usePageFormulaScope} from '../../components/RegisteredComponent/PageFormulaScope';
import {useEffect,useRef,useState, type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import type {FieldMetadata,ObjectMetadata} from '../../metadata/Definitions/metadata';
import {relationshipFormulaFields} from './relationshipFormulaFields';

/** A bounded @field picker; expressions are evaluated by the component runtime, never by eval(). */
export default function RibbonFieldExpressionInput(props:Parameters<typeof StandaloneFieldInput>[0]){
 const scope=usePageFormulaScope();
 if(!scope)return <StandaloneFieldInput {...props}/>;
 return <div className="office-ribbon-inline-field office-ribbon-expression-input">
  <span className="office-ribbon-field-name">{props.label}</span>
  <SmartFormulaField label={props.label+' expression'} value={props.value} onChange={props.onChange}
   disabled={false} fields={props.fields} objects={props.objects} rootObjectApiName={props.objectApiName}/>
 </div>;
}
function StandaloneFieldInput({label,value,fields,onChange,placeholder,objects=[],objectApiName=''}:{
  label:string;value:string;fields:FieldMetadata[];onChange:(value:string)=>void;placeholder?:string;
  objects?:readonly ObjectMetadata[];objectApiName?:string;
}){
  const [focused,setFocused]=useState(false);
  const inputRef=useRef<HTMLInputElement>(null);
  const [position,setPosition]=useState({top:0,left:0});
  const positionPicker=()=>{const box=inputRef.current?.getBoundingClientRect();if(box)setPosition({top:box.bottom+3,left:Math.max(8,Math.min(box.left,window.innerWidth-350))});};
  useEffect(()=>{if(!focused)return;const close=()=>setFocused(false);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};},[focused]);
  const [choice,setChoice]=useState(0);
  const [caret,setCaret]=useState(value.length);
  const at=Math.min(caret,value.length);
  const before=value.slice(0,at);
  const quoteCount=(before.match(/"/g)||[]).length;
  const token=quoteCount%2===0?/@([A-Za-z0-9_.]*)$/.exec(before):null;
  const query=token?.[1]?.toLowerCase()??'';
  const suggestions=token?(objects.length&&objectApiName
    ?relationshipFormulaFields(objects,[objectApiName],query).slice(0,200)
    :fields.filter(field=>field.apiName.toLowerCase().includes(query)||field.label.toLowerCase().includes(query))
      .slice(0,200).map(field=>({reference:'@'+field.apiName,label:field.label,path:objectApiName}))):[];
  const insert=(index:number)=>{
    const field=suggestions[index];
    if(!field)return;
    const replacement=field.reference;
    const prefix=value.slice(0,at-(token?.[0].length??0));
    onChange(prefix+replacement+value.slice(at));
    const nextCaret=prefix.length+replacement.length;
    setCaret(nextCaret);
    requestAnimationFrame(()=>{inputRef.current?.focus();inputRef.current?.setSelectionRange(nextCaret,nextCaret);});
    setFocused(false);setChoice(0);
  };
  const onKey=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(!focused||!suggestions.length)return;
    if(event.key==='ArrowDown'){event.preventDefault();setChoice(value=>(value+1)%suggestions.length);}
    if(event.key==='ArrowUp'){event.preventDefault();setChoice(value=>(value+suggestions.length-1)%suggestions.length);}
    if(event.key==='Enter'){event.preventDefault();insert(Math.min(choice,suggestions.length-1));}
    if(event.key==='Escape'){setFocused(false);}
  };
  return <label className="office-ribbon-inline-field office-ribbon-expression-input">
    <span className="office-ribbon-field-name">{label}</span>
    <span className="office-ribbon-expression-anchor">
      <input ref={inputRef} type="text" aria-label={label+' expression'} autoComplete="off"
        value={value} placeholder={placeholder??'Type @ for fields'} onKeyDown={onKey}
        onFocus={event=>{setCaret(event.currentTarget.selectionStart??value.length);positionPicker();setFocused(true);}}
        onClick={event=>{setCaret(event.currentTarget.selectionStart??value.length);setChoice(0);}}
        onKeyUp={event=>{setCaret(event.currentTarget.selectionStart??value.length);}}
        onBlur={()=>setFocused(false)}
        onChange={event=>{setCaret(event.currentTarget.selectionStart??event.currentTarget.value.length);onChange(event.currentTarget.value);setChoice(0);positionPicker();setFocused(true);}}/>
      {focused&&token&&createPortal(<div className="office-ribbon-field-suggestions" role="listbox" aria-label="Fields from selected source object" style={{position:"fixed",top:position.top,left:position.left}}>
        {!fields.length?<span className="office-ribbon-expression-hint">Choose a Source Object first</span>:suggestions.length===0?<span className="office-ribbon-expression-hint">No matching fields</span>:
        suggestions.map((field,index)=><button type="button" role="option" aria-selected={choice===index}
          key={field.reference} onMouseDown={event=>event.preventDefault()} onClick={()=>insert(index)}>
          <span>{field.label}</span><small>{field.reference}</small>
        </button>)}
      </div>,document.body)}
    </span>
  </label>;
}
