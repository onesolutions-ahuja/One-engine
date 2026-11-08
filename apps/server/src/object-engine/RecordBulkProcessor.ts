import type {RecordEngine} from '../system-files/record-engine.js';
/** Shared validated import path; permission checks and batch limits remain in RecordEngine. */
export function importRecordBatch(records:RecordEngine,tenantId:string,userId:string,objectApi:string,rows:unknown){
 return records.importRecords(tenantId,userId,objectApi,rows);
}
