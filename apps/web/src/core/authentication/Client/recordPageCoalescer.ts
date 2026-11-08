type RecordPage<Row>={records:Row[];total:number};
/** Coalesce identical authorised record reads and briefly reuse successful pages.
 * The caller owns the authenticated query/offset and mutation generation key:
 * a changed actor or successful write gets a different key. A smaller page
 * can reuse a larger page, but never the reverse.
 */
export function createRecordPageCoalescer<Row>() {
 type Subscriber={limit:number;resolve:(page:RecordPage<Row>)=>void;reject:(error:unknown)=>void};
 type Group={maxLimit:number;load:(limit:number)=>Promise<RecordPage<Row>>;subscribers:Subscriber[]};
 type Running={limit:number;promise:Promise<RecordPage<Row>>};
 type Cached={limit:number;page:RecordPage<Row>;expiresAt:number};
 const pending=new Map<string,Group>();
 const inFlight=new Map<string,Running>();
 const settled=new Map<string,Cached>();
 const cacheTtlMs=30_000,maxCachedPages=96;
 const project=(result:RecordPage<Row>,limit:number):RecordPage<Row>=>{
  if(!result||!Array.isArray(result.records)||!Number.isFinite(result.total))
   throw Error('Invalid record page');
  return {records:result.records.slice(0,limit),total:result.total};
 };
 return function coalesce(
  key:string,limit:number,load:(limit:number)=>Promise<RecordPage<Row>>,forceFresh=false
 ):Promise<RecordPage<Row>>{
  const running=inFlight.get(key);
  if(running&&running.limit>=limit)
   return running.promise.then(result=>project(result,limit));
  const saved=forceFresh?undefined:settled.get(key);
  if(saved){
   if(saved.expiresAt>Date.now()&&saved.limit>=limit){
    settled.delete(key);settled.set(key,saved);
    return Promise.resolve(project(saved.page,limit));
   }
   if(saved.expiresAt<=Date.now())settled.delete(key);
  }
  return new Promise((resolve,reject)=>{
   let group=pending.get(key);
   if(!group){
    group={maxLimit:limit,load,subscribers:[]};
    pending.set(key,group);
    const scheduled=group;
    // Preserve same-microtask batching, then retain the resulting request until
    // settlement for later subscribers that require no more rows.
    queueMicrotask(()=>{
     if(pending.get(key)===scheduled)pending.delete(key);
     const promise=Promise.resolve().then(()=>scheduled.load(scheduled.maxLimit));
     const current:Running={limit:scheduled.maxLimit,promise};
     inFlight.set(key,current);
     void promise.then(result=>{
      try{
       const validated=project(result,scheduled.maxLimit);
       const previous=settled.get(key);
       if(!previous||previous.limit<=scheduled.maxLimit||previous.expiresAt<=Date.now()){
        settled.delete(key);
        settled.set(key,{limit:scheduled.maxLimit,page:validated,expiresAt:Date.now()+cacheTtlMs});
        while(settled.size>maxCachedPages)settled.delete(settled.keys().next().value!);
       }
       for(const subscriber of scheduled.subscribers)
        subscriber.resolve(project(validated,subscriber.limit));
      }catch(error){for(const subscriber of scheduled.subscribers)subscriber.reject(error);}
     },error=>{for(const subscriber of scheduled.subscribers)subscriber.reject(error);})
     .finally(()=>{if(inFlight.get(key)===current)inFlight.delete(key);});
    });
   }
   group.maxLimit=Math.max(group.maxLimit,limit);
   group.subscribers.push({limit,resolve,reject});
  });
 };
}
