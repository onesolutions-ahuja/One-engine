import {behaviorField,type BehaviorContext} from '../../pages/PageRuntime/pageBehaviorRuntime';
import type {FieldMetadata} from '../../metadata/Definitions/metadata';

export function recordInlineFieldRules(
  fieldApiName:string,
  properties:Readonly<Record<string,unknown>>|undefined,
  context:BehaviorContext
):{visible:boolean;required:boolean;readOnly:boolean}{
  const fieldBehavior=properties?behaviorField(properties,fieldApiName,context):null;
  const requiredFields=Array.isArray(properties?.requiredFieldApiNames)
    ?properties.requiredFieldApiNames:[];
  const readOnlyFields=Array.isArray(properties?.readOnlyFieldApiNames)
    ?properties.readOnlyFieldApiNames:[];
  return {
    visible:fieldBehavior?.visible!==false,
    required:properties?.requiredOnLayout===true||requiredFields.includes(fieldApiName)
      ||fieldBehavior?.required===true,
    readOnly:properties?.readOnlyOnLayout===true||readOnlyFields.includes(fieldApiName)
      ||fieldBehavior?.readOnly===true
  };
}

export function validateInlineFieldValue(field:FieldMetadata,value:unknown,readOnly:boolean):void{
  if(readOnly)throw new Error('Field editing is not permitted');
  if((field.required)&&(value===null||value===undefined||typeof value==='string'&&!value.trim()))
    throw new Error(`${field.label} is required`);
}
