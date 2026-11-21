/** Smart Paired Screens — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 * Reuses shared properties only: Text Source (the page the paired screens show, e.g.
 * ="smart_till_customer_display"), Label (section title), and the Body/Header look.
 * No app-specific code: any app's settings page can place it. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
const json=(value:unknown)=>JSON.stringify(value);
// Each built-in pairing action has its own editable design target. The handler
// stays platform-owned; only presentation metadata is edited by the page builder.
const BUTTON_TARGETS=[
 ['Add','Button'],['Pair','Button 2'],['Rename','Button 3'],
 ['Unpair','Button 4'],['Cancel','Button 5']
] as const;
const BUTTON_FIELDS=[
 ['Fill','fill','customButton1Fill'],['BorderColor','border','customButton1BorderColor'],
 ['TextColor','text','customButton1TextColor'],['TextSize','size','customButton1TextSize'],
 ['Bold','bold','customButton1Bold'],['Radius','radius','customButton1Radius'],
 ['Width','width','footerHeight'],['Height','height','footerHeight']
] as const;
const PAIR_BUTTON_STYLES=BUTTON_TARGETS.flatMap(([name,area])=>
 BUTTON_FIELDS.map(([suffix,slot,template])=>({propertyKey:'paired'+name+suffix,
  label:name+' '+suffix,area,slot,template})));
const SCREENS_RULES:Array<[string,string|null]>=[
 ['backgroundColor',json('#ffffff')],['borderColor',null],['radius','12'],['shadow',null],
 ['width',null],['height',null],['x',null],['y',null],
 ['label',json('Screens')],['headerTextColor',json('#1d1d1f')],['headerTextSize','15'],
 ['labelColor',json('#1d1d1f')],['textSource',null],['visibilityRules',null],
 ...PAIR_BUTTON_STYLES.map(style=>[style.propertyKey,null] as [string,null])
];
const SCREENS_DESIGN:Array<[string,string,string]>=[
 ['Body','fill','backgroundColor'],['Body','border','borderColor'],['Body','radius','radius'],
 ['Body','shadow','shadow'],['Body','width','width'],['Body','height','height'],
 ['Body','text','labelColor'],['Header','text','headerTextColor'],['Header','size','headerTextSize'],
 ...PAIR_BUTTON_STYLES.map(style=>[style.area,style.slot,style.propertyKey] as [string,string,string])
];
const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartPairedScreens(client:Query){
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_paired_screens') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_paired_screens','smart-bundled:smart_paired_screens',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);
 // Extend the existing SQL-owned universal ribbon, without per-page hardcoded controls.
 await client.query(`
  WITH specs(property_key,label,area,template_key,ordinal) AS (VALUES
   ${values(PAIR_BUTTON_STYLES.map((style,index)=>[
    style.propertyKey,style.label,style.area,style.template,index+1]))}
  ), missing AS (
   SELECT s.* FROM specs s WHERE NOT EXISTS(
    SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=s.property_key)
  ), tail AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,min_value,max_value,
    field_select,choices,scope,design_row,design_width,design_height,design_order,
    design_caption,design_caption_width,design_display,enabled_when)
  SELECT m.property_key,m.label,'Design2',m.area,t.control_kind,tail.n+m.ordinal::integer,
   NULL,t.min_value,t.max_value,t.field_select,t.choices,t.scope,
   t.design_row,t.design_width,t.design_height,t.design_order,
   t.design_caption,t.design_caption_width,t.design_display,t.enabled_when
  FROM missing m JOIN md_builder_shared_properties t ON t.property_key=m.template_key
   CROSS JOIN tail
  ON CONFLICT(property_key) DO NOTHING`);
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
