import type {RecordEngine} from '../system-files/record-engine.js';
/** Delegate related records to the single Record Engine so Object, Field and Record RBAC applies. */
export async function queryRelatedRecords(records:RecordEngine,tenantId:string,userId:string,
 childObject:string,relationshipField:string,parentRecordId:string,limit=50,offset=0){
 return records.list(tenantId,userId,childObject,limit,offset,{
  relatedField:relationshipField,relatedId:parentRecordId
 });
}
