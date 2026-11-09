/**
 * Shared, per-sign-in store of COMPLETE record sets the page already read
 * through the RBAC-enforced Record API (e.g. "CartLine where session = X and
 * Status = Open"). Saves patch these sets from the server's saved records, so
 * totals and carts update without re-querying. SQL stays the source of truth:
 * any write the store cannot apply exactly drops the affected sets, and the
 * next reader loads them again from the server.
 */
export type SetFilter={field:string;operator:'eq';value:string};
type Row=Record<string,unknown>;
type RecordSet={object:string;filters:SetFilter[];rows:Map<string,Row>;usedAt:number;loadedAt:number};
type Change={objectApiName:string;operation:'create'|'update'|'delete';record:Row};
type Mutation={objectApiNames?:readonly string[];recordChanges?:readonly Change[];
 optimistic?:string;replacesOptimistic?:string};

const maxSets=64;
const maxRows=100;
// Writes from other devices are only seen on reload: re-read a set after this
// long. Writes from this browser patch held sets exactly. A till idles for
// minutes between sales, so a short window would re-load on the next tap.
const freshForMs=10*60_000;
let scope:string|undefined;
let generation=0;
const sets=new Map<string,RecordSet>();
const loading=new Map<string,Promise<RecordSet|null>>();
// Broad sets that were too large to hold: go straight to the exact query.
const tooLarge=new Set<string>();

const keyOf=(object:string,filters:readonly SetFilter[])=>JSON.stringify([object,
 [...filters].sort((a,b)=>a.field<b.field?-1:a.field>b.field?1:a.value<b.value?-1:1)
  .map(f=>[f.field,f.value])]);
const rowId=(row:Row)=>typeof row.Id==='string'?row.Id:null;

/** Exact string equality only; anything else is "unknown" (null). */
function rowMatches(row:Row,filters:readonly SetFilter[]):boolean|null{
 for(const filter of filters){
  if(!Object.prototype.hasOwnProperty.call(row,filter.field))return null;
  const value=row[filter.field];
  if(value===null||value===undefined||value==='')return false;
  if(typeof value!=='string')return null;
  if(value!==filter.value)return false;
 }
 return true;
}

function touchScope(current:string|undefined){
 if(current!==scope){scope=current;sets.clear();loading.clear();tooLarge.clear();generation++;}
}

function evict(){
 if(sets.size<=maxSets)return;
 const oldest=[...sets.entries()].sort((a,b)=>a[1].usedAt-b[1].usedAt)[0];
 if(oldest)sets.delete(oldest[0]);
}

/** Record a complete first page read through the Record API. */
export function rememberCompleteRecordSet(currentScope:string|undefined,object:string,
 filters:readonly SetFilter[],rows:readonly Row[],total:number,readGeneration:number){
 touchScope(currentScope);
 if(readGeneration!==generation)return;
 if(total>rows.length||rows.length>maxRows)return;
 if(rows.some(row=>!rowId(row)))return;
 const set:RecordSet={object,filters:[...filters],rows:new Map(),usedAt:Date.now(),loadedAt:Date.now()};
 for(const row of rows)set.rows.set(rowId(row)!,{...row});
 sets.set(keyOf(object,filters),set);
 evict();
}
export function recordSetGeneration(currentScope:string|undefined){touchScope(currentScope);return generation;}

/** Rows matching ALL filters, answered from any complete set whose filters are a subset. */
export function heldRows(currentScope:string|undefined,object:string,
 filters:readonly SetFilter[]):Row[]|null{
 touchScope(currentScope);
 const now=Date.now();
 for(const [key,set] of [...sets.entries()]){
  if(now-set.loadedAt>freshForMs){sets.delete(key);continue;}
  if(set.object!==object)continue;
  if(!set.filters.every(f=>filters.some(q=>q.field===f.field&&q.value===f.value)))continue;
  const extra=filters.filter(q=>!set.filters.some(f=>f.field===q.field&&f.value===q.value));
  const out:Row[]=[];
  for(const row of set.rows.values()){
   const match=rowMatches(row,extra);
   if(match===null)return null;
   if(match)out.push(row);
  }
  set.usedAt=Date.now();
  return out;
 }
 return null;
}

/** Load (once, shared by all callers) and return complete rows, or null when too many. */
export async function rowsForFilters(currentScope:string|undefined,object:string,
 filters:readonly SetFilter[],
 load:(object:string,filters:SetFilter[])=>Promise<{records:Row[];total:number}>):Promise<Row[]|null>{
 const held=heldRows(currentScope,object,filters);
 if(held)return held;
 // Load the broadest small set first (the first criterion is the parent, e.g.
 // "lines of this cart"): later questions about one product, open lines or
 // totals are answered from it in memory instead of one request each.
 if(filters.length>1&&!tooLarge.has(keyOf(object,filters.slice(0,1)))){
  const coarse=await loadSet(currentScope,object,filters.slice(0,1),load);
  if(coarse){
   const answer=heldRows(currentScope,object,filters);
   if(answer)return answer;
  }
 }
 const exact=await loadSet(currentScope,object,filters,load);
 return exact?heldRows(currentScope,object,filters)??[...exact.rows.values()]:null;
}

async function loadSet(currentScope:string|undefined,object:string,filters:readonly SetFilter[],
 load:(object:string,filters:SetFilter[])=>Promise<{records:Row[];total:number}>):Promise<RecordSet|null>{
 const key=keyOf(object,filters);
 let pending=loading.get(key);
 if(!pending){
  const started=generation;
  pending=load(object,[...filters]).then(page=>{
   loading.delete(key);
   if(page.total>maxRows||page.total>page.records.length)tooLarge.add(key);
   rememberCompleteRecordSet(currentScope,object,filters,page.records,page.total,started);
   return sets.get(key)??null;
  },error=>{loading.delete(key);throw error;});
  loading.set(key,pending);
 }
 return pending;
}

/** Apply a page save. Exact when the saved records carry every filter field;
 * otherwise the affected sets are dropped and reload on next use. */
export function applyRecordSetMutation(detail:Mutation|undefined){
 generation++;
 loading.clear();
 if(detail?.replacesOptimistic){
  // The real save replaces this prediction's provisional rows.
  // Same reserved range as predictActionPlan's provisional Ids.
  const prefix='ffffffff-ffff-4fff-8fff-'+detail.replacesOptimistic;
  for(const set of sets.values())
   for(const id of [...set.rows.keys()])if(id.startsWith(prefix))set.rows.delete(id);
 }
 const written=Array.isArray(detail?.objectApiNames)?detail!.objectApiNames:null;
 if(!written||!written.length){sets.clear();return;}
 const changes=Array.isArray(detail?.recordChanges)?detail!.recordChanges:[];
 for(const [key,set] of [...sets.entries()]){
  if(!written.includes(set.object))continue;
  const own=changes.filter(change=>change.objectApiName===set.object);
  if(!own.length){sets.delete(key);continue;}
  let exact=true;
  for(const change of own){
   const record=change.record;
   const id=record&&rowId(record);
   if(!id){exact=false;break;}
   if(change.operation==='delete'){set.rows.delete(id);continue;}
   const match=rowMatches(record,set.filters);
   if(match===null){exact=false;break;}
   const existing=set.rows.get(id);
   if(match){
    const next={...(existing??{}),...record};
    // A row must keep every column the set already shows.
    const sample=set.rows.values().next().value as Row|undefined;
    if(!existing&&sample&&!detail?.optimistic&&
      Object.keys(sample).some(field=>!Object.prototype.hasOwnProperty.call(next,field))){
     exact=false;break;
    }
    set.rows.set(id,next);
   }else set.rows.delete(id);
  }
  if(!exact||set.rows.size>maxRows)sets.delete(key);
 }
}

/** A held row by Id from any fresh set (used to predict an update). */
export function heldRowById(currentScope:string|undefined,object:string,id:string):Row|null{
 touchScope(currentScope);
 const now=Date.now();
 for(const set of sets.values()){
  if(set.object!==object||now-set.loadedAt>freshForMs)continue;
  const row=set.rows.get(id);
  if(row)return row;
 }
 return null;
}
