import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {loadNativeFields,nativeTableSql,nativeValueSql} from '../system-files/native-object-query.js';
/** SQL, not this module, owns tenant relationship metadata. */
export async function registeredRelationships(client:PoolClient,tenantId:string,relatedObject:{recordId:string;objectApi:string}){
 const {rows:fields}=await client.query<{object_api:string;api_name:string}>(`
  SELECT f.object_api,f.api_name FROM md_field_definitions f
  WHERE f.tenant_id=$1 AND f.data_type='reference' AND f.related_object=$2
    AND f.deleted_at IS NULL ORDER BY f.object_api,f.api_name`,
  [tenantId,relatedObject.objectApi]);
 type Relationship={record_id:string;object_api:string;field_api:string;relationship_type:string;
  delete_behavior:string|null;required:boolean};
 const found:Relationship[]=[];
 const objects=[...new Set(fields.map(field=>field.object_api))];
 for(const objectApi of objects){
  const native=await loadNativeFields(client,tenantId,objectApi);
  const available=fields.filter(field=>field.object_api===objectApi&&native.fields.has(field.api_name));
  if(!available.length)continue;
  const entries=available.map((field,index)=>
   `(${nativeValueSql(native,field.api_name,'nr')},$${index+4}::text)`).join(',');
  const {rows}=await client.query<Relationship>(`SELECT r.id AS record_id,r.object_api,
    f.api_name AS field_api,COALESCE(f.relationship_type,'Lookup') AS relationship_type,
    f.delete_behavior,f.required
    FROM md_records r JOIN ${nativeTableSql(native)} nr
     ON nr.tenant_id=r.tenant_id AND nr.id=r.id
    JOIN LATERAL (VALUES ${entries}) AS links(reference_record_id,field_api) ON true
    JOIN md_field_definitions f ON f.tenant_id=r.tenant_id AND f.object_api=r.object_api
      AND f.api_name=links.field_api AND f.deleted_at IS NULL AND f.data_type='reference'
    WHERE r.tenant_id=$1 AND r.object_api=$3 AND NOT r.is_deleted
      AND links.reference_record_id=$2
   `,[tenantId,relatedObject.recordId,objectApi,...available.map(f=>f.api_name)]);
  found.push(...rows);
 }
 return found.sort((a,b)=>a.relationship_type.localeCompare(b.relationship_type)
  ||a.object_api.localeCompare(b.object_api)||a.record_id.localeCompare(b.record_id));
}

/** Public tenant-scoped relationship contract shared by Object Manager and
 * consumers such as related lists, report metadata, Flows and ribbon pickers.
 * An edge is identified by source object + field, not by target object alone:
 * two lookups to the same target must remain independent.
 */
export type RelationshipDefinition={
 sourceObject:string;fieldApiName:string;targetObject:string;
 relationshipType:'Lookup'|'Master-Detail'|'Hierarchical';
 relationshipName:string;childRelationshipName:string;
 required:boolean;deleteBehavior:'Clear'|'Cascade'|'Restrict'|null;
 allowReparenting:boolean;
};
export async function listRelationshipDefinitions(
 db:Pick<SqlPersistence,'query'>,tenantId:string,objectApi?:string
):Promise<RelationshipDefinition[]>{
 const {rows}=await db.query<{
  object_api:string;api_name:string;related_object:string;relationship_type:RelationshipDefinition['relationshipType'];
  relationship_name:string|null;child_relationship_name:string|null;required:boolean;
  delete_behavior:RelationshipDefinition['deleteBehavior'];allow_reparenting:boolean;
 }>(`SELECT f.object_api,f.api_name,f.related_object,
   COALESCE(f.relationship_type,'Lookup') AS relationship_type,
   f.relationship_name,f.child_relationship_name,f.required,
   f.delete_behavior,f.allow_reparenting
   FROM md_field_definitions f
   JOIN md_object_definitions source ON source.tenant_id=f.tenant_id
     AND source.api_name=f.object_api AND source.deleted_at IS NULL
   JOIN md_object_definitions target ON target.tenant_id=f.tenant_id
     AND target.api_name=f.related_object AND target.deleted_at IS NULL
   WHERE f.tenant_id=$1 AND f.data_type='reference' AND f.deleted_at IS NULL
     AND ($2::text IS NULL OR f.object_api=$2 OR f.related_object=$2)
   ORDER BY f.object_api,f.api_name`,[tenantId,objectApi??null]);
 return rows.map(row=>({
  sourceObject:row.object_api,fieldApiName:row.api_name,targetObject:row.related_object,
  relationshipType:row.relationship_type,
  relationshipName:row.relationship_name??row.api_name.replace(/Id$/,''),
  childRelationshipName:row.child_relationship_name??row.object_api+'Records',
  required:row.required,deleteBehavior:row.delete_behavior,
  allowReparenting:row.allow_reparenting
 }));
}

/** Deterministically traverse two-hop+ metadata paths. Consumers must use
 * relationship names or field API names when multiple edges share a target;
 * target-object shortcuts are accepted only when uniquely resolvable.
 */
export function resolveRelationshipMetadataPath(
 relationships:readonly RelationshipDefinition[],sourceObject:string,path:readonly string[]
):{targetObject:string;steps:RelationshipDefinition[]}{
 if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(sourceObject)||path.length===0||path.length>10
   ||path.some(segment=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(segment)))
   throw new Error('Invalid relationship path');
 const steps:RelationshipDefinition[]=[];
 let current=sourceObject;
 for(const segment of path){
   const candidates=relationships.filter(edge=>edge.sourceObject===current);
   const explicit=candidates.filter(edge=>
     edge.fieldApiName===segment||edge.relationshipName===segment);
   const matches=explicit.length?explicit:
     candidates.filter(edge=>edge.targetObject===segment);
   if(matches.length!==1)
     throw new Error(matches.length?'Ambiguous relationship path: '+segment:
       'Relationship path not found: '+segment);
   const step=matches[0];
   steps.push(step);
   current=step.targetObject;
 }
 return {targetObject:current,steps};
}
