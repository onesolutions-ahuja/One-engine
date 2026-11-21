import type {Express,NextFunction,Request,Response} from 'express';
import type {PoolClient} from 'pg';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/**
 * Live changes: every open page keeps one stream (GET /api/live-changes, server-sent
 * events). The database tells this server the moment a record is saved (a trigger on
 * md_records NOTIFYs at commit, whatever wrote it: a page, a Flow, an import, the API),
 * and the server passes the Object and record Ids on to the screens of that tenant that
 * may read the Object. Screens then re-read only what they show, through the normal
 * permission-checked record API, so no record data travels on the stream.
 * Paired screens also hear when the device they follow changes sale or layer.
 */
export const LIVE_CHANGES_DDL=`
CREATE OR REPLACE FUNCTION md_live_record_changes() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE item record;
BEGIN
 FOR item IN
  SELECT tenant_id,object_api,count(*) AS n,(array_agg(id ORDER BY id))[1:40] AS ids FROM changed_rows GROUP BY tenant_id,object_api
 LOOP
  PERFORM pg_notify('md_live_changes',json_build_object('k','record','t',item.tenant_id,'o',item.object_api,
   'n',item.n,'ids',item.ids,'op',lower(TG_OP))::text);
 END LOOP;
 RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS md_live_record_insert ON md_records;
CREATE TRIGGER md_live_record_insert AFTER INSERT ON md_records REFERENCING NEW TABLE AS changed_rows
 FOR EACH STATEMENT EXECUTE FUNCTION md_live_record_changes();
DROP TRIGGER IF EXISTS md_live_record_update ON md_records;
CREATE TRIGGER md_live_record_update AFTER UPDATE ON md_records REFERENCING NEW TABLE AS changed_rows
 FOR EACH STATEMENT EXECUTE FUNCTION md_live_record_changes();
DROP TRIGGER IF EXISTS md_live_record_delete ON md_records;
CREATE TRIGGER md_live_record_delete AFTER DELETE ON md_records REFERENCING OLD TABLE AS changed_rows
 FOR EACH STATEMENT EXECUTE FUNCTION md_live_record_changes();
CREATE OR REPLACE FUNCTION md_live_screen_changes() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 PERFORM pg_notify('md_live_changes',json_build_object('k','screen','t',NEW.tenant_id,'d',NEW.device_key)::text);
 RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS md_live_screen_device ON md_screen_devices;
CREATE TRIGGER md_live_screen_device AFTER INSERT OR UPDATE OF session_key,page_layers ON md_screen_devices
 FOR EACH ROW EXECUTE FUNCTION md_live_screen_changes();
`;

type Actor={tenant_id:string;user_id:string};
export type LiveMessage={k:'record';t:string;o:string;n:number;ids:string[];op:string}|{k:'screen';t:string;d:string};
type Subscriber={userId:string;send:(event:string,data:unknown)=>void;readable:Map<string,{ok:boolean;at:number}>};

const READ_CACHE_MS=60_000;
const HEARTBEAT_MS=20_000;
const MAX_STREAMS_PER_USER=20;

export class LiveChangeHub{
 private readonly tenants=new Map<string,Set<Subscriber>>();
 private listener:PoolClient|null=null;
 private stopped=false;
 constructor(private readonly db:SqlPersistence,private readonly rbac:Pick<RbacEngine,'allowed'>){}

 /** Listen to the database; reconnects by itself if the connection drops. */
 async start():Promise<void>{
  if(this.stopped||this.listener)return;
  try{
   const client=await this.db.pool.connect();
   this.listener=client;
   client.on('notification',message=>{
    if(message.channel!=='md_live_changes'||!message.payload)return;
    try{this.dispatch(JSON.parse(message.payload) as LiveMessage);}catch{/* a malformed notice is dropped */}
   });
   const retry=()=>{
    if(this.listener!==client)return;
    this.listener=null;
    try{client.release(true);}catch{/* already gone */}
    // Screens resync (reload what they show) when they reconnect after this.
    for(const subscribers of this.tenants.values())for(const subscriber of subscribers)subscriber.send('resync',{});
    if(!this.stopped)setTimeout(()=>void this.start(),2000);
   };
   client.on('error',retry);
   client.on('end',retry);
   await client.query('LISTEN md_live_changes');
  }catch(error){
   console.error('Live changes: database listen failed',error);
   this.listener=null;
   if(!this.stopped)setTimeout(()=>void this.start(),5000);
  }
 }
 async stop():Promise<void>{
  this.stopped=true;
  const client=this.listener;this.listener=null;
  if(client){try{await client.query('UNLISTEN *');}catch{/* closing */}client.release(true);}
 }
 subscribe(actor:Actor,send:Subscriber['send']):()=>void{
  const subscribers=this.tenants.get(actor.tenant_id)??new Set<Subscriber>();
  if([...subscribers].filter(item=>item.userId===actor.user_id).length>=MAX_STREAMS_PER_USER)
   throw Object.assign(Error('Too many live connections for this user'),{status:429});
  const subscriber:Subscriber={userId:actor.user_id,send,readable:new Map()};
  // The database is listened to from the first screen that connects.
  void this.start();
  subscribers.add(subscriber);this.tenants.set(actor.tenant_id,subscribers);
  return ()=>{subscribers.delete(subscriber);if(!subscribers.size)this.tenants.delete(actor.tenant_id);};
 }
 /** How many screens are connected now (diagnostics and tests). */
 count(tenant?:string):number{
  return tenant?this.tenants.get(tenant)?.size??0:[...this.tenants.values()].reduce((total,set)=>total+set.size,0);
 }
 /** Pass one database notice on to the tenant's screens that may read it. */
 dispatch(message:LiveMessage):void{
  const subscribers=this.tenants.get(message.t);
  if(!subscribers?.size)return;
  if(message.k==='screen'){
   for(const subscriber of subscribers)subscriber.send('screen',{device:message.d});
   return;
  }
  const change={object:message.o,ids:message.ids??[],count:message.n,operation:message.op};
  for(const subscriber of subscribers)void this.canRead(message.t,subscriber,message.o)
   .then(ok=>{if(ok)subscriber.send('change',change);}).catch(()=>undefined);
 }
 private async canRead(tenant:string,subscriber:Subscriber,object:string):Promise<boolean>{
  const cached=subscriber.readable.get(object);
  if(cached&&Date.now()-cached.at<READ_CACHE_MS)return cached.ok;
  const ok=await this.rbac.allowed(tenant,subscriber.userId,object,'read').catch(()=>false);
  subscriber.readable.set(object,{ok,at:Date.now()});
  return ok;
 }
}

export function registerLiveChangeRoutes(app:Express,hub:LiveChangeHub){
 app.get('/api/live-changes',(req:Request,res:Response,next:NextFunction)=>{
  const actor=(req as Request&{actor?:Actor}).actor;
  if(!actor?.tenant_id||!actor.user_id){next(Object.assign(Error('Authenticated tenant required'),{status:401}));return;}
  let unsubscribe:()=>void;
  const write=(text:string)=>{try{res.write(text);}catch{/* closed */}};
  try{
   unsubscribe=hub.subscribe(actor,(event,data)=>write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));
  }catch(error){next(error);return;}
  res.status(200);
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform, private');
  res.setHeader('Connection','keep-alive');
  // Proxies (Nginx, load balancers) must pass each event on at once, not hold it.
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders();
  write('event: ready\ndata: {}\n\n');
  const heartbeat=setInterval(()=>write(': keepalive\n\n'),HEARTBEAT_MS);
  res.once('close',()=>{clearInterval(heartbeat);unsubscribe();});
 });
}
