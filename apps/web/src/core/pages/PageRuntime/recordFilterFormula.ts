/** Metadata-owned record filtering formulas compiled into permission-scoped
 * server filters before pagination. This intentionally accepts only expressions
 * that can be represented exactly by the existing Record API; there is NO
 * client-side filtering of a partial page and NO eval or arbitrary scripts. */
import {componentReaderKey,evaluateFieldExpressionDetailed,type FormulaBindingContext} from '../../../component-libraries/shared/FieldExpression.js';
import {Parser,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {hasExcelWildcardCriteria,parseExcelWildcardPattern} from '../../../../../server/src/expression-engine/FormulaWildcard.js';
import type {FieldMetadata} from '../../metadata/Definitions/metadata';

export type CompiledFilterFormula={
 blocked:boolean;filters:Array<{field:string;operator:string;value:string}>;
 filterLogic?:string;error?:string
};
type Plan={truth?:boolean;filters:CompiledFilterFormula['filters'];logic:string};
const blank=(value:unknown)=>value===null||value===undefined||value==='';
const stateName=(node:Expression):string|null=>
 node.kind==='reference'&&/^\$state\.[A-Za-z][A-Za-z0-9_]{0,63}$/.test(node.value)
  ?node.value.slice(7):null;
const asState=(node:Expression,state:Readonly<Record<string,unknown>>,sessionId=''):unknown=>{
 if(node.kind==='literal')return node.value;
 if(node.kind==='reference'&&node.value.startsWith('$session.')){
  const result=evaluateFieldExpressionDetailed(node.value,{},{sessionId});
  if(result.error)throw Error(result.error);
  return result.value;
 }
 if(node.kind==='reference'&&node.value.startsWith('$component.')){
  const parts=node.value.split('.');
  const reader=(state as {[componentReaderKey]?:FormulaBindingContext['readComponent']})[componentReaderKey];
  if(parts.length!==3||!reader)throw Error('Select a component and property on this page');
  return reader(parts[1],parts[2]);
 }
 const key=stateName(node);
 if(key!==null){const value=state[key];
  if(value===undefined||value===null||['string','number','boolean'].includes(typeof value))return value;
  throw Error('Page State formula value must be a scalar');
 }
 if(node.kind==='call'&&node.name==='ISBLANK'&&node.args.length===1)
  return blank(asState(node.args[0],state,sessionId));
 if(node.kind==='call'&&node.name==='NOT'&&node.args.length===1)
  return !Boolean(asState(node.args[0],state,sessionId));
 if(node.kind==='unary'&&node.operator==='NOT')return !Boolean(asState(node.value,state,sessionId));
 if(node.kind==='binary'){
  const left=asState(node.left,state,sessionId),right=asState(node.right,state,sessionId);
  switch(node.operator){
   case '=':case '==':return left===right;
   case '!=':case '<>':return left!==right;
   case 'AND':return Boolean(left)&&Boolean(right);
   case 'OR':return Boolean(left)||Boolean(right);
  }
 }
 throw Error('IF condition must use constants or $state values (e.g. ISBLANK($state.categoryId))');
};
const simpleField=(node:Expression,fields:ReadonlyArray<FieldMetadata>):FieldMetadata|null=>{
 if(node.kind!=='reference'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(node.value))return null;
 return fields.find(f=>f.apiName===node.value)??null;
};
const remap=(logic:string,offset:number):string=>
 logic.replace(/\b\d+\b/g,value=>String(Number(value)+offset));
const both=(operator:'AND'|'OR',a:Plan,b:Plan):Plan=>{
 if(a.truth!==undefined&&b.truth!==undefined)
  return {truth:operator==='AND'?a.truth&&b.truth:a.truth||b.truth,filters:[],logic:''};
 if(a.truth!==undefined){
  if(operator==='AND')return a.truth?b:a;
  return a.truth?a:b;
 }
 if(b.truth!==undefined){
  if(operator==='AND')return b.truth?a:b;
  return b.truth?b:a;
 }
 const filters=[...a.filters,...b.filters];
 if(filters.length>20)throw Error('Formula exceeds the 20-condition server filter limit');
 return {filters,logic:'('+a.logic+' '+operator+' '+remap(b.logic,a.filters.length)+')'};
};
const opNames:Record<string,string>={
 '=':'eq','==':'eq','>':'gt','>=':'gte','<':'lt','<=':'lte'
};
const flip:Record<string,string>={'<':'>','<=':'>=','>':'<','>=':'<=','=':'=','==':'=='};
function compile(node:Expression,fields:ReadonlyArray<FieldMetadata>,state:Readonly<Record<string,unknown>>,sessionId=''):Plan{
 if(node.kind==='literal'&&typeof node.value==='boolean')
  return {truth:node.value,filters:[],logic:''};
 if(node.kind==='call'&&node.name==='IF'&&node.args.length===3){
  const condition=asState(node.args[0],state,sessionId);
  if(typeof condition!=='boolean')throw Error('IF condition must return TRUE or FALSE');
  return compile(condition?node.args[1]:node.args[2],fields,state,sessionId);
 }
 if(node.kind==='binary'&&(node.operator==='AND'||node.operator==='OR'))
  return both(node.operator,compile(node.left,fields,state,sessionId),compile(node.right,fields,state,sessionId));
 if(node.kind==='call'&&(node.name==='AND'||node.name==='OR')&&node.args.length>=2
   &&node.args.length<=20)
  return node.args.map(arg=>compile(arg,fields,state,sessionId))
   .reduce((a,b)=>both(node.name as 'AND'|'OR',a,b));
 if(node.kind==='binary'&&Object.hasOwn(opNames,node.operator)){
  let field=simpleField(node.left,fields);
  let op=node.operator;
  let valueNode=node.right;
  if(!field){
   field=simpleField(node.right,fields);
   op=flip[node.operator];
   valueNode=node.left;
  }
  if(!field||!op)throw Error('Formula comparisons require a direct readable @Field and $state or literal');
  if(/^Formula\(/i.test(field.dataType)||/^(Geolocation|Address|EncryptedText)/i.test(field.dataType))
   throw Error('This field cannot be filtered reliably by the server');
  if(field.apiName.startsWith('@'))throw Error('Related formula fields are not directly server-filterable');
  const value=asState(valueNode,state,sessionId);
  if(value===undefined||value===null||value==='')throw Error('Selected formula state value is empty');
  if(!['string','boolean','number'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))
   throw Error('Formula comparison requires a scalar');
  if((op==='='||op==='==')&&hasExcelWildcardCriteria(value)){
   parseExcelWildcardPattern(value);
   // Match any populated relationship ID with "*", without loading records.
   if(field.relationship&&value==='*')
    return {filters:[{field:field.apiName,operator:'isNotBlank',value:''}],logic:'1'};
   if(!/^(Text|Email|Phone|Url|Picklist)(\(|$)/i.test(field.dataType))
    throw Error('Wildcard criterion requires a text field or an All relationship selector');
   return {filters:[{field:field.apiName,operator:'matches',value}],logic:'1'};
  }

  if(opNames[op]==='gt'||opNames[op]==='gte'||opNames[op]==='lt'||opNames[op]==='lte'){
   if(/^(Time|Geolocation|Address)/i.test(field.dataType))throw Error('Unsupported server comparison type');
  }
  return {filters:[{field:field.apiName,operator:opNames[op],value:String(value)}],logic:'1'};
 }
 throw Error('Filter formula must use IF, ISBLANK, AND/OR and supported @Field comparisons');
}
export function compileRecordFilterFormula(formula:unknown,fields:ReadonlyArray<FieldMetadata>,
 state:Readonly<Record<string,unknown>>={},sessionId=''):CompiledFilterFormula{
 if(formula===undefined||formula===null||formula==='')return {blocked:false,filters:[]};
 if(typeof formula!=='string')return {blocked:true,filters:[],error:'Invalid filter formula'};
 try{
  const parsed=new Parser(tokenize(formula)).parse();
  const plan=compile(parsed,fields,state,sessionId);
  return plan.truth===false?{blocked:true,filters:[]}
   :{blocked:false,filters:plan.filters,filterLogic:plan.logic||undefined};
 }catch(error){return {blocked:true,filters:[],error:error instanceof Error?error.message:'Invalid filter formula'};}
}
/** Check both selected and unselected Page State paths before allowing a save. */
export function validateRecordFilterFormula(formula:string,fields:ReadonlyArray<FieldMetadata>):string|null{
 if(!formula.trim())return null;
 const keys=Array.from(new Set([...formula.matchAll(/\$state\.([A-Za-z][A-Za-z0-9_]{0,63})/g)].map(m=>m[1])));
 if(keys.length>12)return 'Too many Page State references';
 for(const selected of [false,true]){
  const state=selected?Object.fromEntries(keys.map(key=>[key,'test-id'])):{};
  const result=compileRecordFilterFormula(formula,fields,{...state,[componentReaderKey]:()=>selected?'test-id':''});
  if(result.error)return result.error;
 }
 return null;
}
