import {formulaShape} from '../../../component-libraries/shared/formulaCodeLookup.js';
/**
 * Browser side of the page code (v2): runs the page's generated functions.
 *
 *  - Display formulas: plain functions over the row being drawn and the rows
 *    the page holds (record sets). Totals of rows already on screen (SUMIFS
 *    over the open cart) are worked out here: no request.
 *  - A tap: the action function runs FIRST on the held rows (the screen
 *    changes at once), then ONE request runs the same function on the server
 *    in one SQL transaction and returns the saved rows. If the save fails, the
 *    screen change is undone.
 *
 * There is no formula interpreter here: every formula is already JavaScript.
 */
import {F,O,aggregateRows,fieldValue,rowMatches} from '../../../../../server/src/page-compiler/code/formulaLibrary.js';
import {readComponentState,readComponentProperty,uiProperty,uiPropertyValue,withComponentProperties,COMPONENT_PROPERTIES} from '../../../../../server/src/expression-engine/FormulaComponentState.js';
import {COMPONENT_VALUES} from '../../../../../server/src/expression-engine/PageReferences.js';
import {isConnected} from '../../../../../server/src/expression-engine/FormulaConnections.js';
import {getTenantBrand} from '../../../component-libraries/shared/TenantBrand.js';
import {USER_FIELDS,type PageReference} from '../../../../../server/src/expression-engine/PageReferences.js';
import {optimisticIdPrefix} from '../PageRuntime/optimisticIds';
import {startTap} from './pageTimings';
import {noteOwnBatch} from './liveChanges';
import {businessTimeZone,formulaFunction,looksLikeFormula,nodeFunction,sessionValue,tenantValue,permissionValue} from './formulaText';
import type {Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {deviceTillState,deviceTillValue,loadDeviceTill,mirrorDeviceKey,openerMirrorKey,subscribeDeviceTill,tillDeviceKey} from '../../authentication/TillDevice/deviceTill';

type Row=Record<string,unknown>;
type Criteria=Array<[string,unknown]>;
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type PageCodeAction={data:boolean;reads:string[];writes:string[];ui:string[];run:(scope:unknown)=>Promise<void>};
export type PageCodeSet={key:string;object:string;parent?:{key:string;field:string};criteria:(scope:unknown)=>Criteria};
export type PageCode={formulas:Record<string,(row:Row,scope:unknown)=>unknown>;sources:Record<string,string>;
 actions:Record<string,PageCodeAction>;recordSets:PageCodeSet[]};
export type PageCodeModule={codeVersion?:number;createCode?:(f:typeof F,o:typeof O)=>PageCode};
export type RecordChange={objectApiName:string;operation:'create'|'update'|'delete';record:Row};
export type Effect={name:string;args:unknown[]};
type ServerResult={ok:boolean;stale?:boolean;error?:string;needs?:{name:string;args:unknown[];key:string};changes:RecordChange[];state:Record<string,unknown>;
 effects:Effect[];sets:Record<string,{rows:Row[];complete:boolean}>};

/** A lookup the held rows cannot answer exactly: no prediction (the server answers).
 * `object`/`criteria` say which read could not be answered (the miss the speed test shows). */
export class NotHeld extends Error {
 readonly notHeld=true;
 constructor(message:string,readonly object='',readonly criteria?:unknown){super(message);}
}
const notHeld=(why:string,object='',criteria?:unknown):never=>{throw new NotHeld(why,object,criteria);};
/** One row's values of a set-based loop step (a value may await, as in the loop it replaces). */
const rowPairs=async(fields:Array<[string,(row:Record<string,unknown>)=>unknown]>,row:Record<string,unknown>)=>{
 const pairs:Array<[string,unknown]>=[];
 for(const [field,make] of fields)pairs.push([field,await make(row)]);
 return pairs;
};
const identityKey=Symbol.for('une.authenticatedFormulaIdentity');
const identity=()=>(globalThis as Record<symbol,unknown>)[identityKey] as undefined|{
 user?:Record<string,unknown>;organization?:Record<string,unknown>;connections?:unknown};
const sessionUser:Record<string,string>={id:'Id',name:'Name',email:'Email',timeZone:'TimeZone',locale:'Locale',currencyIsoCode:'CurrencyIsoCode',
 managerId:'Manager',managerName:'ManagerName'};
/** @ThisPage.Session / user / cart and @ThisTenant values, as page code reads them
 * (shared with list filters, which run before a page code scope exists). */
export function signedInValue(page:PageReference,state:Readonly<Record<string,unknown>>,sessionId:string):unknown{
 const who=identity();
 if(page.kind==='session')return sessionId;
 if(page.kind==='cart'){const id=state.activeCartId;return typeof id==='string'?id:'';}
 if(page.kind==='till')return deviceTillValue(page.field);
 if(page.kind==='device')return page.field==='Key'?tillDeviceKey():page.field==='MirrorKey'?mirrorDeviceKey():'';
 if(page.kind==='user')return who?.user?.[sessionUser[USER_FIELDS[page.field]]]??'';
 if(page.kind==='userField')return sessionValue('user.field.'+page.field,state);
 if(page.kind==='permission')return permissionValue(page.name);
 if(page.kind==='company'){
  if(page.field==='Id')return who?.organization?.Id??'';
  if(page.field==='Name')return getTenantBrand().name||who?.organization?.Name||'';
  return tenantValue(page.field);
 }
 return '';
}
const same=(a:unknown,b:unknown)=>String(a??'')===String(b??'');
let batches=Math.floor(Math.random()*0x10000)*0x1000;

type TapIo={
 show(update:{changes:RecordChange[];state:Record<string,unknown>;optimistic?:string;replaces?:string;failed?:boolean}):void;
 effects(effects:Effect[]):Promise<void>;
 /** A device step the server asked for (LOCATION, CREATEPDF): its answer. */
 device?(step:{name:string;args:unknown[]}):Promise<unknown>;
};
export type PageCodeHost={
 request:Request;
 /** '/apps/:appId' (published) or '/pages/:apiName' (Builder Preview). */
 endpoint:string;
 /** Build id (published) / preview id: the server runs ITS copy of the same build. */
 build:{buildId?:string;previewId?:string};
 sessionId():string;
 state():Readonly<Record<string,unknown>>;
 readComponent?(component:string,property:string):unknown;
 /** Page name for speed timings (pageTimings.ts). */
 page?:string;
 /** Ids of the rows of `object` the page shows now (record sets held for shown rows). */
 shownRows?(object:string):string[];
 /** Local copy of the held rows (localCopy.ts): drawn at page open while the server answers. */
 local?:{key():string|null;read<T>(key:string):Promise<T|undefined>;write(key:string,value:unknown):void};
};
/** Parent key of a set held for the rows of an Object the page shows (generateCode SHOWN_ROWS). */
const SHOWN_ROWS='@shown:';

export function createPageCodeRuntime(code:PageCode,host:PageCodeHost){
 const sets=new Map<string,{rows:Row[];complete:boolean}>();
 /** Taps sent and not yet answered, in tap order. An answer is the saved state up to its own
  * tap: the predictions of taps still waiting are put back on top, so fast taps never step
  * back (5, 6, 7, 8 never shows 5 again) and the next tap counts from the newest number. */
 const waitingTaps:Array<{seq:number;scope:Scope|null}>=[];
 let tapSeq=0,answeredSeq=0;
 /** Provisional Id -> saved Id, once a tap's new row is saved (a later tap may still name it). */
 const savedIds=new Map<string,string>();
 const savedId=(id:string)=>savedIds.get(id)??id;
 const mapValue=(value:unknown)=>typeof value==='string'?savedId(value):value;
 const listeners=new Set<()=>void>();
 let version=0;
 const changed=()=>{version++;listeners.forEach(listener=>listener());};
 const byKey=new Map(code.recordSets.map(set=>[set.key,set]));
 /** Objects whose shown rows have record sets held for them (option groups of shown products). */
 const shownObjects=[...new Set(code.recordSets.map(set=>set.parent?.key??'').filter(key=>key.startsWith(SHOWN_ROWS))
  .map(key=>key.slice(SHOWN_ROWS.length)))];
 /** Shown row Ids each such set was loaded for: a tap on another row asks the server. */
 const shownCoverage=new Map<string,ReadonlySet<string>>();
 const shownNow=()=>Object.fromEntries(shownObjects.map(object=>[object,(host.shownRows?.(object)??[]).slice(0,500)]));
 let shownReload:ReturnType<typeof setTimeout>|undefined;
 /** Server totals for display formulas over rows not held: key -> value. */
 const aggregates=new Map<string,unknown>();
 const asked=new Map<string,{kind:string;object:string;field:string;criteria:Criteria}>();
 let askTimer:ReturnType<typeof setTimeout>|undefined;
 const serverAggregate=(kind:string,object:string,field:string,criteria:Criteria):unknown=>{
  const key=JSON.stringify([kind,object,field,criteria]);
  if(aggregates.has(key))return aggregates.get(key);
  if(!asked.has(key)){
   asked.set(key,{kind,object,field,criteria});
   askTimer??=setTimeout(()=>{askTimer=undefined;void askAggregates();},5);
  }
  // Still loading: the formula shows blank and redraws when the total arrives,
  // instead of doing arithmetic on an empty value ("Formula result must be finite").
     return notHeld('Total for '+object+' is loading',object,criteria);
 };
 /** Empty answer: a count or sum of no rows is 0 (as in Excel); other totals stay blank. */
 const emptyTotal=(kind:string)=>/^(?:COUNT|SUM)/i.test(kind)?0:'';
 const askAggregates=async()=>{
  const items=[...asked.entries()].slice(0,100);
  if(!items.length)return;
  try{
   const answer=await post<{values?:unknown[]}>('/page-code/aggregates',{...host.build,
    request:requestFor({},''),items:items.map(([,item])=>item)});
   items.forEach(([key,item],index)=>{
    // No answer (e.g. a blank criterion such as no customer picked yet): same as no rows.
    const value=answer.values?.[index];
    aggregates.set(key,value===undefined||value===null||value===''?emptyTotal(item.kind):value);
    asked.delete(key);
   });
  }catch{items.forEach(([key,item])=>{aggregates.set(key,emptyTotal(item.kind));asked.delete(key);});}
  changed();
  if(asked.size)void askAggregates();
 };
 /** Read the totals already shown again, keeping the old values on screen until the new
  * ones arrive (a customer display: the Till changes the rows, not this page). */
 let refreshingTotals=false;
 /** Asked again while a read was running (a second save landed meanwhile): read once more after it. */
 let totalsAgain:Set<string>|'all'|null=null;
 const refreshTotals=async(objects?:ReadonlySet<string>):Promise<void>=>{
  if(!aggregates.size)return;
  if(refreshingTotals){
   totalsAgain=!objects||totalsAgain==='all'?'all':new Set([...(totalsAgain??[]),...objects]);
   return;
  }
  // Only the totals over these Objects (a live change), else all of them.
  const keys=[...aggregates.keys()].filter(key=>!objects||objects.has(String(JSON.parse(key)[1]).toLowerCase())).slice(0,100);
  if(!keys.length)return;
  refreshingTotals=true;
  try{
   const items=keys.map(key=>{const [kind,object,field,criteria]=JSON.parse(key) as [string,string,string,Criteria];return {kind,object,field,criteria};});
   const answer=await post<{values?:unknown[]}>('/page-code/aggregates',{...host.build,request:requestFor({},''),items});
   let any=false;
   keys.forEach((key,index)=>{
    const raw=answer.values?.[index];
    const value=raw===undefined||raw===null||raw===''?emptyTotal(items[index].kind):raw;
    if(aggregates.has(key)&&JSON.stringify(aggregates.get(key))!==JSON.stringify(value)){aggregates.set(key,value);any=true;}
   });
   if(any)changed();
  }catch{/* keep the last totals; the next refresh tries again */}
  finally{
   refreshingTotals=false;
   const again=totalsAgain;totalsAgain=null;
   if(again)void refreshTotals(again==='all'?undefined:again);
  }
 };
 /** A save of these Objects: their server totals are read again. */
 const forgetAggregates=(objects:Iterable<string>)=>{
  const names=new Set(objects);
  let any=false;
  for(const key of [...aggregates.keys()])if(names.has(JSON.parse(key)[1])){aggregates.delete(key);any=true;}
  if(any)changed();
 };

 /** One `$` for display formulas and taps. `overlay`: simulated writes of a tap. */
 class Scope{
  readonly overlay=new Map<string,Map<string,Row|null>>();
  readonly changes:RecordChange[]=[];
  readonly effects:Effect[]=[];
  readonly stateChanges:Record<string,unknown>=Object.create(null);
  private created=0;
  constructor(readonly mode:'display'|'tap',private readonly ev:Row={},readonly row:Row={},private readonly batch=''){}
  get sessionId(){return host.sessionId();}
  now(){return new Date();}
  timeZone(){return businessTimeZone();}
  state(name:string){
   if(Object.prototype.hasOwnProperty.call(this.stateChanges,name))return this.stateChanges[name]??'';
   const value=host.state()[name];
   return value===undefined||value===null?'':value;
  }
  session(path:string){
   if(path==='cartId'){const id=this.state('activeCartId');return typeof id==='string'?id:'';}
   return sessionValue(path,host.state());
  }
  tenant(name:string){return tenantValue(name);}
  permission(name:string){return permissionValue(name);}
  /** @ThisPage.Till.*: known once this device's Till has loaded; the server decides on save. */
  till(field:string){
   const known=deviceTillState().status;
   if(known==='set'||known==='unset'||known==='error')return deviceTillValue(field);
   return notHeld('This device\'s Till is loading');
  }
  /** @ThisPage.Device.Ip / Agent are seen by the server: blank in the prediction. */
  // MirrorKey too: a customer display's totals (SUMIFS over the till's rows) read it here.
  device(field:string){return field==='Key'?tillDeviceKey():field==='MirrorKey'?mirrorDeviceKey():'';}
  component(id:string,property:string){
   if(!host.readComponent)throw Error('Select a component and property on this page');
   return host.readComponent(id,property);
  }
  componentState(name:string,field:string){
   // A value this action just set (`@ThisPage.CashBox.Value = …`) reads back at once.
   const set=this.stateChanges[COMPONENT_VALUES] as Record<string,unknown>|undefined;
   if(set&&Object.prototype.hasOwnProperty.call(set,name)&&(field==='Value'||field==='Text'))return set[name]??'';
   return readComponentState(host.state().collectionSelections,name,field as never);
  }
  /** @ThisPage.Button1.Disabled / Caption / Visible: set by this action, else what the page shows now. */
  property(name:string,property:string){
   const prop=uiProperty(property);
   if(!prop)throw Error('Unknown component property '+property);
   const mine=this.stateChanges[COMPONENT_PROPERTIES] as Record<string,{set?:Record<string,unknown>}>|undefined;
   const own=mine?.[name.toLowerCase()]?.set;
   if(own&&Object.prototype.hasOwnProperty.call(own,prop))return readComponentProperty({[COMPONENT_PROPERTIES]:mine},name,prop);
   return readComponentProperty(host.state(),name,prop);
  }
  /** `@ThisPage.Button2.Caption = …`: the page shows it at once (no server call for screen-only actions). */
  setProperty(name:string,property:string,value:unknown){
   if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name))throw Error('Invalid component name');
   const prop=uiProperty(property);
   if(!prop)throw Error('Unknown component property '+property);
   const next=withComponentProperties({[COMPONENT_PROPERTIES]:this.stateChanges[COMPONENT_PROPERTIES]},name,'set',
    {[prop]:uiPropertyValue(prop,value)});
   this.stateChanges[COMPONENT_PROPERTIES]=next[COMPONENT_PROPERTIES];
  }
  /** @ThisPage.Cart1.CartTotal: the component's own property, else the value its action saved. */
  pageValue(name:string,key:string){
   if(host.readComponent){
    try{return host.readComponent(name,key);}
    catch(error){if(!/^Unknown component property/.test(error instanceof Error?error.message:''))throw error;}
   }
   return this.state(key);
  }
  event(name:string){
   if(name==='record')return this.ev.record??{};
   const value=this.ev[name];
   return value===undefined||value===null?'':value;
  }
  f(row:unknown,field:string){
   const value=fieldValue(row as Row,field);
   return value===undefined||value===null?'':value;
  }
  /** Related value the page read for this row (@Product.ImageUrl on a cart line). */
  m(row:unknown,path:string){
   const values=(row as {__mentionValues?:Record<string,unknown>}|null)?.__mentionValues;
   if(!values||typeof values!=='object')return '';
   const exact='@'+path;
   if(Object.prototype.hasOwnProperty.call(values,exact)){
    const value=values[exact];
    return value===undefined||value===null?'':value;
   }
   // Page scripts are cached per saved page revision. Older scripts emitted
   // `Product.ImageUrl`; current metadata hydration stores the same validated
   // lookup as `CartLine.Product.ImageUrl`. Match that legacy suffix only when
   // it identifies one hydrated path on this row.
   const suffix='.'+path;
   const matches=Object.keys(values).filter(key=>key.endsWith(suffix));
   const value=matches.length===1?values[matches[0]]:undefined;
   return value===undefined||value===null?'':value;
  }
  connected(name:unknown){return isConnected(identity()?.connections as never,name);}
  verifyPin():never{return notHeld('VERIFYPIN is checked on the server');}
  /** Rows of `object` matching `criteria`, from a held set that has ALL of them. */
  rows(object:string,criteria:Criteria):Row[]{
   // By Id: one row, exact if this page holds it anywhere.
   const byId=criteria.find(([field])=>field==='Id');
   if(byId){
    const row=this.current(object,String(byId[1]??''),true);
    return row&&rowMatches(row,criteria)?[row]:[];
   }
   for(const set of code.recordSets){
    if(set.object!==object)continue;
    const held=sets.get(set.key);
    if(!held?.complete)continue;
    const needs=set.criteria(this);
    if(!needs.every(([field,value])=>criteria.some(([f,v])=>f===field&&same(v,value))))continue;
    if(set.parent?.key.startsWith(SHOWN_ROWS)){
     // Held for the rows the page showed when loaded: another row (new category) is read again.
     const wanted=criteria.find(([field])=>field===set.parent!.field);
     if(!wanted||!shownCoverage.get(set.key)?.has(String(wanted[1]??''))){api.shownChanged();continue;}
    }else if(set.parent){
     const parentIds=new Set(this.rows(byKey.get(set.parent.key)!.object,byKey.get(set.parent.key)!.criteria(this))
      .map(row=>String(row.Id??'')));
     const wanted=criteria.find(([field])=>field===set.parent!.field);
     if(!wanted||!parentIds.has(String(wanted[1]??'')))continue;
    }
    const local=this.overlay.get(object);
    const merged=new Map<string,Row>();
    for(const row of held.rows)merged.set(String(row.Id),row);
    for(const [id,row] of local??[]){if(row)merged.set(id,row);else merged.delete(id);}
    return [...merged.values()].filter(row=>rowMatches(row,criteria))
     .sort((a,b)=>String(a.CreatedAt??'').localeCompare(String(b.CreatedAt??'')));
   }
   return notHeld('Rows of '+object+' are not on this page',object,criteria);
  }
  agg(kind:string,object:string,field:string,criteria:Criteria){
   try{return aggregateRows(kind,this.rows(object,criteria),field);}
   catch(error){
    // Display: totals over rows this page does not hold come from the server (one
    // batched request, same code and permissions); blank until they arrive.
    if(this.mode!=='display'||!(error instanceof NotHeld))throw error;
    return serverAggregate(kind,object,field,criteria);
   }
  }
  async getRecord(object:string,criteria:Criteria){return this.rows(object,criteria)[0]??{};}
  async list(object:string,criteria:Criteria){return this.rows(object,criteria);}
  private write(object:string,id:string,row:Row|null){
   let map=this.overlay.get(object);
   if(!map){map=new Map();this.overlay.set(object,map);}
   map.set(id,row);
  }
  private current(object:string,provisional:string,lookup=false):Row|null{
   const id=savedId(provisional);
   const local=this.overlay.get(object)?.get(id);
   if(local===null){if(lookup)return null;notHeld('Deleted');}
   if(local)return local;
   for(const set of code.recordSets)if(set.object===object){
    const row=sets.get(set.key)?.rows.find(item=>item.Id===id);
    if(row)return row;
   }
   return notHeld('Row '+id+' of '+object+' is not on this page',object);
  }
  async create(object:string,pairs:Criteria){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   const id=optimisticIdPrefix(this.batch)+String(++this.created).padStart(4,'0');
   const row:Row={Id:id,CreatedAt:new Date().toISOString(),...Object.fromEntries(pairs.map(([key,value])=>[key,mapValue(value)]))};
   this.write(object,id,row);
   this.changes.push({objectApiName:object,operation:'create',record:row});
   return row;
  }
  async update(object:string,id:unknown,pairs:Criteria){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   const key=savedId(String(id));
   const row={...this.current(object,key)!,...Object.fromEntries(pairs.map(([name,value])=>[name,mapValue(value)]))};
   this.write(object,key,row);
   this.changes.push({objectApiName:object,operation:'update',record:row});
   return row;
  }
  /** Loop saves whose result is not used: here the same as create/update (the server
   * saves them together). */
  async createLater(object:string,pairs:Criteria){await this.create(object,pairs);}
  async updateLater(object:string,id:unknown,pairs:Criteria){await this.update(object,id,pairs);}
  /** A batched FOREACH (set-based loop): the same saves the server makes, over the loop's rows. */
  async createFrom(object:string,rows:readonly Row[],fields:Array<[string,(row:Row)=>unknown]>){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   for(const row of rows)await this.create(object,await rowPairs(fields,row));
  }
  async updateWhere(object:string,rows:readonly Row[],fields:Array<[string,(row:Row)=>unknown]>){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   for(const row of rows)await this.update(object,row.Id,await rowPairs(fields,row));
  }
  async removeWhere(object:string,rows:readonly Row[]){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   for(const row of rows)await this.remove(object,row.Id);
  }
  async remove(object:string,id:unknown){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   const key=savedId(String(id));
   this.current(object,key);
   this.write(object,key,null);
   this.changes.push({objectApiName:object,operation:'delete',record:{Id:key}});
  }
  setState(name:string,value:unknown){this.stateChanges[name]=value;}
  /** `@ThisPage.CashBox.Value = …`: the component shows and holds the new value. */
  setValue(name:string,value:unknown){
   const set={...(this.stateChanges[COMPONENT_VALUES] as Record<string,unknown>|undefined)};
   set[name]=value===undefined?'':value;
   this.stateChanges[COMPONENT_VALUES]=set;
  }
  async ui(name:string,...args:unknown[]){this.effects.push({name,args});}
  async service(name:string):Promise<never>{return notHeld(name+' runs on the server');}
 }

 const display=new Scope('display');
 const formulaCache=new Map<string,(row:Row)=>unknown>();
 /** Held rows after a tap's simulated writes. */
 const applyOverlay=(scope:Scope,overlay:Scope['overlay']=scope.overlay)=>{
  for(const set of code.recordSets){
   const local=overlay.get(set.object);
   const held=sets.get(set.key);
   if(!local||!held)continue;
   const criteria=set.criteria(scope);
   const rows=new Map(held.rows.map(row=>[String(row.Id),row]));
   for(const [id,row] of local){
    if(row&&rowMatches(row,criteria))rows.set(id,row);
    else rows.delete(id);
   }
   sets.set(set.key,{...held,rows:[...rows.values()]});
  }
 };
 /** A waiting tap's predicted rows with the saved Ids of rows saved since it was predicted. */
 const savedOverlay=(scope:Scope):Scope['overlay']=>new Map([...scope.overlay].map(([object,rows])=>[object,
  new Map([...rows].map(([id,row])=>[savedId(id),row&&Object.fromEntries(Object.entries(row).map(([key,value])=>[key,mapValue(value)]))]))]));
 /** Put the predictions of taps still waiting (after `seq`) back on top of the held rows. */
 const reapplyWaiting=(seq:number)=>{
  for(const item of waitingTaps)if(item.seq>seq&&item.scope)applyOverlay(item.scope,savedOverlay(item.scope));
 };
 /** This tap's new rows, saved: provisional Id -> saved Id (per Object, in the order made). */
 const noteSavedIds=(predicted:readonly RecordChange[],saved:readonly RecordChange[])=>{
  const creates=(list:readonly RecordChange[],object:string)=>list.filter(change=>change.objectApiName===object&&change.operation==='create')
   .map(change=>String(change.record.Id));
  for(const object of new Set(predicted.map(change=>change.objectApiName))){
   const mine=creates(predicted,object),real=creates(saved,object);
   if(mine.length!==real.length)continue;
   mine.forEach((id,index)=>{
    savedIds.set(id,real[index]);
    if(savedIds.size>200)savedIds.delete(savedIds.keys().next().value as string);
   });
  }
 };
 const post=<T>(path:string,body:unknown)=>host.request<T>(host.endpoint+path,{method:'POST',body:JSON.stringify(body)});
 // The device key goes with every request: the server maps it to this device's Till.
 const usesDevice=Object.values(code.sources).some(source=>/@ThisPage\.(?:Till|Device)\./i.test(String(source)))
  ||Object.values(code.actions).some(action=>/\$\.(?:till|device)\(/.test(String(action.run)));
 const usesTill=usesDevice&&(Object.values(code.sources).some(source=>/@ThisPage\.(?:Till\.|Device\.MirrorKey)/i.test(String(source)))
  ||Object.values(code.actions).some(action=>String(action.run).includes('$.till(')));
 if(usesTill){
  subscribeDeviceTill(changed);
  void loadDeviceTill(host.request);
 }
 const requestFor=(ev:Row,rowObject:string)=>({sessionId:host.sessionId(),state:host.state(),rowObject,
  ...(shownObjects.length?{shown:shownNow()}:{}),
  ...(usesDevice?{deviceKey:tillDeviceKey(),...(openerMirrorKey()?{mirrorKey:openerMirrorKey()}:{})}:{}),
  event:{recordId:ev.recordId,value:ev.value,index:ev.index,label:ev.label},
  timeZone:businessTimeZone()});

 let tapGate:Promise<void>=Promise.resolve();
 const api={
  code,
  /** The page reads @ThisPage.Till: this device must be set up as a Till. */
  usesTill,
  /** The page needs THIS device's Till (@ThisPage.Till.*), not only the Till it mirrors (a customer display). */
  asksTill:Object.values(code.sources).some(source=>/@ThisPage\.Till\./i.test(String(source)))
   ||Object.values(code.actions).some(action=>String(action.run).includes('$.till(')),
  /** Lookups the held rows could not answer (shown by the till speed test). */
  /** Lookups the held rows could not answer: {componentName,event,reason,object,criteria}. */
  misses:[] as Array<{componentName:string;event:string;reason:string;object?:string;criteria?:unknown}>,
  subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
  version:()=>version,
  /** A compiled display formula for this component property, or null. */
  formula(key:string):((row:Row)=>unknown)|null{
   const run=code.formulas[key];
   if(!run)return null;
   let bound=formulaCache.get(key);
   if(!bound){bound=(row:Row)=>run(row??{},display);formulaCache.set(key,bound);}
   return bound;
  },
  /** A formula text that is not in the page file (given at run time): converted by the same
   * converter and run with this page's `$` (totals over rows not held come from the server). */
  compile(text:unknown,rowObject=''):((row:Row)=>unknown)|null{
   if(!looksLikeFormula(text))return null;
   const run=formulaFunction(text,rowObject);
   return (row:Row)=>run(row??{},display);
  },
  /** A parsed formula part (a value inside a COLLECTION data source), same converter. */
  compileNode(node:Expression,rowObject=''):(row:Row)=>unknown{
   const run=nodeFunction(node,rowObject);
   return (row:Row)=>run(row??{},display);
  },
  /** Component property -> formula function, keyed by the formula text (what the component holds). */
  formulasFor(componentId:string):Map<string,(row:Row)=>unknown>{
   const map=new Map<string,(row:Row)=>unknown>();
   for(const key of Object.keys(code.formulas))
    if(key.startsWith(componentId+':')){
     map.set(code.sources[key],this.formula(key)!);
     const shape=formulaShape(code.sources[key]);
     if(shape)map.set('shape:'+shape,this.formula(key)!);
    }
   return map;
  },
  /** Component property -> formula function (to match the text after page state was filled in). */
  formulasByProperty(componentId:string):Map<string,(row:Row)=>unknown>{
   const map=new Map<string,(row:Row)=>unknown>();
   for(const key of Object.keys(code.formulas))
    if(key.startsWith(componentId+':'))map.set(key.slice(componentId.length+1),this.formula(key)!);
   return map;
  },
  hasAction:(key:string)=>Object.prototype.hasOwnProperty.call(code.actions,key),
  /** Load every record set for the current state (one request). */
  async loadSets(rowObject=''){
   if(!code.recordSets.length)return;
   const localKey=host.local?.key()??null;
   // Page open: the held rows from last time show at once (taps and totals work at once too).
   if(localKey&&!sets.size)void host.local!.read<{sets:Record<string,{rows:Row[];complete:boolean}>;coverage:Record<string,string[]>}>(localKey)
    .then(saved=>{
     if(!saved||sets.size)return;
     for(const [key,value] of Object.entries(saved.sets??{}))if(byKey.has(key))sets.set(key,value);
     for(const [key,ids] of Object.entries(saved.coverage??{}))shownCoverage.set(key,new Set(ids));
     changed();
    }).catch(()=>undefined);
   const request=requestFor({},rowObject);
   const answer=await post<{ok:boolean;sets:ServerResult['sets']}>('/page-code/sets',{...host.build,request});
   for(const [key,value] of Object.entries(answer.sets??{})){
    sets.set(key,value);
    const parent=byKey.get(key)?.parent?.key;
    if(parent?.startsWith(SHOWN_ROWS))shownCoverage.set(key,new Set(request.shown?.[parent.slice(SHOWN_ROWS.length)]??[]));
   }
   changed();
   if(localKey)host.local!.write(localKey,{sets:Object.fromEntries(sets),
    coverage:Object.fromEntries([...shownCoverage].map(([key,ids])=>[key,[...ids]]))});
  },
  /** Objects whose shown rows the held sets follow (the page reloads them when those rows change). */
  shownObjects,
  /** The shown rows changed (another category, a search): read their held rows again, once. */
  shownChanged(){
   if(!shownObjects.length||shownReload)return;
   shownReload=setTimeout(()=>{
    shownReload=undefined;
    const now=shownNow();
    const same=code.recordSets.every(set=>{
     const parent=set.parent?.key;
     if(!parent?.startsWith(SHOWN_ROWS))return true;
     const ids=now[parent.slice(SHOWN_ROWS.length)]??[],had=shownCoverage.get(set.key);
     return Boolean(had)&&ids.every(id=>had!.has(id));
    });
    if(!same)void api.loadSets().catch(()=>undefined);
   },120);
  },
  setsFor:(key:string)=>sets.get(key),
  /** Re-read the server totals on screen without blanking them (live customer display). */
  refreshTotals:()=>refreshTotals(),
  /** Someone saved records of these Objects (a live change): re-read the totals and
   * record sets over them, keeping what is on screen until the new values arrive. */
  async liveChanged(objects:readonly string[],withoutRows:readonly string[]=objects){
   const names=new Set(objects.map(name=>name.toLowerCase()));
   // Held rows were patched from the change itself (applyLiveRows); only changes that
   // came without rows (bulk saves) read the held sets again.
   const reread=new Set(withoutRows.map(name=>name.toLowerCase()));
   await Promise.all([
    refreshTotals(names),
    code.recordSets.some(set=>reread.has(String(set.object).toLowerCase()))?this.loadSets():Promise.resolve()
   ]);
  },
  /** Saved rows pushed live: update the held rows in place (totals over them redraw at once). */
  applyLiveRows(object:string,rows:ReadonlyArray<Row>,gone:readonly string[]=[]){
   const name=object.toLowerCase();
   const removed=new Set(gone);
   let any=false;
   const scope=new Scope('display');
   for(const set of code.recordSets){
    if(String(set.object).toLowerCase()!==name)continue;
    const held=sets.get(set.key);
    if(!held)continue;
    let criteria:Criteria;
    try{criteria=set.criteria(scope);}catch{continue;}
    const parentIds=set.parent?.key.startsWith(SHOWN_ROWS)?shownCoverage.get(set.key)
     :set.parent?new Set((sets.get(set.parent.key)?.rows??[]).map(row=>String(row.Id??''))):null;
    const belongs=(row:Row)=>rowMatches(row,criteria)&&(!set.parent||Boolean(parentIds?.has(String(row[set.parent.field]??''))));
    const byId=new Map(held.rows.map(row=>[String(row.Id??''),row]));
    for(const id of removed)if(byId.delete(id))any=true;
    for(const row of rows){
     const id=String(row.Id??'');
     if(belongs(row)){byId.set(id,{...byId.get(id),...row});any=true;}
     else if(byId.delete(id))any=true;
    }
    sets.set(set.key,{...held,rows:[...byId.values()]});
   }
   if(any)changed();
  },
  /** The page reads @ThisPage.Device.MirrorKey: it shows another screen's sale. */
  readsMirror:Object.values(code.sources).some(source=>/@ThisPage\.Device\.MirrorKey/i.test(String(source))),
  /**
   * Run an action. `show` receives the predicted (then the saved) record changes
   * and state; `effects` runs the UI steps after the save. Throws on failure
   * after undoing the predicted change.
   */
  async run(key:string,ev:Row,rowObject:string,io:TapIo):Promise<void>{
   const action=code.actions[key];
   if(!action)throw Error('Unknown page action '+key);
   // Taps run in order: each starts once the previous tap's change is on screen
   // (never after its save), so 1-2-3-3 typed fast reads 123 and gives 1233.
   let release!:()=>void;
   const previous=tapGate;
   const mine=new Promise<void>(resolve=>{release=resolve;});
   tapGate=previous.then(()=>mine);
   await previous;
   try{
    return await runTap(action,key,ev,rowObject,io,release);
   }finally{release();}
  },
 };
 async function runTap(action:PageCode['actions'][string],key:string,ev:Row,rowObject:string,io:TapIo,release:()=>void):Promise<void>{
  {
   const batch=((++batches)%0x10000000).toString(16).padStart(8,'0');
   const record=(ev.record&&typeof ev.record==='object'?ev.record:ev) as Row;
   const event={...ev,record,recordId:ev.recordId??record.Id};
   const tap=new Scope('tap',event,record,batch);
   const timing=startTap(host.page??'',key);
   let predicted=false;
   const before=new Map(sets);
   try{
    await action.run(tap);
    predicted=true;
   }catch(error){
    if(!(error instanceof NotHeld))throw error;
    note(key,error.object?'unheld:'+error.object:'unheld',error.object||undefined,error.criteria);
   }
   if(!action.data){
    // Screen-only action (STATE, SCREEN, LOCKSCREEN): nothing to save.
    if(!predicted)throw Error('This action needs the server');
    io.show({changes:[],state:{...tap.stateChanges}});
    timing.shown(true);
    release();
    await io.effects(tap.effects);
    return;
   }
   // A popup (SCREEN) the prediction opens is opened at once, not after the save;
   // other UI steps (PRINT, ...) still wait for the saved rows.
   // Not a popup for a row this tap creates: its Id is only provisional until the save,
   // so that popup opens after the save, with the saved Id (else it shows an empty record).
   const early=predicted?earlyScreens(tap.effects,tap.changes):[];
   // The prediction goes with the save: the server shows it at once on this login's other
   // screens (a customer display), then replaces it with the saved rows.
   noteOwnBatch(batch);
   const seq=++tapSeq;
   waitingTaps.push({seq,scope:predicted?tap:null});
   const answered=()=>{const index=waitingTaps.findIndex(item=>item.seq===seq);if(index>=0)waitingTaps.splice(index,1);};
   const saving=post<ServerResult>('/page-code/execute',{...host.build,key,request:requestFor(event,rowObject),
    live:predicted&&tap.changes.length?{batch,changes:tap.changes}:{batch}});
   if(predicted){
    applyOverlay(tap);changed();
    io.show({changes:tap.changes,state:{...tap.stateChanges},optimistic:batch});
    timing.shown(true);
    if(early.length)void io.effects(early).catch(()=>undefined);
   }
   release();
   let result:ServerResult;
   try{
    result=await saving;
    // Device steps: run each in the browser when asked, then send the action again
    // with the answers. Nothing is saved until the whole action can run.
    const device:Record<string,unknown>={};
    for(let round=0;result.needs&&round<5;round++){
     if(!io.device)throw Error(result.needs.name+' is not available here');
     device[result.needs.key]=await io.device(result.needs);
     result=await post<ServerResult>('/page-code/execute',{...host.build,key,request:{...requestFor(event,rowObject),device},live:{batch}});
    }
    if(result.needs)throw Error('Too many device steps in one action');
   }
   catch(error){result={ok:false,error:error instanceof Error?error.message:'The save failed',changes:[],state:{},effects:[],sets:{}};}
   answered();
   if(!result.ok){
    // Undo the screen change: the held rows and lists go back to what SQL has
    // (taps made after this one keep their predictions until their own answers).
    if(predicted){sets.clear();for(const [k,v] of before)sets.set(k,v);reapplyWaiting(seq);changed();}
    io.show({changes:[],state:{},failed:true,replaces:predicted?batch:undefined});
    if(early.length)await io.effects([{name:'CLOSESCREEN',args:[]}]).catch(()=>undefined);
    throw Error(result.error||'The save failed; nothing was saved');
   }
   // The server took the other branch (it read what this page does not hold): close what the
   // prediction opened and record why, then let the server's own steps run below.
   if(predicted&&early.length){
    const dropped=early.filter(effect=>!result.effects.some(item=>JSON.stringify(item)===JSON.stringify(effect)));
    if(dropped.length){
     note(key,'server-differs');
     await io.effects(dropped.map(()=>({name:'CLOSESCREEN',args:[]}))).catch(()=>undefined);
    }
   }
   if(predicted)noteSavedIds(tap.changes,result.changes);
   // An older answer arriving after a newer one never replaces the newer saved rows.
   if(seq>answeredSeq){
    answeredSeq=seq;
    for(const [setKey,value] of Object.entries(result.sets))sets.set(setKey,value);
    reapplyWaiting(seq);
   }
   forgetAggregates(result.changes.map(change=>change.objectApiName));
   changed();
   io.show({changes:result.changes,state:result.state,replaces:predicted?batch:undefined});
   timing.shown(false);timing.saved();
   // Skip the popups already opened from the prediction (same screen, same arguments).
   const opened=early.map(effect=>JSON.stringify(effect));
   await io.effects(result.effects.filter(effect=>{
    const index=opened.indexOf(JSON.stringify(effect));
    if(index<0)return true;
    opened.splice(index,1);return false;
   }));
  }
 };
 /** One missed lookup: which component and event, and the first read the held rows could not
 * answer (unheld:<Object>, server-differs, ...). Kept for window.__unePageCode.misses. */
function note(key:string,reason:string,object?:string,criteria?:unknown){
 const at=key.lastIndexOf(':');
 api.misses.push({componentName:at>0?key.slice(0,at):key,event:at>0?key.slice(at+1):'',reason,
  ...(object?{object}:{}),...(criteria===undefined?{}:{criteria})});
 if(api.misses.length>20)api.misses.shift();
}
// Debug handle for the speed test script (window.__unePageCode).
 try{(globalThis as Record<string,unknown>).__unePageCode=api;}catch{/* frozen global */}
 return api;
}
export type PageCodeRuntime=ReturnType<typeof createPageCodeRuntime>;
/** Popups a prediction may open at once: SCREEN steps that name no row this tap creates. */
export function earlyScreens(effects:readonly Effect[],changes:readonly RecordChange[]):Effect[]{
 const made=changes.filter(change=>change.operation==='create').map(change=>String(change.record.Id??'')).filter(Boolean);
 return effects.filter(effect=>effect.name==='SCREEN'&&!made.some(id=>JSON.stringify(effect.args).includes(id)));
}

