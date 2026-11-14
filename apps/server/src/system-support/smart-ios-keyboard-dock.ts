/** Smart iOS Style, Smart Keyboard and Smart Dock — upgrade-safe SQL metadata.
 *
 * Runs on every start inside the system migration transaction. Every statement
 * is idempotent (ON CONFLICT DO NOTHING) and additive: no tenant page, saved
 * component property or record is rewritten.
 *
 * Style = iOS is a new shared property whose default is written into newly
 * inserted components only. Components saved before it existed have no value
 * and keep rendering Classic; anything a builder configured always wins.
 * Smart Keyboard and Smart Dock reuse the Smart Numpad key/focused/button
 * properties and Design areas instead of defining a second set.
 */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};

const DOCK_ICONS=['house','search','receipt','settings','bell','user-round'];
const DOCK_LABELS=['Home','Search','Orders','Settings','Alerts','Profile'];

/** [property_key,label,tab,group,kind,default json|null,choices json,min,max] */
type Spec=[string,string,'Design2'|'Data',string,string,string|null,string,number|null,number|null];
const json=(value:unknown)=>JSON.stringify(value);
export const SMART_IOS_PROPERTY_SPECS:Spec[]=[
 ['visualStyle','Style','Design2','Others','choice',json('iOS'),json(['iOS','Classic']),null,null],
 ['keyboardLayout','Keyboard type','Design2','Others','choice',json('text'),json(['text','email','url','number']),null,null],
 ['keyboardReturnLabel','Return key','Design2','Others','choice',json('return'),
  json(['return','done','go','search','next','send']),null,null],
 ['keyboardShowOnFocus','Show on focus','Design2','Others','boolean','false','[]',null,null],
 ['keyboardHideDeviceKeyboard','Hide phone keyboard','Design2','Others','boolean','true','[]',null,null],
 ['keyboardAutoCapitalize','Auto capitals','Design2','Others','boolean','true','[]',null,null],
 ['dockItemCount','Items','Design2','Others','number','4','[]',1,6],
 ['dockShowLabels','Show labels','Design2','Others','boolean','true','[]',null,null],
 ['dockShowIndicator','Active dot','Design2','Others','boolean','false','[]',null,null],
 ['dockMagnify','Magnify on hover','Design2','Others','boolean','true','[]',null,null],
 ['dockIconSize','Icon size','Design2','Others','number','28','[]',14,96],
 ...DOCK_ICONS.map((icon,i):Spec=>['dockItem'+(i+1)+'Icon','Item '+(i+1)+' icon','Design2','Others',
  'choice',json(icon),json(['icons']),null,null]),
 ...DOCK_LABELS.map((label,i):Spec=>['dockItem'+(i+1)+'Label','Item '+(i+1)+' label','Data','Values',
  'expression',json(label),'[]',null,null]),
 ...DOCK_LABELS.map((_,i):Spec=>['dockItem'+(i+1)+'Badge','Item '+(i+1)+' badge','Data','Values',
  'expression',null,'[]',null,null]),
 ...DOCK_LABELS.map((_,i):Spec=>['dockItem'+(i+1)+'Visible','Item '+(i+1)+' visible','Data','Values',
  'expression',null,'[]',null,null]),
 ['dockActiveItem','Active item','Data','Values','expression',null,'[]',null,null]
];

/** Existing shared keys each new component uses, with iOS defaults for new inserts.
 * A null default means "use the shared default". '""' means "blank". */
const KEYBOARD_RULES:Array<[string,string|null]>=[
 ['backgroundColor',json('#d1d4d9')],['borderColor',null],['radius','12'],['shadow',json('none')],
 ['width',null],['height',null],['x',null],['y',null],
 ['numpadPadding','6'],['numpadGap','6'],
 ['numpadKeyFill',json('#ffffff')],['numpadKeyBorderColor',null],['numpadKeyRadius','6'],
 ['numpadKeyShadow',null],['numpadKeyHeight','42'],['numpadKeyTextColor',json('#000000')],
 ['numpadKeyTextSize','22'],['numpadKeyBold',null],
 ['numpadFocusedFill',json('#d1d5db')],['numpadFocusedTextColor',json('#000000')],
 ['customButton1Fill',json('#abb0ba')],['customButton1BorderColor',null],['customButton1Radius','6'],
 ['customButton1TextColor',json('#000000')],['customButton1TextSize','16'],['customButton1Bold',null],
 ['customButton3Fill',json('#007aff')],['customButton3BorderColor',null],['customButton3Radius','6'],
 ['customButton3TextColor',json('#ffffff')],['customButton3TextSize','16'],['customButton3Bold',null],
 ['keyboardLayout',null],['keyboardReturnLabel',null],['keyboardShowOnFocus',null],
 ['keyboardHideDeviceKeyboard',null],['keyboardAutoCapitalize',null],['visualStyle',null]
];
const DOCK_RULES:Array<[string,string|null]>=[
 ['backgroundColor',json('')],['borderColor',null],['radius','22'],['shadow',json('none')],
 ['width',null],['height',null],['x',null],['y',null],['label',null],
 ['numpadPadding','8'],['numpadGap','6'],
 ['numpadKeyFill',json('')],['numpadKeyBorderColor',null],['numpadKeyRadius','14'],
 ['numpadKeyHeight','52'],['numpadKeyTextColor',json('#3c3c43')],['numpadKeyTextSize','11'],
 ['numpadKeyBold',null],['numpadFocusedFill',json('')],['numpadFocusedTextColor',json('#007aff')],
 ['navigationDirection',null],['visualStyle',null],
 ...SMART_IOS_PROPERTY_SPECS.filter(spec=>spec[0].startsWith('dock')).map(spec=>[spec[0],null] as [string,null])
];

/** Design 2 icon cells: [area, slot, property]. Areas and slots already exist. */
const BODY:Array<[string,string,string]>=[
 ['Body','fill','backgroundColor'],['Body','border','borderColor'],['Body','radius','radius'],
 ['Body','shadow','shadow'],['Body','width','width'],['Body','height','height']
];
const KEYBOARD_DESIGN:Array<[string,string,string]>=[...BODY,
 ['Button','fill','numpadKeyFill'],['Button','border','numpadKeyBorderColor'],['Button','radius','numpadKeyRadius'],
 ['Button','shadow','numpadKeyShadow'],['Button','height','numpadKeyHeight'],['Button','text','numpadKeyTextColor'],
 ['Button','size','numpadKeyTextSize'],['Button','bold','numpadKeyBold'],
 ['Button 2','fill','customButton1Fill'],['Button 2','border','customButton1BorderColor'],
 ['Button 2','radius','customButton1Radius'],['Button 2','text','customButton1TextColor'],
 ['Button 2','size','customButton1TextSize'],['Button 2','bold','customButton1Bold'],
 ['Button 4','fill','customButton3Fill'],['Button 4','border','customButton3BorderColor'],
 ['Button 4','radius','customButton3Radius'],['Button 4','text','customButton3TextColor'],
 ['Button 4','size','customButton3TextSize'],['Button 4','bold','customButton3Bold'],
 ['Focused','fill','numpadFocusedFill'],['Focused','text','numpadFocusedTextColor']
];
const DOCK_DESIGN:Array<[string,string,string]>=[...BODY,
 ['Button','fill','numpadKeyFill'],['Button','border','numpadKeyBorderColor'],['Button','radius','numpadKeyRadius'],
 ['Button','height','numpadKeyHeight'],['Button','text','numpadKeyTextColor'],
 ['Button','size','numpadKeyTextSize'],['Button','bold','numpadKeyBold'],
 ['Focused','fill','numpadFocusedFill'],['Focused','text','numpadFocusedTextColor']
];
/** Components that honour Style (SmartRuntime ones, plus Smart Table and Smart Icon). */
const STYLED=['smart_table','smart_icon','smart_button','smart_toggle','smart_lookup','smart_selector','smart_tabs','smart_text',
 'smart_textbox','smart_label','smart_card_grid','smart_image','smart_calendar','smart_navigation',
 'smart_container','smart_cart','smart_numpad','smart_keyboard','smart_dock'];

const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartIosKeyboardDock(client:Query){
 // 1) Register both components for the ribbon and for every existing tenant.
 //    Fresh tenants get them from SMART_COMPONENTS in the Smart seeder.
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_keyboard'),('smart_dock') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,v.api,'smart-bundled:'||v.api,true FROM md_tenants t
  CROSS JOIN (VALUES ('smart_keyboard'),('smart_dock')) AS v(api)
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);

 // 2) New shared properties, appended after the current sort order.
 await client.query(`
  WITH specs(property_key,label,tab_name,group_name,kind,default_json,choices,min_value,max_value,ordinal) AS (VALUES
  ${values(SMART_IOS_PROPERTY_SPECS.map((spec,i)=>[...spec,i+1]))}
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

 // 3) Which component uses which property. Defaults apply to new inserts only.
 const rules=[
  ...KEYBOARD_RULES.map(([key,def])=>['smart_keyboard',key,def]),
  ...DOCK_RULES.map(([key,def])=>['smart_dock',key,def]),
  ...STYLED.filter(api=>api!=='smart_keyboard'&&api!=='smart_dock').map(api=>[api,'visualStyle',null])
 ];
 await client.query(`
  WITH specs(component_api,property_key,default_json) AS (VALUES ${values(rules)})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT s.component_api,s.property_key,true,s.default_json::jsonb FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
  ON CONFLICT(component_api,property_key) DO NOTHING`);

 // 4) Supplemental rows in the existing Others section (one slot per property).
 const extras=SMART_IOS_PROPERTY_SPECS.filter(spec=>spec[2]==='Design2').map((spec,i)=>[spec[0],i+1]);
 await client.query(`
  WITH specs(property_key,ordinal) AS (VALUES ${values(extras)})
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT 'Others',
   -- Reuse the Others section's position; create it after the last area if absent.
   COALESCE((SELECT MIN(area_order) FROM md_builder_design2_slots WHERE area='Others'),
            (SELECT COALESCE(MAX(area_order),0)+1 FROM md_builder_design2_slots)),
   'extra_'||spec.property_key,2,200+spec.ordinal::integer,
   CASE WHEN property.control_kind='choice' THEN 110 WHEN property.control_kind='number' THEN 58 ELSE 40 END,
   26,spec.property_key,spec.property_key
  FROM specs spec JOIN md_builder_shared_properties property ON property.property_key=spec.property_key
  ON CONFLICT(area,slot_key) DO NOTHING`);

 // 5) Icon cells per component, plus their Others rows and the Body padding/gap rows.
 const design=[
  ...KEYBOARD_DESIGN.map(row=>['smart_keyboard',...row]),
  ...DOCK_DESIGN.map(row=>['smart_dock',...row])
 ];
 await client.query(`
  WITH specs(component_api,area,slot_key,property_key) AS (VALUES ${values(design)})
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
  WHERE (d.slot_key='extra_visualStyle'
    OR (r.component_api='smart_keyboard' AND d.slot_key LIKE 'extra_keyboard%')
    OR (r.component_api='smart_dock' AND d.slot_key LIKE 'extra_dock%')
    OR (r.component_api IN ('smart_keyboard','smart_dock')
        AND d.slot_key IN ('extra_numpadPadding','extra_numpadGap')))
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`);
}
