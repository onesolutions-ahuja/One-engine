import React from 'react';
import {PlatformPageSlot,usePlatformSlotPresentation} from '../../platform/Workspace/PlatformPageSlot';
import {validateComponentSetting, type ComponentSettingDefinition} from '../../components/Properties/componentSettingDefinitions';

/** Reusable metadata-bound administrative primitive; authorisation stays with API Actions. */
export type AdminControlDefinition=ComponentSettingDefinition&{
 inputType?:'text'|'email'|'password'|'color'; maxLength?:number;minLength?:number;
 pattern?:string;autoComplete?:string;placeholder?:string;multiline?:boolean;
};
export default function AdminPropertyControl({definition,value,disabled=false,onChange}:{
 definition:AdminControlDefinition;value:string;disabled?:boolean;onChange:(value:string)=>void;
}){
 const presentation=usePlatformSlotPresentation('field-'+definition.propertyKey);
 const label=presentation.label??definition.label;
 const common={disabled,required:definition.required??false,
  maxLength:definition.maxLength,minLength:definition.minLength,pattern:definition.pattern,
  placeholder:presentation.placeholder??definition.placeholder,'aria-label':label,value,
  onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(event.target.value)};
 return <PlatformPageSlot slotKey={'field-'+definition.propertyKey}><label className="form-label" data-property-key={definition.propertyKey}>
   {label}
   {definition.multiline
     ? <textarea {...common} className="form-control" rows={2}/>
     : <input {...common} className="form-control"
        type={definition.inputType??(definition.kind==='COLOR'?'color':'text')}
        autoComplete={definition.autoComplete}/>}
   {presentation.description&&<span className="form-description">{presentation.description}</span>}
   {presentation.helpText&&<small className="form-help">{presentation.helpText}</small>}
 </label></PlatformPageSlot>;
}
export const adminControlValueValid=(definition:AdminControlDefinition,value:string)=>
 validateComponentSetting(definition,value)&&(!definition.pattern||new RegExp('^(?:'+definition.pattern+')$').test(value));
