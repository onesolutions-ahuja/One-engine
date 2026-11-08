import type {SqlExecutor} from '../system-files/sql-persistence.js';
/** Shared tenant-scoped name guard for metadata creation and explicit update flows. */
const IDENTIFIER=/^[A-Za-z][A-Za-z0-9_]*$/;
const allowedTables={
  systemDefinition:'md_system_definitions',
  tenantApp:'md_tenant_app_metadata',
  namedCredential:'md_named_credentials',
  inboundWebhook:'md_inbound_webhook_endpoints',
  outboundWebhook:'md_webhook_subscriptions',
  globalValueSet:'md_global_value_sets',
  object:'md_object_definitions',
  field:'md_field_definitions',
  page:'md_page_definitions',
  component:'md_component_definitions',
  flow:'md_flow_definitions',
  globalAction:'md_global_quick_actions',
  customMetadataType:'md_custom_metadata_types',
  customSetting:'md_custom_settings',
  customLabel:'md_custom_labels',
  matchingRule:'md_matching_rules',
  validationRule:'md_validation_rules'
} as const;
export type MetadataNameKind=keyof typeof allowedTables;
export function validateMetadataName(name:unknown):asserts name is string{
  if(typeof name!=='string'||!IDENTIFIER.test(name))throw new Error('Invalid API name');
}
export async function requireAvailableMetadataName(
 db:Pick<SqlExecutor,'query'>,tenantId:string,kind:MetadataNameKind,name:string,
 options:{objectApi?:string;language?:string;systemKind?:string}={}
):Promise<void>{
 if(kind==='globalAction'){
   if(!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(name))throw new Error('Invalid API name');
 } else validateMetadataName(name);
 const table=allowedTables[kind];
 if((kind==='matchingRule'||kind==='validationRule'||kind==='field')&&!options.objectApi)throw new Error('Object scope required');
 const args:unknown[]=[tenantId,name];
 const column=kind==='globalAction'?'action_id':kind==='namedCredential'?'name':'api_name';
 let sql=`SELECT TRUE AS metadata_name_exists FROM ${table} WHERE tenant_id=$1 AND lower(${column})=lower($2)`;
 if(kind==='matchingRule'||kind==='validationRule'||kind==='field'){args.push(options.objectApi);sql+=' AND object_api=$3';}
 if(kind==='customLabel'){args.push(options.language??'en');sql+=' AND language=$3';}
 if(kind==='systemDefinition'){
   if(!options.systemKind||!/^[a-z][a-z-]*$/.test(options.systemKind))throw new Error('System definition scope required');
   args.push(options.systemKind);sql+=' AND kind=$3';
 }
 // Validate the selected existence marker, not an unrelated row returned by a
 // wider SQL test double. PostgreSQL returns this exact marker for a match.
 const result=await db.query<{metadata_name_exists:boolean}>(sql+' LIMIT 1',args);
 if(result.rows.some(row=>row.metadata_name_exists===true))throw new Error('API Name already exists');
}
