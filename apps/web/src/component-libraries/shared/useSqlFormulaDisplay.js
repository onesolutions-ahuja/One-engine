import {evaluatePageActionSql} from './SqlFormulaPageRequest.js';
import {getSqlFormulaRequest} from './SqlFormulaRequest.js';
import {Parser} from '../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../server/src/expression-engine/FormulaTokenizer.js';
import {SQL_QUERY_FORMULAS,SQL_RECORD_AGGREGATES} from '../../../../server/src/expression-engine/FormulaCategories.js';

// Only query formulas (aggregates, SUM) need the server. A display formula made
// only of logical/scalar functions (=ROUND(@Price,2), =IF(...), =UPPER(@Name))
// is evaluated locally, so a 100-card grid costs zero formula requests.
const hasSql=node=>node.kind==='call'
 ?SQL_QUERY_FORMULAS.has(node.name)||node.args.some(hasSql)
 :node.kind==='binary'?hasSql(node.left)||hasSql(node.right)
 :node.kind==='unary'?hasSql(node.value):false;

/** Detect query functions by the shared parser; literal content is never sent as a query.
 * Called for every property on every render, so the parse result is memoised. */
const selectedCache=new Map();
export function isSelectedSqlFormula(value){
 if(typeof value!=='string'||value.length>4000)return false;
 const cached=selectedCache.get(value);
 if(cached!==undefined)return cached;
 let result=false;
 try{result=hasSql(new Parser(tokenize(value)).parse());}catch{result=false;}
 if(selectedCache.size>1000)selectedCache.clear();
 selectedCache.set(value,result);
 return result;
}
const scalar=value=>
 value===null||typeof value==='string'||typeof value==='boolean'
 ||typeof value==='number'&&Number.isFinite(value);
const snapshot=record=>record?Object.fromEntries(
 Object.entries(record).filter(([,value])=>scalar(value)).slice(0,80)):{};
const recordKey=record=>JSON.stringify(snapshot(record));
const jobKey=(formula,record)=>JSON.stringify([formula,recordKey(record)]);

/** A formula that never reads the current row (session totals, cart sums, counts) has
 * ONE answer for every row. Asking once per row turned a 97-line cart into 97 identical
 * queries per formula. Aggregate object/field names are metadata, not row references;
 * only criterion VALUES, plain fields, Id and $event values depend on the row. */
const independentCache=new Map();
const dependsOnRow=node=>{
 if(node.kind==='reference'){
  const name=node.value;
  return !name.startsWith('$')||name.startsWith('$event.');
 }
 if(node.kind==='call'){
  if(SQL_RECORD_AGGREGATES.has(node.name)){
   const criteria=node.args.slice(node.name==='COUNTIFS'?1:2);
   return criteria.some((arg,index)=>index%2===1&&dependsOnRow(arg));
  }
  if(node.name==='SUM'&&node.args[0]?.kind==='reference')return false;
  return node.args.some(dependsOnRow);
 }
 if(node.kind==='unary')return dependsOnRow(node.value);
 if(node.kind==='binary')return dependsOnRow(node.left)||dependsOnRow(node.right);
 return false;
};
export function isRowIndependentFormula(value){
 if(typeof value!=='string'||value.length>4000)return false;
 if(independentCache.has(value))return independentCache.get(value);
 let result=false;
 try{result=!dependsOnRow(new Parser(tokenize(value)).parse());}catch{result=false;}
 if(independentCache.size>500)independentCache.clear();
 independentCache.set(value,result);
 return result;
}
const lookupKey=(formula,record)=>jobKey(formula,isRowIndependentFormula(formula)?{}:record);

/** Objects a formula aggregates over (COUNTIFS(CartLine,...), SUMIFS(Cart,...)). A write to one of
 * these changes the answer even when no row, state or session value on the page changed.
 * Row-field formulas are driven by their (reloaded) rows and need no mutation signal. */
const aggregateCache=new Map();
const collectAggregateObjects=(node,found)=>{
 if(node.kind==='call'){
  if(SQL_RECORD_AGGREGATES.has(node.name)){
   const source=node.args[0];
   if(source&&(source.kind==='reference'||source.kind==='literal')&&typeof source.value==='string')
    found.add(source.value);
  }
  node.args.forEach(arg=>collectAggregateObjects(arg,found));
 }else if(node.kind==='unary')collectAggregateObjects(node.value,found);
 else if(node.kind==='binary'){collectAggregateObjects(node.left,found);collectAggregateObjects(node.right,found);}
};
export function formulaAggregateObjects(value){
 if(typeof value!=='string'||value.length>4000)return [];
 if(aggregateCache.has(value))return aggregateCache.get(value);
 const found=new Set();
 try{collectAggregateObjects(new Parser(tokenize(value)).parse(),found);}catch{/* not a formula */}
 const result=[...found];
 if(aggregateCache.size>500)aggregateCache.clear();
 aggregateCache.set(value,result);
 return result;
}
/** Page State keys a formula reads ($state.Key; $session.cartId reads activeCartId). */
const stateKeyCache=new Map();
export function formulaStateKeys(value){
 if(typeof value!=='string'||value.length>4000)return [];
 if(stateKeyCache.has(value))return stateKeyCache.get(value);
 const keys=new Set();
 try{
  for(const token of tokenize(value)){
   if(token.kind!=='reference'&&token.kind!=='identifier')continue;
   if(token.value.startsWith('$state.'))keys.add(token.value.slice(7).split('.')[0]);
   else if(token.value==='$session.cartId')keys.add('activeCartId');
  }
 }catch{/* not a formula */}
 const result=[...keys];
 if(stateKeyCache.size>500)stateKeyCache.clear();
 stateKeyCache.set(value,result);
 return result;
}
/** Does a page mutation change any of these formula-read objects? Unknown writes always do. */
export function mutationAffectsFormulas(detail,pageSessionKey,readObjects){
 if(!readObjects.length)return false;
 if(detail&&typeof detail.pageSessionKey==='string'&&typeof pageSessionKey==='string'
   &&pageSessionKey&&detail.pageSessionKey!==pageSessionKey)return false;
 const written=detail&&Array.isArray(detail.objectApiNames)?detail.objectApiNames:[];
 if(!written.length)return true;
 return readObjects.some(name=>written.includes(name));
}

/** One lazy SQL read queue per mounted component, never a tenant-global result cache.
 * Component formulas display SQL query results, not a second JavaScript implementation.
 * No queries run for Builder-only previews or non-formula text. */
export function useSqlFormulaDisplay(properties,hooks){
 const config=hooks.useMemo(()=>{
  if(properties.builderPreview||properties.previewOnly)return {signature:'preview',jobs:[],fields:[],readObjects:[]};
  const names=Array.isArray(properties.objects)?properties.objects
    .find(object=>object.apiName===properties.objectApiName)?.fields.map(field=>field.apiName)??[]:[];
  const allowedFields=[...new Set(names.filter(name=>/^[A-Za-z][A-Za-z0-9_]*$/.test(name)))];
  const sources=Object.entries(properties).filter(([key,value])=>
    !['html','properties','record','records','items','pageState','sessionId'].includes(key)
    &&isSelectedSqlFormula(value));
  const rows=Array.isArray(properties.records)&&properties.records.length
    ?properties.records:Array.isArray(properties.items)&&properties.items.length
      ?properties.items:[properties.record&&typeof properties.record==='object'
        ?properties.record:{}];
  const authorizedRows=rows.slice(0,100);
  const jobs=[];
  const seenJobs=new Set();
  for(const [field,source] of sources){
   if(isRowIndependentFormula(source)){
    // One query for the whole component; shown when any row may display the field.
    const allowed=typeof properties.fieldAllowed!=='function'
     ||authorizedRows.some(row=>properties.fieldAllowed(field,row));
    const key=jobKey(source,{});
    if(allowed&&!seenJobs.has(key)){seenJobs.add(key);jobs.push({source,row:{},key});}
    continue;
   }
   for(const row of authorizedRows){
    if(typeof properties.fieldAllowed==='function'&&!properties.fieldAllowed(field,row))continue;
    const key=jobKey(source,row);
    if(!seenJobs.has(key)){seenJobs.add(key);jobs.push({source:source,row,key});}
   }
  }
  // The Page runtime supplies only complete, authorised Object rows. Reuse its
  // existing collection/field permissions rather than fetching data in SQL.
  const sourceFields=Object.fromEntries((Array.isArray(properties.objects)?properties.objects:[])
   .filter(object=>object&&typeof object.apiName==='string'&&Array.isArray(object.fields))
   .map(object=>[object.apiName,object.fields.map(field=>field.apiName)
     .filter(name=>typeof name==='string')]));
  const sourceRows=Array.isArray(properties.records)?properties.records:null;
  const page=properties.recordPagination;
  const completeRows=sourceRows&&sourceRows.length<=200&&
   (!page||page.offset===0&&typeof page.total==='number'&&page.total<=sourceRows.length)
   ?sourceRows:undefined;
  const pageContext={
   collectionSources:properties.formulaCollectionSources,
   collectionSourceFields:sourceFields,
   namedCollections:properties.namedCollections,
   namedCollectionSelections:properties.pageState?.collectionSelections,
   collectionRows:completeRows,
   readComponent:properties.readComponent
  };
  const state=properties.pageState??{};
  // Only the Page State keys these formulas actually read. Including the whole
  // state made every $state change (a selected card, a typed search) re-query
  // every formula on every component of the page.
  const readStateKeys=new Set(jobs.flatMap(job=>formulaStateKeys(job.source)));
  const stateInputs=Object.fromEntries(Object.entries(state)
    .filter(([key,value])=>readStateKeys.has(key)&&/^[A-Za-z][A-Za-z0-9_]*$/.test(key)&&scalar(value))
    .slice(0,40));
  const dependencies={};
  for(const job of jobs){
   for(const token of tokenize(job.source).filter(token=>token.kind!=='string'
      &&token.value.startsWith('$component.'))){
    const parts=token.value.split('.');
    if(parts.length!==3||typeof properties.readComponent!=='function')continue;
    try{const value=properties.readComponent(parts[1],parts[2]);
      if(scalar(value))dependencies[token.value]=value;}
    catch{dependencies[token.value]=null;}
   }
  }
  const signature=JSON.stringify([jobs.map(job=>job.key),properties.objectApiName,
   properties.sessionId,properties.recordId,stateInputs,dependencies,allowedFields,
   // A collection can update without changing its formula or current record.
   // Recalculate on authorised row data, selection, or metadata changes.
   properties.formulaCollectionSources,properties.namedCollections,completeRows,sourceFields]);
  const readObjects=[...new Set(jobs.flatMap(job=>formulaAggregateObjects(job.source)))].sort();
  return {signature,jobs,fields:allowedFields,pageContext,readObjects};
 // Dependencies are metadata and authorised record inputs, not a cached computed result.
 },[properties]);
 const [results,setResults]=hooks.useState(
  {signature:'',values:{}});
 // Re-ask only when an Object this component's formulas aggregate over was written.
 // Old values stay on screen until the new ones arrive (no blank flash).
 const [mutationTick,setMutationTick]=hooks.useState(0);
 // Objects written since the last load (null = unknown write: re-ask every job).
 const mutatedObjects=hooks.useRef(null);
 const loadedSignature=hooks.useRef('');
 const inFlight=hooks.useRef(false);
 // Last answer per job, kept across re-asks so totals never blank while loading.
 // Cleared when the session changes so a new sale never shows the old cart's total.
 const lastValues=hooks.useRef({sessionId:properties.sessionId??'',values:{}});
 if(lastValues.current.sessionId!==(properties.sessionId??''))
  lastValues.current={sessionId:properties.sessionId??'',values:{}};
 const readKey=config.readObjects.join('|');
 hooks.useEffect(()=>{
  if(!config.readObjects.length||typeof window==='undefined')return undefined;
  const listener=event=>{
   if(!mutationAffectsFormulas(event.detail,properties.pageSessionKey,config.readObjects))return;
   const written=Array.isArray(event.detail?.objectApiNames)?event.detail.objectApiNames:[];
   const previous=mutatedObjects.current;
   mutatedObjects.current=!written.length||previous===null
    ?null:new Set([...previous,...written]);
   setMutationTick(value=>value+1);
  };
  window.addEventListener('metadrive:page-flow-mutated',listener);
  return()=>window.removeEventListener('metadrive:page-flow-mutated',listener);
 },[readKey,properties.pageSessionKey]);
 hooks.useEffect(()=>{
  if(!config.jobs.length){setResults({signature:config.signature,values:{}});return;}
  let active=true;
  // A write re-asks only the jobs that aggregate over a written Object; a
  // CartLine write must not re-run a Product formula on the same component.
  // A cancelled earlier load never delivered its answers: ask every job again.
  const written=loadedSignature.current===config.signature&&!inFlight.current
   ?mutatedObjects.current:null;
  mutatedObjects.current=new Set();
  loadedSignature.current=config.signature;
  const jobs=written?config.jobs.filter(job=>
   formulaAggregateObjects(job.source).some(name=>written.has(name))):config.jobs;
  if(!jobs.length)return;
  if(Object.keys(lastValues.current.values).length>2000)lastValues.current.values={};
  inFlight.current=true;
  const load=async()=>{
   const request=properties.sqlRequest??getSqlFormulaRequest();
   if(!request)throw Error('Authenticated SQL Formula request is unavailable');
   await Promise.all(jobs.map(async job=>{
    let result;
    try{
     const id=job.row.Id??job.row.id??properties.recordId;
     const value=await evaluatePageActionSql(request,job.source,job.row,
      properties.pageState??{},properties.objectApiName??'',id,config.fields,
      properties.sessionId??'',config.pageContext);
     result={value};
    }catch(error){
     result={value:'',error:error instanceof Error?error.message:'SQL Formula failed'};
     // The visible placeholder is only FORMULAERROR; keep the cause debuggable.
     if(typeof console!=='undefined')console.warn('[SQL Formula] '+result.error,{formula:job.source});
    }
    if(!active)return;
    lastValues.current.values[job.key]=result;
    setResults(previous=>({
     signature:config.signature,
     values:{...(previous.signature===config.signature?previous.values:{}),[job.key]:result}
    }));
   }));
  };
  void load().then(()=>{if(active)inFlight.current=false;},error=>{
   if(!active)return;
   inFlight.current=false;
   setResults(previous=>({signature:config.signature,
    values:{...(previous.signature===config.signature?previous.values:{}),
     ...Object.fromEntries(jobs.map(job=>[job.key,{value:'',
     error:error instanceof Error?error.message:'SQL Formula unavailable'}]))}}));
  });
  return()=>{active=false;};
 },[config.signature,mutationTick]);
 return (source,record)=>{
  if(!isSelectedSqlFormula(source))return undefined;
  if(properties.builderPreview||properties.previewOnly)return {value:'',loading:true};
  const key=lookupKey(source,record);
  const fresh=results.signature===config.signature?results.values[key]:undefined;
  // While a re-ask is in flight, keep showing this job's previous answer.
  return fresh??lastValues.current.values[key]??{value:'',loading:true};
 };
}
