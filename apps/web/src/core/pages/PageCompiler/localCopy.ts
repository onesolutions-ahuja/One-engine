/**
 * Local copy: the rows a page showed last time, kept in this browser (IndexedDB) for
 * the signed-in user only. A page that opens again draws them at once and takes the
 * server's answer a moment later (live changes keep it current while it is open).
 * Only rows the user was already shown are kept; the server still checks every read
 * and write. Sign-out deletes the whole copy; another user never sees it.
 */
const DB='une-local-copy';
const STORE='rows';
const VERSION=1;
/** One saved entry at most this large (a huge list is simply read from the server). */
const MAX_ENTRY_CHARS=1_500_000;
/** Entries kept per user (oldest dropped first). */
const MAX_ENTRIES=400;

export type LocalEntry={owner:string;key:string;savedAt:number;value:unknown};

let opening:Promise<IDBDatabase|null>|null=null;
function open():Promise<IDBDatabase|null>{
 if(opening)return opening;
 opening=new Promise(resolve=>{
  try{
   if(typeof indexedDB==='undefined'){resolve(null);return;}
   const request=indexedDB.open(DB,VERSION);
   request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains(STORE)){
     const store=db.createObjectStore(STORE,{keyPath:['owner','key']});
     store.createIndex('owner','owner');
    }
   };
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>resolve(null);
   request.onblocked=()=>resolve(null);
  }catch{resolve(null);}
 });
 return opening;
}
const done=(request:IDBRequest|IDBTransaction)=>new Promise<void>(resolve=>{
 if('oncomplete' in request){request.oncomplete=()=>resolve();request.onerror=()=>resolve();request.onabort=()=>resolve();}
 else{request.onsuccess=()=>resolve();request.onerror=()=>resolve();}
});

/** The saved value for this user and key, if any. */
export async function readLocal<T>(owner:string|undefined,key:string):Promise<T|undefined>{
 if(!owner)return undefined;
 const db=await open();
 if(!db)return undefined;
 try{
  const request=db.transaction(STORE,'readonly').objectStore(STORE).get([owner,key]);
  await done(request);
  return (request.result as LocalEntry|undefined)?.value as T|undefined;
 }catch{return undefined;}
}

const pending=new Map<string,{owner:string;key:string;value:unknown}>();
let flushTimer:ReturnType<typeof setTimeout>|null=null;
let writes=0;
/** Save a value for this user (batched; too large or unserialisable values are skipped). */
export function writeLocal(owner:string|undefined,key:string,value:unknown):void{
 if(!owner)return;
 pending.set(owner+'\u0000'+key,{owner,key,value});
 flushTimer??=setTimeout(()=>void flush(),250);
}
async function flush(){
 flushTimer=null;
 const items=[...pending.values()];pending.clear();
 const db=await open();
 if(!db||!items.length)return;
 try{
  const tx=db.transaction(STORE,'readwrite');
  const store=tx.objectStore(STORE);
  for(const item of items){
   let size=0;
   try{size=JSON.stringify(item.value).length;}catch{continue;}
   if(size>MAX_ENTRY_CHARS){store.delete([item.owner,item.key]);continue;}
   store.put({owner:item.owner,key:item.key,savedAt:Date.now(),value:item.value} satisfies LocalEntry);
  }
  await done(tx);
  if(++writes%20===0)await trim(db,items[0].owner);
 }catch{/* storage full or blocked: pages simply wait for the server */}
}
/** Keep the newest MAX_ENTRIES entries of this user. */
async function trim(db:IDBDatabase,owner:string){
 try{
  const request=db.transaction(STORE,'readonly').objectStore(STORE).index('owner').getAll(owner);
  await done(request);
  const entries=(request.result as LocalEntry[]).sort((a,b)=>b.savedAt-a.savedAt);
  if(entries.length<=MAX_ENTRIES)return;
  const tx=db.transaction(STORE,'readwrite');
  for(const entry of entries.slice(MAX_ENTRIES))tx.objectStore(STORE).delete([entry.owner,entry.key]);
  await done(tx);
 }catch{/* next time */}
}
/** Sign-out (or another user signing in): delete every saved row in this browser. */
export async function clearLocal():Promise<void>{
 pending.clear();
 const db=await open();
 if(!db)return;
 try{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();await done(tx);}catch{/* blocked */}
}
/** A short stable fingerprint (a page's data definitions, a filter's inputs). */
export function fingerprint(value:unknown):string{
 const text=JSON.stringify(value)??'';
 let hash=2166136261;
 for(let index=0;index<text.length;index++){hash^=text.charCodeAt(index);hash=Math.imul(hash,16777619);}
 return (hash>>>0).toString(36)+text.length.toString(36);
}
