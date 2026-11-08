import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {FlowRecordQuery} from '../system-files/flow-record-query.js';
import type {RecordEngine} from '../system-files/record-engine.js';

type Fields={sourceNumber:string;sourceType:string;sourceStatus:string;sourceReference:string;
 lineParent:string;lineSource:string;lineProduct:string;quantity:string;unitPrice:string;
 lineTotal:string;lineName:string;reason:string;cashier:string;total:string;
 sourceQuantity:string;typeValue:string;returnStatuses:string[]};
const api=/^[A-Za-z][A-Za-z0-9_]*$/;
function mapping(raw:unknown):Fields{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid document return configuration');
 const x=raw as Record<string,unknown>;
 for(const key of ['sourceNumber','sourceType','sourceStatus','sourceReference','lineParent',
  'lineSource','lineProduct','quantity','unitPrice','lineTotal','lineName','reason','cashier','total','sourceQuantity'])
  if(typeof x[key]!=='string'||!api.test(x[key]))throw Error('Invalid document return field mapping');
 if(typeof x.typeValue!=='string'||!x.typeValue
  ||!Array.isArray(x.returnStatuses)||!x.returnStatuses.length||
  x.returnStatuses.some(s=>typeof s!=='string'||!s))
  throw Error('Invalid document return status configuration');
 return x as Fields;
}
type Requested={originalInvoiceLineId:string;quantity:number};
const cents=(value:unknown,label:string):number=>{
 const number=Number(value);
 if(!Number.isFinite(number)||Math.abs(number)>100000000
  ||Math.abs(number*100-Math.round(number*100))>0.00001)
  throw Error('Invalid '+label+' amount');
 return Math.round(number*100);
};
const money=(value:number)=>value/100;
const lineArray=(value:unknown):Requested[]=>{
 if(!Array.isArray(value)||value.length<1||value.length>200)throw Error('Select 1 to 200 return lines');
 const result:Requested[]=[],seen=new Set<string>();
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Invalid return line');
  const x=item as Record<string,unknown>,id=x.originalInvoiceLineId,qty=x.quantity;
  if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)
   ||typeof qty!=='number'||!Number.isSafeInteger(qty)||qty<=0||qty>100000)
   throw Error('Invalid return line or quantity');
  if(seen.has(id))throw Error('Duplicate original invoice line');
  seen.add(id);result.push({originalInvoiceLineId:id,quantity:qty});
 }
 return result;
};
/** Single reusable SQL transaction for validated negative linked document creation.
 * All reads run through tenant/RBAC-filtered Flow queries, writes through shared RecordEngine.
 * A source-document advisory lock serialises concurrent partial returns.
 */
export async function createLinkedReturnDocument(db:SqlPersistence,records:RecordEngine,
 query:FlowRecordQuery,tenantId:string,userId:string,config:unknown,
 inputs:Record<string,unknown>){
 const g=mapping(config);
 const originalNumber=inputs.originalInvoiceNumber,reason=inputs.reason,requestId=inputs.requestId;
 if(typeof originalNumber!=='string'||!originalNumber.trim()||originalNumber.length>128
  ||typeof reason!=='string'||!reason.trim()||reason.length>256
  ||typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId))
  throw Error('Invalid sales return request');
 const selections=lineArray(inputs.lines);
 return db.transaction(async client=>{
  const original=(await query.find(tenantId,userId,'Invoice',[
   {field:g.sourceNumber,operator:'Equals',value:originalNumber.trim()}],undefined,{limit:1},client))[0];
  if(!original||original[g.sourceType]===g.typeValue
   ||!g.returnStatuses.includes(String(original[g.sourceStatus]??'')))
   throw Error('Invoice is not eligible for return');
  const sourceId=String(original.Id);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
   [tenantId+':document-return:'+sourceId]);
  const returnNumber='SRN-'+requestId;
  const existing=(await query.find(tenantId,userId,'Invoice',[
   {field:g.sourceNumber,operator:'Equals',value:returnNumber}],undefined,{limit:1},client))[0];
  if(existing){
   if(existing[g.sourceReference]!==sourceId||existing[g.sourceType]!==g.typeValue)
    throw Error('Return request reference conflict');
   return {completed:true,status:'completed',outputs:{
    status:'completed',srnInvoiceId:existing.Id,srnInvoiceNumber:returnNumber}};
  }
  const invoiceLines=await query.find(tenantId,userId,'InvoiceLine',[
   {field:g.lineParent,operator:'Equals',value:sourceId}],undefined,{limit:200},client);
  const byId=new Map(invoiceLines.map(item=>[String(item.Id),item]));
  const createdLines:Record<string,unknown>[]=[];
  let totalCents=0,subtotalCents=0,discountCents=0,taxCents=0;
  for(const item of selections){
   const source=byId.get(item.originalInvoiceLineId);
   if(!source)throw Error('Return line is not part of the selected invoice');
   const sold=Number(source[g.sourceQuantity]);
   if(!Number.isSafeInteger(sold)||sold<=0)throw Error('Source sale has invalid quantity');
   const previous=await query.find(tenantId,userId,'InvoiceLine',[
    {field:g.lineSource,operator:'Equals',value:item.originalInvoiceLineId}],
    undefined,{limit:200},client);
   if(previous.length>=200)throw Error('Prior return history requires administrator review');
   let alreadyReturned=0,alreadyCreditedCents=0;
   for(const row of previous){
    const priorId=String(row[g.lineParent]??'');
    const prior=priorId?(await query.find(tenantId,userId,'Invoice',[
     {field:'Id',operator:'Equals',value:priorId}],undefined,{limit:1},client))[0]:null;
    if(!prior)throw Error('Prior return invoice cannot be verified');
    if(prior[g.sourceType]===g.typeValue
      &&!['Cancelled','Canceled','Void','Voided'].includes(String(prior[g.sourceStatus]??'')))
     {alreadyReturned+=Math.abs(Number(row[g.quantity]));
      if(row[g.lineTotal]!==undefined&&row[g.lineTotal]!==null)
       alreadyCreditedCents+=Math.abs(cents(row[g.lineTotal],'previous return line'));}
   }
   if(!Number.isFinite(alreadyReturned)||alreadyReturned+item.quantity>sold)
    throw Error('Return quantity exceeds remaining eligible quantity');
   const unitCents=cents(source[g.unitPrice],'source unit price');
   if(unitCents<0)throw Error('Source unit price is invalid');
   const originalTotalCents=source[g.lineTotal]===undefined||source[g.lineTotal]===null
    ?unitCents*sold:cents(source[g.lineTotal],'source line total');
   if(originalTotalCents<0)throw Error('Original invoice line total is invalid');
   const remainingCents=Math.max(0,originalTotalCents-alreadyCreditedCents);
   const lineCents=-(alreadyReturned+item.quantity===sold
    ?remainingCents:Math.min(remainingCents,Math.round(originalTotalCents*item.quantity/sold)));
   const lineSubtotal=-(unitCents*item.quantity);
   const discount=source.DiscountAmount==null?0:Math.round(cents(source.DiscountAmount,'discount')*item.quantity/sold);
   const tax=source.TaxAmount==null?0:Math.round(cents(source.TaxAmount,'tax')*item.quantity/sold);
   if(!Number.isSafeInteger(lineCents)||!Number.isSafeInteger(lineSubtotal))
    throw Error('Return amount exceeds supported range');
   totalCents+=lineCents;subtotalCents+=lineSubtotal;
   discountCents-=discount;taxCents-=tax;
   const values:Record<string,unknown>={
    [g.lineName]:String(source[g.lineName]??'Returned item'),
    [g.lineProduct]:source[g.lineProduct],
    [g.quantity]:-item.quantity,[g.unitPrice]:money(unitCents),
    [g.lineTotal]:money(lineCents),[g.lineSource]:item.originalInvoiceLineId
   };
   if(source.DiscountAmount!==undefined)values.DiscountAmount=money(-discount);
   if(source.TaxAmount!==undefined)values.TaxAmount=money(-tax);
   createdLines.push(values);
  }
  if(!Number.isSafeInteger(totalCents)||totalCents>0)
   throw Error('Return total is invalid');
  const header:Record<string,unknown>={
   Name:'Sales return '+originalNumber.trim(),
   [g.sourceNumber]:returnNumber,[g.sourceType]:g.typeValue,
   [g.sourceReference]:sourceId,[g.sourceStatus]:'Issued',
   [g.reason]:reason,[g.cashier]:userId,[g.total]:money(totalCents)
  };
  if(original.Customer)header.Customer=original.Customer;
  if(original.Subtotal!==undefined)header.Subtotal=money(subtotalCents);
  if(original.DiscountAmount!==undefined)header.DiscountAmount=money(discountCents);
  if(original.TaxAmount!==undefined)header.TaxAmount=money(taxCents);
  const srnInvoiceId=await records.createInTransaction(client,tenantId,userId,'Invoice',header);
  for(const item of createdLines){
   item[g.lineParent]=srnInvoiceId;
   await records.createInTransaction(client,tenantId,userId,'InvoiceLine',item);
  }
  await client.query(`INSERT INTO md_security_events(tenant_id,action,details)
   VALUES($1,'LinkedSalesReturnCreated',
    jsonb_build_object('userId',$2::text,'originalInvoiceId',$3::text,
    'returnInvoiceId',$4::text,'lineCount',$5::integer))`,
   [tenantId,userId,sourceId,srnInvoiceId,createdLines.length]);
  return {completed:true,status:'completed',outputs:{
   status:'completed',srnInvoiceId,srnInvoiceNumber:returnNumber}};
 });
}

/** Read-only return picker; reports quantities already returned through earlier SRNs. */
export async function loadLinkedReturnDocument(query:FlowRecordQuery,
 tenantId:string,userId:string,config:unknown,inputs:Record<string,unknown>){
 const g=mapping(config);
 const number=inputs.invoiceNumber;
 if(typeof number!=='string'||!number.trim()||number.length>128)
  throw Error('Enter a valid invoice number');
 const invoice=(await query.find(tenantId,userId,'Invoice',[
  {field:g.sourceNumber,operator:'Equals',value:number.trim()}],undefined,{limit:1}))[0];
 if(!invoice||invoice[g.sourceType]===g.typeValue
  ||!g.returnStatuses.includes(String(invoice[g.sourceStatus]??'')))
  throw Error('No eligible completed invoice found');
 const lines=await query.find(tenantId,userId,'InvoiceLine',[
  {field:g.lineParent,operator:'Equals',value:invoice.Id}],undefined,{limit:200});
 const available:Record<string,unknown>[]=[];
 for(const line of lines){
  const sold=Number(line[g.sourceQuantity]);
  if(!Number.isSafeInteger(sold)||sold<1)continue;
  const previous=await query.find(tenantId,userId,'InvoiceLine',[
   {field:g.lineSource,operator:'Equals',value:line.Id}],undefined,{limit:200});
  if(previous.length>=200)throw Error('Prior return history requires administrator review');
  let returned=0;
  for(const prior of previous){
   const priorInvoice=await query.find(tenantId,userId,'Invoice',[
    {field:'Id',operator:'Equals',value:prior[g.lineParent]}],undefined,{limit:1});
   if(!priorInvoice[0])throw Error('Previous return records are unavailable');
   if(priorInvoice[0][g.sourceType]===g.typeValue
     &&!['Cancelled','Canceled','Void','Voided'].includes(String(priorInvoice[0][g.sourceStatus]??'')))
    returned+=Math.abs(Number(prior[g.quantity]));
  }
  if(!Number.isFinite(returned))throw Error('Invalid previous return quantity');
  const quantity=Math.max(0,sold-returned);
  if(quantity>0)available.push({...line,ReturnableQuantity:quantity});
 }
 return {completed:true,status:'completed',outputs:{invoice,records:available}};
}
