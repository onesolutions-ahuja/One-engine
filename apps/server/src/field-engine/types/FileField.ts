import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** FileField: shared attachment/media service metadata descriptor. */
export const FileDefinition:FieldTypeDefinition=Object.freeze({
 name:'FileField',dataType:'file',kind:'attachment',
 storage:'media-service'
});

// File operations retain the shared SQL/RBAC-protected file service.
export async function loadFileFieldService(){return import('../../system-files/tenant-media-service.js');}
