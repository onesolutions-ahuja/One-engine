export type PlatformEventMessage={replayId:string;eventId:string;payload:Record<string,unknown>};

/** Bounded incremental SSE decoder. Event messages are delivered only when complete. */
export class PlatformEventFrameParser {
 private pending='';
 constructor(private readonly push:(message:PlatformEventMessage)=>void){}
 append(part:string):void {
  this.pending+=part.replace(/\r\n/g,'\n');
  if(this.pending.length>131072)throw new Error('Event stream frame exceeds limit');
  for(let boundary=this.pending.indexOf('\n\n');boundary>=0;boundary=this.pending.indexOf('\n\n')){
   const frame=this.pending.slice(0,boundary);
   this.pending=this.pending.slice(boundary+2);
   const lines=frame.split('\n'),event=lines.find(line=>line.startsWith('event:'))?.slice(6).trim();
   if(event==='error')throw new Error('Event stream server error');
   const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
   if(!data)continue;
   let value:unknown;
   try{value=JSON.parse(data);}catch{throw new Error('Invalid event stream JSON');}
   const message=value as Partial<PlatformEventMessage>|null;
   if(!message||typeof message.replayId!=='string'||!/^\d+$/.test(message.replayId)
    ||typeof message.eventId!=='string'||!message.payload||typeof message.payload!=='object'
    ||Array.isArray(message.payload))throw new Error('Invalid event stream message');
   this.push(message as PlatformEventMessage);
  }
 }
}
/** Streaming requires an authenticated fetch; native EventSource cannot attach an access token. */
export async function consumePlatformEventStream(name:string,cursor:string,signal:AbortSignal,
 onMessage:(message:PlatformEventMessage)=>void):Promise<void>{
 const {apiStream}=await import('../authentication/Client/authClient');
 const response=await apiStream('/platform-event-stream/'+encodeURIComponent(name)
  +'?replayId='+encodeURIComponent(cursor),signal);
 if(!response.body)throw new Error('Event stream has no body');
 const reader=response.body.getReader(),decoder=new TextDecoder();
 const parser=new PlatformEventFrameParser(onMessage);
 try{
  while(!signal.aborted){
   const chunk=await reader.read();
   if(chunk.done)break;
   parser.append(decoder.decode(chunk.value,{stream:true}));
  }
 }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
