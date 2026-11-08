/** Builder canvas: load each media asset once per signed-in request function, even when many
 * components show the same image. Keyed by the request function so another login never shares it.
 * Failed loads are not kept, so a retry works.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
const caches=new WeakMap<Request,Map<string,Promise<unknown>>>();
const validMediaId=/^[0-9a-f-]{36}$/i;
export function loadCanvasAsset<T>(request:Request,id:string):Promise<T>{
 if(!validMediaId.test(id))return Promise.reject(Error('Invalid media asset ID'));
 let cache=caches.get(request);
 if(!cache){cache=new Map();caches.set(request,cache);}
 const hit=cache.get(id);
 if(hit)return hit as Promise<T>;
 if(cache.size>=256)cache.clear();
 const pending=request<T>('/media-assets/'+id);
 cache.set(id,pending);
 pending.catch(()=>{if(cache!.get(id)===pending)cache!.delete(id);});
 return pending;
}
