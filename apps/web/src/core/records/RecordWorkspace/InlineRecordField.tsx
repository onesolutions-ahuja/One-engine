import {useState,type ReactNode} from 'react';
import './InlineRecordField.css';
import type {FieldMetadata} from '../../metadata/Definitions/metadata';

const numericTypes=new Set(['Number','Currency','Percent']);
const dates=new Set(['Date','Date/Time']);
/** Field-level editing reuses the shared Record API and the caller's effective
 * object/field/record grants. The client never grants access on its own. */
export default function InlineRecordField({
  field,value,editable,display,onSave,onEditFull
}:{
  field:FieldMetadata;value:unknown;editable:boolean;
  display:ReactNode;onSave:(value:unknown)=>Promise<void>;
  onEditFull?:()=>void;
}) {
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState('');
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const type=field.dataType;
  const direct=editable&&!field.formula&&!field.rollup&&!field.relationship
    &&!['Auto Number','Text (Encrypted)','Address',
      'Geolocation','File','Reference'].includes(type);
  const canOpenFull=editable&&!field.formula&&!field.rollup&&!direct&&Boolean(onEditFull);
  const start=()=>{
    const raw=value===null||value===undefined?'':String(value);
    let formatted=raw;
    if(type==='Date/Time'&&raw){
      const date=new Date(raw);
      if(Number.isFinite(date.getTime())){
        const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
        formatted=local.toISOString().slice(0,16);
      }
    }
    setDraft(formatted);
    setError('');setEditing(true);
  };
  const save=async()=>{
    setWorking(true);setError('');
    try{
      const normalized=type==='Checkbox'
        ?draft==='true'
        :type==='Multi-Select Picklist'
          ?draft||null
        :numericTypes.has(type)
          ?draft.trim()===''?null:Number(draft)
          :draft===''&&!field.required?null:draft;
      if(typeof normalized==='number'&&!Number.isFinite(normalized))
        throw new Error('Enter a valid number');
      if(field.required&&(normalized===null||normalized===''))
        throw new Error('This field is required');
      await onSave(normalized);
      setEditing(false);
    }catch(failure){
      setError(failure instanceof Error?failure.message:'Unable to save field');
    }finally{setWorking(false);}
  };
  return <div className="record-inline-field">
    {!editing?<><span className="record-inline-value">{display}</span>
      {direct&&<button type="button" className="text-action record-inline-edit"
        aria-label={'Edit '+field.label} onClick={start}>Edit</button>}
      {canOpenFull&&<button type="button" className="text-action record-inline-edit"
        aria-label={'Edit '+field.label+' in full editor'} onClick={onEditFull}>
        Edit
      </button>}
    </>:<div className="record-inline-field-editor">
      {type==='Checkbox'?<label><input type="checkbox"
        checked={draft==='true'} disabled={working}
        onChange={event=>setDraft(String(event.target.checked))}/>{field.label}</label>
      :type==='Picklist'&&field.picklistValues?.length?<select
        aria-label={field.label} value={draft} disabled={working}
        onChange={event=>setDraft(event.target.value)}>
        {!field.required&&<option value="">None</option>}
        {field.picklistValues.map(item=><option key={item} value={item}>{item}</option>)}
      </select>
      :type==='Multi-Select Picklist'?<label>{field.label}
        <select className="form-control" multiple aria-label={field.label}
          disabled={working} value={draft.split(';').filter(Boolean)}
          onChange={event=>setDraft(Array.from(event.currentTarget.selectedOptions,option=>option.value).join(';'))}>
          {(field.picklistValues??[]).map(option=><option value={option} key={option}>{option}</option>)}
        </select>
      </label>
      :['Long Text Area','Rich Text Area'].includes(type)?<textarea
        className="form-control" rows={5} aria-label={field.label}
        value={draft} disabled={working} onChange={event=>setDraft(event.target.value)}/>
      :<input className="form-control" aria-label={field.label}
        type={numericTypes.has(type)?'number':dates.has(type)?type==='Date'?'date':'datetime-local'
          :type==='Time'?'time':type==='Email'?'email':type==='Phone'?'tel':type==='URL'?'url':'text'}
        step={numericTypes.has(type)?'any':undefined}
        value={draft} disabled={working} onChange={event=>setDraft(event.target.value)}/>}
      <button type="button" className="btn btn-brand btn-small"
        disabled={working} onClick={()=>void save()}>{working?'Saving…':'Save'}</button>
      <button type="button" className="btn btn-small" disabled={working}
        onClick={()=>setEditing(false)}>Cancel</button>
      {error&&<p role="alert">{error}</p>}
    </div>}
  </div>;
}
