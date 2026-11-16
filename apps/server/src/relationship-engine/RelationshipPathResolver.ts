import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {loadNativeFields,nativeTableSql,nativeValueSql} from '../system-files/native-object-query.js';

type Queryable=Pick<PoolClient,'query'>|Pick<SqlPersistence,'query'>;
type RelationshipRow={api_name:string;related_object:string;relationship_name:string|null};
type ValueRow={reference_record_id:string|null};
type OutputRow={data_type:string;value_text:string|null};

/** Resolve a field through metadata-defined reference edges, never by guessing
 * the first field that happens to point at a target object.
 *
 * Each hop accepts the source field API, the configured relationship alias or,
 * for backwards compatibility, a target object API only if unambiguous.
 * Every traversed reference and destination is checked in the same tenant,
 * including record sharing and field-level read permissions.
 */
export async function resolveRelationshipFieldPath(
 db:Queryable,tenantId:string,userId:string,sourceObject:string,
 sourceValues:Readonly<Record<string,unknown>>,path:readonly string[],
 bypassSecurity=false
):Promise<unknown|null>{
 if(path.length<2||path.length>6||path.some(part=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(part)))
  throw new Error('Invalid relationship field path');
 let currentObject=sourceObject;
 let currentId=typeof sourceValues.Id==='string'?sourceValues.Id:null;
 const traversed=new Set<string>();
 const readable=async(objectApi:string,fieldApi:string)=>{
  if(bypassSecurity)return true;
  const {rows}=await db.query<{allowed:boolean}>(
   "SELECT md_rbac_allowed($1,$2,$3,'read') AS allowed",
   [tenantId,userId,objectApi+'.'+fieldApi]);
  return rows[0]?.allowed===true;
 };
 for(const [index,part] of path.slice(0,-1).entries()){
  const {rows}=await db.query<RelationshipRow>(
   `SELECT api_name,related_object,relationship_name
    FROM md_field_definitions
    WHERE tenant_id=$1 AND object_api=$2 AND data_type='reference'
      AND related_object IS NOT NULL AND deleted_at IS NULL
      AND (api_name=$3 OR relationship_name=$3 OR related_object=$3)
    ORDER BY api_name`,
   [tenantId,currentObject,part]);
  // Explicit API name/relationship alias wins over legacy target-object names.
  const named=rows.filter(row=>row.api_name===part||row.relationship_name===part);
  const matches=named.length?named:rows;
  if(matches.length!==1)throw new Error(matches.length
   ?'Ambiguous relationship path: '+part:'Unknown relationship path: '+part);
  const relationship=matches[0];
  if(!await readable(currentObject,relationship.api_name))return null;
  let reference:unknown;
  if(index===0&&Object.hasOwn(sourceValues,relationship.api_name))
   reference=sourceValues[relationship.api_name];
  else if(currentId){
   const native=await loadNativeFields(db,tenantId,currentObject);
   const referenceSql=nativeValueSql(native,relationship.api_name,'nr');
   const found=await db.query<ValueRow>(
    `SELECT ${referenceSql} AS reference_record_id FROM ${nativeTableSql(native)} nr
     WHERE nr.tenant_id=$1 AND nr.id=$2`,[tenantId,currentId]);
   reference=found.rows[0]?.reference_record_id??null;
  }
  if(typeof reference!=='string')return null;
  const nextId=reference;
  const nextObject=relationship.related_object;
  const visit=JSON.stringify([nextObject,nextId]);
  if(traversed.has(visit))throw new Error('Circular record relationship path');
  traversed.add(visit);
  const exists=await db.query<{id:string}>(
   bypassSecurity
    ?'SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false'
    :`SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2
        AND id=$3 AND is_deleted=false AND md_record_access($1,$4,id,'read')`,
   bypassSecurity?[tenantId,nextObject,nextId]:[tenantId,nextObject,nextId,userId]);
  if(!exists.rows[0])return null;
  currentId=nextId;
  currentObject=nextObject;
 }
 const final=path.at(-1)!;
 if(!currentId)return null;
 // Record Id is governed by the record's read permission checked at each hop,
 // rather than by a fictitious Object.Id field permission.
 if(final==='Id')return currentId;
 if(!await readable(currentObject,final))return null;
 const native=await loadNativeFields(db,tenantId,currentObject);
 if(!native.fields.has(final))return null;
 const valueSql=nativeValueSql(native,final,'nr',true);
 const result=await db.query<OutputRow>(`SELECT f.data_type,${valueSql} AS value_text
   FROM md_field_definitions f JOIN ${nativeTableSql(native)} nr
     ON nr.tenant_id=f.tenant_id AND nr.id=$3
   WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.api_name=$4
     AND f.deleted_at IS NULL`,[tenantId,currentObject,currentId,final]);
 const value=result.rows[0];
 if(!value||value.data_type==='encryptedtext')return null;
 if(['number','currency','percent'].includes(value.data_type))
  return value.value_text===null?null:Number(value.value_text);
 if(value.data_type==='boolean')return value.value_text===null?null:value.value_text==='true';
 if(value.data_type==='date')return value.value_text;
 if(value.data_type==='datetime')
  return value.value_text===null?null:new Date(value.value_text).toISOString();
 return value.value_text;
}
