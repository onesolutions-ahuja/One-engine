import type {Express,NextFunction,Request,Response} from 'express';
import type {PoolClient} from 'pg';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/**
 * Live changes: every open page keeps one stream (GET /api/live-changes, server-sent
 * events). The database tells this server the moment a record is saved (a trigger on
 * md_records NOTIFYs at commit, whatever wrote it: a page, a Flow, an import, the API),
 * and the server passes the Object and record Ids on to the screens of that tenant that
 * may read the Object, WITH the saved rows: each user's rows are read as that user
 * (record sharing and field permissions apply), so a screen draws the change at once
 * without asking again. Deletes send Ids only; very large saves send Ids for a re-read.
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
CREATE OR REPLACE FUNCTION md_live_page_changes() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 PERFORM pg_notify('md_live_changes',json_build_object('k','page','t',NEW.tenant_id,
  'a',(SELECT api_name FROM md_page_definitions WHERE tenant_id=NEW.tenant_id AND id=NEW.page_id),
  'v',NEW.variant,'d',NEW.draft_version,'p',NEW.published_version)::text);
 RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS md_live_page_layout ON md_page_layout_heads;
CREATE TRIGGER md_live_page_layout AFTER INSERT OR UPDATE OF draft_version,published_version ON md_page_layout_heads
 FOR EACH ROW EXECUTE FUNCTION md_live_page_changes();
DROP TRIGGER IF EXISTS md_live_screen_device ON md_screen_devices;
CREATE TRIGGER md_live_screen_device AFTER INSERT OR UPDATE OF session_key,page_layers ON md_screen_devices
 FOR EACH ROW EXECUTE FUNCTION md_live_screen_changes();
`;

type Actor={tenant_id:string;user_id:string};
export type LiveMessage={k:'record';t:string;o:string;n:number;ids:string[];op:string}|{k:'screen';t:string;d:string}
 |{k:'page';t:string;a:string|null;v:string;d:number|null;p:number|null};
type Subscriber={userId:string;send:(event:string,data:unknown)=>void;readable:Map<string,{ok:boolean;at:number}>};
type Row=Record<string,unknown>;
/** Reads saved rows as one user (the normal record API: sharing and field permissions). */
export type LiveRowReader=(tenant:string,user:string,object:string,ids:readonly string[])=>Promise<Row[]>;
export function recordRowReader(records:Pick<RecordEngine,'list'>):LiveRowReader{
 return async(tenant,user,object,ids)=>{
  const page=await records.list(tenant,user,object,ids.length,0,{filters:[{field:'Id',operator:'in',value:[...ids]}]}) as {records:Row[]};
  return page.records;
 };
}

const READ_CACHE_MS=60_000;
const HEARTBEAT_MS=20_000;
const MAX_STREAMS_PER_USER=20;

export class LiveChangeHub{
 private readonly tenants=new Map<string,Set<Subscriber>>();
 private listener:PoolClient|null=null;
 private stopped=false;
 constructor(private readonly db:SqlPersistence,private readonly rbac:Pick<RbacEngine,'allowed'>,
  private readonly readRows?:LiveRowReader){}

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
   client.on('error',()=>retry());
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
 /** Page Builder co-editing: pass a designer's live edits (or presence) to the tenant's
  * other designers who may read pages. Not stored: Save stores. */
 async pageEdit(actor:Actor,edit:Record<string,unknown>):Promise<number>{
  const subscribers=this.tenants.get(actor.tenant_id);
  if(!subscribers?.size)return 0;
  let sent=0;
  await Promise.all([...subscribers].map(async subscriber=>{
   if(await this.canRead(actor.tenant_id,subscriber,'PageDefinition')){subscriber.send('page-edit',edit);sent++;}
  }));
  return sent;
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
  if(message.k==='page'){
   // A page layout was saved or published: Page Builders (co-design) and open pages hear it.
   if(!message.a)return;
   const page={page:message.a,variant:message.v,draft:message.d,published:message.p};
   for(const subscriber of subscribers)void this.canRead(message.t,subscriber,'PageDefinition')
    .then(ok=>{if(ok)subscriber.send('page',page);}).catch(()=>undefined);
   return;
  }
  const change={object:message.o,ids:message.ids??[],count:message.n,operation:message.op};
  // Rows go with the change when every saved row is named (not a bulk save) and it is not a delete.
  const withRows=Boolean(this.readRows)&&change.operation!=='delete'&&change.ids.length>0&&change.count<=change.ids.length;
  const byUser=new Map<string,Subscriber[]>();
  for(const subscriber of subscribers)byUser.set(subscriber.userId,[...byUser.get(subscriber.userId)??[],subscriber]);
  for(const [user,list] of byUser)void this.sendTo(message.t,user,list,change,withRows).catch(()=>undefined);
 }
 /** One read per user (not per screen): the user's own view of the saved rows. */
 private async sendTo(tenant:string,user:string,list:Subscriber[],change:{object:string;ids:string[];count:number;operation:string},withRows:boolean){
  if(!await this.canRead(tenant,list[0],change.object))return;
  let rows:Row[]|undefined;
  if(withRows){
   try{rows=await this.readRows!(tenant,user,change.object,change.ids);}catch{rows=undefined;}
  }
  for(const subscriber of list)subscriber.send('change',rows?{...change,rows}:change);
 }
 private async canRead(tenant:string,subscriber:Subscriber,object:string):Promise<boolean>{
  const cached=subscriber.readable.get(object);
  if(cached&&Date.now()-cached.at<READ_CACHE_MS)return cached.ok;
  const ok=await this.rbac.allowed(tenant,subscriber.userId,object,'read').catch(()=>false);
  subscriber.readable.set(object,{ok,at:Date.now()});
  return ok;
 }
}

const pageName=/^[A-Za-z][A-Za-z0-9_]{0,79}$/,clientPattern=/^[A-Za-z0-9-]{8,64}$/;
/** A designer's live edit, checked: page, layout, client, at most 200 components and 500 removals. */
export function readPageEdit(body:unknown):Record<string,unknown>{
 const raw=(body&&typeof body==='object'&&!Array.isArray(body)?body:{}) as Record<string,unknown>;
 if(typeof raw.page!=='string'||!pageName.test(raw.page))throw Error('Choose the page');
 if(!['Mobile','Desktop','Tablet','Custom'].includes(String(raw.variant)))throw Error('Choose the layout');
 if(typeof raw.clientId!=='string'||!clientPattern.test(raw.clientId))throw Error('Invalid editor');
 const ops=(raw.ops&&typeof raw.ops==='object'&&!Array.isArray(raw.ops)?raw.ops:{}) as Record<string,unknown>;
 const upsert=Array.isArray(ops.upsert)?ops.upsert:[];
 const remove=Array.isArray(ops.remove)?ops.remove:[];
 if(upsert.length>200||remove.length>500||upsert.some(item=>!item||typeof item!=='object'||typeof (item as {id?:unknown}).id!=='string')
  ||remove.some(id=>typeof id!=='string'))throw Error('Invalid page edit');
 const selection=Array.isArray(raw.selection)?raw.selection.filter((id):id is string=>typeof id==='string').slice(0,50):[];
 return {page:raw.page,variant:raw.variant,clientId:raw.clientId,ops:{upsert,remove},selection};
}

export function registerLiveChangeRoutes(app:Express,hub:LiveChangeHub,rbac?:Pick<RbacEngine,'require'>,
 nameOf?:(actor:Actor)=>Promise<string>){
 // Page Builder co-editing: live edits and presence between designers (not saved).
 app.post('/api/page-edits',(req:Request,res:Response,next:NextFunction)=>{
  const actor=(req as Request&{actor?:Actor}).actor;
  void (async()=>{
   if(!actor?.tenant_id||!actor.user_id)throw Object.assign(Error('Authenticated tenant required'),{status:401});
   await rbac?.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
   const edit=readPageEdit(req.body);
   const name=nameOf?await nameOf(actor).catch(()=>''):'';
   res.json({sent:await hub.pageEdit(actor,{...edit,user:actor.user_id,name})});
  })().catch(next);
 });
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
