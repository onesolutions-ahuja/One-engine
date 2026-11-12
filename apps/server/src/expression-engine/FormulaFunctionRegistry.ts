import type {Expression} from './FormulaParser.js';
import {actionFormulaFunctions,formulaCategory,formulaAllowedInContext} from './FormulaCategories.js';

export type FormulaExpressionContext='formula_field'|'validation_rule'|'flow_formula'
  |'component_visibility'|'record_filter'|'ribbon_binding';
type FormulaValueKind='Any'|'Number'|'Text'|'Checkbox'|'Date'|'DateTime'|'Time'
  |'Picklist'|'MultiPicklist'|'Geolocation'|'Collection';
type FormulaFunctionParameter={name:string;type:FormulaValueKind;optional:boolean};
export type FormulaFunctionDefinition={
  name:string;
  signature:{
    parameters:readonly FormulaFunctionParameter[];
    minimumArguments:number;
    maximumArguments:number;
    returnType:FormulaValueKind;
  };
  allowedContexts:readonly FormulaExpressionContext[];
};
type DefinitionInput=[name:string,min:number,max:number,contexts?:readonly FormulaExpressionContext[]];

const serverContexts:readonly FormulaExpressionContext[]=['formula_field','validation_rule','flow_formula'];
const ribbonFunctions=new Set([
  'IF','IFERROR','AND','OR','NOT','ISBLANK','ISNULL','ISNUMBER',
  'BLANKVALUE','NULLVALUE','TEXT','VALUE','LEN','LOWER','UPPER','PROPER','CHAR',
  'LEFT','RIGHT','FIND','CONTAINS','BEGINS','ISPICKVAL','INCLUDES','ROUND',
  'ROUNDUP','ROUNDDOWN','MIN','MAX','DATE','DATEVALUE','TODAY','NOW',
  'DAY','MONTH','YEAR','HOUR','MINUTE','SECOND','WEEKDAY','ADDDAYS',
  'ADDMONTHS','TIMEVALUE','TIMENOW','GEOLOCATION','DISTANCE','COLLECTION','SUM','TABLE',
  'COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS','VERIFYPIN'
]);
const numberFunctions=new Set([
  'VALUE','LEN','COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS','SUM',
  'ROUND','ROUNDUP','ROUNDDOWN','MIN','MAX','DAY','MONTH','YEAR',
  'HOUR','MINUTE','SECOND','WEEKDAY','DISTANCE'
]);
const textFunctions=new Set([
  'TEXT','LEFT','RIGHT','LOWER','UPPER','PROPER','CHAR'
]);
const checkboxFunctions=new Set([
  'AND','OR','NOT','ISBLANK','ISNULL','ISNUMBER','CONTAINS','BEGINS',
  'ISPICKVAL','INCLUDES','VERIFYPIN','ISNEW','ISCHANGED'
]);
const explicitParameters=new Map<string,FormulaValueKind[]>([
  ['COLLECTION',['Text','Any']],['TABLE',['Collection','Any']],['SUM',['Collection']],['IF',['Checkbox','Any','Any']],['IFERROR',['Any','Any']],['NOT',['Checkbox']],
  ['AND',['Checkbox']],['OR',['Checkbox']],['VALUE',['Text']],
  ['LEN',['Text']],['CHAR',['Number']],['LEFT',['Text','Number']],['RIGHT',['Text','Number']],
  ['FIND',['Text','Text','Number']],
  
  ['CONTAINS',['Text','Text']],['BEGINS',['Text','Text']],['ISPICKVAL',['Picklist','Text']],
  ['INCLUDES',['MultiPicklist','Text']],

  ['ROUND',['Number','Number']],['ROUNDUP',['Number','Number']],
  ['ROUNDDOWN',['Number','Number']],
  
  ['DATE',['Number','Number','Number']],['ADDDAYS',['Date','Number']],
  ['ADDMONTHS',['Date','Number']],['DATEVALUE',['Text']],
  ['TIMEVALUE',['Text']],['GEOLOCATION',['Number','Number']],
  ['DISTANCE',['Geolocation','Geolocation','Text']]
]);
const returnType=(name:string):FormulaValueKind=>numberFunctions.has(name)?'Number':
  textFunctions.has(name)?'Text':checkboxFunctions.has(name)?'Checkbox':
    name==='DATE'||name==='TODAY'||name==='ADDDAYS'?'Date':
      name==='NOW'?'DateTime':
        name==='TIMENOW'||name==='TIMEVALUE'?'Time':
          name==='GEOLOCATION'?'Geolocation':['COLLECTION','TABLE'].includes(name)?'Collection':'Any';

const inputs:DefinitionInput[]=[
  ['IF',3,3],['IFERROR',2,2],['AND',1,20],['OR',1,20],['NOT',1,1],
  ['ISBLANK',1,1],['ISNULL',1,1],['ISNUMBER',1,1],
  
  ['BLANKVALUE',2,2],['NULLVALUE',2,2],['TEXT',1,1],['VALUE',1,1],['LEN',1,1],['CHAR',1,1],

  ['COLLECTION',2,20,['flow_formula','ribbon_binding']],
  ['TABLE',1,129,['ribbon_binding']],['SUM',1,1],
  ['LOWER',1,1],['UPPER',1,1],['PROPER',1,1],['LEFT',1,2],['RIGHT',1,2],
  ['FIND',2,3],
  ['CONTAINS',2,2],['BEGINS',2,2],['ISPICKVAL',2,2],['INCLUDES',2,2],

  ['ROUND',1,2],['ROUNDUP',1,2],['ROUNDDOWN',1,2],
  ['MIN',1,20],['MAX',1,20],
  
  ['DATE',3,3],['DATEVALUE',1,1],['TODAY',0,0],
  ['NOW',0,0],['DAY',1,1],['MONTH',1,1],['YEAR',1,1],['HOUR',1,1],['MINUTE',1,1],
  ['SECOND',1,1],['WEEKDAY',1,1],['ADDDAYS',2,2],
  ['ADDMONTHS',2,2],['TIMEVALUE',1,1],['TIMENOW',0,0],

  ['GEOLOCATION',2,2],['DISTANCE',3,3],
  // Server-side record count; evaluated by the action runtime only (ActionFormulas).
  ['COUNTIFS',3,41,['ribbon_binding']],
  // Record aggregates: (Object, ValueField, Field1, Value1, ...); action runtime only.
  ['SUMIFS',2,42,['ribbon_binding']],['AVERAGEIFS',2,42,['ribbon_binding']],
  ['MINIFS',2,42,['ribbon_binding']],['MAXIFS',2,42,['ribbon_binding']],
  // Server-side hashed PIN comparison: VERIFYPIN(Pin) or VERIFYPIN(UserId, Pin).
  ['VERIFYPIN',1,2,['ribbon_binding']],
  // Record save lifecycle; validation rules only (current and prior record).
  ['ISNEW',0,0,['validation_rule']],['ISCHANGED',1,1,['validation_rule']],
  ['PRIORVALUE',1,1,['validation_rule']]
];

const definitions=new Map<string,FormulaFunctionDefinition>();
for(const [name,minimumArguments,maximumArguments,contextOverride] of inputs){
  const allowedContexts=contextOverride??serverContexts;
  const declaredParameters=explicitParameters.get(name)??[];
  const parameters=Array.from({length:maximumArguments},(_,index)=>({
    name:name==='TABLE'?(index===0?'source':'column'+index):'argument'+(index+1),
    type:declaredParameters[index]??'Any' as const,
    optional:index>=minimumArguments
  }));
  definitions.set(name,Object.freeze({
    name,
    signature:Object.freeze({
      parameters:Object.freeze(parameters),minimumArguments,maximumArguments,returnType:returnType(name)
    }),
    allowedContexts:Object.freeze(ribbonFunctions.has(name)
      ?[...allowedContexts,'ribbon_binding' as const]:[...allowedContexts])
  }));
}

export const formulaFunctionCatalog:ReadonlyMap<string,FormulaFunctionDefinition>=definitions;
export const supportedFunctions:ReadonlySet<string>=new Set(definitions.keys());
export function getFormulaFunctionNames(context:FormulaExpressionContext):string[] {
  return [...definitions.values()].filter(definition=>definition.allowedContexts.includes(context))
    .map(definition=>definition.name);
}
/** Scope-specific completion: Action sees all functions; Data excludes
 * side effects; Universal is only the pure function family. */
export function getFormulaNamesForEditor(context:'action'|'data'|'universal'):string[] {
 const pureAndData=getFormulaFunctionNames('ribbon_binding');
 const allowed=pureAndData.filter(name=>formulaAllowedInContext(name,context));
 return context==='action'
  ?[...new Set([...allowed,...actionFormulaFunctions])]
  :context==='universal'?allowed.filter(name=>formulaCategory(name)==='universal'):allowed;
}
export function validateFormulaFunctions(expression:Expression,context:FormulaExpressionContext):void {
  const visit=(node:Expression):void=>{
    if(node.kind==='call'){
      const definition=definitions.get(node.name);
      if(!definition)throw new Error((context==='flow_formula'
        ?'Unsupported Flow formula function: ':'Unsupported formula function: ')+node.name);
      if(!definition.allowedContexts.includes(context)){
        const allowed=definition.allowedContexts.map(value=>value.replaceAll('_',' ')).join(', ');
        throw new Error('Formula function '+node.name+' is not available in '+context.replaceAll('_',' ')+
          ' context; supported contexts: '+allowed);
      }
      const {minimumArguments,maximumArguments}=definition.signature;
      if(node.args.length<minimumArguments||node.args.length>maximumArguments)
        throw new Error('Invalid argument count for '+node.name+
          ' (expected '+minimumArguments+'-'+maximumArguments+')');
      node.args.forEach(visit);
    }else if(node.kind==='unary')visit(node.value);
    else if(node.kind==='binary'){visit(node.left);visit(node.right);}
  };
  visit(expression);
}

/** Substring completion shared by Page, Flow and record-filter formula inputs. */
export function formulaFunctionPrefix(before:string){
 const match=/(?:^\s*=?\s*|[,(=+*/&<>-]\s*)([A-Za-z][A-Za-z0-9_]*)$/.exec(before);
 if(!match)return null;
 let quote='';
 for(let index=0;index<before.length;index++){
  const ch=before[index];
  if(quote&&ch==='\\'){index++;continue;}
  if(quote&&ch===quote){
   if(before[index+1]===quote){index++;continue;}
   quote='';
  }else if(!quote&&(ch==='"'||ch==="'"))quote=ch;
 }
 return quote?null:match[1];
}
export function matchingFormulaFunctions(names:readonly string[],query:string){
 const search=query.toUpperCase();
 return names.filter(name=>name.includes(search)).slice(0,12);
}
