import type {CompiledPage,CompiledDataSource} from './compilePage';
import {applySavedRecordMutations,type PageMutationDetail} from '../PageRuntime/pageMutationScope';

/**
 * ONE store and ONE data layer per compiled page (not one per component).
 *
 * - State: a change notifies only the components that read that key.
 * - Data: each compiled data source is loaded once and shared; a save patches
 *   the rows in place when the result is predictable, otherwise reloads only
 *   the sources that read the written Object.
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

export function createCompiledPageStore(compiled:CompiledPage,initial:State={}){
 let state:State={...initial};
 const byComponent=new Map<string,Set<Listener>>();
 const anyListeners=new Set<Listener>();
 // Keys only known at run time (STATE() results, Flow outputs): resolve readers once, then cache.
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
 return {
  get:():State=>state,
  /** Apply several changes, then notify each affected reader once. */
  merge(changes:ReadonlyArray<{key:string;value:unknown}>):string[]{
   const changed=changes.filter(change=>!Object.is(state[change.key],change.value)).map(change=>change.key);
   if(!changed.length)return [];
   const next={...state};
   for(const change of changes)next[change.key]=change.value;
   state=next;
   notify(changed);
   return changed;
  },
  set(key:string,value:unknown):boolean{return this.merge([{key,value}]).length>0;},
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
 /** Filters as resolved for the last load (used to predict saved rows). */
 serverFilters?:ReadonlyArray<{field:string;operator:string;value:string}>;predictable:boolean;version:number};
export type SourceLoad=(source:CompiledDataSource,state:State)=>Promise<{records:Record<string,unknown>[];total:number;
 serverFilters?:ReadonlyArray<{field:string;operator:string;value:string}>;predictable:boolean}|null>;

export const SOURCE_PAGE_SIZE=100;
const emptySnapshot:SourceSnapshot=Object.freeze({records:[],total:0,loading:true,error:'',predictable:false,version:0}) as SourceSnapshot;

export function createCompiledDataLayer(compiled:CompiledPage,load:SourceLoad,getState:()=>State){
 const snapshots=new Map<string,SourceSnapshot>();
 const listeners=new Map<string,Set<Listener>>();
 const requests=new Map<string,number>();
 const sources=new Map(compiled.dataSources.map(source=>[source.id,source]));
 const componentReads=new Map(compiled.components.map(item=>[item.id,item.objectReads]));
 let loads=0;
 const publish=(id:string,next:SourceSnapshot)=>{
  snapshots.set(id,next);
  listeners.get(id)?.forEach(listener=>listener());
 };
 const reload=async(id:string):Promise<void>=>{
  const source=sources.get(id);
  if(!source)return;
  const request=(requests.get(id)??0)+1;
  requests.set(id,request);
  const previous=snapshots.get(id)??emptySnapshot;
  // Keep showing current rows while the same source refreshes (no blank flash).
  if(!previous.loading)publish(id,{...previous,loading:true});
  loads++;
  try{
   const result=await load(source,getState());
   if(requests.get(id)!==request)return;
   publish(id,result
    ?{records:result.records,total:result.total,loading:false,error:'',serverFilters:result.serverFilters,
      predictable:result.predictable,version:previous.version+1}
    :{records:[],total:0,loading:false,error:'',predictable:false,version:previous.version+1});
  }catch(error){
   if(requests.get(id)!==request)return;
   publish(id,{...previous,loading:false,error:error instanceof Error?error.message:'Unable to load records',
    version:previous.version+1});
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
  reload,
  /** Only sources whose filter reads a changed state key reload. */
  stateChanged(keys:readonly string[]):Promise<void>{
   const changed=new Set(keys);
   return Promise.all(compiled.dataSources.filter(source=>source.stateInputs.some(key=>changed.has(key)))
    .map(source=>reload(source.id))).then(()=>undefined);
  },
  /** A save (or a prediction of one): patch rows in place when exact, else reload only readers. */
  saved(detail:PageMutationDetail):Promise<void>{
   const written=detail.objectApiNames;
   const work:Promise<void>[]=[];
   for(const source of compiled.dataSources){
    if(written&&!readsObject(source,written))continue;
    const current=snapshots.get(source.id);
    const reads=source.components.map(id=>componentReads.get(id));
    const patched=written&&current&&!current.loading
     ?applySavedRecordMutations(current.records,source.objectApiName,detail,{
       total:current.total,offset:0,pageSize:SOURCE_PAGE_SIZE,
       readObjectApiNames:reads.some(item=>item===null)?null:[...new Set(reads.flat() as string[])],
       filters:current.serverFilters,hasUnpredictableFilter:!current.predictable}):null;
    if(patched){publish(source.id,{...current!,records:patched.records,total:patched.total,version:current!.version+1});continue;}
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
