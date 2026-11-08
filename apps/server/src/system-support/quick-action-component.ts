import type {SqlPersistence} from '../system-files/sql-persistence.js';

// Action execution must not expose arbitrary component names or draft renderers.
// Reuse the shared tenant component registry; do not introduce a separate loader.
const apiName=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
type Queryable=Pick<SqlPersistence,'query'>;
export async function requireActionComponent(db:Queryable,tenantId:string,componentApiName:string){
  if(!apiName.test(componentApiName))throw new Error('Invalid Quick Action Component');
  const {rowCount}=await db.query(`
    SELECT 1 FROM md_component_definitions d
    WHERE d.tenant_id=$1 AND d.api_name=$2 AND d.enabled=true
      AND (d.renderer_key='smart-bundled:' || d.api_name
        OR (d.renderer_key='tenant-library' AND EXISTS (
          SELECT 1 FROM md_component_library_heads h
          WHERE h.tenant_id=d.tenant_id AND h.component_api=d.api_name
            AND h.published_version IS NOT NULL)))
  `,[tenantId,componentApiName]);
  if(!rowCount)throw new Error('Published Quick Action Component is unavailable');
}

export type QuickActionComponentBinding={
  property:string;source:'Literal'|'Record ID'|'Object API'|'Record Field';
  fieldApiName?:string;value?:string
};
/** Bounded no-code property mapping. A global action has no implicit record. */
export function validateActionBindings(
 value:unknown,scope:'global'|'object',fields?:Map<string,string>
):QuickActionComponentBinding[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>20)throw new Error('Invalid component input bindings');
 const names=new Set<string>();
 return value.map(entry=>{
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Invalid component input binding');
  const b=entry as Record<string,unknown>;
  if(typeof b.property!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(b.property)
    ||['__proto__','prototype','constructor','recordId','objectApiName','onClose',
      'onLaunchFlow','actionContext'].includes(b.property)
    ||names.has(b.property.toLowerCase()))throw Error('Invalid component input property');
  names.add(b.property.toLowerCase());
  if(b.source==='Literal'){
   if(typeof b.value!=='string'||b.value.length>1000)throw Error('Invalid literal component input');
   return {property:b.property,source:'Literal' as const,value:b.value};
  }
  if(scope==='global')throw Error('Global component action cannot use a record binding');
  if(b.source==='Record ID'||b.source==='Object API')
   return {property:b.property,source:b.source};
  if(b.source==='Record Field'){
   if(typeof b.fieldApiName!=='string'||!fields?.has(b.fieldApiName)
     ||fields.get(b.fieldApiName)==='encryptedtext')
    throw Error('Invalid component input record Field');
   return {property:b.property,source:'Record Field' as const,fieldApiName:b.fieldApiName};
  }
  throw Error('Invalid component input source');
 });
}

/** Runtime reads the published immutable version even when a newer draft exists. */
export async function publishedActionComponent(db:Queryable,tenantId:string,componentApiName:string){
 const {rows}=await db.query<{
   version:number;created_at:Date;properties:Record<string,unknown>
 }>(`SELECT v.version,v.created_at,v.properties
   FROM md_component_library_heads h
   JOIN md_component_definitions d ON d.tenant_id=h.tenant_id
     AND d.api_name=h.component_api AND d.enabled=true AND d.renderer_key='tenant-library'
   JOIN md_component_library_versions v ON v.tenant_id=h.tenant_id
     AND v.component_api=h.component_api AND v.version=h.published_version
   WHERE h.tenant_id=$1 AND h.component_api=$2
   LIMIT 1`,[tenantId,componentApiName]);
 const row=rows[0];
 return row?{
   ...row.properties,apiName:componentApiName,version:row.version,status:'Published' as const,
   publishedVersion:row.version,updatedAt:new Date(row.created_at).toISOString(),
   compiledJs:'',scopedCss:''
 }:null;
}
