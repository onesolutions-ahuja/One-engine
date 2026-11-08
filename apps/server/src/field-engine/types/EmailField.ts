import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** EmailField: email metadata descriptor. */
export const EmailDefinition:FieldTypeDefinition=Object.freeze({
 name:'EmailField',dataType:'email',kind:'text',
 storage:'record'
});

export function validateEmailField(value:string,key:string):void{
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Invalid email field: '+key);
}
