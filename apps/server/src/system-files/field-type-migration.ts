// Existing field metadata and migration callers use the canonical shared Field Engine.
export {fieldTypeSignature,fieldTypeConversionSupported,convertFieldValue,applyFieldTypeMigration,rollbackFieldTypeMigration} from '../field-engine/FieldTypeMigration.js';
export type {FieldTypeMigrationRuntime,FieldTypeTarget} from '../field-engine/FieldTypeMigration.js';
