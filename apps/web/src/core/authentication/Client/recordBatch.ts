/**
 * Record reads made within the same moment (a page opening: grid, cart, totals...) go
 * to the server as ONE request, POST /records-batch; each read is answered exactly like
 * GET /records/:object (same checks). A lone read stays a plain GET. If the batch
 * request fails as a whole (an older server, the network), each read is sent alone.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Read={object:string;query:string;resolve:(value:unknown)=>void;reject:(error:unknown)=>void};
export const BATCH_WINDOW_MS=4;
export const BATCH_MAX=25;

export function createRecordBatcher(request:Request,readError:(message:string,object:string)=>Error=message=>Error(message)){
 let queue:Read[]=[];
 let timer:ReturnType<typeof setTimeout>|null=null;
 const single=(read:Read)=>request<unknown>('/records/'+encodeURIComponent(read.object)+'?'+read.query).then(read.resolve,read.reject);
 const send=()=>{
  if(timer){clearTimeout(timer);timer=null;}
  const reads=queue;queue=[];
  if(!reads.length)return;
  if(reads.length===1){void single(reads[0]);return;}
  void request<{answers?:Array<{ok:boolean;data?:unknown;error?:string}>}>('/records-batch',{method:'POST',
   body:JSON.stringify({reads:reads.map(read=>({object:read.object,query:read.query}))})})
   .then(answer=>{
    if(!Array.isArray(answer?.answers)||answer!.answers!.length!==reads.length)throw Error('Invalid batch answer');
    reads.forEach((read,index)=>{
     const item=answer!.answers![index];
     if(item?.ok)read.resolve(item.data);
     else read.reject(readError(item?.error??'Unable to load records',read.object));
    });
   })
   .catch(()=>reads.forEach(read=>void single(read)));
 };
 return function read<T>(object:string,query:string):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
   queue.push({object,query,resolve:resolve as (value:unknown)=>void,reject});
   if(queue.length>=BATCH_MAX)send();
   else timer??=setTimeout(send,BATCH_WINDOW_MS);
  });
 };
}
