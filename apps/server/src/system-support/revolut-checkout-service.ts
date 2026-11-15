import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {NamedCredentialService} from './named-credential-service.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {IntegrationActivityWriter} from './integration-api-log.js';
import {requestExternalHttps,publicHttpsUrl} from './external-http-transport.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const ORIGINS=new Set(['https://sandbox-merchant.revolut.com','https://merchant.revolut.com']);
const EVENTS=['ORDER_COMPLETED','ORDER_AUTHORISED','ORDER_PAYMENT_DECLINED',
 'ORDER_PAYMENT_FAILED','ORDER_CANCELLED','ORDER_FAILED'];
const actor=(req:Request)=> (req as Request&{actor?:{tenant_id:string;user_id:string}}).actor;
const route=(fn:(req:Request,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};

export const REVOLUT_PAYMENT_DDL=`
CREATE TABLE IF NOT EXISTS md_revolut_checkout_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 credential_id uuid NOT NULL REFERENCES md_named_credentials(id),
 created_by uuid NOT NULL REFERENCES md_users(id),
 source_object text NOT NULL,
 source_record_id uuid NOT NULL,
 attempt_key uuid NOT NULL,
 revolut_order_id uuid NOT NULL,
 public_token text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency varchar(3) NOT NULL,
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','authorised','completed','failed','cancelled')),
 last_event text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,created_by,attempt_key),
 UNIQUE(tenant_id,revolut_order_id)
);
CREATE INDEX IF NOT EXISTS md_revolut_checkout_source
 ON md_revolut_checkout_orders(tenant_id,source_object,source_record_id);
`;

/** Revolut signs "v1.{timestamp}.{unmodified raw body}", not Meta's sha256=raw-body format. */
export function verifyRevolutWebhook(
 raw:Buffer,timestamp:unknown,signatures:unknown,secret:string,now=Date.now()
):boolean{
 if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>262144
   ||typeof timestamp!=='string'||!/^[0-9]{13}$/.test(timestamp)
   ||Math.abs(now-Number(timestamp))>300000
   ||typeof signatures!=='string'||signatures.length>1024||!secret)return false;
 const expected=createHmac('sha256',secret).update('v1.'+timestamp+'.').update(raw).digest();
 return signatures.split(',').slice(0,8).some(part=>{
  const match=/^v1=([0-9a-f]{64})$/i.exec(part.trim());
  if(!match)return false;
  const received=Buffer.from(match[1],'hex');
  return received.length===expected.length&&timingSafeEqual(expected,received);
 });
}

/** Never downgrade completed payments when Revolut retries out-of-order events. */
export function revolutEventState(event:string):'completed'|'authorised'|'failed'|'cancelled'|null{
 if(event==='ORDER_COMPLETED')return 'completed';
 if(event==='ORDER_AUTHORISED')return 'authorised';
 if(event==='ORDER_CANCELLED')return 'cancelled';
 if(['ORDER_FAILED','ORDER_PAYMENT_DECLINED','ORDER_PAYMENT_FAILED'].includes(event))return 'failed';
 return null;
}

export function revolutMinorAmount(amount:unknown,currency:string):number{
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

type Credential={
 id:string;base_url:string;auth_type:string;secret_ciphertext:Buffer|null;
 configuration_ciphertext:Buffer|null;encryption_key_id:string;enabled:boolean;
};
type Settings={publishable:string;recordObject:string;amountField:string;currency:string};
function parseSettings(raw:unknown):Settings{
 const config=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const publishable=config.public_checkoutPublishable;
 const recordObject=config.public_checkoutRecordObject;
 const amountField=config.public_checkoutAmountField;
 const currency=config.public_checkoutCurrency;
 if(typeof publishable!=='string'||!/^pk_[A-Za-z0-9_-]{10,200}$/.test(publishable)
   ||typeof recordObject!=='string'||!NAME.test(recordObject)
   ||typeof amountField!=='string'||!NAME.test(amountField)
   ||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))
  throw Error('Configure Revolut public key, record Object, amount field and currency in AppExchange');
 return {publishable,recordObject,amountField,currency};
}

export function registerRevolutCheckoutRoutes(
 app:Express,db:SqlPersistence,records:RecordEngine,vault:NamedCredentialService,
 rbac:RbacEngine,activity:IntegrationActivityWriter
){
 const connected=async(tenant:string)=>{
  const {rows}=await db.query<Credential>(`
   SELECT c.id,c.base_url,c.auth_type,c.secret_ciphertext,c.configuration_ciphertext,
     c.encryption_key_id,c.enabled
   FROM md_connector_app_credentials b
   JOIN md_apps a ON a.id=b.app_id AND a.tenant_owner_id IS NULL AND a.api_name='RevolutConnector' AND a.enabled=true
   JOIN md_app_installations i ON i.tenant_id=b.tenant_id AND i.app_id=b.app_id
   JOIN md_app_entitlements e ON e.tenant_id=b.tenant_id AND e.app_id=b.app_id
     AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
   JOIN md_named_credentials c ON c.tenant_id=b.tenant_id AND c.id=b.credential_id
   WHERE b.tenant_id=$1 AND c.enabled=true AND c.protocol='HTTPS' LIMIT 1`,[tenant]);
  const c=rows[0];
  if(!c||c.auth_type!=='Bearer'||!ORIGINS.has(publicHttpsUrl(c.base_url).origin))
   throw Error('Revolut Connector is not installed or is not configured for an approved Merchant host');
  return c;
 };
 const settings=(c:Credential)=>parseSettings(c.configuration_ciphertext
  ?JSON.parse(vault.decryptOpaque(c.configuration_ciphertext,c.encryption_key_id)) as unknown:{});
 const merchant=async(tenant:string,c:Credential,method:'GET'|'POST'|'PATCH',path:string,body?:Record<string,unknown>,attempt?:string)=>{
  if(!c.secret_ciphertext)throw Error('Revolut Secret Merchant API key is not configured');
  const key=vault.decryptOpaque(c.secret_ciphertext,c.encryption_key_id);
  const data=body?JSON.stringify(body):undefined;
  const url=new URL(path,c.base_url.endsWith('/')?c.base_url:c.base_url+'/');
  if(!ORIGINS.has(url.origin)||url.origin!==new URL(c.base_url).origin)
   throw Error('Revolut Merchant host is not approved');
  const started=Date.now();
  let status=0;
  try{
   const result=await requestExternalHttps(url,{method,body:data,timeoutMs:15000,maxResponseBytes:65536,
    headers:{Accept:'application/json','Revolut-Api-Version':'2026-08-17',
     Authorization:'Bearer '+key,...(data?{'Content-Type':'application/json'}:{}),
     ...(attempt?{'Idempotency-Key':attempt}:{})}});
   status=result.status;
   await activity({tenantId:tenant,direction:'Outbound',transport:'HTTP',provider:'Revolut',credentialId:c.id,
    endpoint:url.origin+url.pathname,method,statusCode:status,
    outcome:status>=200&&status<300?'success':'http_error',durationMs:Date.now()-started,
    requestBytes:Buffer.byteLength(data??''),responseBytes:result.responseBytes});
   if(status<200||status>=300)throw Error('Revolut Merchant API rejected the request (HTTP '+status+')');
   const json=JSON.parse(result.body) as unknown;
   if(!json||typeof json!=='object'||Array.isArray(json))throw Error('Invalid Revolut API response');
   return json as Record<string,unknown>;
  }catch(error){
   if(status===0)throw Error('Revolut Merchant API unavailable');
   throw error;
  }
 };
 app.get('/api/revolut/checkout/config',route(async(req,res)=>{
  const who=actor(req);if(!who)throw Error('Authentication required');
  const c=await connected(who.tenant_id),s=settings(c);
  res.setHeader('Cache-Control','private, no-store');
  res.json({publicKey:s.publishable,mode:new URL(c.base_url).hostname.startsWith('sandbox-')?'sandbox':'prod',
   currency:s.currency});
 }));
 app.post('/api/revolut/checkout/orders',route(async(req,res)=>{
  const who=actor(req);if(!who)throw Error('Authentication required');
  const recordId=req.body?.recordId,attemptKey=req.body?.attemptKey;
  if(typeof recordId!=='string'||!UUID.test(recordId)
    ||typeof attemptKey!=='string'||!UUID.test(attemptKey))
   {res.status(400).json({error:'Invalid payment record or attempt'});return;}
  const c=await connected(who.tenant_id),s=settings(c);
  const record=await records.get(who.tenant_id,who.user_id,s.recordObject,recordId);
  const amount=revolutMinorAmount(record[s.amountField],s.currency);
  const previous=await db.query<{id:string;public_token:string;source_record_id:string;amount_minor:number}>(`
   SELECT id,public_token,source_record_id,amount_minor FROM md_revolut_checkout_orders
   WHERE tenant_id=$1 AND created_by=$2 AND attempt_key=$3`,
   [who.tenant_id,who.user_id,attemptKey]);
  if(previous.rows[0]){
   if(previous.rows[0].source_record_id!==recordId||Number(previous.rows[0].amount_minor)!==amount)
    {res.status(409).json({error:'Payment attempt does not match the record'});return;}
   res.json({id:previous.rows[0].id,token:previous.rows[0].public_token});return;
  }
  const existing=await db.query(`
   SELECT 1 FROM md_revolut_checkout_orders WHERE tenant_id=$1 AND source_object=$2
    AND source_record_id=$3 AND status='completed' LIMIT 1`,
   [who.tenant_id,s.recordObject,recordId]);
  if(existing.rows.length){res.status(409).json({error:'This record is already paid'});return;}
  const order=await merchant(who.tenant_id,c,'POST','api/orders',
   {amount,currency:s.currency,merchant_order_data:{reference:attemptKey}},attemptKey);
  if(typeof order.id!=='string'||!UUID.test(order.id)
    ||typeof order.token!=='string'||order.token.length<8||order.token.length>500)
   throw Error('Revolut order returned no usable checkout token');
  const {rows}=await db.query<{id:string;public_token:string}>(`
   INSERT INTO md_revolut_checkout_orders
     (tenant_id,credential_id,created_by,source_object,source_record_id,attempt_key,
      revolut_order_id,public_token,amount_minor,currency)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
   ON CONFLICT(tenant_id,created_by,attempt_key) DO UPDATE
    SET updated_at=md_revolut_checkout_orders.updated_at
    WHERE md_revolut_checkout_orders.source_record_id=EXCLUDED.source_record_id
     AND md_revolut_checkout_orders.source_object=EXCLUDED.source_object
     AND md_revolut_checkout_orders.amount_minor=EXCLUDED.amount_minor
     AND md_revolut_checkout_orders.currency=EXCLUDED.currency
   RETURNING id,public_token`,
   [who.tenant_id,c.id,who.user_id,s.recordObject,recordId,attemptKey,
    order.id,order.token,amount,s.currency]);
  if(!rows[0]){res.status(409).json({error:'Payment attempt does not match the record'});return;}
  res.status(201).json({id:rows[0].id,token:rows[0].public_token});
 }));
 app.get('/api/revolut/checkout/orders/:id',route(async(req,res)=>{
  const who=actor(req);if(!who)throw Error('Authentication required');
  if(!UUID.test(req.params.id)){res.status(400).json({error:'Invalid order ID'});return;}
  const {rows}=await db.query<{status:string;last_event:string|null}>(`
   SELECT status,last_event FROM md_revolut_checkout_orders
   WHERE tenant_id=$1 AND id=$2 AND created_by=$3`,
   [who.tenant_id,req.params.id,who.user_id]);
  if(!rows[0]){res.status(404).json({error:'Order not found'});return;}
  res.setHeader('Cache-Control','private, no-store');
  res.json({status:rows[0].status});
 }));
 app.post('/api/revolut/checkout/webhook/register',route(async(req,res)=>{
  const who=actor(req);if(!who)throw Error('Authentication required');
  await rbac.require(who.tenant_id,who.user_id,'NamedCredential','manage');
  await rbac.require(who.tenant_id,who.user_id,'WebhookSubscription','manage');
  const c=await connected(who.tenant_id);
  const host=req.get('host')??'';
  if(!/^[A-Za-z0-9.-]+(?::443)?$/.test(host)||host.includes('..')
    ||host.startsWith('localhost')||host.startsWith('127.'))
   {res.status(400).json({error:'A public HTTPS hostname is required for Revolut webhooks'});return;}
  // Existing registrations keep their signing secret active until the remote
  // registration and replacement secret have been successfully retrieved.
  const {rows:localRows}=await db.query<{id:string}>(`
   SELECT id FROM md_inbound_webhook_endpoints
   WHERE tenant_id=$1 AND credential_id=$2 LIMIT 1`,[who.tenant_id,c.id]);
  const existingId=localRows[0]?.id;
  const local=existingId?{webhookId:existingId}:
   await vault.configureWebhook(who.tenant_id,who.user_id,c.id,true,
    randomBytes(32).toString('hex'));
  const callbackUrl='https://'+host+'/api/inbound-webhooks/'+local.webhookId;
  try{
   // Revolut limits webhook registrations. Reuse the existing remote endpoint
   // rather than creating a duplicate every time an admin clicks reconnect.
   const list=await merchant(who.tenant_id,c,'GET','api/webhooks');
   const existing=Array.isArray(list.webhooks)
    ?list.webhooks.find((item:unknown)=>{
      const row=item&&typeof item==='object'?item as Record<string,unknown>:{};
      return row.url===callbackUrl&&typeof row.id==='string'&&UUID.test(row.id);
     }) as Record<string,unknown>|undefined:undefined;
   let registered:Record<string,unknown>;
   if(existing){
    const missing=EVENTS.some(event=>!Array.isArray(existing.events)||!existing.events.includes(event));
    registered=missing
     ?await merchant(who.tenant_id,c,'PATCH','api/webhooks/'+existing.id,{events:EVENTS})
     :await merchant(who.tenant_id,c,'GET','api/webhooks/'+existing.id);
   }else{
    registered=await merchant(who.tenant_id,c,'POST','api/webhooks',
     {url:callbackUrl,events:EVENTS});
   }
   if(typeof registered.signing_secret!=='string'||registered.signing_secret.length<16
     ||registered.signing_secret.length>512)throw Error('Revolut webhook signing secret missing');
   await vault.configureWebhook(who.tenant_id,who.user_id,c.id,true,registered.signing_secret);
   await db.query(`UPDATE md_inbound_webhook_endpoints SET provider='Revolut',
       updated_at=now() WHERE tenant_id=$1 AND id=$2 AND credential_id=$3`,
    [who.tenant_id,local.webhookId,c.id]);
   res.json({connected:true,callbackUrl});
  }catch(error){
   if(!existingId)await vault.configureWebhook(who.tenant_id,who.user_id,c.id,false);
   throw error;
  }
 }));
}
