import { useId, useRef, useState } from 'react';
import { AtSign } from 'lucide-react';
import type { FieldMetadata, FlowDefinitionMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';
import { compatibleFlowValue, flowReferenceChoices, flowReferenceSymbols, referenceName,
  type FlowReferenceSymbol } from '../FlowBuilder/flowReferenceCatalog';
import { flowReferenceBrowserGroups } from '../FlowBuilder/flowReferenceBrowserModel';
import { flowReferenceTokenAt, insertFlowReference } from '../FlowBuilder/flowReferenceTokens';
import ReferenceBrowser from '../../../component-libraries/shared/primitives/ReferenceBrowser/ReferenceBrowser';
import {useDismissOnOutside} from '../../accessibility/Dismiss/useDismissOnOutside';
import './FlowReferenceInput.css';

type Props = {
  value: string;
  onChange: (value:string)=>void;
  flow: FlowDefinitionMetadata;
  elementId: number;
  objects: readonly ObjectMetadata[];
  field?: FieldMetadata;
  targetObjectApiName?: string;
  ariaLabel: string;
  placeholder?: string;
  multiline?: boolean;
};

/** Flow values use the existing {!Resource.Field} runtime syntax; @ $ ! are only the no-code entry points. */
export default function FlowReferenceInput({
  value,onChange,flow,elementId,objects,field,targetObjectApiName,ariaLabel,placeholder,multiline=false
}:Props) {
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [symbol,setSymbol]=useState<FlowReferenceSymbol|undefined>();
  const id=useId();
  const container=useRef<HTMLDivElement>(null);
  const inputRef=useRef<HTMLInputElement|HTMLTextAreaElement|null>(null);
  const tokenRef=useRef<{start:number;end:number}|null>(null);
  useDismissOnOutside(container, open, () => setOpen(false));
  // Always browse the full Object metadata. Keep incompatible fields visible with a reason.
  const catalog=flowReferenceChoices(flow,elementId,objects);
  const selected=catalog.find(choice=>choice.reference===value.trim() &&
    compatibleFlowValue(choice,field,targetObjectApiName) && !choice.unavailableReason);
  const path=referenceName(value);
  const unknownEmbedded=[...value.matchAll(/\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/g)]
    // public_* values come from the selected Named Credential at run time.
    .some(match=>!match[1].startsWith('public_')&&!catalog.some(choice=>choice.reference===match[0]));
  const badReference=Boolean(path&&!selected) || (!path&&unknownEmbedded);
  const {groups,directOptions}=flowReferenceBrowserGroups(flow,elementId,objects,field,targetObjectApiName,symbol);
  const close=()=>{setOpen(false);setSearch('');setSymbol(undefined);tokenRef.current=null};
  const pick=(reference:string)=>{
    const element=inputRef.current;
    const at=tokenRef.current
      ??{start:element?.selectionStart??value.length,end:element?.selectionEnd??value.length};
    // A single-value field holding only a reference is replaced, not appended to.
    const whole=!multiline&&(!value.trim()||Boolean(referenceName(value)));
    const next=whole?{value:reference,cursor:reference.length}
      :insertFlowReference(value,at.start,at.end,reference);
    onChange(next.value);
    close();
    requestAnimationFrame(()=>{element?.focus();element?.setSelectionRange(next.cursor,next.cursor)});
  };
  const update=(next:string,cursor:number)=>{
    onChange(next);
    const token=flowReferenceTokenAt(next,cursor);
    if(token){
      tokenRef.current={start:token.start,end:cursor};
      setSymbol(token.symbol);setSearch(token.query);setOpen(true);
    }else if(open&&tokenRef.current)close();
  };
  const browse=(next?:FlowReferenceSymbol)=>{
    tokenRef.current=null;setSearch('');setSymbol(next);setOpen(true);
  };
  const common={
    className:'form-control','aria-label':ariaLabel,'aria-invalid':badReference,
    placeholder:placeholder??'Type a value, or @ record field · $ user/system · ! flow value',
    value,
    ref:(node:HTMLInputElement|HTMLTextAreaElement|null)=>{inputRef.current=node},
    onChange:(event:{target:HTMLInputElement|HTMLTextAreaElement})=>
      update(event.target.value,event.target.selectionStart??event.target.value.length),
    onKeyDown:(event:{key:string})=>{if(event.key==='Escape')close()}
  };
  return <div className="flow-reference-input" ref={container}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false)}}>
    <div className={'flow-reference-input-row'+(selected?' is-valid':'')+(badReference?' is-invalid':'')}>
      {multiline?<textarea rows={4} {...common}/>:<input {...common}/>}
      <button type="button" aria-expanded={open} aria-controls={id}
        aria-label={'Choose reference for '+ariaLabel} title="Browse record fields, user/system values and flow values"
        onClick={()=>open?close():browse()}><AtSign size={16}/></button>
    </div>
    {selected && <small className="flow-reference-value-hint">
      {selected.symbol} {selected.label} <span className="flow-reference-type">{selected.dataType}</span></small>}
    {badReference && <small className="flow-reference-error" role="status">
      This value is not available here. Type @, $ or ! to choose one from the list.
    </small>}
    {open && <>
      <div className="flow-reference-symbols" role="tablist" aria-label="Value type">
        <button type="button" role="tab" aria-selected={!symbol} onClick={()=>browse()}>All</button>
        {flowReferenceSymbols.map(item=><button key={item.symbol} type="button" role="tab"
          aria-selected={symbol===item.symbol} title={item.hint}
          onClick={()=>browse(item.symbol)}><b>{item.symbol}</b> {item.label}</button>)}
      </div>
      <ReferenceBrowser id={id} groups={groups}
        directOptions={directOptions} query={search} onQueryChange={setSearch}
        onChoose={pick} onClose={close}
        emptyHint={symbol==='!'
          ?'No flow values yet. Earlier steps (HTTP Callout, Parse JSON, Actions) list their outputs here once configured, or add a Variable in Resources.'
          :'No matching available value. Check the Loop collection, selected Object, relationship metadata and Get Records fields to store.'}/>
    </>}
  </div>;
}
