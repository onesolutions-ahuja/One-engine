/** One Formula Engine with context-aware categories, not duplicate evaluators. */
import type {Expression} from './FormulaParser.js';
import {ACTION_FORMULA_FUNCTIONS} from './FormulaActions.js';
import {DATA_FORMULA_FUNCTIONS} from './FormulaData.js';
import {UNIVERSAL_FORMULA_FUNCTIONS} from './FormulaUniversal.js';
export const actionFormulaFunctions=Object.freeze([...ACTION_FORMULA_FUNCTIONS]);
export const dataFormulaFunctions=Object.freeze([...DATA_FORMULA_FUNCTIONS]);
export const universalFormulaFunctions=UNIVERSAL_FORMULA_FUNCTIONS;
export type FormulaCategory='action'|'data'|'universal';
export function formulaCategory(name:string):FormulaCategory{
 const upper=name.toUpperCase();
 if(ACTION_FORMULA_FUNCTIONS.has(upper))return 'action';
 if(DATA_FORMULA_FUNCTIONS.has(upper))return 'data';
 return 'universal';
}
/** Data binding never performs side effects; action triggers can use all 3 groups. */
export function formulaAllowedInContext(name:string,context:'action'|'data'|'universal'):boolean{
 const type=formulaCategory(name);
 return context==='action'||type!=='action'&&(context==='data'||type==='universal');
}

export const SQL_SCALAR_FORMULAS:ReadonlySet<string>=new Set([
 'ISBLANK','ISNULL','ISNUMBER','TEXT','VALUE','LEN','LOWER','UPPER','PROPER','CHAR',
 'LEFT','RIGHT','FIND','CONTAINS','BEGINS','ISPICKVAL','INCLUDES',
 'ROUND','ROUNDUP','ROUNDDOWN','MIN','MAX','DATE','DATEVALUE','TODAY','NOW',
 'DAY','MONTH','YEAR','HOUR','MINUTE','SECOND','WEEKDAY',
 'ADDDAYS','ADDMONTHS','TIMEVALUE','TIMENOW','GEOLOCATION','DISTANCE','SUM'
]);
export const SQL_RECORD_AGGREGATES:ReadonlySet<string>=new Set([
 'COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS'
]);
/** Query formulas: the only display functions that must read the database.
 * Logical/scalar functions (IF, ROUND, TEXT, UPPER, dates...) run in the browser
 * on rows the Page runtime already loaded through RBAC, so they cost no request. */
export const SQL_QUERY_FORMULAS:ReadonlySet<string>=new Set([...SQL_RECORD_AGGREGATES,'SUM']);

/** Rebuild a validated AST for server-side SQL decoding without executing code.
 * Literal strings use the existing Formula Tokenizer's doubled-quote syntax. */
export function serializeFormulaSqlExpression(node:Expression):string {
 if(node.kind==='literal'){
  if(node.value===null)return 'NULL';
  if(typeof node.value==='string')return '"'+node.value.replaceAll('"','""')+'"';
  return String(node.value).toUpperCase();
 }
 if(node.kind==='reference'){
  if(!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(node.value))
   throw Error('Invalid SQL Formula reference');
  return node.value;
 }
 if(node.kind==='unary')return '('+node.operator+' '+serializeFormulaSqlExpression(node.value)+')';
 if(node.kind==='binary')return '('+serializeFormulaSqlExpression(node.left)+' '+
   node.operator+' '+serializeFormulaSqlExpression(node.right)+')';
 return node.name+'('+node.args.map(serializeFormulaSqlExpression).join(',')+')';
}
