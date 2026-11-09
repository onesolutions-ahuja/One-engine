import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRecordQuery} from '../system-files/flow-record-query.js';

/** RECORDPAYMENT(InvoiceId, Amount, Method, Note): posts one CashLedger receipt for an
 * Invoice and updates the Invoice's AmountPaid and Status in ONE transaction, with no Flow.
 * Guarantees: the user's normal Object/record permissions apply (Invoice edit,
 * CashLedger create); the Invoice is locked; overpayment is refused; a retried click with
 * the same idempotency reference returns the first posting instead of paying twice.
 * Funds are not collected here: this records money already received. */
export const PAYMENT_METHODS=['Cash','Card','Bank Transfer','Other'] as const;
export const PAYABLE_INVOICE_STATUSES=['Issued','PartPaid','Unpaid','Sent','Overdue'] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whole pence; rejects negative, non-finite, >2 decimals and absurd values. */
export function paymentPence(value:unknown,label='Payment amount'):number{
 const n=typeof value==='string'&&value.trim()!==''?Number(value):value;
 if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100000000
  ||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('Invalid '+label.toLowerCase());
 return Math.round(n*100);
}

export type RecordPaymentInput={invoiceId:unknown;amount:unknown;method:unknown;note?:unknown;reference:unknown};
export type RecordPaymentResult={ledgerId:string;invoiceId:string;amount:number;amountPaid:number;
 outstanding:number;status:string;duplicate:boolean};

export function validatePaymentInput(input:RecordPaymentInput){
 const {invoiceId,method,reference}=input;
 if(typeof invoiceId!=='string'||!uuid.test(invoiceId))throw Error('RECORDPAYMENT needs a valid Invoice ID');
 if(typeof method!=='string'||!(PAYMENT_METHODS as readonly string[]).includes(method))
  throw Error('Payment method must be one of: '+PAYMENT_METHODS.join(', '));
 if(typeof reference!=='string'||reference.length<8||reference.length>128||!/^[A-Za-z0-9_.:-]+$/.test(reference))
  throw Error('Payment needs an idempotency reference');
 const note=input.note===undefined||input.note===null?'':String(input.note);
 if(note.length>255)throw Error('Payment note is too long (255 characters maximum)');
 const amount=paymentPence(input.amount);
 if(amount<=0)throw Error('Payment amount must be more than zero');
 return {invoiceId,method,reference,note,amount};
}

type Engines={db:SqlPersistence;records:RecordEngine;query:FlowRecordQuery};
export async function recordInvoicePayment({db,records,query}:Engines,tenantId:string,userId:string,
 input:RecordPaymentInput):Promise<RecordPaymentResult>{
 const p=validatePaymentInput(input);
 return db.transaction(async(client:PoolClient)=>{
  // Same lock key as the payment Flow guards: Flow and formula payments serialise together.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
   [tenantId+':financial-invoice:'+p.invoiceId]);
  const invoice=await records.get(tenantId,userId,'Invoice',p.invoiceId,client) as Record<string,unknown>;
  const entries=await query.find(tenantId,userId,'CashLedger',
   [{field:'Invoice',operator:'Equals',value:p.invoiceId}],undefined,{limit:200},client) as Record<string,unknown>[];
  if(entries.length===200)throw Error('Payment history exceeds the safe limit; reconcile before taking more payments');
  const total=paymentPence(invoice.Total??0,'Invoice total');
  const paid=entries.filter(e=>e.Status==='Posted').reduce((sum,e)=>{
   const v=paymentPence(e.Amount??0,'Ledger amount');
   return sum+(e.Direction==='IN'?v:e.Direction==='OUT'?-v:0);
  },0);
  const repeat=entries.find(e=>e.Reference===p.reference);
  if(repeat){
   // Retried request: report the original posting, never post twice.
   return {ledgerId:String(repeat.Id??''),invoiceId:p.invoiceId,amount:paymentPence(repeat.Amount??0)/100,
    amountPaid:paid/100,outstanding:Math.max(0,total-paid)/100,status:String(invoice.Status??''),duplicate:true};
  }
  const status=String(invoice.Status??'');
  if(!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(status))
   throw Error(status==='Paid'?'This invoice is already paid':'Issue the invoice before taking payment (status is '+(status||'blank')+')');
  if(total<=0)throw Error('Invoice total must be more than zero');
  if(paid+p.amount>total)
   throw Error('Payment of '+(p.amount/100).toFixed(2)+' is more than the '+((total-paid)/100).toFixed(2)+' still owed');
  const newPaid=paid+p.amount;
  const newStatus=newPaid===total?'Paid':'PartPaid';
  await records.update(tenantId,userId,'Invoice',p.invoiceId,{AmountPaid:newPaid/100,Status:newStatus},undefined,client);
  // Transaction-local proof consumed by the RecordEngine CashLedger insert guard.
  // Only this server path and the payment Flow guards can mint it.
  await client.query("SELECT set_config('metadrive.cash_ledger_guarded','yes',true)");
  const ledgerId=await records.createInTransaction(client,tenantId,userId,'CashLedger',{
   Name:'Payment '+String(invoice.InvoiceNumber||invoice.Name||p.invoiceId).slice(0,60),
   TransactionType:'Receipt',Direction:'IN',Amount:p.amount/100,Method:p.method,
   Invoice:p.invoiceId,Customer:invoice.Customer??null,CurrencyCode:invoice.CurrencyCode??null,
   User:userId,SourceApp:'ActionFormula',TransactionDate:new Date().toISOString(),
   Reference:p.reference,ExternalReference:p.note||null,Status:'Posted'
  });
  await client.query("SELECT set_config('metadrive.cash_ledger_guarded','',true)");
  return {ledgerId:String(ledgerId),invoiceId:p.invoiceId,amount:p.amount/100,amountPaid:newPaid/100,
   outstanding:(total-newPaid)/100,status:newStatus,duplicate:false};
 });
}
