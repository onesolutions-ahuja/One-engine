// One shared answer per distinct aggregate, per page session.
//
// A page can show the same total (e.g. SUMIFS over the open cart) in dozens of
// components, each wrapped in a different outer formula. A hand-written page would
// ask for that total once and let every label read it. This module is that "ask once":
//  - identical asks that overlap in time share one request;
//  - a settled answer is reused for a very short window (a burst of redraws), never
//    longer, so permissions and other users' changes are re-checked promptly;
//  - any write to an Object the aggregate reads drops its answer immediately, so the
//    next ask goes back to the server.
// Nothing is stored beyond the tab, and a new request function (login/logout) starts
// from an empty scope.
const SHARE_MS=1500;
const MAX_ENTRIES=500,MAX_SCOPES=50;
const scopes=new Map();

const scopeFor=(scopeKey,request)=>{
 let scope=scopes.get(scopeKey);
 if(scope&&scope.request!==request){scopes.delete(scopeKey);scope=undefined;}
 if(!scope){
  if(scopes.size>=MAX_SCOPES)scopes.delete(scopes.keys().next().value);
  scope={request,entries:new Map()};
  scopes.set(scopeKey,scope);
 }
 return scope;
};

/** Answer for `key`, computed at most once per burst. `objects` are the Objects the
 * answer reads (used for invalidation). */
export function sharedAggregate(scopeKey,request,key,objects,compute){
 const scope=scopeFor(String(scopeKey??''),request);
 const hit=scope.entries.get(key);
 if(hit&&(hit.pending||Date.now()-hit.at<SHARE_MS)){
  localShareStats.hits++;
  return hit.promise;
 }
 if(scope.entries.size>=MAX_ENTRIES){
  for(const [name,entry] of scope.entries)if(!entry.pending)scope.entries.delete(name);
 }
 localShareStats.requests++;
 const entry={pending:true,at:Date.now(),objects:[...objects]};
 entry.promise=Promise.resolve().then(compute).then(value=>{
  entry.pending=false;entry.at=Date.now();return value;
 },error=>{
  if(scope.entries.get(key)===entry)scope.entries.delete(key);
  throw error;
 });
 scope.entries.set(key,entry);
 return entry.promise;
}

// Several listeners hear one save; only the first may clear, otherwise answers
// already re-asked for that same save would be thrown away again.
const heard=new WeakMap();
/** A page write: drop every shared answer that reads a written Object
 * (all of them when the written Objects are unknown). */
export function noteSharedMutation(scopeKey,detail){
 const id=String(scopeKey??'');
 if(detail&&typeof detail==='object'){
  const seen=heard.get(detail)??new Set();
  if(seen.has(id))return;
  seen.add(id);heard.set(detail,seen);
 }
 const scope=scopes.get(id);
 if(!scope)return;
 const written=detail&&Array.isArray(detail.objectApiNames)?detail.objectApiNames:[];
 for(const [key,entry] of scope.entries){
  if(!written.length||entry.objects.some(name=>written.includes(name)))scope.entries.delete(key);
 }
}
export function clearSharedAggregates(){scopes.clear();}
// Any page save (compiled runtime, Flows, components) clears what it wrote, once per save.
if(typeof window!=='undefined'&&!window.__metadriveSharedMutationListener){
 window.__metadriveSharedMutationListener=true;
 window.addEventListener('metadrive:page-flow-mutated',event=>{
  const detail=event&&event.detail;
  if(detail&&typeof detail.sessionId==='string')noteSharedMutation(detail.sessionId,detail);
 });
}

/** Counts for diagnostics: real requests sent vs. asks answered from a shared one. */
export const localShareStats=typeof window!=='undefined'
 ?(window.__metadriveSharedAggregates??={requests:0,hits:0}):{requests:0,hits:0};
