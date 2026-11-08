import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** UrlField: url metadata descriptor. */
export const UrlDefinition:FieldTypeDefinition=Object.freeze({
 name:'UrlField',dataType:'url',kind:'text',
 storage:'record'
});

export function validateUrlField(value:string,key:string):void{
 if(!/^https?:\/\/[^\s]+$/i.test(value))throw new Error('Invalid URL field: '+key);
}
