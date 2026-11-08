import {requireAvailableMetadataName} from './metadata-name-guard.js';
import type {Express,NextFunction,Request,Response} from 'express';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

type Actor={tenant_id:string;user_id:string};
type WebhookRequest=Request<Record<string,string>>&{actor?:Actor};
type WebhookDraft={apiName:string;eventApiName:string;namedCredentialId:string;
 relativePath:string;enabled:boolean};
const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function route(handler:(req:WebhookRequest,res:Response)=>Promise<void>){
 return (req:Request,res:Response,next:NextFunction)=>{
  void handler(req as WebhookRequest,res).catch(next);
 };
}

function parseDraft(raw:unknown):WebhookDraft{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid webhook subscription');
 const value=raw as Record<string,unknown>;
 if(typeof value.apiName!=='string'||!identifier.test(value.apiName)
  ||typeof value.eventApiName!=='string'||!identifier.test(value.eventApiName)
  ||typeof value.namedCredentialId!=='string'||!uuid.test(value.namedCredentialId)
  ||typeof value.relativePath!=='string'||!value.relativePath
  ||value.relativePath.length>2048||value.relativePath.startsWith('/')
  ||value.relativePath.includes('\\')||/[#\r\n]/.test(value.relativePath)
  ||value.enabled!==undefined&&typeof value.enabled!=='boolean')
  throw new Error('Invalid webhook subscription');
 return {apiName:value.apiName,eventApiName:value.eventApiName,
  namedCredentialId:value.namedCredentialId,relativePath:value.relativePath,
  enabled:value.enabled!==false};
}

export class OutboundWebhookService {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}

 async list(tenantId:string,userId:string){
  await this.rbac.require(tenantId,userId,'WebhookSubscription','read');
  const {rows}=await this.db.query<{
   id:string;api_name:string;event_api_name:string;credential_id:string;
   credential_name:string;relative_path:string;enabled:boolean;start_replay_id:string;
   created_at:Date;updated_at:Date
  }>(`
   SELECT s.id,s.api_name,s.event_api_name,s.credential_id,c.name AS credential_name,
    s.relative_path,s.enabled,s.start_replay_id::text,s.created_at,s.updated_at
   FROM md_webhook_subscriptions s
   JOIN md_named_credentials c ON c.tenant_id=s.tenant_id AND c.id=s.credential_id
   WHERE s.tenant_id=$1 ORDER BY s.api_name`,[tenantId]);
  return rows.map(row=>({id:row.id,apiName:row.api_name,eventApiName:row.event_api_name,
   namedCredentialId:row.credential_id,namedCredentialName:row.credential_name,
   relativePath:row.relative_path,enabled:row.enabled,startReplayId:row.start_replay_id,
   createdAt:row.created_at,updatedAt:row.updated_at}));
 }

 async save(tenantId:string,userId:string,raw:unknown,expectedName?:string){
  await this.rbac.require(tenantId,userId,'WebhookSubscription','manage');
  const draft=parseDraft(raw);
  if(expectedName!==undefined&&expectedName!==draft.apiName)
   throw new Error('Invalid webhook subscription identity');
  const [{rows:events},{rows:credentials},{rows:existing}]=await Promise.all([
   this.db.query(`SELECT 1 FROM md_system_definitions
    WHERE tenant_id=$1 AND kind='platform-events' AND api_name=$2 AND enabled=true`,
    [tenantId,draft.eventApiName]),
   this.db.query(`SELECT 1 FROM md_named_credentials
    WHERE tenant_id=$1 AND id=$2 AND protocol='HTTPS' AND enabled=true`,
    [tenantId,draft.namedCredentialId]),
   this.db.query<{id:string;event_api_name:string;start_replay_id:string;
    pending_deliveries:string}>(`
    SELECT s.id,s.event_api_name,s.start_replay_id::text,
     (SELECT count(*)::text FROM md_webhook_deliveries x
      WHERE x.tenant_id=s.tenant_id AND x.subscription_id=s.id AND x.status='queued')
      AS pending_deliveries
    FROM md_webhook_subscriptions s
    WHERE s.tenant_id=$1 AND s.api_name=$2`,[tenantId,draft.apiName])
  ]);
  if(!events[0])throw new Error('Webhook Platform Event is unavailable');
  if(!credentials[0])throw new Error('Webhook HTTPS Named Credential is unavailable');
  if(existing[0]){
   if(Number(existing[0].pending_deliveries)>0)
    throw new Error('Cannot update a webhook while deliveries are queued');
   const startReplayId=existing[0].event_api_name===draft.eventApiName
    ?existing[0].start_replay_id:undefined;
   const {rows}=await this.db.query<{id:string}>(`
    UPDATE md_webhook_subscriptions SET event_api_name=$3,credential_id=$4,
     relative_path=$5,enabled=$6,
     start_replay_id=COALESCE($7::bigint,
      (SELECT COALESCE(max(replay_id),0)+1 FROM md_platform_event_messages WHERE tenant_id=$1)),
     updated_at=now()
    WHERE tenant_id=$1 AND id=$2 RETURNING id`,
    [tenantId,existing[0].id,draft.eventApiName,draft.namedCredentialId,
     draft.relativePath,draft.enabled,startReplayId??null]);
   if(!rows[0])throw new Error('Webhook subscription update failed');
  }else{
   await this.db.transaction(async client=>{
    await requireAvailableMetadataName(client,tenantId,'outboundWebhook',draft.apiName);
    const {rows:latest}=await client.query<{replay_id:string}>(`
     SELECT COALESCE(max(replay_id),0)::text AS replay_id
     FROM md_platform_event_messages WHERE tenant_id=$1`,[tenantId]);
    const startReplayId=(BigInt(latest[0]?.replay_id??'0')+1n).toString();
    await client.query(`
     INSERT INTO md_webhook_subscriptions
      (tenant_id,api_name,event_api_name,credential_id,relative_path,
       start_replay_id,enabled,created_by)
     VALUES($1,$2,$3,$4,$5,$6::bigint,$7,$8)`,
     [tenantId,draft.apiName,draft.eventApiName,draft.namedCredentialId,
      draft.relativePath,startReplayId,draft.enabled,userId]);
   });
  }
  return (await this.list(tenantId,userId)).find(item=>item.apiName===draft.apiName);
 }

 async disable(tenantId:string,userId:string,apiName:string){
  await this.rbac.require(tenantId,userId,'WebhookSubscription','manage');
  if(!identifier.test(apiName))throw new Error('Invalid webhook subscription name');
  const {rowCount}=await this.db.query(`
   UPDATE md_webhook_subscriptions SET enabled=false,updated_at=now()
   WHERE tenant_id=$1 AND api_name=$2 AND enabled=true`,[tenantId,apiName]);
  if(!rowCount)throw new Error('Enabled webhook subscription not found');
 }
}

export function registerOutboundWebhookRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 const service=new OutboundWebhookService(db,rbac);
 app.get('/api/metadata/webhooks',route(async(req,res)=>{
  const actor=req.actor;
  if(!actor)throw new Error('Authenticated tenant required');
  res.json({webhooks:await service.list(actor.tenant_id,actor.user_id)});
 }));
 app.post('/api/metadata/webhooks',route(async(req,res)=>{
  const actor=req.actor;
  if(!actor)throw new Error('Authenticated tenant required');
  res.status(201).json({webhook:await service.save(actor.tenant_id,actor.user_id,req.body)});
 }));
 app.put('/api/metadata/webhooks/:apiName',route(async(req,res)=>{
  const actor=req.actor;
  if(!actor)throw new Error('Authenticated tenant required');
  res.json({webhook:await service.save(actor.tenant_id,actor.user_id,req.body,req.params.apiName)});
 }));
 app.delete('/api/metadata/webhooks/:apiName',route(async(req,res)=>{
  const actor=req.actor;
  if(!actor)throw new Error('Authenticated tenant required');
  await service.disable(actor.tenant_id,actor.user_id,req.params.apiName);
  res.status(204).end();
 }));
}
