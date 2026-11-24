type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};

/** Ribbon properties the Smart component code already renders but that were
 * switched off (audit 24 Nov 2026, from code). Runs as the last ribbon step so
 * no earlier step can switch them off again. Existing value keys are kept. */
type Rule=[component:string,property:string,valueKey:string|null];
type Slot=[component:string,area:string,slot:string,property:string];
export const SUPPORTED_RIBBON_RULES:Rule[]=[
 ['smart_button','shapeFill','iconFillColor'],
 ['smart_icon','shapeFill','iconFillColor'],
 ['smart_calendar','label',null],
 ['smart_card_grid','defaultValueColor',null],
 ['smart_card_grid','headerBold',null],
 ['smart_card_grid','label',null],
 ['smart_cart','badgeText',null],
 ['smart_cart','headerBold',null],
 ['smart_cart','imageWidth',null],
 ['smart_cart','selectedRowColor',null],
 ['smart_chart','gap',null],
 ['smart_chart','headerBold',null],
 ['smart_container','label',null],
 ['smart_dock','labelColor',null],
 ['smart_dock','shadow',null],
 ['smart_icon','label',null],
 ['smart_id_card','cardButtonBorderColor',null],
 ['smart_id_card','cardButtonFill',null],
 ['smart_id_card','cardButtonShape',null],
 ['smart_id_card','cardButtonText',null],
 ['smart_id_card','cardButtonTextColor',null],
 ['smart_id_card','cardButtonTextSize',null],
 ['smart_id_card','cardDescription',null],
 ['smart_id_card','cardValue',null],
 ['smart_id_card','defaultValueColor',null],
 ['smart_id_card','footerAlignment',null],
 ['smart_id_card','footerBackgroundColor',null],
 ['smart_id_card','footerBold',null],
 ['smart_id_card','footerBorderColor',null],
 ['smart_id_card','footerHeight',null],
 ['smart_id_card','footerTextColor',null],
 ['smart_id_card','footerTextSize',null],
 ['smart_id_card','footerWidth',null],
 ['smart_id_card','footerWrapText',null],
 ['smart_id_card','headerBold',null],
 ['smart_id_card','label',null],
 ['smart_id_card','supportingAlignment',null],
 ['smart_id_card','supportingBackgroundColor',null],
 ['smart_id_card','supportingBold',null],
 ['smart_id_card','supportingBorderColor',null],
 ['smart_id_card','supportingBoxHeight',null],
 ['smart_id_card','supportingBoxWidth',null],
 ['smart_id_card','supportingRadius',null],
 ['smart_id_card','supportingTextColor',null],
 ['smart_id_card','supportingTextSize',null],
 ['smart_image','cardButtonBorderColor',null],
 ['smart_image','cardButtonFill',null],
 ['smart_image','cardButtonShape',null],
 ['smart_image','cardButtonText',null],
 ['smart_image','cardButtonTextColor',null],
 ['smart_image','cardButtonTextSize',null],
 ['smart_image','cardDescription',null],
 ['smart_image','cardValue',null],
 ['smart_image','collectionFormula',null],
 ['smart_image','defaultValueColor',null],
 ['smart_image','footerAlignment',null],
 ['smart_image','footerBold',null],
 ['smart_image','footerHeight',null],
 ['smart_image','footerTextColor',null],
 ['smart_image','footerTextSize',null],
 ['smart_image','footerWidth',null],
 ['smart_image','footerWrapText',null],
 ['smart_image','gap',null],
 ['smart_image','gridBackgroundColor',null],
 ['smart_image','gridBorderColor',null],
 ['smart_image','gridRadius',null],
 ['smart_image','gridShadow',null],
 ['smart_image','headerBold',null],
 ['smart_image','height',null],
 ['smart_image','itemDisabledWhen',null],
 ['smart_image','label',null],
 ['smart_image','labelAlignment',null],
 ['smart_image','labelColor',null],
 ['smart_image','selectionMode',null],
 ['smart_image','supportingAlignment',null],
 ['smart_image','supportingBold',null],
 ['smart_image','supportingBorderColor',null],
 ['smart_image','supportingBoxHeight',null],
 ['smart_image','supportingBoxWidth',null],
 ['smart_image','supportingTextColor',null],
 ['smart_image','supportingTextSize',null],
 ['smart_image','textSize',null],
 ['smart_image','width',null],
 ['smart_image','wrapText',null],
 ['smart_keyboard','label',null],
 ['smart_label','allowImageUpload',null],
 ['smart_label','defaultValue',null],
 ['smart_label','defaultValueColor',null],
 ['smart_label','inputRows',null],
 ['smart_label','keypad',null],
 ['smart_label','maskInput',null],
 ['smart_label','shapeFill','backgroundColor'],
 ['smart_line_items','headerBold',null],
 ['smart_line_items','textSize',null],
 ['smart_lookup','shapeFill','backgroundColor'],
 ['smart_multipage','label',null],
 ['smart_navigation','imageSource',null],
 ['smart_navigation','label',null],
 ['smart_numpad','defaultValue',null],
 ['smart_numpad','headerBold',null],
 ['smart_numpad','label',null],
 ['smart_paired_screens','disabledFormula',null],
 ['smart_paired_screens','objectApiName',null],
 ['smart_paired_screens','visibleFormula',null],
 ['smart_search','shapeFill','backgroundColor'],
 ['smart_selector','defaultValue',null],
 ['smart_selector','defaultValueColor',null],
 ['smart_selector','shapeFill','backgroundColor'],
 ['smart_spacemap','borderColor',null],
 ['smart_spacemap','height',null],
 ['smart_spacemap','imageSource',null],
 ['smart_spacemap','label',null],
 ['smart_spacemap','width',null],
 ['smart_table','headerBold',null],
 ['smart_table','label',null],
 ['smart_table','labelAlignment',null],
 ['smart_table','selectedRowColor',null],
 ['smart_table','textSize',null],
 ['smart_table','wrapText',null],
 ['smart_tabs','defaultValue',null],
 ['smart_text','defaultValue',null],
 ['smart_text','defaultValueColor',null],
 ['smart_text','shapeFill','backgroundColor'],
 ['smart_textbox','headerBold',null],
 ['smart_textbox','wrapText',null],
 ['smart_toggle','label',null],
 ['smart_toggle','shapeFill','backgroundColor'],
 ['smart_video','label',null]
];
/** Design area cells that had no property mapped for the component. */
export const SUPPORTED_RIBBON_SLOTS:Slot[]=[
 ['smart_button','Body','shapeFill','shapeFill'],
 ['smart_icon','Body','shapeFill','shapeFill'],
 ['smart_card_grid','Body','bold','headerBold'],
 ['smart_cart','Body','bold','headerBold'],
 ['smart_cart','Body','focused','selectedRowColor'],
 ['smart_cart','Table','focused','selectedRowColor'],
 ['smart_chart','Body','bold','headerBold'],
 ['smart_chart','Extras','extra_cardGap','gap'],
 ['smart_dock','Body','text','labelColor'],
 ['smart_dock','Focused','shadow','shadow'],
 ['smart_id_card','Body','bold','headerBold'],
 ['smart_id_card','Footer','alignment','footerAlignment'],
 ['smart_id_card','Footer','bold','footerBold'],
 ['smart_id_card','Footer','border','footerBorderColor'],
 ['smart_id_card','Footer','fill','footerBackgroundColor'],
 ['smart_id_card','Footer','height','footerHeight'],
 ['smart_id_card','Footer','size','footerTextSize'],
 ['smart_id_card','Footer','text','footerTextColor'],
 ['smart_id_card','Footer','width','footerWidth'],
 ['smart_id_card','Footer','wrap','footerWrapText'],
 ['smart_id_card','Header Supporting','alignment','supportingAlignment'],
 ['smart_id_card','Header Supporting','bold','supportingBold'],
 ['smart_id_card','Header Supporting','border','supportingBorderColor'],
 ['smart_id_card','Header Supporting','fill','supportingBackgroundColor'],
 ['smart_id_card','Header Supporting','height','supportingBoxHeight'],
 ['smart_id_card','Header Supporting','radius','supportingRadius'],
 ['smart_id_card','Header Supporting','size','supportingTextSize'],
 ['smart_id_card','Header Supporting','text','supportingTextColor'],
 ['smart_id_card','Header Supporting','width','supportingBoxWidth'],
 ['smart_image','Extras','extra_cardGap','gap'],
 ['smart_image','Extras','extra_selectionMode','selectionMode'],
 ['smart_image','Footer','alignment','footerAlignment'],
 ['smart_image','Footer','bold','footerBold'],
 ['smart_image','Footer','height','footerHeight'],
 ['smart_image','Footer','size','footerTextSize'],
 ['smart_image','Footer','text','footerTextColor'],
 ['smart_image','Footer','width','footerWidth'],
 ['smart_image','Footer','wrap','footerWrapText'],
 ['smart_image','Grid','alignment','labelAlignment'],
 ['smart_image','Grid','bold','headerBold'],
 ['smart_image','Grid','border','gridBorderColor'],
 ['smart_image','Grid','fill','gridBackgroundColor'],
 ['smart_image','Grid','height','height'],
 ['smart_image','Grid','radius','gridRadius'],
 ['smart_image','Grid','shadow','gridShadow'],
 ['smart_image','Grid','size','textSize'],
 ['smart_image','Grid','text','labelColor'],
 ['smart_image','Grid','width','width'],
 ['smart_image','Grid','wrap','wrapText'],
 ['smart_image','Header Supporting','alignment','supportingAlignment'],
 ['smart_image','Header Supporting','bold','supportingBold'],
 ['smart_image','Header Supporting','height','supportingBoxHeight'],
 ['smart_image','Header Supporting','size','supportingTextSize'],
 ['smart_image','Header Supporting','text','supportingTextColor'],
 ['smart_image','Header Supporting','width','supportingBoxWidth'],
 ['smart_image','Others','extra_itemDisabledWhen','itemDisabledWhen'],
 ['smart_label','Others','extra_allowImageUpload','allowImageUpload'],
 ['smart_label','Others','extra_inputRows','inputRows'],
 ['smart_label','Others','extra_maskInput','maskInput'],
 ['smart_line_items','Body','bold','headerBold'],
 ['smart_line_items','Body','size','textSize'],
 ['smart_lookup','Body','shapeFill','shapeFill'],
 ['smart_numpad','Body','bold','headerBold'],
 ['smart_paired_screens','Others','extra_disabledFormula','disabledFormula'],
 ['smart_search','Body','shapeFill','shapeFill'],
 ['smart_spacemap','Body','border','borderColor'],
 ['smart_spacemap','Body','height','height'],
 ['smart_spacemap','Body','width','width'],
 ['smart_table','Body','alignment','labelAlignment'],
 ['smart_table','Body','bold','headerBold'],
 ['smart_table','Body','focused','selectedRowColor'],
 ['smart_table','Body','size','textSize'],
 ['smart_table','Body','wrap','wrapText'],
 ['smart_table','Table','focused','selectedRowColor'],
 ['smart_textbox','Body','bold','headerBold'],
 ['smart_textbox','Header','wrap','wrapText'],
 ['smart_toggle','Body','shapeFill','shapeFill']
];


/** Part properties the card renderer (Card Grid, ID Card, Image) already draws for every part
 * but that had no ribbon property: [new property, label, area, copied-from property]. */
type PartProperty=[property:string,label:string,area:string,template:string];
export const CARD_PART_PROPERTIES:PartProperty[]=[
 ['footerRadius','Footer radius','Footer','summaryRadius'],
 ['footerShadow','Footer shadow','Footer','summaryShadow'],
 ['supportingShadow','Supporting shadow','Header Supporting','summaryShadow'],
 ['supportingWrapText','Supporting wrap','Header Supporting','footerWrapText']
];
/** Each card part gets the same icons in the same cells: [area, cell, property]. */
const CARD_PART_CELLS:[area:string,slot:string,property:string][]=[
 ['Footer','radius','footerRadius'],['Footer','shadow','footerShadow'],['Footer','wrap','footerWrapText'],
 ['Footer','fill','footerBackgroundColor'],['Footer','border','footerBorderColor'],
 ['Footer','height','footerHeight'],['Footer','width','footerWidth'],['Footer','alignment','footerAlignment'],
 ['Footer','text','footerTextColor'],['Footer','bold','footerBold'],['Footer','size','footerTextSize'],
 ['Header Supporting','radius','supportingRadius'],['Header Supporting','shadow','supportingShadow'],
 ['Header Supporting','wrap','supportingWrapText'],['Header Supporting','fill','supportingBackgroundColor'],
 ['Header Supporting','border','supportingBorderColor'],['Header Supporting','height','supportingBoxHeight'],
 ['Header Supporting','width','supportingBoxWidth'],['Header Supporting','alignment','supportingAlignment'],
 ['Header Supporting','text','supportingTextColor'],['Header Supporting','bold','supportingBold'],
 ['Header Supporting','size','supportingTextSize']
];
const CARD_COMPONENTS=['smart_card_grid','smart_id_card','smart_image'];
export const CARD_PART_SLOTS:Slot[]=CARD_COMPONENTS.flatMap(api=>
 CARD_PART_CELLS.map(([area,slot,property]):Slot=>[api,area,slot,property]));

export async function applySupportedRibbonProperties(client:Query){
 // New part properties copy an existing one of the same kind (control, limits, icon size).
 await client.query(`INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,min_value,max_value,
    field_select,choices,scope,design_row,design_width,design_height,design_order,design_caption,
    design_caption_width,design_display,enabled_when)
  SELECT n.prop,n.label,'Design2',n.area,t.control_kind,
   (SELECT COALESCE(MAX(sort_order),0) FROM md_builder_shared_properties)+n.pos,
   NULL,t.min_value,t.max_value,t.field_select,t.choices,t.scope,t.design_row,t.design_width,
   t.design_height,t.design_order,t.design_caption,t.design_caption_width,t.design_display,t.enabled_when
  FROM jsonb_to_recordset($1::jsonb) AS n(prop text,label text,area text,template text,pos int)
  JOIN md_builder_shared_properties t ON t.property_key=n.template
  ON CONFLICT(property_key) DO NOTHING`,
  [JSON.stringify(CARD_PART_PROPERTIES.map(([prop,label,area,template],i)=>({prop,label,area,template,pos:i+1})))]);
 // Card parts: enable and place on their icons (the panel draws every icon cell for every area).
 await client.query(`WITH usable AS (
   SELECT s.api,s.area,s.slot,s.prop FROM jsonb_to_recordset($1::jsonb) AS s(api text,area text,slot text,prop text)
   JOIN md_builder_ribbon_components c ON c.component_api=s.api
   JOIN md_builder_shared_properties p ON p.property_key=s.prop
  ), enabled AS (
   INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
   SELECT DISTINCT api,prop,true FROM usable
   ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true
   RETURNING 1
  )
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT api,area,slot,prop FROM usable
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`,
  [JSON.stringify(CARD_PART_SLOTS.map(([api,area,slot,prop])=>({api,area,slot,prop})))]);
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,value_key)
  SELECT r.api,r.prop,true,r.vk FROM jsonb_to_recordset($1::jsonb) AS r(api text,prop text,vk text)
  JOIN md_builder_ribbon_components c ON c.component_api=r.api
  JOIN md_builder_shared_properties p ON p.property_key=r.prop
  ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true,
   value_key=COALESCE(md_builder_ribbon_component_rules.value_key,EXCLUDED.value_key)`,
  [JSON.stringify(SUPPORTED_RIBBON_RULES.map(([api,prop,vk])=>({api,prop,vk})))]);
 await client.query(`INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT s.api,s.area,s.slot,s.prop FROM jsonb_to_recordset($1::jsonb) AS s(api text,area text,slot text,prop text)
  JOIN md_builder_ribbon_components c ON c.component_api=s.api
  JOIN md_builder_shared_properties p ON p.property_key=s.prop
  JOIN md_builder_design2_slots d ON d.area=s.area AND d.slot_key=s.slot
  ON CONFLICT(component_api,area,slot_key) DO NOTHING`,
  [JSON.stringify(SUPPORTED_RIBBON_SLOTS.map(([api,area,slot,prop])=>({api,area,slot,prop})))]);
 // Shape fill colours the icon on components that draw one; Body fill stays the body.
 await client.query(`UPDATE md_builder_ribbon_component_rules SET value_key='iconFillColor'
  WHERE property_key='shapeFill' AND component_api IN ('smart_button','smart_icon')`);
}
