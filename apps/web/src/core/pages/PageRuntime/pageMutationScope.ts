import {Parser,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {isActionPlan} from '../../../../../server/src/expression-engine/ActionFormulas.js';
/** Object-scoped page invalidation. Unscoped events remain compatible with existing Flows. */
export type SavedRecordMutation={
 objectApiName:string;operation:'create'|'update'|'delete';record:Readonly<Record<string,unknown>>;
};
export type PageMutationDetail={
 pageSessionKey?:string;
 sessionId?:string;
 /** Exact objects written by a Formula/record action; omitted for unknown Flow writes. */
 objectApiNames?:readonly string[];
 /** Authorized saved fields only, never the untrusted submitted write body. */
 recordChanges?:readonly SavedRecordMutation[];
 /** Show-first prediction batch: rows are provisional until the real save. */
 optimistic?:string;
 /** The real save that replaces a prediction batch's provisional rows. */
 replacesOptimistic?:string;
};


/** Shared with the server-side page compiler. */
import {pageComponentReadObjectNames} from '../../../../../server/src/page-compiler/pageCompilerSupport.js';
export {pageComponentReadObjectNames};

export function shouldInvalidatePageComponent(detail:PageMutationDetail|undefined,
 pageSessionKey:string,sessionId:string,readObjectApiNames:readonly string[]|null):boolean{
 if(detail?.pageSessionKey!==pageSessionKey)return false;
 if(detail.sessionId&&detail.sessionId!==sessionId)return true;
 if(!Array.isArray(detail.objectApiNames)||detail.objectApiNames.length===0||readObjectApiNames===null)return true;
 return readObjectApiNames.some(name=>Boolean(name)&&detail.objectApiNames!.includes(name));
}

/** Fast path only for an existing complete row in an already authorized,
 * unfiltered and fully loaded page. Other mutations force ordinary refresh.
 */
export function applyCompleteRecordMutation(
 rows:ReadonlyArray<Record<string,unknown>>,objectApiName:string,
 detail:PageMutationDetail|undefined
):Record<string,unknown>[]|null{
 const changes=detail?.recordChanges;
 if(!Array.isArray(changes)||!changes.length||!rows.length)return null;
 const own=changes.filter(c=>c.objectApiName===objectApiName);
 if(!own.length||own.some(c=>c.operation!=='update'||!c.record||
  typeof c.record.Id!=='string'))return null;
 if(!Array.isArray(detail?.objectApiNames)||!detail.objectApiNames.includes(objectApiName))
  return null;
 const next=rows.map(row=>({...row}));
 for(const change of own){
  const index=next.findIndex(row=>row.Id===change.record.Id);
  if(index<0)return null;
  const old=next[index];
  if(Object.keys(old).some(field=>!Object.hasOwn(change.record,field)))return null;
  next[index]={...old,...change.record};
 }
 return next;
}

export type LoadedRecordListScope={
 /** Total rows the server reported for this exact query. */
 total:number;
 /** Rows already on screen came from page one. */
 offset:number;
 pageSize:number;
 /** Objects this component reads (null = unknown, always refresh). */
 readObjectApiNames:readonly string[]|null;
 relatedFilter?:{field:string;value:string;related:boolean};
 filters?:ReadonlyArray<{field:string;operator:string;value:string|string[]}>;
 /** A formula, presenter or client-only filter means rows cannot be predicted. */
 hasUnpredictableFilter:boolean;
};

/** Saved records (create/update/delete) applied to a list already on screen,
 * so a till cart shows a new line from the save response with no re-query.
 * Returns null whenever the result could differ from a fresh server read;
 * the caller then refreshes as before.
 */
type DependencyObject={apiName:string;fields?:ReadonlyArray<{apiName?:string;dataType?:string;
 rollup?:{childObject?:string};formula?:{expression?:string};relationship?:{targetObject?:string}}>};
/** Objects whose values the server recalculates when `written` change: Roll-Up Summary parents
 * (and their parents), and objects with formula fields that read a written object across a lookup.
 * A save reloads only these extra readers; nothing else is refreshed. */
export function withDependentObjects(written:readonly string[]|undefined,
 objects:readonly DependencyObject[]|undefined):readonly string[]|undefined{
 if(!written||!written.length||!objects?.length)return written;
 const out=new Set(written);
 for(let grew=true;grew;){
  grew=false;
  for(const object of objects){
   if(out.has(object.apiName))continue;
   const depends=(object.fields??[]).some(field=>{
    if(field.rollup?.childObject&&out.has(field.rollup.childObject))return true;
    const expression=field.formula?.expression;
    if(!expression)return false;
    return (object.fields??[]).some(lookup=>lookup.relationship?.targetObject&&out.has(lookup.relationship.targetObject)
     &&lookup.apiName&&new RegExp('(^|[^A-Za-z0-9_])'+lookup.apiName+'\\.').test(expression));
   });
   if(depends){out.add(object.apiName);grew=true;}
  }
 }
 return out.size===written.length?written:[...out];
}
export function applySavedRecordMutations(
 rows:ReadonlyArray<Record<string,unknown>>,objectApiName:string,
 detail:PageMutationDetail|undefined,scope:LoadedRecordListScope
):{records:Record<string,unknown>[];total:number}|null{
 const changes=detail?.recordChanges;
 const written=detail?.objectApiNames;
 if(!Array.isArray(changes)||!changes.length||!Array.isArray(written))return null;
 if(scope.hasUnpredictableFilter||scope.offset!==0||scope.readObjectApiNames===null)return null;
 // Any other Object this component reads (lookups, aggregates) changed too: refresh.
 if(scope.readObjectApiNames.some(name=>name!==objectApiName&&written.includes(name)))return null;
 if(!written.includes(objectApiName))return null;
 const own=changes.filter(change=>change.objectApiName===objectApiName);
 if((scope.filters?.length??0)>1)return null;
 // Remove the provisional rows of the prediction this real save replaces.
 const provisional=detail?.replacesOptimistic?'ffffffff-ffff-4fff-8fff-'+detail.replacesOptimistic:null;
 const kept=provisional?rows.filter(row=>!(typeof row.Id==='string'&&row.Id.startsWith(provisional))):rows;
 const removed=rows.length-kept.length;
 rows=kept;
 if(!own.length)return removed?{records:[...rows],total:scope.total-removed}:null;
 // Only a fully loaded list can take an insert or delete without a page shift.
 if(rows.length!==scope.total-removed||scope.total>=scope.pageSize)return null;
 // New rows must carry every column the list already shows (formula fields etc.).
 const columns=rows.length?Object.keys(rows[0]):null;
 const matches=(record:Readonly<Record<string,unknown>>):boolean|null=>{
  const related=scope.relatedFilter;
  if(related){
   if(!Object.hasOwn(record,related.field))return null;
   if(String(record[related.field]??'')!==related.value)return false;
  }
  for(const filter of scope.filters??[]){
   if(filter.operator!=='eq'||typeof filter.value!=='string')return null;
   if(!Object.hasOwn(record,filter.field))return null;
   if(String(record[filter.field]??'')!==filter.value)return false;
  }
  return true;
 };
 let next=rows.map(row=>({...row}));
 let total=scope.total-removed;
 for(const change of own){
  const record=change.record;
  if(!record||typeof record.Id!=='string')return null;
  const index=next.findIndex(row=>row.Id===record.Id);
  if(change.operation==='delete'){
   if(index>=0){next.splice(index,1);total--;}
   continue;
  }
  // A prediction may lack server-filled columns (owner, record type): show
  // them blank until the real save, never refuse a provisional row for it.
  // An empty list has no column template: the saved record is the row.
  if(columns&&!detail?.optimistic&&columns.some(field=>!Object.hasOwn(record,field)))return null;
  const fits=matches(record);
  if(fits===null)return null;
  if(index>=0){
   if(fits)next[index]={...next[index],...record};
   else{next.splice(index,1);total--;}
  }else if(fits){
   if(change.operation!=='create')return null;
   next=[...next,detail?.optimistic&&columns
    ?{...Object.fromEntries(columns.map(field=>[field,null])),...record}:{...record}];total++;
  }
 }
 return {records:next,total};
}
