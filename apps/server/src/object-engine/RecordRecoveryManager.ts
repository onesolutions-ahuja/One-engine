import type {RecordEngine} from '../system-files/record-engine.js';
/** Restore and recycle-bin access retain RecordEngine tenant, record and object checks. */
export function listDeletedRecords(records:RecordEngine,tenantId:string,userId:string,objectApi:string,limit=50,offset=0){
 return records.recycleBin(tenantId,userId,objectApi,limit,offset);
}
export function restoreDeletedRecord(records:RecordEngine,tenantId:string,userId:string,objectApi:string,id:string){
 return records.restore(tenantId,userId,objectApi,id);
}
