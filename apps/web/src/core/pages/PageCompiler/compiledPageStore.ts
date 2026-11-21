import type {CompiledPage,CompiledDataSource} from './compilePage';
import {notePageRows} from './pageTimings';
import {noteOwnWrites} from './liveChanges';
import {applySavedRecordMutations,movedSessionParent,withDependentObjects,type PageMutationDetail,type SessionParentFilter} from '../PageRuntime/pageMutationScope';
import {applyPageSelection,changedPageStateNames,type PageStateDependencies} from '../PageRuntime/pageStateDependencies';
import {withComponentProperties} from '../../../../../server/src/expression-engine/FormulaComponentState.js';

/**
 * ONE store and ONE data layer per compiled page (not one per component).
 *
 * - State: a change notifies only the components that read that key.
 * - Data: each compiled data source is loaded once and shared. Lists load
 *   50 rows, then 50 more when the user scrolls near the end. A save patches
 *   rows in place when the result is exact, else reloads only the sources
 *   that read the written Object.
 */
type Listener=()=>void;
type State=Readonly<Record<string,unknown>>;

const isWord=(c:number)=>(c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===95;
function mentionsWord(text:string,word:string):boolean{
 const needle=word.toLowerCase();
 let at=text.indexOf(needle);
 while(at>=0){
  if(!isWord(text.charCodeAt(at-1))&&!isWord(text.charCodeAt(at+needle.length)))return true;
  at=text.indexOf(needle,at+1);
 }
 return false;
}

/** True when a patch adds rows or changes a row's sort value (its place may move). */
function movesInSort(before:readonly Record<string,unknown>[],after:readonly Record<string,unknown>[],field:string):boolean{
 const was=new Map(before.map(row=>[String(row.Id),row]));
 return after.some(row=>{
  const old=was.get(String(row.Id));
  return !old||JSON.stringify(old[field]??null)!==JSON.stringify(row[field]??null);
 });
}

export function createCompiledPageStore(compiled:CompiledPage,initial:State={},
 dependencies:PageStateDependencies=new Map()){
 let state:State={...initial};
 const byComponent=new Map<string,Set<Listener>>();
 const anyListeners=new Set<Listener>();
 const keyListeners=new Set<{keys:ReadonlySet<string>;listener:Listener}>();
 // Keys only known at run time (STATE() results, Flow outputs, collection
 // names): resolve their readers once, then cache.
 const readers=new Map<string,string[]>(Object.entries(compiled.stateReaders));
 const readersOf=(key:string):string[]=>{
  const known=readers.get(key);
  if(known)return known;
  const found=compiled.components.filter(item=>item.mode!=='static'&&mentionsWord(item.searchText,key)).map(item=>item.id);
  readers.set(key,found);
  return found;
 };
 const notify=(keys:readonly string[])=>{
  const ids=new Set(keys.flatMap(readersOf));
  for(const id of ids)byComponent.get(id)?.forEach(listener=>listener());
  if(keys.length)anyListeners.forEach(listener=>listener());
  if(keys.length)for(const entry of keyListeners)
   if(keys.some(key=>entry.keys.has(key.toLowerCase())))entry.listener();
 };
 const commit=(next:State):string[]=>{
  if(next===state)return [];
  const changed=changedPageStateNames(state,next);
  state=next;
  notify(changed);
  return changed;
 };
 return {
  get:():State=>state,
  /** Apply several changes, then notify each affected reader once. */
  merge(changes:ReadonlyArray<{key:string;value:unknown}>):string[]{
   if(!changes.some(change=>!Object.is(state[change.key],change.value)))return [];
   const next={...state};
   for(const change of changes)next[change.key]=change.value;
   return commit(next);
  },
  set(key:string,value:unknown):boolean{return this.merge([{key,value}]).length>0;},
  /** A selection (state key or named collection) also clears selections that depend on it. */
  select(kind:'state'|'collection',key:string,value:unknown):string[]{
   return commit(applyPageSelection(state,{kind,key,value} as Parameters<typeof applyPageSelection>[1],dependencies));
  },
  reset(next:State={}){
   const keys=[...new Set([...Object.keys(state),...Object.keys(next)])];
   state={...next};
   notify(keys);
  },
  /** Disabled / Caption / Visible of one component: given by an action ('set') or worked out
   * by the page ('auto'). Only that component and the formulas naming it redraw. */
  setProperties(name:string,componentId:string|undefined,part:'set'|'auto',values:Readonly<Record<string,unknown>>):boolean{
   const next=withComponentProperties(state,name,part,values);
   if(next===state)return false;
   state=next;
   const ids=new Set(readersOf(name));
   if(componentId)ids.add(componentId);
   for(const id of ids)byComponent.get(id)?.forEach(listener=>listener());
   for(const entry of keyListeners)if(entry.keys.has(name.toLowerCase()))entry.listener();
   return true;
  },
  /** Redraw these components (a value given to them by an action). */
  redraw(ids:readonly string[]){for(const id of ids)byComponent.get(id)?.forEach(listener=>listener());},
  subscribeComponent(id:string,listener:Listener):()=>void{
   const set=byComponent.get(id)??new Set<Listener>();
   set.add(listener);byComponent.set(id,set);
   return ()=>{set.delete(listener);};
  },
  subscribeAll(listener:Listener):()=>void{anyListeners.add(listener);return ()=>{anyListeners.delete(listener);};},
  /** Called when one of these state keys (lower-case) changes. */
  subscribeKeys(keys:readonly string[],listener:Listener):()=>void{
   const entry={keys:new Set(keys.map(key=>key.toLowerCase())),listener};
   keyListeners.add(entry);
   return ()=>{keyListeners.delete(entry);};
  },
  readersOf
 };
}
export type CompiledPageStore=ReturnType<typeof createCompiledPageStore>;

export type SourceSnapshot={records:Record<string,unknown>[];total:number;loading:boolean;error:string;
 /** More rows exist on the server; loadMore fetches the next page. */
 hasMore:boolean;loadingMore:boolean;
 /** Filters as resolved for the last load (used to predict saved rows). */
 serverFilters?:ReadonlyArray<{field:string;operator:string;value:string}>;
 relatedFilter?:SessionParentFilter;predictable:boolean;version:number};
export type SourceLoadResult={records:Record<string,unknown>[];total:number;
 serverFilters?:ReadonlyArray<{field:string;operator:string;value:string}>;predictable:boolean;
 relatedFilter?:SessionParentFilter;
 /** The loader could not page (client-side filter): rows are all it will return. */
 paged:boolean};
export type SourceLoad=((source:CompiledDataSource,state:State,window:{offset:number;limit:number;fresh?:boolean})=>
 Promise<SourceLoadResult|null>)&{invalidate?(objectApiNames?:readonly string[]):void};

/** Rows per page while scrolling. */
export const SOURCE_PAGE_SIZE=50;
/** A complete (collection) source never loads more than this. */
export const COMPLETE_SOURCE_LIMIT=200;
/** Record API maximum per request. */
const API_LIMIT=100;
const emptySnapshot:SourceSnapshot=Object.freeze({records:[],total:0,loading:true,error:'',hasMore:false,
 loadingMore:false,predictable:false,version:0}) as SourceSnapshot;

/** Local copy (localCopy.ts): who the rows belong to and what else they depend on
 * (session, followed till). Without it nothing is kept in the browser. */
export type LocalCopyOptions={owner():string|undefined;context():unknown;
 read<T>(owner:string|undefined,key:string):Promise<T|undefined>;write(owner:string|undefined,key:string,value:unknown):void;
 fingerprint(value:unknown):string};
type Saved={records:Record<string,unknown>[];total:number;hasMore:boolean;predictable:boolean;
 serverFilters?:SourceSnapshot['serverFilters'];relatedFilter?:SourceSnapshot['relatedFilter']};

export function createCompiledDataLayer(compiled:CompiledPage,load:SourceLoad,getState:()=>State,
 objects?:Parameters<typeof withDependentObjects>[1],local?:LocalCopyOptions){
 const snapshots=new Map<string,SourceSnapshot>();
 const listeners=new Map<string,Set<Listener>>();
 const requests=new Map<string,number>();
 // Sources re-reading right now. Refreshing is silent: subscribers redraw only if the rows really change.
 const refreshing=new Set<string>();
 const sources=new Map(compiled.dataSources.map(source=>[source.id,source]));
 const componentReads=new Map(compiled.components.map(item=>[item.id,item.objectReads]));
 let loads=0;
 const sameRows=(a:readonly Record<string,unknown>[],b:readonly Record<string,unknown>[]):boolean=>{
  if(a===b)return true;
  if(a.length!==b.length)return false;
  try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}
 };
 /** The local-copy key of a source: its definition, the state it reads, session and till. */
 const localKey=(source:CompiledDataSource)=>{
  const state=getState() as Record<string,unknown>;
  const inputs=source.stateInputs.map(key=>[key,state[key]??state[key.toLowerCase()]??null]);
  return 'source|'+compiled.apiName+'|'+source.id+'|'+local!.fingerprint([source,inputs,local!.context()]);
 };
 const publish=(id:string,next:SourceSnapshot,fromLocal=false)=>{
  snapshots.set(id,next);
  if(!next.loading&&!next.error)notePageRows(compiled.apiName,fromLocal?'local':'server');
  listeners.get(id)?.forEach(listener=>listener());
  // Keep what the server answered (and live patches) for the next time the page opens.
  const source=sources.get(id);
  if(local&&source&&!fromLocal&&!next.loading&&!next.loadingMore&&!next.error)
   local.write(local.owner(),localKey(source),{records:next.records,total:next.total,hasMore:next.hasMore,
    predictable:next.predictable,serverFilters:next.serverFilters,relatedFilter:next.relatedFilter} satisfies Saved);
 };
 /** Page open: draw the rows kept from last time while the server is asked. */
 const fromLocal=async(id:string):Promise<void>=>{
  const source=sources.get(id);
  if(!local||!source)return;
  const saved=await local.read<Saved>(local.owner(),localKey(source)).catch(()=>undefined);
  const current=snapshots.get(id);
  // The server answered first, or nothing kept: nothing to do.
  if(!saved||!Array.isArray(saved.records)||(current&&!current.loading))return;
  publish(id,{records:saved.records,total:saved.total,hasMore:saved.hasMore,predictable:saved.predictable,
   serverFilters:saved.serverFilters,relatedFilter:saved.relatedFilter,loading:false,loadingMore:false,error:'',
   version:(current?.version??0)+1},true);
 };
 /** Read rows [0, count) in Record API sized pages. */
 const readRows=async(source:CompiledDataSource,count:number,fresh=false):Promise<SourceLoadResult|null>=>{
  const state=getState();
  let merged:SourceLoadResult|null=null;
  for(let offset=0;offset<count;){
   loads++;
   const page=await load(source,state,{offset,limit:Math.min(API_LIMIT,count-offset),...(fresh?{fresh:true}:{})});
   if(!page)return null;
   merged=merged?{...page,records:[...merged.records,...page.records]}:page;
   if(!page.paged||page.records.length===0||merged.records.length>=page.total)break;
   offset=merged.records.length;
  }
  if(merged&&source.complete&&merged.total>COMPLETE_SOURCE_LIMIT)
   throw Error(source.objectApiName+' has more records than a collection can safely load; narrow its filters');
  return merged;
 };
 /** `fresh`: skip the short-lived read cache (rows another device may have changed). */
 const reload=async(id:string,fresh=false):Promise<void>=>{
  const source=sources.get(id);
  if(!source)return;
  const request=(requests.get(id)??0)+1;
  requests.set(id,request);
  const previous=snapshots.get(id)??emptySnapshot;
  // Keep showing current rows while the same source refreshes: no blank flash and,
  // unlike before, no redraw of every reader just because a re-read started.
  if(!previous.loading)refreshing.add(id);
  // A refresh keeps as many rows as the user has already scrolled through.
  const count=source.complete?COMPLETE_SOURCE_LIMIT:Math.max(SOURCE_PAGE_SIZE,previous.records.length);
  try{
   const result=await readRows(source,count,fresh);
   if(requests.get(id)!==request)return;
   refreshing.delete(id);
   const next:SourceSnapshot=result
    ?{records:result.records,total:result.total,loading:false,loadingMore:false,error:'',serverFilters:result.serverFilters,relatedFilter:result.relatedFilter,
      hasMore:result.paged&&result.records.length<result.total,predictable:result.predictable,version:previous.version+1}
    :{records:[],total:0,loading:false,loadingMore:false,error:'',hasMore:false,predictable:false,version:previous.version+1};
   // Refresh by value: identical rows keep the same snapshot, so nothing redraws.
   const latest=snapshots.get(id);
   if(latest&&!latest.loading&&!latest.loadingMore&&!latest.error&&sameRows(latest.records,next.records)
     &&latest.total===next.total&&latest.hasMore===next.hasMore&&latest.predictable===next.predictable
     &&JSON.stringify(latest.serverFilters??null)===JSON.stringify(next.serverFilters??null)
     &&JSON.stringify(latest.relatedFilter??null)===JSON.stringify(next.relatedFilter??null))return;
   publish(id,next);
  }catch(error){
   if(requests.get(id)!==request)return;
   refreshing.delete(id);
   publish(id,{...(snapshots.get(id)??previous),loading:false,loadingMore:false,error:error instanceof Error?error.message:'Unable to load records',
    version:(snapshots.get(id)??previous).version+1});
  }
 };
 const loadMore=async(id:string):Promise<void>=>{
  const source=sources.get(id);
  const current=snapshots.get(id);
  if(!source||!current||!current.hasMore||current.loading||current.loadingMore||refreshing.has(id))return;
  const request=requests.get(id)??0;
  publish(id,{...current,loadingMore:true});
  try{
   loads++;
   const page=await load(source,getState(),{offset:current.records.length,limit:SOURCE_PAGE_SIZE});
   // A reload started meanwhile owns the rows now.
   if(requests.get(id)!==request)return;
   const latest=snapshots.get(id)!;
   if(!page){publish(id,{...latest,loadingMore:false,hasMore:false});return;}
   const seen=new Set(latest.records.map(row=>row.Id));
   const records=[...latest.records,...page.records.filter(row=>!seen.has(row.Id))];
   publish(id,{...latest,records,total:page.total,loadingMore:false,
    hasMore:page.paged&&page.records.length>0&&records.length<page.total,version:latest.version+1});
  }catch(error){
   const latest=snapshots.get(id)??current;
   publish(id,{...latest,loadingMore:false,error:error instanceof Error?error.message:'Unable to load more records'});
  }
 };
 const readsObject=(source:CompiledDataSource,objects:readonly string[]):boolean=>
  objects.includes(source.objectApiName)||source.components.some(id=>{
   const reads=componentReads.get(id);
   return reads===null||Boolean(reads?.some(name=>objects.includes(name)));
  });
 return {
  get:(id:string):SourceSnapshot=>snapshots.get(id)??emptySnapshot,
  subscribe(id:string,listener:Listener):()=>void{
   const set=listeners.get(id)??new Set<Listener>();
   set.add(listener);listeners.set(id,set);
   return ()=>{set.delete(listener);};
  },
  /** Load every source once, in parallel. */
  start:():Promise<void>=>Promise.all([...sources.keys()].map(id=>{void fromLocal(id);return reload(id);})).then(()=>undefined),
  reload,loadMore,
  /** Only sources whose filter reads a changed state key reload. */
  stateChanged(keys:readonly string[]):Promise<void>{
   const changed=new Set(keys.map(key=>key.toLowerCase()));
   return Promise.all(compiled.dataSources.filter(source=>source.stateInputs.some(key=>changed.has(key.toLowerCase())))
    .map(source=>reload(source.id))).then(()=>undefined);
  },
  /** A save (or a prediction of one): patch rows in place when exact, else reload only readers. */
  saved(detail:PageMutationDetail):Promise<void>{
   // Roll-up and cross-object formula parents change on the server too: their readers reload.
   const own=detail.objectApiNames;
   const written=withDependentObjects(own,objects);
   const work:Promise<void>[]=[];
   // A new or deleted parent (a cart) is rediscovered on the next read.
   if(!detail.optimistic)load.invalidate?.(written);
   // This window saved these records: their live echo needs no second read here.
   // (Not for rows another screen saved: their next change must still be drawn here.)
   if(!detail.optimistic&&!detail.live&&detail.recordChanges)noteOwnWrites(detail.recordChanges.map(change=>change.record?.Id));
   // A tap made the session's new parent (a new sale): its child lists move to it now.
   for(const source of compiled.dataSources){
    const current=snapshots.get(source.id);
    const moved=current&&!current.loading?movedSessionParent(current.relatedFilter,detail):null;
    if(!moved)continue;
    publish(source.id,{...current!,records:moved.keepRows?current!.records:[],total:moved.keepRows?current!.total:0,
     hasMore:moved.keepRows?current!.hasMore:false,relatedFilter:{...current!.relatedFilter!,value:moved.value},version:current!.version+1});
   }
   for(const source of compiled.dataSources){
    if(written&&!readsObject(source,written))continue;
    // Reads only a roll-up parent of what was saved: re-read it after the real save.
    if(own&&written&&!readsObject(source,own)){
     if(!detail.optimistic)work.push(reload(source.id,Boolean(detail.live)));
     continue;
    }
    const current=snapshots.get(source.id);
    const reads=source.components.map(id=>componentReads.get(id));
    const fullyLoaded=Boolean(current&&!current.hasMore&&current.records.length===current.total);
    const patched=written&&current&&!current.loading&&!refreshing.has(source.id)
     ?applySavedRecordMutations(current.records,source.objectApiName,detail,{
       // Inserts and deletes are exact only when every row is on screen.
       total:current.total,offset:0,pageSize:fullyLoaded?current.total+1:0,
       readObjectApiNames:reads.some(item=>item===null)?null:[...new Set(reads.flat() as string[])],
       filters:current.serverFilters,relatedFilter:current.relatedFilter,hasUnpredictableFilter:!current.predictable}):null;
    // A sorted list keeps the server's order: after a real save, a new row or a row whose
    // sort value changed is placed by a fresh read (the database decides ties and collation).
    // A prediction still shows at once; the real save that follows puts it in its place.
    if(patched&&!detail.optimistic&&source.sortField&&movesInSort(current!.records,patched.records,source.sortField)){
     work.push(reload(source.id,Boolean(detail.live)));
     continue;
    }
    if(patched){
     // Same rows after the patch: no new snapshot, no redraw.
     if(patched.total!==current!.total||!sameRows(current!.records,patched.records))
      publish(source.id,{...current!,records:patched.records,total:patched.total,version:current!.version+1});
     continue;
    }
    // A prediction the list cannot show exactly is skipped; the real save follows.
    if(detail.optimistic)continue;
    work.push(reload(source.id,Boolean(detail.live)));
   }
   return Promise.all(work).then(()=>undefined);
  },
  /** Someone saved records of `object` (a live change). Lists over it are read again,
   * except a list that shows all its rows and none of the deleted ones (a delete cannot
   * add rows; an update could move a row into the list, so it always re-reads). */
  live(change:{object:string;ids:readonly string[];count:number;operation:string}):Promise<void>{
   const object=change.object.toLowerCase();
   const exact=change.operation==='delete'&&change.ids.length>0&&change.count<=change.ids.length;
   const changed=new Set(change.ids);
   const work:Promise<void>[]=[];
   load.invalidate?.([change.object]);
   for(const source of compiled.dataSources){
    if(!readsObject(source,[change.object])&&source.objectApiName.toLowerCase()!==object)continue;
    const current=snapshots.get(source.id);
    const ownObject=source.objectApiName.toLowerCase()===object;
    const fullyLoaded=Boolean(current&&!current.loading&&!current.hasMore&&current.records.length===current.total);
    if(exact&&ownObject&&fullyLoaded&&!current!.records.some(row=>changed.has(String(row.Id))))continue;
    work.push(reload(source.id,true));
   }
   return Promise.all(work).then(()=>undefined);
  },
  stats:()=>({loads,sources:sources.size})
 };
}
export type CompiledDataLayer=ReturnType<typeof createCompiledDataLayer>;
