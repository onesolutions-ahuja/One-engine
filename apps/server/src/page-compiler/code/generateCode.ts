/**
 * Page converter, formula part: formula text -> plain JavaScript source.
 *
 *  Display formula  "=LEFT(@Product.Name, 3)"
 *    -> (row, $) => F.LEFT($.f(row, "Name"), 3)
 *  Action formula   "=ACTIONS(GETRECORD(Cart, SessionKey, $session, AS(c)), UPDATERECORD(Cart, c.Id, Total, 0))"
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
import {tokenize} from '../../expression-engine/FormulaTokenizer.js';
import {isExcelWildcardDataReference} from '../../expression-engine/FormulaWildcard.js';
import {parseComponentStateReference} from '../../expression-engine/FormulaComponentState.js';
import {formulaEntry} from './formulaDictionary.js';

const q=(value:unknown)=>JSON.stringify(value);
const name=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const fieldPath=/^[A-Za-z][A-Za-z0-9_]{0,79}(?:\.[A-Za-z][A-Za-z0-9_]{0,79})?$/;
const reserved=new Set(['state','event','session','constructor','prototype','__proto__']);

export class FormulaCodeError extends Error {}
const fail=(message:string):never=>{throw new FormulaCodeError(message);};

/** A criteria pair whose value the page can work out by itself ($session, $state, literals). */
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
};

export function parseFormula(source:string):Expression{
 const body=source.trim();
 if(!body)return {kind:'literal',value:''};
 try{return new Parser(tokenize(body)).parse();}
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
 if(node.kind==='reference')return /^\$(?:session|state|tenant)(?:\.|$)/.test(node.value);
 if(node.kind==='unary')return pageKnown(node.value,scope);
 if(node.kind==='binary')return pageKnown(node.left,scope)&&pageKnown(node.right,scope);
 const entry=formulaEntry(node.name);
 return Boolean(entry&&(entry.kind==='pure'||entry.kind==='inline'))&&node.args.every(arg=>pageKnown(arg,scope));
}
function reference(path:string,scope:Scope):string{
 scope.references.add(path);
 if(/(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(path))fail('Invalid reference');
 if(path==='$session'||path==='$session.id')return '$.sessionId';
 if(path.startsWith('$session.'))return '$.session('+q(path.slice(9))+')';
 if(path.startsWith('$state.')){
  const key=path.slice(7);
  if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))fail('Invalid Page State reference');
  return '$.state('+q(key)+')';
 }
 if(/^\$tenant\.(name|logo)$/i.test(path))return '$.tenant('+q(path.slice(8).toLowerCase())+')';
 if(path.startsWith('$component.')){
  const parts=path.split('.');
  if(parts.length!==3)fail('Invalid component reference');
  return '$.component('+q(parts[1])+', '+q(parts[2])+')';
 }
 if(path.startsWith('$flow.'))return q(path);
 if(path.startsWith('$'))fail('Unsupported reference @'+path);
 const selected=parseComponentStateReference(path);
 if(selected)return '$.componentState('+q(selected.name)+', '+q(selected.field)+')';
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
  if(parts.length===1)return 'v['+q(parts[0])+']';
  return '$.f(v['+q(parts[0])+'], '+q(parts.slice(1).join('.'))+')';
 }
 if(parts.length===1)fail('Bare @'+path+' is not supported; use @Object.Field');
 if(parts[0]===scope.rowObject&&parts.length<=3)return '$.f('+scope.row+', '+q(parts.slice(1).join('.'))+')';
 // Another Object's field (@Product.ImageUrl in a cart line): the related value the
 // page already read for this row (permission-checked lookup), blank if none.
 if(parts.length===2||parts.length===3)return '$.m('+scope.row+', '+q(path)+')';
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
 const call='$.agg('+q(node.name)+', '+q(object)+', '+q(valueField)+', '+criteria+')';
 return scope.async?'(await '+call+')':call;
}
function criteriaCode(pairs:readonly Expression[],scope:Scope,label:string):string{
 const out:string[]=[];
 const seen=new Set<string>();
 for(let i=0;i<pairs.length;i+=2){
  const field=literalName(pairs[i],label+' field',fieldPath);
  if(seen.has(field))fail('Duplicate field '+field);
  seen.add(field);
  out.push('['+q(field)+', '+expression(pairs[i+1],scope)+']');
 }
 return '['+out.join(', ')+']';
}
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

export function expression(node:Expression,scope:Scope):string{
 switch(node.kind){
  case 'literal':return node.value===null?'null':q(node.value);
  case 'reference':return reference(node.value,scope);
  case 'unary':
   if(node.operator==='NOT')return '(!O.t('+expression(node.value,scope)+'))';
   return 'O.u('+q(node.operator)+', '+expression(node.value,scope)+')';
  case 'binary':{
   const left=expression(node.left,scope),right=expression(node.right,scope);
   if(node.operator==='AND')return '(O.t('+left+') && O.t('+right+'))';
   if(node.operator==='OR')return '(O.t('+left+') || O.t('+right+'))';
   if(node.operator==='&')return '(O.s('+left+') + O.s('+right+'))';
   const wildcard=node.left.kind==='reference'&&isExcelWildcardDataReference(node.left.value);
   return 'O.b('+q(node.operator)+', '+left+', '+right+(wildcard?', true, $.timeZone()':', false, $.timeZone()')+')';
  }
  case 'call':{
   const entry=formulaEntry(node.name);
   if(!entry)return fail(node.name+' is not in the formula dictionary');
   if(node.args.length<entry.min||node.args.length>entry.max)
    fail('Invalid argument count for '+node.name+' (expected '+entry.min+'-'+entry.max+')');
   scope.functions.add(node.name);
   if(entry.kind==='aggregate')return aggregateCall(node,scope);
   if(entry.kind==='action')return fail(node.name+' is an action; use it in an action formula');
   if(entry.serverOnly&&!scope.async)fail(node.name+' runs on the server; use it in an action formula');
   const args=node.args.map(arg=>expression(arg,scope));
   if(entry.kind==='inline'||entry.kind==='page')return entry.js!(args,{async:scope.async});
   return 'F.'+node.name+'('+(entry.clock?['$',...args]:args).join(', ')+')';
  }
 }
}

export type CompiledFormulaCode={js:string;functions:string[];references:string[];sets:RecordSetNeed[];reads:string[]};
/** A display formula -> `(row, $) => value`. */
export function compileDisplayFormula(source:string,rowObject=''):CompiledFormulaCode{
 const scope:Scope={rowObject,row:'row',aliases:new Set(),async:false,functions:new Set(),references:new Set(),sets:[],reads:new Set()};
 const body=expression(parseFormula(source),scope);
 return {js:'(row, $) => O.out('+body+')',functions:[...scope.functions],references:[...scope.references],
  sets:scope.sets,reads:[...scope.reads]};
}

/* ======================= Action formulas ======================= */
type ActionScope=Scope&{writes:Set<string>;ui:Set<string>;data:boolean;loop:boolean;aliasesMutable:Set<string>};
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
 if(node.kind!=='call')return fail('Expected an action step, found a value');
 const entry=formulaEntry(node.name);
 if(node.name==='IF'){
  if(node.args.length<2||node.args.length>3)fail('IF needs a test, a then-step and an else-step');
  const test=expression(node.args[0],scope);
  const then=stepCode(node.args[1],scope),otherwise=node.args[2]?stepCode(node.args[2],scope):[];
  if(!then.length&&!otherwise.length)return [];
  if(!then.length)return ['if (!O.t('+test+')) {',...indent(otherwise),'}'];
  return ['if (O.t('+test+')) {',...indent(then),...(otherwise.length?['} else {',...indent(otherwise)]:[]),'}'];
 }
 if(!entry||entry.kind!=='action')return fail(node.name+' is not an action step');
 if(node.args.length<entry.min||node.args.length>entry.max)
  fail('Invalid argument count for '+node.name+' (expected '+entry.min+'-'+entry.max+')');
 scope.functions.add(node.name);
 const args=[...node.args];
 const value=(arg:Expression)=>expression(arg,scope);
 switch(node.name){
  case 'ACTIONS':return args.flatMap(arg=>stepCode(arg,scope));
  case 'STATE':{
   const key=literalName(args[0],'Page State key');
   return ['$.setState('+q(key)+', '+value(args[1])+');'];
  }
  case 'GETRECORD':{
   const object=literalName(args.shift(),'GETRECORD Object');
   const alias=takeAlias(args.pop(),scope,'GETRECORD needs AS(variable) at the end');
   if(!args.length||args.length%2)fail('GETRECORD needs Field, value pairs');
   scope.data=true;scope.reads.add(object);
   const set=noteSet(object,args,scope);
   if(set)scope.aliasSets!.set(alias,set);else scope.aliasSets!.delete(alias);
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
    pairs.push('['+q(field)+', '+value(args[i+1])+']');
   }
   scope.data=true;scope.writes.add(object);
   const call=node.name==='CREATERECORD'
    ?'await $.create('+q(object)+', ['+pairs.join(', ')+'])'
    :'await $.update('+q(object)+', '+id+', ['+pairs.join(', ')+'])';
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
   scope.data=true;scope.reads.add(object);noteSet(object,args,scope);
   return ['for (const item of await $.list('+q(object)+', '+criteriaCode(args,scope,'FOREACH')+')) {',
    '  v['+q(alias)+'] = item;',...indent(stepCode(body,inner)),'}'];
  }
  case 'SCREEN':{
   const page=literalName(args[0],'SCREEN page');
   const mode=args[1]?literalName(args[1],'SCREEN mode').toLowerCase():'current';
   if(!['current','popup','newwindow'].includes(mode))fail('SCREEN mode must be current, popup or newwindow');
   scope.ui.add('SCREEN');
   return ['await $.ui("SCREEN", '+q(page)+', '+q(mode)+(args[2]?', '+value(args[2]):'')+');'];
  }
  case 'CLOSESCREEN':case 'LOCKSCREEN':scope.ui.add(node.name);return ['await $.ui('+q(node.name)+');'];
  case 'PRINT':{
   scope.ui.add('PRINT');
   return ['await $.ui("PRINT", '+q(literalName(args[0],'print template'))+', '+value(args[1])+');'];
  }
  case 'FLOW':scope.ui.add('FLOW');return ['await $.ui("FLOW", '+q(literalName(args[0],'Flow name'))+');'];
  // Device steps (GPS, PDF drawn in the browser) and WAIT (resumes later) stay with the
  // action engine: the page keeps working, this action is listed in codeIssues.
  case 'CREATEPDF':case 'WAIT':case 'LOCATION':return fail(node.name+' runs in the action engine');
  case 'EMAIL':case 'WHATSAPP':case 'SMS':case 'RECORDPAYMENT':{
   const last=args.at(-1);
   const alias=last?.kind==='call'&&last.name==='AS'?takeAlias(args.pop(),scope,'AS needs one name'):'';
   // Runs on the server only: messages are sent after the save, payments in the same transaction.
   scope.data=true;
   if(node.name==='RECORDPAYMENT'){scope.writes.add('Invoice');scope.writes.add('CashLedger');}
   const list=node.name==='RECORDPAYMENT'?args.map(value)
    :[q(literalName(args[0],'Named Credential')),...args.slice(1).map(value)];
   return [(alias?'v['+q(alias)+'] = ':'')+'await $.service('+q(node.name)+', ['+list.join(', ')+']);'];
  }
  case 'AS':return fail('AS(name) belongs at the end of GETRECORD, CREATERECORD or FOREACH');
 }
 return fail('Unsupported action step '+node.name);
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
};
/** An action formula -> one async function. */
export function compileActionFormula(source:string,rowObject=''):CompiledActionCode{
 const aliases=new Set<string>();
 const scope:ActionScope={rowObject,row:'$.row',aliases,aliasesMutable:aliases,async:true,functions:new Set(),
  references:new Set(),sets:[],reads:new Set(),writes:new Set(),ui:new Set(),data:false,loop:false,aliasSets:new Map()};
 // Aliases are visible to later steps: collect them first (AS names are unique per action).
 const root=parseFormula(source);
 const collect=(node:Expression)=>{
  if(node.kind!=='call')return;
  if(node.name==='AS'&&node.args[0])aliases.add(literalName(node.args[0],'result variable'));
  node.args.forEach(collect);
 };
 collect(root);
 const lines=stepCode(root,scope);
 return {js:'async ($) => {\n  const v = Object.create(null);\n'+indent(lines).join('\n')+(lines.length?'\n':'')+'}',
  reads:[...scope.reads],writes:[...scope.writes],ui:[...scope.ui],data:scope.data,sets:scope.sets,
  functions:[...scope.functions],references:[...scope.references]};
}
