import type {FlowNodeContext} from './NodeContext.js';
import {formatAutoNumberValue} from '../../field-engine/types/AutoNumberField.js';

const api=/^[A-Za-z][A-Za-z0-9_]*$/;
type Mapping={sourceObject:string;lineObject:string;sourceField:string;lineParentField:string;
 statusField:string;approvedStatuses:string[];quantityField:string;unitPriceField:string;
 discountField:string;taxField:string;lineTotalField:string;customerField:string;
 subtotalField:string;discountTotalField:string;taxTotalField:string;totalField:string;
 targetSourceField:string;targetCustomerField:string};
type IssueMapping={lineObject:string;parentField:string;quantityField:string;
 unitPriceField:string;discountField:string;taxField:string;lineTotalField:string;
 subtotalField:string;discountTotalField:string;taxTotalField:string;totalField:string;
 statusField:string;issuedStatus:string;numberField:string;formatField:string};
const field=(value:unknown):string=>{
 if(typeof value!=='string'||!api.test(value))throw Error('Invalid financial Flow field mapping');
 return value;
};
const cents=(value:unknown,label:string,optional=false):number=>{
 const number=value===null||value===undefined||value===''&&optional?0:Number(value);
 if(!Number.isFinite(number)||number<0||number>100000000||Math.abs(number*100-Math.round(number*100))>0.00001)
  throw Error('Invalid monetary amount: '+label);
 return Math.round(number*100);
};
function validatedLines(lines:Record<string,unknown>[],m:{
 quantityField:string;unitPriceField:string;discountField:string;taxField:string;lineTotalField:string}){
 if(lines.length<1||lines.length>200)throw Error('Financial document must have 1 to 200 lines');
 const total={subtotal:0,discount:0,tax:0,total:0};
 for(const row of lines){
  const qty=Number(row[m.quantityField]);
  if(!Number.isFinite(qty)||qty<=0||qty>100000||Math.round(qty*10000)!==qty*10000)
   throw Error('Financial line requires a valid positive quantity');
  const price=cents(row[m.unitPriceField],'Unit Price');
  const discount=cents(row[m.discountField],'Discount',true);
  const tax=cents(row[m.taxField],'Tax',true);
  const subtotal=Math.round(price*qty);
  if(!Number.isSafeInteger(subtotal)||subtotal>10000000000||discount>subtotal)
   throw Error('Invalid financial line discount');
  const expected=subtotal-discount+tax;
  if(cents(row[m.lineTotalField],'Line Total')!==expected)
   throw Error('Financial line total differs from verified quantity, price, discount and tax');
  total.subtotal+=subtotal;total.discount+=discount;total.tax+=tax;total.total+=expected;
  if(Object.values(total).some(n=>!Number.isSafeInteger(n)||n>100000000000))
   throw Error('Financial document exceeds supported amount');
 }
 return Object.fromEntries(Object.entries(total).map(([k,v])=>[k,v/100])) as
  {subtotal:number;discount:number;tax:number;total:number};
}

type LineMutationMapping={parentObject:string;parentField:string;quantityField:string;
 unitPriceField:string;discountField:string;taxField:string;lineTotalField:string;
 subtotalField:string;discountTotalField:string;taxTotalField:string;totalField:string;
 statusField?:string;lockedStatuses?:string[];numberField?:string};
/** Backward-compatible guard for tenant Flows created before line-total metadata was seeded. */
export function defaultDocumentLineTotalsConfig(objectApi:string):LineMutationMapping|null{
 if(objectApi==='QuotationLine')return {parentObject:'Quotation',parentField:'Quotation',
  quantityField:'Quantity',unitPriceField:'UnitPrice',discountField:'DiscountAmount',
  taxField:'TaxAmount',lineTotalField:'LineTotal',subtotalField:'Subtotal',
  discountTotalField:'DiscountAmount',taxTotalField:'TaxAmount',totalField:'Total',
  statusField:'Status',lockedStatuses:['Accepted','Approved','Converted']};
 if(objectApi==='InvoiceLine')return {parentObject:'Invoice',parentField:'Invoice',
  quantityField:'Quantity',unitPriceField:'UnitPrice',discountField:'DiscountAmount',
  taxField:'TaxAmount',lineTotalField:'LineTotal',subtotalField:'Subtotal',
  discountTotalField:'DiscountAmount',taxTotalField:'TaxAmount',totalField:'Total',
  statusField:'Status',lockedStatuses:['Issued','PartPaid','Paid','PartiallyPaid'],
  numberField:'InvoiceNumber'};
 return null;
}
const lockParent=async(context:FlowNodeContext,object:string,id:string)=>{
 await context.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
  [context.tenantId+':financial-line-parent:'+object+':'+id]);
};
function lineAmount(fields:Record<string,unknown>,m:LineMutationMapping){
 const qty=Number(fields[m.quantityField]);
 if(!Number.isFinite(qty)||qty<=0||qty>100000||Math.round(qty*10000)!==qty*10000)
  throw Error('Financial line requires a valid positive quantity');
 const price=cents(fields[m.unitPriceField],'Unit Price');
 const discount=cents(fields[m.discountField],'Discount',true);
 const tax=cents(fields[m.taxField],'Tax',true);
 const subtotal=Math.round(price*qty);
 if(!Number.isSafeInteger(subtotal)||subtotal>10000000000||discount>subtotal)
  throw Error('Invalid financial line discount');
 const total=subtotal-discount+tax;
 if(!Number.isSafeInteger(total)||total>10000000000)
  throw Error('Financial line exceeds supported amount');
 return {subtotal:subtotal/100,discount:discount/100,tax:tax/100,total:total/100};
}
/** Normalize line totals and remember parent links before a line mutation. */
export async function prepareDocumentLineMutation(context:FlowNodeContext,raw:unknown,
 recordId:string|undefined,fields:Record<string,unknown>):Promise<{oldParent:string|null;newParent:string}>{
 if(raw===null||raw===undefined)throw Error('Financial line Flow is missing its totals guard');
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid line totals Flow guard');
 const m=raw as unknown as LineMutationMapping;
 for(const key of ['parentObject','parentField','quantityField','unitPriceField','discountField',
  'taxField','lineTotalField','subtotalField','discountTotalField','taxTotalField','totalField'] as const)
  field(m[key]);
 if(m.statusField!==undefined)field(m.statusField);
 if(m.numberField!==undefined)field(m.numberField);
 if(m.lockedStatuses!==undefined&&(!Array.isArray(m.lockedStatuses)||
  m.lockedStatuses.some(x=>typeof x!=='string'||x.length>40)))
  throw Error('Invalid locked financial document statuses');
 const object=String(context.node.config.object??'');
 let old:Record<string,unknown>|null=null;
 if(recordId){
  old=await context.records.get(context.tenantId,context.userId,object,recordId,context.client);
 }
 const merged={...(old??{}),...fields};
 const parent=merged[m.parentField];
 if(typeof parent!=='string'||!/^[0-9a-f-]{36}$/i.test(parent))
  throw Error('Financial line requires a valid parent document');
 const oldParent=old&&typeof old[m.parentField]==='string'?String(old[m.parentField]):null;
 // Composite document Flows must never mutate a line belonging to another
 // parent, even when the caller has generic Line edit rights in this tenant.
 const expectedExpression=context.node.config.expectedParentId;
 if(expectedExpression!==undefined){
  const expected=context.evaluate(expectedExpression);
  if(typeof expected!=='string'||!/^[0-9a-f-]{36}$/i.test(expected)
   ||parent!==expected||(oldParent!==null&&oldParent!==expected))
   throw Error('Financial line does not belong to the selected document');
 }
 const parents=[...new Set([oldParent,parent].filter((x):x is string=>!!x))];
 for(const parentId of parents){
  await lockParent(context,m.parentObject,parentId);
  const doc=await context.records.get(context.tenantId,context.userId,m.parentObject,parentId,context.client);
  if((m.statusField&&Array.isArray(m.lockedStatuses)&&m.lockedStatuses.includes(String(doc[m.statusField]??'')))
   ||(m.numberField&&doc[m.numberField]!==null&&doc[m.numberField]!==undefined&&String(doc[m.numberField])!==''))
   throw Error('Lines cannot be changed after the financial document is issued');
 }
 const amount=lineAmount(merged,m);
 fields[m.lineTotalField]=amount.total;
 return {oldParent,newParent:parent};
}
/** Recompute parent totals through RecordEngine after every line create/update/delete. */
export async function recalculateDocumentLineTotals(context:FlowNodeContext,raw:unknown,
 parentId:string):Promise<void>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid line totals Flow guard');
 const m=raw as unknown as LineMutationMapping;
 const lineObject=String(context.node.config.object);
 const lines=await readLines(context,lineObject,m.parentField,parentId);
 if(lines.length>200)throw Error('Financial document exceeds 200 lines');
 const totals={subtotal:0,discount:0,tax:0,total:0};
 for(const row of lines){
  const amount=lineAmount(row,m);
  totals.subtotal+=Math.round(amount.subtotal*100);
  totals.discount+=Math.round(amount.discount*100);
  totals.tax+=Math.round(amount.tax*100);
  totals.total+=Math.round(amount.total*100);
  if(Object.values(totals).some(n=>!Number.isSafeInteger(n)||n>100000000000))
   throw Error('Financial document exceeds supported amount');
  const stored=cents(row[m.lineTotalField],'Line Total',true);
  if(stored!==Math.round(amount.total*100)){
   if(typeof row.Id!=='string')throw Error('Financial line has no record ID');
   await context.records.update(context.tenantId,context.userId,lineObject,row.Id,
    {[m.lineTotalField]:amount.total},undefined,context.client);
  }
 }
 await context.records.update(context.tenantId,context.userId,m.parentObject,parentId,{
  [m.subtotalField]:totals.subtotal/100,[m.discountTotalField]:totals.discount/100,
  [m.taxTotalField]:totals.tax/100,[m.totalField]:totals.total/100
 },undefined,context.client);
}

const readLines=async(context:FlowNodeContext,object:string,relation:string,id:string)=>{
 const rows=await context.recordQuery.find(context.tenantId,context.userId,object,
  [{field:relation,operator:'Equals',value:id}],undefined,{limit:200},context.client);
 return rows;
};
const uniqueLock=async(context:FlowNodeContext,source:string,id:string)=>{
 await context.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
  [context.tenantId+':financial-source:'+source+':'+id]);
};
export async function enforceDocumentConversion(context:FlowNodeContext,raw:unknown,
 fields:Record<string,unknown>):Promise<void>{
 if(raw===null||raw===undefined)return;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid conversion Flow guard');
 const config=raw as unknown as Mapping;
 for(const key of ['sourceObject','lineObject','sourceField','lineParentField',
  'statusField','quantityField','unitPriceField','discountField','taxField','lineTotalField',
  'customerField','subtotalField','discountTotalField','taxTotalField','totalField',
  'targetSourceField','targetCustomerField'] as const)field(config[key]);
 if(!Array.isArray(config.approvedStatuses)||!config.approvedStatuses.length
  ||config.approvedStatuses.length>10
  ||config.approvedStatuses.some(x=>typeof x!=='string'||x.length>40))
  throw Error('Invalid accepted financial document statuses');
 const sourceId=fields[config.targetSourceField];
 if(typeof sourceId!=='string'||!/^[0-9a-f-]{36}$/i.test(sourceId))
  throw Error('A valid source document is required');
 await uniqueLock(context,config.sourceObject,sourceId);
 const source=await context.records.get(context.tenantId,context.userId,
  config.sourceObject,sourceId,context.client);
 if(!config.approvedStatuses.includes(String(source[config.statusField]??'')))
  throw Error('Source document has not been accepted');
 const existing=await readLines(context,context.node.config.object as string,
  config.targetSourceField,sourceId);
 if(existing.length)throw Error('An invoice already exists for this quotation');
 const lines=await readLines(context,config.lineObject,config.lineParentField,sourceId);
 const totals=validatedLines(lines,config);
 if(cents(source[config.totalField],'Quotation total')!==Math.round(totals.total*100))
  throw Error('Accepted quotation total disagrees with its lines');
 const customer=source[config.customerField];
 if(typeof customer!=='string'||!customer)throw Error('Source document requires a customer');
 fields[config.targetCustomerField]=customer;
 fields[config.subtotalField]=totals.subtotal;
 fields[config.discountTotalField]=totals.discount;
 fields[config.taxTotalField]=totals.tax;
 fields[config.totalField]=totals.total;
}
/** Issue action only. Reads and validates stored lines, allocates a number on the
 * same SQL transaction and delegates writes to the existing RecordEngine RBAC.
 */
export async function enforceDocumentIssue(context:FlowNodeContext,raw:unknown,
 recordId:string,fields:Record<string,unknown>):Promise<void>{
 if(raw===null||raw===undefined)return;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid issue Flow guard');
 const config=raw as unknown as IssueMapping;
 for(const key of ['lineObject','parentField','quantityField','unitPriceField',
  'discountField','taxField','lineTotalField','subtotalField','discountTotalField',
  'taxTotalField','totalField','statusField','numberField','formatField'] as const)field(config[key]);
 if(typeof config.issuedStatus!=='string'||config.issuedStatus.length>40)
  throw Error('Invalid issue state');
 if(fields[config.statusField]!==config.issuedStatus)
  throw Error('Issue Flow requires the published issue status');
 if(Object.hasOwn(fields,config.numberField))throw Error('Invoice number is system allocated');
 await uniqueLock(context,String(context.node.config.object),recordId);
 const invoice=await context.records.get(context.tenantId,context.userId,
  String(context.node.config.object),recordId,context.client);
 if(invoice[config.numberField]||invoice[config.statusField]===config.issuedStatus)
  throw Error('Invoice has already been issued');
 const lines=await readLines(context,config.lineObject,config.parentField,recordId);
 const totals=validatedLines(lines,config);
 fields[config.subtotalField]=totals.subtotal;
 fields[config.discountTotalField]=totals.discount;
 fields[config.taxTotalField]=totals.tax;
 fields[config.totalField]=totals.total;
 const object=String(context.node.config.object);
 const {rows:formats}=await context.client.query<{auto_number_format:string|null}>(`
  SELECT auto_number_format FROM md_field_definitions WHERE tenant_id=$1
    AND object_api=$2 AND api_name=$3 AND data_type='autonumber' AND deleted_at IS NULL`,
  [context.tenantId,object,config.formatField]);
 if(!formats[0]?.auto_number_format)throw Error('Configure invoice numbering in Object Manager');
 const {rows:counter}=await context.client.query<{sequence:string}>(`
  INSERT INTO md_auto_number_counters(tenant_id,object_api,field_api,next_value)
  VALUES($1,$2,$3,2) ON CONFLICT(tenant_id,object_api,field_api)
  DO UPDATE SET next_value=md_auto_number_counters.next_value+1
  RETURNING (next_value-1)::text AS sequence`,
  [context.tenantId,object,config.numberField]);
 if(!counter[0])throw Error('Invoice number allocation unavailable');
 const allocated=formatAutoNumberValue(formats[0].auto_number_format,
  Number(counter[0].sequence));
 const {rowCount:duplicate}=await context.client.query(`
  SELECT 1 FROM md_record_values v JOIN md_records r
   ON r.tenant_id=v.tenant_id AND r.id=v.record_id
   WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.field_api=$3
    AND v.value_text=$4 AND r.is_deleted=false LIMIT 1`,
  [context.tenantId,object,config.numberField,allocated]);
 if(duplicate)throw Error('Generated document number already exists; review the Object Manager prefix');
 fields[config.numberField]=allocated;
}

/** Optional metadata source uniqueness on a destination Create Records node.
 * Accepts only a source relationship and an allowed source status, keeps all
 * source/target lookups behind shared OneEngine Record and Query engines.
 */
export async function enforceDocumentSourceLink(context:FlowNodeContext,raw:unknown,
 fields:Record<string,unknown>):Promise<void>{
 if(raw===null||raw===undefined)return;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('Invalid document source link');
 const g=raw as Record<string,unknown>;
 const sourceObject=field(g.sourceObject),sourceField=field(g.sourceField);
 const statusField=field(g.statusField),customerField=field(g.customerField);
 const targetCustomerField=field(g.targetCustomerField);
 const allowed=g.allowedStatuses;
 if(!Array.isArray(allowed)||!allowed.length||allowed.length>10||
   allowed.some(x=>typeof x!=='string'||x.length>60))
  throw Error('Invalid document source statuses');
 const sourceId=fields[sourceField];
 if(typeof sourceId!=='string'||!/^[0-9a-f-]{36}$/i.test(sourceId))
  throw Error('Invoice source is missing');
 await uniqueLock(context,sourceObject,sourceId);
 const source=await context.records.get(context.tenantId,context.userId,
  sourceObject,sourceId,context.client);
 if(!allowed.includes(source[statusField]))
  throw Error('Source has not reached an invoiceable status');
 const target=String(context.node.config.object??'');
 const prior=await readLines(context,target,sourceField,sourceId);
 if(prior.length)throw Error('An invoice already exists for this source');
 const customer=source[customerField];
 if(typeof customer!=='string'||!customer)throw Error('Invoice source has no customer');
 fields[targetCustomerField]=customer;
}
