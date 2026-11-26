/**
 * Server side of the page code: runs a page's generated action function on SQL
 * in ONE transaction, and loads the page's record sets.
 *
 * The function comes from the server's own build of the saved page (never
 * from the browser). Every read and write goes through the Record Engine, so
 * tenant isolation, object/field permissions, sharing, validation and triggers
 * apply exactly as for any other save. If any step fails, nothing is saved.
 */
import type {GuestAccessService} from './guest-access-service.js';
import {SHOWN_ROWS} from '../page-compiler/code/generateCode.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {RecordFilter} from '../object-engine/QueryBuilder.js';
import {hasExcelWildcardCriteria} from '../expression-engine/FormulaWildcard.js';
import {aggregateRows,fieldValue,rowMatches,toPairs} from '../page-compiler/code/formulaLibrary.js';
import {readComponentState} from '../expression-engine/FormulaComponentState.js';
import {COMPONENT_VALUES} from '../expression-engine/PageReferences.js';
import {COMPONENT_PROPERTIES,readComponentProperty,uiProperty,uiPropertyValue,withComponentProperties} from '../expression-engine/FormulaComponentState.js';
import {isConnected,type ConnectionSnapshot} from '../expression-engine/FormulaConnections.js';
import type {ServerPageCode} from '../page-compiler/code/pageCode.js';
import {trustedFormulaSession,type TrustedFormulaSession} from './formula-data-action-runtime.js';
import {permissionNames} from './tenant-formula-values.js';
import {loadConnectionSnapshot} from './tenant-connections.js';
import {withRecordReadScope} from './record-read-scope.js';
import {randomUUID} from 'node:crypto';
import {recordCashMovement} from './cash-movement-service.js';
import {ScheduledActionService} from './scheduled-action-service.js';
import {compileActionPlan} from '../expression-engine/ActionFormulas.js';
import {sendActionCommunication,type CommunicationChannel} from './action-formula-communication-service.js';
import {FlowRecordQuery} from '../system-files/flow-record-query.js';
import {runActionCallout} from './action-formula-callout-service.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {NamedCredentialService} from './named-credential-service.js';

type Actor={tenant_id:string;user_id:string};
type Row=Record<string,unknown>;
type Records=Pick<RecordEngine,'list'|'get'|'create'|'update'|'remove'>&Partial<Pick<RecordEngine,'createMany'|'updateMany'>>;
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
 /** Answers of device steps (LOCATION, CREATEPDF) the browser ran when asked. */
 device?:Record<string,unknown>;
 /** This device's key (made on the device; the server maps it to a Till). */
 deviceKey?:string;
 /** A customer display opened from a till: the key of the till it shows. */
 mirrorKey?:string;
 /** Ids of the rows the page shows, per Object (record sets held for shown rows). */
 shown?:Record<string,string[]>;
 /** Seen by the server itself, never sent by the browser: for audit. */
 deviceIp?:string;deviceAgent?:string;
 /** Seen by the server: this site's address (GUESTLINK links). */
 serverOrigin?:string;
};
/** The action needs a device step from the browser; nothing was saved. */
export class DeviceStepNeeded extends Error{
 constructor(readonly step:{name:string;args:unknown[];key:string}){super(step.name+' needs the device');}
}
export const deviceStepKey=(name:string,args:readonly unknown[])=>name+':'+JSON.stringify(args);
export type RecordChange={objectApiName:string;operation:'create'|'update'|'delete';record:Row};
export type PageCodeResult={
 ok:boolean;error?:string;
 /** A device step to run in the browser, then send the action again with its answer. */
 needs?:{name:string;args:unknown[];key:string};
 /** Every record the action created, updated or deleted, as saved. */
 changes:RecordChange[];
 /** Page state the action set (STATE steps). */
 state:Record<string,unknown>;
 /** UI steps for the browser, in order (SCREEN, PRINT, LOCKSCREEN, PAIRDISPLAY, ...). */
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
/** Held component properties ({button1:{set:{Disabled:true},auto:{…}}}): names and scalar values only. */
const componentPropertiesState=(value:unknown):Record<string,unknown>=>{
 const out:Record<string,unknown>=Object.create(null);
 if(!value||typeof value!=='object'||Array.isArray(value))return out;
 for(const [name,entry] of Object.entries(value).slice(0,200)){
  if(!/^[a-z][a-z0-9_]{0,79}$/.test(name)||!entry||typeof entry!=='object')continue;
  const clean:Record<string,Record<string,unknown>>={};
  for(const part of ['set','auto'] as const){
   const values=(entry as Record<string,unknown>)[part];
   if(!values||typeof values!=='object')continue;
   clean[part]={};
   for(const prop of ['Caption','Disabled','Visible']){
    const item=(values as Record<string,unknown>)[prop];
    if(item===null||['string','number','boolean'].includes(typeof item))clean[part][prop]=item;
   }
  }
  out[name]=clean;
 }
 return out;
};
const scalarState=(state:unknown):Record<string,unknown>=>{
 const out:Record<string,unknown>=Object.create(null);
 if(!state||typeof state!=='object'||Array.isArray(state))return out;
 for(const [name,value] of Object.entries(state).slice(0,80)){
  if(!key.test(name))continue;
  if(value===null||['string','number','boolean'].includes(typeof value))out[name]=value;
  else if(name==='collectionSelections'&&value&&typeof value==='object')out[name]=value;
  else if(name===COMPONENT_PROPERTIES)out[name]=componentPropertiesState(value);
 }
 return out;
};

class ServerScope{
 /** Same read between two writes of that Object = one SQL read (SUMIFS asked 3 times costs 1). */
 private readonly reads=new Map<string,Promise<unknown>>();
 private cached<T>(object:string,key:string,read:()=>Promise<T>):Promise<T>{
  const id=object+'\u0000'+key;
  const hit=this.reads.get(id) as Promise<T>|undefined;
  if(hit)return hit;
  const promise=read();
  promise.catch(()=>{if(this.reads.get(id)===promise)this.reads.delete(id);});
  this.reads.set(id,promise);
  return promise;
 }
 private forget(object:string){for(const id of [...this.reads.keys()])if(id.startsWith(object+'\u0000'))this.reads.delete(id);}
 readonly changes:RecordChange[]=[];
 readonly effects:Array<{name:string;args:unknown[]}>=[];
 readonly stateChanges:Record<string,unknown>=Object.create(null);
 readonly written=new Set<string>();
 row:Row={};
 private eventRecord:Row={};
 constructor(private readonly records:Records,private readonly actor:Actor,readonly request:PageCodeRequest,
  private readonly identity:TrustedFormulaSession|null,private readonly connections:ConnectionSnapshot|null,
  private readonly verify:((pin:unknown,userId?:unknown)=>Promise<boolean>)|null,
  private readonly services:{db?:SqlPersistence;rbac?:RbacEngine;namedCredentials?:NamedCredentialService;
   guests?:Pick<GuestAccessService,'link'>}={}){}
 /** Seconds REPEAT has waited in this action. */
 private slept=0;
 /** The signed-in company, for hand-written SQL ($.sql): `WHERE tenant_id = $1` with $.tenantId. */
 get tenantId():string{return this.actor.tenant_id;}
 get userId():string{return this.actor.user_id;}
 /**
  * Plain SQL in a page's code (written by the people who run the server), inside this
  * action's ONE transaction: `await $.sql('SELECT … WHERE tenant_id = $1', [$.tenantId])`.
  * Rows come back as objects. Queued record saves are written first, so the SQL sees them.
  * It is plain SQL: it does not check the user's record access and does not announce live
  * changes (use the record API for those).
  */
 async sql(text:unknown,params:unknown=[]):Promise<Row[]>{
  if(typeof text!=='string'||!text.trim())throw Error('$.sql needs the SQL text');
  if(!Array.isArray(params))throw Error('$.sql parameters must be a list');
  const db=this.services.db;
  if(!db)throw Error('$.sql is not available here');
  await this.flush();
  for(const object of [...this.reads.keys()].map(id=>id.split('\u0000')[0]))this.forget(object);
  const result=await db.query(text,params);
  return result.rows as Row[];
 }
 /** Messages are sent after the transaction commits (never for a rolled-back save). */
 readonly messages:Array<{channel:CommunicationChannel;credential:string;values:unknown[]}>=[];
 get sessionId(){return this.request.sessionId;}
 /** The clicked row is re-read from SQL: prices and ids never come from the browser. */
 async loadEventRecord(){
  const id=this.request.event.recordId;
  if(typeof id==='string'&&uuid.test(id)&&key.test(this.request.rowObject)){
   // A grouped list (ticket board grouped by Order) sends the group's Id, a record of
   // another Object: then there is no clicked row, and @event.recordId is still that Id.
   let row:Row;
   try{row=await this.records.get(this.actor.tenant_id,this.actor.user_id,this.request.rowObject,id) as Row;}
   catch(error){if(error instanceof Error&&error.message==='Record not found')return;throw error;}
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
   'user.managerId':user?.managerId,'user.managerName':user?.managerName,
   'tenant.id':tenant?.id,'tenant.name':tenant?.name,'tenant.logo':tenant?.logo};
  if(path==='cartId'){const id=this.state('activeCartId');return typeof id==='string'&&uuid.test(id)?id:'';}
  // @ThisTenant.User.RefundLimit: the user's own value from SQL (a limit the server enforces).
  if(path.startsWith('user.field.'))return namedValue(user?.fields,path.slice(11),'User');
  if(!Object.prototype.hasOwnProperty.call(map,path))throw Error('Unsupported tenant value: '+path);
  return map[path]??'';
 }
 /** @ThisTenant.Company.<Field>: any Company Settings value (blank when not set). */
 tenant(name:string){return namedValue(this.identity?.tenant.company,name,'Company');}
 /** @ThisTenant.Permission.<Name>: read once before the action runs (RBAC CustomPermission:<Name>). */
 permission(name:string){return this.permissions.get(name.toLowerCase())===true;}
 permissions=new Map<string,boolean>();
 private tillRow:Row|null=null;
 /** Read once before the code runs (page values are plain, synchronous reads). */
 async loadTill(){
  await this.flush();
  this.tillRow=await findDeviceTill(this.records,this.actor,this.request.deviceKey);
  // A display opened from a till says which till it follows; otherwise look it up.
  this.mirrorKey=this.request.mirrorKey||await findMirrorKey(this.records,this.actor,this.request.deviceKey);
 }
 private mirrorKey='';
 /** @ThisPage.Till.*: the active POS Terminal whose DeviceId is this device's key ('' when not set up). */
 till(field:string){
  const value=this.tillRow?.[field];
  return value===undefined||value===null?'':value;
 }
 device(field:string){
  const value=field==='Key'?this.request.deviceKey:field==='MirrorKey'?this.mirrorKey||this.request.deviceKey:field==='Ip'?this.request.deviceIp:field==='Agent'?this.request.deviceAgent:undefined;
  return value??'';
 }
 component(){throw Error('A component\'s live value is only available in the browser');}
 /** @ThisPage.PayButton.CartTotal on the server: the value that action saved. */
 pageValue(_name:string,key:string){return this.state(key);}
 componentState(name:string,field:string){
  const set=this.stateChanges[COMPONENT_VALUES] as Record<string,unknown>|undefined;
  if(set&&Object.prototype.hasOwnProperty.call(set,name)&&(field==='Value'||field==='Text'))return set[name]??'';
  return readComponentState(this.request.state.collectionSelections,name,field as never);
 }
 /** @ThisPage.Button1.Disabled / Caption / Visible: a value this action set, else what the page holds. */
 property(name:string,property:string){
  const prop=uiProperty(property);
  if(!prop)throw Error('Unknown component property '+property);
  const mine=this.stateChanges[COMPONENT_PROPERTIES];
  const held=withComponentProperties({[COMPONENT_PROPERTIES]:this.request.state[COMPONENT_PROPERTIES]},name,'set',{});
  const own=(mine as Record<string,{set?:Record<string,unknown>}>|undefined)?.[name.toLowerCase()]?.set;
  if(own&&Object.prototype.hasOwnProperty.call(own,prop))return readComponentProperty({[COMPONENT_PROPERTIES]:mine},name,prop);
  return readComponentProperty(held,name,prop);
 }
 /** `@ThisPage.Button2.Caption = …`: sent back to the page, which shows it on that component. */
 setProperty(name:string,property:string,value:unknown){
  if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name))throw Error('Invalid component name');
  const prop=uiProperty(property);
  if(!prop)throw Error('Unknown component property '+property);
  const next=withComponentProperties({[COMPONENT_PROPERTIES]:this.stateChanges[COMPONENT_PROPERTIES]},name,'set',
   {[prop]:uiPropertyValue(prop,value)});
  this.stateChanges[COMPONENT_PROPERTIES]=next[COMPONENT_PROPERTIES];
 }
 /** `@ThisPage.CashBox.Value = …`: sent back to the page, which shows it in that component. */
 setValue(name:string,value:unknown){
  if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name))throw Error('Invalid component name');
  if(value!==null&&value!==undefined&&!['string','number','boolean'].includes(typeof value))
   throw Error('A component value must be text, a number or TRUE/FALSE');
  const set={...(this.stateChanges[COMPONENT_VALUES] as Record<string,unknown>|undefined)};
  set[name]=value??'';
  this.stateChanges[COMPONENT_VALUES]=set;
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
 /** Related values are read by the page for display; actions use GETRECORD for them. */
 m(row:unknown,path:string){
  const values=(row as {__mentionValues?:Record<string,unknown>}|null)?.__mentionValues;
  const value=values&&typeof values==='object'?values['@'+path]:undefined;
  return value===undefined||value===null?'':value;
 }
 connected(name:unknown){return isConnected(this.connections,name);}
 async verifyPin(first:unknown,second?:unknown){
  if(!this.verify)throw Error('VERIFYPIN is unavailable');
  return second===undefined?this.verify(first):this.verify(second,first);
 }
 private async rows(object:string,criteria:ReadonlyArray<readonly [string,unknown]>,max:number):Promise<{rows:Row[];complete:boolean}>{
  const filters=criteriaFilters(criteria);
  return this.cached(object,'rows:'+max+':'+JSON.stringify(filters),async()=>{
  const rows:Row[]=[];
  let cursor:unknown;
  for(;;){
   const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,100,0,
    {filters,...(cursor?{cursor:cursor as never}:{})}) as {records:Row[];total:number;nextCursor?:unknown};
   rows.push(...page.records);
   if(rows.length>=max)return {rows:rows.slice(0,max),complete:page.total<=max};
   if(page.records.length<100||!page.nextCursor||rows.length>=page.total)return {rows,complete:true};
   cursor=page.nextCursor;
  }
  });
 }
 async getRecord(object:string,where:unknown){
  const criteria=toPairs(where);
  await this.flush();
  // GETRECORD(Object, Id, x): one row by Id.
  if(criteria.length===1&&criteria[0][0]==='Id'){
   const id=criteria[0][1];
   if(typeof id!=='string'||!uuid.test(id))return {};
   return this.cached(object,'id:'+id,async()=>{
    try{return await this.records.get(this.actor.tenant_id,this.actor.user_id,object,id) as Row;}
    catch(error){if(error instanceof Error&&/not found/i.test(error.message))return {};throw error;}
   });
  }
  const filters=criteriaFilters(criteria);
  return this.cached(object,'first:'+JSON.stringify(filters),async()=>{
   const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,1,0,{filters}) as {records:Row[]};
   return page.records[0]??{};
  });
 }
 async list(object:string,where:unknown){
  const criteria=toPairs(where);
  await this.flush();
  const result=await this.rows(object,criteria,RECORD_SET_LIMIT);
  if(!result.complete)throw Error('FOREACH matches more than '+RECORD_SET_LIMIT+' records; narrow the criteria');
  return result.rows;
 }
 /** COUNTIFS / SUMIFS / … as the page code writes them: $.count(Object, where), $.sum(Object, field, where). */
 count(object:string,where:unknown){return this.agg('COUNTIFS',object,'',where);}
 sum(object:string,field:string,where:unknown){return this.agg('SUMIFS',object,field,where);}
 average(object:string,field:string,where:unknown){return this.agg('AVERAGEIFS',object,field,where);}
 min(object:string,field:string,where:unknown){return this.agg('MINIFS',object,field,where);}
 max(object:string,field:string,where:unknown){return this.agg('MAXIFS',object,field,where);}
 async agg(kind:string,object:string,field:string,where:unknown){
  const criteria=toPairs(where);
  await this.flush();
  if(kind==='COUNTIFS'){
   const filters=criteriaFilters(criteria);
   return this.cached(object,'count:'+JSON.stringify(filters),async()=>{
    const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,1,0,{filters}) as {total:number};
    return page.total;
   });
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
  this.forget(object);
  return row;
 }
 /** Loop saves queued by generated code (FOREACH saves whose result is not used). They are
  * saved together, in order, before anything else reads or writes records, runs a service,
  * or the action ends: later steps always see them. */
 private pending:Array<{kind:'create'|'update';object:string;id?:string;values:Row}>=[];
 async createLater(object:string,given:unknown){
  const pairs=toPairs(given);
  const values=this.values(pairs);
  this.forget(object);
  this.pending.push({kind:'create',object,values});
 }
  async updateLater(object:string,id:unknown,given:unknown){
  const pairs=toPairs(given);
  if(typeof id!=='string'||!uuid.test(id))throw Error('UPDATERECORD needs a record Id');
  const values=this.values(pairs);
  this.forget(object);
  this.pending.push({kind:'update',object,id,values});
 }
 /**
  * FOREACH(Object) whose body only saves: the loop's rows are read ONCE ($.list, same access
  * check) and each step saves all of them with the bulk path flush() uses: one statement per
  * step, whatever the number of rows.
  */
 async createFrom(object:string,rows:readonly Row[],given:unknown){
  const fields=toPairs<(row:Row)=>unknown>(given);
  if(!Array.isArray(rows)||!rows.length)return;
  await this.flush();
  this.forget(object);
  for(const row of rows)this.pending.push({kind:'create',object,values:await this.rowValues(fields,row)});
  await this.flush();
 }
 /** FOREACH(Object) UPDATERECORD(item.Id, …): one bulk update of the loop's rows. */
 async updateWhere(object:string,rows:readonly Row[],given:unknown){
  const fields=toPairs<(row:Row)=>unknown>(given);
  if(!Array.isArray(rows)||!rows.length)return;
  await this.flush();
  this.forget(object);
  for(const row of rows){
   const id=String(row.Id??'');
   if(!uuid.test(id))throw Error('UPDATERECORD needs a record Id');
   this.pending.push({kind:'update',object,id,values:await this.rowValues(fields,row)});
  }
  await this.flush();
 }
 /** FOREACH(Object) DELETERECORD(item.Id): the record engine's own remove, once per row. */
 async removeWhere(object:string,rows:readonly Row[]){
  if(!Array.isArray(rows))return;
  await this.flush();
  for(const row of rows){
   const id=String(row.Id??'');
   if(!uuid.test(id))throw Error('DELETERECORD needs a record Id');
   await this.remove(object,id);
  }
 }
 /** Field values worked out for one row of a set-based loop (field names checked). */
 private async rowValues(fields:Array<[string,(row:Row)=>unknown]>,row:Row):Promise<Row>{
  const values:Row=Object.create(null);
  for(const [field,make] of fields){
   if(!key.test(field))throw Error('Invalid field '+field);
   values[field]=await make(row);
  }
  return {...values};
 }
 /** Save the queued loop saves: each run of the same save on one Object is one bulk save. */
 async flush(){
  while(this.pending.length){
   const first=this.pending[0];
   let count=1;
   while(count<this.pending.length&&this.pending[count].kind===first.kind&&this.pending[count].object===first.object)count++;
   const run=this.pending.splice(0,count);
   const {tenant_id:tenant,user_id:user}=this.actor;
   let ids:string[];
   if(first.kind==='create'){
    if(this.records.createMany)ids=await this.records.createMany(tenant,user,first.object,run.map(item=>item.values));
    else{
     ids=[];
     for(const item of run)ids.push(String(await this.records.create(tenant,user,first.object,item.values)));
    }
   }else{
    const items=run.map(item=>({id:item.id!,values:item.values}));
    if(this.records.updateMany)await this.records.updateMany(tenant,user,first.object,items);
    else for(const item of items)await this.records.update(tenant,user,first.object,item.id,item.values);
    ids=items.map(item=>item.id);
   }
   await this.savedMany(first.object,ids.map(String),first.kind);
  }
 }
 /** The saved rows for the page, read together (100 per read). */
 private async savedMany(object:string,ids:string[],operation:'create'|'update'){
  const rows=new Map<string,Row>();
  try{
   for(let at=0;at<ids.length;at+=100){
    const page=await this.records.list(this.actor.tenant_id,this.actor.user_id,object,100,0,
     {filters:[{field:'Id',operator:'in',value:ids.slice(at,at+100)}]}) as {records:Row[]};
    for(const row of page.records)rows.set(String(row.Id).toLowerCase(),row);
   }
  }catch{rows.clear();}
  for(const id of ids){
   const row=rows.get(id.toLowerCase());
   if(row)this.changes.push({objectApiName:object,operation,record:row});
   else await this.saved(object,id,operation);
  }
  this.written.add(object);
  this.forget(object);
 }
 async create(object:string,given:unknown){
  const pairs=toPairs(given);
  await this.flush();
  this.forget(object);
  const id=await this.records.create(this.actor.tenant_id,this.actor.user_id,object,this.values(pairs)) as unknown as string;
  return this.saved(object,String(id),'create');
 }
 async update(object:string,id:unknown,given:unknown){
  const pairs=toPairs(given);
  await this.flush();
  if(typeof id!=='string'||!uuid.test(id))throw Error('UPDATERECORD needs a record Id');
  this.forget(object);
  await this.records.update(this.actor.tenant_id,this.actor.user_id,object,id,this.values(pairs));
  return this.saved(object,id,'update');
 }
 async remove(object:string,id:unknown){
  await this.flush();
  if(typeof id!=='string'||!uuid.test(id))throw Error('DELETERECORD needs a record Id');
  this.forget(object);
  await this.records.remove(this.actor.tenant_id,this.actor.user_id,object,id);
  this.changes.push({objectApiName:object,operation:'delete',record:{Id:id}});
  this.written.add(object);
  this.forget(object);
 }
 setState(name:string,value:unknown){
  if(!key.test(name))throw Error('Invalid Page State key');
  this.stateChanges[name]=value;
 }
 async ui(name:string,...args:unknown[]){await this.flush();this.effects.push({name,args});}
 async service(name:string,args:unknown[]=[],variables?:Record<string,unknown>){
  await this.flush();
  if(name==='WAIT'){
   const [minutes,seconds,ordinal,formula]=args;
   if(typeof formula!=='string'||!formula)throw Error('WAIT is unavailable');
   // The n-th WAIT of the formula: the scheduled action resumes at the step after it.
   const steps=compileActionPlan(formula);
   let seen=-1,index=-1;
   for(const [i,step] of steps.entries())if(step.name==='WAIT'&&++seen===ordinal){index=i;break;}
   if(index<0)throw Error('WAIT step not found');
   if(index===steps.length-1)return {};
   const total=Number(minutes)*60+Number(seconds);
   await new ScheduledActionService(this.services.db!).schedule(this.actor.tenant_id,this.actor.user_id,{
    formula,nextStep:index+1,seconds:total,scope:{...this.eventRecord,sessionId:this.request.sessionId},
    variables:{...(variables??{})},sessionId:this.request.sessionId});
   return {};
  }
  if(name==='EMAIL'||name==='WHATSAPP'||name==='SMS'){
   const [credential,...values]=args;
   if(typeof credential!=='string'||!credential)throw Error(name+' needs a Named Credential');
   this.messages.push({channel:name,credential,values:values.map(value=>value===null||value===undefined?'':String(value))});
   return {queued:true};
  }
  if(name==='GUESTLINK'){
   // GUESTLINK(App, RecordId): a new QR link for that record (the old one stops).
   const {guests}=this.services;
   if(!guests)throw Error('GUESTLINK is unavailable');
   const [app,recordId]=args;
   const made=await guests.link(this.actor,{appId:app,recordId,origin:this.request.serverOrigin});
   return {Url:made.url,Path:made.path,Id:made.id};
  }
  if(name==='CASHMOVE'){
   const {db}=this.services;
   if(!db)throw Error('CASHMOVE is unavailable');
   const [direction,amount,reason,session]=args;
   const result=await recordCashMovement({db,records:this.records as RecordEngine},this.actor.tenant_id,this.actor.user_id,
    {direction,amount,reason,session,reference:'cash-'+randomUUID()});
   // Reported like CREATERECORD so the till's cash list and totals refresh.
   if(result.ledgerId)await this.saved('CashLedger',result.ledgerId,'create');
   this.written.add('CashLedger');this.forget('CashLedger');
   return result;
  }
  if(name==='CALLOUT'){
   const {db,rbac,namedCredentials}=this.services;
   if(!db||!rbac||!namedCredentials)throw Error('CALLOUT is unavailable');
   const [operation,values]=args;
   // Missing connector, Named Credential or default device: fails here, before any wait.
   return runActionCallout({db,rbac,query:new FlowRecordQuery(db,rbac),
    callout:(tenantId,userId,config,variables,calloutKey)=>namedCredentials.callout(tenantId,userId,config,variables,calloutKey)},
   this.actor.tenant_id,this.actor.user_id,operation,values,randomUUID());
  }
  if(name==='SLEEP'){
   // REPEAT pauses: at most 55 seconds of waiting in one action (under the web timeout);
   // then REPEAT stops and the formula sees the last reply (e.g. Result "Pending").
   const seconds=Math.max(0,Math.min(30,Number(args[0])||0));
   if(this.slept+seconds>55)return {timeUp:true};
   this.slept+=seconds;
   await new Promise(resolve=>setTimeout(resolve,seconds*1000));
   return {timeUp:false};
  }
  if(name==='LOCATION'||name==='CREATEPDF'){
   const key=deviceStepKey(name,args);
   const answers=this.request.device;
   if(answers&&Object.prototype.hasOwnProperty.call(answers,key))return answers[key];
   throw new DeviceStepNeeded({name,args,key});
  }
  throw Error(name+' runs in the action engine');
 }
 /** Rows of one record set (with its parent set's ids for child sets). */
 async loadSet(object:string,criteria:Array<[string,unknown]>,parent?:{field:string;ids:string[]}){
  if(parent){
   if(!parent.ids.length)return {rows:[],complete:true};
   const ids=parent.ids.filter(id=>uuid.test(id)).slice(0,SHOWN_LIMIT);
   // 100 parent Ids per read, read together (a grid of products and their option groups).
   const chunks:string[][]=[];for(let at=0;at<ids.length;at+=100)chunks.push(ids.slice(at,at+100));
   const pages=await Promise.all(chunks.map(chunk=>this.records.list(this.actor.tenant_id,this.actor.user_id,object,RECORD_SET_LIMIT,0,
    {filters:[...criteriaFilters(criteria),{field:parent.field,operator:'in',value:chunk}]}) as Promise<{records:Row[];total:number}>));
   return {rows:pages.flatMap(page=>page.records),complete:pages.every(page=>page.total<=page.records.length)};
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
  const criteria=toPairs(set.criteria(scope));
  let parentIds:string[]|undefined;
  if(set.parent?.key.startsWith(SHOWN_ROWS)){
   // Held for the rows the page shows (the browser sends their Ids).
   parentIds=scope.request.shown?.[set.parent.key.slice(SHOWN_ROWS.length)]??[];
  }else if(set.parent){
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

type Deps={db:Sql;records:Records;verifyPin?:(actor:Actor,pin:unknown,userId?:unknown)=>Promise<boolean>;
 rbac?:RbacEngine;namedCredentials?:NamedCredentialService;guests?:Pick<GuestAccessService,'link'>};
/** A value by name, ignoring case ('' when absent). */
function namedValue(values:Record<string,unknown>|undefined,name:string,group:string):unknown{
 if(!values)throw Error('Unknown tenant value @ThisTenant.'+group+'.'+name);
 const key=Object.keys(values).find(item=>item.toLowerCase()===name.toLowerCase());
 if(key===undefined)throw Error('Unknown tenant value @ThisTenant.'+group+'.'+name);
 const value=values[key];
 return value===undefined||value===null?'':value;
}
async function scopeFor(deps:Deps,actor:Actor,request:PageCodeRequest,needs:{identity:boolean;connections:boolean;permissions?:string[]}){
 const [identity,connections]=await Promise.all([
  needs.identity?trustedFormulaSession(deps.db,actor):Promise.resolve(null),
  needs.connections?loadConnectionSnapshot(deps.db,actor.tenant_id):Promise.resolve(null)]);
 const scope=new ServerScope(deps.records,actor,request,identity,connections as ConnectionSnapshot|null,
  deps.verifyPin?(pin,userId)=>deps.verifyPin!(actor,pin,userId):null,
  {db:deps.db as SqlPersistence,rbac:deps.rbac,namedCredentials:deps.namedCredentials,guests:deps.guests});
 if(needs.permissions?.length){
  if(!deps.rbac)throw Error('Permissions are unavailable for this action');
  const allowed=await deps.rbac.allowedMany(actor.tenant_id,actor.user_id,
   needs.permissions.map(name=>({resource:'CustomPermission:'+name,action:'read'})));
  needs.permissions.forEach((name,i)=>scope.permissions.set(name.toLowerCase(),allowed[i]===true));
 }
 // Only a request from a page that reads @ThisPage.Till/Device carries a device key.
 if(request.deviceKey)await scope.loadTill();
 return scope;
}
/** At most 10 small answers (a position, a file id): data only, used like any user input. */
function deviceAnswers(value:unknown):Record<string,unknown>|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const out:Record<string,unknown>=Object.create(null);
 for(const [k,v] of Object.entries(value).slice(0,10)){
  if(!/^(LOCATION|CREATEPDF):/.test(k)||k.length>500)continue;
  if(JSON.stringify(v??null).length>2000)continue;
  out[k]=v;
 }
 return out;
}
/** Device keys are made on the device: a random UUID (browser) or the OS vendor id (app). */
export const deviceKeyPattern=/^[A-Za-z0-9_-]{16,128}$/;
/** A Till is a Named Device of type POS Terminal: one shared device object for tills,
 * kiosks, customer displays, printers and card readers. Its DeviceId is the device key. */
export const TILL_DEVICE_OBJECT='NamedDevice';
export const TILL_DEVICE_TYPE='POS Terminal';
export const tillFilters=(...more:RecordFilter[]):RecordFilter[]=>[
 {field:'DeviceType',operator:'eq',value:TILL_DEVICE_TYPE},{field:'Active',operator:'eq',value:'true'},...more];
/** @ThisPage.Device.MirrorKey: the device whose sale this screen shows. A Till shows its own;
 * a customer display shows the Till whose CustomerDisplayKey is this device's key; with only one
 * active Till, an unlinked display follows that Till; any other device shows its own key. */
export async function findMirrorKey(records:Pick<Records,'list'|'get'>,actor:Actor,deviceKey:unknown):Promise<string>{
 if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))return '';
 try{
  const page=await records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,2,0,{filters:tillFilters(
   {field:'CustomerDisplayKey',operator:'eq',value:deviceKey})}) as {records:Row[]};
  const till=page.records[0];
  if(till&&typeof till.DeviceId==='string'&&deviceKeyPattern.test(till.DeviceId))return till.DeviceId;
  // Not linked to a Till: a shop with ONE active Till needs no setup, the display follows it.
  const tills=await records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,2,0,{filters:tillFilters()}) as {records:Row[]};
  const only=tills.records.length===1?tills.records[0]:null;
  if(only&&typeof only.DeviceId==='string'&&deviceKeyPattern.test(only.DeviceId))return only.DeviceId;
 }catch{/* no Named Device access: the screen shows its own device */}
 return deviceKey;
}
/** The active Till (POS Terminal) set up for this device, with its Location's Code (the number prefix). */
export async function findDeviceTill(records:Pick<Records,'list'|'get'>,actor:Actor,deviceKey:unknown):Promise<Row|null>{
 if(typeof deviceKey!=='string'||!deviceKeyPattern.test(deviceKey))return null;
 const page=await records.list(actor.tenant_id,actor.user_id,TILL_DEVICE_OBJECT,2,0,{filters:tillFilters(
  {field:'DeviceId',operator:'eq',value:deviceKey})}) as {records:Row[]};
 const till=page.records[0];
 if(!till)return null;
 let locationCode='';
 if(typeof till.Location==='string'&&uuid.test(till.Location)){
  try{locationCode=String((await records.get(actor.tenant_id,actor.user_id,'Location',till.Location) as Row).Code??'');}
  catch{/* no read access to Location: the code stays blank */}
 }
 return {Id:till.Id,Name:till.Name??'',Code:till.Code??'',Location:till.Location??'',LocationCode:locationCode};
}

export function parsePageCodeRequest(body:unknown,seen:{ip?:unknown;agent?:unknown;origin?:unknown}={}):PageCodeRequest{
 const raw=(body&&typeof body==='object'&&!Array.isArray(body)?body:{}) as Record<string,unknown>;
 const event=(raw.event&&typeof raw.event==='object'&&!Array.isArray(raw.event)?raw.event:{}) as Record<string,unknown>;
 const sessionId=typeof raw.sessionId==='string'&&raw.sessionId.length<=80?raw.sessionId:'';
 const pick=(value:unknown)=>value===null||['string','number','boolean'].includes(typeof value)?value:undefined;
 return {sessionId,state:scalarState(raw.state),
  event:{recordId:typeof event.recordId==='string'?event.recordId:undefined,value:pick(event.value),
   index:pick(event.index),label:pick(event.label)},
  rowObject:typeof raw.rowObject==='string'&&key.test(raw.rowObject)?raw.rowObject:'',
  timeZone:typeof raw.timeZone==='string'&&/^[A-Za-z0-9_+\-/]{1,64}$/.test(raw.timeZone)?raw.timeZone:undefined,
  device:deviceAnswers(raw.device),
  ...(typeof raw.deviceKey==='string'&&deviceKeyPattern.test(raw.deviceKey)?{deviceKey:raw.deviceKey}:{}),
  ...(typeof raw.mirrorKey==='string'&&deviceKeyPattern.test(raw.mirrorKey)?{mirrorKey:raw.mirrorKey}:{}),
  ...(shownRows(raw.shown)?{shown:shownRows(raw.shown)!}:{}),
  ...(typeof seen.ip==='string'&&seen.ip?{deviceIp:seen.ip.slice(0,64)}:{}),
  ...(typeof seen.agent==='string'&&seen.agent?{deviceAgent:seen.agent.slice(0,255)}:{}),
  ...(typeof seen.origin==='string'&&/^https?:\/\/[A-Za-z0-9.:-]{1,200}$/.test(seen.origin)?{serverOrigin:seen.origin}:{})};
}

/** Shown row Ids per Object: at most 5 Objects and 500 Ids each, Ids only. */
const SHOWN_LIMIT=500;
function shownRows(value:unknown):Record<string,string[]>|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const out:Record<string,string[]>=Object.create(null);
 for(const [object,ids] of Object.entries(value).slice(0,5)){
  if(!key.test(object)||!Array.isArray(ids))continue;
  out[object]=[...new Set(ids.filter((id):id is string=>typeof id==='string'&&uuid.test(id)))].slice(0,SHOWN_LIMIT);
 }
 return Object.keys(out).length?out:undefined;
}

/** True when an action reads the signed-in user or the company (formula text or generated code). */
export const needsIdentity=(source:string)=>/@ThisTenant\.(?:User|Company)\.|\$\.session\(\s*["'](?:user|tenant)\.|\$\.tenant\(/i.test(source);
/** Held record sets whose criteria read the signed-in user or company (a guest's table:
 * ServicePoint Id = @ThisTenant.User.GuestOf) are reloaded after every save: they need it too. */
const setsNeedIdentity=(code:Pick<ServerPageCode,'recordSets'>)=>code.recordSets.some(set=>needsIdentity(set.key));

/** Run one page action: ONE transaction; all steps or none. */
/** Taps of one page session (one sale on one screen) take turns; without a session, those of
 * one device; without either, nothing is waited for. */
export function actionTurnKey(actor:Actor,request:Pick<PageCodeRequest,'sessionId'|'deviceKey'>):string{
 const own=request.sessionId?'session:'+request.sessionId:request.deviceKey?'device:'+request.deviceKey:'';
 return own?'page-action:'+actor.tenant_id+':'+own:'';
}
export async function executePageCodeAction(deps:Deps,actor:Actor,code:ServerPageCode,actionKey:string,
 request:PageCodeRequest,source:string):Promise<PageCodeResult>{
 const action=code.actions[actionKey];
 if(!action)return {ok:false,error:'This action is not part of the published page',changes:[],state:{},effects:[],sets:{}};
 // The source is the generated action code: user/company values appear as $.session("user.…"),
 // $.session("tenant.id") or $.tenant(…), not as @ThisTenant mentions.
 const scope=await scopeFor(deps,actor,request,{identity:needsIdentity(source)||setsNeedIdentity(code),
  connections:/\bCONNECTED\s*\(/i.test(source),permissions:permissionNames(source)});
 try{
  const result=await deps.db.transaction(()=>withRecordReadScope(async()=>{
   // One page's taps save one at a time, in the order they arrive: a tap reads what the tap
   // before it saved (fast taps on +1 never lose one). Other pages and devices run alongside.
   const turn=actionTurnKey(actor,request);
   if(turn)await deps.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[turn]);
   await scope.loadEventRecord();
   await action.run(scope);
   await scope.flush();
   // All held sets: roll-ups and triggers can change Objects the action did not write.
   const sets=scope.written.size?await loadSets(scope,code):{};
   return {ok:true,changes:scope.changes,state:{...scope.stateChanges},effects:scope.effects,sets};
  }));
  // EMAIL/SMS/WHATSAPP after the save committed, in order (same delivery service as before).
  // A failed message does not undo the committed save; it is reported with the result.
  const failed:string[]=[];
  for(const message of scope.messages){
   try{
    if(!deps.namedCredentials||!deps.rbac)throw Error('delivery service unavailable');
    await sendActionCommunication(deps.db as SqlPersistence,deps.rbac,deps.namedCredentials,actor.tenant_id,actor.user_id,
     message.channel,message.credential,message.values,randomUUID());
   }catch(error){failed.push(message.channel+': '+(error instanceof Error?error.message:'not sent'));}
  }
  return failed.length?{...result as PageCodeResult,error:'Saved, but not sent - '+failed.join('; ')}:result as PageCodeResult;
 }catch(error){
  if(error instanceof DeviceStepNeeded)return {ok:false,needs:error.step,changes:[],state:{},effects:[],sets:{}};
  return {ok:false,error:error instanceof Error?error.message:'The action failed; nothing was saved',
   changes:[],state:{},effects:[],sets:{}};
 }
}
const AGGREGATE_KINDS=new Set(['SUMIFS','COUNTIFS','AVERAGEIFS','MAXIFS','MINIFS']);
/** Totals for display formulas over rows the page does not hold: same `$.agg` as actions
 * (Record API, permissions), one read-only transaction for the whole batch. */
export async function pageCodeAggregates(deps:Deps,actor:Actor,request:PageCodeRequest,items:unknown):Promise<unknown[]>{
 if(!Array.isArray(items)||items.length>100)throw Error('Invalid aggregate request');
 const scope=await scopeFor(deps,actor,request,{identity:false,connections:false});
 return deps.db.transaction(()=>withRecordReadScope(async()=>{
  const values:unknown[]=[];
  for(const raw of items){
   const item=(raw&&typeof raw==='object'?raw:{}) as {kind?:unknown;object?:unknown;field?:unknown;criteria?:unknown};
   try{
    if(typeof item.kind!=='string'||!AGGREGATE_KINDS.has(item.kind)||typeof item.object!=='string'||!key.test(item.object)
     ||typeof item.field!=='string'||(item.field!==''&&!key.test(item.field))||!Array.isArray(item.criteria)||item.criteria.length>20)
     throw Error('Invalid aggregate');
    const criteria=item.criteria.map(pair=>{
     if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!key.test(pair[0]))throw Error('Invalid criteria');
     return [pair[0],pair[1]] as [string,unknown];
    });
    values.push(await scope.agg(item.kind,item.object,item.field,criteria));
   }catch{values.push('');}
  }
  return values;
 }));
}
/** All record sets of a page, for page open (with the page's first state). */
export async function loadPageRecordSets(deps:Deps,actor:Actor,code:ServerPageCode,request:PageCodeRequest){
 if(!code.recordSets.length)return {};
 const scope=await scopeFor(deps,actor,request,{identity:setsNeedIdentity(code),connections:false});
 return deps.db.transaction(()=>withRecordReadScope(()=>loadSets(scope,code)));
}
