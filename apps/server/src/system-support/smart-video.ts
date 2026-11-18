/** Smart Video — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 * Reuses Image Source (a URL, record field or formula; several videos separated by ";")
 * and Image Fill (fill / fit / stretch). Adds four switches: Autoplay, Loop, Muted and
 * Controls. Muted + Autoplay + Loop are on by default, so a promotion loop just plays. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
const json=(value:unknown)=>JSON.stringify(value);
const VIDEO_PROPERTIES:Array<[string,string,boolean]>=[
 ['videoAutoplay','Autoplay',true],['videoLoop','Loop',true],
 ['videoMuted','Muted (needed for autoplay)',true],['videoControls','Show controls',false]
];
const VIDEO_RULES:Array<[string,string|null]>=[
 ['imageSource',null],['imageFill',json('fill')],
 ['backgroundColor',json('#000000')],['borderColor',null],['radius','12'],['shadow',null],
 ['width',null],['height',null],['x',null],['y',null],
 ['objectApiName',null],['collectionFormula',null],['filterFormula',null],['autoRecordScope',null],
 ['visibilityRules',null],
 ...VIDEO_PROPERTIES.map(([key,,on])=>[key,json(on)] as [string,string])
];
const VIDEO_DESIGN:Array<[string,string,string]>=[
 ['Body','fill','backgroundColor'],['Body','border','borderColor'],['Body','radius','radius'],
 ['Body','shadow','shadow'],['Body','width','width'],['Body','height','height']
];
const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartVideo(client:Query){
 for(const [key,label,on] of VIDEO_PROPERTIES)
  await client.query(`
   WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
   INSERT INTO md_builder_shared_properties(property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
   SELECT $1,$2,'Design','Image','boolean',last_order.n+1,$3::jsonb,'[]'::jsonb,'component' FROM last_order
   ON CONFLICT(property_key) DO NOTHING`,[key,label,json(on)]);
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_video') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_video','smart-bundled:smart_video',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);
 await client.query(`
  WITH specs(component_api,property_key,default_json) AS (VALUES
   ${values(VIDEO_RULES.map(([key,def])=>['smart_video',key,def]))})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT s.component_api,s.property_key,true,s.default_json::jsonb FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
  ON CONFLICT(component_api,property_key) DO NOTHING`);
 await client.query(`
  WITH specs(component_api,area,slot_key,property_key) AS (VALUES
   ${values(VIDEO_DESIGN.map(row=>['smart_video',...row]))})
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT s.component_api,s.area,s.slot_key,s.property_key FROM specs s
  JOIN md_builder_design2_slots d ON d.area=s.area AND d.slot_key=s.slot_key
  JOIN md_builder_ribbon_component_rules r ON r.component_api=s.component_api
   AND r.property_key=s.property_key AND r.enabled=true
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
