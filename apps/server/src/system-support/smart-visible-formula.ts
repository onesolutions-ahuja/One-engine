/** "Show when" formula for every Smart component — upgrade-safe, additive SQL metadata.
 * A formula such as COUNTIFS(Cart, SessionKey, @ThisPage.Session.Id, PaymentStatus, "Card") > 0
 * shows the component only while it is TRUE, so a screen on another device (customer display)
 * reacts to saved data. Blank keeps today's behaviour (always shown). */
import {SMART_COMPONENTS} from '../app-seeders/smart-components.js';
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
export async function applySmartVisibleFormula(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'visibleFormula','Show when (formula)','Data','Values','expression',last_order.n+1,
   NULL,'[]'::jsonb,'component',NULL,NULL,true,2,1,150,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'visibleFormula',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api=ANY($1::text[])
  ON CONFLICT(component_api,property_key) DO NOTHING`,[[...SMART_COMPONENTS]]);
}
