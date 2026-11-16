import {AsyncLocalStorage} from 'node:async_hooks';
/**
 * Scope of ONE page-code action or record-set load (one SQL transaction that only
 * reads and writes business records). Inside it, metadata that cannot change during
 * the action is read once: field definitions per Object, permission decisions, and
 * the write lock already taken per Object. A record trigger (Flow) may change
 * permissions or metadata, so the remembered decisions are dropped after each one.
 * Outside this scope nothing is remembered and behaviour is unchanged.
 */
export type RecordReadScope={
 fields:Map<string,Promise<unknown>>;
 rbac:Map<string,boolean>;
 locked:Set<string>;
};
const storage=new AsyncLocalStorage<RecordReadScope>();
export function withRecordReadScope<T>(run:()=>Promise<T>):Promise<T>{
 return storage.run({fields:new Map(),rbac:new Map(),locked:new Set()},run);
}
export const recordReadScope=()=>storage.getStore();
/** Forget remembered metadata and decisions (after a Flow/trigger ran). */
export function resetRecordReadScope(){
 const scope=storage.getStore();
 if(scope){scope.fields.clear();scope.rbac.clear();}
}
/** Metadata read once per page action (inside the scope); read every time outside it. */
export function scopedMetadata<T>(cacheKey:string,load:()=>Promise<T>):Promise<T>{
 const scope=storage.getStore();
 if(!scope)return load();
 let hit=scope.fields.get(cacheKey) as Promise<T>|undefined;
 if(!hit){
  const promise=load();hit=promise;
  scope.fields.set(cacheKey,promise);
  promise.catch(()=>{if(scope.fields.get(cacheKey)===promise)scope.fields.delete(cacheKey);});
 }
 return hit;
}
