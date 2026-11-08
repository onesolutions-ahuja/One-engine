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
};


/** Inspect metadata formulas (not selector lists) for actual Object reads.
 * Unparseable expressions return null: a conservative invalidate-all fallback.
 */
export function pageComponentReadObjectNames(
 primaryObject:string,properties:Readonly<Record<string,unknown>>,
 knownObjects:readonly {apiName:string;fields?:readonly {apiName:string;dataType?:string}[]}[]
):string[]|null{
 const known=new Set(knownObjects.map(object=>object.apiName));
 const selected=new Set(Object.entries(properties).filter(([key])=>
  /^objectApiName(?:[2-9]|[1-9][0-9]+)?$/.test(key))
  .map(([,value])=>String(value??'')).filter(name=>known.has(name)));
 const reads=new Set<string>();
 if(primaryObject)reads.add(primaryObject);
 for(const [property,value] of Object.entries(properties)){
  if(typeof value!=='string'||/^objectApiName/.test(property))continue;
  const expression=value.trim();
  if(!expression||(!expression.startsWith('=')&&!expression.startsWith('@')
    &&!/(?:TABLE|COLLECTION)\s*\(/i.test(expression)))continue;
  // A click/change Action Formula (ACTIONS, CREATERECORD, UPDATERECORD, ...) runs only when the
  // user acts; it is not data this component DISPLAYS. Counting it made a Product grid look like
  // a reader of CartLine/Cart, so every add-to-cart reloaded the whole catalogue.
  if(isActionPlan(expression))continue;
  let node:Expression;
  try{node=new Parser(tokenize(expression.replace(/^=\s*/,''))).parse();}
  catch{return null;}
  const visit=(ast:Expression):void=>{
   if(ast.kind==='reference'){
    const parts=ast.value.replace(/^@/,'').split('.');
    const first=parts[0];
    if(known.has(first)&&(first===primaryObject||selected.has(first)))reads.add(first);
    const field=knownObjects.find(object=>object.apiName===primaryObject)
     ?.fields?.find(item=>item.apiName===first);
    const lookup=field?.dataType?.match(/^Lookup\(([^)]+)\)$/i)?.[1];
    if(parts.length>1&&lookup&&known.has(lookup))reads.add(lookup);
   }else if(ast.kind==='call'){
    // Aggregate reads are dependencies even when the Object was not selected as
    // a component's primary/secondary record source. A CartLine write must
    // refresh =COUNTIFS(CartLine, ...) and =SUMIFS(CartLine, ...).
    if(['COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS'].includes(ast.name)){
     const source=ast.args[0];
     if(source&&(source.kind==='reference'||source.kind==='literal')
       &&typeof source.value==='string'&&known.has(source.value))
      reads.add(source.value);
    }
    if((ast.name==='TABLE'||ast.name==='COLLECTION')&&ast.args[0]?.kind==='reference'){
     const name=ast.args[0].value.replace(/^@/,'').split('.')[0];
     // Conservative: a missed read leaves stale data, an extra read only costs a refresh.
     if(known.has(name))reads.add(name);
    }
    ast.args.forEach(visit);
   }else if(ast.kind==='unary')visit(ast.value);
   else if(ast.kind==='binary'){visit(ast.left);visit(ast.right);}
  };
  visit(node);
 }
 return [...reads];
}

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
 if(!own.length)return null;
 if((scope.filters?.length??0)>1)return null;
 // Only a fully loaded list can take an insert or delete without a page shift.
 if(rows.length!==scope.total||scope.total>=scope.pageSize)return null;
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
 let total=scope.total;
 for(const change of own){
  const record=change.record;
  if(!record||typeof record.Id!=='string')return null;
  const index=next.findIndex(row=>row.Id===record.Id);
  if(change.operation==='delete'){
   if(index>=0){next.splice(index,1);total--;}
   continue;
  }
  if(!columns||columns.some(field=>!Object.hasOwn(record,field)))return null;
  const fits=matches(record);
  if(fits===null)return null;
  if(index>=0){
   if(fits)next[index]={...next[index],...record};
   else{next.splice(index,1);total--;}
  }else if(fits){
   if(change.operation!=='create')return null;
   next=[...next,{...record}];total++;
  }
 }
 return {records:next,total};
}
