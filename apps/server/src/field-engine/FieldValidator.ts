import {fieldTypeConversionSupported} from './FieldTypeMigration.js';
import {resolveFieldType} from './FieldDispatcher.js';
/** Validate authorable field-type metadata; value validation stays in shared Record Engine. */
export function validateFieldTypeMetadata(dataType:string,relationshipType?:string|null):boolean{
 return resolveFieldType(dataType,relationshipType)!==undefined;
}
export {fieldTypeConversionSupported};
