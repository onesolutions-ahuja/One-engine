/** Smart Table row buttons — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 * Up to four row buttons (Custom Button 1-4), hidden until made visible. Each reuses the
 * cart's custom-button properties (text, icon, size, colours, fill, shape, side) so a table
 * row can carry View / Edit / Resume style actions like a cart row. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
const json=(value:unknown)=>JSON.stringify(value);
const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

const BUTTONS=[1,2,3,4] as const;
/** Design properties copied from Custom Button 1 when Button 3/4 lack them. */
const STYLE_SUFFIXES=['Fill','BorderColor','Radius','Width','Height','TextColor','TextSize',
 'Alignment','Bold','Shape','Shadow','WrapText','Placement'];
/** Design 2 slot per style suffix. */
const SLOT_OF:Record<string,string>={Fill:'fill',BorderColor:'border',Radius:'radius',Width:'width',
 Height:'height',TextColor:'text',TextSize:'size',Alignment:'alignment',Bold:'bold',Shape:'shape',
 Shadow:'shadow',WrapText:'wrap',Placement:'placement'};
/** Table areas: Button = Custom Button 1 … Button 4 = Custom Button 4. */
const AREA_OF=(n:number)=>n===1?'Button':'Button '+n;

/** New shared keys: [key,label,tab,group,kind,default json|null,choices json]. */
export const SMART_TABLE_ROW_BUTTON_SPECS:Array<[string,string,'Design2'|'Data',string,string,string|null,string]>=[
 ['customButton4Label','Custom Button 4 label','Data','Values','expression',null,'[]'],
 ...BUTTONS.map(n=>['customButton'+n+'Icon','Button '+n+' icon','Design2','Others','choice',json(''),json(['icons'])] as
  [string,string,'Design2',string,string,string,string]),
 ...BUTTONS.map(n=>['customButton'+n+'Display','Button '+n+' shows','Design2','Others','choice',json('text'),
  json(['text','icon','icon+text'])] as [string,string,'Design2',string,string,string,string])
];

export async function applySmartTableRowButtons(client:Query){
 // 1) Button 3/4 style keys, copied from Custom Button 1 (same control, range and layout).
 const copies=[3,4].flatMap(n=>STYLE_SUFFIXES.map(suffix=>['customButton'+n+suffix,'customButton1'+suffix,
  'Custom '+n+' '+suffix.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase(),AREA_OF(n)]));
 await client.query(`
  WITH specs(property_key,template_key,label,section_group) AS (VALUES ${values(copies)}
  ), missing AS (
   SELECT s.* FROM specs s WHERE NOT EXISTS(SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=s.property_key)
  ), last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,min_value,max_value,
    field_select,choices,scope,design_row,design_width,design_height,design_order,design_caption,
    design_caption_width,design_display,enabled_when)
  SELECT m.property_key,m.label,t.tab,m.section_group,t.control_kind,
   last_order.n+ROW_NUMBER() OVER(ORDER BY m.property_key),t.default_value,t.min_value,t.max_value,
   t.field_select,t.choices,t.scope,t.design_row,t.design_width,t.design_height,t.design_order,t.design_caption,
   t.design_caption_width,t.design_display,NULL
  FROM missing m JOIN md_builder_shared_properties t ON t.property_key=m.template_key CROSS JOIN last_order
  ON CONFLICT(property_key) DO NOTHING`);
 // 2) Label, icon and display keys.
 await client.query(`
  WITH specs(property_key,label,tab_name,group_name,kind,default_json,choices,ordinal) AS (VALUES
  ${values(SMART_TABLE_ROW_BUTTON_SPECS.map((spec,i)=>[...spec,i+1]))}
  ), missing AS (
   SELECT s.* FROM specs s WHERE NOT EXISTS(SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=s.property_key)
  ), last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT m.property_key,m.label,m.tab_name,m.group_name,m.kind,last_order.n+m.ordinal::integer,
   m.default_json::jsonb,m.choices::jsonb,'component',NULL,NULL,m.kind='expression',2,1,
   CASE WHEN m.kind='choice' THEN 110 WHEN m.kind='expression' THEN 150 ELSE 40 END,26,0,'buttons'
  FROM missing m CROSS JOIN last_order
  ON CONFLICT(property_key) DO NOTHING`);
 // 3) Smart Table uses all of them.
 const keys=BUTTONS.flatMap(n=>['customButton'+n+'Label','customButton'+n+'Icon','customButton'+n+'Display',
  ...STYLE_SUFFIXES.map(suffix=>'customButton'+n+suffix)]);
 await client.query(`
  WITH specs(property_key) AS (VALUES ${values(keys.map(key=>[key]))})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT 'smart_table',s.property_key,true FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api='smart_table'
  ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true`);
 // Buttons sit at the row end unless a builder moves them to the start.
 await client.query(`
  UPDATE md_builder_ribbon_component_rules SET default_value_override='"right"'::jsonb
  WHERE component_api='smart_table' AND property_key LIKE 'customButton_Placement'
   AND default_value_override IS NULL`);
 // 4) Design 2 cells: each button area gets the Body scaffold it lacks, then the table mapping.
 await client.query(`
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT areas.area,areas.area_order,base.slot_key,base.row_no,base.order_no,
   base.width_px,base.height_px,base.property_key,base.fallback_key
  FROM (SELECT area,MIN(area_order) AS area_order FROM md_builder_design2_slots
        WHERE area IN ('Button','Button 2','Button 3','Button 4') GROUP BY area) areas
  CROSS JOIN md_builder_design2_slots base
  WHERE base.area='Body' AND base.slot_key IN
   ('fill','border','shape','radius','shadow','height','width','text','alignment','size','bold','wrap')
  ON CONFLICT DO NOTHING`);
 const cells=BUTTONS.flatMap(n=>STYLE_SUFFIXES.map(suffix=>['smart_table',AREA_OF(n),SLOT_OF[suffix],'customButton'+n+suffix]));
 await client.query(`
  WITH specs(component_api,area,slot_key,property_key) AS (VALUES ${values(cells)})
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT s.component_api,s.area,s.slot_key,s.property_key FROM specs s
  JOIN md_builder_design2_slots d ON d.area=s.area AND d.slot_key=s.slot_key
  JOIN md_builder_ribbon_component_rules r ON r.component_api=s.component_api
   AND r.property_key=s.property_key AND r.enabled=true
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
 // 5) Icon and "shows" pickers sit in the Others section, one cell each.
 const extras=SMART_TABLE_ROW_BUTTON_SPECS.filter(spec=>spec[2]==='Design2').map((spec,i)=>[spec[0],i+1]);
 await client.query(`
  WITH specs(property_key,ordinal) AS (VALUES ${values(extras)})
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT 'Others',
   COALESCE((SELECT MIN(area_order) FROM md_builder_design2_slots WHERE area='Others'),
            (SELECT COALESCE(MAX(area_order),0)+1 FROM md_builder_design2_slots)),
   'extra_'||spec.property_key,3,400+spec.ordinal::integer,110,26,spec.property_key,spec.property_key
  FROM specs spec JOIN md_builder_shared_properties property ON property.property_key=spec.property_key
  ON CONFLICT(area,slot_key) DO NOTHING`);
 await client.query(`
  WITH specs(property_key) AS (VALUES ${values(extras.map(([key])=>[key]))})
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT 'smart_table','Others','extra_'||s.property_key,s.property_key FROM specs s
  JOIN md_builder_design2_slots d ON d.area='Others' AND d.slot_key='extra_'||s.property_key
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
