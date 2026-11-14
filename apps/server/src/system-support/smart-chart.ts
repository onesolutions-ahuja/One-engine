/** Smart Chart — upgrade-safe SQL metadata.
 *
 * Runs on every start inside the system migration transaction, after the
 * Smart iOS/Keyboard/Dock step. Every statement is idempotent
 * (ON CONFLICT DO NOTHING) and additive: no tenant page, saved component
 * property or record is rewritten.
 *
 * The chart reuses existing shared properties for its data (Items source,
 * Object, Text Source = label, Column 2 Source = value) and its look (Body,
 * Header, Summary and Row cells). Only chart-specific settings are new, and
 * they live in the existing Design 2 "Others" section so builders edit them
 * from the property bar like every other Smart component.
 */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};

/** [property_key,label,tab,group,kind,default json|null,choices json,min,max] */
type Spec=[string,string,'Design2'|'Data',string,string,string|null,string,number|null,number|null];
const json=(value:unknown)=>JSON.stringify(value);
const CHART_COLOURS=['#007aff','#34c759','#ff9500','#af52de','#ff3b30','#5ac8fa'];

export const SMART_CHART_PROPERTY_SPECS:Spec[]=[
 ['chartType','Chart type','Design2','Others','choice',json('bar'),json(['bar','horizontal','line','donut']),null,null],
 ['chartSort','Sort','Design2','Others','choice',json('none'),json(['none','desc','asc']),null,null],
 ['chartMaxItems','Max items','Design2','Others','number','12','[]',1,50],
 ['chartDecimals','Decimals','Design2','Others','number','0','[]',0,4],
 ['chartShowValues','Show values','Design2','Others','boolean','true','[]',null,null],
 ['chartShowGrid','Show grid','Design2','Others','boolean','true','[]',null,null],
 ['chartShowLegend','Show legend','Design2','Others','boolean','true','[]',null,null],
 ...CHART_COLOURS.map((colour,i):Spec=>['chartColor'+(i+1),'Colour '+(i+1),'Design2','Others',
  'color',json(colour),'[]',null,null]),
 ['chartValuePrefix','Value prefix','Data','Values','expression',null,'[]',null,null]
];

/** Existing shared keys the chart uses, with chart defaults for new inserts only.
 * A null default means "use the shared default". */
const CHART_RULES:Array<[string,string|null]>=[
 ['backgroundColor',json('#ffffff')],['borderColor',null],['radius','16'],['shadow',json('small')],
 ['width',null],['height',null],['x',null],['y',null],
 ['label',null],['headerTextColor',json('#1d1d1f')],['headerTextSize','15'],['headerBold',null],
 ['labelColor',json('#8e8e93')],['textSize','12'],
 ['summaryTextColor',json('#1d1d1f')],['summaryTextSize','12'],['summaryTextWeight',null],
 ['rowRadius','6'],['gap','10'],
 ['objectApiName',null],['collectionFormula',null],['textSource',null],['column2Source',null],
 ['visualStyle',null],
 ...SMART_CHART_PROPERTY_SPECS.map(spec=>[spec[0],null] as [string,null])
];

/** Design 2 icon cells: [area, slot, property]. Areas and slots already exist. */
const CHART_DESIGN:Array<[string,string,string]>=[
 ['Body','fill','backgroundColor'],['Body','border','borderColor'],['Body','radius','radius'],
 ['Body','shadow','shadow'],['Body','width','width'],['Body','height','height'],
 ['Body','text','labelColor'],['Body','size','textSize'],
 ['Header','text','headerTextColor'],['Header','size','headerTextSize'],['Header','bold','headerBold'],
 ['Summary','text','summaryTextColor'],['Summary','size','summaryTextSize'],['Summary','bold','summaryTextWeight'],
 ['Row','radius','rowRadius']
];

const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartChart(client:Query){
 // 1) Register the component for the ribbon and for every existing tenant.
 //    Fresh tenants get it from SMART_COMPONENTS in the Smart seeder.
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_chart') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_chart','smart-bundled:smart_chart',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);

 // 2) New shared properties, appended after the current sort order.
 await client.query(`
  WITH specs(property_key,label,tab_name,group_name,kind,default_json,choices,min_value,max_value,ordinal) AS (VALUES
  ${values(SMART_CHART_PROPERTY_SPECS.map((spec,i)=>[...spec,i+1]))}
  ), typed AS (
   SELECT property_key,label,tab_name,group_name,kind,default_json::jsonb AS default_json,
    choices::jsonb AS choices,min_value::integer AS min_value,max_value::integer AS max_value,ordinal::integer AS ordinal
   FROM specs
  ), missing AS (
   SELECT typed.* FROM typed WHERE NOT EXISTS(
    SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=typed.property_key)
  ), last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT m.property_key,m.label,m.tab_name,m.group_name,m.kind,last_order.n+m.ordinal,
   m.default_json,m.choices,'component',m.min_value,m.max_value,m.tab_name='Data',2,1,
   CASE WHEN m.kind='number' THEN 58 WHEN m.kind='choice' THEN 110
        WHEN m.kind='expression' THEN 150 WHEN m.kind='boolean' THEN 28 ELSE 40 END,
   26,0,'buttons'
  FROM missing m CROSS JOIN last_order
  ON CONFLICT(property_key) DO NOTHING`);

 // 3) Which properties the chart uses. Defaults apply to new inserts only.
 await client.query(`
  WITH specs(component_api,property_key,default_json) AS (VALUES
   ${values(CHART_RULES.map(([key,def])=>['smart_chart',key,def]))})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT s.component_api,s.property_key,true,s.default_json::jsonb FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
  ON CONFLICT(component_api,property_key) DO NOTHING`);

 // 4) Supplemental rows in the existing Others section (one slot per property).
 const extras=SMART_CHART_PROPERTY_SPECS.filter(spec=>spec[2]==='Design2').map((spec,i)=>[spec[0],i+1]);
 await client.query(`
  WITH specs(property_key,ordinal) AS (VALUES ${values(extras)})
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT 'Others',
   COALESCE((SELECT MIN(area_order) FROM md_builder_design2_slots WHERE area='Others'),
            (SELECT COALESCE(MAX(area_order),0)+1 FROM md_builder_design2_slots)),
   'extra_'||spec.property_key,3,300+spec.ordinal::integer,
   CASE WHEN property.control_kind='choice' THEN 110 WHEN property.control_kind='number' THEN 58 ELSE 40 END,
   26,spec.property_key,spec.property_key
  FROM specs spec JOIN md_builder_shared_properties property ON property.property_key=spec.property_key
  ON CONFLICT(area,slot_key) DO NOTHING`);

 // 5) Icon cells for the chart, plus its Others rows and the shared Style row.
 await client.query(`
  WITH specs(component_api,area,slot_key,property_key) AS (VALUES
   ${values(CHART_DESIGN.map(row=>['smart_chart',...row]))})
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
  WHERE r.component_api='smart_chart'
    AND (d.slot_key='extra_visualStyle' OR d.slot_key LIKE 'extra_chart%')
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
