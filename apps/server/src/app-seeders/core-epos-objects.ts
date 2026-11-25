import type {PoolClient} from 'pg';

type Summary={child:string;relationship:string;source:string;filters?:[string,string][]};
const ledgerBalance=(relationship:string,method:string):Field[]=>[
 ...['IN','OUT'].map((direction):Field=>({
  name:direction==='IN'?'IncomingTotal':'OutgoingTotal',type:'rollup',
  summary:{child:'CashLedger',relationship,source:'Amount',filters:[['Method',method],['Direction',direction]]}
 })),
 {name:'Balance',type:'formula',formula:'BLANKVALUE($Record.IncomingTotal, 0) - BLANKVALUE($Record.OutgoingTotal, 0)'}
];
type Field={name:string;type:string;length?:number;target?:string;choices?:string[];unique?:boolean;formula?:string;summary?:Summary};
export const EPOS_OBJECTS:ReadonlyArray<{name:string;existing:boolean;fields:Field[]}>= [
 {name:'PermissionSet',existing:true,fields:[{name:'Name',type:'text'},{name:'Label',type:'text'},{name:'Description',type:'text'}]},
 {name:'CustomPermission',existing:false,fields:[{name:'Name',type:'text'},{name:'Label',type:'text'}]},
 {name:'PermissionSetCustomPermission',existing:false,fields:[{name:'PermissionSet',type:'reference',target:'PermissionSet'},{name:'CustomPermission',type:'reference',target:'CustomPermission'}]},
 {name:'UserPermissionSet',existing:false,fields:[{name:'PermissionSet',type:'reference',target:'PermissionSet'},{name:'User',type:'reference',target:'User'}]},
 {name:'User',existing:true,fields:[
  {name:'RefundLimit',type:'number'},
  {name:'DiscountLimitAmount',type:'number'},
  {name:'DiscountLimitPercent',type:'number'},
  {name:'CashOutLimit',type:'number'},
  {name:'CustomerCreditMax',type:'number'},
 ]},
 {name:'Product',existing:true,fields:[
  {name:'ComponentCost',type:'rollup',summary:{child:'ProductBOM',relationship:'Product',source:'LineCost'}},
  {name:'PopupNote',type:'text',length:255},
  {name:'VariablePrice',type:'boolean'},
  {name:'EatOutPrice',type:'number'},
  {name:'EatOutTaxRate',type:'number'},
  {name:'SellByWeight',type:'boolean'},
  // Overrides the category's kitchen section for this product.
  {name:'KitchenSection',type:'reference',target:'KitchenSection'},
 ]},
 // Kitchen sections (Grill, Fryer, Drinks…): each Kitchen screen tab shows its own lines.
 // A line's section is its Product's, else its Category's (read through lookups, never copied).
 {name:'KitchenSection',existing:false,fields:[
  {name:'Name',type:'text',length:80},
  {name:'Printer',type:'reference',target:'NamedDevice'},
  {name:'Colour',type:'text',length:20},
  {name:'SortOrder',type:'number'},
  {name:'Active',type:'boolean'},
 ]},
 {name:'ProductBOM',existing:false,fields:[
  {name:'Name',type:'text'},
  {name:'Product',type:'reference',target:'Product'},
  {name:'ComponentProduct',type:'reference',target:'Product'},
  {name:'Quantity',type:'number'},
  {name:'LineCost',type:'formula',formula:'$Record.Quantity * $Record.ComponentProduct.Cost'},
  {name:'Unit',type:'picklist',choices:['each','g','kg','ml','l']},
  {name:'Removable',type:'boolean'},
  {name:'SortOrder',type:'number'},
  {name:'Active',type:'boolean'},
 ]},
 {name:'GiftCard',existing:false,fields:[
  {name:'Name',type:'text'},
  {name:'Code',type:'text',length:40,unique:true},
  {name:'InitialValue',type:'number'},
  ...ledgerBalance('GiftCard','Gift card'),
  {name:'ExpiryDate',type:'date'},
  {name:'Status',type:'picklist',choices:['Active','Used','Expired','Cancelled']},
  {name:'Customer',type:'reference',target:'Customer'},
  {name:'Invoice',type:'reference',target:'Invoice'},
 ]},
 {name:'ServicePoint',existing:false,fields:[
  {name:'Name',type:'text'},
  {name:'Type',type:'picklist',choices:['Table','Room','Chair','Bay','Seat','Desk','Takeaway']},
  {name:'Area',type:'text',length:80},
  {name:'Seats',type:'number'},
  {name:'Status',type:'picklist',choices:['Free','Seated','Ordered','Bill','Cleaning']},
  {name:'CurrentCart',type:'reference',target:'Cart'},
  {name:'PosX',type:'number'},
  {name:'PosY',type:'number'},
  {name:'Width',type:'number'},
  {name:'Height',type:'number'},
  {name:'Rotation',type:'number'},
  {name:'Shape',type:'picklist',choices:['Square','Rectangle','Round','Oval','Bench','Icon']},
  {name:'Icon',type:'text',length:80},
  {name:'SortOrder',type:'number'},
  {name:'Active',type:'boolean'},
 ]},
 {name:'Customer',existing:true,fields:[
  {name:'CreditLimit',type:'number'},
  {name:'AccountOnHold',type:'boolean'},
 ]},
 {name:'CashLedger',existing:true,fields:[
  {name:'GiftCard',type:'reference',target:'GiftCard'},
  {name:'Reason',type:'picklist',choices:['Petty cash','Bank drop','Float top-up','Supplier paid','No sale','Other']},
 ]},
 {name:'InvoiceLine',existing:true,fields:[
  {name:'RefundReason',type:'picklist',choices:['Damaged','Wrong item','Changed mind','Not as described','Other']},
  {name:'ReturnToStock',type:'boolean'},
 ]},
 {name:'CartLine',existing:true,fields:[
  {name:'DiscountReason',type:'picklist',choices:['Staff','Loyalty','Damaged','Manager','Other']},
  {name:'Note',type:'text',length:255},
  {name:'Course',type:'number'},
  {name:'KitchenStatus',type:'picklist',choices:['Not sent','Sent','Done','Served','Void']},
 ]},
 {name:'Cart',existing:true,fields:[
  {name:'OrderType',type:'picklist',choices:['Eat in','Take away','Delivery','Collection']},
  {name:'Covers',type:'number'},
  {name:'ServicePoint',type:'reference',target:'ServicePoint'},
  {name:'TabName',type:'text',length:80},
 ]},
 {name:'ProductCategory',existing:true,fields:[
  {name:'OrderPrinter',type:'text',length:128},
  {name:'KitchenSection',type:'reference',target:'KitchenSection'},
 ]},
 {name:'Order',existing:false,fields:[
  {name:'Name',type:'text',length:80},
  {name:'Cart',type:'reference',target:'Cart'},
  {name:'Customer',type:'reference',target:'Customer'},
  {name:'Total',type:'number'},
  {name:'Notes',type:'text',length:255},
  {name:'Source',type:'picklist',choices:['Till','Uber Eats','Deliveroo','Just Eat','Kiosk','Online']},
  {name:'OrderType',type:'picklist',choices:['Eat in','Take away','Delivery','Collection']},
  {name:'ServicePoint',type:'reference',target:'ServicePoint'},
  {name:'Covers',type:'number'},
  {name:'ExternalOrderId',type:'text',length:128},
  {name:'KitchenStatus',type:'picklist',choices:['New','Accepted','Preparing','Ready','Collected','Rejected']},
  {name:'PrepMinutes',type:'number'},
 ]},
 {name:'OrderLine',existing:false,fields:[
  {name:'Name',type:'text',length:255},
  {name:'Order',type:'reference',target:'Order'},
  {name:'Product',type:'reference',target:'Product'},
  {name:'Quantity',type:'number'},
  {name:'CartLine',type:'reference',target:'CartLine'},
  {name:'Course',type:'number'},
  {name:'Note',type:'text',length:255},
  // Short = only some could be made (MadeQty); Served = the ticket was completed (off the screen).
  {name:'KitchenStatus',type:'picklist',choices:['New','Done','Void','Short','Served']},
  {name:'Options',type:'text',length:500},
  {name:'MadeQty',type:'number'},
 ]},
];
const cashier=['Till_Hold','Till_MiscProduct','Till_Tables','Till_ItemDiscount','Customer_Select','Customer_List'];
const supervisor=[...cashier,'Till_PettyCash','Till_FloatAdjust','Till_NoSale','Till_Void','Till_Delete','Till_Clear',
 'Till_BasketDiscount','Till_Refund','Till_RemoveFromTable','Stock_Receive','Stock_Take'];
const manager=[...supervisor,'Till_Admin','Till_Settings','Till_QuickAdd','Till_ManagerOverride','Till_Close',
 'Till_BlindClose','Stock_Send','Stock_SeeExpected','Till_NoServiceCharge','Customer_CreditLimit','Customer_CreditOverride'];
export const EPOS_PERMISSION_SETS=[
 {name:'TillCashier',label:'Till Cashier',permissions:cashier},
 {name:'TillSupervisor',label:'Till Supervisor',permissions:supervisor},
 {name:'TillManager',label:'Till Manager',permissions:manager}
];
export async function seedEposObjects(client:PoolClient,tenantId:string){
 await client.query(`INSERT INTO md_custom_permission_definitions(tenant_id,name)
  SELECT $1,name FROM unnest($2::text[]) names(name) ON CONFLICT DO NOTHING`,[tenantId,manager]);
 for(const set of EPOS_PERMISSION_SETS){
  const created=await client.query<{id:string}>(`INSERT INTO md_permission_sets(tenant_id,api_name,label)
   VALUES($1,$2,$3) ON CONFLICT(tenant_id,api_name) DO NOTHING RETURNING id`,[tenantId,set.name,set.label]);
  // An existing set may have had grants deliberately revoked by its tenant.
  if(created.rows[0])await client.query(`INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
   SELECT $1,$2,'CustomPermission:'||name,'read','allow' FROM unnest($3::text[]) names(name)
   ON CONFLICT DO NOTHING`,[tenantId,created.rows[0].id,set.permissions]);
 }
 for(const object of EPOS_OBJECTS){
  if(!object.existing)await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
   VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,api_name) DO NOTHING`,
   [tenantId,object.name,object.name.replace(/([a-z])([A-Z])/g,'$1 $2'),['CustomPermission','PermissionSetCustomPermission','UserPermissionSet'].includes(object.name)]);
 }
 for(const object of EPOS_OBJECTS)for(const field of object.fields){
  const inserted=await client.query(`INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object,max_length,is_unique,required,formula_expression,formula_return_type,rollup_child_object,rollup_relationship_field,rollup_operation,rollup_source_field)
   SELECT $1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,$12,$13,$14 WHERE EXISTS
   (SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 AND deleted_at IS NULL)
   ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING RETURNING id`,
   [tenantId,object.name,field.name,field.name.replace(/([a-z])([A-Z])/g,'$1 $2'),field.type,field.target??null,field.length??null,field.unique??false,field.formula??null,field.formula?'number':null,field.summary?.child??null,field.summary?.relationship??null,field.summary?'SUM':null,field.summary?.source??null]);
  if(inserted.rowCount&&field.summary?.filters){
   for(const [order,[key,value]] of field.summary.filters.entries())await client.query(`INSERT INTO md_field_rollup_filters
    (tenant_id,object_api,child_object,rollup_field_api,filter_field_api,operator,value_text,sort_order)
    VALUES($1,$2,$3,$4,$5,'Equals',$6,$7) ON CONFLICT DO NOTHING`,[tenantId,object.name,field.summary.child,field.name,key,value,order]);
  }
  if(field.choices)await addChoices(client,tenantId,object.name,field.name,field.choices);
 }
 await addChoices(client,tenantId,'CashLedger','Method',['Customer credit','Gift card','On account']);
 await removeDuplicateCustomerBalance(client,tenantId);
}
// Customer already keeps what is owed in AccountBalance. The ledger balance fields an earlier seed added
// duplicated it, so retire them, but only while they are still exactly the seeded definitions.
async function removeDuplicateCustomerBalance(client:PoolClient,tenantId:string){
 await client.query(`UPDATE md_field_definitions SET deleted_at=now()
  WHERE tenant_id=$1 AND object_api='Customer' AND deleted_at IS NULL AND (
   (api_name IN ('IncomingTotal','OutgoingTotal') AND data_type='rollup' AND rollup_child_object='CashLedger'
    AND rollup_relationship_field='Customer' AND rollup_source_field='Amount')
   OR (api_name='Balance' AND data_type='formula'
    AND formula_expression='BLANKVALUE($Record.IncomingTotal, 0) - BLANKVALUE($Record.OutgoingTotal, 0)')
   OR (api_name='AvailableCredit' AND data_type='formula'
    AND formula_expression='BLANKVALUE($Record.CreditLimit, 0) + $Record.Balance'))`,[tenantId]);
}
async function addChoices(client:PoolClient,tenantId:string,object:string,field:string,choices:string[]){
 await client.query(`INSERT INTO md_field_picklist_values(tenant_id,object_api,field_api,value,sort_order)
 SELECT $1,$2,$3,c.value,COALESCE((SELECT max(sort_order) FROM md_field_picklist_values
 WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3),0)+c.ord FROM unnest($4::text[]) WITH ORDINALITY c(value,ord)
 WHERE EXISTS(SELECT 1 FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND data_type='picklist' AND deleted_at IS NULL)
 ON CONFLICT(tenant_id,object_api,field_api,value) DO NOTHING`,[tenantId,object,field,choices]);
}
