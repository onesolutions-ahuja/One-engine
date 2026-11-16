import type {FlowNodeContext} from './NodeContext.js';

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
// TODO(native): financial line guards are switched off until native record reads are ready.
export async function prepareDocumentLineMutation(
 _context:FlowNodeContext,_raw:unknown,_recordId:string|undefined,
 _fields:Record<string,unknown>
):Promise<{oldParent:string|null;newParent:string}>{
 return {oldParent:null,newParent:''};
}

// TODO(native): financial document totals are not recalculated while the guard is switched off.
export async function recalculateDocumentLineTotals(
 _context:FlowNodeContext,_raw:unknown,_parentId:string
):Promise<void>{
 return;
}

// TODO(native): document conversion guard is switched off.
export async function enforceDocumentConversion(
 _context:FlowNodeContext,_raw:unknown,_fields:Record<string,unknown>
):Promise<void>{
 return;
}

// TODO(native): document issue guard is switched off.
export async function enforceDocumentIssue(
 _context:FlowNodeContext,_raw:unknown,_recordId:string,
 _fields:Record<string,unknown>
):Promise<void>{
 return;
}

// TODO(native): document source-link guard is switched off.
export async function enforceDocumentSourceLink(
 _context:FlowNodeContext,_raw:unknown,_fields:Record<string,unknown>
):Promise<void>{
 return;
}
