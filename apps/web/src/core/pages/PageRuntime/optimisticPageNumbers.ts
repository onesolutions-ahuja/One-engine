/** Opt-in only, for guarded numeric changes; not general Formula/Flow actions.
 * One active provisional update per page/session/collection avoids stale rollback
 * during rapid repeat clicks. No record or permission data is stored globally. */
const active=new Set<string>();
export function beginOptimisticNumberChange(pageSessionKey:string,sessionId:string,
 collectionKey:string,state:Readonly<Record<string,unknown>>,
 changes:ReadonlyArray<{key:string;value:unknown}>,
 publish:(key:string,value:unknown)=>void):{commit:()=>void;rollback:()=>void}{
 const key=JSON.stringify([pageSessionKey,sessionId,collectionKey]);
 if(active.has(key))throw Error('A quantity update is still pending. Try again after it completes.');
 active.add(key);
 const before=changes.map(change=>({key:change.key,value:state[change.key]}));
 try{
  for(const change of changes)publish(change.key,change.value);
 }catch(error){
  active.delete(key);
  throw error;
 }
 let settled=false;
 const commit=()=>{if(!settled){settled=true;active.delete(key);}};
 const rollback=()=>{
  if(settled)return;
  settled=true;
  active.delete(key);
  for(const change of before)publish(change.key,change.value);
 };
 return {commit,rollback};
}
