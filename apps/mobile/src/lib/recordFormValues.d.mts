import type {RecordFormField} from './recordFormApi';
export function fieldType(field:RecordFormField):string;
export function safeField(field:RecordFormField,mode:'create'|'edit'):boolean;
export function serializeChangedFields(fields:RecordFormField[],values:Record<string,unknown>,
 changed:ReadonlySet<string>,mode:'create'|'edit'):Record<string,unknown>;
