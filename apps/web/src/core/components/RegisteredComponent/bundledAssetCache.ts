/** Release-reviewed renderer assets only; tenant-authored JSX remains sandboxed.
 * Failed loads always evict. Legacy URLs dedupe concurrent requests but revalidate.
 */
const pending=new Map<string,Promise<unknown>>();
const settled=new Map<string,unknown>();
const MAX_ASSETS=96;

export function loadBundledRenderer<T>(key:string,loader:()=>Promise<T>,immutable=true):Promise<T>{
 if(immutable&&settled.has(key))return Promise.resolve(settled.get(key) as T);
 const active=pending.get(key);
 if(active)return active as Promise<T>;
 const next=Promise.resolve().then(loader).then(value=>{
  pending.delete(key);
  if(immutable){
   if(settled.size>=MAX_ASSETS)settled.delete(settled.keys().next().value!);
   settled.set(key,value);
  }
  return value;
 },error=>{pending.delete(key);throw error;});
 pending.set(key,next);
 return next;
}
