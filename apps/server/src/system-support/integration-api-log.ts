import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

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

export type CommunicationCreatedHook=(
 client:PoolClient,tenantId:string,actorUserId:string,record:Record<string,unknown>
)=>Promise<void>;

// TODO(native): Integration API logging is switched off until native storage replaces EAV.
// Keep these signatures so unrelated HTTP providers, OAuth and mail routes continue to work.
export function createIntegrationCommunicationWriter(
 _db:SqlPersistence,_legacyRecords?:unknown,_onCreated?:CommunicationCreatedHook
):IntegrationActivityWriter{
 return async()=>{};
}

export class IntegrationCommunicationOutbox{
 constructor(_db:SqlPersistence,_writer:IntegrationActivityWriter){}
 readonly write:IntegrationActivityWriter=async()=>{};
 async dispatchOne():Promise<boolean>{return false;}
}

export async function writeIntegrationActivity(
 _db:SqlPersistence,_input:IntegrationActivityInput,_writer?:IntegrationActivityWriter
):Promise<void>{
 return;
}
