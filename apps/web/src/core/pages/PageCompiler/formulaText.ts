/**
 * One formula engine for every value a page shows: the page converter's generated code.
 *
 * Formulas saved with a page are converted on save (page code, pageCode.ts) and run
 * from the page file. A formula text that is not in the page file (a value given at
 * run time, a Builder canvas, a Flow choice, a quantity formula) is converted HERE by
 * the very same converter (generateCode.ts + formulaDictionary.ts) into the same plain
 * function, once per text, and run with the same `$`. There is no formula interpreter:
 * a formula the converter cannot turn into code shows its save error, never another engine.
 */
import {compileDisplayFormula,compileDisplayNode,FormulaCodeError} from '../../../../../server/src/page-compiler/code/generateCode.js';
import {F,O,fieldValue} from '../../../../../server/src/page-compiler/code/formulaLibrary.js';
import {modernizeFormula} from '../../../../../server/src/expression-engine/PageReferences.js';
import type {Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {formulaEntry} from '../../../../../server/src/page-compiler/code/formulaDictionary.js';
import {readComponentState,readComponentProperty,uiProperty} from '../../../../../server/src/expression-engine/FormulaComponentState.js';
import {isConnected} from '../../../../../server/src/expression-engine/FormulaConnections.js';
import {getTenantBrand} from '../../../component-libraries/shared/TenantBrand.js';
import {componentReaderKey} from '../../../component-libraries/shared/formulaKeys.js';
import {deviceTillValue,mirrorDeviceKey,tillDeviceKey} from '../../authentication/TillDevice/deviceTill';

type Row=Record<string,unknown>;
export type FormulaFunction=(row:Row,scope:unknown)=>unknown;
/** What a formula run outside a page file can read. */
export type FormulaContext={
 sessionId?:string;
 pageState?:Readonly<Row>;
 readComponent?:(name:string,key:string)=>unknown;
 /** Event values of an action (@event.value, @recordId). */
 event?:Readonly<Row>;
 /** Object of the row (@Product.Name on a Product row). */
 rowObject?:string;
 now?:Date;
};

/** A lookup this scope cannot answer here (a total over rows the page does not hold). */
export class FormulaNotHere extends Error { readonly notHeld=true; }

const identityKey=Symbol.for('une.authenticatedFormulaIdentity');
const identity=()=>(globalThis as Record<symbol,unknown>)[identityKey] as undefined|{
 user?:Row;organization?:Row;connections?:unknown};
const sessionUser:Record<string,string>={id:'Id',name:'Name',email:'Email',timeZone:'TimeZone',locale:'Locale',
 currencyIsoCode:'CurrencyIsoCode',managerId:'Manager',managerName:'ManagerName'};
/** @ThisTenant / signed-in user values, read the same way by page code and here. */
export function sessionValue(path:string,state:Readonly<Row>):unknown{
 if(path==='cartId'){const id=state.activeCartId;return typeof id==='string'?id:'';}
 const user=identity()?.user,org=identity()?.organization;
 if(path.startsWith('user.')&&sessionUser[path.slice(5)])return user?.[sessionUser[path.slice(5)]]??'';
 if(path==='tenant.id')return org?.Id??'';
 if(path==='tenant.name')return getTenantBrand().name||org?.Name||'';
 if(path==='tenant.logo')return getTenantBrand().logo??'';
 throw Error('Unsupported tenant value: '+path);
}

/** The `$` a converted display formula reads, for a run outside a page file. */
class StandaloneScope{
 constructor(private readonly ctx:FormulaContext){}
 get sessionId(){return this.ctx.sessionId??'';}
 private get pageState():Readonly<Row>{return this.ctx.pageState??{};}
 now(){return this.ctx.now??new Date();}
 timeZone(){return String(identity()?.user?.TimeZone||'UTC');}
 state(name:string){const value=this.pageState[name];return value===undefined||value===null?'':value;}
 session(path:string){return sessionValue(path,this.pageState);}
 tenant(name:string){const brand=getTenantBrand();return (name==='name'?brand.name:brand.logo)??'';}
 till(field:string){return deviceTillValue(field);}
 device(field:string){return field==='Key'?tillDeviceKey():field==='MirrorKey'?mirrorDeviceKey():'';}
 private reader(){
  return this.ctx.readComponent
   ??(this.pageState as {[componentReaderKey]?:FormulaContext['readComponent']})[componentReaderKey];
 }
 component(id:string,property:string){
  const read=this.reader();
  return read?read(id,property):'';
 }
 componentState(name:string,field:string){
  return readComponentState(this.pageState.collectionSelections as never,name,field as never);
 }
 property(name:string,property:string){
  const prop=uiProperty(property);
  if(!prop)throw Error('Unknown component property '+property);
  return readComponentProperty(this.pageState,name,prop);
 }
 pageValue(name:string,key:string){
  const read=this.reader();
  if(read){
   try{return read(name,key);}
   catch(error){if(!/^Unknown component property/.test(error instanceof Error?error.message:''))throw error;}
  }
  return this.state(key);
 }
 event(name:string){
  const ev=this.ctx.event??{};
  if(name==='record')return ev.record??{};
  const value=ev[name];
  return value===undefined||value===null?'':value;
 }
 f(row:unknown,field:string){
  let value=fieldValue(row as Row,field);
  // A related value the page read for this row (@Product.Customer.Name).
  if(value===undefined&&field.includes('.')&&this.ctx.rowObject)value=this.m(row,this.ctx.rowObject+'.'+field);
  return value===undefined||value===null?'':value;
 }
 m(row:unknown,path:string){
  const values=(row as {__mentionValues?:Row}|null)?.__mentionValues;
  const value=values&&typeof values==='object'?values['@'+path]:undefined;
  return value===undefined||value===null?'':value;
 }
 connected(name:unknown){return isConnected(identity()?.connections as never,name);}
 verifyPin():never{throw new FormulaNotHere('VERIFYPIN is checked on the server');}
 agg(_kind:string,object:string):never{throw new FormulaNotHere('Totals of '+object+' come from the page code');}
}

const cache=new Map<string,FormulaFunction|FormulaCodeError>();
/** Excel convention: "=" makes a formula; a bare @Object.Field or a formula-shaped text too. */
export function looksLikeFormula(text:unknown):text is string{
 if(typeof text!=='string')return false;
 const entered=text.trim();
 if(!entered)return false;
 if(entered.startsWith('='))return entered.length>1;
 // Asset URLs, e-mail addresses and plain dates are values.
 if(/^(?:https?:\/\/|asset:|data:image\/)/i.test(entered))return false;
 if(/^[^\s@=(),"&]+@[^\s@]+\.[^\s@]+$/.test(entered))return false;
 if(/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?$/.test(entered))return false;
 // COLLECTION(...) without "=" stays text in display properties (Excel rule).
 if(/^COLLECTION\s*\(/i.test(entered))return false;
 return /^(?:TRUE|FALSE|NULL)$/i.test(entered)||/@[A-Za-z]/.test(entered)
  ||Boolean(formulaEntry(/^([A-Z][A-Z0-9_]*)\s*\(/.exec(entered)?.[1]??''))
  ||/^(?:["(]|-?(?:\d+(?:\.\d*)?|\.\d+)\s*[+\-*/&<>=])/.test(entered);
}
/** Formula text -> its converted function (cached per text). Throws the converter's error. */
export function formulaFunction(text:string,rowObject=''):FormulaFunction{
 const key=rowObject+'\u0000'+text;
 let found=cache.get(key);
 if(!found){
  try{
   const body=text.trim().startsWith('=')?text.trim():'='+text.trim();
   // eslint-disable-next-line @typescript-eslint/no-implied-eval
   found=new Function('F','O','return '+compileDisplayFormula(modernizeFormula(body),rowObject).js)(F,O) as FormulaFunction;
  }catch(error){found=error instanceof FormulaCodeError?error:new FormulaCodeError(error instanceof Error?error.message:String(error));}
  if(cache.size>2000)cache.clear();
  cache.set(key,found);
 }
 if(found instanceof Error)throw found;
 return found;
}
const nodeCache=new WeakMap<Expression,Map<string,FormulaFunction>>();
/** A parsed formula part -> its converted function. */
export function nodeFunction(node:Expression,rowObject=''):FormulaFunction{
 let byRow=nodeCache.get(node);
 if(!byRow){byRow=new Map();nodeCache.set(node,byRow);}
 let found=byRow.get(rowObject);
 if(!found){
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  found=new Function('F','O','return '+compileDisplayNode(node,rowObject).js)(F,O) as FormulaFunction;
  byRow.set(rowObject,found);
 }
 return found;
}
export function formulaScope(context:FormulaContext={}):unknown{return new StandaloneScope(context);}

export type FormulaResult={value:unknown;error?:string};
const outcome=(run:()=>unknown):FormulaResult=>{
 try{return {value:run()};}
 catch(error){
  // A total still loading or over rows not on this page: blank, not an error.
  if(error&&typeof error==='object'&&(error as {notHeld?:unknown}).notHeld===true)return {value:''};
  return {value:'',error:error instanceof Error?error.message:'Formula failed'};
 }
};
/** Run a formula text on a row: plain text comes back as written. */
export function runFormulaText(text:unknown,row:Row|null|undefined,context:FormulaContext={},scope?:unknown):FormulaResult{
 if(typeof text!=='string')return {value:text??''};
 if(!looksLikeFormula(text))return {value:text};
 return outcome(()=>formulaFunction(text,context.rowObject??'')(row??{},scope??new StandaloneScope(context)));
}
/** Run a parsed formula part. */
export function runFormulaNode(node:Expression,row:Row|null|undefined,context:FormulaContext={},scope?:unknown):FormulaResult{
 return outcome(()=>nodeFunction(node,context.rowObject??'')(row??{},scope??new StandaloneScope(context)));
}
/** A component's converters: formula text (or a parsed part) -> `(row) => value` (null for
 * plain text). `context` is read at each run, so the component's current page values are used. */
export function formulaCompilers(context:FormulaContext|(()=>FormulaContext)){
 const now=()=>typeof context==='function'?context():context;
 return {
  compile(text:unknown):((row:Row)=>unknown)|null{
   if(!looksLikeFormula(text))return null;
   const run=formulaFunction(text,now().rowObject??'');
   return (row:Row)=>run(row??{},new StandaloneScope(now()));
  },
  compileNode(node:Expression):(row:Row)=>unknown{
   const run=nodeFunction(node,now().rowObject??'');
   return (row:Row)=>run(row??{},new StandaloneScope(now()));
  }
 };
}
/** Row Object name used for formulas over plain rows written with bare @Field. */
export const ROW_FIELDS='__Row';
/** `@Quantity + 1` over a plain row -> `@__Row.Quantity + 1` (quoted text is kept as written).
 * Run it with rowObject ROW_FIELDS: each bare @Field reads that row's own field. */
export function bareFieldsOnRow(text:string):string{
 const events=new Set(['recordId','value','index','label']);
 const rewrite=(code:string)=>code.replace(/@([A-Za-z][A-Za-z0-9_]*)(?![A-Za-z0-9_.])/g,
  (whole,name:string)=>events.has(name)||/^This(?:Page|Tenant)$/.test(name)?whole:'@'+ROW_FIELDS+'.'+name);
 let out='',current='';
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(char!=='"'&&char!=="'"){current+=char;continue;}
  out+=rewrite(current);current='';
  let literal=char;
  for(i++;i<text.length;i++){
   literal+=text[i];
   if(text[i]===char){if(text[i+1]===char){literal+=text[++i];continue;}break;}
  }
  out+=literal;
 }
 return out+rewrite(current);
}

// Independently bundled components (Smart renderers) reach the same converter through the page global.
(globalThis as Record<symbol,unknown>)[Symbol.for('une.formulaCompilers')]=formulaCompilers;
