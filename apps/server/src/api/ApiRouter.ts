import type {Express} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';
import {registerObjectApiController} from './ObjectApiController.js';
import {registerMetadataApiController} from './MetadataApiController.js';
import {registerFlowApiController} from './FlowApiController.js';
import {registerPageApiController} from './PageApiController.js';
/** Existing dynamic routes, preserved with the original API paths and tenant guards. */
export function registerDynamicApiRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine,records:RecordEngine,flows:FlowRuntime){
 registerFlowApiController(app,db,rbac,flows);
 registerObjectApiController(app,records);
 registerMetadataApiController(app,db,rbac,records);
 registerPageApiController(app,db,rbac);
}
