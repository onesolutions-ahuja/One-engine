/** Smart QR — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 * The QR reuses existing shared properties only: Text Source (the value to encode, any
 * formula or field), Object (optional record source), Label (caption) and the Body/Header
 * look. Dark modules use Body text colour, the background uses Body fill. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
const json=(value:unknown)=>JSON.stringify(value);
const QR_RULES:Array<[string,string|null]>=[
 ['backgroundColor',json('#ffffff')],['borderColor',null],['radius','12'],['shadow',null],
 ['width',null],['height',null],['x',null],['y',null],
 ['label',null],['headerTextColor',json('#1d1d1f')],['headerTextSize','13'],
 ['labelColor',json('#1d1d1f')],['objectApiName',null],['collectionFormula',null],['textSource',null],
 ['filterFormula',null],['autoRecordScope',null],['visibilityRules',null]
];
const QR_DESIGN:Array<[string,string,string]>=[
 ['Body','fill','backgroundColor'],['Body','border','borderColor'],['Body','radius','radius'],
 ['Body','shadow','shadow'],['Body','width','width'],['Body','height','height'],
 ['Body','text','labelColor'],['Header','text','headerTextColor'],['Header','size','headerTextSize']
];
const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartQr(client:Query){
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_qr') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_qr','smart-bundled:smart_qr',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);
 await client.query(`
  WITH specs(component_api,property_key,default_json) AS (VALUES
   ${values(QR_RULES.map(([key,def])=>['smart_qr',key,def]))})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT s.component_api,s.property_key,true,s.default_json::jsonb FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
  ON CONFLICT(component_api,property_key) DO NOTHING`);
 await client.query(`
  WITH specs(component_api,area,slot_key,property_key) AS (VALUES
   ${values(QR_DESIGN.map(row=>['smart_qr',...row]))})
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT s.component_api,s.area,s.slot_key,s.property_key FROM specs s
  JOIN md_builder_design2_slots d ON d.area=s.area AND d.slot_key=s.slot_key
  JOIN md_builder_ribbon_component_rules r ON r.component_api=s.component_api
   AND r.property_key=s.property_key AND r.enabled=true
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
