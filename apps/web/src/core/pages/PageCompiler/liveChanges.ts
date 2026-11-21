/**
 * Live changes from the server: one stream per browser window (GET /api/live-changes),
 * shared by every page in it. The server says which Object (and record Ids) was saved,
 * by anyone, a moment after it is saved; pages re-read only what they show.
 * Reconnects by itself; after a reconnect every listener gets a resync (anything may
 * have changed while the stream was down).
 */
/** `rows`: the saved rows as this user may see them (none for deletes and bulk saves).
 * An Id in `ids` but not in `rows` was deleted or is no longer visible to this user. */
export type LiveChange={object:string;ids:readonly string[];count:number;operation:string;rows?:ReadonlyArray<Record<string,unknown>>};
/** A page layout was saved (draft) or published, by anyone (Page Builder co-design). */
export type LivePage={page:string;variant:string;draft:number|null;published:number|null};
/** Another designer's live edit or presence on a page layout (Page Builder co-editing). */
export type LivePageEdit={page:string;variant:string;clientId:string;name:string;selection:string[];
 ops:{upsert:Array<{id:string}&Record<string,unknown>>;remove:string[]}};
/** A tap on another screen of this login: its predicted record changes ('preview'), then the
 * save's answer ('settled': the saved rows, or ok false when nothing was saved). `batch` names
 * the tap: its predicted new rows carry provisional Ids of that batch. */
export type LiveTapChange={objectApiName:string;operation:'create'|'update'|'delete';record:Record<string,unknown>};
export type LiveTap={batch:string;ok:boolean;changes:LiveTapChange[]};
export type LiveEvent={kind:'change';change:LiveChange}|{kind:'screen';device:string}|{kind:'page';page:LivePage}
 |{kind:'page-edit';edit:LivePageEdit}|{kind:'preview';tap:LiveTap}|{kind:'settled';tap:LiveTap}|{kind:'resync'};
type Listener=(event:LiveEvent)=>void;

const listeners=new Set<Listener>();
let controller:AbortController|null=null;
let connected=false;
/** Failed tries in a row: the next try waits RETRY_STEPS_MS[failures] (quick at first). */
let failures=0;
/** The stream was down since the page started listening: the next 'ready' resyncs. */
let missed=false;
let retryTimer:ReturnType<typeof setTimeout>|null=null;
/** A dropped stream (server restart, proxy timeout, too many streams for a moment) is
 * opened again almost at once, then less often while the server stays unreachable. */
export const RETRY_STEPS_MS=[250,500,1000,2000,4000,8000,15_000] as const;
/** How the stream is opened: the signed-in API by default (tests pass a fake server). */
type Opener=(signal:AbortSignal)=>Promise<Response>;
let opener:Opener|null=null;
export function setLiveStreamOpener(next:Opener|null):void{opener=next;}
/** Wait before the next try: quick at first, with a little jitter so many screens
 * sharing one login do not all knock at the same moment. */
export function liveRetryDelay(failed:number,random=Math.random):number{
 const base=RETRY_STEPS_MS[Math.min(Math.max(failed,1),RETRY_STEPS_MS.length)-1];
 return Math.round(base*(0.8+0.4*random()));
}
const OWN_WRITE_MS=3_000;
/** Records this window saved a moment ago: it already shows them, so their echo is skipped. */
const ownWrites=new Map<string,number>();

/** Taps made in this window: their preview and answer come back on the stream and are skipped. */
const ownBatches=new Set<string>();
export function noteOwnBatch(batch:string):void{
 ownBatches.add(batch);
 if(ownBatches.size>200)ownBatches.delete(ownBatches.values().next().value as string);
}
export const isOwnBatch=(batch:string):boolean=>ownBatches.has(batch);
const tapChanges=(value:unknown):LiveTapChange[]=>Array.isArray(value)?value.filter((item):item is LiveTapChange=>{
 if(!item||typeof item!=='object')return false;
 const change=item as Record<string,unknown>;
 return typeof change.objectApiName==='string'&&['create','update','delete'].includes(String(change.operation))
  &&Boolean(change.record)&&typeof change.record==='object'&&!Array.isArray(change.record)
  &&typeof (change.record as {Id?:unknown}).Id==='string';
}):[];

export function isLiveConnected():boolean{return connected;}
/** Note records this window just saved (their live echo needs no re-read here). */
export function noteOwnWrites(ids:readonly unknown[]):void{
 const now=Date.now();
 for(const id of ids)if(typeof id==='string'&&id)ownWrites.set(id,now);
 if(ownWrites.size>500)for(const [id,at] of ownWrites)if(now-at>OWN_WRITE_MS)ownWrites.delete(id);
}
/** True when every record of the change was saved by this window just now. */
export function isOwnEcho(change:LiveChange,now=Date.now()):boolean{
 if(!change.ids.length||change.count>change.ids.length)return false;
 return change.ids.every(id=>{const at=ownWrites.get(id);return at!==undefined&&now-at<=OWN_WRITE_MS;});
}

/** Splits the text/event-stream into events; a frame is used only once it is complete. */
export class LiveFrameParser{
 private pending='';
 constructor(private readonly push:(event:LiveEvent|{kind:'ready'})=>void){}
 append(part:string):void{
  this.pending+=part.replace(/\r\n/g,'\n');
  if(this.pending.length>262144)throw Error('Live change frame too large');
  for(let boundary=this.pending.indexOf('\n\n');boundary>=0;boundary=this.pending.indexOf('\n\n')){
   const frame=this.pending.slice(0,boundary);
   this.pending=this.pending.slice(boundary+2);
   const lines=frame.split('\n');
   const name=lines.find(line=>line.startsWith('event:'))?.slice(6).trim();
   const text=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
   if(!name)continue;
   let data:Record<string,unknown>={};
   try{data=text?JSON.parse(text):{};}catch{continue;}
   if(name==='ready')this.push({kind:'ready'});
   else if(name==='resync')this.push({kind:'resync'});
   else if(name==='screen'&&typeof data.device==='string')this.push({kind:'screen',device:data.device});
   else if(name==='page-edit'&&typeof data.page==='string'&&typeof data.clientId==='string'){
    const ops=(data.ops??{}) as {upsert?:unknown;remove?:unknown};
    this.push({kind:'page-edit',edit:{page:data.page,variant:String(data.variant??''),clientId:data.clientId,name:String(data.name??''),
     selection:Array.isArray(data.selection)?data.selection.filter((id):id is string=>typeof id==='string'):[],
     ops:{upsert:Array.isArray(ops.upsert)?ops.upsert.filter((item):item is {id:string}=>Boolean(item)&&typeof (item as {id?:unknown}).id==='string'):[],
      remove:Array.isArray(ops.remove)?ops.remove.filter((id):id is string=>typeof id==='string'):[]}}});
   }
   else if(name==='page'&&typeof data.page==='string')this.push({kind:'page',page:{page:data.page,variant:String(data.variant??''),
    draft:typeof data.draft==='number'?data.draft:null,published:typeof data.published==='number'?data.published:null}});
   else if((name==='preview'||name==='settled')&&typeof data.batch==='string'&&/^[0-9a-f]{8}$/.test(data.batch)){
    const tap={batch:data.batch,ok:name==='preview'||data.ok===true,changes:tapChanges(data.changes)};
    this.push(name==='preview'?{kind:'preview',tap}:{kind:'settled',tap});
   }
   else if(name==='change'&&typeof data.object==='string')this.push({kind:'change',change:{
    object:data.object,ids:Array.isArray(data.ids)?data.ids.filter((id):id is string=>typeof id==='string'):[],
    count:typeof data.count==='number'?data.count:0,operation:String(data.operation??''),
    ...(Array.isArray(data.rows)?{rows:data.rows.filter((row):row is Record<string,unknown>=>Boolean(row)&&typeof row==='object'&&!Array.isArray(row))}:{})}});
  }
 }
}

const emit=(event:LiveEvent)=>{for(const listener of [...listeners]){try{listener(event);}catch{/* one page's error stays there */}}};

async function connect():Promise<void>{
 if(controller||!listeners.size)return;
 const current=new AbortController();
 controller=current;
 let wasConnected=false;
 try{
  const open=opener??(async(signal:AbortSignal)=>(await import('../../authentication/Client/authClient')).apiStream('/live-changes',signal));
  const response=await open(current.signal);
  if(!response.ok)throw Error('Live changes unavailable (HTTP '+response.status+')');
  if(!response.body)throw Error('Live changes have no body');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  const parser=new LiveFrameParser(event=>{
   if(event.kind==='ready'){
    wasConnected=true;
    const resumed=missed;
    connected=true;failures=0;missed=false;
    // Back after a drop or a failed try: anything may have changed meanwhile.
    if(resumed)emit({kind:'resync'});
    return;
   }
   if(event.kind==='change'&&isOwnEcho(event.change))return;
   if((event.kind==='preview'||event.kind==='settled')&&isOwnBatch(event.tap.batch))return;
   emit(event);
  });
  try{
   while(!current.signal.aborted){
    const chunk=await reader.read();
    if(chunk.done)break;
    parser.append(decoder.decode(chunk.value,{stream:true}));
   }
  }finally{await reader.cancel().catch(()=>undefined);}
 }catch{/* reconnect below */}
 finally{
  if(controller===current)controller=null;
  connected=false;
  if(!current.signal.aborted&&listeners.size){
   // Changes made while the stream is down are read again once it is back.
   missed=true;
   // A stream that was up comes back at once (first step); failed tries wait longer each time.
   failures=wasConnected?1:failures+1;
   retryTimer=setTimeout(()=>{retryTimer=null;void connect();},liveRetryDelay(failures));
  }
 }
}

/** Listen to live changes; the stream opens with the first listener and closes after the last. */
export function subscribeLiveChanges(listener:Listener):()=>void{
 listeners.add(listener);
 if(opener||typeof window!=='undefined'&&typeof fetch==='function')void connect();
 return ()=>{
  listeners.delete(listener);
  if(!listeners.size){
   if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
   controller?.abort();controller=null;connected=false;failures=0;missed=false;
  }
 };
}
