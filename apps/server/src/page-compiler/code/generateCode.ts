/**
 * Page converter, formula part: formula text -> plain JavaScript source.
 *
 *  Display formula  "=LEFT(@Product.Name, 3)"
 *    -> (row, $) => F.LEFT($.f(row, "Name"), 3)
 *  Action formula   "=ACTIONS(GETRECORD(Cart, SessionKey, @ThisPage.Session.Id, AS(c)), UPDATERECORD(Cart, c.Id, Total, 0))"
 *    -> async ($) => { const v = {}; v.c = await $.getRecord("Cart", [["SessionKey", $.sessionId]]);
 *                      await $.update("Cart", $.f(v.c, "Id"), [["Total", 0]]); }
 *
 * The same action function is the button function (run in the browser against
 * the rows on screen, to show the change at once) and the server function (run
 * against SQL in one transaction). Only the `$` it is given differs.
 *
 * Every function comes from the formula dictionary. Strings and names are
 * emitted with JSON.stringify and checked against strict patterns, so no
 * authored text ever becomes code.
 */
import {Parser,type Expression} from '../../expression-engine/FormulaParser.js';
import {tokenize,PAGE_FORMULA_LIMITS} from '../../expression-engine/FormulaTokenizer.js';
import {screenArguments} from '../../expression-engine/screenLayer.js';
import {isExcelWildcardDataReference} from '../../expression-engine/FormulaWildcard.js';
import {parsePageReference,isBrowserOnlyReference,isFlowMarker,USER_FIELDS,assignedComponent,assignedProperty,type PageReference} from '../../expression-engine/PageReferences.js';
import {uiProperty} from '../../expression-engine/FormulaComponentState.js';
import {asBoolean,formulaEntry,isBooleanCode,truth} from './formulaDictionary.js';
import {isIdentifier,objectKey} from '../source/pageCodeNames.js';
import {parseActionFormulaAssignment} from '../pageCompilerSupport.js';

const q=(value:unknown)=>JSON.stringify(value);
const name=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const fieldPath=/^[A-Za-z][A-Za-z0-9_]{0,79}(?:\.[A-Za-z][A-Za-z0-9_]{0,79})?$/;
const reserved=new Set(['state','event','session','constructor','prototype','__proto__']);

export class FormulaCodeError extends Error {}
const fail=(message:string):never=>{throw new FormulaCodeError(message);};

/** A criteria pair whose value the page can work out by itself (session, page values, literals). */
export type RecordSetCriterion={field:string;js:string};
/** Rows the page loads once so taps and totals need no server trip: every row
 * of `object` matching these page-known criteria, and (with `parent`) whose
 * `parent.field` is the Id of a row in the parent set (Cart lines of the open cart). */
export type RecordSetNeed={key:string;object:string;criteria:RecordSetCriterion[];parent?:{key:string;field:string}};

type Scope={
 /** Object of the row a display formula is drawn for (@Product.Name in a Card Grid). */
 rowObject:string;
 /** Code for the current row: "row" in display formulas, "$.row" (clicked row) in actions. */
 row:string;
 /** AS(x) names visible here. */
 aliases:ReadonlySet<string>;
 async:boolean;
 functions:Set<string>;references:Set<string>;
 sets:RecordSetNeed[];
 reads:Set<string>;
 /** AS(x) name -> the record set its GETRECORD row comes from. */
 aliasSets?:Map<string,string>;
 /** A set-based FOREACH binds its item to the callback parameter instead of v[item]. */
 aliasCode?:Map<string,string>;
 /** AS(x) name -> the Object its row is (GETRECORD, FOREACH, CREATERECORD), for field types. */
 aliasObjects?:Map<string,string>;
};

/* ---------------- field types: plain JavaScript where the type is known ---------------- */
/** What a value is: a number field, text, true/false, a date, or not known (page values). */
export type ValueKind='number'|'text'|'boolean'|'date'|'datetime'|'any';
/** How a value is used: as a value (blank -> ""), in maths (blank -> 0), or as it is (blank checks). */
type Want='value'|'number'|'raw';
type FieldTypes=(object:string,field:string)=>ValueKind;
let FIELD_TYPES:FieldTypes|null=null;
const DATA_KIND:Record<string,ValueKind>={number:'number',currency:'number',percent:'number',integer:'number',decimal:'number',
 double:'number',boolean:'boolean',checkbox:'boolean',date:'date',datetime:'datetime',string:'text',text:'text',textarea:'text',
 longtext:'text',richtext:'text',email:'text',phone:'text',url:'text',picklist:'text',reference:'text',lookup:'text',
 masterdetail:'text',id:'text',encryptedtext:'text',autonumber:'text',longtextarea:'text',richtextarea:'text',
 textarea2:'text',picklistmultiselect:'text',multipicklist:'text',multiselectpicklist:'text',rollupsummary:'number',rollup:'number',
 time:'text'};
const SYSTEM_KIND:Record<string,ValueKind>={Id:'text',Name:'text',OwnerId:'text',RecordTypeId:'text',CreatedAt:'datetime',
 LastModifiedDate:'datetime',CreatedDate:'datetime'};
/** Run `make` with the page's Object fields known (their types decide plain JavaScript). */
export function withFieldTypes<T>(objects:ReadonlyArray<{apiName:string;fields?:ReadonlyArray<{apiName:string;dataType?:string}>}>|null|undefined,
 make:()=>T):T{
 const byObject=new Map<string,Map<string,ValueKind>>();
 for(const object of objects??[]){
  const fields=new Map<string,ValueKind>();
  // "Date/Time", "Long Text Area", "datetime", "reference": the type name without spaces or signs.
  for(const field of object.fields??[])fields.set(field.apiName,DATA_KIND[String(field.dataType??'').toLowerCase().replace(/[^a-z]/g,'')]??'any');
  byObject.set(object.apiName,fields);byObject.set(object.apiName.toLowerCase(),fields);
 }
 const before=FIELD_TYPES;
 FIELD_TYPES=(object,field)=>byObject.get(object)?.get(field)??byObject.get(object.toLowerCase())?.get(field)
  ??SYSTEM_KIND[field]??'any';
 try{return make();}finally{FIELD_TYPES=before;}
}
const fieldKind=(object:string,field:string):ValueKind=>
 object&&FIELD_TYPES?FIELD_TYPES(object,field):SYSTEM_KIND[field]??'any';
const IDENT=/^[A-Za-z_$][A-Za-z0-9_$]*$/;
const access=(base:string,field:string)=>base+(IDENT.test(field)?'?.'+field:'?.['+q(field)+']');
/** A field of a row or a named record (sc.Total, row.Name): its code as it is and its type. */
function fieldOf(path:string,scope:Scope):{code:string;kind:ValueKind}|null{
 const event=eventRecordField(path,scope);
 if(event)return event;
 const parts=path.split('.');
 if(parts.length!==2||parts.some(part=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)))return null;
 const [root,field]=parts;
 if(scope.aliases.has(root)){
  const bound=scope.aliasCode?.get(root);
  return {code:access(bound??'v['+q(root)+']',field),kind:fieldKind(scope.aliasObjects?.get(root)??'',field)};
 }
 if(root===scope.rowObject&&root!=='ThisPage'&&root!=='ThisTenant')
  return {code:access(scope.row,field),kind:fieldKind(scope.rowObject,field)};
 if(root==='record'&&!scope.aliases.has('record'))return {code:access('$.event("record")',field),kind:'any'};
 return null;
}
/** @event.record.Active: a field of the tapped record. */
function eventRecordField(path:string,scope:Scope):{code:string;kind:ValueKind}|null{
 const parts=path.split('.');
 if(parts.length!==3||parts[0]!=='event'||parts[1]!=='record'||scope.aliases.has('event')||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[2]))return null;
 return {code:access('$.event("record")',parts[2]),kind:'any'};
}
/** A value as it is used: blank -> "" as a value, -> 0 in maths. */
function wanted(code:string,kind:ValueKind,want:Want,blankable:boolean):string{
 if(want==='raw')return code;
 if(want==='number'){
  if(kind==='number')return blankable?'('+code+' ?? 0)':code;
  return 'Number('+code+' || 0)';
 }
 return blankable?'('+code+' ?? "")':code;
}
const NUMBER_FUNCTIONS=new Set(['ROUND','ROUNDUP','ROUNDDOWN','ABS','MAX','MIN','VALUE','LEN','INT','MOD','CEILING','FLOOR',
 'SUM','HOUR','MINUTE','SECOND','DAY','MONTH','YEAR','WEEKDAY','FIND','SQRT','POWER','EXP','LN','LOG','LOG10','TRUNC']);
const DATE_FUNCTIONS=new Set(['TODAY','DATE','DATEVALUE']);
const DATETIME_FUNCTIONS=new Set(['NOW','DATETIMEVALUE']);
const isDate=(kind:ValueKind)=>kind==='date'||kind==='datetime';
const BOOLEAN_FUNCTIONS=/^(IS[A-Z]+|CONTAINS|BEGINS|ENDS|STARTSWITH|ENDSWITH|INCLUDES)$/;
/** What an expression gives, when the converter can know it. */
function kindOf(node:Expression,scope:Scope):ValueKind{
 switch(node.kind){
  case 'literal':return typeof node.value==='number'?'number':typeof node.value==='boolean'?'boolean'
   :typeof node.value==='string'?(/^\d{4}-\d{2}-\d{2}/.test(node.value)?'any':'text'):'any';
  case 'reference':{
   const field=fieldOf(node.value,scope);
   if(field)return field.kind;
   return node.value==='ThisPage.Session.Id'?'text':'any';
  }
  case 'unary':return node.operator==='NOT'?'boolean':'number';
  case 'binary':{
   if(node.operator==='&')return 'text';
   if(COMPARISONS.has(node.operator)||node.operator==='AND'||node.operator==='OR')return 'boolean';
   const l=kindOf(node.left,scope),r=kindOf(node.right,scope);
   return isDate(l)&&!isDate(r)&&(node.operator==='+'||node.operator==='-')?l:'number';
  }
  case 'call':{
   const entry=formulaEntry(node.name);
   if(entry?.kind==='aggregate')return 'number';
   if(TEXT_FUNCTIONS.has(node.name))return 'text';
   if(NUMBER_FUNCTIONS.has(node.name))return 'number';
   if(DATE_FUNCTIONS.has(node.name))return 'date';
   if(DATETIME_FUNCTIONS.has(node.name))return 'datetime';
   // ADDDAYS / ADDMONTHS keep the kind of the date they move.
   if((node.name==='ADDDAYS'||node.name==='ADDMONTHS')&&node.args[0]){const k=kindOf(node.args[0],scope);return isDate(k)?k:'any';}
   if(BOOLEAN_FUNCTIONS.test(node.name)||['AND','OR','NOT'].includes(node.name))return 'boolean';
   if(node.name==='IF'){
    const a=node.args[1]?kindOf(node.args[1],scope):'any',b=node.args[2]?kindOf(node.args[2],scope):a;
    return a===b?a:'any';
   }
   if(node.name==='BLANKVALUE'||node.name==='NULLVALUE'){
    const a=node.args[0]?kindOf(node.args[0],scope):'any';
    return a==='any'&&node.args[1]?kindOf(node.args[1],scope):a;
   }
   return 'any';
  }
 }
}
/** A test (IF, AND, OR, NOT) as plain JavaScript: true/false values as they are; a Checkbox
 * field is `x === true`; anything else is true for true, 1 or "true" (formula truth). */
function condition(node:Expression,scope:Scope):string{
 if(node.kind==='reference'){
  const field=fieldOf(node.value,scope);
  if(field&&field.kind==='boolean'){scope.references.add(node.value);return asBoolean('('+field.code+' === true)');}
 }else if(kindOf(node,scope)==='boolean'){
  const code=expression(node,scope);
  return isBooleanCode(code)||node.kind==='literal'?code:asBoolean('('+code+' === true)');
 }
 return asBoolean('[true, 1, "true"].includes('+expression(node,scope)+')');
}


export function parseFormula(source:string):Expression{
 const body=source.trim();
 if(!body)return {kind:'literal',value:''};
 try{return new Parser(tokenize(body,PAGE_FORMULA_LIMITS),PAGE_FORMULA_LIMITS.tokens).parse();}
 catch(error){return fail(error instanceof Error?error.message:'Invalid formula');}
}
function literalName(node:Expression|undefined,label:string,pattern=name):string{
 const value=node?.kind==='reference'||node?.kind==='literal'?node.value:null;
 if(typeof value!=='string'||!pattern.test(value))fail('Invalid '+label);
 return value as string;
}

/** True when a value needs nothing but the page itself (no row, no record lookups). */
function pageKnown(node:Expression,scope:Scope):boolean{
 if(node.kind==='literal')return true;
 if(node.kind==='reference'){
  const page=pageReference(node.value);
  return Boolean(page)&&page!.kind!=='selected'&&!isBrowserOnlyReference(page);
 }
 if(node.kind==='unary')return pageKnown(node.value,scope);
 if(node.kind==='binary')return pageKnown(node.left,scope)&&pageKnown(node.right,scope);
 const entry=formulaEntry(node.name);
 return Boolean(entry&&(entry.kind==='pure'||entry.kind==='inline'))&&node.args.every(arg=>pageKnown(arg,scope));
}
function pageReference(path:string):PageReference|null{
 try{return parsePageReference(path);}
 catch(error){return fail(error instanceof Error?error.message:'Invalid page value');}
}
/** @ThisPage… / @ThisTenant… -> the page code call that reads it. */
function pageValueCode(page:PageReference):string{
 const key=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
 switch(page.kind){
  case 'session':return '$.sessionId';
  case 'cart':return '$.session("cartId")';
  case 'till':return '$.till('+q(page.field)+')';
  case 'device':return '$.device('+q(page.field)+')';
  case 'user':return '$.session('+q('user.'+USER_FIELDS[page.field])+')';
  case 'userField':
   if(!key.test(page.field))fail('Invalid user value @ThisTenant.User.'+page.field);
   return '$.session('+q('user.field.'+page.field)+')';
  case 'company':
   if(!key.test(page.field))fail('Invalid company value @ThisTenant.Company.'+page.field);
   return page.field==='Id'?'$.session("tenant.id")':'$.tenant('+q(page.field.toLowerCase())+')';
  case 'permission':
   if(!/^[A-Za-z_][A-Za-z0-9_.]{0,79}$/.test(page.name))fail('Invalid permission @ThisTenant.Permission.'+page.name);
   return '$.permission('+q(page.name)+')';
  case 'selected':return '$.componentState('+q(page.name)+', '+q(page.field)+')';
  case 'input':
   if(!key.test(page.key))fail('Invalid page value @ThisPage.Input.'+page.key);
   return '$.state('+q(page.key)+')';
  case 'component':
   // value / recordId / text: the component's live value (browser only).
   if(isBrowserOnlyReference(page))return '$.component('+q(page.name)+', '+q(page.key)+')';
   if(!key.test(page.key))fail('Invalid page value @ThisPage.'+page.name+'.'+page.key);
   // @ThisPage.Button1.Disabled / .Caption / .Visible: what the component shows now.
   if(uiProperty(page.key))return '$.property('+q(page.name)+', '+q(uiProperty(page.key)!)+')';
   // A value the component's action saved (or one of its own properties).
   return '$.pageValue('+q(page.name)+', '+q(page.key)+')';
 }
}
/** Lookup steps a row value may follow; matches the page's row lookup loader. */
const MAX_LOOKUP_HOPS=3;
function reference(path:string,scope:Scope):string{
 scope.references.add(path);
 if(/(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(path))fail('Invalid reference');
 const page=pageReference(path);
 if(page)return pageValueCode(page);
 if(isFlowMarker(path))return q(path);
 if(path.startsWith('$'))fail('Old $ references are no longer used. Type @ and pick from ThisPage, ThisTenant or an Object.');
 // Event values of the action being run: the clicked row/card, the typed text.
 if(['recordId','value','index','label'].includes(path))return '$.event('+q(path)+')';
 const parts=path.split('.');
 if(parts.some(part=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)))fail('Invalid reference @'+path);
 if(parts[0]==='record'&&parts.length===2)return '$.f($.event("record"), '+q(parts[1])+')';
 // @event.value, @event.recordId, @event.record.Name: the event of the action being run.
 if(parts[0]==='event'&&!scope.aliases.has('event')){
  if(parts.length===2)return '$.event('+q(parts[1])+')';
  if(parts.length===3&&parts[1]==='record')return '$.f($.event("record"), '+q(parts[2])+')';
  fail('Invalid event reference @'+path);
 }
 if(scope.aliases.has(parts[0])){
  // Inside a set-based FOREACH the loop item is the callback parameter (item), not v[item].
  const bound=scope.aliasCode?.get(parts[0]);
  if(bound!==undefined)return parts.length===1?bound:'$.f('+bound+', '+q(parts.slice(1).join('.'))+')';
  if(parts.length===1)return 'v['+q(parts[0])+']';
  return '$.f(v['+q(parts[0])+'], '+q(parts.slice(1).join('.'))+')';
 }
 if(parts.length===1)fail('Bare @'+path+' is not supported; use @Object.Field');
 if(parts[0]===scope.rowObject&&parts.length===2)return '$.f('+scope.row+', '+q(parts[1])+')';
 // A lookup value of this row, up to MAX_LOOKUP_HOPS steps (@OrderLine.Product.Category.Name):
 // the same depth the page reads for each row (smartFieldMentions MAX_HOPS).
 if(parts[0]===scope.rowObject&&parts.length>=3&&parts.length<=MAX_LOOKUP_HOPS+2)return '$.m('+scope.row+', '+q(path)+')';
 // Another Object's field (@Product.ImageUrl in a cart line): the related value the
 // page already read for this row (permission-checked lookup), blank if none.
 if(parts.length>=2&&parts.length<=(scope.rowObject?MAX_LOOKUP_HOPS+1:3))return '$.m('+scope.row+', '+q(scope.rowObject?scope.rowObject+'.'+path:path)+')';
 return fail('Invalid reference @'+path);
}
function aggregateCall(node:Extract<Expression,{kind:'call'}>,scope:Scope):string{
 const args=node.args;
 const object=literalName(args[0],node.name+' Object');
 const hasValue=node.name!=='COUNTIFS';
 const valueField=hasValue?literalName(args[1],node.name+' value field',fieldPath):'';
 const pairs=args.slice(hasValue?2:1);
 if(pairs.length%2)fail(node.name+' needs Field, value pairs');
 const criteria=criteriaCode(pairs,scope,node.name);
 scope.reads.add(object);
 noteSet(object,pairs,scope);
 const method=({COUNTIFS:'count',SUMIFS:'sum',AVERAGEIFS:'average',MINIFS:'min',MAXIFS:'max'} as Record<string,string>)[node.name];
 const call=method?'$.'+method+'('+q(object)+', '+(hasValue?q(valueField)+', ':'')+criteria+')'
  :'$.agg('+q(node.name)+', '+q(object)+', '+q(valueField)+', '+criteria+')';
 return scope.async?'(await '+call+')':call;
}
function criteriaCode(pairs:readonly Expression[],scope:Scope,label:string):string{
 const out:string[]=[];
 const seen=new Set<string>();
 for(let i=0;i<pairs.length;i+=2){
  const field=literalName(pairs[i],label+' field',fieldPath);
  if(seen.has(field))fail('Duplicate field '+field);
  seen.add(field);
  out.push(objectKey(field)+': '+expression(pairs[i+1],scope));
 }
 return '{'+out.join(', ')+'}';
}
/** Parent key of a set held for the rows of an Object the page shows (`@shown:Product`). */
export const SHOWN_ROWS='@shown:';
/** Remember which rows the page should hold for this lookup; returns the set key. */
function noteSet(object:string,pairs:readonly Expression[],scope:Scope):string|null{
 const criteria:RecordSetCriterion[]=[];
 let parent:RecordSetNeed['parent'];
 for(let i=0;i<pairs.length;i+=2){
  const field=literalName(pairs[i],'field',fieldPath),value=pairs[i+1];
  const alias=value.kind==='reference'&&/^[A-Za-z][A-Za-z0-9_]*\.Id$/.test(value.value)?value.value.slice(0,-3):'';
  const aliasSet=alias?scope.aliasSets?.get(alias):undefined;
  if(aliasSet){
   // GETRECORD(Cart, Id, sc.Id): the same rows as sc's own set.
   if(field==='Id'&&scope.sets.find(set=>set.key===aliasSet)?.object===object)return aliasSet;
   if(!parent&&field!=='Id')parent={key:aliasSet,field};
   continue;
  }
  // The tapped row's Id (COUNTIFS(ProductOptionGroup, Product, @recordId)): hold the rows
  // for every row of that Object the page shows, so the tap needs no server trip.
  if(!parent&&field!=='Id'&&scope.row==='$.row'&&scope.rowObject&&value.kind==='reference'
   &&['recordId','event.recordId',scope.rowObject+'.Id'].includes(value.value)){
   parent={key:SHOWN_ROWS+scope.rowObject,field};
   continue;
  }
  if(!pageKnown(value,scope))continue;
  const sub:Scope={...scope,row:'null',aliases:new Set(),async:false,functions:new Set(),references:new Set(),sets:[],reads:new Set()};
  criteria.push({field,js:expression(value,sub)});
 }
 // Literal-only criteria (Status = "Open") would load every tenant row: never held.
 if(!parent&&!criteria.some(item=>item.js.includes('$.')))return null;
 criteria.sort((a,b)=>a.field.localeCompare(b.field));
 const key=object+'|'+criteria.map(c=>c.field+'='+c.js).join('&')+(parent?'|'+parent.field+'<'+parent.key:'');
 if(!scope.sets.some(set=>set.key===key))scope.sets.push({key,object,criteria,...(parent?{parent}:{})});
 return key;
}

/* ---------------- set-based FOREACH ---------------- */
/** A page value (@ThisPage…, @ThisTenant…); a component's live value is browser only. */
function isPageValue(path:string):boolean{
 try{const page=pageReference(path);return Boolean(page)&&page!.kind!=='selected';}
 catch{return false;}
}
/** Values a batched loop may use: the loop item, constants, page values and variables
 * assigned before the loop. Anything else keeps today's loop. */
function itemValueOnly(node:Expression,alias:string,scope:ActionScope):boolean{
 if(node.kind==='literal')return true;
 if(node.kind==='reference'){
  const root=node.value.split('.')[0];
  if(root===alias)return true;
  if(root!==alias&&scope.aliases.has(root))return true;
  return isPageValue(node.value);
 }
 if(node.kind==='unary')return itemValueOnly(node.value,alias,scope);
 if(node.kind==='binary')return itemValueOnly(node.left,alias,scope)&&itemValueOnly(node.right,alias,scope);
 if(node.kind==='call'){
  const entry=formulaEntry(node.name);
  if(!entry||entry.kind==='aggregate'||entry.kind==='action')return false;
  return node.args.every(arg=>itemValueOnly(arg,alias,scope));
 }
 return false;
}
/** The loop body's steps in order (ACTIONS folded in), or null when a step is not a save. */
function loopSaveSteps(node:Expression,into:Expression[]=[]):Expression[]|null{
 if(node.kind==='literal'&&(node.value===''||node.value===null))return into;
 if(node.kind==='call'&&node.name==='ACTIONS'){
  for(const arg of node.args)if(!loopSaveSteps(arg,into))return null;
  return into;
 }
 if(node.kind!=='call'||!['CREATERECORD','UPDATERECORD','DELETERECORD'].includes(node.name))return null;
 into.push(node);
 return into;
}
/**
 * FOREACH(Object, …) whose whole body saves rows -> the rows are read ONCE, then ONE call
 * per step, in order (every step works on the same rows, as the loop did):
 *   CREATERECORD -> $.createFrom(Target, rows, [[field, (item)=>value], …])
 *   UPDATERECORD -> $.updateWhere(Object, rows, …)  when the id is the item's Id
 *   DELETERECORD -> $.removeWhere(Object, rows)     when the id is the item's Id
 * Anything else (GETRECORD, IF on item values, CALLOUT, EMAIL, PRINT, SCREEN, AS used
 * later) returns null, so the loop is generated exactly as before.
 */
function setBasedSteps(body:Expression,object:string,criteria:string,alias:string,
 scope:ActionScope):string[]|null{
 const steps=loopSaveSteps(body);
 if(!steps||!steps.length)return null;
 const bound=new Map(scope.aliasCode??[]);
 bound.set(alias,'item');
 const valueScope:ActionScope={...scope,aliasCode:bound};
 const lines:string[]=[];
 for(const step of steps){
  const args=[...(step as Extract<Expression,{kind:'call'}>).args];
  const name=(step as Extract<Expression,{kind:'call'}>).name;
  const target=literalName(args.shift(),name+' Object');
  if(name!=='CREATERECORD'){
   // item.Id is a row of the loop Object: only that Object can be updated/deleted by it.
   if(target!==object)return null;
   const id=args.shift();
   if(id?.kind!=='reference'||id.value!==alias+'.Id')return null;
  }
  const last=args.at(-1);
  if(last?.kind==='call'&&last.name==='AS')return null;
  if(args.length%2)return null;
  const fields:string[]=[];
  for(let i=0;i<args.length;i+=2){
   const field=literalName(args[i],'field API name');
   if(!itemValueOnly(args[i+1],alias,scope))return null;
   // async: a value may await (BLANKVALUE, a lookup), exactly as in the loop it replaces.
   const code=expression(args[i+1],valueScope);
   fields.push(objectKey(field)+': '+(code.includes('await ')?'async (item) => ':'(item) => ')+code);
  }
  if(name!=='DELETERECORD'&&!fields.length)return null;
  scope.data=true;scope.writes.add(target);
  lines.push(name==='CREATERECORD'
   ?'  await $.createFrom('+q(target)+', rows, {'+fields.join(', ')+'});'
   :name==='UPDATERECORD'
    ?'  await $.updateWhere('+q(target)+', rows, {'+fields.join(', ')+'});'
    :'  await $.removeWhere('+q(target)+', rows);');
 }
 // Read once: a step that changes the loop's own rows (Status "Sold") never hides them
 // from the next step.
 return ['{','  const rows = await $.list('+q(object)+', '+criteria+');',...lines,'}'];
}

const COMPARISONS=new Set(['=','==','<>','!=','<','<=','>','>=']);
/** A literal that = / <> compare exactly like JavaScript === (no date, no wildcard). */
function plainValue(node:Expression):boolean{
 if(node.kind!=='literal')return false;
 const value=node.value;
 if(typeof value==='number'||typeof value==='boolean')return true;
 return typeof value==='string'&&!/^\d{4}-\d{2}-\d{2}/.test(value)&&!/[*?~]/.test(value);
}
/** Functions that always give text. */
const TEXT_FUNCTIONS=new Set(['TEXT','LEFT','RIGHT','MID','UPPER','LOWER','PROPER','TRIM','FORMAT','SUBSTITUTE','CONCATENATE']);
/** A part of a text join (&): text as it is, anything else through O.s() (blank -> ""). */
function asText(node:Expression,code:string):string{
 if(node.kind==='literal'&&typeof node.value==='string')return code;
 if(node.kind==='binary'&&node.operator==='&')return code;
 if(node.kind==='call'&&TEXT_FUNCTIONS.has(node.name)&&code.startsWith('F.'+node.name+'('))return code;
 return 'O.s('+code+')';
}

export function expression(node:Expression,scope:Scope,want:Want='value'):string{
 switch(node.kind){
  case 'literal':
   if(want==='number'&&typeof node.value!=='number')
    return typeof node.value==='string'&&node.value.trim()&&Number.isFinite(Number(node.value))?String(Number(node.value))
     :node.value===null||node.value===''?'0':'Number('+q(node.value)+')';
   return node.value===null?'null':q(node.value);
  case 'reference':{
   const field=fieldOf(node.value,scope);
   if(field){scope.references.add(node.value);return wanted(field.code,field.kind,want,true);}
   const code=reference(node.value,scope);
   return want==='number'?'Number('+code+' || 0)':code;
  }
  case 'unary':
   if(node.operator==='NOT')return asBoolean('(!'+condition(node.value,scope)+')');
   if(node.operator==='-')return '(-'+expression(node.value,scope,'number')+')';
   if(node.operator==='+')return expression(node.value,scope,'number');
   return 'O.u('+q(node.operator)+', '+expression(node.value,scope)+')';
  case 'binary':{
   if(node.operator==='AND')return asBoolean('('+condition(node.left,scope)+' && '+condition(node.right,scope)+')');
   if(node.operator==='OR')return asBoolean('('+condition(node.left,scope)+' || '+condition(node.right,scope)+')');
   if(node.operator==='&'){
    const left=expression(node.left,scope),right=expression(node.right,scope);
    const textual=(n:Expression,code:string)=>asText(n,code)===code||kindOf(n,scope)==='text';
    return '('+(textual(node.left,left)||textual(node.right,right)?left:'String('+left+')')+' + '+right+')';
   }
   const kl=kindOf(node.left,scope),kr=kindOf(node.right,scope);
   // "*cola*" matching applies only to = / <> on a record field.
   const wildcard=['=','==','<>','!='].includes(node.operator)&&node.left.kind==='reference'
    &&isExcelWildcardDataReference(node.left.value)&&node.right.kind==='literal'&&typeof node.right.value==='string'
    &&/[*?~]/.test(node.right.value);
   const helper=()=>{
    const code='O.b('+q(node.operator)+', '+expression(node.left,scope)+', '+expression(node.right,scope)
     +(wildcard?', true, $.timeZone()':', false, $.timeZone()')+')';
    return COMPARISONS.has(node.operator)?asBoolean(code):code;
   };
   // "*cola*" matches keep the formula's own rule.
   if(wildcard)return helper();
   if(isDate(kl)||isDate(kr)){
    // A date moved by days: ADDDAYS. Dates compare as their text (2026-11-26); a date-time
    // against a day, by its day.
    if((node.operator==='+'||node.operator==='-')&&isDate(kl)&&!isDate(kr)){
     const days=expression(node.right,scope,'number');
     return 'F.ADDDAYS($, '+expression(node.left,scope)+', '+(node.operator==='-'?'-'+days:days)+')';
    }
    if(COMPARISONS.has(node.operator)){
     const day=(n:Expression,k:ValueKind,other:ValueKind)=>{
      const code=expression(n,scope);
      return k==='datetime'&&other==='date'?'String('+code+').slice(0, 10)':code;
     };
     const op=node.operator==='='||node.operator==='=='?'===':node.operator==='<>'||node.operator==='!='?'!==':node.operator;
     return asBoolean('('+day(node.left,kl,kr)+' '+op+' '+day(node.right,kr,kl)+')');
    }
    return helper();
   }
   if(node.operator==='='||node.operator==='<>'||node.operator==='=='||node.operator==='!='){
    const op=node.operator==='='||node.operator==='=='?' === ':' !== ';
    const filled=(n:Expression)=>plainValue(n)&&!(n.kind==='literal'&&n.value==='');
    // Against a plain value (a number, true/false, text that is not a date, no * ? ~): as it is.
    if(filled(node.right))return asBoolean('('+expression(node.left,scope,'raw')+op+expression(node.right,scope)+')');
    if(filled(node.left))return asBoolean('('+expression(node.left,scope)+op+expression(node.right,scope,'raw')+')');
    const w:Want=kl==='number'&&kr==='number'?'number':'value';
    return asBoolean('('+expression(node.left,scope,w)+op+expression(node.right,scope,w)+')');
   }
   if(COMPARISONS.has(node.operator)){
    // Numbers compare as numbers (a blank number counts as 0, as in a spreadsheet); text as text.
    const w:Want=kl==='number'||kr==='number'?'number':'value';
    return asBoolean('('+expression(node.left,scope,w)+' '+node.operator+' '+expression(node.right,scope,w)+')');
   }
   const ops:Record<string,string>={'+':'+','-':'-','*':'*','/':'/','%':'%','^':'**'};
   if(ops[node.operator])
    return '('+expression(node.left,scope,'number')+' '+ops[node.operator]+' '+expression(node.right,scope,'number')+')';
   return helper();
  }
  case 'call':{
   const entry=formulaEntry(node.name);
   if(!entry)return fail(node.name+' is not in the formula dictionary');
   const plain=plainCall(node,scope,want);
   if(plain!==null){scope.functions.add(node.name);return plain;}
   if(node.args.length<entry.min||node.args.length>entry.max)
    fail('Invalid argument count for '+node.name+' (expected '+entry.min+'-'+entry.max+')');
   scope.functions.add(node.name);
   if(entry.kind==='aggregate')return aggregateCall(node,scope);
   if(entry.kind==='action')return fail(node.name+' is an action; use it in an action formula');
   if(entry.serverOnly&&!scope.async)fail(node.name+' runs on the server; use it in an action formula');
   const args=node.args.map(arg=>expression(arg,scope));
   const code=entry.kind==='inline'||entry.kind==='page'?entry.js!(args,{async:scope.async})
    :'F.'+node.name+'('+(entry.clock?['$',...args]:args).join(', ')+')';
   return want==='number'&&kindOf(node,scope)!=='number'?'Number('+code+' || 0)':code;
  }
 }
}
/** IF / AND / OR / NOT / ISBLANK / BLANKVALUE as plain JavaScript (null when not one of them). */
function plainCall(node:Extract<Expression,{kind:'call'}>,scope:Scope,want:Want):string|null{
 const args=node.args;
 switch(node.name){
  case 'IF':
   if(args.length<2||args.length>3)return null;
   return '('+condition(args[0],scope)+' ? '+expression(args[1],scope,want)+' : '
    +(args[2]?expression(args[2],scope,want):want==='number'?'0':'false')+')';
  case 'AND':case 'OR':
   if(!args.length)return null;
   return asBoolean('('+args.map(arg=>condition(arg,scope)).join(node.name==='AND'?' && ':' || ')+')');
  case 'NOT':return args.length===1?asBoolean('(!'+condition(args[0],scope)+')'):null;
  case 'MAX':case 'MIN':
   // Numbers only: Math.max / Math.min (blank numbers count as 0).
   if(!args.length||args.some(arg=>kindOf(arg,scope)!=='number'))return null;
   return 'Math.'+node.name.toLowerCase()+'('+args.map(arg=>expression(arg,scope,'number')).join(', ')+')';
  case 'ISBLANK':{
   if(args.length!==1||args[0].kind!=='reference')return null;
   const field=fieldOf(args[0].value,scope);
   if(!field){
    // A page value (@ThisPage.Till.Name): blank is "" or nothing.
    const code=expression(args[0],scope);
    return /^\$\.[A-Za-z]+\([^()]*\)$|^\$\.sessionId$/.test(code)?asBoolean('('+code+' == null || '+code+' === "")'):null;
   }
   scope.references.add(args[0].value);
   return asBoolean(field.kind==='text'?'(!'+field.code+')':'('+field.code+' == null || '+field.code+' === "")');
  }
  case 'BLANKVALUE':case 'NULLVALUE':{
   if(args.length!==2)return null;
   const field=args[0].kind==='reference'?fieldOf(args[0].value,scope):null;
   if(!field){
    const value=expression(args[0],scope);
    const fallback=expression(args[1],scope,want==='number'?'number':'value');
    const blank=(code:string)=>node.name==='NULLVALUE'?code+' == null':code+' == null || '+code+' === ""';
    // A total or a page value with 0 as the fallback: blank (or 0) gives 0.
    if(node.name==='BLANKVALUE'&&args[1].kind==='literal'&&args[1].value===0)return '('+value+' || 0)';
    // A page value: read it twice (cheap) and test it.
    if(/^\$\.[A-Za-z]+\([^()]*\)$|^\$\.sessionId$/.test(value))return '('+blank(value)+' ? '+fallback+' : '+value+')';
    // Anything else once, through a small function.
    const asyncFallback=fallback.includes('await ');
    return '('+(asyncFallback?'await ':'')+'('+(asyncFallback?'async ':'')+'(given) => ('+blank('given')+' ? '+fallback+' : given))('+value+'))';
   }
   if(args[0].kind==='reference')scope.references.add(args[0].value);
   const fallback=expression(args[1],scope,want==='number'?'number':'value');
   const value=field.kind==='number'||field.kind==='boolean'||node.name==='NULLVALUE'
    ?'('+field.code+' ?? '+fallback+')'
    :field.kind==='text'?'('+field.code+' || '+fallback+')'
     :'('+field.code+' == null || '+field.code+' === "" ? '+fallback+' : '+field.code+')';
   return want==='number'&&field.kind!=='number'?'Number('+value+' || 0)':value;
  }
 }
 return null;
}


export type CompiledFormulaCode={js:string;functions:string[];references:string[];sets:RecordSetNeed[];reads:string[]};
/** A display formula -> `(row, $) => value`. */
export function compileDisplayFormula(source:string,rowObject=''):CompiledFormulaCode{
 return compileDisplayNode(parseFormula(source),rowObject);
}
/** An already parsed display formula (a part of a COLLECTION, a FLOW() choice) -> `(row, $) => value`. */
export function compileDisplayNode(node:Expression,rowObject=''):CompiledFormulaCode{
 const scope:Scope={rowObject,row:'row',aliases:new Set(),async:false,functions:new Set(),references:new Set(),sets:[],reads:new Set()};
 const body=expression(node,scope);
 return {js:'(row, $) => '+body,functions:[...scope.functions],references:[...scope.references],
  sets:scope.sets,reads:[...scope.reads]};
}

/* ======================= Action formulas ======================= */
type ActionScope=Scope&{writes:Set<string>;ui:Set<string>;data:boolean;loop:boolean;aliasesMutable:Set<string>;
 /** CONFIRMSCREEN/INFOSCREEN inside the action: their Yes/No/OK steps run as separate actions. */
 boxes:MessageBox[]};
/** A message box inside an action. Its answer steps run after the tap, as action
 * <action key><suffix>__yes / __no (ACTION_KEY is replaced by the page's action key). */
export type MessageBox={suffix:string;yes:Expression|null;no:Expression|null};
export const ACTION_KEY_MARK='@@ACTION_KEY@@';
/** True when the step (or an IF branch of it) is a message box with answer steps. */
function hasAnsweredBox(node:Expression):boolean{
 if(node.kind!=='call')return false;
 if(node.name==='INFOSCREEN')return Boolean(node.args[1]&&!blankStep(node.args[1]));
 if(node.name==='IF'||node.name==='ACTIONS')return node.args.some(hasAnsweredBox);
 return false;
}
const blankStep=(node:Expression)=>node.kind==='literal'&&(node.value===''||node.value===null);
/** Names a step reads (AS results such as inv in inv.Id). */
function referencedRoots(node:Expression,into=new Set<string>()):Set<string>{
 if(node.kind==='reference')into.add(node.value.split('.')[0]);
 else if(node.kind==='call')node.args.forEach(arg=>referencedRoots(arg,into));
 else if(node.kind==='binary'){referencedRoots(node.left,into);referencedRoots(node.right,into);}
 else if(node.kind==='unary')referencedRoots(node.value,into);
 return into;
}
const indent=(lines:string[],by='  ')=>lines.map(line=>by+line);

function takeAlias(node:Expression|undefined,scope:ActionScope,label:string):string{
 if(node?.kind!=='call'||node.name!=='AS'||node.args.length!==1)fail(label);
 const alias=literalName((node as Extract<Expression,{kind:'call'}>).args[0],'result variable');
 if(reserved.has(alias))fail('Reserved result variable '+alias);
 scope.aliasesMutable.add(alias);
 return alias;
}
function stepCode(node:Expression,scope:ActionScope):string[]{
 if(node.kind==='literal'&&(node.value===''||node.value===null))return [];
 const property=node.kind==='binary'?assignedProperty(node as never):null;
 if(property&&node.kind==='binary')
  return ['$.setProperty('+q(property.name)+', '+q(property.property)+', '+expression(node.right,scope)+');'];
 const assigned=assignedComponent(node,scope.aliases);
 if(assigned&&node.kind==='binary'){
  return ['$.setValue('+q(assigned)+', '+expression(node.right,scope)+');'];
 }
 if(node.kind!=='call')return fail('Expected an action step, found a value');
 const entry=formulaEntry(node.name);
 if(node.name==='IF'){
  if(node.args.length<2||node.args.length>3)fail('IF needs a test, a then-step and an else-step');
  const test=condition(node.args[0],scope);
  const then=stepCode(node.args[1],scope),otherwise=node.args[2]?stepCode(node.args[2],scope):[];
  if(!then.length&&!otherwise.length)return [];
  if(!then.length)return ['if (!'+test+') {',...indent(otherwise),'}'];
  return ['if ('+test+') {',...indent(then),...(otherwise.length?['} else {',...indent(otherwise)]:[]),'}'];
 }
 if(!entry||entry.kind!=='action')return fail(node.name+' is not an action step');
 if(node.args.length<entry.min||node.args.length>entry.max)
  fail('Invalid argument count for '+node.name+' (expected '+entry.min+'-'+entry.max+')');
 scope.functions.add(node.name);
 const args=[...node.args];
 const value=(arg:Expression)=>expression(arg,scope);
 switch(node.name){
  case 'ACTIONS':
   // A box's Yes/No/OK steps run after the tap: steps written after it would run first.
   if(args.slice(0,-1).some(hasAnsweredBox))
    fail('Put the steps that should wait for the answer inside the box (its Yes/No/OK actions), or move the box to the end');
   return args.flatMap(arg=>stepCode(arg,scope));
  // Values belong to components, as in VB: `@ThisPage.CashBox.Value = …` replaces STATE.
  case 'STATE':
   return fail('STATE is no longer used. Give the value to a component instead, e.g. @ThisPage.CashBox.Value = '
    +(args[1]?'…':'"1"')+', and read it with @ThisPage.CashBox.Value');
  case 'GETRECORD':{
   const object=literalName(args.shift(),'GETRECORD Object');
   const alias=takeAlias(args.pop(),scope,'GETRECORD needs AS(variable) at the end');
   if(!args.length||args.length%2)fail('GETRECORD needs Field, value pairs');
   scope.data=true;scope.reads.add(object);
   const set=noteSet(object,args,scope);
   if(set)scope.aliasSets!.set(alias,set);else scope.aliasSets!.delete(alias);
   scope.aliasObjects?.set(alias,object);
   return ['v['+q(alias)+'] = await $.getRecord('+q(object)+', '+criteriaCode(args,scope,'GETRECORD')+');'];
  }
  case 'CREATERECORD':case 'UPDATERECORD':{
   const object=literalName(args.shift(),node.name+' Object');
   const id=node.name==='UPDATERECORD'?value(args.shift()!):'';
   const last=args.at(-1);
   const alias=last?.kind==='call'&&last.name==='AS'?takeAlias(args.pop(),scope,'AS needs one name'):'';
   if(args.length%2||(node.name==='UPDATERECORD'&&!args.length))fail(node.name+' needs Field, value pairs');
   const pairs:string[]=[];
   const seen=new Set<string>();
   for(let i=0;i<args.length;i+=2){
    const field=literalName(args[i],'field API name');
    if(seen.has(field))fail('Duplicate field '+field);
    seen.add(field);
    pairs.push(objectKey(field)+': '+value(args[i+1]));
   }
   if(alias)scope.aliasObjects?.set(alias,object);
   scope.data=true;scope.writes.add(object);
   // Inside FOREACH, a save whose result is not used is queued: the server saves the
   // loop's saves together (one bulk save) before anything reads records again.
   const later=scope.loop&&!alias?'Later':'';
   const call=node.name==='CREATERECORD'
    ?'await $.create'+later+'('+q(object)+', {'+pairs.join(', ')+'})'
    :'await $.update'+later+'('+q(object)+', '+id+', {'+pairs.join(', ')+'})';
   return [(alias?'v['+q(alias)+'] = ':'')+call+';'];
  }
  case 'DELETERECORD':{
   const object=literalName(args[0],'DELETERECORD Object');
   scope.data=true;scope.writes.add(object);
   return ['await $.remove('+q(object)+', '+value(args[1])+');'];
  }
  case 'FOREACH':{
   if(scope.loop)fail('FOREACH cannot be nested');
   const body=args.pop()!;
   const alias=takeAlias(args.pop(),scope,'FOREACH needs AS(item) before the step');
   const inner:ActionScope={...scope,loop:true};
   if(args[0]?.kind==='call'){
    if(args.length!==1)fail('FOREACH over a collection takes the collection, AS(item) and a step');
    const source=value(args[0]);
    return ['for (const item of O.items('+source+')) {','  v['+q(alias)+'] = item;',...indent(stepCode(body,inner)),'}'];
   }
   const object=literalName(args.shift(),'FOREACH Object');
   if(args.length%2)fail('FOREACH needs Field, value pairs');
   scope.aliasObjects?.set(alias,object);
   const criteria=criteriaCode(args,scope,'FOREACH');
   scope.data=true;scope.reads.add(object);noteSet(object,args,scope);
   // A loop whose whole body is CREATERECORD / UPDATERECORD / DELETERECORD becomes ONE call per
   // step: the server reads the matching rows once and saves them in one bulk statement.
   const batched=setBasedSteps(body,object,criteria,alias,scope);
   if(batched)return batched;
   return ['for (const item of await $.list('+q(object)+', '+criteria+')) {',
    '  v['+q(alias)+'] = item;',...indent(stepCode(body,inner)),'}'];
  }
  case 'SCREEN':{
   const page=literalName(args[0],'SCREEN page');
   // After the page: mode, record and layer in any order, blanks allowed (screenArguments).
   let parsed:ReturnType<typeof screenArguments>;
   try{parsed=screenArguments(args.slice(1));}catch(error){fail(error instanceof Error?error.message:String(error));}
   const {mode,modeGiven,record,layer,seconds}=parsed!;
   scope.ui.add('SCREEN');
   // $.ui("SCREEN", page, mode, record, layer): the browser opens it (CompiledPageRuntime).
   // A layer switch keeps "no mode" blank: SCREEN(page, n) only switches page where it shows.
   return ['await $.ui("SCREEN", '+q(page)+', '+q(modeGiven||layer===undefined?mode:'')+(record||layer!==undefined?', '+(record?value(record):'""'):'')
    +(layer!==undefined?', '+q(String(layer)):'')+(seconds!==undefined?', '+q(String(seconds)):'')+');'];
  }
  case 'PAIRDISPLAY':{
   // PAIRDISPLAY(Page): pair a /display screen with this device; it shows Page of this app.
   if(args.length!==1)fail('PAIRDISPLAY needs the page the screen shows, e.g. PAIRDISPLAY(CustomerDisplay)');
   scope.ui.add('PAIRDISPLAY');
   return ['await $.ui("PAIRDISPLAY", '+q(literalName(args[0],'PAIRDISPLAY page'))+');'];
  }
  case 'PAIRGUEST':{
   // PAIRGUEST(App, RecordId): pair a tablet showing /display as that record's guest (a table's
   // tablet); it shows App's guest page (App Manager > Guest access).
   if(args.length!==2)fail('PAIRGUEST needs the app and the record, e.g. PAIRGUEST(SelfOrder, @recordId)');
   scope.ui.add('PAIRGUEST');
   return ['await $.ui("PAIRGUEST", '+q(literalName(args[0],'PAIRGUEST app'))+', '+value(args[1])+');'];
  }
  case 'CLOSESCREEN':case 'LOCKSCREEN':{
   scope.ui.add(node.name);
   // CLOSESCREEN("second"): close the page shown on the second monitor.
   if(node.name==='CLOSESCREEN'&&args.length){
    const which=literalName(args[0],'CLOSESCREEN target').toLowerCase();
    if(which!=='second')fail('CLOSESCREEN takes no target or "second"');
    return ['await $.ui("CLOSESCREEN", "second");'];
   }
   if(args.length)fail(node.name+' takes no arguments');
   return ['await $.ui('+q(node.name)+');'];
  }
  // A message box anywhere in an action (e.g. inside IF): shown after the save; its
  // answer steps are separate actions, run when the user taps.
  case 'CONFIRMSCREEN':return fail('CONFIRMSCREEN was removed: open your own popup page with SCREEN(page, popup)');
  case 'INFOSCREEN':{
   if(scope.loop)fail(node.name+' cannot run inside FOREACH');
   const confirm=false as boolean;
   const yes=args[1]&&!blankStep(args[1])?args[1]:null;
   const no=confirm&&args[2]&&!blankStep(args[2])?args[2]:null;
   const own=(node:Expression,into=new Set<string>()):Set<string>=>{
    if(node.kind==='call'){
     if(node.name==='AS'&&node.args[0]?.kind==='reference')into.add(node.args[0].value);
     node.args.forEach(arg=>own(arg,into));
    }
    return into;
   };
   for(const branch of [yes,no])if(branch){const mine=own(branch);for(const root of referencedRoots(branch))
    if(scope.aliases.has(root)&&!mine.has(root))fail('The steps after the answer run as a new action: they cannot use '+root
     +' from before the box. Read it again there (GETRECORD) or put the box first.');}
   const suffix='__box'+(scope.boxes.length+1);
   scope.boxes.push({suffix,yes,no});
   scope.ui.add(confirm?'CONFIRM':'INFO');
   const key=(part:string,branch:Expression|null)=>branch?q(ACTION_KEY_MARK+suffix+part):'""';
   const label=(arg:Expression|undefined)=>arg&&!blankStep(arg)?value(arg):'""';
   return ['await $.ui('+q(confirm?'CONFIRM':'INFO')+', '+value(args[0])+', '+key('__yes',yes)+', '+key('__no',no)
    +', '+(confirm?label(args[3]):'""')+', '+(confirm?label(args[4]):'""')+');'];
  }
  case 'PRINT':{
   scope.ui.add('PRINT');
   return ['await $.ui("PRINT", '+q(literalName(args[0],'print template'))+', '+value(args[1])+');'];
  }
  case 'FLOW':scope.ui.add('FLOW');return ['await $.ui("FLOW", '+q(literalName(args[0],'Flow name'))+');'];
  // Device steps (GPS, PDF drawn in the browser) and WAIT (resumes later) stay with the
  // action engine: the page keeps working, this action is listed in codeIssues.
  // WAIT: the steps after it are saved as a scheduled action (durable server job) in the
  // same transaction, and run later; this run stops here.
  case 'WAIT':{
   if(scope.loop)return fail('WAIT cannot run inside FOREACH');
   if(args.length!==2)return fail('WAIT needs minutes and seconds');
   scope.data=true;scope.ui.add('WAIT');
   const ordinal=(scope as {waits?:number}).waits??0;(scope as {waits?:number}).waits=ordinal+1;
   return ['await $.service("WAIT", ['+args.map(value).join(', ')+', '+ordinal+', '+q((scope as {source?:string}).source??'')+'], v);','return;'];
  }
  // Device steps: the server asks the browser (GPS, PDF drawn from the print template)
  // and runs the action again with the answer; nothing is saved until every step is done.
  case 'LOCATION':case 'CREATEPDF':{
   const last=args.at(-1);
   const alias=last?.kind==='call'&&last.name==='AS'?takeAlias(args.pop(),scope,'AS needs one name'):'';
   if(node.name==='LOCATION'&&!alias)return fail('LOCATION needs AS(name)');
   scope.data=true;scope.ui.add(node.name);
   const list=node.name==='CREATEPDF'?[q(literalName(args[0],'print template')),...args.slice(1).map(value)]:[];
   return [(alias?'v['+q(alias)+'] = ':'')+'await $.service('+q(node.name)+', ['+list.join(', ')+']);'];
  }
  case 'GUESTLINK':{
   // GUESTLINK(App, RecordId, AS(x)): server; the record's guest link (App Manager > Guest access).
   const last=args.at(-1);
   const alias=last?.kind==='call'&&last.name==='AS'?takeAlias(args.pop(),scope,'AS needs one name'):'';
   if(!alias||args.length!==2)fail('GUESTLINK needs the app, the record and AS(x), e.g. GUESTLINK(SelfOrder, @recordId, AS(g))');
   scope.data=true;
   return ['v['+q(alias)+'] = await $.service("GUESTLINK", ['+q(literalName(args[0],'GUESTLINK app'))+', '+value(args[1])+']);'];
  }
  case 'EMAIL':case 'WHATSAPP':case 'SMS':case 'CASHMOVE':{
   const last=args.at(-1);
   const alias=last?.kind==='call'&&last.name==='AS'?takeAlias(args.pop(),scope,'AS needs one name'):'';
   // Runs on the server only: messages are sent after the save, cash moves in the same transaction.
   scope.data=true;
   if(node.name==='CASHMOVE')scope.writes.add('CashLedger');
   const list=node.name==='CASHMOVE'?args.map(value)
    :[q(literalName(args[0],'Named Credential')),...args.slice(1).map(value)];
   return [(alias?'v['+q(alias)+'] = ':'')+'await $.service('+q(node.name)+', ['+list.join(', ')+']);'];
  }
  // CALLOUT('QR.CreateOrder', 'Amount', x, ..., AS(qo)): the connector holds the Named Credential;
  // the server checks connector, credential and device first and stops at once if one is missing.
  case 'CALLOUT':{
   const last=args.at(-1);
   const alias=last?.kind==='call'&&last.name==='AS'?takeAlias(args.pop(),scope,'AS needs one name'):'';
   const first=args.shift();
   const operation=first?.kind==='literal'||first?.kind==='reference'?String(first.value):'';
   if(!/^[A-Za-z][A-Za-z0-9_]{0,79}\.[A-Za-z][A-Za-z0-9_]{0,79}$/.test(operation))
    return fail("CALLOUT needs 'Connector.Operation', for example 'QR.CreateOrder'");
   if(args.length%2)return fail('CALLOUT needs field and value pairs');
   const pairs:string[]=[];
   for(let i=0;i<args.length;i+=2)pairs.push(q(literalName(args[i],'CALLOUT field'))+': '+value(args[i+1]));
   scope.data=true;
   return [(alias?'v['+q(alias)+'] = ':'')+'await $.service("CALLOUT", ['+q(operation)+', {'+pairs.join(', ')+'}]);'];
  }
  // REPEAT(step, until, every, max): runs the step, stops when `until` is TRUE; waits between
  // tries on the server (55 seconds in all at most, so a missing reply never hangs the till).
  case 'REPEAT':{
   if(scope.loop)return fail('REPEAT cannot be nested or run inside FOREACH');
   const [body,until,every,times]=args;
   if(!body||!until)return fail('REPEAT needs a step and an until condition');
   scope.data=true;
   const inner:ActionScope={...scope,loop:true};
   return ['for (let tries = 0, most = Math.max(1, Math.min(200, Math.trunc(Number('+(times?value(times):'10')+') || 1))); tries < most; tries++) {',
    ...indent(stepCode(body,inner)),
    '  if ('+value(until)+') break;',
    '  if (tries < most - 1 && (await $.service("SLEEP", ['+(every?value(every):'2')+'])).timeUp) break;','}'];
  }
  case 'AS':return fail('AS(name) belongs at the end of GETRECORD, CREATERECORD or FOREACH');
 }
 return fail('Unsupported action step '+node.name);
}

function assignmentCode(assignment:{kind:'state'|'filter'|'navigate';key:string},scope:ActionScope):string[]{
 const value=(source:string)=>expression(parseFormula('='+source),scope);
 const node=(assignment as {value?:string}).value??'';
 if(assignment.kind==='state')return ['$.setState('+q(assignment.key)+', '+value(node)+');'];
 scope.ui.add(assignment.kind==='filter'?'FILTER':'NAVIGATE');
 return ['await $.ui('+q(assignment.kind==='filter'?'FILTER':'NAVIGATE')+', '+q(assignment.key)+', '+value(node)+');'];
}
export type CompiledActionCode={
 /** `async ($) => { ... }`: run in the browser (instant, on held rows) and on the server (SQL, one transaction). */
 js:string;
 /** Objects the action reads / writes. */
 reads:string[];writes:string[];
 /** UI steps (SCREEN, PRINT, ...): the browser runs them after the save. */
 ui:string[];
 /** true: the action touches records, so it is saved on the server. */
 data:boolean;
 sets:RecordSetNeed[];functions:string[];references:string[];
 /** Message boxes inside the action; their answer steps are compiled as their own actions. */
 boxes:MessageBox[];
};
/** An action formula -> one async function. */
export function compileActionFormula(source:string,rowObject=''):CompiledActionCode{
 // `@state.x := value`, `@filter.x := value`, `@navigate.page|list|home := value`.
 const assignment=parseActionFormulaAssignment(source);
 const root=assignment?parseFormula('='+assignment.value):parseFormula(source);
 return compileActionNode(root,rowObject,source,assignment);
}
/** Names generated code itself uses: an AS(...) name like these stays in the v map. */
const TAKEN=new Set(['$','F','O','v','row','rows','item','given','value','result','Object','Math','Date','String','Number','JSON','Array','Promise','Boolean','Symbol','Error']);
/** AS(name) results as plain local variables (`let sc;` … `sc = await $.getRecord(…)`), as a
 * person writes them. An action that WAITs keeps them in the v map (the wait resumes it). */
function localAliases(lines:string[],aliases:ReadonlySet<string>):string[]{
 const names=[...aliases].filter(name=>isIdentifier(name)&&!TAKEN.has(name)&&!name.startsWith('__'));
 if(!names.length||lines.some(line=>line.includes('$.service("WAIT"')))return lines;
 const used=names.filter(name=>lines.some(line=>line.includes('v['+q(name)+']')));
 if(!used.length)return lines;
 const out=lines.map(line=>used.reduce((text,name)=>text.split('v['+q(name)+']').join(name),line));
 return ['let '+used.join(', ')+';',...out];
}
/** An already parsed action (also a message box's Yes/No/OK steps) -> one async function. */
export function compileActionNode(root:Expression,rowObject='',source='',
 assignment:ReturnType<typeof parseActionFormulaAssignment>=null):CompiledActionCode{
 const aliases=new Set<string>();
 const scope:ActionScope={rowObject,row:'$.row',aliases,aliasesMutable:aliases,async:true,functions:new Set(),
  references:new Set(),sets:[],reads:new Set(),writes:new Set(),ui:new Set(),data:false,loop:false,aliasSets:new Map(),aliasObjects:new Map(),boxes:[]};
 (scope as {source?:string}).source=source;
 // Aliases are visible to later steps: collect them first (AS names are unique per action).
 const collect=(node:Expression)=>{
  if(node.kind!=='call')return;
  if(node.name==='AS'&&node.args[0])aliases.add(literalName(node.args[0],'result variable'));
  node.args.forEach(collect);
 };
 collect(root);
 const lines=localAliases(assignment?assignmentCode(assignment,scope):stepCode(root,scope),aliases);
 const usesMap=lines.some(line=>/(^|[^A-Za-z0-9_$.])v\[/.test(line));
 return {js:'async ($) => {\n'+(usesMap?'  const v = Object.create(null);\n':'')+indent(lines).join('\n')+(lines.length?'\n':'')+'}',
  reads:[...scope.reads],writes:[...scope.writes],ui:[...scope.ui],data:scope.data,sets:scope.sets,
  functions:[...scope.functions],references:[...scope.references],boxes:scope.boxes};
}
