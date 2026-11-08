/** Content-hashed, release-trusted runtime asset. No tenant JSX or metadata enters this cache. */
const inflight=new Map<string,Promise<string>>();
const allowed=/^component-library\/components\/smart_runtime\.[a-f0-9]{16}\.json$/;
export async function loadSharedSmartRenderer(path:unknown,baseUrl:string):Promise<string>{
 if(typeof path!=='string'||!allowed.test(path))throw Error('Invalid shared runtime path');
 let loading=inflight.get(path);
 if(!loading){
  loading=fetch(baseUrl+path,{cache:'force-cache'})
   .then(async response=>{
    if(!response.ok)throw Error('Shared renderer unavailable');
    const payload:unknown=await response.json();
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||
       !('compiledJs' in payload)||typeof payload.compiledJs!=='string'||
       !payload.compiledJs)throw Error('Invalid shared renderer content');
    return payload.compiledJs;
   })
   .catch(error=>{inflight.delete(path);throw error;});
  inflight.set(path,loading);
  if(inflight.size>8)inflight.delete(inflight.keys().next().value!);
 }
 return loading;
}
