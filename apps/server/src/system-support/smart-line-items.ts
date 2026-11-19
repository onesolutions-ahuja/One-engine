/** Smart Line Items — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 *
 * The item lines of a receipt or invoice, made for Print Templates. It reuses the shared
 * properties: Items source / Object (the rows), Text Source (item text), Column 2 Source
 * (amount), Column 3 Source (second line), Column 4 / 5 Source (extra line text / amount),
 * Label (optional heading) and the Body, Header and Row look. Only the separator style and the
 * font are new, in the existing Design 2 "Others" section (like Smart Chart's settings).
 * No tenant page, saved property or record is rewritten.
 */
import {addOthersSlots,addSharedProperties,type Query,type Spec} from './smart-chart.js';
const json=(value:unknown)=>JSON.stringify(value);

export const SMART_LINE_ITEMS_PROPERTY_SPECS:Spec[]=[
 ['lineItemsSeparator','Line separator','Design2','Others','choice',json('dashed'),json(['dashed','solid','dotted','none']),null,null],
 ['lineItemsFont','Line font','Design2','Others','choice',json('default'),json(['default','monospace']),null,null]
];

/** Existing shared keys the component uses, with defaults for new inserts only (null = shared default). */
const LINE_ITEMS_RULES:Array<[string,string|null]>=[
 ['backgroundColor',null],['borderColor',null],['radius','0'],
 ['width',null],['height',null],['x',null],['y',null],
 ['label',null],['headerTextColor',json('#1d1d1f')],['headerTextSize','13'],['headerBold',null],
 ['rowLabelColor',json('#1d1d1f')],['rowTextSize','13'],['rowBorderColor',json('#8e8e93')],['rowBold',null],
 ['objectApiName',null],['collectionFormula',null],['filterFormula',null],['autoRecordScope',null],
 ['textSource',null],['column2Source',null],['column3Source',null],['column4Source',null],['column5Source',null],
 ['visibilityRules',null],
 ...SMART_LINE_ITEMS_PROPERTY_SPECS.map(spec=>[spec[0],null] as [string,null])
];

/** Design 2 icon cells: [area, slot, property]. Areas and slots already exist. */
const LINE_ITEMS_DESIGN:Array<[string,string,string]>=[
 ['Body','fill','backgroundColor'],['Body','border','borderColor'],['Body','radius','radius'],
 ['Body','width','width'],['Body','height','height'],
 ['Header','text','headerTextColor'],['Header','size','headerTextSize'],['Header','bold','headerBold'],
 ['Row','text','rowLabelColor'],['Row','size','rowTextSize'],['Row','border','rowBorderColor'],['Row','bold','rowBold']
];

const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartLineItems(client:Query){
 // 1) Register for the ribbon and for every existing tenant (fresh tenants: SMART_COMPONENTS).
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_line_items') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_line_items','smart-bundled:smart_line_items',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);

 // 2) The two new settings, using Smart Chart's shared helpers.
 await addSharedProperties(client,SMART_LINE_ITEMS_PROPERTY_SPECS);

 // 3) Which properties the component uses. Defaults apply to new inserts only.
 await client.query(`
  WITH specs(component_api,property_key,default_json) AS (VALUES
   ${values(LINE_ITEMS_RULES.map(([key,def])=>['smart_line_items',key,def]))})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT s.component_api,s.property_key,true,s.default_json::jsonb FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
  ON CONFLICT(component_api,property_key) DO NOTHING`);

 // 4) Rows for the two settings in the existing Others section (after Chart 301+, row buttons 401+, multi-select 500).
 await addOthersSlots(client,SMART_LINE_ITEMS_PROPERTY_SPECS,600);

 // 5) Icon cells, plus the component's Others rows.
 await client.query(`
  WITH specs(component_api,area,slot_key,property_key) AS (VALUES
   ${values(LINE_ITEMS_DESIGN.map(row=>['smart_line_items',...row]))})
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT s.component_api,s.area,s.slot_key,s.property_key FROM specs s
  JOIN md_builder_design2_slots d ON d.area=s.area AND d.slot_key=s.slot_key
  JOIN md_builder_ribbon_component_rules r ON r.component_api=s.component_api
   AND r.property_key=s.property_key AND r.enabled=true
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT r.component_api,d.area,d.slot_key,d.property_key
  FROM md_builder_design2_slots d
  JOIN md_builder_ribbon_component_rules r ON r.property_key=d.property_key AND r.enabled=true
  WHERE r.component_api='smart_line_items' AND d.slot_key LIKE 'extra_lineItems%'
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
