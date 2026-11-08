import type {Express} from 'express';
import {registerMetadataPackageRoutes, type MetadataPackageService} from '../system-support/metadata-package-service.js';
/** Delegate to the existing SQL/RBAC-checked package API, without new routes. */
export function registerPackageApiController(app:Express,service:MetadataPackageService){
 registerMetadataPackageRoutes(app,service);
}
