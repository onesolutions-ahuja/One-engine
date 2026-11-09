import type {CompiledPage,CompiledDataSource} from './compilePage';
import {applySavedRecordMutations,type PageMutationDetail} from '../PageRuntime/pageMutationScope';
import {applyPageSelection,changedPageStateNames,type PageStateDependencies} from '../PageRuntime/pageStateDependencies';

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

export function createCompiledPageStore(compiled:CompiledPage,initial:State={},
 dependencies:PageStateDependencies=new Map()){
 let state:State={...initial};
 const byComponent=new Map<string,Set<Listener>>();
 const anyListeners=new Set<Listener>();
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
  subscribeComponent(id:string,listener:Listener):()=>void{
   const set=byComponent.get(id)??new Set<Listener>();
   set.add(listener);byComponent.set(id,set);
   return ()=>{set.delete(listener);};
  },
  subscribeAll(listener:Listener):()=>void{anyListeners.add(listener);return ()=>{anyListeners.delete(listener);};},
  readersOf
 };
}
export type CompiledPageStore=ReturnType<typeof createCompiledPageStore>;

export type SourceSnapshot={records:Record<string,unknown>[];total:number;loading:boolean;error:string;
 /** More rows exist on the server; loadMore fetches the next page. */
 hasMore:boolean;loadingMore:boolean;
 /** Filters as resolved for the last load (used to predict saved rows). */
 serverFilters?:ReadonlyArray<{field:string;operator:string;value:string}>;
 relatedFilter?:{field:string;value:string;related:boolean};predictable:boolean;version:number};
export type SourceLoadResult={records:Record<string,unknown>[];total:number;
 serverFilters?:ReadonlyArray<{field:string;operator:string;value:string}>;predictable:boolean;
 relatedFilter?:{field:string;value:string;related:boolean};
 /** The loader could not page (client-side filter): rows are all it will return. */
 paged:boolean};
export type SourceLoad=((source:CompiledDataSource,state:State,window:{offset:number;limit:number})=>
 Promise<SourceLoadResult|null>)&{invalidate?(objectApiNames?:readonly string[]):void};

/** Rows per page while scrolling. */
export const SOURCE_PAGE_SIZE=50;
/** A complete (collection) source never loads more than this. */
export const COMPLETE_SOURCE_LIMIT=200;
/** Record API maximum per request. */
const API_LIMIT=100;
const emptySnapshot:SourceSnapshot=Object.freeze({records:[],total:0,loading:true,error:'',hasMore:false,
 loadingMore:false,predictable:false,version:0}) as SourceSnapshot;

export function createCompiledDataLayer(compiled:CompiledPage,load:SourceLoad,getState:()=>State){
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
 const publish=(id:string,next:SourceSnapshot)=>{
  snapshots.set(id,next);
  listeners.get(id)?.forEach(listener=>listener());
 };
 /** Read rows [0, count) in Record API sized pages. */
 const readRows=async(source:CompiledDataSource,count:number):Promise<SourceLoadResult|null>=>{
  const state=getState();
  let merged:SourceLoadResult|null=null;
  for(let offset=0;offset<count;){
   loads++;
   const page=await load(source,state,{offset,limit:Math.min(API_LIMIT,count-offset)});
   if(!page)return null;
   merged=merged?{...page,records:[...merged.records,...page.records]}:page;
   if(!page.paged||page.records.length===0||merged.records.length>=page.total)break;
   offset=merged.records.length;
  }
  if(merged&&source.complete&&merged.total>COMPLETE_SOURCE_LIMIT)
   throw Error(source.objectApiName+' has more records than a collection can safely load; narrow its filters');
  return merged;
 };
 const reload=async(id:string):Promise<void>=>{
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
   const result=await readRows(source,count);
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
  start:():Promise<void>=>Promise.all([...sources.keys()].map(reload)).then(()=>undefined),
  reload,loadMore,
  /** Only sources whose filter reads a changed state key reload. */
  stateChanged(keys:readonly string[]):Promise<void>{
   const changed=new Set(keys.map(key=>key.toLowerCase()));
   return Promise.all(compiled.dataSources.filter(source=>source.stateInputs.some(key=>changed.has(key.toLowerCase())))
    .map(source=>reload(source.id))).then(()=>undefined);
  },
  /** A save (or a prediction of one): patch rows in place when exact, else reload only readers. */
  saved(detail:PageMutationDetail):Promise<void>{
   const written=detail.objectApiNames;
   const work:Promise<void>[]=[];
   // A new or deleted parent (a cart) is rediscovered on the next read.
   if(!detail.optimistic)load.invalidate?.(written);
   for(const source of compiled.dataSources){
    if(written&&!readsObject(source,written))continue;
    const current=snapshots.get(source.id);
    const reads=source.components.map(id=>componentReads.get(id));
    const fullyLoaded=Boolean(current&&!current.hasMore&&current.records.length===current.total);
    const patched=written&&current&&!current.loading&&!refreshing.has(source.id)
     ?applySavedRecordMutations(current.records,source.objectApiName,detail,{
       // Inserts and deletes are exact only when every row is on screen.
       total:current.total,offset:0,pageSize:fullyLoaded?current.total+1:0,
       readObjectApiNames:reads.some(item=>item===null)?null:[...new Set(reads.flat() as string[])],
       filters:current.serverFilters,relatedFilter:current.relatedFilter,hasUnpredictableFilter:!current.predictable}):null;
    if(patched){
     // Same rows after the patch: no new snapshot, no redraw.
     if(patched.total!==current!.total||!sameRows(current!.records,patched.records))
      publish(source.id,{...current!,records:patched.records,total:patched.total,version:current!.version+1});
     continue;
    }
    // A prediction the list cannot show exactly is skipped; the real save follows.
    if(detail.optimistic)continue;
    work.push(reload(source.id));
   }
   return Promise.all(work).then(()=>undefined);
  },
  stats:()=>({loads,sources:sources.size})
 };
}
export type CompiledDataLayer=ReturnType<typeof createCompiledDataLayer>;
