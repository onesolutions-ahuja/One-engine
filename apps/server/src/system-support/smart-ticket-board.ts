/** Smart Ticket Board — upgrade-safe SQL metadata (additive, idempotent; runs on every start).
 *
 * Records grouped into tickets (kitchen tickets, pick lists, job cards). Everything already
 * shared is reused: Object / Filter / Sort, Text Source (line text), Column 2 (qty), Row
 * supporting source (line note), Column 3 (line state), Column 4 (line tag), Card description
 * (subtitle), Badge, Custom Button 1/2 and the Body, Header, Header Supporting, Row, Badge and
 * Button looks. Only the ticket settings are new, in their own Design 2 section "Ticket Board".
 * No tenant page, saved property or record is rewritten.
 */
import {addSharedProperties,type Query,type Spec} from './smart-chart.js';

const AREA='Ticket Board';
const json=(value:unknown)=>JSON.stringify(value);
const spec=(key:string,label:string,kind:string,initial:unknown=null,min:number|null=null,max:number|null=null):Spec=>
 [key,label,'Design2',AREA,kind,initial===null?null:json(initial),json([]),min,max];

export const TICKET_BOARD_PROPERTY_SPECS:Spec[]=[
 spec('ticketGroupField','Group by field','expression'),
 spec('ticketTitle','Ticket title','expression'),
 spec('ticketTime','Ticket time','expression'),
 spec('ticketSection','Line heading','expression'),
 spec('ticketLineVisible','Show line when','expression'),
 spec('ticketAccent','Ticket colour','expression'),
 spec('ticketWarnMinutes','Amber after (min)','number',10,0,600),
 spec('ticketLateMinutes','Red after (min)','number',15,0,600),
 spec('ticketNewSeconds','New for (sec)','number',60,0,3600),
 spec('ticketColumnWidth','Column width','number',280,160,900),
 spec('ticketMaxHeight','Max ticket height','number',560,160,4000)
];

/** Existing shared keys the component uses (data, ticket and line text, looks, buttons). */
const REUSED_KEYS=[
 'objectApiName','filterFormula','filterLogic','filters','sortField','sortDirection','label','emptyText',
 'textSource','column2Source','rowSupportingSource','column3Source','column4Source','cardDescription',
 'badgeText','badgeVisible','badgeBodyColor','badgeTextColor','badgeBorderColor','badgeRadius','badgeTextSize','badgeBold',
 'backgroundColor','borderColor','radius','shadow','fontFamily','gap','cardPadding','width','height','x','y',
 'headerTextColor','headerTextSize','headerBold','supportingTextColor','supportingTextSize',
 'rowLabelColor','rowTextSize','rowBold','rowBorderColor','selectedRowColor','rowSupportingTextColor','rowSupportingTextSize',
 ...['customButton1','customButton2'].flatMap(button=>['Label','Fill','TextColor','BorderColor','Radius','Height','Width',
  'Bold','TextSize','Shape','Shadow','WrapText','Alignment'].map(suffix=>button+suffix)),
 'visibleFormula','disabledFormula','visibilityRules'
];

export async function applySmartTicketBoard(client:Query){
 // 1) Register for the ribbon and for every existing tenant (fresh tenants: SMART_COMPONENTS).
 await client.query(`INSERT INTO md_builder_ribbon_components(component_api)
  VALUES ('smart_ticket_board') ON CONFLICT(component_api) DO NOTHING`);
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_ticket_board','smart-bundled:smart_ticket_board',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);

 // 2) The ticket settings, as shared properties in their own section.
 await addSharedProperties(client,TICKET_BOARD_PROPERTY_SPECS);
 const keys=TICKET_BOARD_PROPERTY_SPECS.map(item=>item[0]);
 // 3) Their own Design 2 area "Ticket Board" (after every existing area), one row of settings.
 //    slot_key is unique per area and order_no per (area,row), so a re-run changes nothing.
 await client.query(`
  WITH specs(property_key,ordinal) AS (SELECT * FROM unnest($1::text[]) WITH ORDINALITY)
  INSERT INTO md_builder_design2_slots
   (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
  SELECT $2,
   COALESCE((SELECT MIN(area_order) FROM md_builder_design2_slots WHERE area=$2),
            (SELECT COALESCE(MAX(area_order),0)+1 FROM md_builder_design2_slots)),
   'extra_'||spec.property_key,3,spec.ordinal::integer,
   CASE WHEN property.control_kind='number' THEN 58 ELSE 150 END,
   26,spec.property_key,spec.property_key
  FROM specs spec JOIN md_builder_shared_properties property ON property.property_key=spec.property_key
  ON CONFLICT(area,slot_key) DO NOTHING`,[keys,AREA]);

 // 4) Which properties the component uses (only keys that exist on this database).
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT 'smart_ticket_board',property_key,true FROM md_builder_shared_properties
  WHERE property_key=ANY($1::text[]) ON CONFLICT DO NOTHING`,[[...keys,...REUSED_KEYS]]);

 // 5) Design 2 cells for every enabled key: the shared areas (Body, Header, Row, Badge, Button…)
 //    and the new Ticket Board section.
 await client.query(`INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT r.component_api,d.area,d.slot_key,d.property_key FROM md_builder_design2_slots d
  JOIN md_builder_ribbon_component_rules r ON r.property_key=d.property_key AND r.enabled
  WHERE r.component_api='smart_ticket_board' ON CONFLICT DO NOTHING`);
}
