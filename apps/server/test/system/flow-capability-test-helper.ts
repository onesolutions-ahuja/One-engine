import type {SqlPersistence} from '../../src/system-files/sql-persistence.js';

/** Minimal relational catalog fixture for legacy validator/runtime unit tests.
 * Production always loads the real tenant-aware SQL catalog. */
const flowTypes=['Screen Flow','Autolaunched Flow','Record-Triggered Flow',
 'Schedule-Triggered Flow','Platform Event-Triggered Flow'];
const elements=['Start','End','Assignment','Decision','Screen','Wait','Action','Roll Back Records',
 'Custom Error','Loop','Create Records','CreateRecord','HTTP Callout','Get Records',
 'Update Records','Delete Records','Collection Filter','Collection Sort','Transform',
 'Subflow','Publish Platform Event'];
export function withFlowCapabilities(db:SqlPersistence):SqlPersistence {
 const query=typeof db.query==='function'?db.query.bind(db):null;
 return {
  ...db,
  query:async(sql:string,values?:unknown[])=>{
   if(sql.includes('FROM md_flow_capability_flow_types'))return {rows:flowTypes.map(flow_type=>({
    flow_type,description:flow_type,create_enabled:true,validate_enabled:true,debug_enabled:true
   }))};
   if(sql.includes('FROM md_flow_capability_elements e'))return {rows:elements.map((element_type,i)=>({
    element_type,display_group:'Logic',display_icon:'●',builder_enabled:true,
    before_save_allowed:['Start','End','Assignment','Decision','Custom Error'].includes(element_type),
    config_schema_key:'flow:'+element_type,validator_key:element_type,runtime_handler_key:element_type,
    debug_behavior:'unsupported',registry_version:1,sort_order:i
   }))};
   if(sql.includes('FROM md_flow_capability_element_flows'))return {rows:elements.flatMap(element_type=>
    flowTypes.filter(flow_type=>
     (element_type!=='Screen'||flow_type==='Screen Flow')
      &&(element_type!=='Custom Error'||flow_type==='Record-Triggered Flow')
      &&(element_type!=='Publish Platform Event'||flow_type!=='Platform Event-Triggered Flow'))
     .map(flow_type=>({element_type,flow_type,builder_allowed:true})))};
   if(sql.includes('FROM md_flow_capability_properties'))return {rows:[]};
   if(sql.includes('FROM md_object_definitions')){
    if(query)return query(sql,values as never);
    return {rows:(values?.[1] as string[]??[]).map(api_name=>({api_name}))};
   }
   if(sql.includes('FROM md_field_definitions')&&sql.includes('deleted_at IS NULL')){
    if(query)return query(sql,values as never);
    return {rows:(values?.[2] as string[]??[]).flatMap(api_name=>
     (values?.[1] as string[]??[]).map(object_api=>({object_api,api_name})))};
   }
   if(!query)throw new Error('Unexpected test SQL query: '+sql);
   return query(sql,values as never);
  }
 } as unknown as SqlPersistence;
}
