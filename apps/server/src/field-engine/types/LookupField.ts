import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** LookupField: reference metadata descriptor. */
export const LookupDefinition:FieldTypeDefinition=Object.freeze({
 name:'LookupField',dataType:'reference',kind:'relationship',
 relationshipType:'Lookup',
 storage:'record'
});

export function validateLookupField(value:unknown,key:string,relatedObject:string|null|undefined):asserts value is string {
 if(typeof value!=='string'||!relatedObject||!isRecordIdentifier(value))throw new Error('Invalid relationship: '+key);
}
function isRecordIdentifier(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
