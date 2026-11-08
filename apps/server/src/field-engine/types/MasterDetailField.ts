import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** MasterDetailField: reference metadata descriptor. */
export const MasterDetailDefinition:FieldTypeDefinition=Object.freeze({
 name:'MasterDetailField',dataType:'reference',kind:'relationship',
 relationshipType:'Master-Detail',
 storage:'record'
});

export function assertMasterDetailReparenting(previous:string|null|undefined,newId:string,key:string,allowed:boolean):void{
 if(previous&&previous!==newId&&!allowed)throw new Error('Master-Detail relationship does not allow reparenting: '+key);
}
