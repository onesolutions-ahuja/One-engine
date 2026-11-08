import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** ImageField: shared attachment/media service metadata descriptor. */
export const ImageDefinition:FieldTypeDefinition=Object.freeze({
 name:'ImageField',dataType:'image',kind:'attachment',
 storage:'media-service'
});

// Image validation and media storage are shared tenant-aware services.
export async function loadImageValidator(){const service=await import('../../system-files/record-file-service.js');return service.validateTenantImage;}
export async function loadTenantMediaService(){const service=await import('../../system-files/tenant-media-service.js');return service.TenantMediaService;}
