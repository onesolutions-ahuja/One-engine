import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** PhoneField: phone metadata descriptor. */
export const PhoneDefinition:FieldTypeDefinition=Object.freeze({
 name:'PhoneField',dataType:'phone',kind:'text',
 storage:'record'
});

export function validatePhoneField(value:string,key:string):void{
 if(value.length>40||!/\d/.test(value)||!/^\+?[0-9().\-\s]*(?:\s*(?:x|ext\.?|#)\s*\d+)?$/i.test(value))
  throw new Error('Invalid phone field: '+key);
}
