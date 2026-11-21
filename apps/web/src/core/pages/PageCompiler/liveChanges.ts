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
export type LiveEvent={kind:'change';change:LiveChange}|{kind:'screen';device:string}|{kind:'page';page:LivePage}|{kind:'resync'};
type Listener=(event:LiveEvent)=>void;

const listeners=new Set<Listener>();
let controller:AbortController|null=null;
let connected=false;
let retryMs=1000;
let retryTimer:ReturnType<typeof setTimeout>|null=null;
const MAX_RETRY_MS=15_000;
const OWN_WRITE_MS=3_000;
/** Records this window saved a moment ago: it already shows them, so their echo is skipped. */
const ownWrites=new Map<string,number>();

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
   else if(name==='page'&&typeof data.page==='string')this.push({kind:'page',page:{page:data.page,variant:String(data.variant??''),
    draft:typeof data.draft==='number'?data.draft:null,published:typeof data.published==='number'?data.published:null}});
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
  const {apiStream}=await import('../../authentication/Client/authClient');
  const response=await apiStream('/live-changes',current.signal);
  if(!response.body)throw Error('Live changes have no body');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  const parser=new LiveFrameParser(event=>{
   if(event.kind==='ready'){
    wasConnected=true;
    const resumed=retryMs>1000;
    connected=true;retryMs=1000;
    // Back after a drop: anything may have changed meanwhile.
    if(resumed)emit({kind:'resync'});
    return;
   }
   if(event.kind==='change'&&isOwnEcho(event.change))return;
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
   if(!wasConnected)retryMs=Math.min(retryMs*2,MAX_RETRY_MS);else retryMs=2000;
   retryTimer=setTimeout(()=>{retryTimer=null;void connect();},retryMs);
  }
 }
}

/** Listen to live changes; the stream opens with the first listener and closes after the last. */
export function subscribeLiveChanges(listener:Listener):()=>void{
 listeners.add(listener);
 if(typeof window!=='undefined'&&typeof fetch==='function')void connect();
 return ()=>{
  listeners.delete(listener);
  if(!listeners.size){
   if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
   controller?.abort();controller=null;connected=false;
  }
 };
}
