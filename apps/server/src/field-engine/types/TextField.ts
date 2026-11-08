import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** TextField: text metadata descriptor. */
export const TextDefinition:FieldTypeDefinition=Object.freeze({
 name:'TextField',dataType:'text',kind:'text',
 storage:'record'
});

export function validateTextField(value:unknown,key:string,maxLength:number|null|undefined):asserts value is string {
 if(typeof value!=='string')throw new Error('Invalid text field: '+key);
 if(maxLength!==null&&maxLength!==undefined&&value.length>maxLength)throw new Error('Invalid text length: '+key);
}
