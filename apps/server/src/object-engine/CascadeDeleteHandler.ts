import type {RecordEngine} from '../system-files/record-engine.js';
/** Keep Master-Detail cascade, lookup restriction and SQL transaction in RecordEngine. */
export function cascadeDeleteRecord(records:RecordEngine,tenantId:string,userId:string,objectApi:string,id:string){
 return records.remove(tenantId,userId,objectApi,id);
}
