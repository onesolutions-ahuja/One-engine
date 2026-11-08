import {fieldDefinitions,type FieldTypeDefinition} from './FieldRegistry.js';
/** Resolve the metadata field type without branching on application identity. */
export function resolveFieldType(dataType:string,relationshipType?:string|null):FieldTypeDefinition|undefined{
 return fieldDefinitions.find(d=>d.dataType===dataType&&
  (dataType!=='reference'||d.relationshipType===(relationshipType==='Master-Detail'?'Master-Detail':'Lookup')));
}
/** Runtime storage is still processed by the common tenant/RBAC-protected Record Engine. */
export function requireFieldType(dataType:string,relationshipType?:string|null):FieldTypeDefinition{
 const found=resolveFieldType(dataType,relationshipType);
 if(!found)throw new Error('Unsupported field metadata type: '+dataType);
 return found;
}
