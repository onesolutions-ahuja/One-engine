import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** PicklistField: picklist metadata descriptor. */
export const PicklistDefinition:FieldTypeDefinition=Object.freeze({
 name:'PicklistField',dataType:'picklist',kind:'selection',
 storage:'record'
});

export async function validatePicklistField(value:string,key:string,allowedValues:()=>Promise<readonly string[]>):Promise<void>{
 if(!value)throw new Error('Invalid picklist value: '+key);
 if(!(new Set(await allowedValues())).has(value))throw new Error('Invalid picklist value: '+key);
}
