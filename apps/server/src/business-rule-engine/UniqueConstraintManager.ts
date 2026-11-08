/** External IDs are lookup/index hints; only Unique enforces distinct record values. */
export function requiresUniqueValue(field:{is_unique:boolean;external_id:boolean}):boolean {
 return field.is_unique;
}
