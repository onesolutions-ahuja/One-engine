import type { SqlPersistence } from '../system-files/sql-persistence.js';
export type LegacySqlObject = {
  object_id:string;tenant_id:string;api_name:string;object_label:string;physical_table:string;active:boolean;
};
export type LegacySqlField = {
  field_id:string;object_id:string;api_name:string;field_label:string;source_data_type:string;physical_column:string;active:boolean;
};
export type CutoverIssue = {code:string;objectApi?:string;fieldApi?:string;target?:string};
export type CutoverReport = {
  source:{activeObjects:number;retiredObjects:number;activeFields:number;unresolvedLookups:number;systemObjectsMissing:string[]};
  blockers:CutoverIssue[];
  safeToMigrate:boolean;
};
const legalApi=/^[A-Za-z][A-Za-z0-9_]*$/;
const legalTable=/^md_obj_[a-f0-9]{32}$/;
const legalColumn=/^md_fld_[a-f0-9]{32}$/;
const preservedTypes=/^(?:Text(?:\([0-9]+\))?|Number(?:\([0-9]+,\s*[0-9]+\))?|Currency(?:\([0-9]+,\s*[0-9]+\))?|Percent(?:\([0-9]+,\s*[0-9]+\))?|Date(?:\/Time)?|DateTime|Checkbox|Picklist|Long Text Area|URL|Email|Phone|AutoNumber|Auto Number|Name|Lookup\([A-Za-z][A-Za-z0-9_]*\)|Formula\([A-Za-z][A-Za-z0-9_]*\))$/i;
/** Read-only migration inventory. Never creates, updates, deletes or rewrites existing SQL. */
export async function inspectSqlCutover(db:Pick<SqlPersistence,'query'>):Promise<CutoverReport> {
  const {rows:tables}=await db.query<{table_name:string}>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'"
  );
  const known=new Set(tables.map(t=>t.table_name));
  const blockers:CutoverIssue[]=[];
  for(const name of ['md_v2_object_registry','md_v2_field_registry','metadrive_rel_tenants'])
    if(!known.has(name))blockers.push({code:'SOURCE_TABLE_MISSING',target:name});
  if(blockers.length)return {
    source:{activeObjects:0,retiredObjects:0,activeFields:0,unresolvedLookups:0,systemObjectsMissing:[]},
    blockers,safeToMigrate:false
  };
  const {rows:objects}=await db.query<LegacySqlObject>(
    'SELECT object_id,tenant_id,api_name,object_label,physical_table,active FROM md_v2_object_registry ORDER BY tenant_id,api_name');
  const {rows:fields}=await db.query<LegacySqlField>(
    'SELECT field_id,object_id,api_name,field_label,source_data_type,physical_column,active FROM md_v2_field_registry ORDER BY object_id,api_name');
  const active=objects.filter(x=>x.active);
  const byId=new Map(active.map(x=>[x.object_id,x]));
  const names=new Set(active.map(x=>x.tenant_id+':'+x.api_name.toLowerCase()));
  const missing=new Set<string>();
  if(names.size!==active.length)blockers.push({code:'DUPLICATE_OBJECT_NAMES'});
  for(const obj of active){
    if(!legalApi.test(obj.api_name)||!legalTable.test(obj.physical_table))
      blockers.push({code:'UNSAFE_OBJECT_IDENTIFIER',objectApi:obj.api_name});
    if(!known.has(obj.physical_table))
      blockers.push({code:'TYPED_TABLE_MISSING',objectApi:obj.api_name});
  }
  let activeFields=0,unresolvedLookups=0;
  const fieldNames=new Set<string>();
  for(const field of fields) {
    if(!field.active)continue;
    const obj=byId.get(field.object_id);
    if(!obj)continue; // Retired objects stay retired.
    activeFields++;
    const key=obj.object_id+':'+field.api_name.toLowerCase();
    if(fieldNames.has(key)) blockers.push({code:'DUPLICATE_FIELD_NAMES',objectApi:obj.api_name,fieldApi:field.api_name});
    fieldNames.add(key);
    if(!legalApi.test(field.api_name)||!legalColumn.test(field.physical_column))
      blockers.push({code:'UNSAFE_FIELD_IDENTIFIER',objectApi:obj.api_name,fieldApi:field.api_name});
    if(!preservedTypes.test(field.source_data_type))
      blockers.push({code:'UNSUPPORTED_FIELD_TYPE',objectApi:obj.api_name,fieldApi:field.api_name});
    const related=/^Lookup\(([^)]+)\)$/i.exec(field.source_data_type)?.[1];
    if(related&&!names.has(obj.tenant_id+':'+related.toLowerCase())) {
      unresolvedLookups++;
      missing.add(related);
      blockers.push({code:'LOOKUP_TARGET_MISSING',objectApi:obj.api_name,fieldApi:field.api_name,target:related});
    }
  }
  // The fresh runtime cannot safely restore the former login sessions, Page/Flow
  // published versions and policy grants using only the object and field registry.
  // It must never falsely report "safe" based on table names or compilation alone.
  const required=['md_users','md_permission_sets','md_permission_rules','md_page_definitions','md_flow_definitions'];
  for(const table of required)
    if(!known.has(table))blockers.push({code:'NEW_SYSTEM_TABLE_MISSING',target:table});
  blockers.push({code:'IDENTITY_AND_PUBLISHED_METADATA_RECONCILIATION_REQUIRED'});
  return {
    source:{
      activeObjects:active.length,retiredObjects:objects.length-active.length,
      activeFields,unresolvedLookups,systemObjectsMissing:[...missing].sort()
    },blockers,safeToMigrate:!blockers.length
  };
}
