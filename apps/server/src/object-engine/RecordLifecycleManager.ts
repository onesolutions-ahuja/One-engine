import type {RecordEngine} from '../system-files/record-engine.js';
/** Lifecycle entry points delegate to the shared RBAC-protected SQL Record Engine. */
export function createRecord(records:RecordEngine,tenantId:string,userId:string,objectApi:string,values:Record<string,unknown>){
 return records.create(tenantId,userId,objectApi,values);
}
export function updateRecord(records:RecordEngine,tenantId:string,userId:string,objectApi:string,id:string,values:Record<string,unknown>){
 return records.update(tenantId,userId,objectApi,id,values);
}
export function deleteRecord(records:RecordEngine,tenantId:string,userId:string,objectApi:string,id:string){
 return records.remove(tenantId,userId,objectApi,id);
}
