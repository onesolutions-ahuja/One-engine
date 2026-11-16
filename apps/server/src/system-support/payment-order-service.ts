import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';

/** Provider-neutral payment attempts. Provider API credentials stay in each connector. */
export const PAYMENT_ORDER_DDL=`
CREATE TABLE IF NOT EXISTS md_payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 provider text NOT NULL CHECK (provider ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
 credential_id uuid NOT NULL REFERENCES md_named_credentials(id),
 created_by uuid NOT NULL REFERENCES md_users(id),
 source_object text NOT NULL,
 source_record_id uuid NOT NULL,
 attempt_key uuid NOT NULL,
 provider_order_id text NOT NULL CHECK(length(provider_order_id) BETWEEN 1 AND 200),
 checkout_token text,
 checkout_url text,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency varchar(3) NOT NULL,
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','authorised','completed','failed','cancelled')),
 last_event text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,provider,created_by,attempt_key),
 UNIQUE(tenant_id,provider,credential_id,provider_order_id),
 CHECK(checkout_token IS NOT NULL OR checkout_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS md_payment_orders_source
 ON md_payment_orders(tenant_id,source_object,source_record_id);
`;

/** One-time-compatible, repeatable copy of checkout receipts from the old Revolut table.
 * The original table remains untouched for rollback and historic reconciliation. */
export const LEGACY_REVOLUT_PAYMENT_COPY=`
INSERT INTO md_payment_orders
 (id,tenant_id,provider,credential_id,created_by,source_object,source_record_id,
  attempt_key,provider_order_id,checkout_token,amount_minor,currency,status,
  last_event,created_at,updated_at)
SELECT id,tenant_id,'Revolut',credential_id,created_by,source_object,source_record_id,
 attempt_key,revolut_order_id::text,public_token,amount_minor,currency,status,
 last_event,created_at,updated_at
FROM md_revolut_checkout_orders
ON CONFLICT DO NOTHING;
`;

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const PROVIDER=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export type PaymentStatus='pending'|'authorised'|'completed'|'failed'|'cancelled';
export type PaymentOrderIdentity={tenantId:string;userId:string;provider:string};
export type PaymentOrderRequest=PaymentOrderIdentity&{
 credentialId:string;sourceObject:string;recordId:string;amountField:string;
 currency:string;attemptKey:string;
};
export type ProviderCreateRequest={amountMinor:number;currency:string;attemptKey:string};
export type ProviderCheckout={providerOrderId:string;checkoutToken?:string;checkoutUrl?:string};
export type PaymentOrderResult={id:string;token?:string;checkoutUrl?:string};
export type VerifiedPaymentEvent={
 tenantId:string;provider:string;credentialId:string;
 providerOrderId:string;eventName:string;status:PaymentStatus;
};
export class PaymentOrderError extends Error{
 constructor(message:string,public readonly httpStatus:400|404|409){super(message);}
}

/** Minor-unit conversion shared by every provider; prices always come from a tenant record. */
export function paymentAmountMinor(amount:unknown,currency:string):number{
 if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>1e8
   ||!/^[A-Z]{3}$/.test(currency))throw Error('Invalid payment amount or currency');
 let places:number;
 try{places=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;}
 catch{throw Error('Unsupported currency');}
 if(places<0||places>3)throw Error('Unsupported currency precision');
 const multiplier=10**places,minor=Math.round(amount*multiplier);
 if(!Number.isSafeInteger(minor)||minor<=0||Math.abs(amount*multiplier-minor)>0.000001)
  throw Error('Payment amount has invalid precision');
 return minor;
}

/** A retry or delayed authorisation cannot downgrade a completed capture. */
export function nextPaymentStatus(current:PaymentStatus,incoming:PaymentStatus):PaymentStatus{
 if(current==='completed'||incoming==='completed')return 'completed';
 if(current==='failed'||current==='cancelled')return current;
 if(current==='authorised'&&incoming==='pending')return 'authorised';
 return incoming;
}
function validateProvider(provider:string){
 if(!PROVIDER.test(provider))throw Error('Invalid payment provider');
}
function validateCheckout(order:ProviderCheckout):void{
 if(!order||typeof order.providerOrderId!=='string'
   ||!/^[-A-Za-z0-9_]{1,200}$/.test(order.providerOrderId))
  throw Error('Payment provider returned an invalid order ID');
 if(order.checkoutToken!==undefined&&
   (typeof order.checkoutToken!=='string'||order.checkoutToken.length<8||order.checkoutToken.length>1000))
  throw Error('Payment provider returned an invalid checkout token');
 if(order.checkoutUrl!==undefined){
  if(typeof order.checkoutUrl!=='string'||order.checkoutUrl.length>2048)
   throw Error('Payment provider returned an invalid checkout URL');
  let url:URL;
  try{url=new URL(order.checkoutUrl);}catch{throw Error('Payment provider returned an invalid checkout URL');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password)
   throw Error('Payment provider returned an invalid checkout URL');
 }
 if(!order.checkoutToken&&!order.checkoutUrl)
  throw Error('Payment provider returned no checkout token or URL');
}

/** The ONE order-creation path used by independent provider adapters.
 * Provider-specific API calls happen only in createAtProvider. */
export async function createPaymentOrder(
 db:SqlPersistence,records:RecordEngine,input:PaymentOrderRequest,
 createAtProvider:(request:ProviderCreateRequest)=>Promise<ProviderCheckout>
):Promise<PaymentOrderResult>{
 validateProvider(input.provider);
 if(!UUID.test(input.recordId)||!UUID.test(input.attemptKey))
  throw new PaymentOrderError('Invalid payment record or attempt',400);
 if(!NAME.test(input.sourceObject)||!NAME.test(input.amountField)
   ||!/^[A-Z]{3}$/.test(input.currency)||!UUID.test(input.credentialId))
  throw new PaymentOrderError('Invalid payment configuration',400);
 const record=await records.get(input.tenantId,input.userId,input.sourceObject,input.recordId);
 const amount=paymentAmountMinor(record[input.amountField],input.currency);
 const previous=await db.query<{
  id:string;checkout_token:string|null;checkout_url:string|null;
  credential_id:string;source_object:string;source_record_id:string;
  amount_minor:number;currency:string;
 }>(`SELECT id,checkout_token,checkout_url,credential_id,source_object,source_record_id,
   amount_minor,currency FROM md_payment_orders
   WHERE tenant_id=$1 AND provider=$2 AND created_by=$3 AND attempt_key=$4`,
  [input.tenantId,input.provider,input.userId,input.attemptKey]);
 const prior=previous.rows[0];
 if(prior){
  if(prior.credential_id!==input.credentialId||prior.source_object!==input.sourceObject
    ||prior.source_record_id!==input.recordId||Number(prior.amount_minor)!==amount
    ||prior.currency!==input.currency)
   throw new PaymentOrderError('Payment attempt does not match the record',409);
  return {id:prior.id,token:prior.checkout_token??undefined,
   checkoutUrl:prior.checkout_url??undefined};
 }
 // An already paid source record cannot be charged again by a different provider.
 const paid=await db.query(`SELECT 1 FROM md_payment_orders
   WHERE tenant_id=$1 AND source_object=$2 AND source_record_id=$3
   AND status='completed' LIMIT 1`,[input.tenantId,input.sourceObject,input.recordId]);
 if(paid.rows.length)throw new PaymentOrderError('This record is already paid',409);
 const checkout=await createAtProvider({amountMinor:amount,currency:input.currency,attemptKey:input.attemptKey});
 validateCheckout(checkout);
 const result=await db.query<{id:string;checkout_token:string|null;checkout_url:string|null}>(`
 INSERT INTO md_payment_orders
  (tenant_id,provider,credential_id,created_by,source_object,source_record_id,
   attempt_key,provider_order_id,checkout_token,checkout_url,amount_minor,currency)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
 ON CONFLICT(tenant_id,provider,created_by,attempt_key) DO UPDATE
  SET updated_at=md_payment_orders.updated_at
  WHERE md_payment_orders.credential_id=EXCLUDED.credential_id
    AND md_payment_orders.source_object=EXCLUDED.source_object
    AND md_payment_orders.source_record_id=EXCLUDED.source_record_id
    AND md_payment_orders.amount_minor=EXCLUDED.amount_minor
    AND md_payment_orders.currency=EXCLUDED.currency
 RETURNING id,checkout_token,checkout_url`,[
  input.tenantId,input.provider,input.credentialId,input.userId,
  input.sourceObject,input.recordId,input.attemptKey,checkout.providerOrderId,
  checkout.checkoutToken??null,checkout.checkoutUrl??null,amount,input.currency
 ]);
 const row=result.rows[0];
 if(!row)throw new PaymentOrderError('Payment attempt does not match the record',409);
 return {id:row.id,token:row.checkout_token??undefined,checkoutUrl:row.checkout_url??undefined};
}

/** Only the originating authenticated user can poll their own payment. */
export async function paymentOrderStatus(db:SqlPersistence,identity:PaymentOrderIdentity,orderId:string){
 validateProvider(identity.provider);
 if(!UUID.test(orderId))throw new PaymentOrderError('Invalid order ID',400);
 const {rows}=await db.query<{status:PaymentStatus}>(`
  SELECT status FROM md_payment_orders
  WHERE tenant_id=$1 AND provider=$2 AND id=$3 AND created_by=$4`,
  [identity.tenantId,identity.provider,orderId,identity.userId]);
 if(!rows[0])throw new PaymentOrderError('Order not found',404);
 return rows[0].status;
}

/** Must be called ONLY after the adapter verifies the provider webhook signature.
 * Scoped by tenant, provider and exact installed credential. */
export async function recordVerifiedPaymentEvent(db:SqlPersistence,event:VerifiedPaymentEvent):Promise<boolean>{
 validateProvider(event.provider);
 if(!UUID.test(event.credentialId)
   ||typeof event.providerOrderId!=='string'||event.providerOrderId.length>200
   ||!/^[-A-Za-z0-9_]+$/.test(event.providerOrderId)
   ||typeof event.eventName!=='string'||event.eventName.length>128
   ||!['pending','authorised','completed','failed','cancelled'].includes(event.status))
  throw Error('Invalid verified payment event');
 const {rows}=await db.query<{id:string}>(`
 UPDATE md_payment_orders
 SET status=CASE
   WHEN status='completed' OR $5='completed' THEN 'completed'
   WHEN status IN ('failed','cancelled') THEN status
   WHEN status='authorised' AND $5='pending' THEN 'authorised'
   ELSE $5 END,
   last_event=$6,updated_at=now()
 WHERE tenant_id=$1 AND provider=$2 AND credential_id=$3 AND provider_order_id=$4
 RETURNING id`,[
  event.tenantId,event.provider,event.credentialId,event.providerOrderId,
  event.status,event.eventName
 ]);
 return rows.length===1;
}
