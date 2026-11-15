/** Smart Search — a search box with no dropdown (upgrade-safe, idempotent).
 * It reuses Smart Lookup's look properties (fill, border, radius, shadow, text
 * colour/size, alignment, placeholder) instead of defining a second set: its
 * ribbon and Design rules are copied from smart_lookup, minus Lookup's record
 * source settings. No tenant page or saved component is rewritten. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};

export async function applySmartSearch(client:Query){
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_search') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_search','smart-bundled:smart_search',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules
   (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
  SELECT 'smart_search',r.property_key,r.enabled,r.control_kind_override,r.value_key,
   CASE WHEN r.property_key='label' THEN '"Search product or scan barcode"'::jsonb ELSE r.default_value_override END,
   r.choices_override
  FROM md_builder_ribbon_component_rules r
  JOIN md_builder_shared_properties p ON p.property_key=r.property_key
  WHERE r.component_api='smart_lookup'
   AND (p.tab<>'Data' OR r.property_key='label')
   AND r.property_key NOT IN ('collectionFormula','lookupValueFormula','textSource','filterFormula','filters','filterLogic')
  ON CONFLICT(component_api,property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT 'smart_search',r.area,r.slot_key,r.property_key
  FROM md_builder_design2_slot_rules r
  JOIN md_builder_ribbon_component_rules c ON c.component_api='smart_search' AND c.property_key=r.property_key
  WHERE r.component_api='smart_lookup'
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
