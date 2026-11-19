/** Smart ID Card — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 *
 * A Card Grid whose cards list up to ten metadata-driven fields, for customer,
 * user or product cards (category, price, sales total, last sold, ...).
 *
 * Reuse first: the ID card takes every Card Grid property that applies to it
 * (Object, records source, filters, cards per row/column, image, title, badge,
 * focused card, padding, gap, style...) by copying the Card Grid's ribbon rules
 * and Design 2 icon cells. Card Grid buttons, description and footer are not
 * drawn on an ID card, so those rules are not copied.
 *
 * New, ID-card-only metadata:
 *  - Data › "ID Card Fields": fieldNLabel (caption) and fieldNSource (value,
 *    with the field picker) for N = 1..10;
 *  - Design 2 areas "Field 1".."Field 10": text colour, size, bold, alignment,
 *    fill, border and wrap of each field (click the field on the canvas);
 *  - Design 2 Others: field caption layout / colour / size;
 *  - Count editor: number of fields (0–10) and field columns (1–3).
 * Dragging the image or a field on the canvas saves imageOffsetX/Y or
 * fieldNOffsetX/Y on the component (shared part-drag engine): no SQL needed.
 * No tenant page, saved component property or record is rewritten. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};

const API='smart_id_card';
export const ID_CARD_FIELD_COUNT=10;
const json=(value:unknown)=>JSON.stringify(value);
const numbers=Array.from({length:ID_CARD_FIELD_COUNT},(_,i)=>i+1);

/** [property_key,label,tab,group,kind,default json|null,choices json,min,max,field_select,design_row,design_order] */
type Spec=[string,string,'Design2'|'Data',string,string,string|null,string,number|null,number|null,boolean,number,number];

/** Header area slots each field area copies: [slot_key, property suffix, kind, min, max]. */
const FIELD_STYLE_SLOTS:Array<[string,string,string,number|null,number|null]>=[
 ['fill','BackgroundColor','color',null,null],
 ['border','BorderColor','color',null,null],
 ['text','TextColor','color',null,null],
 ['alignment','Alignment','align',null,null],
 ['bold','Bold','boolean',null,null],
 ['wrap','WrapText','boolean',null,null],
 ['size','TextSize','number',8,96]
];
const FIELD_STYLE_LABELS:Record<string,string>={
 BackgroundColor:'Fill',BorderColor:'Border',TextColor:'Text colour',Alignment:'Alignment',
 Bold:'Bold',WrapText:'Wrap text',TextSize:'Text size'
};

export const SMART_ID_CARD_PROPERTY_SPECS:Spec[]=[
 // Data: caption + value per field, in field order.
 ...numbers.flatMap((n):Spec[]=>[
  ['field'+n+'Label','Field '+n+' caption','Data','ID Card Fields','expression',null,'[]',null,null,false,2,n*2-1],
  ['field'+n+'Source','Field '+n+' value','Data','ID Card Fields','expression',null,'[]',null,null,true,2,n*2]
 ]),
 // Design 2: one area per field. Row/order are set from the Header slot below.
 ...numbers.flatMap(n=>FIELD_STYLE_SLOTS.map(([,suffix,kind,min,max]):Spec=>[
  'field'+n+suffix,'Field '+n+' '+FIELD_STYLE_LABELS[suffix].toLowerCase(),'Design2','Field '+n,kind,null,
  kind==='align'?json(['left','center','right']):'[]',min,max,false,2,1])),
 // Count editor (Design 2 Others › count): how many fields, in how many columns.
 ['idCardFieldCount','Fields','Design2','Others','number','4','[]',0,ID_CARD_FIELD_COUNT,false,2,1],
 ['idCardFieldColumns','Field columns','Design2','Others','number','1','[]',1,3,false,2,1],
 // Others rows shared by all fields.
 ['idCardFieldLayout','Field captions','Design2','Others','choice',json('inline'),json(['inline','stacked']),null,null,false,3,1],
 ['idCardLabelColor','Caption colour','Design2','Others','color',null,'[]',null,null,false,3,1],
 ['idCardLabelSize','Caption size','Design2','Others','number',null,'[]',8,96,false,3,1]
];
const OTHERS_EXTRAS=['idCardFieldLayout','idCardLabelColor','idCardLabelSize'];

/** ID-card defaults for new inserts (photo beside the details, 2 x 2 cards). */
const OWN_RULES:Array<[string,string|null]>=[
 ['imagePlacement',json('left')],['cardsPerRow','2'],['cardsPerColumn','2'],
 ...SMART_ID_CARD_PROPERTY_SPECS.map(spec=>[spec[0],null] as [string,null])
];

/** Card Grid parts an ID card does not draw (buttons, description, footer). */
const NOT_COPIED_PROPERTY_SQL=`(r.property_key LIKE 'customButton%' OR r.property_key LIKE 'cardButton%'
  OR r.property_key LIKE 'footer%' OR r.property_key LIKE 'supporting%'
  OR r.property_key IN ('cardDescription','cardValue'))`;
const COPIED_AREAS=['Body','Header','Badge','Image','Grid','Focused','Others','Extras'];

const values=(rows:unknown[][])=>rows.map(row=>'('+row.map(value=>value===null?'NULL'
 :typeof value==='number'||typeof value==='boolean'?String(value)
 :"'"+String(value).replaceAll("'","''")+"'").join(',')+')').join(',\n');

export async function applySmartIdCard(client:Query){
 // 1) Register the component for the ribbon and for every existing tenant.
 //    Fresh tenants get it from SMART_COMPONENTS in the Smart seeder.
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('${API}') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'${API}','smart-bundled:${API}',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);

 // 2) New shared properties, appended after the current sort order.
 await client.query(`
  WITH specs(property_key,label,tab_name,group_name,kind,default_json,choices,min_value,max_value,
   field_select,design_row,design_order,ordinal) AS (VALUES
  ${values(SMART_ID_CARD_PROPERTY_SPECS.map((spec,i)=>[...spec,i+1]))}
  ), typed AS (
   SELECT property_key,label,tab_name,group_name,kind,default_json::jsonb AS default_json,
    choices::jsonb AS choices,min_value::integer AS min_value,max_value::integer AS max_value,
    field_select::boolean AS field_select,design_row::integer AS design_row,
    design_order::integer AS design_order,ordinal::integer AS ordinal
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
   m.default_json,m.choices,'component',m.min_value,m.max_value,m.field_select,m.design_row,m.design_order,
   CASE WHEN m.kind='number' THEN 58 WHEN m.kind='choice' THEN 110
        WHEN m.kind='expression' THEN 150 WHEN m.kind='boolean' THEN 28 ELSE 40 END,
   26,0,CASE WHEN m.kind='align' THEN 'dropdown' ELSE 'buttons' END
  FROM missing m CROSS JOIN last_order
  ON CONFLICT(property_key) DO NOTHING`);

 // 3) Which properties the ID card uses: its own first (with ID-card defaults),
 //    then every applicable Card Grid rule. Defaults apply to new inserts only.
 await client.query(`
  WITH specs(component_api,property_key,default_json) AS (VALUES
   ${values(OWN_RULES.map(([key,def])=>[API,key,def]))})
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT s.component_api,s.property_key,true,s.default_json::jsonb FROM specs s
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
  ON CONFLICT(component_api,property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules
   (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
  SELECT '${API}',r.property_key,r.enabled,r.control_kind_override,r.value_key,
   r.default_value_override,r.choices_override
  FROM md_builder_ribbon_component_rules r
  WHERE r.component_api='smart_card_grid' AND NOT ${NOT_COPIED_PROPERTY_SQL}
  ON CONFLICT(component_api,property_key) DO NOTHING`);

 // 4) Design 2 areas "Field 1".."Field 10": the same icon cells as Header.
 const fieldSlots=numbers.flatMap(n=>FIELD_STYLE_SLOTS.map(([slot,suffix])=>['Field '+n,n,slot,'field'+n+suffix]));
 await client.query(`
  WITH specs(area,field_number,slot_key,property_key) AS (VALUES ${values(fieldSlots)}),
  base AS (SELECT COALESCE(MAX(area_order),0) AS n FROM md_builder_design2_slots
   WHERE area NOT LIKE 'Field %')
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT s.area,base.n+s.field_number::integer,s.slot_key,h.row_no,h.order_no,h.width_px,h.height_px,
   s.property_key,h.fallback_key
  FROM specs s CROSS JOIN base
  JOIN md_builder_design2_slots h ON h.area='Header' AND h.slot_key=s.slot_key
  JOIN md_builder_shared_properties p ON p.property_key=s.property_key
  ON CONFLICT(area,slot_key) DO NOTHING`);
 // Each field property takes its cell's row/order, so the ribbon draws it there.
 await client.query(`
  UPDATE md_builder_shared_properties p SET design_row=d.row_no,design_order=d.order_no,
   design_width=d.width_px
  FROM md_builder_design2_slots d
  WHERE d.area LIKE 'Field %' AND d.property_key=p.property_key AND p.property_key LIKE 'field%'
   AND (p.design_row,p.design_order,p.design_width) IS DISTINCT FROM (d.row_no,d.order_no,d.width_px)`);

 // 5) Others rows for the shared caption settings (one slot per property).
 await client.query(`
  WITH specs(property_key,ordinal) AS (VALUES ${values(OTHERS_EXTRAS.map((key,i)=>[key,i+1]))})
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT 'Others',
   COALESCE((SELECT MIN(area_order) FROM md_builder_design2_slots WHERE area='Others'),
            (SELECT COALESCE(MAX(area_order),0)+1 FROM md_builder_design2_slots)),
   'extra_'||spec.property_key,3,400+spec.ordinal::integer,
   CASE WHEN property.control_kind='choice' THEN 110 WHEN property.control_kind='number' THEN 58 ELSE 40 END,
   26,spec.property_key,spec.property_key
  FROM specs spec JOIN md_builder_shared_properties property ON property.property_key=spec.property_key
  ON CONFLICT(area,slot_key) DO NOTHING`);

 // 6) Icon cells: the Card Grid's cells in the areas an ID card draws, then
 //    each field area and the Others rows. Only enabled ID-card rules qualify.
 await client.query(`
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT '${API}',g.area,g.slot_key,g.property_key
  FROM md_builder_design2_slot_rules g
  JOIN md_builder_ribbon_component_rules r ON r.component_api='${API}'
   AND r.property_key=g.property_key AND r.enabled=true
  WHERE g.component_api='smart_card_grid' AND g.area=ANY($1::text[])
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`,[COPIED_AREAS]);
 await client.query(`
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT '${API}',d.area,d.slot_key,d.property_key
  FROM md_builder_design2_slots d
  JOIN md_builder_ribbon_component_rules r ON r.component_api='${API}'
   AND r.property_key=d.property_key AND r.enabled=true
  WHERE d.area LIKE 'Field %' OR d.slot_key=ANY($1::text[])
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`,[OTHERS_EXTRAS.map(key=>'extra_'+key)]);
}
