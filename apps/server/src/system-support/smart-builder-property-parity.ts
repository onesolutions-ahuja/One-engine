/**
 * The shared Page Builder metadata contract: one saved key per enabled control.
 * Applied after the individual Smart component migrations on every startup.
 * Do not alter the immutable historical SQL baseline or tenant-authored pages.
 */
import {addSharedProperties} from './smart-chart.js';
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
type Spec=[string,string,'Design2',string,string,string|null,string,number|null,number|null];
const setting=(key:string,label:string,kind:string,area:string,min:number|null=null,max:number|null=null):Spec=>
 [key,label,'Design2',area,kind,null,
  kind==='align'?'["left","center","right"]':kind==='shadow'?'["none","small","medium","large"]':'[]',min,max];
const PROPERTIES:Spec[]=[
 setting('imageRadius','Image radius','number','Image',0,600),
 setting('imageShadow','Image shadow','shadow','Image'),
 setting('headerShadow','Header shadow','shadow','Header'),
 setting('headerWrapText','Header wrap','boolean','Header'),
 setting('headerRadius','Header radius','number','Header',0,600),
 setting('headerBoxWidth','Header width','number','Header',0,1200),
 setting('supportingRadius','Supporting radius','number','Header Supporting',0,600),
 setting('supportingBoxWidth','Supporting width','number','Header Supporting',0,1200),
 setting('supportingShadow','Supporting shadow','shadow','Header Supporting'),
 setting('supportingWrapText','Supporting wrap','boolean','Header Supporting'),
 setting('badgeShadow','Badge shadow','shadow','Badge'),
 setting('badgeWrapText','Badge wrap','boolean','Badge'),
 setting('badgeTextAlignment','Badge text alignment','align','Badge'),
 setting('footerRadius','Footer radius','number','Footer',0,600),
 setting('footerShadow','Footer shadow','shadow','Footer'),
 setting('rowShadow','Row shadow','shadow','Row'),
 setting('gridBorderColor','Grid border','color','Body'),
 setting('gridRadius','Grid radius','number','Body',0,600),
 setting('gridShadow','Grid shadow','shadow','Body'),
 setting('plotBackgroundColor','Plot fill','color','Body'),
 setting('plotBorderColor','Plot border','color','Body'),
 setting('plotRadius','Plot radius','number','Body',0,600),
 setting('plotShadow','Plot shadow','shadow','Body'),
 ...['customButton1','customButton2','cardButton','qtyIncrease','qtyDecrease']
  .map(key=>setting(key+'Shadow',key+' shadow','shadow','Button'))
];
export const BUILDER_SMART_APIS=[
 'smart_numpad','smart_button','smart_toggle','smart_lookup','smart_search',
 'smart_selector','smart_tabs','smart_text','smart_textbox','smart_label',
 'smart_card_grid','smart_image','smart_calendar','smart_navigation','smart_container',
 'smart_cart','smart_icon','smart_table','smart_keyboard','smart_dock','smart_chart',
 'smart_qr','smart_video','smart_line_items','smart_id_card','smart_paired_screens'
] as const;
type Mapping=[string,string,string,string];
const map=(api:string,area:string,slot:string,key:string):Mapping=>[api,area,slot,key];
const part=(api:string,area:string,prefix:string,slots:Array<[string,string]>):Mapping[] =>
 slots.map(([slot,suffix])=>map(api,area,slot,prefix+suffix));
const standard=['smart_numpad','smart_button','smart_toggle','smart_lookup','smart_search',
 'smart_selector','smart_tabs','smart_text','smart_textbox','smart_label',
 'smart_calendar','smart_navigation','smart_container','smart_cart',
 'smart_icon','smart_table','smart_keyboard','smart_dock','smart_chart',
 'smart_qr','smart_video','smart_line_items','smart_paired_screens'];
const body=standard.flatMap(api=>[
 map(api,'Body','fill','backgroundColor'),
 map(api,'Body','border','borderColor'),map(api,'Body','radius','radius'),
 map(api,'Body','shadow','shadow')
]);
const geometry=BUILDER_SMART_APIS.flatMap(api=>[
 map(api,'Body','width','width'),map(api,'Body','height','height')
]);
const grid=['smart_card_grid','smart_id_card'].flatMap(api=>[
 map(api,'Body','fill','gridBackgroundColor'),map(api,'Body','border','gridBorderColor'),
 map(api,'Body','radius','gridRadius'),map(api,'Body','shadow','gridShadow'),
 ...part(api,'Image','image',[
  ['fill','BackgroundColor'],['border','BorderColor'],['radius','Radius'],
  ['shadow','Shadow'],['height','Height'],['width','Width']]),
 ...part(api,'Header','header',[
  ['fill','BodyColor'],['border','BorderColor'],['radius','Radius'],
  ['height','BoxHeight'],['width','BoxWidth'],['shadow','Shadow'],
  ['text','TextColor'],['alignment','Alignment'],['bold','Bold'],
  ['wrap','WrapText'],['size','TextSize']]),
 ...part(api,'Header Supporting','supporting',[
  ['fill','BackgroundColor'],['border','BorderColor'],['radius','Radius'],
  ['height','BoxHeight'],['width','BoxWidth'],['shadow','Shadow'],['wrap','WrapText']]),
 ...part(api,'Badge','badge',[
  ['fill','BodyColor'],['border','BorderColor'],['radius','Radius'],
  ['height','Height'],['width','Width'],['shadow','Shadow'],
  ['text','TextColor'],['alignment','TextAlignment'],['bold','Bold'],
  ['wrap','WrapText'],['size','TextSize']]),
 ...part(api,'Footer','footer',[
  ['fill','BackgroundColor'],['border','BorderColor'],['radius','Radius'],
  ['height','Height'],['width','Width'],['shadow','Shadow'],
  ['text','TextColor'],['alignment','Alignment'],['bold','Bold'],
  ['wrap','WrapText'],['size','TextSize']]),
 ...part(api,'Grid','grid',[
  ['fill','BackgroundColor'],['border','BorderColor'],
  ['radius','Radius'],['shadow','Shadow']]),
 ...part(api,'Focused','focused',[
  ['height','CardHeight'],['width','CardWidth'],['border','CardBorderColor'],
  ['shadow','CardShadow'],['text','TextColor'],['bold','TextBold'],['size','TextSize']]),
 map(api,'Focused','fill','selectedCardColor')
]);
const btnSlots:Array<[string,string]>=[
 ['fill','Fill'],['border','BorderColor'],['radius','Radius'],
 ['height','Height'],['width','Width'],['text','TextColor'],
 ['alignment','Alignment'],['size','TextSize'],['bold','Bold'],
 ['wrap','WrapText'],['shape','Shape'],['shadow','Shadow']
];
const actions=[
 ...part('smart_card_grid','Button','customButton1',btnSlots),
 ...part('smart_card_grid','Button 2','customButton2',btnSlots),
 ...part('smart_card_grid','Button 3','cardButton',btnSlots),
 ...part('smart_cart','Button','customButton1',btnSlots),
 ...part('smart_cart','Button 2','customButton2',btnSlots),
 ...part('smart_cart','Button 4','qtyIncrease',btnSlots),
 ...part('smart_cart','Button 5','qtyDecrease',btnSlots)
];
const special:Mapping[]=[
 ...part('smart_image','Image','image',[
  ['fill','BackgroundColor'],['border','BorderColor'],
  ['radius','Radius'],['shadow','Shadow'],['height','Height'],['width','Width']]),
 ...part('smart_image','Header','header',[
  ['fill','BodyColor'],['border','BorderColor'],['height','BoxHeight'],
  ['width','BoxWidth'],['shadow','Shadow'],['wrap','WrapText']]),
 map('smart_image','Header','alignment','labelAlignment'),
 ...part('smart_image','Badge','badge',[
  ['fill','BodyColor'],['border','BorderColor'],['height','Height'],
  ['width','Width'],['shadow','Shadow'],['wrap','WrapText'],
  ['alignment','TextAlignment']]),
 ...part('smart_cart','Header','header',[
  ['radius','Radius'],['height','BoxHeight'],['width','BoxWidth'],
  ['shadow','Shadow'],['wrap','WrapText']]),
 ...part('smart_cart','Header Supporting','supporting',[
  ['fill','BackgroundColor'],['border','BorderColor'],['radius','Radius'],
  ['height','BoxHeight'],['width','BoxWidth'],['shadow','Shadow'],
  ['text','TextColor'],['wrap','WrapText']]),
 ...part('smart_cart','Image','image',[
  ['radius','Radius'],['shadow','Shadow'],['width','Width']]),
 ...part('smart_cart','Footer','footer',[
  ['alignment','Alignment'],['radius','Radius'],['shadow','Shadow']]),
 map('smart_cart','Row','shadow','rowShadow'),
 map('smart_cart','Focused','fill','selectedRowColor'),
 ...part('smart_table','Header','header',[['shadow','Shadow']]),
 ...part('smart_table','Row','row',[['shadow','Shadow']]),
 map('smart_table','Footer','alignment','footerAlignment'),
 ...part('smart_textbox','Header','header',[
  ['border','BorderColor'],['radius','Radius'],
  ['height','BoxHeight'],['width','BoxWidth']]),
 ...part('smart_textbox','Header Supporting','supporting',[
  ['width','BoxWidth'],['shadow','Shadow'],['wrap','WrapText']]),
 ...part('smart_navigation','Image','image',[
  ['fill','BackgroundColor'],['border','BorderColor'],
  ['radius','Radius'],['shadow','Shadow'],['height','Height'],['width','Width']]),
 map('smart_navigation','Body','bold','headerBold'),
 map('smart_tabs','Body','bold','headerBold'),
 map('smart_lookup','Body','bold','headerBold'),
 ...part('smart_chart','Body','plot',[
  ['fill','BackgroundColor'],['border','BorderColor'],
  ['radius','Radius'],['shadow','Shadow']]),
 map('smart_tabs','Focused','fill','selectedTabColor'),
 map('smart_tabs','Focused','text','selectedTextColor'),
 map('smart_numpad','Focused','border','numpadFocusedBorderColor'),
 map('smart_numpad','Focused','radius','numpadFocusedRadius'),
 map('smart_numpad','Focused','shadow','numpadFocusedShadow'),
 map('smart_numpad','Focused','bold','numpadFocusedBold'),
 map('smart_numpad','Focused','size','numpadFocusedTextSize'),
 map('smart_calendar','Focused','fill','defaultValueColor'),
 ...['smart_numpad','smart_keyboard','smart_dock'].flatMap(api=>[
  map(api,'Focused','fill','numpadFocusedFill'),
  map(api,'Focused','text','numpadFocusedTextColor')])
];
// A later, more-specific part binding replaces a generic Body binding. PostgreSQL
// must never receive duplicate (component,area,slot) UPSERT input rows.
// ID Card renders fields instead of Card Grid's supporting/footer DOM. Never expose
// a control with no actual target, even if Card Grid shares the underlying engine.
const mappings=[...new Map([...body,...geometry,...grid,...actions,...special]
 .filter(item=>!(item[0]==='smart_id_card'&&
   (item[1]==='Header Supporting'||item[1]==='Footer')))
 .map(item=>[item.slice(0,3).join(':'),item] as const)).values()];
const rows=(values:readonly (readonly string[])[])=>values.map(row=>
 '('+row.map(v=>"'"+v.replaceAll("'","''")+"'").join(',')+')').join(',\n');

/** One catalog for current tenants and fresh installations; never rewrites page properties. */
export async function applySmartBuilderPropertyParity(client:Query){
 await addSharedProperties(client,PROPERTIES);
 // The Grid is a real independently selectable canvas area, not a Body alias.
 // Clone the fixed Body glyph positions, then use Grid-specific SQL bindings.
 await client.query(`INSERT INTO md_builder_design2_slots
  (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT 'Grid',COALESCE((SELECT MIN(area_order) FROM md_builder_design2_slots WHERE area='Grid'),8),
   slot_key,row_no,100+ROW_NUMBER() OVER(ORDER BY row_no,order_no,slot_key),
   width_px,height_px,property_key,fallback_key
  FROM md_builder_design2_slots WHERE area='Body' AND row_no BETWEEN 1 AND 3
   AND slot_key NOT LIKE 'extra_%'
  ON CONFLICT(area,slot_key) DO NOTHING`);
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ${rows(BUILDER_SMART_APIS.map(api=>[api]))}
  ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT c.component_api,p.property_key,true FROM md_builder_ribbon_components c
  CROSS JOIN md_builder_shared_properties p
  WHERE c.component_api=ANY($1::text[]) AND p.property_key IN ('x','y','width','height')
  ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true`,[BUILDER_SMART_APIS]);
 await client.query(`WITH candidate(component_api,area,slot_key,property_key) AS
  (VALUES ${rows(mappings)}), supported AS (
   SELECT DISTINCT c.* FROM candidate c
   JOIN md_builder_ribbon_components b ON b.component_api=c.component_api
   JOIN md_builder_shared_properties p ON p.property_key=c.property_key
   JOIN md_builder_design2_slots s ON s.area=c.area AND s.slot_key=c.slot_key)
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT DISTINCT component_api,property_key,true FROM supported
  ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true`);
 await client.query(`WITH candidate(component_api,area,slot_key,property_key) AS
  (VALUES ${rows(mappings)})
  INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT DISTINCT c.component_api,c.area,c.slot_key,c.property_key FROM candidate c
  JOIN md_builder_ribbon_components b ON b.component_api=c.component_api
  JOIN md_builder_shared_properties p ON p.property_key=c.property_key
  JOIN md_builder_design2_slots s ON s.area=c.area AND s.slot_key=c.slot_key
  ON CONFLICT(component_api,area,slot_key) DO UPDATE SET property_key=EXCLUDED.property_key`);
 // There is no Cart Button 3 DOM target: keep the icon disabled.
 await client.query(`DELETE FROM md_builder_design2_slot_rules
  WHERE component_api='smart_cart' AND area='Button 3'`);
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT c.api,p.property_key,true FROM
   (VALUES ('smart_id_card'),('smart_card_grid')) c(api)
  CROSS JOIN (VALUES ('cardMinHeight'),('cardMinWidth')) v(property_key)
  JOIN md_builder_shared_properties p ON p.property_key=v.property_key
  ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true`);
 await client.query(`UPDATE md_builder_ribbon_component_rules SET enabled=false
  WHERE property_key='shapeFill' AND component_api=ANY($1::text[])`,[BUILDER_SMART_APIS]);
}
