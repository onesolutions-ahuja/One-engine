import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import {Parser,type Expression} from '../expression-engine/FormulaParser.js';
import {tokenize} from '../expression-engine/FormulaTokenizer.js';
import {validateFormulaFunctions} from '../expression-engine/FormulaFunctionRegistry.js';
import {compileFormulaSql,SQL_SCALAR_FORMULAS,SQL_RECORD_AGGREGATES} from '../expression-engine/FormulaSqlCompiler.js';
import {evaluateFlowFormula,type FormulaEvaluationContext} from '../system-files/flow-formula-runtime.js';
import {evaluateFormulaBinary,evaluateFormulaUnary,formulaTruth} from '../expression-engine/FormulaParser.js';
import {createNamedFormulaCollection} from '../expression-engine/FormulaCollection.js';
import type {FormulaExpressionContext} from '../expression-engine/FormulaFunctionRegistry.js';
import type {RecordFilter} from '../object-engine/QueryBuilder.js';

type Actor={tenant_id:string;user_id:string};
type Database=Pick<SqlPersistence,'query'>;
type Rights=Pick<RbacEngine,'require'>;
type Records=Pick<RecordEngine,'list'|'aggregateFiltered'>;
type State=Readonly<Record<string,string|number|boolean|null>>;
type Request={formula:string;objectApi?:string;recordId?:string;state?:State;
 /** Many records, one query. Result is {[recordId]:value}; denied records are absent. */
 recordIds?:string[]};
type Field={data_type:string};
const api=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const numericTypes=new Set(['number','currency','percent']);
const forbiddenTypes=new Set(['formula','rollup','encryptedtext','address']);
const nameOf=(node:Expression|undefined,label:string):string=>{
 if(!node||(node.kind!=='reference'&&node.kind!=='literal'))throw Error('Invalid '+label);
 const name=node.value;
 if(typeof name!=='string'||!api.test(name))throw Error('Invalid '+label);
 return name;
};
const visit=(node:Expression,fn:(value:Expression)=>void):void=>{
 fn(node);
 if(node.kind==='call')node.args.forEach(value=>visit(value,fn));
 else if(node.kind==='unary')visit(node.value,fn);
 else if(node.kind==='binary'){visit(node.left,fn);visit(node.right,fn);}
};
const hasRecordAggregate=(node:Expression):boolean=>{
 let found=false;
 visit(node,item=>{if(item.kind==='call'&&SQL_RECORD_AGGREGATES.has(item.name))found=true;});
 return found;
};
/** Work shared by every formula of ONE HTTP request: identity, field metadata,
 * permission checks and identical aggregates are each resolved once, not per formula.
 * Never kept across requests, so permission and data changes apply on the next call. */
export type FormulaSqlShared={
 user?:Promise<{name:string;email:string;time_zone:string;locale:string;
  currency_iso_code:string|null;tenant_name:string}>;
 fields:Map<string,Promise<Field>>;
 rights:Map<string,ReturnType<Rights['require']>>;
 aggregates:Map<string,Promise<number>>;
};
export const createFormulaSqlShared=():FormulaSqlShared=>
 ({fields:new Map(),rights:new Map(),aggregates:new Map()});

/** True when the formula reads a field of the current record (or Id). Aggregate
 * object/field names are metadata, not record references; only their criterion VALUES count. */
function usesRecordReference(ast:Expression):boolean{
 let found=false;
 const walk=(node:Expression):void=>{
  if(found)return;
  if(node.kind==='reference'){
   if(!node.value.startsWith('$'))found=true;
   return;
  }
  if(node.kind==='call'){
   if(SQL_RECORD_AGGREGATES.has(node.name)){
    const isCount=node.name==='COUNTIFS';
    const criteria=node.args.slice(isCount?1:2);
    for(let index=1;index<criteria.length;index+=2)walk(criteria[index]);
    return;
   }
   if(node.name==='SUM'&&node.args[0]?.kind==='reference')return;
   node.args.forEach(walk);
   return;
  }
  if(node.kind==='unary')walk(node.value);
  else if(node.kind==='binary'){walk(node.left);walk(node.right);}
 };
 walk(ast);
 return found;
}

function checkedState(state:unknown):State {
 if(state===undefined)return {};
 if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).length>40)
  throw Error('Invalid Formula State');
 const result:Record<string,string|number|boolean|null>=Object.create(null);
 for(const [key,value] of Object.entries(state)){
  if(!api.test(key)||['constructor','prototype','__proto__'].includes(key)||
    value!==null&&!['string','number','boolean'].includes(typeof value)||
    typeof value==='number'&&!Number.isFinite(value)||
    typeof value==='string'&&value.length>4000)
   throw Error('Invalid Formula State value');
  result[key]=value as string|number|boolean|null;
 }
 return result;
}

/** One metadata-driven SQL evaluator; no direct table access bypasses Record permissions.
 * Strings and identifiers from authored formulas never become raw SQL. */
export async function evaluateFormulaSql(
 db:Database,rbacEngine:Rights,records:Records,actor:Actor,input:Request,
 shared?:FormulaSqlShared
):Promise<unknown>{
 const rbac:Rights=shared?{require:(tenantId,userId,resource,action)=>{
  const key=resource+'\n'+action;
  let pending=shared.rights.get(key);
  if(!pending){pending=rbacEngine.require(tenantId,userId,resource,action);shared.rights.set(key,pending);}
  return pending;
 }}:rbacEngine;
 if(typeof input.formula!=='string'||!input.formula.trim()||input.formula.length>4000)
  throw Error('Invalid Formula SQL expression');
 const ast=new Parser(tokenize(input.formula)).parse();
 validateFormulaFunctions(ast,'ribbon_binding');
 const state=checkedState(input.state);
 const objectApi=input.objectApi??'',recordId=input.recordId??'';
 if(objectApi&&!api.test(objectApi))throw Error('Invalid Formula Object');
 if(recordId&&!uuid.test(recordId))throw Error('Invalid Formula Record');
 if(recordId&&!objectApi)throw Error('Record ID requires an Object');
 const batchIds=input.recordIds;
 if(batchIds!==undefined){
  if(!Array.isArray(batchIds)||!batchIds.length||batchIds.length>200||recordId||!objectApi||
    batchIds.some(id=>typeof id!=='string'||!uuid.test(id)))
   throw Error('Invalid Formula Record batch');
  // A formula that never reads the current record has ONE answer for every record
  // (session totals, cart sums, counts). Evaluate it once, including aggregates and
  // IFERROR, and fan the value out instead of rejecting the batch.
  if(!usesRecordReference(ast)){
   const value=await evaluateFormulaSql(db,rbacEngine,records,actor,
    {formula:input.formula,objectApi,state:input.state},shared);
   const same:Record<string,unknown>=Object.create(null);
   for(const id of batchIds)same[id]=value;
   return same;
  }
  let unsupported=false;
  visit(ast,node=>{if(node.kind==='call'&&(node.name==='IFERROR'||SQL_RECORD_AGGREGATES.has(node.name)))unsupported=true;});
  if(unsupported)throw Error('Unsupported Batch Formula: IFERROR and Record aggregates cannot depend on each record');
 }
 const identityQuery=async()=>{
  const {rows}=await db.query<{
   name:string;email:string;time_zone:string;locale:string;currency_iso_code:string|null;
   tenant_name:string
  }>('SELECT u.display_name AS name,u.email,u.time_zone,u.locale,u.currency_iso_code,'+
    ' t.name AS tenant_name FROM md_users u JOIN md_tenants t ON t.id=u.tenant_id'+
    ' WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true',
    [actor.tenant_id,actor.user_id]);
  return rows[0];
 };
 let identityPending=shared?.user;
 if(!identityPending){
  identityPending=identityQuery() as NonNullable<FormulaSqlShared['user']>;
  if(shared)shared.user=identityPending;
 }
 const user=await identityPending;
 if(!user)throw Error('Authenticated Formula identity is unavailable');

 const session:Readonly<Record<string,string>>={
  '$session.user.id':actor.user_id,
  '$session.user.name':user.name,
  '$session.user.email':user.email,
  '$session.user.timeZone':user.time_zone,
  '$session.user.locale':user.locale,
  '$session.user.currencyIsoCode':user.currency_iso_code??'',
  '$session.tenant.id':actor.tenant_id,
  '$session.tenant.name':user.tenant_name
 };
 const fields=new Map<string,Field>();
 const load=async(object:string,field:string):Promise<Field>=>{
  if(!api.test(object)||!api.test(field))throw Error('Invalid Formula Field');
  const key=object+'.'+field;
  if(fields.has(key))return fields.get(key)!;
  await rbac.require(actor.tenant_id,actor.user_id,object,'read');
  await rbac.require(actor.tenant_id,actor.user_id,key,'read');
  const lookup=async():Promise<Field>=>{
   const {rows}=await db.query<Field>(
    'SELECT data_type FROM md_field_definitions'+
    ' WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL LIMIT 1',
    [actor.tenant_id,object,field]);
   if(!rows[0]||forbiddenTypes.has(rows[0].data_type))
    throw Error('Formula field cannot be queried through SQL');
   return rows[0];
  };
  let pending=shared?.fields.get(key);
  if(!pending){pending=lookup();shared?.fields.set(key,pending);}
  const info=await pending;
  fields.set(key,info);
  return info;
 };
 const parts=(ref:string)=>{
  const names=ref.split('.');
  if(names.length===1){
   if(!objectApi)throw Error('Formula Field requires an Object context');
   return {object:objectApi,field:names[0]};
  }
  if(names.length!==2||!api.test(names[0])||!api.test(names[1]))
   throw Error('Invalid Formula Field reference');
  if(objectApi&&names[0]!==objectApi)
   throw Error('Formula Field is outside the selected Object');
  return {object:names[0],field:names[1]};
 };

 const scalar=async(inputNode:Expression,batch=false):Promise<unknown>=>{
  const parameters:unknown[]=[actor.tenant_id,actor.user_id];
  const bind=(value:unknown):string=>{
   if(parameters.length>=510)throw Error('Formula SQL parameter limit exceeded');
   parameters.push(value);
   return '$'+parameters.length;
  };
  const timezone=bind(user.time_zone||'UTC')+'::text';
  const resolveAggregate=async(node:Extract<Expression,{kind:'call'}>):Promise<number>=>{
   const isCount=node.name==='COUNTIFS',object=nameOf(node.args[0],'Formula aggregate Object');
   await rbac.require(actor.tenant_id,actor.user_id,object,'read');
   const target=isCount?'':nameOf(node.args[1],'Formula aggregate field');
   const criteria=node.args.slice(isCount?1:2);
   if(criteria.length%2||criteria.length>40)throw Error('Invalid Formula aggregate criteria');
   const filters:RecordFilter[]=[];
   for(let index=0;index<criteria.length;index+=2){
    const field=nameOf(criteria[index],'Formula criterion field');
    const value=await scalar(criteria[index+1]);
    if(value===undefined||value===null||!['string','number','boolean'].includes(typeof value))
     throw Error('Invalid Formula criterion');
    filters.push({field,operator:'eq',value:String(value)});
   }
   const compute=async():Promise<number>=>{
     if(isCount){
      const result=await records.list(actor.tenant_id,actor.user_id,object,1,0,{filters});
      return Number(result.total);
     }
     const result=await records.aggregateFiltered(actor.tenant_id,actor.user_id,object,target,filters);
     if(result.eligible!==true)throw Error('Formula aggregate field is not SQL eligible or readable');
     const numeric=Number(result.numericCount);
     if(!numeric)return 0;
     const value=node.name==='SUMIFS'?Number(result.sum):
      node.name==='AVERAGEIFS'?Number(result.sum)/numeric:
        node.name==='MINIFS'?Number(result.min):Number(result.max);
     if(!Number.isFinite(value))throw Error('Formula aggregate result is not finite');
     return node.name==='SUMIFS'?Math.round(value*1e9)/1e9:value;
   };
   // The same aggregate (e.g. SUMIFS of this cart's LineTotal) appears in many
   // formulas of one page. Run it once per request and share the result.
   const cacheKey=JSON.stringify([node.name,object,target,filters]);
   let pending=shared?.aggregates.get(cacheKey);
   if(!pending){pending=compute();shared?.aggregates.set(cacheKey,pending);}
   return pending;
  };
  const replace=async(node:Expression):Promise<Expression>=>{
   if(node.kind==='call'){
    if(SQL_RECORD_AGGREGATES.has(node.name))return {kind:'literal',value:await resolveAggregate(node)};
    return {...node,args:await Promise.all(node.args.map(replace))};
   }
   if(node.kind==='unary')return {...node,value:await replace(node.value)};
   if(node.kind==='binary')return {...node,left:await replace(node.left),right:await replace(node.right)};
   return node;
  };
  const resolved=await replace(inputNode);
  const references=new Set<string>(),sums=new Set<string>();
  visit(resolved,node=>{
   if(node.kind==='call'&&node.name==='SUM'&&node.args[0]?.kind==='reference')
    sums.add(node.args[0].value);
   if(node.kind==='reference'&&!node.value.startsWith('$'))
    references.add(node.value);
  });
  for(const source of sums)references.delete(source);
  for(const reference of references){
   const {object,field}=parts(reference);
   if(!recordId&&!batch)throw Error('Formula field reference requires a Record ID');
   if(field!=='Id')await load(object,field);
   else await rbac.require(actor.tenant_id,actor.user_id,object,'read');
  }
  for(const source of sums){
   const {object,field}=parts(source);
   const info=await load(object,field);
   const kind=info.data_type;
   if(!numericTypes.has(kind))throw Error('SQL SUM requires a numeric metadata field');
  }
  const sqlReference=(reference:string):string=>{
   if(Object.hasOwn(session,reference))return bind(session[reference])+'::text';
   if(reference.startsWith('$state.')){
    const key=reference.slice(7);
    if(!api.test(key)||!Object.hasOwn(state,key))throw Error('Unknown Formula State reference');
    const value=state[key];
    if(value===null)return 'NULL';
    const parameter=bind(value);
    return parameter+(typeof value==='number'?'::numeric':
      typeof value==='boolean'?'::boolean':'::text');
   }
   if(reference.startsWith('$'))throw Error('Unsupported trusted Formula reference');
   const {object,field}=parts(reference);
   if(!recordId&&!batch)throw Error('Formula reference requires a Record ID');
   if(field==='Id')return 'r.id::text';
   const info=fields.get(object+'.'+field);
   if(!info)throw Error('Unverified Formula field');
   const fieldParam=bind(field)+'::text';
   const kind=info.data_type;
   const column=numericTypes.has(kind)?'v.value_number':
    kind==='boolean'?'v.value_boolean':
    kind==='date'?'v.value_date::text':
    kind==='datetime'?"to_char(v.value_datetime AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')":
    kind==='geolocation'?"jsonb_build_object('latitude',v.geo_latitude,'longitude',v.geo_longitude)":
    'COALESCE(v.value_text,v.reference_record_id::text)';
   return '(SELECT '+column+' FROM md_record_values v WHERE v.tenant_id=r.tenant_id'+
     ' AND v.object_api=r.object_api AND v.record_id=r.id'+
     ' AND v.field_api='+fieldParam+' LIMIT 1)';
  };
  const sumSql=(reference:string)=>{
   const {object,field}=parts(reference);
   if(!fields.has(object+'.'+field))throw Error('SUM source field was not authorised');
   const source=bind(object)+'::text',column=bind(field)+'::text';
   return '(SELECT COALESCE(SUM(sv.value_number),0) FROM md_records sr'+
     ' LEFT JOIN md_record_values sv ON sv.tenant_id=sr.tenant_id'+
     ' AND sv.object_api=sr.object_api AND sv.record_id=sr.id AND sv.field_api='+column+
     ' WHERE sr.tenant_id=$1 AND sr.object_api='+source+
     " AND sr.is_deleted=false AND md_record_access($1,$2,sr.id,'read'))";
  };
  const expression=compileFormulaSql(resolved,{bind,field:sqlReference,sum:sumSql,timeZone:timezone});
  // $1/$2 are always the authenticated actor and $3 is the trusted timezone.
  // Anchor all three parameters even for literal-only formulas.
  if(batch&&references.size){
   const ids=bind(batchIds)+'::uuid[]';
   const {rows}=await db.query<{id:string;value:unknown}>(
    'SELECT r.id::text AS id,to_jsonb(('+expression+')) AS value'+
    ' FROM md_records r WHERE r.tenant_id=$1 AND r.object_api='+bind(objectApi)+
    ' AND r.id=ANY('+ids+') AND r.is_deleted=false'+
    " AND md_record_access($1,$2,r.id,'read') AND $3::text IS NOT NULL",parameters);
   const values:Record<string,unknown>=Object.create(null);
   for(const row of rows)values[row.id]=row.value??null;
   return values;
  }
  const from=references.size
    ?' FROM md_records r WHERE r.tenant_id=$1 AND r.object_api='+bind(objectApi)+
      ' AND r.id='+bind(recordId)+'::uuid AND r.is_deleted=false'+
      " AND md_record_access($1,$2,r.id,'read') AND $3::text IS NOT NULL LIMIT 1"
    :' WHERE $1::uuid IS NOT NULL AND $2::uuid IS NOT NULL AND $3::text IS NOT NULL';
  const {rows}=await db.query<{value:unknown}>('SELECT to_jsonb(('+expression+')) AS value'+from,parameters);
  if(references.size&&!rows.length)throw Error('Formula record is unavailable or permission denied');
  const single=rows[0]?.value??null;
  if(!batch)return single;
  // Formula has no record references: the same value applies to every requested record.
  const same:Record<string,unknown>=Object.create(null);
  for(const id of batchIds!)same[id]=single;
  return same;
 };
 // IFERROR is valid for ribbon bindings but has no SQL template. Settle it
 // outside SQL (like evaluateResolvedFormulaSql) so wrapping a SQL function in
 // IFERROR no longer makes the whole formula fail as 'not SQL-decodable'.
 const settle=async(node:Expression):Promise<Expression>=>{
  // Preserve lazy branches when a child requires a Record Engine aggregate.
  // The original single SQL query is retained for scalar-only expressions.
  if(node.kind==='call'){
   if(node.name==='IF'&&node.args.slice(1).some(hasRecordAggregate)){
    if(node.args.length!==3)throw Error('Invalid IF formula argument count');
    const condition=await scalar(await settle(node.args[0]));
    return settle(formulaTruth(condition)?node.args[1]:node.args[2]);
   }
   if((node.name==='AND'||node.name==='OR')&&node.args.some(hasRecordAggregate)){
    for(const arg of node.args){
     const truth=formulaTruth(await scalar(await settle(arg)));
     if(node.name==='AND'&&!truth)return {kind:'literal',value:false};
     if(node.name==='OR'&&truth)return {kind:'literal',value:true};
    }
    return {kind:'literal',value:node.name==='AND'};
   }
   if((node.name==='BLANKVALUE'||node.name==='NULLVALUE')&&
     node.args[1]&&hasRecordAggregate(node.args[1])){
    if(node.args.length!==2)throw Error('Invalid blank fallback formula argument count');
    const value=await scalar(await settle(node.args[0]));
    if(value===null||value===undefined||node.name==='BLANKVALUE'&&value==='')
     return settle(node.args[1]);
    if(!['string','number','boolean'].includes(typeof value))
     throw Error('Blank fallback result must be a scalar');
    return {kind:'literal',value:value as string|number|boolean};
   }
   if(node.name==='IFERROR'){
    if(node.args.length!==2)throw Error('Invalid IFERROR formula argument count');
    let value:unknown;
    try{value=await scalar(await settle(node.args[0]));}
    catch{value=await scalar(await settle(node.args[1]));}
    if(value!==null&&!['string','number','boolean'].includes(typeof value))
     throw Error('IFERROR result must be a scalar value');
    return {kind:'literal',value:value as string|number|boolean|null};
   }
   const args:Expression[]=[];
   for(const arg of node.args)args.push(await settle(arg));
   return {...node,args};
  }
  if(node.kind==='unary')return {...node,value:await settle(node.value)};
  if(node.kind==='binary'){
   if((node.operator==='AND'||node.operator==='OR')&&
      (hasRecordAggregate(node.left)||hasRecordAggregate(node.right))){
    const first=formulaTruth(await scalar(await settle(node.left)));
    if(node.operator==='AND'&&!first)return {kind:'literal',value:false};
    if(node.operator==='OR'&&first)return {kind:'literal',value:true};
    return {kind:'literal',value:formulaTruth(await scalar(await settle(node.right)))};
   }
   return {...node,left:await settle(node.left),right:await settle(node.right)};
  }
  return node;
 };
 return scalar(await settle(ast),batchIds!==undefined);
}


/** Many formulas, ONE HTTP request. Identity, field metadata, permission checks and
 * identical aggregates are resolved once for the whole list. Each item succeeds or
 * fails on its own, so one bad formula never blanks the rest of the page. */
export type FormulaSqlManyResult={value:unknown}|{error:string};
const manyConcurrency=4;
const exposedError=/^(Invalid |Unsupported |Unknown |Formula |Permission denied|Authenticated Formula|SQL Formula|SQL SUM|Batch )/;
export async function evaluateFormulaSqlMany(
 db:Database,rbac:Rights,records:Records,actor:Actor,items:unknown
):Promise<FormulaSqlManyResult[]>{
 if(!Array.isArray(items)||!items.length||items.length>200)throw Error('Invalid Formula request list');
 const shared=createFormulaSqlShared();
 const results:FormulaSqlManyResult[]=new Array(items.length);
 let next=0;
 const worker=async()=>{
  for(;;){
   const index=next++;
   if(index>=items.length)return;
   try{
    const item=items[index] as Partial<Request>|null;
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Invalid Formula request');
    const {formula,objectApi,recordId,recordIds,state}=item;
    if(typeof formula!=='string'||(objectApi!==undefined&&typeof objectApi!=='string')||
      (recordId!==undefined&&typeof recordId!=='string')||
      (recordIds!==undefined&&!Array.isArray(recordIds)))
     throw Error('Invalid Formula request');
    results[index]={value:await evaluateFormulaSql(db,rbac,records,actor,
     {formula,objectApi,recordId,recordIds,state},shared)};
   }catch(error){
    const message=error instanceof Error?error.message:'';
    if(!exposedError.test(message))console.error('SQL formula item failed',error);
    results[index]={error:exposedError.test(message)?message:'SQL service unavailable'};
   }
  }
 };
 await Promise.all(Array.from({length:Math.min(manyConcurrency,items.length)},worker));
 return results;
}


/** SQL-compiled evaluation for already-authorised server transaction inputs.
 * This is an INTERNAL bridge for existing Field, Validation and Default engines.
 * The caller must resolve and permission-check every field before supplying it.
 * Unlike the HTTP endpoint, this never accepts client-provided reference values.
 * Selected scalar functions are never calculated using the JS formula evaluator. */
export async function evaluateResolvedFormulaSql(
 db:Pick<SqlPersistence,'query'>,
 source:string,
 resolve:(reference:string)=>unknown,
 context:FormulaEvaluationContext={},
 formulaContext:FormulaExpressionContext='formula_field'
):Promise<unknown>{
 if(typeof source!=='string'||!source.trim()||source.length>4000)
  throw Error('Invalid SQL formula source');
 const ast=new Parser(tokenize(source)).parse();
 validateFormulaFunctions(ast,formulaContext);
 const hasSql=(node:Expression):boolean=>node.kind==='call'
  ?SQL_SCALAR_FORMULAS.has(node.name)||SQL_RECORD_AGGREGATES.has(node.name)||node.args.some(hasSql):
  node.kind==='unary'?hasSql(node.value):
  node.kind==='binary'?hasSql(node.left)||hasSql(node.right):false;
 if(!hasSql(ast))return evaluateFlowFormula(source,resolve,context,formulaContext);
 const possible=(node:Expression):boolean=>node.kind==='call'
  ?(SQL_SCALAR_FORMULAS.has(node.name)
     ||['IF','AND','OR','NOT','BLANKVALUE','NULLVALUE'].includes(node.name))
    &&node.args.every(possible):
   node.kind==='unary'?possible(node.value):
   node.kind==='binary'?possible(node.left)&&possible(node.right):true;
 const scalar=(value:unknown,bind:(value:unknown)=>string):string=>{
  if(value===null||value===undefined)return 'NULL';
  if(typeof value==='string')return bind(value)+'::text';
  if(typeof value==='number'&&Number.isFinite(value))return bind(value)+'::numeric';
  if(typeof value==='boolean')return bind(value)+'::boolean';
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   const geo=value as Record<string,unknown>;
   if(typeof geo.latitude==='number'&&Number.isFinite(geo.latitude)
      &&typeof geo.longitude==='number'&&Number.isFinite(geo.longitude))
    return bind(JSON.stringify({latitude:geo.latitude,longitude:geo.longitude}))+'::jsonb';
  }
  throw Error('SQL Formula reference must be a permitted scalar or geolocation');
 };
 const query=async(node:Expression,override?:Map<string,unknown>):Promise<unknown>=>{
  const params:unknown[]=[];
  const bind=(value:unknown):string=>{
   if(params.length>=500)throw Error('SQL Formula parameter limit exceeded');
   params.push(value);
   return '$'+params.length;
  };
  const timeZone=bind(context.timeZone??'UTC')+'::text';
  const now=context.now===undefined?'CURRENT_TIMESTAMP':
   bind(context.now instanceof Date?context.now.toISOString():context.now)+'::timestamptz';
  const expression=compileFormulaSql(node,{
   bind,field:name=>scalar(override?.has(name)?override.get(name):resolve(name),bind),timeZone,now,
   sum:name=>{
    const value=override?.has(name)?override.get(name):resolve(name);
    const items=Array.isArray(value)?value:
     value&&typeof value==='object'&&Array.isArray((value as {items?:unknown[]}).items)
      ?(value as {items:unknown[]}).items:null;
    if(!items||items.length>5000)
     throw Error('SQL SUM requires a bounded, authorised numeric collection');
    if(items.some(v=>v!==null&&v!==undefined&&(
      typeof v!=='number'&&typeof v!=='string'||!Number.isFinite(Number(v)))))
     throw Error('SQL SUM collection must contain finite numbers');
    const values=items.filter(v=>v!==null&&v!==undefined).map(v=>Number(v));
    const parameter=bind(JSON.stringify(values))+'::jsonb';
    return '(SELECT COALESCE(SUM(item.value::numeric),0) FROM jsonb_array_elements_text('+
     parameter+') AS item(value))';
   }
  });
  const {rows}=await db.query<{value:unknown}>('SELECT to_jsonb(('+expression+')) AS value WHERE '+timeZone+' IS NOT NULL AND '+now+' IS NOT NULL',params);
  return rows[0]?.value??null;
 };
 const evaluate=async(node:Expression):Promise<unknown>=>{
  if(possible(node))return query(node);
  if(node.kind==='literal')return node.value;
  if(node.kind==='reference')return resolve(node.value);
  if(node.kind==='unary')return evaluateFormulaUnary(node.operator,await evaluate(node.value));
  if(node.kind==='binary'){
   const left=await evaluate(node.left);
   if(node.operator==='AND'&&!formulaTruth(left))return false;
   if(node.operator==='OR'&&formulaTruth(left))return true;
   return evaluateFormulaBinary(node.operator,left,await evaluate(node.right));
  }
  if(node.name==='IF'){
   if(node.args.length!==3)throw Error('Invalid IF formula argument count');
   return evaluate(formulaTruth(await evaluate(node.args[0]))?node.args[1]:node.args[2]);
  }
  if(node.name==='IFERROR'){
   if(node.args.length!==2)throw Error('Invalid IFERROR formula argument count');
   try{return await evaluate(node.args[0]);}catch{return evaluate(node.args[1]);}
  }
  if(node.name==='AND'||node.name==='OR'){
   for(const arg of node.args){
    const value=formulaTruth(await evaluate(arg));
    if(node.name==='AND'&&!value)return false;
    if(node.name==='OR'&&value)return true;
   }
   return node.name==='AND';
  }
  if(node.name==='BLANKVALUE'||node.name==='NULLVALUE'){
   const first=await evaluate(node.args[0]);
   return first===null||first===undefined||node.name==='BLANKVALUE'&&first===''
    ?evaluate(node.args[1]):first;
  }
  if(node.name==='COLLECTION'){
   const values=[];
   for(const arg of node.args)values.push(await evaluate(arg));
   return createNamedFormulaCollection(values[0],values.slice(1));
  }
  if(node.name==='SUM'){
   if(node.args.length!==1)throw Error('Invalid SUM formula arguments');
   const value=await evaluate(node.args[0]);
   return query({kind:'call',name:'SUM',args:[{kind:'reference',value:'SqlCollectionValue'}]},
     new Map([['SqlCollectionValue',value]]));
  }
  if(SQL_RECORD_AGGREGATES.has(node.name))
   throw Error('Filtered aggregates require the shared Record Engine query');
  if(SQL_SCALAR_FORMULAS.has(node.name)){
   // Resolve only the children that SQL cannot compile. The parent function
   // still executes using the existing SQL compiler, with typed bound values.
   // This preserves SQL ownership without banning valid nested expressions.
   const overrides=new Map<string,unknown>();
   const args:Expression[]=[];
   for(const [index,arg] of node.args.entries()){
    if(possible(arg)){args.push(arg);continue;}
    const key='FormulaChild'+index;
    overrides.set(key,await evaluate(arg));
    args.push({kind:'reference',value:key});
   }
   return query({...node,args},overrides);
  }
  throw Error('Unsupported SQL formula operation: '+node.name);
 };
 return evaluate(ast);
}
