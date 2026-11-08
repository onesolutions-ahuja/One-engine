/** Permission-scoped image data: share in-flight reads and reuse fresh data
 * across editor/preview remounts. Cache entries are bounded by count and bytes,
 * scoped to the authenticated token, and invalidated by media writes.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Asset={value:unknown;expiresAt:number;bytes:number};
const inFlight=new WeakMap<Request,Map<string,Promise<unknown>>>();
const settled=new WeakMap<Request,Map<string,Asset>>();
const validMediaId=/^[0-9a-f-]{36}$/i;
const mediaTtlMs=30_000,maxAssets=64,maxBytes=20*1024*1024;
let mediaGeneration=0;
export function invalidatePageMediaAssets():void {mediaGeneration++;}
export function requestPageMediaAsset<T>(
 request:Request,id:string,authorizationIdentity:string
):Promise<T>{
 if(!validMediaId.test(id))return Promise.reject(Error('Invalid media asset ID'));
 // An unauthenticated read is never cached.
 if(!authorizationIdentity)return request<T>('/media-assets/'+id);
 const key=mediaGeneration+'|'+authorizationIdentity+'|'+id;
 let cached=settled.get(request);
 if(!cached){cached=new Map();settled.set(request,cached);}
 const saved=cached.get(key);
 if(saved){
  if(saved.expiresAt>Date.now()){
   cached.delete(key);cached.set(key,saved);
   return Promise.resolve(saved.value as T);
  }
  cached.delete(key);
 }
 let entries=inFlight.get(request);
 if(!entries){entries=new Map();inFlight.set(request,entries);}
 const found=entries.get(key);
 if(found)return found as Promise<T>;
 if(entries.size>=128)return request<T>('/media-assets/'+id);
 const pending=request<T>('/media-assets/'+id);
 entries.set(key,pending);
 void pending.then(value=>{
  // Do not cache an answer whose permission context was invalidated during load.
  if(key.startsWith(mediaGeneration+'|')&&value&&typeof value==='object'&&
   typeof (value as {contentBase64?:unknown}).contentBase64==='string'){
   const bytes=(value as unknown as {contentBase64:string}).contentBase64.length;
   if(bytes<=maxBytes){
    cached!.delete(key);
    cached!.set(key,{value,bytes,expiresAt:Date.now()+mediaTtlMs});
    let total=[...cached!.values()].reduce((sum,asset)=>sum+asset.bytes,0);
    while(cached!.size>maxAssets||total>maxBytes){
     const first=cached!.keys().next().value;
     if(first===undefined)break;
     total-=cached!.get(first)!.bytes;
     cached!.delete(first);
    }
   }
  }
  if(entries!.get(key)===pending)entries!.delete(key);
 },()=>{if(entries!.get(key)===pending)entries!.delete(key);});
 return pending;
}
