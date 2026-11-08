import type {RecordEngine} from '../system-files/record-engine.js';

/** A write has already committed; this read uses existing object, row and field
 * permissions and formula-field evaluation, without trusting the submitted body.
 * If the actor cannot read (or projection fails), retain the original Id-only
 * write response: no secret fields and no false write failure/retry.
 */
export async function authorizedSavedRecordProjection(
 records:Pick<RecordEngine,'get'>,tenantId:string,userId:string,objectApi:string,id:string
):Promise<Record<string,unknown>>{
 try{
  const row=await records.get(tenantId,userId,objectApi,id);
  return row?.Id===id?row:{Id:id};
 }catch(error){
  if(!(error instanceof Error&&['Permission denied','Record not found'].includes(error.message)))
   console.warn('Post-write authorized record projection unavailable; returning Id only');
  return {Id:id};
 }
}
