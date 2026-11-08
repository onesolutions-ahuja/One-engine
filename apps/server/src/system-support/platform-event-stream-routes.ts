import type {Express,NextFunction,Request,Response} from 'express';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

type Actor={tenant_id:string;user_id:string};
type StreamRequest=Request<Record<string,string>>&{actor?:Actor};
const eventApi=/^[A-Za-z][A-Za-z0-9_]*$/;

export function parsePlatformEventReplayId(raw:unknown):string {
 if(raw===undefined)return '-1';
 if(typeof raw!=='string'||!(/^(?:-1|-2|0|[1-9][0-9]*)$/).test(raw))
  throw new Error('Invalid Platform Event replay ID');
 if(raw.length>19||raw.length===19&&BigInt(raw)>9223372036854775807n)
  throw new Error('Invalid Platform Event replay ID');
 return raw;
}

function route(handler:(req:StreamRequest,res:Response)=>Promise<void>){
 return (req:Request,res:Response,next:NextFunction)=>{
  void handler(req as StreamRequest,res).catch(next);
 };
}

async function readPlatformEventBatch(db:SqlPersistence,tenantId:string,eventApiName:string,cursor:string,limit=100){
 const {rows}=await db.query<{replay_id:string;id:string;published_at:Date;payload:Record<string,unknown>}>(`
     SELECT m.replay_id::text,m.id,m.published_at,
      COALESCE(jsonb_object_agg(v.field_api,
       CASE v.value_kind
        WHEN 'number' THEN to_jsonb(v.value_text::numeric)
        WHEN 'boolean' THEN to_jsonb(v.value_text::boolean)
        WHEN 'null' THEN 'null'::jsonb
        ELSE to_jsonb(v.value_text)
       END) FILTER(WHERE v.field_api IS NOT NULL),'{}'::jsonb) AS payload
     FROM md_platform_event_messages m
     LEFT JOIN md_platform_event_values v
       ON v.tenant_id=m.tenant_id AND v.event_id=m.id
     WHERE m.tenant_id=$1 AND m.event_api_name=$2 AND m.replay_id>$3::bigint
     GROUP BY m.tenant_id,m.id ORDER BY m.replay_id LIMIT $4`,
     [tenantId,eventApiName,cursor,limit]);
 return rows;
}

export function registerPlatformEventStreamRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 app.get('/api/platform-event-feed/:eventApiName',route(async(req,res)=>{
  const actor=req.actor,eventApiName=req.params.eventApiName;
  if(!actor?.tenant_id||!actor.user_id)throw new Error('Authenticated tenant required');
  if(!eventApi.test(eventApiName))throw new Error('Invalid Platform Event name');
  await rbac.require(actor.tenant_id,actor.user_id,'PlatformEvent:'+eventApiName,'subscribe');
  const {rows:definitions}=await db.query<{api_name:string}>(`
    SELECT api_name FROM md_system_definitions
    WHERE tenant_id=$1 AND kind='platform-events' AND api_name=$2 AND enabled=true`,
    [actor.tenant_id,eventApiName]);
  if(!definitions[0])throw new Error('Platform Event is not enabled');
  const requested=req.query.after??'latest';
  if(typeof requested!=='string')throw new Error('Invalid event cursor');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Vary','Authorization, Cookie');
  if(requested==='latest'){
   const {rows}=await db.query<{cursor:string}>(`
     SELECT COALESCE(max(replay_id),0)::text AS cursor
     FROM md_platform_event_messages WHERE tenant_id=$1 AND event_api_name=$2`,
     [actor.tenant_id,eventApiName]);
   res.json({cursor:rows[0]?.cursor??'0',events:[]});
   return;
  }
  const cursor=parsePlatformEventReplayId(requested);
  if(cursor.startsWith('-'))throw new Error('Event cursor must be non-negative');
  const events=await readPlatformEventBatch(db,actor.tenant_id,eventApiName,cursor,40);
  res.json({cursor:events.at(-1)?.replay_id??cursor,events:events.map(event=>({
    replayId:event.replay_id,eventId:event.id,payload:event.payload
  }))});
 }));
 app.get(['/services/data/v1.0/event-stream/:eventApiName','/api/platform-event-stream/:eventApiName'],route(async(req,res)=>{
  const actor=req.actor;
  const eventApiName=req.params.eventApiName;
  if(!actor?.tenant_id||!actor.user_id)throw new Error('Authenticated tenant required');
  if(!eventApi.test(eventApiName))throw new Error('Invalid Platform Event name');
  await rbac.require(actor.tenant_id,actor.user_id,'PlatformEvent:'+eventApiName,'subscribe');
  const {rows:definitions}=await db.query<{api_name:string}>(`
   SELECT api_name FROM md_system_definitions
   WHERE tenant_id=$1 AND kind='platform-events' AND api_name=$2 AND enabled=true`,
   [actor.tenant_id,eventApiName]);
  if(!definitions[0])throw new Error('Platform Event is not enabled');

  const requestedReplayId=parsePlatformEventReplayId(req.query.replayId);
  const {rows:latest}=await db.query<{replay_id:string}>(`
   SELECT COALESCE(max(replay_id),0)::text AS replay_id
   FROM md_platform_event_messages WHERE tenant_id=$1 AND event_api_name=$2`,
   [actor.tenant_id,eventApiName]);
  let cursor=requestedReplayId==='-1'?latest[0]?.replay_id??'0':
   requestedReplayId==='-2'?'0':requestedReplayId;
  let closed=false;
  let heartbeat=Date.now();
  res.status(200);
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  res.once('close',()=>{closed=true;});

  while(!closed){
   try{
    const rows=await readPlatformEventBatch(db,actor.tenant_id,eventApiName,cursor);
    for(const event of rows){
     cursor=event.replay_id;
     if(!res.write(`id: ${event.replay_id}\nevent: ${eventApiName}\ndata: ${JSON.stringify({
      eventApiName,eventId:event.id,createdDate:new Date(event.published_at).toISOString(),
      replayId:event.replay_id,payload:event.payload
     })}\n\n`))await new Promise<void>(resolve=>res.once('drain',resolve));
    }
    if(closed)break;
    if(Date.now()-heartbeat>=15000){
     res.write(': keepalive\n\n');
     heartbeat=Date.now();
    }
    await new Promise(resolve=>setTimeout(resolve,rows.length?0:500));
   }catch(error){
    console.error('Platform Event stream failed',error);
    if(!res.headersSent)throw error;
    res.write('event: error\ndata: {"error":"Platform Event stream failed"}\n\n');
    res.end();
    closed=true;
   }
  }
 }));
}
