import {createHash} from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';

/**
 * Provider webhooks (PayPal, SumUp, Square, Dojo, Revolut...) arrive at the URL shown on the
 * connector's Named Credential: /api/inbound-webhooks/{endpoint id}. Each one becomes an
 * IncomingWebhook record, so builders react with no code: a record-triggered Flow, or a
 * formula such as GETRECORD(IncomingWebhook, Reference, order.Id, AS(hook)).
 * A webhook is only a notice: confirm money with the provider (CALLOUT ...CheckStatus)
 * before completing a sale. Repeated deliveries of the same body are stored once.
 */
type Json=Record<string,unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(value:unknown):Json=>value&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};
const text=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value).slice(0,255):'';
/** First non-blank value among common provider field names. */
export function webhookSummary(payload:unknown){
 const root=object(payload),resource=object(root.resource),data=object(root.data),
  dataObject=object(object(data.object)[Object.keys(object(data.object))[0]??'']),payloadData=object(root.payload);
 const pick=(...values:unknown[])=>values.map(text).find(Boolean)??'';
 return {
  eventType:pick(root.event_type,root.event,root.type,root.eventType,root.event_name),
  reference:pick(resource.id,root.order_id,data.client_transaction_id,data.id,dataObject.id,
   payloadData.id,root.client_transaction_id,root.id),
  status:pick(resource.status,data.status,dataObject.status,payloadData.status,root.status,root.state)
 };
}

export function registerInboundWebhookRoutes(app:Express,db:SqlPersistence,records:RecordEngine){
 const route=(fn:(req:Request,res:Response)=>Promise<void>)=>
  (req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
 app.post('/api/inbound-webhooks/:id',route(async(req,res)=>{
  const id=req.params.id;
  if(!UUID.test(id)){res.status(404).json({error:'Unknown webhook'});return;}
  const {rows}=await db.query<{tenant_id:string;created_by:string;connector:string|null}>(`
   SELECT w.tenant_id,w.created_by,a.api_name AS connector
   FROM md_inbound_webhook_endpoints w
   LEFT JOIN md_connector_app_credentials b ON b.tenant_id=w.tenant_id AND b.credential_id=w.credential_id
   LEFT JOIN md_apps a ON a.id=b.app_id
   WHERE w.id=$1 AND w.enabled=true LIMIT 1`,[id]);
  const endpoint=rows[0];
  if(!endpoint){res.status(404).json({error:'Unknown webhook'});return;}
  const payload=req.body&&typeof req.body==='object'?req.body:{};
  const serialized=JSON.stringify(payload);
  if(serialized.length>65536){res.status(413).json({error:'Webhook too large'});return;}
  const hash=createHash('sha256').update(serialized).digest('hex');
  const {rows:inserted}=await db.query<{id:string}>(`
   INSERT INTO md_inbound_webhook_events(tenant_id,endpoint_id,payload,payload_hash,status)
   VALUES($1,$2,$3::jsonb,$4,'received')
   ON CONFLICT(tenant_id,endpoint_id,payload_hash) DO NOTHING RETURNING id`,
   [endpoint.tenant_id,id,serialized,hash]);
  // A provider retry of the same notice is acknowledged without a second record.
  if(!inserted[0]){res.status(200).json({received:true,duplicate:true});return;}
  const summary=webhookSummary(payload);
  const connector=(endpoint.connector??'').replace(/Connector$/,'');
  try{
   await records.create(endpoint.tenant_id,endpoint.created_by,'IncomingWebhook',{
    Name:(connector||'Webhook')+' '+(summary.eventType||'event'),Connector:connector,
    EventType:summary.eventType,Reference:summary.reference,Status:summary.status,
    ProcessingStatus:'New',ReceivedAt:new Date().toISOString(),Payload:serialized.slice(0,32000)});
   await db.query(`UPDATE md_inbound_webhook_events SET status='completed',processed_at=now()
    WHERE tenant_id=$1 AND id=$2`,[endpoint.tenant_id,inserted[0].id]);
  }catch{
   await db.query(`UPDATE md_inbound_webhook_events SET status='failed',error_code='RECORD_CREATE_FAILED',
    processed_at=now() WHERE tenant_id=$1 AND id=$2`,[endpoint.tenant_id,inserted[0].id]);
  }
  // Always acknowledge a stored notice so the provider does not retry forever.
  res.status(200).json({received:true});
 }));
}
