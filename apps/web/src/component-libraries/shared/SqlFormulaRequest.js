/** Core registers its authenticated API callback, not tokens or tenant data.
 * The Symbol is shared across separately bundled published components.
 * OneEngine permissions remain enforced by the server on every request. */
const requestKey=Symbol.for('metadrive.authenticatedSqlFormulaRequest');
const MAX_CONCURRENT=4;

/** A page can mount dozens of formula components at once. Without a limit each
 * fires its own request and exhausts the server pool, so the overflow fails and
 * renders FORMULAERROR. Identical in-flight requests share one round trip; no
 * result is cached after it settles, so permissions are re-checked every time. */
function limited(request){
 const inflight=new Map();
 const queue=[];
 let running=0;
 const pump=()=>{
  while(running<MAX_CONCURRENT&&queue.length){
   const job=queue.shift();
   running++;
   Promise.resolve().then(()=>request(job.path,job.init))
    .then(job.resolve,job.reject)
    .finally(()=>{running--;pump();});
  }
 };
 return (path,init)=>{
  const body=typeof init?.body==='string'?init.body:null;
  const key=body===null?null:path+'\n'+(init?.method??'GET')+'\n'+body;
  if(key!==null&&inflight.has(key))return inflight.get(key);
  const promise=new Promise((resolve,reject)=>{queue.push({path,init,resolve,reject});pump();});
  if(key!==null){
   inflight.set(key,promise);
   const clear=()=>{if(inflight.get(key)===promise)inflight.delete(key);};
   promise.then(clear,clear);
  }
  return promise;
 };
}
const BATCH_WINDOW_MS=15,BATCH_MAX=200;
/** Grids/lists ask for the same formula once per row (one Product price badge per
 * card, for example). Collect those asks for a few milliseconds and send ONE batch
 * request, so the server does its permission/metadata lookups once, not per row.
 * Any batch failure falls back to the original one-request-per-record path. */
function batched(request){
 const groups=new Map();
 const flush=group=>{
  groups.delete(group.key);
  const jobs=group.jobs;
  const single=job=>request('/formulas/evaluate',job.init).then(job.resolve,job.reject);
  if(jobs.length===1){single(jobs[0]);return;}
  request('/formulas/evaluate-batch',{method:'POST',body:JSON.stringify({
   formula:group.base.formula,objectApi:group.base.objectApi,state:group.base.state,
   recordIds:jobs.map(job=>job.recordId)})})
   .then(result=>{
    const values=result&&typeof result==='object'?result.values:null;
    if(!values||typeof values!=='object')throw Error('Invalid batch result');
    for(const job of jobs){
     if(Object.prototype.hasOwnProperty.call(values,job.recordId))job.resolve({value:values[job.recordId]});
     else job.reject(Error('Formula record is unavailable or permission denied'));
    }
   })
   .catch(()=>{jobs.forEach(single);});
 };
 return (path,init)=>{
  if(path!=='/formulas/evaluate'||init?.method!=='POST'||typeof init.body!=='string')
   return request(path,init);
  let base;
  try{base=JSON.parse(init.body);}catch{return request(path,init);}
  if(!base||typeof base.recordId!=='string'||!base.recordId||typeof base.objectApi!=='string'
    ||typeof base.formula!=='string')
   return request(path,init);
  const {recordId,...rest}=base;
  const key=JSON.stringify([rest.formula,rest.objectApi,rest.state??null]);
  return new Promise((resolve,reject)=>{
   let group=groups.get(key);
   if(!group){
    group={key,base:rest,jobs:[],timer:0};
    groups.set(key,group);
    group.timer=setTimeout(()=>flush(group),BATCH_WINDOW_MS);
   }
   const same=group.jobs.find(job=>job.recordId===recordId);
   if(same){same.waiters.push({resolve,reject});return;}
   const job={recordId,init,waiters:[{resolve,reject}],
    resolve:value=>job.waiters.forEach(w=>w.resolve(value)),
    reject:error=>job.waiters.forEach(w=>w.reject(error))};
   group.jobs.push(job);
   if(group.jobs.length>=BATCH_MAX){clearTimeout(group.timer);flush(group);}
  });
 };
}
const MANY_WINDOW_MS=10,MANY_MAX_ITEMS=100,MANY_DISABLE_AFTER=2;
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
/** Page-level coalescer. Every formula any component asks for within a few
 * milliseconds leaves in ONE request to /formulas/evaluate-many, so a page with 50
 * formula labels costs one round trip instead of 50 (and the server resolves identity,
 * field metadata, permissions and repeated aggregates once for the whole list).
 * - identical asks share one answer;
 * - the same formula asked for many records of one object becomes a single batch item;
 * - each item succeeds or fails alone, so one bad formula never blanks the page;
 * - if the endpoint is unavailable the original per-request path is used unchanged. */
function coalesced(request,legacy){
 let pending=new Map();
 let timer=0;
 let failures=0;
 const sendLegacy=entries=>entries.forEach(entry=>
  legacy('/formulas/evaluate',entry.init).then(entry.resolve,entry.reject));
 const send=(items,targets)=>{
  request('/formulas/evaluate-many',{method:'POST',body:JSON.stringify({items})})
   .then(result=>{
    const list=result&&Array.isArray(result.results)?result.results:null;
    if(!list||list.length!==items.length)throw Error('Invalid evaluate-many result');
    failures=0;
    const retry=[];
    targets.forEach((target,index)=>{
     const item=list[index];
     const ok=item&&typeof item==='object'&&own(item,'value');
     if(target.batch){
      const values=ok&&item.value&&typeof item.value==='object'?item.value:null;
      if(!values){retry.push(...target.entries);return;}
      for(const entry of target.entries){
       if(own(values,entry.recordId))entry.resolve({value:values[entry.recordId]});
       else entry.reject(Error('Formula record is unavailable or permission denied'));
      }
      return;
     }
     const entry=target.entries[0];
     if(ok)entry.resolve({value:item.value});
     else entry.reject(Error(item&&typeof item.error==='string'?item.error:'SQL Formula failed'));
    });
    // A batch the server cannot answer per record is asked again as plain items,
    // still in ONE request (never one request per record).
    if(retry.length)dispatch(retry.map(entry=>({entries:[entry],
     item:{...entry.base,recordId:entry.recordId}})));
   })
   .catch(()=>{
    failures++;
    sendLegacy(targets.flatMap(target=>target.entries));
   });
 };
 const dispatch=plan=>{
  for(let start=0;start<plan.length;start+=MANY_MAX_ITEMS){
   const part=plan.slice(start,start+MANY_MAX_ITEMS);
   send(part.map(entry=>entry.item),part);
  }
 };
 const flush=()=>{
  timer=0;
  const entries=[...pending.values()];
  pending=new Map();
  if(!entries.length)return;
  if(failures>=MANY_DISABLE_AFTER){sendLegacy(entries);return;}
  const plan=[];
  const groups=new Map();
  for(const entry of entries){
   if(!entry.recordId){plan.push({entries:[entry],item:{...entry.base}});continue;}
   let group=groups.get(entry.baseKey);
   if(!group){group={base:entry.base,entries:[]};groups.set(entry.baseKey,group);}
   group.entries.push(entry);
  }
  for(const group of groups.values()){
   if(group.entries.length===1)
    plan.push({entries:group.entries,item:{...group.base,recordId:group.entries[0].recordId}});
   else plan.push({entries:group.entries,batch:true,
    item:{...group.base,recordIds:group.entries.map(entry=>entry.recordId)}});
  }
  dispatch(plan);
 };
 return (path,init)=>{
  if(path!=='/formulas/evaluate'||init?.method!=='POST'||typeof init.body!=='string')
   return legacy(path,init);
  let body;
  try{body=JSON.parse(init.body);}catch{return legacy(path,init);}
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.formula!=='string'
    ||body.objectApi!==undefined&&typeof body.objectApi!=='string'
    ||body.recordId!==undefined&&typeof body.recordId!=='string')
   return legacy(path,init);
  const {recordId,...base}=body;
  return new Promise((resolve,reject)=>{
   let entry=pending.get(init.body);
   if(!entry){
    entry={init,base,recordId:recordId||'',baseKey:JSON.stringify([base.formula,base.objectApi??null,base.state??null]),
     waiters:[],
     resolve:value=>entry.waiters.forEach(waiter=>waiter.resolve(value)),
     reject:error=>entry.waiters.forEach(waiter=>waiter.reject(error))};
    pending.set(init.body,entry);
   }
   entry.waiters.push({resolve,reject});
   if(!timer)timer=setTimeout(flush,MANY_WINDOW_MS);
  });
 };
}
export function setSqlFormulaRequest(next){
 globalThis[requestKey]=typeof next==='function'?coalesced(next,batched(limited(next))):null;
}
export function getSqlFormulaRequest(){
 return typeof globalThis[requestKey]==='function'?globalThis[requestKey]:null;
}
