import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** MultiSelectPicklistField: multipicklist metadata descriptor. */
export const MultiSelectPicklistDefinition:FieldTypeDefinition=Object.freeze({
 name:'MultiSelectPicklistField',dataType:'multipicklist',kind:'selection',
 storage:'record'
});

export async function validateMultiSelectPicklistField(value:string,key:string,allowedValues:()=>Promise<readonly string[]>):Promise<void>{
 const values=value.split(';');
 if(new Set(values).size!==values.length||values.some(v=>!v))throw new Error('Invalid picklist value: '+key);
 const allowed=new Set(await allowedValues());
 if(values.some(v=>!allowed.has(v)))throw new Error('Invalid picklist value: '+key);
}
