import type {PoolClient} from 'pg';

type Selection={tenantId:string;objectApi:string;processApi:string;actorId:string};
type History={revision:number;label:string;status_field:string;active:boolean};
export type ProcessHistoryItem={revision:number;label:string;statusField:string;active:boolean;values:string[]};

/** Snapshot only metadata; the Record Type's active field restrictions are
 * deliberately not changed until an administrator explicitly applies them. */
export async function snapshotBusinessProcessRevision(client:PoolClient,selection:Selection):Promise<void>{
 const {tenantId,objectApi,processApi,actorId}=selection;
 const ids=[tenantId,objectApi,processApi,actorId];
 const written=await client.query(`INSERT INTO md_object_business_process_history
   (tenant_id,object_api,process_api,revision,label,status_field,active,actor_user_id)
   SELECT tenant_id,object_api,api_name,revision,label,status_field,active,$4
   FROM md_object_business_processes
   WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
   ON CONFLICT DO NOTHING RETURNING revision`,ids);
 if(written.rowCount!==1)throw new Error('Business process revision could not be recorded');
 await client.query(`INSERT INTO md_object_business_process_history_values
  (tenant_id,object_api,process_api,revision,value_text,sort_order)
  SELECT v.tenant_id,v.object_api,v.process_api,p.revision,v.value_text,v.sort_order
  FROM md_object_business_process_values v
  JOIN md_object_business_processes p
   ON p.tenant_id=v.tenant_id AND p.object_api=v.object_api AND p.api_name=v.process_api
  WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.process_api=$3`,
  [tenantId,objectApi,processApi]);
}

/** Caller owns transaction + advisory lock; revision conflict denies stale
 * concurrent updates and rollback never mutates live Record Type picklists. */
export async function restoreBusinessProcessRevision(client:PoolClient,
 selection:Selection,version:number,expectedRevision:number):Promise<number>{
 if(!Number.isSafeInteger(version)||version<1||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
  throw new Error('Invalid business process history revision');
 const ids=[selection.tenantId,selection.objectApi,selection.processApi];
 const found=await client.query<History>(`SELECT revision,label,status_field,active
  FROM md_object_business_process_history
  WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3 AND revision=$4`,
  [...ids,version]);
 const history=found.rows[0];
 if(!history)throw new Error('Business process history revision not found');
 const {rows}=await client.query<{value_text:string}>(`SELECT value_text
  FROM md_object_business_process_history_values
  WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3 AND revision=$4
  ORDER BY sort_order`,[...ids,version]);
 if(!rows.length)throw new Error('Historic process has no allowed values');
 const field=await client.query<{data_type:string}>(`SELECT data_type
  FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
  AND deleted_at IS NULL`,[selection.tenantId,selection.objectApi,history.status_field]);
 if(field.rows[0]?.data_type!=='picklist')throw new Error('Historic Picklist status field no longer exists');
 const allowed=await client.query<{value:string}>(`SELECT value
   FROM md_field_picklist_values WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
  [selection.tenantId,selection.objectApi,history.status_field]);
 const present=new Set(allowed.rows.map(x=>x.value));
 if(rows.some(x=>!present.has(x.value_text)))throw new Error('Historic process value is no longer valid');
 const updated=await client.query<{revision:number}>(`UPDATE md_object_business_processes
  SET label=$4,status_field=$5,active=$6,revision=revision+1,updated_at=now()
  WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND revision=$7
  RETURNING revision`,[...ids,history.label,history.status_field,history.active,expectedRevision]);
 const next=updated.rows[0]?.revision;
 if(!next)throw new Error('Business process revision conflict');
 await client.query(`DELETE FROM md_object_business_process_values
  WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3`,ids);
 for(const [order,row] of rows.entries())
  await client.query(`INSERT INTO md_object_business_process_values
   (tenant_id,object_api,process_api,value_text,sort_order) VALUES($1,$2,$3,$4,$5)`,
   [...ids,row.value_text,order]);
 await snapshotBusinessProcessRevision(client,selection);
 return next;
}
