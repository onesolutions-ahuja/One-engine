import {requireAvailableMetadataName} from './metadata-name-guard.js';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {NamedCredentialService} from './named-credential-service.js';
import type {IntegrationActivityWriter} from './integration-api-log.js';

type Actor={tenant_id:string;user_id:string};
type Authenticated=Request & {actor?:Actor;rawWebhookBody?:Buffer};
type Endpoint={tenant_id:string;id:string;api_name:string;flow_api:string|null;
 execution_user_id:string|null;created_by:string;credential_name:string|null;
 channel_id:string|null;channel_name:string|null;
 verify_token_digest:Buffer;signature_secret_ciphertext:Buffer;
 encryption_key_id:string;enabled:boolean;app_api:string|null;provider:string};
const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const handler=(fn:(req:Authenticated,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{
  void fn(req as Authenticated,res).catch(next);
 };
const digest=(value:string)=>createHash('sha256').update(value).digest();
const matches=(expected:Buffer,actual:Buffer)=>expected.length===actual.length&&timingSafeEqual(expected,actual);
/** Convert Meta's WhatsApp envelope into one Communication record per real inbound message. */
function whatsappMessages(payload:unknown,endpointId:string):Array<Record<string,unknown>> {
 if(!payload||typeof payload!=='object')return [];
 const root=payload as Record<string,unknown>;
 if(root.object!=='whatsapp_business_account'||!Array.isArray(root.entry))return [];
 const result:Array<Record<string,unknown>>=[];
 const now=new Date().toISOString();
 for(const rawEntry of root.entry){
  if(!rawEntry||typeof rawEntry!=='object')continue;
  const entry=rawEntry as Record<string,unknown>;
  if(!Array.isArray(entry.changes))continue;
  for(const rawChange of entry.changes){
   if(!rawChange||typeof rawChange!=='object')continue;
   const change=rawChange as Record<string,unknown>;
   if(!change.value||typeof change.value!=='object')continue;
   const value=change.value as Record<string,unknown>;
   const metadata=(value.metadata&&typeof value.metadata==='object'?value.metadata:{}) as Record<string,unknown>;
   const contacts=Array.isArray(value.contacts)?value.contacts:[];
   const contactByWaId=new Map<string,string>();
   for(const rawContact of contacts){
    if(!rawContact||typeof rawContact!=='object')continue;
    const contact=rawContact as Record<string,unknown>;
    const profile=(contact.profile&&typeof contact.profile==='object'?contact.profile:{}) as Record<string,unknown>;
    if(typeof contact.wa_id==='string'&&typeof profile.name==='string')contactByWaId.set(contact.wa_id,profile.name);
   }
   if(!Array.isArray(value.messages))continue;
   for(const rawMessage of value.messages){
    if(!rawMessage||typeof rawMessage!=='object')continue;
    const message=rawMessage as Record<string,unknown>;
    const messageId=typeof message.id==='string'?message.id:'';
    const sender=typeof message.from==='string'?message.from:'';
    const type=typeof message.type==='string'?message.type:'message';
    const details=(message[type]&&typeof message[type]==='object'?message[type]:{}) as Record<string,unknown>;
    let body:string;
    if(type==='text'&&typeof details.body==='string')body=details.body;
    else if(['image','video','document'].includes(type)&&typeof details.caption==='string')body=details.caption;
    else if(type==='interactive'){
     const button=(details.button_reply&&typeof details.button_reply==='object'?details.button_reply:{}) as Record<string,unknown>;
     const list=(details.list_reply&&typeof details.list_reply==='object'?details.list_reply:{}) as Record<string,unknown>;
     body=String(button.title??list.title??'WhatsApp interactive reply');
    }else if(type==='button')body=String(details.text??'WhatsApp button reply');
    else if(type==='location')body=[details.name,details.address,details.latitude,details.longitude].filter(x=>x!==undefined&&x!==null&&x!=='').join(', ')||'WhatsApp location';
    else if(type==='contacts')body='WhatsApp contact card';
    else body='WhatsApp '+type+' message';
    const unix=typeof message.timestamp==='string'?Number(message.timestamp):NaN;
    const receivedAt=Number.isFinite(unix)&&unix>0?new Date(unix*1000).toISOString():now;
    result.push({
     Name:'WhatsApp '+(messageId?messageId.slice(-24):'inbound message'),
     Channel:'WhatsApp',Direction:'Inbound',Status:'Received',
     Sender:sender?(contactByWaId.has(sender)?contactByWaId.get(sender)+' ('+sender+')':sender):'',
     Recipient:typeof metadata.display_phone_number==='string'?metadata.display_phone_number:'',
     PhoneNumberId:typeof metadata.phone_number_id==='string'?metadata.phone_number_id:undefined,
     WabaId:typeof entry.id==='string'?entry.id:undefined,
     Provider:'WhatsApp',Body:body.slice(0,10000),
     ExternalMessageId:messageId||undefined,ConversationId:sender||undefined,
     ReceivedAt:receivedAt,RelatedObject:'InboundWebhookEndpoint',RelatedRecordId:endpointId
    });
   }
  }
 }
 return result;
}

/** Delivery status callback is not a customer message; preserve provider IDs. */
function whatsappStatusEvents(payload:unknown,endpointId:string):Array<Record<string,unknown>>{
 if(!payload||typeof payload!=='object')return [];
 const root=payload as Record<string,unknown>;
 if(root.object!=='whatsapp_business_account'||!Array.isArray(root.entry))return [];
 const result:Array<Record<string,unknown>>=[];
 for(const rawEntry of root.entry){
  if(!rawEntry||typeof rawEntry!=='object')continue;
  const entry=rawEntry as Record<string,unknown>;
  if(!Array.isArray(entry.changes))continue;
  for(const rawChange of entry.changes){
   if(!rawChange||typeof rawChange!=='object')continue;
   const value=(rawChange as Record<string,unknown>).value;
   if(!value||typeof value!=='object')continue;
   const detail=value as Record<string,unknown>;
   if(!Array.isArray(detail.statuses))continue;
   const metadata=(detail.metadata&&typeof detail.metadata==='object'?detail.metadata:{}) as Record<string,unknown>;
   for(const rawStatus of detail.statuses){
    if(!rawStatus||typeof rawStatus!=='object')continue;
    const status=rawStatus as Record<string,unknown>;
    const originalId=typeof status.id==='string'?status.id:'';
    const state=typeof status.status==='string'?status.status:'unknown';
    const stamp=typeof status.timestamp==='string'?status.timestamp:'';
    const identity=createHash('sha256').update(JSON.stringify([endpointId,originalId,state,stamp])).digest('hex');
    const unix=Number(stamp);
    result.push({
     Name:'WhatsApp delivery status: '+state.slice(0,80),Channel:'WhatsApp',
     Sender:typeof metadata.display_phone_number==='string'?metadata.display_phone_number:'',
     Recipient:typeof status.recipient_id==='string'?status.recipient_id:'',
     PhoneNumberId:typeof metadata.phone_number_id==='string'?metadata.phone_number_id:undefined,
     WabaId:typeof entry.id==='string'?entry.id:undefined,
     ExternalMessageId:'wa-status-'+identity,ConversationId:originalId||undefined,
     ReceivedAt:Number.isFinite(unix)&&unix>0?new Date(unix*1000).toISOString():undefined,
     RelatedObject:'InboundWebhookEndpoint',RelatedRecordId:endpointId
    });
   }
  }
 }
 return result;
}

/** Only provider delivery metadata is mutable; the original message and audit stay intact. */
export async function applyWhatsAppDeliveryStatus(
 db:SqlPersistence,tenantId:string,messageId:string,providerStatus:string,stamp:string
):Promise<void>{
 const mapping:Record<string,{status:string;rank:number}>={
  sent:{status:'Sent',rank:1},delivered:{status:'Delivered',rank:2},
  read:{status:'Read',rank:3},failed:{status:'Failed',rank:0}
 };
 const next=mapping[providerStatus.toLowerCase()];
 if(!messageId||!next)return;
 const unix=Number(stamp);
 const eventAt=Number.isFinite(unix)&&unix>0
  ?new Date(unix*1000).toISOString():new Date().toISOString();
 await db.transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
   [tenantId,messageId]);
  const {rows}=await client.query<{id:string;status:string}>(`
   SELECT r.id,COALESCE(st.value_text,'Sent') AS status FROM md_records r
   JOIN md_record_values external_id ON external_id.tenant_id=r.tenant_id
    AND external_id.record_id=r.id AND external_id.object_api='Communication'
    AND external_id.field_api='ExternalMessageId'
   JOIN md_record_values direction ON direction.tenant_id=r.tenant_id
    AND direction.record_id=r.id AND direction.object_api='Communication'
    AND direction.field_api='Direction'
   LEFT JOIN md_record_values st ON st.tenant_id=r.tenant_id
    AND st.record_id=r.id AND st.object_api='Communication' AND st.field_api='Status'
   WHERE r.tenant_id=$1 AND r.object_api='Communication' AND r.is_deleted=false
    AND external_id.value_text=$2 AND direction.value_text='Outbound' LIMIT 1`,
   [tenantId,messageId]);
  const row=rows[0];
  // A callback can arrive before the outbound writer commits. The raw
  // webhook event remains durable for reconciliation; never invent a message.
  if(!row){
   // The webhook may precede the outbound Communication commit. Persist the
   // receipt for reconciliation by the central writer in the same tenant.
   await client.query(`
    INSERT INTO md_communication_pending_status
      (tenant_id,external_message_id,provider_status,provider_timestamp)
    VALUES($1,$2,$3,$4::timestamptz)
    ON CONFLICT(tenant_id,external_message_id,provider_status)
    DO UPDATE SET provider_timestamp=GREATEST(
      md_communication_pending_status.provider_timestamp,EXCLUDED.provider_timestamp)`,
    [tenantId,messageId,providerStatus.toLowerCase(),eventAt]);
   return;
  }
  const currentRank=Object.values(mapping).find(v=>v.status===row.status)?.rank??0;
  // A failed event must not override confirmed delivery/read, and stale
  // 'sent' callbacks must not downgrade a later provider receipt.
  if(row.status==='Failed'&&next.status!=='Failed')return;
  if(next.status==='Failed'&&currentRank>1)return;
  if(next.status===row.status||next.status!=='Failed'&&currentRank>=next.rank)return;
  await client.query("SELECT set_config('metadrive.communication_status_writer','on',true)");
  await client.query(`
   UPDATE md_record_values SET value_text=$3
   WHERE tenant_id=$1 AND record_id=$2 AND object_api='Communication'
    AND field_api='Status'`,[tenantId,row.id,next.status]);
  if(providerStatus.toLowerCase()==='delivered'){
   const updated=await client.query(`
    UPDATE md_record_values SET value_text=$3::text,value_datetime=$3::timestamptz
    WHERE tenant_id=$1 AND record_id=$2 AND object_api='Communication'
     AND field_api='DeliveredAt'`,[tenantId,row.id,eventAt]);
   if(!updated.rowCount)await client.query(`
    INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,value_text,value_datetime)
    VALUES($1,$2,'Communication','DeliveredAt',$3::text,$3::timestamptz)`,
    [tenantId,row.id,eventAt]);
  }
  await client.query("SELECT set_config('metadrive.communication_status_writer','off',true)");
  await client.query(`INSERT INTO md_security_events(tenant_id,action,details)
   VALUES($1,'communication.delivery_status',
    jsonb_build_object('recordId',$2::text,'status',$3::text,'providerMessageId',$4::text))`,
   [tenantId,row.id,next.status,messageId]);
 });
}

/** Idempotency guard for provider messages when an earlier multi-message webhook partially failed. */
async function hasInboundMessage(db:SqlPersistence,tenantId:string,externalMessageId:string):Promise<boolean>{
 const {rows}=await db.query<{id:string}>(
  `SELECT r.id FROM md_records r
   JOIN md_record_values message_id ON message_id.tenant_id=r.tenant_id
    AND message_id.record_id=r.id AND message_id.object_api=r.object_api
    AND message_id.field_api='ExternalMessageId'
   JOIN md_record_values related ON related.tenant_id=r.tenant_id
    AND related.record_id=r.id AND related.object_api=r.object_api
    AND related.field_api='RelatedObject'
   WHERE r.tenant_id=$1 AND r.object_api='Communication' AND r.is_deleted=false
    AND message_id.value_text=$2 AND related.value_text='InboundWebhookEndpoint'
   LIMIT 1`,[tenantId,externalMessageId]);
 return rows.length>0;
}

function publicUrl(req:Request,id:string){
 // Provider callbacks must be externally reachable over TLS. Render terminates TLS
 // at its edge, so Express may see the internal HTTP hop unless proxy trust is
 // explicitly configured. Never publish an HTTP callback URL to Meta.
 return 'https://'+req.get('host')+'/api/inbound-webhooks/'+encodeURIComponent(id);
}
export function registerInboundWebhookPublicRoutes(app:Express,db:SqlPersistence,
 vault:NamedCredentialService,flows:FlowRuntime,rbac:RbacEngine,records?:RecordEngine,
 activityWriter?:IntegrationActivityWriter){
 void records;
 const load=async(id:string):Promise<Endpoint|undefined>=>{
  if(!uuid.test(id))return undefined;
  const {rows}=await db.query<Endpoint>(`
   SELECT w.*,a.api_name AS app_api,c.name AS credential_name,
    (SELECT p.properties->>'channelId'
     FROM md_connector_app_credentials binding
     JOIN md_apps ca ON ca.id=binding.app_id AND ca.tenant_owner_id IS NULL
     JOIN md_app_installations installed ON installed.tenant_id=binding.tenant_id
       AND installed.app_id=binding.app_id
     JOIN md_system_definitions p ON p.tenant_id=binding.tenant_id
       AND p.kind='connector-providers' AND p.api_name=ca.api_name AND p.enabled=true
     WHERE binding.tenant_id=w.tenant_id AND binding.credential_id=w.credential_id
     LIMIT 1) AS channel_id,
    (SELECT p.properties->>'communicationChannel'
     FROM md_connector_app_credentials binding
     JOIN md_apps ca ON ca.id=binding.app_id AND ca.tenant_owner_id IS NULL
     JOIN md_app_installations installed ON installed.tenant_id=binding.tenant_id
       AND installed.app_id=binding.app_id
     JOIN md_system_definitions p ON p.tenant_id=binding.tenant_id
       AND p.kind='connector-providers' AND p.api_name=ca.api_name AND p.enabled=true
     WHERE binding.tenant_id=w.tenant_id AND binding.credential_id=w.credential_id
     LIMIT 1) AS channel_name
   FROM md_inbound_webhook_endpoints w
   LEFT JOIN md_apps a ON a.id=w.app_id AND a.enabled=true
   LEFT JOIN md_named_credentials c ON c.tenant_id=w.tenant_id AND c.id=w.credential_id
   WHERE w.id=$1 AND w.enabled=true
     AND (w.credential_id IS NULL OR (c.id IS NOT NULL AND c.enabled=true))
     AND (w.app_id IS NULL OR (a.id IS NOT NULL AND EXISTS (
       SELECT 1 FROM md_app_installations i WHERE i.tenant_id=w.tenant_id AND i.app_id=w.app_id
     ) AND EXISTS (
       SELECT 1 FROM md_app_entitlements e WHERE e.tenant_id=w.tenant_id
         AND e.app_id=w.app_id AND e.active=true
         AND (e.expires_at IS NULL OR e.expires_at>now())
     ))) LIMIT 1`,[id]);
  return rows[0];
 };
 app.get('/api/inbound-webhooks/:id',handler(async(req,res)=>{
  const requestStartedAt=Date.now();
  res.setHeader('Cache-Control','no-store');
  const endpoint=await load(req.params.id);
  if(endpoint&&!activityWriter){
   res.status(503).type('text/plain').send('Webhook communication logger unavailable');
   return;
  }
  const mode=req.query['hub.mode'],token=req.query['hub.verify_token'];
  const challenge=req.query['hub.challenge'];
  const valid=Boolean(endpoint&&['Meta','HmacSha256'].includes(endpoint.provider)
   &&mode==='subscribe'&&typeof token==='string'&&token.length<=512
   &&typeof challenge==='string'&&challenge.length<=1024
   &&matches(endpoint.verify_token_digest,digest(token)));
  if(endpoint)await activityWriter!({
   tenantId:endpoint.tenant_id,direction:'Inbound',transport:'Webhook',
   provider:endpoint.channel_id??endpoint.credential_name??endpoint.provider,
   actorUserId:endpoint.execution_user_id??endpoint.created_by,
   endpoint:'/api/inbound-webhooks/'+endpoint.api_name,method:'GET',statusCode:valid?200:403,outcome:valid?'success':'rejected',
   durationMs:Date.now()-requestStartedAt,responseBytes:valid?Buffer.byteLength(String(challenge)):0,
   errorCode:valid?null:'VERIFY_TOKEN_REJECTED',
   communication:{channel:'Other',name:'Webhook verification request',
    provider:endpoint.channel_id??endpoint.credential_name??endpoint.provider}
  });
  if(!valid){res.status(403).type('text/plain').send('Forbidden');return;}
  res.status(200).type('text/plain').send(challenge as string);
 }));
 app.post('/api/inbound-webhooks/:id',handler(async(req,res)=>{
  const requestStartedAt=Date.now();
  res.setHeader('Cache-Control','no-store');
  const endpoint=await load(req.params.id);
  // No external request is acknowledged without the central Communication writer.
  if(endpoint&&!activityWriter){
   res.status(503).json({error:'Webhook communication logger unavailable'});
   return;
  }
  const signature=req.get('x-hub-signature-256');
  const raw=req.rawWebhookBody;
  const logInbound=async(statusCode:number,outcome:'success'|'http_error'|'network_error'|'rejected',
   errorCode?:string)=>{
   if(!endpoint)return;
   await activityWriter!({
    tenantId:endpoint.tenant_id,direction:'Inbound',transport:'Webhook',
    provider:endpoint.channel_id??endpoint.credential_name??endpoint.provider,
    actorUserId:endpoint.execution_user_id??endpoint.created_by,
    endpoint:'/api/inbound-webhooks/'+endpoint.api_name,method:'POST',statusCode,outcome,durationMs:Date.now()-requestStartedAt,
    requestBytes:raw?.length??0,errorCode:errorCode??null,
    communication:{channel:'Other',
     name:outcome==='success'?'Webhook callback (no message)':'Webhook request rejected',
     provider:endpoint.channel_id??endpoint.credential_name??endpoint.provider}
   });
  };
  const reject=async(reason:string,rawBodyBytes?:number)=>{
   // Log only a bounded reason code and body length; never log signature, body, or secret.
   console.warn('Inbound webhook rejected',JSON.stringify({
    endpointId:req.params.id,reason,...(rawBodyBytes===undefined?{}:{rawBodyBytes})
   }));
   await logInbound(401,'rejected',reason.toUpperCase());
   res.status(401).json({error:'Webhook signature invalid'});
  };
  if(!endpoint){await reject('endpoint_unavailable');return;}
  if(!raw){await reject('raw_body_unavailable');return;}
  if(raw.length>262144){await reject('body_too_large',raw.length);return;}
  if(!signature){await reject('signature_missing',raw.length);return;}
  if(!/^sha256=[a-f0-9]{64}$/i.test(signature)){
   await reject('signature_format_invalid',raw.length);return;
  }
  const secret=vault.decryptOpaque(endpoint.signature_secret_ciphertext,endpoint.encryption_key_id);
  const signatureDigest=createHmac('sha256',secret).update(raw).digest();
  const supplied=Buffer.from(signature.slice(7),'hex');
  if(!matches(signatureDigest,supplied)){
   await reject('signature_mismatch',raw.length);return;
  }
  // Credential-linked webhooks are ingestion endpoints: persist Communication directly.
  // AceChatter reads Communication through its authorised Flows; it is not a webhook consumer.
  let flowAvailable=Boolean(endpoint.flow_api&&!endpoint.credential_name);
  if(flowAvailable&&endpoint.flow_api){
   const {rows:active}=await db.query(`
     SELECT 1 FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2
       AND active=true AND archived=false AND flow_type='Autolaunched Flow' LIMIT 1`,
     [endpoint.tenant_id,endpoint.flow_api]);
   if(!endpoint.execution_user_id||!active[0]||!await rbac.allowed(
      endpoint.tenant_id,endpoint.execution_user_id,'Flow:'+endpoint.flow_api,'execute')){
    await logInbound(503,'http_error','FLOW_UNAVAILABLE');
    res.status(503).json({error:'Webhook Flow not available'});return;
   }
  }
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)){
   await logInbound(400,'rejected','INVALID_PAYLOAD');
   res.status(400).json({error:'Invalid webhook payload'});return;
  }
  const payloadHash=createHash('sha256').update(raw).digest('hex');
  const {rows:events}=await db.query<{id:string;status:string}>(`
   INSERT INTO md_inbound_webhook_events(tenant_id,endpoint_id,payload,payload_hash)
   VALUES($1,$2,$3::jsonb,$4)
   ON CONFLICT(tenant_id,endpoint_id,payload_hash) DO UPDATE
     SET status=CASE WHEN md_inbound_webhook_events.status='failed' THEN 'received'
                     ELSE md_inbound_webhook_events.status END
   RETURNING id,status`,
   [endpoint.tenant_id,endpoint.id,JSON.stringify(req.body),payloadHash]);
  const event=events[0];
  if(!event){await logInbound(503,'http_error','EVENT_WRITE_FAILED');res.status(503).json({error:'Unable to accept webhook'});return;}
  // Replayed provider callbacks already have a persisted tenant event and
  // possibly a message. Do not turn a retry into an empty Communication.
  if(event.status==='completed'){res.status(200).json({received:true});return;}
  // The event payload is retained in tenant SQL. The central writer is independent
  // of any Flow; business Flows may run afterwards, but never create the audit record.
  let requestCommunicationRecorded=false;
  try{
   // Save the provider message before any optional legacy Flow work. A credential
   // webhook never executes AceChatterReceiveWebhook or any other app Flow.
   if(endpoint.credential_name){
    if(!activityWriter)throw new Error('Central Communication writer unavailable');
    const messages=whatsappMessages(req.body,endpoint.id);
    let writtenMessages=0;
    for(const values of messages){
     const externalMessageId=typeof values.ExternalMessageId==='string'?values.ExternalMessageId:'';
     if(externalMessageId&&await hasInboundMessage(db,endpoint.tenant_id,externalMessageId))continue;
     // A verified inbound message always enters the same central outbox.
     // Never write it through an app Flow or a direct RecordEngine bypass.
     await activityWriter({
       tenantId:endpoint.tenant_id,direction:'Inbound',transport:'Webhook',
       provider:endpoint.channel_id??endpoint.credential_name??endpoint.provider,
       actorUserId:endpoint.execution_user_id??endpoint.created_by,
       endpoint:'/api/inbound-webhooks/'+endpoint.api_name,method:'POST',
       statusCode:200,outcome:'success',durationMs:Date.now()-requestStartedAt,
       requestBytes:raw.length,responseBytes:Buffer.byteLength('{"received":true}'),
       communication:{
        channel:String(values.Channel??'WhatsApp'),name:String(values.Name??'WhatsApp inbound'),
        sender:String(values.Sender??''),recipient:String(values.Recipient??''),
        body:String(values.Body??''),provider:endpoint.channel_id??String(values.Provider??endpoint.provider),
        externalMessageId:externalMessageId||undefined,
        relatedObject:'InboundWebhookEndpoint',relatedRecordId:endpoint.id,
        conversationId:typeof values.ConversationId==='string'?values.ConversationId:undefined,
        phoneNumberId:typeof values.PhoneNumberId==='string'?values.PhoneNumberId:undefined,
        wabaId:typeof values.WabaId==='string'?values.WabaId:undefined,
        receivedAt:typeof values.ReceivedAt==='string'?values.ReceivedAt:undefined
       }
      });
     writtenMessages++;
    }
    // Delivery callbacks update the existing outbound message, not a new
    // Communication row. The signed raw payload is already retained in SQL.
    const statusEvents=whatsappStatusEvents(req.body,endpoint.id);
    for(const values of statusEvents){
     const originalId=typeof values.ConversationId==='string'?values.ConversationId:'';
     const state=String(values.Name??'').replace('WhatsApp delivery status: ','');
     const stamp=typeof values.ReceivedAt==='string'
      ?String(Math.floor(new Date(values.ReceivedAt).getTime()/1000)):'';
     await applyWhatsAppDeliveryStatus(db,endpoint.tenant_id,originalId,state,stamp);
    }
    requestCommunicationRecorded=writtenMessages>0||statusEvents.length>0;
    // Other non-message callbacks remain in the verified webhook event archive.
   }else if(flowAvailable&&endpoint.flow_api&&endpoint.execution_user_id){
    const json=raw.toString('utf8');
    await flows.execute(endpoint.tenant_id,endpoint.flow_api,endpoint.execution_user_id,{
     requestId:event.id,webhookEventId:event.id,webhookPayloadJson:json.length<=4096?json:'',
     webhookEndpoint:endpoint.api_name
    });
   }
   // Journal even non-message events before acknowledging the provider.
   if(!requestCommunicationRecorded)await logInbound(200,'success');
   await db.query(`UPDATE md_inbound_webhook_events SET status='completed',
     processed_at=now(),error_code=NULL WHERE tenant_id=$1 AND id=$2`,
    [endpoint.tenant_id,event.id]);
  res.status(200).json({received:true});
  }catch(error){
   // Provider-facing responses must not expose SQL details or credentials, but
   // operations need the PostgreSQL error code to diagnose failed callbacks.
   const cause=error && typeof error==='object'
    ? error as {code?:unknown;constraint?:unknown;table?:unknown;routine?:unknown}
    : {};
   console.error('Inbound webhook processing failed',{
    endpointId:endpoint.id,eventId:event.id,
    category:flowAvailable?'flow':'communication',
    postgresCode:typeof cause.code==='string'?cause.code:undefined,
    postgresConstraint:typeof cause.constraint==='string'?cause.constraint:undefined,
    postgresTable:typeof cause.table==='string'?cause.table:undefined,
    postgresRoutine:typeof cause.routine==='string'?cause.routine:undefined
   });
   await db.query(`UPDATE md_inbound_webhook_events SET status='failed',
     processed_at=now(),error_code=$3 WHERE tenant_id=$1 AND id=$2`,
    [endpoint.tenant_id,event.id,flowAvailable?'FLOW_EXECUTION_FAILED':'COMMUNICATION_WRITE_FAILED']);
   await logInbound(503,'http_error',flowAvailable?'FLOW_EXECUTION_FAILED':'COMMUNICATION_WRITE_FAILED');
   res.status(503).json({error:'Webhook processing unavailable'});
  }
 }));
}

export function registerInboundWebhookAdminRoutes(app:Express,db:SqlPersistence,
 vault:NamedCredentialService,rbac:RbacEngine){
 app.get('/api/metadata/inbound-webhooks/options',handler(async(req,res)=>{
  const actor=req.actor!;
  await rbac.require(actor.tenant_id,actor.user_id,'WebhookSubscription','manage');
  const [apps,flows,users]=await Promise.all([
   db.query<{api_name:string}>(`SELECT a.api_name FROM md_apps a
     JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
     JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1 AND e.active=true
     WHERE a.enabled=true AND (e.expires_at IS NULL OR e.expires_at>now())
     ORDER BY a.api_name`,[actor.tenant_id]),
   db.query<{api_name:string}>(`SELECT DISTINCT api_name FROM md_flow_definitions
      WHERE tenant_id=$1 AND active=true AND archived=false
        AND flow_type='Autolaunched Flow' ORDER BY api_name`,[actor.tenant_id]),
   db.query<{id:string;email:string}>(`SELECT id,email FROM md_users
      WHERE tenant_id=$1 ORDER BY email LIMIT 500`,[actor.tenant_id])
  ]);
  res.json({apps:apps.rows.map(a=>a.api_name),flows:flows.rows.map(f=>f.api_name),
    users:users.rows});
 }));
 app.get('/api/metadata/inbound-webhooks',handler(async(req,res)=>{
  const actor=req.actor!;
  await rbac.require(actor.tenant_id,actor.user_id,'WebhookSubscription','read');
  const {rows}=await db.query(`
   SELECT w.id,w.api_name AS "apiName",COALESCE(a.api_name,c.name) AS "appApiName",
    w.flow_api AS "flowApi",w.execution_user_id AS "executionUserId",
    w.enabled,w.provider,w.created_at AS "createdAt",
    (SELECT count(*)::int FROM md_inbound_webhook_events e
      WHERE e.tenant_id=w.tenant_id AND e.endpoint_id=w.id) AS "eventCount"
   FROM md_inbound_webhook_endpoints w
   LEFT JOIN md_apps a ON a.id=w.app_id
   LEFT JOIN md_named_credentials c ON c.tenant_id=w.tenant_id AND c.id=w.credential_id
   WHERE w.tenant_id=$1 ORDER BY w.api_name`,[actor.tenant_id]);
  res.json({endpoints:rows.map((x:Record<string,unknown>)=>({...x,
    callbackUrl:publicUrl(req,String(x.id)),hasVerifyToken:true,hasAppSecret:true}))});
 }));
 app.post('/api/metadata/inbound-webhooks',handler(async(req,res)=>{
  const actor=req.actor!;
  await rbac.require(actor.tenant_id,actor.user_id,'WebhookSubscription','manage');
  const body=req.body as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)
    ||typeof body.apiName!=='string'||!identifier.test(body.apiName)
    ||typeof body.appApiName!=='string'||!identifier.test(body.appApiName)
    ||typeof body.flowApi!=='string'||!identifier.test(body.flowApi)
    ||typeof body.executionUserId!=='string'||!uuid.test(body.executionUserId)
    ||typeof body.verifyToken!=='string'||body.verifyToken.length<24||body.verifyToken.length>512
    ||!['Meta','HmacSha256'].includes(String(body.provider??'Meta'))
    ||typeof body.appSecret!=='string'||body.appSecret.length<16||body.appSecret.length>512
    ||body.enabled!==undefined&&typeof body.enabled!=='boolean')
   {res.status(400).json({error:'Invalid webhook settings'});return;}
  const [{rows:apps},{rows:flow},{rows:users}]=await Promise.all([
   db.query<{id:string}>(`SELECT a.id FROM md_apps a
     JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
     JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1
     WHERE a.api_name=$2 AND a.enabled=true AND e.active=true
       AND (e.expires_at IS NULL OR e.expires_at>now())`,
      [actor.tenant_id,body.appApiName]),
   db.query(`SELECT 1 FROM md_flow_definitions
      WHERE tenant_id=$1 AND api_name=$2 AND active=true AND archived=false
      AND flow_type='Autolaunched Flow'`,[actor.tenant_id,body.flowApi]),
   db.query(`SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$2`,
      [actor.tenant_id,body.executionUserId])
  ]);
  if(!apps[0]||!flow[0]||!users[0]
    ||!await rbac.allowed(actor.tenant_id,String(body.executionUserId),
       'Flow:'+body.flowApi,'execute'))
    {res.status(403).json({error:'App, Flow, or execution identity unavailable'});return;}
  const secured=vault.encryptOpaque(body.appSecret);
  const endpointId=await db.transaction(async client=>{
   await requireAvailableMetadataName(client,actor.tenant_id,'inboundWebhook',String(body.apiName));
   const {rows}=await client.query<{id:string}>(`
    INSERT INTO md_inbound_webhook_endpoints
     (tenant_id,api_name,app_id,flow_api,execution_user_id,
      verify_token_digest,signature_secret_ciphertext,encryption_key_id,
      provider,enabled,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id`,[actor.tenant_id,body.apiName,apps[0].id,body.flowApi,
     body.executionUserId,digest(String(body.verifyToken)),secured.ciphertext,secured.keyId,
     body.provider??'Meta',body.enabled===true,actor.user_id]);
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,$2,'InboundWebhookCreated',$3::jsonb)`,
    [actor.tenant_id,actor.user_id,JSON.stringify({endpointId:rows[0].id,appApiName:body.appApiName,flowApi:body.flowApi})]);
   return rows[0].id;
  });
  res.status(201).json({id:endpointId,callbackUrl:publicUrl(req,endpointId)});
 }));
 app.patch('/api/metadata/inbound-webhooks/:id',handler(async(req,res)=>{
  const actor=req.actor!;
  await rbac.require(actor.tenant_id,actor.user_id,'WebhookSubscription','manage');
  if(!uuid.test(req.params.id)||typeof req.body?.enabled!=='boolean'){
   res.status(400).json({error:'Invalid webhook state'});return;
  }
  const {rows}=await db.query(`UPDATE md_inbound_webhook_endpoints
   SET enabled=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id`,
   [actor.tenant_id,req.params.id,req.body.enabled]);
  if(!rows[0]){res.status(404).json({error:'Webhook not found'});return;}
  await db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
   VALUES($1,$2,'InboundWebhookStatusChanged',$3::jsonb)`,
   [actor.tenant_id,actor.user_id,JSON.stringify({endpointId:req.params.id,enabled:req.body.enabled})]);
  res.json({enabled:req.body.enabled});
 }));
}
