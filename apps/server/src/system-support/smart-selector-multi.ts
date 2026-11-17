/** Smart Selector multi-select — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 * One boolean, "Multi-select", in the Others section: the selector becomes a checkbox list
 * whose value is the ticked values joined by ";" (read with INCLUDES in filters). */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};

export async function applySmartSelectorMulti(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'selectorMultiSelect','Multi-select','Design2','Others','boolean',last_order.n+1,
   'false'::jsonb,'[]'::jsonb,'component',NULL,NULL,false,2,1,28,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT 'smart_selector','selectorMultiSelect',true
  WHERE EXISTS(SELECT 1 FROM md_builder_ribbon_components WHERE component_api='smart_selector')
  ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true`);
 await client.query(`
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT 'Others',
   COALESCE((SELECT MIN(area_order) FROM md_builder_design2_slots WHERE area='Others'),
            (SELECT COALESCE(MAX(area_order),0)+1 FROM md_builder_design2_slots)),
   'extra_selectorMultiSelect',3,500,40,26,'selectorMultiSelect','selectorMultiSelect'
  ON CONFLICT(area,slot_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT 'smart_selector','Others','extra_selectorMultiSelect','selectorMultiSelect'
  WHERE EXISTS(SELECT 1 FROM md_builder_ribbon_component_rules
   WHERE component_api='smart_selector' AND property_key='selectorMultiSelect')
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
