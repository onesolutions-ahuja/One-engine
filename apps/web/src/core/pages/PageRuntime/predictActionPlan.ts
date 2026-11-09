/**
 * Show-first saves. Runs an Action Formula in the browser against record sets
 * the page already holds, with simulated writes, to PREDICT what the server
 * will save. The prediction is shown at once; the real save still runs on the
 * server and its saved records replace the prediction (or a failure refreshes).
 * Nothing here writes data or decides permissions. Any step the prediction
 * cannot answer exactly from held rows makes it give up (no prediction).
 */
import {executeActionFormula} from '../../../component-libraries/shared/FieldExpression.js';
import {getLocalRecordSetProvider} from '../../../component-libraries/shared/localRecordSets.js';

type Row=Record<string,unknown>;
export type PredictedChange={objectApiName:string;operation:'create'|'update'|'delete';record:Row};
export type Prediction={batch:string;changes:{key:string;value:unknown}[];
 objectApiNames:string[];recordChanges:PredictedChange[]};

class CannotPredict extends Error {}
const no=(reason:string):never=>{throw new CannotPredict(reason);};
const plain=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let batches=Math.floor(Math.random()*0x10000)*0x1000;

/** Provisional Ids of predicted creates are valid UUIDs (the action engine
 * checks the shape) in a reserved range; the real save removes them. */
const provisionalRange='ffffffff-ffff-4fff-8fff-';
export const optimisticIdPrefix=(batch:string)=>provisionalRange+batch;
export const isOptimisticId=(id:unknown)=>typeof id==='string'&&id.startsWith(provisionalRange);

export async function predictActionPlan(formula:string,scope:Row,
 context:Parameters<typeof executeActionFormula>[2]):Promise<Prediction|null>{
 const provider=getLocalRecordSetProvider() as null|{
  rowsFor:(object:string,filters:{field:string;operator:'eq';value:string}[])=>Promise<Row[]|null>;
  rowById?:(object:string,id:string)=>Row|null;
 };
 if(!provider?.rowById)return null;
 const batch=((++batches)%0x10000000).toString(16).padStart(8,'0');
 let created=0;
 // Simulated writes, newest last: object -> Id -> row | null (deleted).
 const overlay=new Map<string,Map<string,Row|null>>();
 const written=(object:string)=>{
  let map=overlay.get(object);
  if(!map){map=new Map();overlay.set(object,map);}
  return map;
 };
 const recordChanges:PredictedChange[]=[];
 const matches=(row:Row,filters:{field:string;value:string}[])=>filters.every(filter=>{
  const value=row[filter.field];
  if(value===null||value===undefined)return false;
  if(typeof value!=='string')no('Non-text criterion');
  return value===filter.value;
 });
 const list=async(object:string,filters:{field:string;operator:'eq';value:string}[])=>{
  const base=await provider.rowsFor(object,filters);
  if(!base)no('Rows not held');
  const rows=new Map<string,Row>();
  for(const row of base!)if(typeof row.Id==='string')rows.set(row.Id,row);
  for(const [id,row] of overlay.get(object)??[]){
   if(row&&matches(row,filters))rows.set(id,row);else rows.delete(id);
  }
  // Server order is not guaranteed; oldest first is the stable choice.
  return [...rows.values()].sort((a,b)=>String(a.CreatedAt??'').localeCompare(String(b.CreatedAt??'')));
 };
 const current=(object:string,id:string):Row=>{
  const local=overlay.get(object)?.get(id);
  if(local===null)no('Deleted');
  if(local)return local;
  const held=provider.rowById!(object,id);
  if(!held)no('Row not held');
  return held!;
 };
 const request=async<T>(path:string,init?:{method:string;body?:string}):Promise<T>=>{
  const url=new URL(path,'http://predict.invalid');
  const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if(parts[0]!=='records'||!plain.test(parts[1]??''))no('Unsupported request');
  const object=parts[1];
  const method=(init?.method??'GET').toUpperCase();
  if(method==='GET'&&parts.length===2){
   if(url.searchParams.get('cursor'))no('Paging');
   const raw=JSON.parse(url.searchParams.get('filters')??'[]');
   if(!Array.isArray(raw)||raw.some(f=>!f||f.operator!=='eq'||!plain.test(String(f.field))
     ||typeof f.value!=='string'||!f.value))no('Unsupported filter');
   const rows=await list(object,raw);
   const limit=Number(url.searchParams.get('limit')??'100');
   return {records:rows.slice(0,limit),total:rows.length} as T;
  }
  if(method==='GET'&&parts.length===3)return {record:current(object,parts[2])} as T;
  const now=new Date().toISOString();
  if(method==='POST'&&parts.length===2){
   const body=JSON.parse(init?.body??'{}') as Row;
   if(created>=0xffff)no('Too many creates');
   const record:Row={...body,Id:optimisticIdPrefix(batch)+(created++).toString(16).padStart(4,'0'),
    CreatedAt:now,LastModifiedDate:now};
   written(object).set(record.Id as string,record);
   recordChanges.push({objectApiName:object,operation:'create',record});
   return {record} as T;
  }
  if((method==='PUT'||method==='PATCH')&&parts.length===3){
   const id=parts[2];
   if(!uuid.test(id))no('Bad Id');
   const body=JSON.parse(init?.body??'{}') as Row;
   const record:Row={...current(object,id),...body,Id:id,LastModifiedDate:now};
   written(object).set(id,record);
   recordChanges.push({objectApiName:object,operation:'update',record});
   return {record} as T;
  }
  if(method==='DELETE'&&parts.length===3){
   const id=parts[2];
   current(object,id);
   written(object).set(id,null);
   recordChanges.push({objectApiName:object,operation:'delete',record:{Id:id}});
   return {} as T;
  }
  return no('Unsupported request');
 };
 try{
  // PRINT returns nothing and changes no record: skipped in the prediction (the
  // real run prints). SCREEN/NAVIGATE can return user input, CREATEPDF writes a
  // file, Flows and HTTP run server logic: those are not predicted.
  const result=await executeActionFormula(formula,scope,context,{request,useSqlAggregates:false,
   print:async()=>{}}) as {
   changes?:{key:string;value:unknown}[];mutatedObjectApiNames?:string[]};
  if(!recordChanges.length)return null;
  if(typeof window!=='undefined'){
   const host=window as unknown as {__metadrivePredict?:Record<string,number>};
   const stats=host.__metadrivePredict??=({} as Record<string,number>);
   stats.predicted=(stats.predicted??0)+1;
  }
  return {batch,changes:result.changes??[],
   objectApiNames:[...new Set(recordChanges.map(change=>change.objectApiName))],recordChanges};
 }catch(error){
  // Missing rows, unsupported steps (print, flows, HTTP) or any engine error: no prediction.
  if(typeof window!=='undefined'){
   const host=window as unknown as {__metadrivePredict?:Record<string,number>};
   const stats=host.__metadrivePredict??=({} as Record<string,number>);
   const reason=error instanceof Error?error.message:'error';
   stats[reason]=(stats[reason]??0)+1;
  }
  return null;
 }
}
