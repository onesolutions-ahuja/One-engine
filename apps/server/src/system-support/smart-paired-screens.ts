/** Smart Paired Screens — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 * Reuses shared properties only: Text Source (the page the paired screens show, e.g.
 * ="smart_till_customer_display"), Label (section title), and the Body/Header look.
 * No app-specific code: any app's settings page can place it. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
const json=(value:unknown)=>JSON.stringify(value);
const SCREENS_RULES:Array<[string,string|null]>=[
 ['backgroundColor',json('#ffffff')],['borderColor',null],['radius','12'],['shadow',null],
 ['width',null],['height',null],['x',null],['y',null],
 ['label',json('Screens')],['headerTextColor',json('#1d1d1f')],['headerTextSize','15'],
 ['labelColor',json('#1d1d1f')],['textSource',null],['visibilityRules',null]
];
const SCREENS_DESIGN:Array<[string,string,string]>=[
 ['Body','fill','backgroundColor'],['Body','border','borderColor'],['Body','radius','radius'],
 ['Body','shadow','shadow'],['Body','width','width'],['Body','height','height'],
 ['Body','text','labelColor'],['Header','text','headerTextColor'],['Header','size','headerTextSize']
];
const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartPairedScreens(client:Query){
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_paired_screens') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_paired_screens','smart-bundled:smart_paired_screens',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);
 await client.query(`
  WITH specs(component_api,property_key,default_json) AS (VALUES
   ${values(SCREENS_RULES.map(([key,def])=>['smart_paired_screens',key,def]))})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT s.component_api,s.property_key,true,s.default_json::jsonb FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
  ON CONFLICT(component_api,property_key) DO NOTHING`);
 await client.query(`
  WITH specs(component_api,area,slot_key,property_key) AS (VALUES
   ${values(SCREENS_DESIGN.map(row=>['smart_paired_screens',...row]))})
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT s.component_api,s.area,s.slot_key,s.property_key FROM specs s
  JOIN md_builder_design2_slots d ON d.area=s.area AND d.slot_key=s.slot_key
  JOIN md_builder_ribbon_component_rules r ON r.component_api=s.component_api
   AND r.property_key=s.property_key AND r.enabled=true
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
