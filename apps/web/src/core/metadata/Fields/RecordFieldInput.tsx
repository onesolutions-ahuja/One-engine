import * as React from 'react';

/** Shared field control: follows tenant Object Manager metadata rather than app-specific input types. */
export type RecordField={
 apiName:string;label?:string;dataType?:string;type?:string;required?:boolean;
 picklistValues?:string[];defaultValue?:unknown;readOnly?:boolean;
 relationship?:{targetObject?:string};relatedObject?:string;
};
export function fieldKind(field:RecordField):string {
 const raw=String(field.dataType??field.type??'text').toLowerCase().replace(/\s/g,'');
 if(raw==='checkbox'||raw==='boolean')return 'boolean';
 if(raw.startsWith('formula')||raw==='roll-upsummary'||raw==='rollup'||raw==='autonumber')return 'readonly';
 if(raw.startsWith('picklist')||raw==='picklist')return 'picklist';
 if(raw.startsWith('multi-selectpicklist')||raw==='multipicklist')return 'multipicklist';
 if(raw==='reference'||raw==='lookup'||raw.startsWith('lookup('))return 'reference';
 if(raw==='datetime'||raw==='date/time')return 'datetime';
 if(raw==='date')return 'date';
 if(raw==='time')return 'time';
 if(raw.startsWith('currency'))return 'currency';
 if(raw.startsWith('number'))return 'number';
 if(raw.startsWith('percent'))return 'percent';
 if(raw==='textarea'||raw==='longtext'||raw==='longtextarea'||raw==='richtextarea')return 'textarea';
 if(raw==='email'||(raw==='text'&&field.apiName.toLowerCase().endsWith('email')))return 'email';
 if(raw==='phone'||(raw==='text'&&field.apiName.toLowerCase().endsWith('phone')))return 'phone';
 if(raw==='url')return 'url';
 if(raw==='encryptedtext')return 'readonly';
 return 'text';
}
export function RecordFieldInput({field,value,onChange}:{
 field:RecordField;value:string;onChange:(value:string)=>void;
}){
 const kind=fieldKind(field),label=field.label??field.apiName;
 const disabled=field.readOnly===true||kind==='readonly';
 if(kind==='boolean')return <label className="record-field-toggle">
  <input type="checkbox" checked={value==='true'} disabled={disabled}
   onChange={e=>onChange(e.target.checked?'true':'false')}/>
  <span>{label}</span>
 </label>;
 if(kind==='picklist')return <label>{label}<select value={value} disabled={disabled||!field.picklistValues?.length}
  required={field.required} onChange={e=>onChange(e.target.value)}>
  <option value="">Select {label}</option>
  {(field.picklistValues??[]).map(option=><option value={option} key={option}>{option}</option>)}
 </select>{!field.picklistValues?.length&&<small>No picklist options configured in Object Manager</small>}</label>;
 if(kind==='multipicklist')return <label>{label}<select multiple
  value={value?value.split(';'):[]} disabled={disabled} onChange={e=>onChange(
   Array.from(e.target.selectedOptions,option=>option.value).join(';'))}>
  {(field.picklistValues??[]).map(option=><option value={option} key={option}>{option}</option>)}
 </select></label>;
 if(kind==='textarea')return <label>{label}<textarea value={value} disabled={disabled} required={field.required}
  onChange={e=>onChange(e.target.value)} rows={3}/></label>;
 const input=kind==='phone'?'tel':kind==='datetime'?'datetime-local':
  kind==='number'||kind==='currency'||kind==='percent'?'number':kind==='url'?'url':
  kind==='date'?'date':kind==='time'?'time':kind==='email'?'email':'text';
 return <label>{label}<input type={input} value={value} disabled={disabled} required={field.required}
  step={input==='number'?'any':undefined} onChange={e=>onChange(e.target.value)}/></label>;
}
