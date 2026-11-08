import {randomUUID} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {PoolClient} from 'pg';
import {configureMailCommunicationRecording} from './mail-communication-recording.js';

export type IntegrationCommunicationDetails={
 channel?:string;
 name?:string;
 sender?:string;
 recipient?:string;
 subject?:string;
 body?:string;
 externalMessageId?:string;
 provider?:string;
 /** Preserve message relationships when one Communication also represents an API attempt. */
 relatedObject?:string;
 relatedRecordId?:string;
 conversationId?:string;
 /** Provider-issued identifiers; never substitute endpoint paths or credential names. */
 phoneNumberId?:string;
 wabaId?:string;
 receivedAt?:string;
 sentAt?:string;
};

export type IntegrationActivityInput={
 tenantId:string;
 direction:'Inbound'|'Outbound';
 transport?:'HTTP'|'Webhook'|'SMTP';
 provider?:string;
 credentialId?:string|null;
 actorUserId?:string|null;
 endpoint:string;
 method:string;
 statusCode?:number|null;
 outcome:'success'|'http_error'|'network_error'|'rejected';
 durationMs?:number;
 requestBytes?:number;
 responseBytes?:number;
 errorCode?:string|null;
 occurredAt?:string;
 /** Optional metadata-driven mapping for an actual message sent by this callout. */
 communication?:IntegrationCommunicationDetails;
};

export type IntegrationActivityWriter=(input:IntegrationActivityInput)=>Promise<void>;

const clean=(value:unknown,max=500):string=>
 String(value??'').replace(/[\r\n\0]/g,' ').trim().slice(0,max);
const cleanBody=(value:unknown):string=>String(value??'').replace(/\0/g,'').slice(0,10000);
const allowedChannels=new Set(['Email','SMS','WhatsApp','Phone','WebChat','Push','Other']);

function normalized(input:IntegrationActivityInput):IntegrationActivityInput{
 const method=/^(GET|POST|PUT|PATCH|DELETE|SMTP)$/.test(input.method.toUpperCase())
  ?input.method.toUpperCase():'OTHER';
 const endpoint=clean(input.endpoint.split(/[?#]/,1)[0],2048);
 const provider=clean(input.provider||'Unknown',120)||'Unknown';
 const statusCode=Number.isInteger(input.statusCode)&&Number(input.statusCode)>=100
  &&Number(input.statusCode)<=599?Number(input.statusCode):null;
 const errorCode=input.errorCode&&/^[A-Z0-9_:-]{1,100}$/i.test(input.errorCode)
  ?input.errorCode:null;
 return {...input,method,endpoint,provider,errorCode,
  statusCode,durationMs:Math.min(2147483647,Math.max(0,Math.floor(input.durationMs??0))),
  requestBytes:Math.min(2147483647,Math.max(0,Math.floor(input.requestBytes??0))),
  responseBytes:Math.min(2147483647,Math.max(0,Math.floor(input.responseBytes??0)))};
}

/** System-owned, append-only SQL persistence for external integration events.
 * The central runtime alone sets a transaction-local insert marker; ordinary
 * CRUD/Flows never create, edit or delete Communication. Tenant isolation is
 * enforced by SQL foreign keys and all queries remain tenant-scoped.
 * No user identity, licence, app installation or OneEngine write grant is needed.
 */
export type CommunicationCreatedHook=(client:PoolClient,tenantId:string,actorUserId:string,record:Record<string,unknown>)=>Promise<void>;
export function createIntegrationCommunicationWriter(db:SqlPersistence,_legacyRecords?:unknown,onCreated?:CommunicationCreatedHook):IntegrationActivityWriter{
 return async raw=>{
  const input=normalized(raw);
  const details=input.communication??{};
  const now=input.occurredAt??new Date().toISOString();
  const status=input.outcome==='success'
   ?input.direction==='Inbound'?'Received':'Sent':'Failed';
  const endpoint=clean(input.endpoint,2048);
  // Body is message content only, never a serialization of an integration event.
  // Technical activity has its own typed, queryable Communication fields.
  const body=details.body===undefined?undefined:cleanBody(details.body);
  // Subject contains the real message subject only; API outcome, HTTP method,
  // response code, duration and endpoint already have structured fields.
  const subject=details.subject?.trim()?clean(details.subject,500):undefined;
  const values:Record<string,string|undefined>={
   Name:clean(details.name||input.direction+' API - '+input.provider,500),
   Channel:allowedChannels.has(String(details.channel))?details.channel:'Other',
   Direction:input.direction,Status:status,
   Sender:clean(details.sender||(input.direction==='Outbound'?'MetaDrive':''),500),
   Recipient:clean(details.recipient,500),Subject:subject,Body:body,
   PhoneNumberId:details.phoneNumberId?clean(details.phoneNumberId,500):undefined,
   WabaId:details.wabaId?clean(details.wabaId,500):undefined,
   Transport:input.transport??'HTTP',Endpoint:endpoint,RequestMethod:input.method,
   ResponseStatusCode:input.statusCode==null?undefined:String(input.statusCode),
   Outcome:input.outcome,DurationMs:String(input.durationMs??0),
   RequestBytes:String(input.requestBytes??0),ResponseBytes:String(input.responseBytes??0),
   OccurredAt:now,
   ExternalMessageId:clean(details.externalMessageId||randomUUID(),500),
   Provider:clean(details.provider||input.provider,500),
   RelatedObject:clean(details.relatedObject||'IntegrationApiCall',120),
   RelatedRecordId:details.relatedRecordId??input.credentialId??undefined,
   ConversationId:details.conversationId,
   SentAt:details.sentAt??(input.direction==='Outbound'&&input.outcome==='success'?now:undefined),
   ReceivedAt:details.receivedAt??(input.direction==='Inbound'&&input.outcome==='success'?now:undefined),
   ErrorMessage:input.outcome==='success'?undefined:clean(input.errorCode||input.outcome,2000)
  };
  const fields=Object.entries(values).filter((entry):entry is [string,string]=>
   typeof entry[1]==='string');
  await db.transaction(async client=>{
   // Serialise identical provider IDs to close the outbox lease/crash race.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
    [input.tenantId,values.ExternalMessageId]);
   const {rows:existing}=await client.query<{id:string}>(`
    SELECT r.id FROM md_records r JOIN md_record_values v
     ON v.tenant_id=r.tenant_id AND v.record_id=r.id
     AND v.object_api=r.object_api AND v.field_api='ExternalMessageId'
    WHERE r.tenant_id=$1 AND r.object_api='Communication'
     AND r.is_deleted=false AND v.value_text=$2 LIMIT 1`,
    [input.tenantId,values.ExternalMessageId]);
   if(existing.length)return; // SQL-level idempotency across worker retries
   // The tenant has to exist; it never needs an enabled user/licence/RBAC.
   const {rows:tenant}=await client.query<{id:string}>(
    'SELECT id FROM md_tenants WHERE id=$1',[input.tenantId]);
   if(!tenant.length)throw new Error('COMMUNICATION_TENANT_MISSING');
   const {rows:configured}=await client.query<{api_name:string}>(`
    SELECT api_name FROM md_field_definitions
    WHERE tenant_id=$1 AND object_api='Communication'
     AND deleted_at IS NULL AND api_name=ANY($2::text[])`,
    [input.tenantId,fields.map(([name])=>name)]);
   if(configured.length!==fields.length)
    throw new Error('COMMUNICATION_FIELDS_MISSING');
   // Used only for this transaction. The SQL trigger blocks all normal app
   // CRUD and subsequent UPDATE/DELETE operations even by privileged users.
   await client.query("SELECT set_config('metadrive.communication_writer','on',true)");
   const {rows:created}=await client.query<{id:string}>(`
    INSERT INTO md_records(tenant_id,object_api,owner_id)
    VALUES($1,'Communication',NULL) RETURNING id`,[input.tenantId]);
   const recordId=created[0]?.id;
   if(!recordId)throw new Error('COMMUNICATION_RECORD_INSERT_FAILED');
   await client.query(`
    INSERT INTO md_record_values
     (tenant_id,record_id,object_api,field_api,value_text,value_datetime)
    SELECT $1::uuid,$2::uuid,'Communication',
     payload.field_api,payload.value_text,
     CASE WHEN payload.field_api IN ('SentAt','ReceivedAt','OccurredAt')
       THEN payload.value_text::timestamptz ELSE NULL END
    FROM unnest($3::text[],$4::text[]) AS payload(field_api,value_text)`,
    [input.tenantId,recordId,fields.map(([name])=>name),fields.map(([,value])=>value)]);
   // Reconcile signed provider receipts that arrived before this outbound
   // Communication was committed. Never create extra message records.
   if(input.direction==='Outbound'&&values.Channel==='WhatsApp'){
    const {rows:receipts}=await client.query<{provider_status:string;provider_timestamp:Date}>(`
     DELETE FROM md_communication_pending_status
     WHERE tenant_id=$1 AND external_message_id=$2
     RETURNING provider_status,provider_timestamp`,
     [input.tenantId,values.ExternalMessageId]);
    const rank=(v:string)=>v==='read'?3:v==='delivered'?2:v==='sent'?1:0;
    const best=receipts.slice().sort((a,b)=>rank(b.provider_status)-rank(a.provider_status))[0];
    if(best){
     const next=best.provider_status==='failed'?'Failed':
      best.provider_status==='read'?'Read':
      best.provider_status==='delivered'?'Delivered':'Sent';
     await client.query("SELECT set_config('metadrive.communication_status_writer','on',true)");
     await client.query(`UPDATE md_record_values SET value_text=$3
      WHERE tenant_id=$1 AND record_id=$2 AND object_api='Communication'
       AND field_api='Status'`,[input.tenantId,recordId,next]);
     const delivered=receipts.find(x=>x.provider_status==='delivered');
     if(delivered)await client.query(`INSERT INTO md_record_values
      (tenant_id,record_id,object_api,field_api,value_text,value_datetime)
      VALUES($1,$2,'Communication','DeliveredAt',$3::text,$3::timestamptz)`,
      [input.tenantId,recordId,new Date(delivered.provider_timestamp).toISOString()]);
     await client.query("SELECT set_config('metadrive.communication_status_writer','off',true)");
     await client.query(`INSERT INTO md_security_events(tenant_id,action,details)
      VALUES($1,'communication.delivery_status_reconciled',
       jsonb_build_object('recordId',$2::text,'status',$3::text))`,
      [input.tenantId,recordId,next]);
    }
   }
   // System-owned ingestion remains append-only. The optional generic Flow
   // trigger runs only after the complete inbound record has been persisted.
   // Booking or transport failures must not undo a verified inbound message.
   if(onCreated&&input.direction==='Inbound'&&input.actorUserId&&Boolean(body?.trim())){
    await client.query('SAVEPOINT communication_trigger');
    try{
     await onCreated(client,input.tenantId,input.actorUserId,{
      ...Object.fromEntries(fields),Id:recordId
     });
     await client.query('RELEASE SAVEPOINT communication_trigger');
    }catch{
     await client.query('ROLLBACK TO SAVEPOINT communication_trigger');
     await client.query('RELEASE SAVEPOINT communication_trigger');
     await client.query(
      "INSERT INTO md_security_events(tenant_id,action,details) VALUES($1,'communication.flow_trigger_failed',jsonb_build_object('recordId',$2::text))",
      [input.tenantId,recordId]);
    }
   }
  });
 };
}

type IntegrationOutboxRow={
 tenant_id:string;id:string;direction:IntegrationActivityInput['direction'];
 transport:NonNullable<IntegrationActivityInput['transport']>;provider:string;
 credential_id:string|null;actor_user_id:string|null;endpoint:string;method:string;
 status_code:number|null;outcome:IntegrationActivityInput['outcome'];duration_ms:number;
 request_bytes:number;response_bytes:number;error_code:string|null;channel:string;
 name:string;sender:string;recipient:string;subject:string|null;body:string|null;
 external_message_id:string;related_object:string;related_record_id:string|null;
 conversation_id:string|null;phone_number_id:string|null;waba_id:string|null;
 received_at:Date|string|null;sent_at:Date|string|null;
 occurred_at:Date|string;attempt_count:number
};

/** Durable handoff to the Communication Object. Failed record writes stay queued for worker retry. */
export class IntegrationCommunicationOutbox{
 constructor(private readonly db:SqlPersistence,private readonly writer:IntegrationActivityWriter){
  configureMailCommunicationRecording(db,this.write);
 }

 readonly write:IntegrationActivityWriter=async(raw)=>{
  const input=normalized(raw),id=randomUUID(),occurredAt=input.occurredAt??new Date().toISOString();
  const details=input.communication??{};
  const communication={
   channel:allowedChannels.has(String(details.channel))?String(details.channel):'Other',
   name:clean(details.name||input.direction+' API - '+input.provider,500),
   sender:clean(details.sender||(input.direction==='Outbound'?'MetaDrive':''),500),
   recipient:clean(details.recipient,500),
   phoneNumberId:details.phoneNumberId?clean(details.phoneNumberId,500):null,
   wabaId:details.wabaId?clean(details.wabaId,500):null,
   subject:details.subject===undefined?null:clean(details.subject,500),
   body:details.body===undefined?null:cleanBody(details.body),
   externalMessageId:clean(details.externalMessageId||id,500),
   provider:clean(details.provider||input.provider,500),
   relatedObject:clean(details.relatedObject||'IntegrationApiCall',120),
   relatedRecordId:details.relatedRecordId??input.credentialId??null,
   conversationId:details.conversationId===undefined?null:clean(details.conversationId,500),
   receivedAt:details.receivedAt??null,sentAt:details.sentAt??null
  };
  await this.db.query(`INSERT INTO md_communication_delivery_outbox
   (tenant_id,id,direction,transport,provider,credential_id,actor_user_id,endpoint,method,
    status_code,outcome,duration_ms,request_bytes,response_bytes,error_code,channel,name,
    sender,recipient,subject,body,external_message_id,related_object,related_record_id,
    conversation_id,received_at,sent_at,occurred_at,phone_number_id,waba_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24,$25,$26::timestamptz,$27::timestamptz,$28::timestamptz,$29,$30)`,
   [input.tenantId,id,input.direction,input.transport??'HTTP',input.provider,
    input.credentialId??null,input.actorUserId??null,input.endpoint,input.method,
    input.statusCode,input.outcome,input.durationMs,input.requestBytes,input.responseBytes,
    input.errorCode,communication.channel,communication.name,communication.sender,
    communication.recipient,communication.subject,communication.body,
    communication.externalMessageId,communication.relatedObject,communication.relatedRecordId,
    communication.conversationId,communication.receivedAt,communication.sentAt,occurredAt,
    communication.phoneNumberId,communication.wabaId]);
  await this.dispatchById(id);
 };

 async dispatchOne():Promise<boolean>{
  const row=await this.claim();
  if(!row)return false;
  await this.deliver(row);
  return true;
 }

 private async dispatchById(id:string):Promise<void>{
  const row=await this.claim(id);
  if(row)await this.deliver(row);
 }

 private async claim(id?:string):Promise<IntegrationOutboxRow|undefined>{
  const {rows}=await this.db.query<IntegrationOutboxRow>(`
   WITH candidate AS(
    SELECT tenant_id,id FROM md_communication_delivery_outbox
    WHERE ($1::uuid IS NULL OR id=$1)
     AND ((status='pending' AND next_attempt_at<=now())
       OR (status='processing' AND claimed_at<now()-interval '5 minutes'))
    ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
   )
   UPDATE md_communication_delivery_outbox o
   SET status='processing',attempt_count=o.attempt_count+1,claimed_at=now()
   FROM candidate c WHERE o.tenant_id=c.tenant_id AND o.id=c.id
   RETURNING o.*`,[id??null]);
  return rows[0];
 }

 private async deliver(row:IntegrationOutboxRow):Promise<void>{
  try{
   const {rows:existing}=await this.db.query<{id:string}>(`
    SELECT r.id FROM md_records r
    JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id
     AND v.object_api=r.object_api AND v.field_api='ExternalMessageId'
    WHERE r.tenant_id=$1 AND r.object_api='Communication' AND r.is_deleted=false
     AND v.value_text=$2 LIMIT 1`,[row.tenant_id,row.external_message_id]);
   if(!existing[0]){
    await this.writer({
     tenantId:row.tenant_id,direction:row.direction,transport:row.transport,
     provider:row.provider,credentialId:row.credential_id,actorUserId:row.actor_user_id,
     endpoint:row.endpoint,method:row.method,statusCode:row.status_code,
     outcome:row.outcome,durationMs:row.duration_ms,requestBytes:row.request_bytes,
     responseBytes:row.response_bytes,errorCode:row.error_code,
     occurredAt:new Date(row.occurred_at).toISOString(),
     communication:{channel:row.channel,name:row.name,sender:row.sender,
      recipient:row.recipient,subject:row.subject??undefined,body:row.body??undefined,
      externalMessageId:row.external_message_id,provider:row.provider,
      relatedObject:row.related_object,relatedRecordId:row.related_record_id??undefined,
      conversationId:row.conversation_id??undefined,
      phoneNumberId:row.phone_number_id??undefined,wabaId:row.waba_id??undefined,
      receivedAt:row.received_at?new Date(row.received_at).toISOString():undefined,
      sentAt:row.sent_at?new Date(row.sent_at).toISOString():undefined}
    });
   }
   await this.db.query(`DELETE FROM md_communication_delivery_outbox
    WHERE tenant_id=$1 AND id=$2 AND status='processing'`,[row.tenant_id,row.id]);
  }catch(error){
   // Persist safe SQLSTATE or fixed system codes, never request bodies or secrets.
   const sqlState=(error as {code?:unknown})?.code;
   const errorCode=typeof sqlState==='string'&&/^[0-9A-Z]{5}$/.test(sqlState)
    ?'PG_'+sqlState
    :error instanceof Error&&/^COMMUNICATION_[A-Z_]+$/.test(error.message)
     ?error.message:error instanceof Error?error.name:'UnknownError';
   await this.db.query(`UPDATE md_communication_delivery_outbox
    SET status='pending',claimed_at=NULL,last_error=$3,
     next_attempt_at=now()+(LEAST(3600,power(2,LEAST(attempt_count,12))::integer)
       * interval '1 second')
    WHERE tenant_id=$1 AND id=$2 AND status='processing'`,
    [row.tenant_id,row.id,errorCode]);
   console.error('Integration Communication outbox delivery deferred',JSON.stringify({
    transport:row.transport,attempt:row.attempt_count,error:errorCode
   }));
  }
 }
}

/** Best-effort audit writer: logging failure must never change the external provider result.
 * Failures remain visible in sanitized server diagnostics for alerting and recovery.
 */
export async function writeIntegrationActivity(
 _db:SqlPersistence,input:IntegrationActivityInput,writer?:IntegrationActivityWriter
):Promise<void>{
 if(!writer){
  console.error('Integration Communication write failed',JSON.stringify({
   direction:input.direction,transport:input.transport??'HTTP',error:'WriterNotConfigured'
  }));
  return;
 }
 try{
  await writer(normalized(input));
 }catch(error){
  // Do not include endpoint, credentials, request data, or provider error text in diagnostics.
  console.error('Integration Communication write failed',JSON.stringify({
   direction:input.direction,transport:input.transport??'HTTP',
   error:error instanceof Error?error.name:'UnknownError'
  }));
 }
}
