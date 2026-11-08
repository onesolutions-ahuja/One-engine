import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
/** Resolve a reference only within the caller's tenant, without bypassing Record Engine RBAC. */
export async function assertLookupTargetExists(db:SqlPersistence|PoolClient,tenantId:string,objectApi:string|null,recordId:string,fieldKey:string,actorUserId?:string){
 // When invoked by Record Engine, apply parent read access inside its current
 // transaction (not an RBAC side connection that cannot see new Flow records).
 const match=await db.query(actorUserId
  ?"SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false AND md_record_access($1,$4,id,'read')"
  :'SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false',
  actorUserId?[tenantId,objectApi,recordId,actorUserId]:[tenantId,objectApi,recordId]);
 if(!match.rowCount)throw new Error('Invalid relationship target: '+fieldKey);
}

/** Resolve Excel import references without weakening the shared Record Engine.
 * UUIDs remain the canonical format. For convenience, exact Name values are
 * accepted only when exactly one readable record matches in this tenant.
 * Never choose an ambiguous record or bypass Object/Field/Record RBAC.
 */
export async function resolveImportLookupValue(
 db:SqlPersistence|PoolClient,rbac:Pick<RbacEngine,'require'>,
 tenantId:string,userId:string,fieldKey:string,relatedObject:string|null|undefined,rawValue:string
):Promise<string>{
 if(!relatedObject)throw new Error(fieldKey+': relationship target is not configured');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(uuid.test(rawValue)){
  try{await assertLookupTargetExists(db,tenantId,relatedObject,rawValue,fieldKey,userId);}
  catch{throw new Error(fieldKey+': '+relatedObject+' record ID is missing or not readable');}
  return rawValue;
 }
 // Resolving a human-readable value exposes only records the caller can read,
 // and requires explicit access to both the destination Object and Name field.
 await rbac.require(tenantId,userId,relatedObject,'read');
 await rbac.require(tenantId,userId,relatedObject+'.Name','read');
 const {rows}=await db.query<{id:string}>(`
   SELECT r.id FROM md_records r
   JOIN md_field_definitions f ON f.tenant_id=r.tenant_id
     AND f.object_api=r.object_api AND f.api_name='Name'
     AND f.data_type IN ('text','textarea','longtext') AND f.deleted_at IS NULL
   JOIN md_record_values v ON v.tenant_id=r.tenant_id
     AND v.object_api=r.object_api AND v.record_id=r.id AND v.field_api=f.api_name
   WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
     AND v.value_text=$3 AND md_record_access($1,$4,r.id,'read')
   ORDER BY r.id LIMIT 2`,[tenantId,relatedObject,rawValue,userId]);
 if(!rows.length)throw new Error(fieldKey+': no readable '+relatedObject+
   ' record with Name "'+rawValue+'". Import the related records first, or enter their record UUID.');
 if(rows.length>1)throw new Error(fieldKey+': multiple '+relatedObject+
   ' records have Name "'+rawValue+'". Use the correct record UUID instead.');
 return rows[0].id;
}
