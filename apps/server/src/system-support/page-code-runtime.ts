/**
 * Server side of the page code: runs a page's generated action function on SQL
 * in ONE transaction, and loads the page's record sets.
 *
 * The function comes from the server's own build of the saved page (never
 * from the browser). Every read and write goes through the Record Engine, so
 * tenant isolation, object/field permissions, sharing, validation and triggers
 * apply exactly as for any other save. If any step fails, nothing is saved.
 */
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {RecordFilter} from '../object-engine/QueryBuilder.js';
import {hasExcelWildcardCriteria} from '../expression-engine/FormulaWildcard.js';
import {aggregateRows,fieldValue,rowMatches} from '../page-compiler/code/formulaLibrary.js';
import {readComponentState} from '../expression-engine/FormulaComponentState.js';
import {isConnected,type ConnectionSnapshot} from '../expression-engine/FormulaConnections.js';
import type {ServerPageCode} from '../page-compiler/code/pageCode.js';
import {trustedFormulaSession,type TrustedFormulaSession} from './formula-data-action-runtime.js';
import {loadConnectionSnapshot} from './tenant-connections.js';

type Actor={tenant_id:string;user_id:string};
type Row=Record<string,unknown>;
type Records=Pick<RecordEngine,'list'|'get'|'create'|'update'|'remove'>;
type Sql=Pick<SqlPersistence,'transaction'|'query'>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
/** Largest record set (or FOREACH) the page code reads in one go. */
export const RECORD_SET_LIMIT=500;

export type PageCodeRequest={
 sessionId:string;state:Record<string,unknown>;
 event:{recordId?:string;value?:unknown;index?:unknown;label?:unknown};
 /** Object of the clicked row (the component's Object). */
 rowObject:string;
 timeZone?:string;
};
export type RecordChange={objectApiName:string;operation:'create'|'update'|'delete';record:Row};
export type PageCodeResult={
 ok:boolean;error?:string;
 /** Every record the action created, updated or deleted, as saved. */
 changes:RecordChange[];
 /** Page state the action set (STATE steps). */
 state:Record<string,unknown>;
 /** UI steps for the browser, in order (SCREEN, PRINT, LOCKSCREEN, ...). */
 effects:Array<{name:string;args:unknown[]}>;
 /** Fresh rows of every record set that reads a written Object. */
 sets:Record<string,{rows:Row[];complete:boolean}>;
};

/** Record API criteria: blank matches blank, wildcards match like Excel, others equal. */
export function criteriaFilters(criteria:ReadonlyArray<readonly [string,unknown]>):RecordFilter[]{
 return criteria.map(([field,value])=>{
  if(value===''||value===null||value===undefined)return {field,operator:'isBlank',value:''};
  if(!['string','number','boolean'].includes(typeof value))throw Error('Criteria for '+field+' must be a single value');
  if(hasExcelWildcardCriteria(value))return {field,operator:'matches',value:String(value)};
  return {field,operator:'eq',value:String(value)};
 });
}
const scalarState=(state:unknown):Record<string,unknown>=>{
 const out:Record<string,unknown>=Object.create(null);
 if(!state||typeof state!=='object'||Array.isArray(state))return out;
 for(const [name,value] of Object.entries(state).slice(0,80)){
  if(!key.test(name))continue;
  if(value===null||['string','number','boolean'].includes(typeof value))out[name]=value;
  else if(name==='collectionSelections'&&value&&typeof value==='object')out[name]=value;
 }
 return out;
};

class ServerScope{
 readonly changes:RecordChange[]=[];
 readonly effects:Array<{name:string;args:unknown[]}>=[];
 readonly stateChanges:Record<string,unknown>=Object.create(null);
 readonly written=new Set<string>();
 row:Row={};
 private eventRecord:Row={};
 constructor(private readonly records:Records,private readonly actor:Actor,private readonly request:PageCodeRequest,
  private readonly identity:TrustedFormulaSession|null,private readonly connections:ConnectionSnapshot|null,
  private readonly verify:((pin:unknown,userId?:unknown)=>Promise<boolean>)|null){}
 get sessionId(){return this.request.sessionId;}
 /** The clicked row is re-read from SQL: prices and ids never come from the browser. */
 async loadEventRecord(){
  const id=this.request.event.recordId;
  if(typeof id==='string'&&uuid.test(id)&&key.test(this.request.rowObject)){
   const row=await this.records.get(this.actor.tenant_id,this.actor.user_id,this.request.rowObject,id) as Row;
   this.row=row;this.eventRecord=row;
  }
 }
 now(){return new Date();}
 timeZone(){return this.request.timeZone||this.identity?.user.timeZone||'UTC';}
 state(name:string){
  if(Object.prototype.hasOwnProperty.call(this.stateChanges,name))return this.stateChanges[name]??'';
  const value=this.request.state[name];
  return value===undefined||value===null?'':value;
 }
 session(path:string){
  const user=this.identity?.user,tenant=this.identity?.tenant;
  const map:Record<string,unknown>={'user.id':user?.id,'user.name':user?.name,'user.email':user?.email,
   'user.timeZone':user?.timeZone,'user.locale':user?.locale,'user.currencyIsoCode':user?.currencyIsoCode,
   'tenant.id':tenant?.id,'tenant.name':tenant?.name,'tenant.logo':tenant?.logo};
  if(path==='cartId'){const id=this.state('activeCartId');return typeof id==='string'&&uuid.test(id)?id:'';}
  if(!Object.prototype.hasOwnProperty.call(map,path))throw Error('Unsupported session reference: $session.'+path);
  return map[path]??'';
 }
 tenant(name:string){return name==='name'?this.identity?.tenant.name??'':this.identity?.tenant.logo??'';}
 component(){throw Error('$component values are only available in the browser');}
 componentState(name:string,field:string){
  return readComponentState(this.request.state.collectionSelections,name,field as never);
 }
 event(name:string){
  if(name==='record')return this.eventRecord;
  const value=(this.request.event as Record<string,unknown>)[name];
  return value===undefined||value===null?'':value;
 }
 f(row:unknown,field:string){
  const value=fieldValue(row as Row,field);
  return value===undefined||value===null?'':value;
 }
 connected(name:unknown){return isConnected(this.connections,name);}
 async verifyPin(first:unknown,second?:unknown){
  if(!this.verify)throw Error('VERIFYPIN is unavailable');
  return second===undefined?this.verify(first):this.verify(second,first);
 }
 private async rows(object:string,criteria:ReadonlyArray<readonly [string,unknown]>,max:number):Promise<{rows:Row[];complete:boolean}>{
  const rows:Row[]=[];
  let cursor:unknown;
  const filters=criteriaFilters(criteria);
  for(;;){
   const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,100,0,
    {filters,...(cursor?{cursor:cursor as never}:{})}) as {records:Row[];total:number;nextCursor?:unknown};
   rows.push(...page.records);
   if(rows.length>=max)return {rows:rows.slice(0,max),complete:page.total<=max};
   if(page.records.length<100||!page.nextCursor||rows.length>=page.total)return {rows,complete:true};
   cursor=page.nextCursor;
  }
 }
 async getRecord(object:string,criteria:Array<[string,unknown]>){
  const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,1,0,
   {filters:criteriaFilters(criteria)}) as {records:Row[]};
  return page.records[0]??{};
 }
 async list(object:string,criteria:Array<[string,unknown]>){
  const result=await this.rows(object,criteria,RECORD_SET_LIMIT);
  if(!result.complete)throw Error('FOREACH matches more than '+RECORD_SET_LIMIT+' records; narrow the criteria');
  return result.rows;
 }
 async agg(kind:string,object:string,field:string,criteria:Array<[string,unknown]>){
  if(kind==='COUNTIFS'){
   const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,1,0,
    {filters:criteriaFilters(criteria)}) as {total:number};
   return page.total;
  }
  const result=await this.rows(object,criteria,5000);
  if(!result.complete)throw Error(kind+' matches more than 5000 records; narrow the criteria');
  return aggregateRows(kind,result.rows.filter(row=>rowMatches(row,criteria)),field);
 }
 private values(pairs:Array<[string,unknown]>):Row{
  const values:Row=Object.create(null);
  for(const [field,value] of pairs){
   if(!key.test(field))throw Error('Invalid field '+field);
   values[field]=value;
  }
  return {...values};
 }
 private async saved(object:string,id:string,operation:'create'|'update'):Promise<Row>{
  let row:Row={Id:id};
  try{row=await this.records.get(this.actor.tenant_id,this.actor.user_id,object,id) as Row;}
  catch{/* write-only users keep the Id */}
  this.changes.push({objectApiName:object,operation,record:row});
  this.written.add(object);
  return row;
 }
 async create(object:string,pairs:Array<[string,unknown]>){
  const id=await this.records.create(this.actor.tenant_id,this.actor.user_id,object,this.values(pairs)) as unknown as string;
  return this.saved(object,String(id),'create');
 }
 async update(object:string,id:unknown,pairs:Array<[string,unknown]>){
  if(typeof id!=='string'||!uuid.test(id))throw Error('UPDATERECORD needs a record Id');
  await this.records.update(this.actor.tenant_id,this.actor.user_id,object,id,this.values(pairs));
  return this.saved(object,id,'update');
 }
 async remove(object:string,id:unknown){
  if(typeof id!=='string'||!uuid.test(id))throw Error('DELETERECORD needs a record Id');
  await this.records.remove(this.actor.tenant_id,this.actor.user_id,object,id);
  this.changes.push({objectApiName:object,operation:'delete',record:{Id:id}});
  this.written.add(object);
 }
 setState(name:string,value:unknown){
  if(!key.test(name))throw Error('Invalid Page State key');
  this.stateChanges[name]=value;
 }
 async ui(name:string,...args:unknown[]){this.effects.push({name,args});}
 async service(name:string){throw Error(name+' is not available in page code yet');}
 /** Rows of one record set (with its parent set's ids for child sets). */
 async loadSet(object:string,criteria:Array<[string,unknown]>,parent?:{field:string;ids:string[]}){
  if(parent){
   if(!parent.ids.length)return {rows:[],complete:true};
   const ids=parent.ids.filter(id=>uuid.test(id)).slice(0,100);
   const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,100,0,
    {filters:[...criteriaFilters(criteria),{field:parent.field,operator:'in',value:ids}]}) as {records:Row[];total:number};
   return {rows:page.records,complete:page.total<=page.records.length};
  }
  return this.rows(object,criteria,RECORD_SET_LIMIT);
 }
}

async function loadSets(scope:ServerScope,code:ServerPageCode,only?:ReadonlySet<string>){
 const out:PageCodeResult['sets']={};
 const byKey=new Map(code.recordSets.map(set=>[set.key,set]));
 const load=async(setKey:string):Promise<{rows:Row[];complete:boolean}>=>{
  if(out[setKey])return out[setKey];
  const set=byKey.get(setKey)!;
  const criteria=set.criteria(scope);
  let parentIds:string[]|undefined;
  if(set.parent){
   const parent=await load(set.parent.key);
   parentIds=parent.rows.map(row=>String(row.Id??''));
  }
  out[setKey]=await scope.loadSet(set.object,criteria,set.parent&&parentIds?{field:set.parent.field,ids:parentIds}:undefined);
  return out[setKey];
 };
 const wanted=code.recordSets.filter(set=>!only||only.has(set.object)
  ||Boolean(set.parent&&only.has(byKey.get(set.parent.key)?.object??'')));
 // Parents first; independent sets in parallel.
 await Promise.all(wanted.filter(set=>!set.parent).map(set=>load(set.key)));
 for(const set of wanted.filter(set=>set.parent))await load(set.key);
 return out;
}

type Deps={db:Sql;records:Records;verifyPin?:(actor:Actor,pin:unknown,userId?:unknown)=>Promise<boolean>};
async function scopeFor(deps:Deps,actor:Actor,request:PageCodeRequest,needs:{identity:boolean;connections:boolean}){
 const [identity,connections]=await Promise.all([
  needs.identity?trustedFormulaSession(deps.db,actor):Promise.resolve(null),
  needs.connections?loadConnectionSnapshot(deps.db,actor.tenant_id):Promise.resolve(null)]);
 return new ServerScope(deps.records,actor,request,identity,connections as ConnectionSnapshot|null,
  deps.verifyPin?(pin,userId)=>deps.verifyPin!(actor,pin,userId):null);
}
export function parsePageCodeRequest(body:unknown):PageCodeRequest{
 const raw=(body&&typeof body==='object'&&!Array.isArray(body)?body:{}) as Record<string,unknown>;
 const event=(raw.event&&typeof raw.event==='object'&&!Array.isArray(raw.event)?raw.event:{}) as Record<string,unknown>;
 const sessionId=typeof raw.sessionId==='string'&&raw.sessionId.length<=80?raw.sessionId:'';
 const pick=(value:unknown)=>value===null||['string','number','boolean'].includes(typeof value)?value:undefined;
 return {sessionId,state:scalarState(raw.state),
  event:{recordId:typeof event.recordId==='string'?event.recordId:undefined,value:pick(event.value),
   index:pick(event.index),label:pick(event.label)},
  rowObject:typeof raw.rowObject==='string'&&key.test(raw.rowObject)?raw.rowObject:'',
  timeZone:typeof raw.timeZone==='string'&&/^[A-Za-z0-9_+\-/]{1,64}$/.test(raw.timeZone)?raw.timeZone:undefined};
}

/** Run one page action: ONE transaction; all steps or none. */
export async function executePageCodeAction(deps:Deps,actor:Actor,code:ServerPageCode,actionKey:string,
 request:PageCodeRequest,source:string):Promise<PageCodeResult>{
 const action=code.actions[actionKey];
 if(!action)return {ok:false,error:'This action is not part of the published page',changes:[],state:{},effects:[],sets:{}};
 const scope=await scopeFor(deps,actor,request,{identity:/\$session\.(?:user|tenant)\.|\$tenant\./.test(source),
  connections:/\bCONNECTED\s*\(/i.test(source)});
 try{
  return await deps.db.transaction(async()=>{
   await scope.loadEventRecord();
   await action.run(scope);
   const sets=scope.written.size?await loadSets(scope,code,scope.written):{};
   return {ok:true,changes:scope.changes,state:{...scope.stateChanges},effects:scope.effects,sets};
  });
 }catch(error){
  return {ok:false,error:error instanceof Error?error.message:'The action failed; nothing was saved',
   changes:[],state:{},effects:[],sets:{}};
 }
}
/** All record sets of a page, for page open (with the page's first state). */
export async function loadPageRecordSets(deps:Deps,actor:Actor,code:ServerPageCode,request:PageCodeRequest){
 if(!code.recordSets.length)return {};
 const scope=await scopeFor(deps,actor,request,{identity:false,connections:false});
 return deps.db.transaction(()=>loadSets(scope,code));
}
