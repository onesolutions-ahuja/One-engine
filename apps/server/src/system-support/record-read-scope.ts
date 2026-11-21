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
 /** Changes each time remembered setup and decisions are dropped (a Flow ran, setup changed). */
 generation:number;
 fields:Map<string,Promise<unknown>>;
 rbac:Map<string,boolean>;
 locked:Set<string>;
 /** Records read since the last write (any write forgets them all). */
 records:Map<string,Promise<unknown>>;
};
const storage=new AsyncLocalStorage<RecordReadScope>();
export function withRecordReadScope<T>(run:()=>Promise<T>):Promise<T>{
 return storage.run({generation:0,fields:new Map(),rbac:new Map(),locked:new Set(),records:new Map()},run);
}
export const recordReadScope=()=>storage.getStore();
/** Forget remembered metadata and decisions (after a Flow/trigger ran). */
export function resetRecordReadScope(){
 const scope=storage.getStore();
 if(scope){scope.generation++;scope.fields.clear();scope.rbac.clear();scope.records.clear();}
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
// Tables a record save writes. A write to any other table (setup, permissions, ...) or any
// schema change inside a scope drops what the scope remembered, at once.
const RECORD_TABLES=/^(md_records|md_object_[0-9a-f]{32}|md_record_history|md_record_multi_values|md_auto_number_counters|md_auto_number_scoped_counters|md_record_lifecycle_audit|md_duplicate_record_sets|md_cross_object_duplicate_sets)$/;
const WRITES=/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
/** Called for every SQL statement: a setup or permission change drops remembered setup. */
export function noteStatement(sql:string){
 const scope=storage.getStore();
 if(!scope||typeof sql!=='string')return;
 const head=sql.trimStart().slice(0,12).toUpperCase();
 if(head.startsWith('SELECT')||head.startsWith('SAVEPOINT')||head.startsWith('RELEASE')||head.startsWith('ROLLBACK')
  ||head.startsWith('BEGIN')||head.startsWith('COMMIT')||head.startsWith('SET '))return;
 if(/^\s*(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO|CALL)\b/i.test(sql)){resetRecordReadScope();return;}
 for(const match of sql.matchAll(WRITES)){
  const table=match[1].toLowerCase();
  // "ON CONFLICT DO UPDATE SET", "FOR UPDATE OF/NOWAIT/SKIP": not a table.
  if(['set','of','nowait','skip'].includes(table))continue;
  if(!RECORD_TABLES.test(table)){resetRecordReadScope();return;}
 }
}
/** A record write is starting: records read before it may change. */
export function forgetScopedRecords(){storage.getStore()?.records.clear();}
