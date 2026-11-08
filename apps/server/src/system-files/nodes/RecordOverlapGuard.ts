import type {PoolClient} from 'pg';

/** Generic transactional Flow record-interval guard; configured entirely through Flow metadata.
 * It is not an app-specific appointment engine. Source writes still go through RecordEngine.
 */
export async function enforceRecordOverlap(client:PoolClient,tenantId:string,objectApi:string,
 raw:unknown,record:Record<string,unknown>):Promise<void>{
 if(raw===undefined||raw===null)return;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('Invalid Flow overlap guard');
 const config=raw as Record<string,unknown>;
 const api=/^[A-Za-z][A-Za-z0-9_]*$/;
 const startField=config.startField,endField=config.endField;
 const groupFields=config.groupFields,statusField=config.statusField;
 const excludedStatuses=config.excludedStatuses??['Cancelled'];
 if(typeof startField!=='string'||!api.test(startField)
  ||typeof endField!=='string'||!api.test(endField)
  ||!Array.isArray(groupFields)||!groupFields.length||groupFields.length>5
  ||groupFields.some(x=>typeof x!=='string'||!api.test(x))
  ||typeof statusField!=='string'||!api.test(statusField)
  ||!Array.isArray(excludedStatuses)||excludedStatuses.length>20
  ||excludedStatuses.some(x=>typeof x!=='string'||x.length>60))
  throw Error('Invalid Flow overlap guard fields');
 const start=record[startField],end=record[endField];
 if(typeof start!=='string'||typeof end!=='string'
  ||!/Z$|[+-][0-9]{2}:[0-9]{2}$/.test(start)
  ||!/Z$|[+-][0-9]{2}:[0-9]{2}$/.test(end)
  ||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))
  ||Date.parse(start)>=Date.parse(end))
  throw Error('Booking overlap guard needs ordered timezone-qualified start/end');
 if(excludedStatuses.includes(record[statusField]))return;
 const groups=[...new Set(groupFields
  .map(field=>record[field])
  .filter((value):value is string=>typeof value==='string'&&!!value.trim())
  .map(value=>value.trim()))].sort();
 if(!groups.length)
  throw Error('Booking requires an assigned staff member or resource');
 // Lock every occupied staff/resource key, always in stable order to avoid deadlocks.
 // Checking only the first key would allow double-booking a room with another staff member.
 for(const group of groups)
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
   [tenantId+':flow-overlap:'+objectApi+':'+group]);
 const id=typeof record.Id==='string'?record.Id:null;
 for(const group of groups){
  const {rowCount}=await client.query(`
  SELECT 1 FROM md_records r
  JOIN md_record_values starts
   ON starts.tenant_id=r.tenant_id AND starts.record_id=r.id AND starts.field_api=$3
  JOIN md_record_values ends
   ON ends.tenant_id=r.tenant_id AND ends.record_id=r.id AND ends.field_api=$4
  LEFT JOIN md_record_values status
   ON status.tenant_id=r.tenant_id AND status.record_id=r.id AND status.field_api=$7
  WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
   AND starts.value_datetime < $10::timestamptz
   AND ends.value_datetime > $9::timestamptz
   AND EXISTS(
    SELECT 1 FROM md_record_values resource
    WHERE resource.tenant_id=r.tenant_id AND resource.record_id=r.id
      AND resource.field_api=ANY($5::text[])
      AND COALESCE(resource.reference_record_id::text,resource.value_text)=$6
   )
   AND (status.value_text IS NULL OR status.value_text <> ALL($8::text[]))
   AND ($11::uuid IS NULL OR r.id<>$11::uuid)
  LIMIT 1
 `,[tenantId,objectApi,startField,endField,groupFields,group,statusField,excludedStatuses,
  start,end,id]);
  if(rowCount)throw Error('This staff member or resource is already booked for the selected time');
 }
}

/** Idempotent provider-input identity. Tenant-scoped transaction lock plus the
 * same shared Record persistence; enabled only by explicit Flow metadata.
 */
export async function enforceUniqueRecordInput(client:PoolClient,tenantId:string,
 objectApi:string,raw:unknown,record:Record<string,unknown>):Promise<void>{
 if(raw===null||raw===undefined)return;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid unique input guard');
 const key=(raw as Record<string,unknown>).field;
 if(typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))
  throw Error('Invalid unique input Field');
 const value=record[key];
 if(typeof value!=='string'||value.length<1||value.length>255)
  throw Error('External input idempotency reference required');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
  [tenantId+':flow-unique:'+objectApi+':'+key+':'+value]);
 const {rowCount}=await client.query(`
  SELECT 1 FROM md_records r
  JOIN md_record_values v ON v.tenant_id=r.tenant_id
   AND v.record_id=r.id AND v.object_api=r.object_api AND v.field_api=$3
  WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
   AND v.value_text=$4 LIMIT 1`,[tenantId,objectApi,key,value]);
 if(rowCount)throw Error('External request was already processed');
}
