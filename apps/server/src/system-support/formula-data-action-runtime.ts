import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {evaluateFormulaSql} from './formula-sql-runtime.js';
import {parseRecordFilters,parseRecordCursor} from '../object-engine/QueryBuilder.js';
import {executeActionPlan,splitServerDataActionPlan,PartialActionError} from '../expression-engine/ActionFormulas.js';
import {evaluateFlowFormulaNode} from '../system-files/flow-formula-runtime.js';
import type {Expression} from '../expression-engine/FormulaParser.js';

type Actor={tenant_id:string;user_id:string};
type Records=Pick<RecordEngine,'list'|'get'|'create'|'update'|'remove'|'aggregateFiltered'>;
type Sql=Pick<SqlPersistence,'transaction'|'query'>;
const name=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function tenantServerFormulaEnabled(db:Pick<SqlPersistence,'query'>,tenant:string){
 const {rows}=await db.query<{enabled:boolean}>(`
  SELECT COALESCE(properties->>'formulaServerExecutionEnabled','true')='true' AS enabled
  FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='automation-settings'`,[tenant]);
 return rows[0]?.enabled!==false;
}

const own=(value:unknown,key:string):unknown=>
 value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,key)
  ?(value as Record<string,unknown>)[key]:undefined;

type TrustedFormulaSession={
 user:{id:string;name:string;email:string;timeZone:string;locale:string;currencyIsoCode:string};
 tenant:{id:string;name:string;logo:string};
};
/** Server formulas derive identity from the authenticated actor, never browser scope. */
async function trustedFormulaSession(db:Sql,actor:Actor):Promise<TrustedFormulaSession>{
 const [users,tenants,profiles]=await Promise.all([
  db.query<{email:string;display_name:string;time_zone:string;locale:string;currency_iso_code:string|null}>(
   'SELECT email,display_name,time_zone,locale,currency_iso_code FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true',
   [actor.tenant_id,actor.user_id]),
  db.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[actor.tenant_id]),
  db.query<{properties:unknown}>("SELECT properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='company-profile'",[actor.tenant_id])
 ]);
 const user=users.rows[0];
 if(!user||!tenants.rows[0])throw Error('Authenticated formula identity is unavailable');
 const raw=profiles.rows[0]?.properties;
 const company=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const string=(value:unknown)=>typeof value==='string'?value.trim():'';
 return {user:{id:actor.user_id,email:user.email,name:user.display_name,
   timeZone:user.time_zone,locale:user.locale,currencyIsoCode:user.currency_iso_code??''},
  tenant:{id:actor.tenant_id,name:string(company.tradingName)||string(company.legalName)||tenants.rows[0].name,
   logo:string(company.logoUrl)}};
}
function evaluateDataNode(node:Expression,scope:Record<string,unknown>,
 _aliases?:readonly string[],state?:Readonly<Record<string,unknown>>,
 authenticated?:TrustedFormulaSession):unknown{
 const resolve=(path:string):unknown=>{
  if(path==='$session')return scope.sessionId??'';
  if(path==='$session.id')return scope.sessionId??'';
  if(path==='$session.cartId'){
   const id=state?.activeCartId??(scope.state as Record<string,unknown>|undefined)?.activeCartId;
   return typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)?id:'';
  }
  if(path.startsWith('$session.')){
   const key=path.slice('$session.'.length);
   if(!/^(?:user\.(?:id|name|email|timeZone|locale|currencyIsoCode)|tenant\.(?:id|name|logo))$/.test(key))
    throw Error('Unsupported session reference: '+path);
   if(!authenticated)throw Error('Authenticated formula identity is unavailable');
   const [root,property]=key.split('.') as ['user'|'tenant',string];
   return own(authenticated[root],property)??'';
  }
  if(path.startsWith('$state.')){
   const key=path.slice(7);
   return own(state,key)??own(scope.state,key);
  }
  if(path.startsWith('$component.')||path.startsWith('$flow.'))
   throw Error('Browser-only Formula reference');
  let current:unknown=scope;
  for(const part of path.split('.')){
   if(!name.test(part)||['constructor','prototype','__proto__'].includes(part))
    throw Error('Invalid Formula reference');
   current=own(current,part);
  }
  return current;
 };
 return evaluateFlowFormulaNode(node,resolve,{timeZone:'UTC'});
}

function parseRecordOperation(path:string,init?:{method:string;body?:string}){
 const url=new URL(path,'http://formula.internal.invalid');
 const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
 if(parts.length<2||parts.length>3||parts[0]!=='records'||!name.test(parts[1])||
   parts.length===3&&!uuid.test(parts[2]))
  throw Error('Unsupported Formula data route');
 const method=init?.method??'GET';
 if(!['GET','POST','PUT','DELETE'].includes(method))throw Error('Unsupported Formula data method');
 const body=init?.body===undefined?{}:JSON.parse(init.body) as unknown;
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid record values');
 return {url,object:parts[1],id:parts[2],method,body:body as Record<string,unknown>};
}

/** Run only a vetted contiguous data prefix. One SQL transaction, one browser
 * request, and nested savepoints per Record API operation. On a failed action,
 * preserve existing confirmed-action semantics by committing earlier successful
 * writes, then surface the original error to the browser.
 */
export async function executeServerDataAction(
 db:Sql,records:Records,actor:Actor,formula:string,scope:Record<string,unknown>,dataSteps:number,
 rbac?:Pick<RbacEngine,'require'>,
 /** Filled for the Server-Timing header: operations run and reads reused. */
 stats?:{operations:number;reusedReads:number;steps:string[]}
):Promise<{supported:true;error?:string;changes?:Array<{key:string;value:unknown}>;
 recordChanged?:boolean;mutatedObjectApiNames?:string[];variables?:Record<string,unknown>;
 completedActionCount?:number;recordChanges?:Array<{objectApiName:string;operation:'create'|'update'|'delete';record:Record<string,unknown>}>}>{
 const split=splitServerDataActionPlan(formula);
 if(!split||dataSteps!==split.dataSteps)
  throw Error('Invalid Formula data segment');
 // An explicit serial queue protects nested PostgreSQL savepoints when the
 // shared interpreter later parallelizes independent read-only functions.
 let pending:Promise<unknown>=Promise.resolve();
 const confirmedObjects=new Set<string>();
 // Identical reads between two writes return the same rows inside this one
 // transaction, so they run once: a cart total plan asks SUMIFS over the same
 // lines for Subtotal, Tax and Total. Any write clears the reuse.
 const reads=new Map<string,Promise<unknown>>();
 const request=<T>(path:string,init?:{method:string;body?:string}):Promise<T>=>{
  const method=(init?.method??'GET').toUpperCase();
  const isRead=method==='GET'||path==='/formulas/evaluate'&&method==='POST';
  const readKey=isRead?method+' '+path+' '+(init?.body??''):'';
  if(isRead){
   const reused=reads.get(readKey);
   // A copy, so a step that changes a returned row cannot change another's.
   if(reused){if(stats)stats.reusedReads++;return reused.then(value=>structuredClone(value)) as Promise<T>;}
  }else reads.clear();
  if(stats)stats.operations++;
  const label=method+' '+path.split('?')[0].replace(/\/[0-9a-f-]{36}$/i,'/:id');
  let startedAt=0;
  const operation=pending.then(()=>{startedAt=performance.now();}).then(()=>db.transaction(async()=>{
   if(path.startsWith('/records/')&&path.includes('/aggregate?')&&
     (init?.method??'GET')==='GET'){
    const url=new URL(path,'http://formula.internal.invalid');
    const parts=url.pathname.split('/').filter(Boolean);
    if(parts.length!==3||parts[0]!=='records'||parts[2]!=='aggregate'||
      !name.test(parts[1]))throw Error('Invalid SQL aggregate Object');
    const field=url.searchParams.get('field')??'';
    if(!name.test(field))throw Error('Invalid SQL aggregate field');
    return records.aggregateFiltered(actor.tenant_id,actor.user_id,parts[1],field,
      parseRecordFilters(url.searchParams.get('filters')??undefined));
   }
   if(path==='/formulas/evaluate'&&init?.method==='POST'){
    if(!rbac)throw Error('SQL Formula requires the shared RBAC engine');
    const data=JSON.parse(init.body??'{}') as Record<string,unknown>;
    if(typeof data.formula!=='string'||data.formula.length>4000||
      data.objectApi!==undefined&&typeof data.objectApi!=='string'||
      data.recordId!==undefined&&typeof data.recordId!=='string')
      throw Error('Invalid server SQL Formula request');
    return {value:await evaluateFormulaSql(db,rbac,records,actor,{
     formula:data.formula,objectApi:data.objectApi as string|undefined,
     recordId:data.recordId as string|undefined,
     state:data.state as Record<string,string|number|boolean|null>|undefined})};
   }
   const {url,object,id,method,body}=parseRecordOperation(path,init);
   const tenant=actor.tenant_id,user=actor.user_id;
   if(method==='GET'){
    if(id)return {record:await records.get(tenant,user,object,id)};
    const limit=Number(url.searchParams.get('limit')??1);
    if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid record limit');
    const cursor=parseRecordCursor(url.searchParams.get('cursor')??undefined);
    return records.list(tenant,user,object,limit,0,{
     filters:parseRecordFilters(url.searchParams.get('filters')??undefined),cursor
    });
   }
   if(method==='POST'&&!id){
    const savedId=await records.create(tenant,user,object,body);
    let record:Record<string,unknown>={Id:savedId};
    try{record=await db.transaction(()=>records.get(tenant,user,object,savedId));}
    catch{/* A write-only actor must retain the existing Id-only response. */}
    confirmedObjects.add(object);
    return {record};
   }
   if(method==='PUT'&&id){
    await records.update(tenant,user,object,id,body);
    let record:Record<string,unknown>={Id:id};
    try{record=await db.transaction(()=>records.get(tenant,user,object,id));}
    catch{/* Preserve successful write even if read access is absent. */}
    confirmedObjects.add(object);
    return {record};
   }
   if(method==='DELETE'&&id){
    await records.remove(tenant,user,object,id);
    confirmedObjects.add(object);
    return {record:{Id:id}};
   }
   throw Error('Unsupported Formula data action');
  }));
  pending=operation.then(()=>undefined,()=>undefined);
  // Each operation's own duration (not its wait behind the previous one).
  if(stats)void pending.then(()=>{
   if(stats.steps.length<20)stats.steps.push(label+' '+(performance.now()-startedAt).toFixed(0)+'ms');
  });
  if(isRead){
   reads.set(readKey,operation);
   operation.catch(()=>{if(reads.get(readKey)===operation)reads.delete(readKey);});
  }
  return operation as Promise<T>;
 };
 const authenticated=/\$session\.(?:user|tenant)\./.test(formula)
  ?await trustedFormulaSession(db,actor):undefined;
 // A caught interpreter failure must not cause the outer transaction to roll
 // back its already confirmed actions. Each failing API operation uses a
 // savepoint; no external side effects or browser operations run in this scope.
 return db.transaction(async()=>{
  try{
   const result=await executeActionPlan(formula,scope,
     (node,values,aliases,state)=>evaluateDataNode(node,values,aliases,state,authenticated),{
    request,useSqlAggregates:true,
    sqlContext:rbac&&!/\bFOREACH\s*\(/i.test(formula)?{state:scope.state as Record<string,unknown>}:undefined,
    planWindow:{start:0,end:dataSteps,includeVariables:true}
   });
   return {supported:true,...result};
  }catch(error){
   // Earlier commits survive a later step failure: reconcile but never replay.
   return {supported:true,error:error instanceof Error?error.message:'Formula data action failed',
    recordChanged:confirmedObjects.size>0,mutatedObjectApiNames:[...confirmedObjects],
    completedActionCount:error instanceof PartialActionError?error.completedActionCount:0};
  }
 });
}