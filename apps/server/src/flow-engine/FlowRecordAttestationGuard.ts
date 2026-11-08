import type {SqlPersistence} from '../system-files/sql-persistence.js';

const api=/^[A-Za-z][A-Za-z0-9_]*$/;
type Guard={collectionInput:string;recordObject:string;idInputField:string;
 restrictedField:string;minimumAgeField?:string;attestedInput:string;eventName:string};
function parse(raw:unknown):Guard{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid attestation guard');
 const x=raw as Record<string,unknown>;
 for(const key of ['collectionInput','recordObject','idInputField','restrictedField','attestedInput','eventName'])
  if(typeof x[key]!=='string'||!api.test(x[key]))throw Error('Invalid attestation guard field');
 if(x.minimumAgeField!==undefined&&(typeof x.minimumAgeField!=='string'||!api.test(x.minimumAgeField)))
  throw Error('Invalid attestation minimum age field');
 return x as Guard;
}
/** Reusable fail-closed attestation policy for record collections supplied to a Flow.
 * Checks authoritative tenant records; caller-supplied restriction flags are never trusted.
 * This confirms the operator's signed-in attestation, not the customer's identity.
 */
export async function enforceFlowRecordAttestation(db:SqlPersistence,tenantId:string,
 userId:string,raw:unknown,inputs:Record<string,unknown>):Promise<void>{
 if(raw===undefined||raw===null)return;
 const guard=parse(raw);
 const collection=inputs[guard.collectionInput];
 if(!Array.isArray(collection)||collection.length<1||collection.length>200)
  throw Error('Transaction requires 1 to 200 valid items');
 const ids:string[]=[];
 for(const item of collection){
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Invalid transaction item');
  const recordId=(item as Record<string,unknown>)[guard.idInputField];
  if(typeof recordId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(recordId))
   throw Error('Invalid transaction product reference');
  ids.push(recordId);
 }
 const unique=[...new Set(ids)];
 const {rows}=await db.query<{id:string;restricted:boolean}>(`SELECT r.id,
  (COALESCE(v.value_boolean,false) OR lower(COALESCE(v.value_text,''))='true'
    OR COALESCE(age.value_number,0)>0) AS restricted
  FROM md_records r
  LEFT JOIN md_record_values v ON v.tenant_id=r.tenant_id
   AND v.record_id=r.id AND v.object_api=r.object_api AND v.field_api=$4
  LEFT JOIN md_record_values age ON age.tenant_id=r.tenant_id
   AND age.record_id=r.id AND age.object_api=r.object_api AND age.field_api=$5
  WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.id=ANY($3::uuid[])
   AND r.is_deleted=false`,[tenantId,guard.recordObject,unique,guard.restrictedField,guard.minimumAgeField??'MinimumAge']);
 if(rows.length!==unique.length)throw Error('Transaction includes missing or inaccessible products');
 const restricted=rows.some(row=>row.restricted);
 if(!restricted)return;
 if(inputs[guard.attestedInput]!==true)
  throw Error('Check customer ID before completing the sale');
 await db.query(`INSERT INTO md_security_events(tenant_id,action,details)
  VALUES($1,$2,jsonb_build_object('userId',$3::text,'itemCount',$4::integer,
  'restrictedItemCount',$5::integer,'source','Flow record attestation'))`,
  [tenantId,guard.eventName,userId,collection.length,rows.filter(row=>row.restricted).length]);
}
