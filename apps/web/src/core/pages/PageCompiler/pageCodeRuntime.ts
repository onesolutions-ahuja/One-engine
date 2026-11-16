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
import {readComponentState} from '../../../../../server/src/expression-engine/FormulaComponentState.js';
import {isConnected} from '../../../../../server/src/expression-engine/FormulaConnections.js';
import {getTenantBrand} from '../../../component-libraries/shared/TenantBrand.js';
import {optimisticIdPrefix} from '../PageRuntime/predictActionPlan';

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

/** A lookup the held rows cannot answer exactly: no prediction (the server answers). */
export class NotHeld extends Error { readonly notHeld=true; }
const notHeld=(why:string):never=>{throw new NotHeld(why);};
const identityKey=Symbol.for('une.authenticatedFormulaIdentity');
const identity=()=>(globalThis as Record<symbol,unknown>)[identityKey] as undefined|{
 user?:Record<string,unknown>;organization?:Record<string,unknown>;connections?:unknown};
const sessionUser:Record<string,string>={id:'Id',name:'Name',email:'Email',timeZone:'TimeZone',locale:'Locale',currencyIsoCode:'CurrencyIsoCode'};
const same=(a:unknown,b:unknown)=>String(a??'')===String(b??'');
let batches=Math.floor(Math.random()*0x10000)*0x1000;

export type PageCodeHost={
 request:Request;
 /** '/apps/:appId' (published) or '/pages/:apiName' (Builder Preview). */
 endpoint:string;
 /** Build id (published) / preview id: the server runs ITS copy of the same build. */
 build:{buildId?:string;previewId?:string};
 sessionId():string;
 state():Readonly<Record<string,unknown>>;
 readComponent?(component:string,property:string):unknown;
};

export function createPageCodeRuntime(code:PageCode,host:PageCodeHost){
 const sets=new Map<string,{rows:Row[];complete:boolean}>();
 const listeners=new Set<()=>void>();
 let version=0;
 const changed=()=>{version++;listeners.forEach(listener=>listener());};
 const byKey=new Map(code.recordSets.map(set=>[set.key,set]));
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
  return '';
 };
 const askAggregates=async()=>{
  const items=[...asked.entries()].slice(0,100);
  if(!items.length)return;
  try{
   const answer=await post<{values?:unknown[]}>('/page-code/aggregates',{...host.build,
    request:requestFor({},''),items:items.map(([,item])=>item)});
   items.forEach(([key],index)=>{aggregates.set(key,answer.values?.[index]??'');asked.delete(key);});
  }catch{items.forEach(([key])=>{aggregates.set(key,'');asked.delete(key);});}
  changed();
  if(asked.size)void askAggregates();
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
  timeZone(){return String(identity()?.user?.TimeZone||'UTC');}
  state(name:string){
   if(Object.prototype.hasOwnProperty.call(this.stateChanges,name))return this.stateChanges[name]??'';
   const value=host.state()[name];
   return value===undefined||value===null?'':value;
  }
  session(path:string){
   if(path==='cartId'){const id=this.state('activeCartId');return typeof id==='string'?id:'';}
   const user=identity()?.user,org=identity()?.organization;
   if(path.startsWith('user.')&&sessionUser[path.slice(5)])return user?.[sessionUser[path.slice(5)]]??'';
   if(path==='tenant.id')return org?.Id??'';
   if(path==='tenant.name')return getTenantBrand().name||org?.Name||'';
   if(path==='tenant.logo')return getTenantBrand().logo??'';
   throw Error('Unsupported session reference: $session.'+path);
  }
  tenant(name:string){const brand=getTenantBrand();return (name==='name'?brand.name:brand.logo)??'';}
  component(id:string,property:string){
   if(!host.readComponent)throw Error('Select a component and property on this page');
   return host.readComponent(id,property);
  }
  componentState(name:string,field:string){return readComponentState(host.state().collectionSelections,name,field as never);}
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
   const value=values&&typeof values==='object'?values['@'+path]:undefined;
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
    if(set.parent){
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
   return notHeld('Rows of '+object+' are not on this page');
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
  private current(object:string,id:string,lookup=false):Row|null{
   const local=this.overlay.get(object)?.get(id);
   if(local===null){if(lookup)return null;notHeld('Deleted');}
   if(local)return local;
   for(const set of code.recordSets)if(set.object===object){
    const row=sets.get(set.key)?.rows.find(item=>item.Id===id);
    if(row)return row;
   }
   return notHeld('Row '+id+' of '+object+' is not on this page');
  }
  async create(object:string,pairs:Criteria){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   const id=optimisticIdPrefix(this.batch)+String(++this.created).padStart(4,'0');
   const row:Row={Id:id,CreatedAt:new Date().toISOString(),...Object.fromEntries(pairs)};
   this.write(object,id,row);
   this.changes.push({objectApiName:object,operation:'create',record:row});
   return row;
  }
  async update(object:string,id:unknown,pairs:Criteria){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   const row={...this.current(object,String(id))!,...Object.fromEntries(pairs)};
   this.write(object,String(id),row);
   this.changes.push({objectApiName:object,operation:'update',record:row});
   return row;
  }
  async remove(object:string,id:unknown){
   if(this.mode!=='tap')throw Error('Formulas cannot save records');
   this.current(object,String(id));
   this.write(object,String(id),null);
   this.changes.push({objectApiName:object,operation:'delete',record:{Id:String(id)}});
  }
  setState(name:string,value:unknown){this.stateChanges[name]=value;}
  async ui(name:string,...args:unknown[]){this.effects.push({name,args});}
  async service(name:string):Promise<never>{return notHeld(name+' runs on the server');}
 }

 const display=new Scope('display');
 const formulaCache=new Map<string,(row:Row)=>unknown>();
 /** Held rows after a tap's simulated writes. */
 const applyOverlay=(scope:Scope)=>{
  for(const set of code.recordSets){
   const local=scope.overlay.get(set.object);
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
 const post=<T>(path:string,body:unknown)=>host.request<T>(host.endpoint+path,{method:'POST',body:JSON.stringify(body)});
 const requestFor=(ev:Row,rowObject:string)=>({sessionId:host.sessionId(),state:host.state(),rowObject,
  event:{recordId:ev.recordId,value:ev.value,index:ev.index,label:ev.label},
  timeZone:typeof Intl!=='undefined'?Intl.DateTimeFormat().resolvedOptions().timeZone:undefined});

 const api={
  code,
  /** Lookups the held rows could not answer (shown by the till speed test). */
  misses:[] as string[],
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
  /** Component property -> formula function, keyed by the formula text (what the component holds). */
  formulasFor(componentId:string):Map<string,(row:Row)=>unknown>{
   const map=new Map<string,(row:Row)=>unknown>();
   for(const key of Object.keys(code.formulas))
    if(key.startsWith(componentId+':'))map.set(code.sources[key],this.formula(key)!);
   return map;
  },
  hasAction:(key:string)=>Object.prototype.hasOwnProperty.call(code.actions,key),
  /** Load every record set for the current state (one request). */
  async loadSets(rowObject=''){
   if(!code.recordSets.length)return;
   const answer=await post<{ok:boolean;sets:ServerResult['sets']}>('/page-code/sets',{...host.build,request:requestFor({},rowObject)});
   for(const [key,value] of Object.entries(answer.sets??{}))sets.set(key,value);
   changed();
  },
  setsFor:(key:string)=>sets.get(key),
  /**
   * Run an action. `show` receives the predicted (then the saved) record changes
   * and state; `effects` runs the UI steps after the save. Throws on failure
   * after undoing the predicted change.
   */
  async run(key:string,ev:Row,rowObject:string,io:{
   show(update:{changes:RecordChange[];state:Record<string,unknown>;optimistic?:string;replaces?:string;failed?:boolean}):void;
   effects(effects:Effect[]):Promise<void>;
   /** A device step the server asked for (LOCATION, CREATEPDF): its answer. */
   device?(step:{name:string;args:unknown[]}):Promise<unknown>;
  }){
   const action=code.actions[key];
   if(!action)throw Error('Unknown page action '+key);
   const batch=((++batches)%0x10000000).toString(16).padStart(8,'0');
   const record=(ev.record&&typeof ev.record==='object'?ev.record:ev) as Row;
   const event={...ev,record,recordId:ev.recordId??record.Id};
   const tap=new Scope('tap',event,record,batch);
   let predicted=false;
   const before=new Map(sets);
   try{
    await action.run(tap);
    predicted=true;
   }catch(error){
    if(!(error instanceof NotHeld))throw error;
    api.misses.push(key+': '+error.message);
    if(api.misses.length>20)api.misses.shift();
   }
   if(!action.data){
    // Screen-only action (STATE, SCREEN, LOCKSCREEN): nothing to save.
    if(!predicted)throw Error('This action needs the server');
    io.show({changes:[],state:{...tap.stateChanges}});
    await io.effects(tap.effects);
    return;
   }
   // A popup (SCREEN) the prediction opens is opened at once, not after the save;
   // other UI steps (PRINT, ...) still wait for the saved rows.
   const early=predicted?tap.effects.filter(effect=>effect.name==='SCREEN'):[];
   const saving=post<ServerResult>('/page-code/execute',{...host.build,key,request:requestFor(event,rowObject)});
   if(predicted){
    applyOverlay(tap);changed();
    io.show({changes:tap.changes,state:{...tap.stateChanges},optimistic:batch});
    if(early.length)void io.effects(early).catch(()=>undefined);
   }
   let result:ServerResult;
   try{
    result=await saving;
    // Device steps: run each in the browser when asked, then send the action again
    // with the answers. Nothing is saved until the whole action can run.
    const device:Record<string,unknown>={};
    for(let round=0;result.needs&&round<5;round++){
     if(!io.device)throw Error(result.needs.name+' is not available here');
     device[result.needs.key]=await io.device(result.needs);
     result=await post<ServerResult>('/page-code/execute',{...host.build,key,request:{...requestFor(event,rowObject),device}});
    }
    if(result.needs)throw Error('Too many device steps in one action');
   }
   catch(error){result={ok:false,error:error instanceof Error?error.message:'The save failed',changes:[],state:{},effects:[],sets:{}};}
   if(!result.ok){
    // Undo the screen change: the held rows and lists go back to what SQL has.
    if(predicted){sets.clear();for(const [k,v] of before)sets.set(k,v);changed();}
    io.show({changes:[],state:{},failed:true,replaces:predicted?batch:undefined});
    if(early.length)await io.effects([{name:'CLOSESCREEN',args:[]}]).catch(()=>undefined);
    throw Error(result.error||'The save failed; nothing was saved');
   }
   for(const [setKey,value] of Object.entries(result.sets))sets.set(setKey,value);
   forgetAggregates(result.changes.map(change=>change.objectApiName));
   changed();
   io.show({changes:result.changes,state:result.state,replaces:predicted?batch:undefined});
   // Skip the popups already opened from the prediction (same screen, same arguments).
   const opened=early.map(effect=>JSON.stringify(effect));
   await io.effects(result.effects.filter(effect=>{
    const index=opened.indexOf(JSON.stringify(effect));
    if(index<0)return true;
    opened.splice(index,1);return false;
   }));
  }
 };
 // Debug handle for the speed test script (window.__unePageCode).
 try{(globalThis as Record<string,unknown>).__unePageCode=api;}catch{/* frozen global */}
 return api;
}
export type PageCodeRuntime=ReturnType<typeof createPageCodeRuntime>;
