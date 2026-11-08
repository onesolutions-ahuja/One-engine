import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** CheckboxField: boolean metadata descriptor. */
export const CheckboxDefinition:FieldTypeDefinition=Object.freeze({
 name:'CheckboxField',dataType:'boolean',kind:'boolean',
 storage:'record'
});

export function normalizeCheckboxField(value:unknown,key:string):string {
 if(typeof value!=='boolean')throw new Error('Invalid boolean field: '+key);
 return String(value);
}
