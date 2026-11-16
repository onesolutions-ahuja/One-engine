import {readComponentState} from '../../../../../server/src/expression-engine/FormulaComponentState.js';
import {parsePageReference,pageReferencesIn,savedValueKey,isPageReference} from '../../../../../server/src/expression-engine/PageReferences.js';
/** Metadata-owned record filtering formulas compiled into permission-scoped
 * server filters before pagination. This intentionally accepts only expressions
 * that can be represented exactly by the existing Record API; there is NO
 * client-side filtering of a partial page and NO eval or arbitrary scripts. */
import {componentReaderKey,type FormulaBindingContext} from '../../../component-libraries/shared/FieldExpression.js';
import {signedInValue} from '../PageCompiler/pageCodeRuntime';
import {F,O} from '../../../../../server/src/page-compiler/code/formulaLibrary.js';
import {formulaEntry} from '../../../../../server/src/page-compiler/code/formulaDictionary.js';
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
const valueFunctions=new Set(['TODAY','NOW','TIMENOW','ADDDAYS','ADDMONTHS','DATE','DATEVALUE',
 'WEEKDAY','DAY','MONTH','YEAR','HOUR','MINUTE','VALUE','TEXT','LEFT','RIGHT','UPPER','LOWER',
 'LEN','ROUND','ROUNDUP','ROUNDDOWN','MIN','MAX','BLANKVALUE']);
const asState=(node:Expression,state:Readonly<Record<string,unknown>>,sessionId=''):unknown=>{
 if(node.kind==='literal')return node.value;
 const page=node.kind==='reference'?parsePageReference(node.value):null;
 if(page?.kind==='session'||page?.kind==='user'||page?.kind==='company'||page?.kind==='cart'){
  return signedInValue(page,state,sessionId);
 }
 // @ThisPage.Tabs1.Selected.Id: what that component published (blank until picked).
 if(page?.kind==='selected')return readComponentState(state.collectionSelections,page.name,page.field);
 if(page?.kind==='component'){
  // A saved value first; otherwise the component's own live value.
  if(!Object.prototype.hasOwnProperty.call(state,page.key)){
   const reader=(state as {[componentReaderKey]?:FormulaBindingContext['readComponent']})[componentReaderKey];
   if(reader){
    try{return reader(page.name,page.key);}
    catch(error){if(!/^Unknown component property/.test(error instanceof Error?error.message:''))throw error;}
   }
  }
 }
 const key=savedValueKey(page);
 if(key!==null){const value=state[key];
  if(value===undefined||value===null||['string','number','boolean'].includes(typeof value))return value;
  throw Error('Page value must be a scalar');
 }
 if(node.kind==='call'&&node.name==='ISBLANK'&&node.args.length===1)
  return blank(asState(node.args[0],state,sessionId));
 // Value-side IF, e.g. @Product.Category = IF(ISBLANK(@ThisPage.Tabs1.Selected.Id),"*",@ThisPage.Tabs1.Selected.Id).
 if(node.kind==='call'&&node.name==='IF'&&node.args.length===3){
  const condition=asState(node.args[0],state,sessionId);
  return asState(Boolean(condition)?node.args[1]:node.args[2],state,sessionId);
 }
 if(node.kind==='call'&&node.name==='NOT'&&node.args.length===1)
  return !Boolean(asState(node.args[0],state,sessionId));
 if(node.kind==='unary'&&node.operator==='NOT')return !Boolean(asState(node.value,state,sessionId));
 if(node.kind==='binary'){
  const left=asState(node.left,state,sessionId),right=asState(node.right,state,sessionId);
   const n=(v:unknown)=>typeof v==='number'?v:Number(v);
  switch(node.operator){
   case '=':case '==':return left===right;
   case '!=':case '<>':return left!==right;
   case 'AND':return Boolean(left)&&Boolean(right);
   case 'OR':return Boolean(left)||Boolean(right);
   case '>':return n(left)>n(right);
   case '>=':return n(left)>=n(right);
   case '<':return n(left)<n(right);
   case '<=':return n(left)<=n(right);
   case '+':return n(left)+n(right);
   case '-':return n(left)-n(right);
   case '*':return n(left)*n(right);
   case '/':return n(left)/n(right);
   case '&':return String(left??'')+String(right??'');
  }
 }
 if(node.kind==='unary'&&node.operator==='-'){
  const value=asState(node.value,state,sessionId);
  if(typeof value==='number')return -value;
 }
 // Value-side functions such as TODAY(), NOW(), WEEKDAY(TODAY()) or ADDDAYS(TODAY(),-30):
 // each argument is first resolved to a constant/state scalar (never a record field),
 // then the shared formula evaluator runs the function. The result is still sent to the
 // server as a plain filter value, so filtering stays server-side and permission-scoped.
 if(node.kind==='call'&&valueFunctions.has(node.name)&&node.args.length<=8){
  const values=node.args.map(arg=>asState(arg,state,sessionId));
  // The formula library function (same as converted page code). NOW()/TIMENOW() are read
  // at whole-minute precision so the filter (and the query) stays the same between renders.
  const run=(F as unknown as Record<string,(...args:unknown[])=>unknown>)[node.name];
  const entry=formulaEntry(node.name);
  if(node.name==='BLANKVALUE')return O.blank(values[0])?values[1]:values[0];
  if(typeof run!=='function'||!entry)throw Error('Unsupported filter function '+node.name);
  const clock={now:()=>new Date(Math.floor(Date.now()/60000)*60000),
   timeZone:()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'};
  return O.out(entry.clock?run(clock,...values):run(...values));
 }
 throw Error('IF condition must use constants or @ThisPage values (e.g. ISBLANK(@ThisPage.Tabs1.Selected.Id))');
};
const simpleField=(node:Expression,fields:ReadonlyArray<FieldMetadata>):FieldMetadata|null=>{
 if(node.kind!=='reference'||isPageReference(node.value))return null;
 // @Field or @Object.Field (the component's own Object): both name one field.
 // @Object.Lookup.Field: one hop through a lookup on this Object. The Record API
 // filters it server-side against the related record, with that record's access rules.
 const related=/^(?:[A-Za-z][A-Za-z0-9_]*\.)?([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(node.value);
 if(related&&!/^(?:state|event|session)\./i.test(node.value)&&node.value.split('.').length===3){
  const lookup=fields.find(f=>f.apiName===related[1]);
  if(lookup&&(lookup.relationship||/^(lookup|reference|master)/i.test(String(lookup.dataType))))
   return {apiName:related[1]+'.'+related[2],label:related[2],dataType:'Text'} as FieldMetadata;
 }
 const match=/^(?:[A-Za-z][A-Za-z0-9_]*\.)?([A-Za-z][A-Za-z0-9_]*)$/.exec(node.value);
 if(!match||/^(?:state|event|session)\./i.test(node.value))return null;
 // Id is the record's system ID column; the Record API filters it like any field.
 return fields.find(f=>f.apiName===match[1])
  ??(match[1]==='Id'?{apiName:'Id',label:'Record ID',dataType:'Text'} as FieldMetadata:null);
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
  // Neither side is a field: a pure page test such as @ThisPage.Tabs1.Selected.Id = "*".
  if(!field&&!simpleField(node.left,fields)){
   const truth=asState(node,state,sessionId);
   if(typeof truth==='boolean')return {truth,filters:[],logic:''};
  }
  if(!field||!op)throw Error('Formula comparisons require a direct readable @Field (e.g. @Product.Category) and an @ThisPage value or literal');
  // Numeric formula fields (e.g. stock = opening + purchased - sold) are compiled to SQL by the
  // server; other formula types still cannot be filtered there.
  const numericFormula=/^Formula\s*\(\s*(Number|Currency|Percent)\s*\)/i.test(field.dataType);
  if(!numericFormula&&/^Formula\s*\(/i.test(field.dataType)||/^(Geolocation|Address|EncryptedText)/i.test(field.dataType))
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
 const references=pageReferencesIn(formula);
 const keys=Array.from(new Set(references.map(savedValueKey).filter((key):key is string=>Boolean(key))));
 const published=Array.from(new Set(references.flatMap(item=>item.kind==='selected'?[item.name]:[])));
 if(keys.length+published.length>12)return 'Too many page value references';
 for(const selected of [false,true]){
  const picked=Object.fromEntries(published.map(name=>[name,{Id:'test-id',Name:'test',Value:'test-id',Text:'test',Field:'',Criteria:''}]));
  const state:Record<string,unknown>=selected?{...Object.fromEntries(keys.map(key=>[key,'test-id'])),collectionSelections:picked}:{};
  const result=compileRecordFilterFormula(formula,fields,{...state,[componentReaderKey]:()=>selected?'test-id':''});
  // Nothing picked yet is a runtime state, not a formula error: the formula
  // must still save (the page shows no rows until a value is picked).
  if(result.error&&!(!selected&&result.error==='Selected formula state value is empty'))return result.error;
 }
 return null;
}
