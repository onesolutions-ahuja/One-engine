import {flowFormulaReferences} from '../expression-engine/FormulaDependencyGraph.js';
export {flowFormulaReferences} from '../expression-engine/FormulaDependencyGraph.js';
import {
  validateFormulaFunctions,
  type FormulaExpressionContext
} from '../expression-engine/FormulaFunctionRegistry.js';
import {flowChoiceValues} from './flow-screen-choice-runtime.js';

import {tokenize} from '../expression-engine/FormulaTokenizer.js';
import {
  evaluateFormulaBinary,evaluateFormulaUnary,formulaTruth,Parser
} from '../expression-engine/FormulaParser.js';
import {
  evaluateFormulaDateBinary,formulaAddDays,formulaAddMonths,formulaDateParts,formulaDateText,
  formulaDateTimeParts,formulaNowIsoDateTime,formulaTimeText,
  formulaWeekday,isFormulaDate,parseFormulaDateTime
} from '../expression-engine/FormulaDate.js';
import {roundFormulaNumber} from '../expression-engine/FormulaNumeric.js';
import {createNamedFormulaCollection} from '../expression-engine/FormulaCollection.js';
import {sumFormulaCollection} from '../expression-engine/FormulaCollection.js';
import {isExcelWildcardDataReference} from '../expression-engine/FormulaWildcard.js';
import type {Expression} from '../expression-engine/FormulaParser.js';

type FormulaResolver=(name:string)=>unknown;
export type FormulaEvaluationContext={
  readonly timeZone?:string;
  readonly locale?:string;
  readonly currencyIsoCode?:string|null;
  readonly now?:Date|string;
  readonly currencyRates?:Readonly<Record<string,number>>;
  readonly isClone?:boolean;
  readonly transactionStage?:'create'|'update'|'clone'|'flow'|'formula-field'|'page-binding';
  readonly currentRecord?:Readonly<Record<string,unknown>>|null;
  readonly priorRecord?:Readonly<Record<string,unknown>>|null;
  readonly actor?:Readonly<{Id:string;Name:string;Email:string;TimeZone:string;
    Locale:string;CurrencyIsoCode:string|null}>;
  readonly profile?:Readonly<{Id:string|null;Name:string|null;DeveloperName:string|null}>;
  readonly organization?:Readonly<{Id:string;Name:string}>;
  readonly recordType?:Readonly<{Id:string|null;Name:string|null;DeveloperName:string|null}>;
  readonly permissionSnapshot?:Readonly<Record<string,boolean>>;
  readonly fieldAccess?:Readonly<Record<string,boolean>>;
};
function freezeSnapshot(value:unknown,seen=new WeakSet<object>()):unknown {
  if(value instanceof Date){
    if(!Number.isFinite(value.getTime()))throw new Error('Invalid formula evaluation time');
    return value.toISOString();
  }
  if(!value||typeof value!=='object')return value;
  if(seen.has(value))throw new Error('Formula evaluation context cannot contain cycles');
  seen.add(value);
  if(Array.isArray(value)){
    const result=value.map(item=>freezeSnapshot(item,seen));
    seen.delete(value);
    return Object.freeze(result);
  }
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const [key,item] of Object.entries(value))
    Object.defineProperty(result,key,{value:freezeSnapshot(item,seen),enumerable:true});
  seen.delete(value);
  return Object.freeze(result);
}
/** Copies and deeply freezes the transaction inputs used during one formula pass. */
export function createFormulaEvaluationContext(
  input:FormulaEvaluationContext
):FormulaEvaluationContext {
  return freezeSnapshot(input) as FormulaEvaluationContext;
}
export type FormulaImageResult={
  __formulaImage:'MetaDriveFormulaImage';
  url:string;
  alt:string;
  height:number|null;
  width:number|null;
};
const numeric=(value:unknown):number=>{
  const result=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
  if(!Number.isFinite(result))throw new Error('Flow formula expected a finite number');
  return result;
};
const validISODate=isFormulaDate;
export function isFormulaImageResult(value:unknown):value is FormulaImageResult {
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value)
    &&(value as FormulaImageResult).__formulaImage==='MetaDriveFormulaImage'
    &&typeof (value as FormulaImageResult).url==='string');
}
const text=(value:unknown):string=>value===null||value===undefined?''
  :isFormulaImageResult(value)?value.url:String(value);
const formulaText=(value:unknown):string=>typeof value==='boolean'?value?'TRUE':'FALSE':text(value);
const textPoints=(value:unknown):string[]=>Array.from(text(value));
const truth=formulaTruth;
function evaluate(node:Expression,resolve:FormulaResolver,context:FormulaEvaluationContext):unknown {
  const value=evaluateNode(node,resolve,context);
  if(typeof value==='number'&&!Number.isFinite(value))
    throw new Error('Formula result must be finite');
  return value;
}

function evaluateNode(node:Expression,resolve:FormulaResolver,context:FormulaEvaluationContext):unknown {
  if(node.kind==='literal')return node.value;
  if(node.kind==='reference')return resolve(node.value);
  if(node.kind==='unary'){
    const value=evaluate(node.value,resolve,context);
    return evaluateFormulaUnary(node.operator,value);
  }
  if(node.kind==='binary'){
    const left=evaluate(node.left,resolve,context);
    if(node.operator==='AND'&&!truth(left))return false;
    if(node.operator==='OR'&&truth(left))return true;
    const right=evaluate(node.right,resolve,context);
    const temporal=evaluateFormulaDateBinary(node.operator,left,right,context.timeZone??'UTC');
    if(temporal.handled)return temporal.value;
    return evaluateFormulaBinary(node.operator,left,right,
      node.left.kind==='reference'&&isExcelWildcardDataReference(node.left.value));
  }
  const argument=(index:number):unknown=>{
    if(!node.args[index])throw new Error(node.name+' has too few arguments');
    return evaluate(node.args[index],resolve,context);
  };
  const arity=(minimum:number,maximum=minimum)=>{
    if(node.args.length<minimum||node.args.length>maximum)
      throw new Error('Invalid argument count for '+node.name);
  };
  // Lifecycle helpers read the field named by the argument, not its value.
  const lifecycleField=():{reference:string;field:string}=>{
    const target=node.args[0];
    if(!target||target.kind!=='reference')throw new Error(node.name+' requires a field reference');
    const reference=target.value;
    const field=reference.startsWith('$Record.')?reference.slice(8)
      :reference.startsWith('$')?'':reference.includes('.')?reference.slice(reference.indexOf('.')+1):reference;
    if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(field))throw new Error(node.name+' requires a record field');
    return {reference,field};
  };
  const isNewRecord=():boolean=>context.transactionStage==='create'||context.transactionStage==='clone'
    ||(context.transactionStage!=='update'&&!context.priorRecord);
  switch(node.name){
    case 'ISNEW':arity(0);return isNewRecord();
    case 'PRIORVALUE':arity(1);{
      const {reference,field}=lifecycleField();
      return isNewRecord()||!context.priorRecord?resolve(reference):context.priorRecord[field]??null;
    }
    case 'ISCHANGED':arity(1);{
      const {reference,field}=lifecycleField();
      if(isNewRecord()||!context.priorRecord)return false;
      const blank=(value:unknown)=>value===null||value===undefined||value==='';
      const current=resolve(reference),prior=context.priorRecord[field];
      if(blank(current)&&blank(prior))return false;
      return formulaText(current)!==formulaText(prior);
    }
    case 'IF':arity(3);return truth(argument(0))?argument(1):argument(2);
    case 'IFERROR':arity(2);{
      try{return argument(0);}
      catch{return argument(1);}
    }
    case 'AND':arity(1,20);return node.args.every(item=>truth(evaluate(item,resolve,context)));
    case 'OR':arity(1,20);return node.args.some(item=>truth(evaluate(item,resolve,context)));
    case 'NOT':arity(1);return !truth(argument(0));
    case 'ISBLANK':arity(1);return argument(0)===null||argument(0)===undefined||argument(0)==='';
    case 'ISNULL':arity(1);return argument(0)===null||argument(0)===undefined;
    case 'ISNUMBER':arity(1);{
      const value=argument(0);
      return typeof value==='number'&&Number.isFinite(value)
        ||typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value));
    }
    case 'BLANKVALUE':arity(2);{
      const value=argument(0);return value===null||value===undefined||value===''?argument(1):value;
    }
    case 'NULLVALUE':arity(2);{
      const value=argument(0);return value===null||value===undefined?argument(1):value;
    }
    case 'TEXT':arity(1);return formulaText(argument(0));
    case 'VALUE':arity(1);return numeric(argument(0));
    case 'LEN':arity(1);return textPoints(argument(0)).length;
    // Excel CHAR(code): CHAR(10) is a new line.
    case 'CHAR':arity(1);{
      const code=Math.trunc(numeric(argument(0)));
      if(code<1||code>1114111)throw new Error('CHAR needs a character code from 1 to 1114111');
      return String.fromCodePoint(code);
    }
    case 'COLLECTION':{
      arity(2,20);
      const name=argument(0);
      const items=node.args.slice(1).map((_,index)=>argument(index+1));
      return createNamedFormulaCollection(name,items);
    }
    case 'SUM':arity(1);return sumFormulaCollection(argument(0));
    case 'LOWER':arity(1);return text(argument(0)).toLowerCase();
    case 'UPPER':arity(1);return text(argument(0)).toUpperCase();
    case 'PROPER':arity(1);return text(argument(0)).toLowerCase()
      .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu,
        (_match,prefix:string,letter:string)=>prefix+letter.toUpperCase());
    case 'LEFT':arity(1,2);return textPoints(argument(0))
      .slice(0,argument(1)===undefined?1:Math.max(0,Math.trunc(numeric(argument(1))))).join('');
    case 'RIGHT':arity(1,2);{
      const value=textPoints(argument(0)),length=argument(1)===undefined?1:Math.max(0,Math.trunc(numeric(argument(1))));
      return value.slice(Math.max(0,value.length-length)).join('');
    }
    case 'FIND':arity(2,3);{
      const haystack=textPoints(argument(1)),needle=textPoints(argument(0));
      const start=node.args[2]?Math.max(0,Math.trunc(numeric(argument(2)))-1):0;
      let found=-1;
      for(let index=start;index<=haystack.length-needle.length;index++){
        if(needle.every((point,offset)=>haystack[index+offset]===point)){found=index;break;}
      }
      return found<0?0:found+1;
    }
    case 'CONTAINS':arity(2);return text(argument(0)).includes(text(argument(1)));
    case 'BEGINS':arity(2);return text(argument(0)).startsWith(text(argument(1)));
    case 'ISPICKVAL':arity(2);return text(argument(0))===text(argument(1));
    case 'INCLUDES':arity(2);{
      const choices=text(argument(0)).split(';').filter(Boolean);
      const expected=text(argument(1));
      return choices.includes(expected);
    }
    case 'ROUND':arity(1,2);{
      const scale=node.args[1]?Math.trunc(numeric(argument(1))):0;
      return roundFormulaNumber(numeric(argument(0)),scale,'ROUND');
    }
    case 'ROUNDUP':case 'ROUNDDOWN':arity(1,2);{
      const scale=node.args[1]?Math.trunc(numeric(argument(1))):0;
      return roundFormulaNumber(numeric(argument(0)),scale,node.name);
    }
    case 'MIN':arity(1,20);return Math.min(...node.args.map(item=>numeric(evaluate(item,resolve,context))));
    case 'MAX':arity(1,20);return Math.max(...node.args.map(item=>numeric(evaluate(item,resolve,context))));
    case 'DATE':arity(3);{
      const year=Math.trunc(numeric(argument(0))),month=Math.trunc(numeric(argument(1))),
        day=Math.trunc(numeric(argument(2)));
      if(year<1||year>9999||month<1||month>12||day<1||day>31)
        throw new Error('Invalid DATE arguments');
      const value=`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if(!validISODate(value))throw new Error('Invalid DATE arguments');
      return value;
    }
    case 'ADDDAYS':arity(2);{
      return formulaAddDays(text(argument(0)),numeric(argument(1)),context.timeZone??'UTC');
    }
    case 'DATEVALUE':arity(1);{
      const input=text(argument(0));
      if(validISODate(input))return input;
      return formulaDateText(formulaDateParts(
        parseFormulaDateTime(input,context.timeZone??'UTC'),context.timeZone??'UTC'));
    }
    case 'TIMEVALUE':arity(1);{
      const input=text(argument(0));
      const match=/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(input);
      if(match)return `${match[1]}:${match[2]}:${match[3]??'00'}.${(match[4]??'').padEnd(3,'0')}`;
      return formulaTimeText(parseFormulaDateTime(input,context.timeZone??'UTC'),context.timeZone??'UTC');
    }
    case 'TIMENOW':arity(0);{
      return formulaTimeText(context.now as Date,context.timeZone??'UTC');
    }
    case 'TODAY':arity(0);{
      return formulaDateText(formulaDateParts(context.now as Date,context.timeZone??'UTC'));
    }
    case 'NOW':arity(0);return formulaNowIsoDateTime(context.now as Date);
    case 'DAY':case 'MONTH':case 'YEAR':case 'HOUR':case 'MINUTE':case 'SECOND':case 'WEEKDAY':arity(1);{
      const parts=formulaDateTimeParts(text(argument(0)),context.timeZone??'UTC');
      switch(node.name){
        case 'DAY':return parts.day;
        case 'MONTH':return parts.month;
        case 'YEAR':return parts.year;
        case 'HOUR':return parts.hour;
        case 'MINUTE':return parts.minute;
        case 'SECOND':return parts.second;
        default:return formulaWeekday(parts);
      }
    }
    case 'ADDMONTHS':arity(2);{
      return formulaAddMonths(text(argument(0)),numeric(argument(1)),context.timeZone??'UTC');
    }
    case 'GEOLOCATION':arity(2);{
      const latitude=numeric(argument(0)),longitude=numeric(argument(1));
      if(latitude < -90||latitude > 90||longitude < -180||longitude > 180)
        throw new Error('Invalid formula geolocation coordinates');
      return {latitude,longitude};
    }
    case 'DISTANCE':arity(3);{
      const first=argument(0),second=argument(1),unit=text(argument(2)).toLowerCase();
      const coordinates=(value:unknown)=>{
        if(!value||typeof value!=='object'||!('latitude' in value)||!('longitude' in value))
          throw new Error('DISTANCE requires two geolocation values');
        const latitude=numeric(value.latitude),longitude=numeric(value.longitude);
        if(latitude < -90||latitude > 90||longitude < -180||longitude > 180)
          throw new Error('Invalid formula geolocation coordinates');
        return {latitude,longitude};
      };
      const a=coordinates(first),b=coordinates(second);
      const toRadians=(degrees:number)=>degrees*Math.PI/180;
      const latitudeDelta=toRadians(b.latitude-a.latitude);
      const longitudeDelta=toRadians(b.longitude-a.longitude);
      const haversine=Math.sin(latitudeDelta/2)**2
        +Math.cos(toRadians(a.latitude))*Math.cos(toRadians(b.latitude))
          *Math.sin(longitudeDelta/2)**2;
      const kilometers=6371.0088*2*Math.atan2(Math.sqrt(haversine),Math.sqrt(1-haversine));
      if(unit==='km')return kilometers;
      if(unit==='mi')return kilometers/1.609344;
      throw new Error('DISTANCE unit must be "km" or "mi"');
    }
    default:throw new Error('Unsupported Flow formula function: '+node.name);
  }
}

/** Evaluate a prevalidated server-side action AST node using the same pure Flow
 * scalar evaluator. Callers must opt in only expressions proven compatible. */
export function evaluateFlowFormulaNode(node:Expression,resolve:(name:string)=>unknown,
 context:FormulaEvaluationContext={}):unknown{
 validateFormulaFunctions(node,'ribbon_binding');
 return evaluate(node,resolve,context);
}

export function evaluateFlowFormula(expression:string,resolve:FormulaResolver,
  context:FormulaEvaluationContext={},expressionContext:FormulaExpressionContext='flow_formula'):unknown {
  if(typeof expression!=='string'||!expression.trim())throw new Error('Flow formula is empty');
  const ast=new Parser(tokenize(expression)).parse();
  validateFormulaFunctions(ast,expressionContext);
  const now=context.now===undefined?new Date():context.now instanceof Date
    ?new Date(context.now):parseFormulaDateTime(context.now,'UTC');
  if(!Number.isFinite(now.getTime()))throw new Error('Invalid formula evaluation time');
  return evaluate(ast,resolve,{...context,now});
}

export function validateFlowFormula(expression:string,
  context:FormulaExpressionContext='flow_formula'):void {
  if(typeof expression!=='string'||!expression.trim())throw new Error('Flow formula is empty');
  const ast=new Parser(tokenize(expression)).parse();
  validateFormulaFunctions(ast,context);
}

export type FormulaValueType='Number'|'Text'|'Checkbox'|'Date'|'DateTime'|'Time'
  |'Picklist'|'MultiPicklist'|'Geolocation'|'Collection'|'Null';
type FormulaTypeResolver=(reference:string)=>FormulaValueType|null;
const formulaTextTypes=new Set<FormulaValueType>(['Text','Picklist']);
const formulaNumeric=(type:FormulaValueType)=>type==='Number';
const compatibleFormulaTypes=(left:FormulaValueType,right:FormulaValueType):FormulaValueType|null=>{
  if(left==='Null')return right;
  if(right==='Null')return left;
  if(left===right)return left;
  if(formulaTextTypes.has(left)&&formulaTextTypes.has(right))return 'Text';
  return null;
};
export function inferFlowFormulaType(expression:string,resolve:FormulaTypeResolver,
  context:FormulaExpressionContext='formula_field'):FormulaValueType {
  validateFlowFormula(expression,context);
  const infer=(node:Expression):FormulaValueType=>{
    if(node.kind==='literal')return node.value===null?'Null':typeof node.value==='number'?'Number':
      typeof node.value==='boolean'?'Checkbox':'Text';
    if(node.kind==='reference'){
      const type=resolve(node.value);
      if(!type)throw new Error('Unknown formula field reference: '+node.value);
      return type;
    }
    if(node.kind==='unary'){
      const type=infer(node.value);
      if(node.operator==='NOT'){
        if(type!=='Checkbox')throw new Error('NOT requires a checkbox value');
        return 'Checkbox';
      }
      if(!formulaNumeric(type))throw new Error('Numeric unary operators require a number');
      return 'Number';
    }
    if(node.kind==='binary'){
      const left=infer(node.left),right=infer(node.right),operator=node.operator;
      if(operator==='AND'||operator==='OR'){
        if(left!=='Checkbox'||right!=='Checkbox')throw new Error(operator+' requires checkbox values');
        return 'Checkbox';
      }
      if(operator==='&')return 'Text';
      if(['=','==','!=','<>'].includes(operator)){
        if(!compatibleFormulaTypes(left,right))throw new Error('Formula comparison types do not match');
        return 'Checkbox';
      }
      if(['>','>=','<','<='].includes(operator)){
        const orderedTypes=compatibleFormulaTypes(left,right);
        if(!(formulaNumeric(left)&&formulaNumeric(right)
          ||orderedTypes==='Text'||['Date','DateTime','Time'].includes(left)&&left===right))
          throw new Error('Ordered formula comparisons require matching numbers, text, or temporal values');
        return 'Checkbox';
      }
      if(operator==='-'&&left===right&&(left==='Date'||left==='DateTime'))return 'Number';
      if((operator==='+'||operator==='-')&&left==='Date'&&formulaNumeric(right))return 'Date';
      if(operator==='+'&&formulaNumeric(left)&&right==='Date')return 'Date';
      if((operator==='+'||operator==='-')&&left==='DateTime'&&formulaNumeric(right))return 'DateTime';
      if(operator==='+'&&formulaNumeric(left)&&right==='DateTime')return 'DateTime';
      if(!formulaNumeric(left)||!formulaNumeric(right))
        throw new Error('Arithmetic formula operators require numeric values');
      return 'Number';
    }
    const args=node.args.map(infer),arity=(minimum:number,maximum=minimum)=>{
      if(args.length<minimum||args.length>maximum)
        throw new Error('Invalid argument count for '+node.name);
    };
    const requireType=(index:number,allowed:FormulaValueType[])=>{
      if(!allowed.includes(args[index]))throw new Error(node.name+' has an invalid argument type');
    };
    const requireText=(index:number)=>requireType(index,['Text','Picklist']);
    const requireNumber=(index:number)=>requireType(index,['Number']);
    switch(node.name){
      case 'COLLECTION':arity(2,20);requireText(0);return 'Collection';
      case 'IF':arity(3);requireType(0,['Checkbox']);{
        const result=compatibleFormulaTypes(args[1],args[2]);
        if(!result)throw new Error('IF result types do not match');
        return result;
      }
      case 'IFERROR':arity(2);{
        const result=compatibleFormulaTypes(args[0],args[1]);
        if(!result)throw new Error('IFERROR result types do not match');
        return result;
      }
      case 'AND':case 'OR':arity(1,20);args.forEach((_,index)=>requireType(index,['Checkbox']));return 'Checkbox';
      case 'NOT':arity(1);requireType(0,['Checkbox']);return 'Checkbox';
      case 'ISBLANK':case 'ISNULL':case 'ISNUMBER':arity(1);return 'Checkbox';
      case 'ISNEW':arity(0);return 'Checkbox';
      case 'ISCHANGED':arity(1);return 'Checkbox';
      case 'PRIORVALUE':arity(1);return args[0];
      case 'BLANKVALUE':case 'NULLVALUE':arity(2);{
        const result=compatibleFormulaTypes(args[0],args[1]);
        if(!result)throw new Error(node.name+' argument types do not match');
        return result;
      }
      case 'TEXT':arity(1);return 'Text';
      case 'VALUE':arity(1);requireText(0);return 'Number';
      case 'LEN':arity(1);requireText(0);return 'Number';
      case 'CHAR':arity(1);requireNumber(0);return 'Text';
      case 'LOWER':case 'UPPER':case 'PROPER':
      arity(1);requireText(0);return 'Text';
      case 'LEFT':case 'RIGHT':arity(1,2);requireText(0);if(args.length===2)requireNumber(1);return 'Text';
      case 'FIND':arity(2,3);requireText(0);requireText(1);if(args.length===3)requireNumber(2);return 'Number';
      case 'CONTAINS':case 'BEGINS':arity(2);requireText(0);requireText(1);return 'Checkbox';
      case 'ISPICKVAL':arity(2);requireType(0,['Picklist']);requireText(1);return 'Checkbox';
      case 'INCLUDES':arity(2);requireType(0,['MultiPicklist']);requireText(1);return 'Checkbox';
      case 'ROUND':arity(1,2);requireNumber(0);if(args.length===2)requireNumber(1);return 'Number';
      case 'ROUNDUP':case 'ROUNDDOWN':
        arity(1,2);requireNumber(0);if(args.length===2)requireNumber(1);return 'Number';
      case 'MIN':case 'MAX':arity(1,20);args.forEach((_,index)=>requireNumber(index));return 'Number';
      case 'DATE':arity(3);args.forEach((_,index)=>requireNumber(index));return 'Date';
      case 'ADDDAYS':arity(2);requireType(0,['Date','DateTime']);requireNumber(1);return args[0];
      case 'DATEVALUE':arity(1);requireType(0,['Text','Date','DateTime']);return 'Date';
      case 'TIMEVALUE':arity(1);requireType(0,['Text','DateTime','Time']);return 'Time';
      case 'TIMENOW':arity(0);return 'Time';
      case 'TODAY':arity(0);return 'Date';
      case 'NOW':arity(0);return 'DateTime';
      case 'DAY':case 'MONTH':case 'YEAR':case 'WEEKDAY':
        arity(1);requireType(0,['Date','DateTime']);return 'Number';
      case 'HOUR':case 'MINUTE':case 'SECOND':
        arity(1);requireType(0,['DateTime','Time']);return 'Number';
      case 'ADDMONTHS':arity(2);requireType(0,['Date','DateTime']);requireNumber(1);return args[0];
      case 'GEOLOCATION':arity(2);requireNumber(0);requireNumber(1);return 'Geolocation';
      case 'DISTANCE':arity(3);requireType(0,['Geolocation']);requireType(1,['Geolocation']);requireText(2);return 'Number';
      default:throw new Error('Unsupported Flow formula function: '+node.name);
    }
  };
  return infer(new Parser(tokenize(expression)).parse());
}

export function validateFlowResources(resources:unknown,recordTriggered=false):string[] {
  if(resources===undefined)return [];
  if(!Array.isArray(resources))return ['Flow resources must be an array'];
  const errors:string[]=[];
  const names=new Set<string>();
  const formulaResources=new Map<string,string>();
  for(const resource of resources){
    if(!resource||typeof resource!=='object'||Array.isArray(resource)){
      errors.push('Invalid Flow resource');continue;
    }
    const item=resource as Record<string,unknown>;
    if(typeof item.name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(item.name)||names.has(item.name))
      errors.push('Flow resource names must be unique valid identifiers');
    else names.add(item.name);
    if(item.type==='Choice Set'){
      try{flowChoiceValues(item.value);}
      catch(error){errors.push('Invalid Flow Choice Set '+String(item.name)+': '
        +(error instanceof Error?error.message:'Invalid choices'));}
    }
    if(item.type==='Formula'){
      try{
        const expression=String(item.value??'');
        validateFlowFormula(expression,'flow_formula');
        const hasRecordGlobal=flowFormulaReferences(expression).some(reference=>
          /^\$(?:Record(?:__Prior|__IsClone)?|RecordType)(?:\.|$)/.test(reference));
        if(!recordTriggered&&hasRecordGlobal)
          errors.push('Record globals are only supported in Record-Triggered Flows');
        else formulaResources.set(String(item.name),expression);
      }
      catch(error){errors.push('Invalid Flow formula resource '+String(item.name)+': '
        +(error instanceof Error?error.message:'Invalid formula'));}
    }
  }
  const visiting:string[]=[],states=new Map<string,'visiting'|'visited'>(),cycles=new Set<string>();
  const visit=(name:string):void=>{
    if(states.get(name)==='visited')return;
    if(states.get(name)==='visiting'){
      const start=visiting.indexOf(name);
      const cycle=[...visiting.slice(start),name];
      const key=cycle.join(' -> ');
      if(!cycles.has(key)){
        cycles.add(key);
        errors.push('Cyclic Flow formula resource dependency: '+key);
      }
      return;
    }
    states.set(name,'visiting');
    visiting.push(name);
    for(const reference of flowFormulaReferences(formulaResources.get(name)!))
      if(formulaResources.has(reference))visit(reference);
    visiting.pop();
    states.set(name,'visited');
  };
  for(const name of formulaResources.keys())visit(name);
  return errors;
}
