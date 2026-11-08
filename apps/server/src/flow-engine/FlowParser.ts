import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** SQL is the authority for core and app Flow capabilities; runtime handler keys are code-only. */
export type FlowCapabilityCatalog = {
  registryVersion:number;
  flowTypes:Array<{type:string;description:string;createEnabled:boolean;validateEnabled:boolean;debugEnabled:boolean}>;
  elements:Array<{
    type:string;group:string;icon:string;builderEnabled:boolean;beforeSaveAllowed:boolean;
    configSchemaKey:string;validatorKey:string;runtimeHandlerKey:string;
    debugBehavior:'execute'|'simulate'|'unsupported';allowedFlowTypes:string[];
    builderFlowTypes:string[];properties:Array<{name:string;valueType:string;required:boolean}>;
  }>;
};

export async function loadFlowCapabilityCatalog(db:SqlPersistence,tenantId:string):Promise<FlowCapabilityCatalog> {
  // Optional-app elements are invisible unless the tenant has an active installation and entitlement.
  const [types,elements,allowed,properties]=await Promise.all([
    db.query<{flow_type:string;description:string;create_enabled:boolean;validate_enabled:boolean;debug_enabled:boolean}>(
      'SELECT flow_type,description,create_enabled,validate_enabled,debug_enabled FROM md_flow_capability_flow_types WHERE enabled=true ORDER BY sort_order,flow_type'),
    db.query<{element_type:string;display_group:string;display_icon:string;builder_enabled:boolean;
      before_save_allowed:boolean;config_schema_key:string;validator_key:string;
      runtime_handler_key:string;debug_behavior:'execute'|'simulate'|'unsupported';registry_version:number}>(
      `SELECT e.element_type,e.display_group,e.display_icon,e.builder_enabled,
         e.before_save_allowed,e.config_schema_key,e.validator_key,e.runtime_handler_key,
         e.debug_behavior,e.registry_version FROM md_flow_capability_elements e
       WHERE e.enabled=true AND (e.app_api_name IS NULL OR EXISTS (
         SELECT 1 FROM md_apps a
         JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
         JOIN md_app_entitlements t ON t.app_id=a.id AND t.tenant_id=$1
         WHERE a.api_name=e.app_api_name AND a.enabled=true AND t.active=true
           AND (t.expires_at IS NULL OR t.expires_at>now())
           AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
       )) ORDER BY e.sort_order,e.element_type`,[tenantId]),
    db.query<{element_type:string;flow_type:string;builder_allowed:boolean}>(
      'SELECT element_type,flow_type,builder_allowed FROM md_flow_capability_element_flows'),
    db.query<{element_type:string;property_name:string;value_type:string;required:boolean}>(
      'SELECT element_type,property_name,value_type,required FROM md_flow_capability_properties ORDER BY sort_order,property_name')
  ]);
  const activeFlowTypes=new Set(types.rows.map(row=>row.flow_type));
  const allowedFor=(type:string,forBuilder:boolean)=>allowed.rows.filter(row=>row.element_type===type
    &&activeFlowTypes.has(row.flow_type)&&(!forBuilder||row.builder_allowed))
    .map(row=>row.flow_type);
  return {
    registryVersion:Math.max(1,...elements.rows.map(row=>row.registry_version)),
    flowTypes:types.rows.map(row=>({type:row.flow_type,description:row.description,
      createEnabled:row.create_enabled,validateEnabled:row.validate_enabled,debugEnabled:row.debug_enabled})),
    elements:elements.rows.map(row=>({
      type:row.element_type,group:row.display_group,icon:row.display_icon,
      builderEnabled:row.builder_enabled,beforeSaveAllowed:row.before_save_allowed,
      configSchemaKey:row.config_schema_key,validatorKey:row.validator_key,
      runtimeHandlerKey:row.runtime_handler_key,debugBehavior:row.debug_behavior,
      allowedFlowTypes:allowedFor(row.element_type,false),
      builderFlowTypes:allowedFor(row.element_type,true),
      properties:properties.rows.filter(property=>property.element_type===row.element_type)
        .map(property=>({name:property.property_name,valueType:property.value_type,
          required:property.required}))
    }))
  };
}
