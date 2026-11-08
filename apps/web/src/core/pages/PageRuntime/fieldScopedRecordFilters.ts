import type {FieldMetadata} from '../../metadata/Definitions/metadata';
import {compileRecordFilterFormula} from './recordFilterFormula';
import {comparePageFilterValue,filterPageComponentRecords,type PageFilterContext} from './pageComponentBindings';

/** Optional field-specific visibility rules stored beside a component's existing
 * global record filters. They NEVER widen a server record query. Rules apply only
 * to the chosen output value after the normal tenant/RBAC-gated record retrieval.
 * An invalid configured rule fails closed for that output.
 */
export type ScopedFieldFilter={filters:unknown[];filterLogic:'AND'|'OR';filterFormula:string;filterMode?:'Field'|'Formula'};
export const isScopedFieldFilter=(input:unknown):input is ScopedFieldFilter=>{
 if(!input||typeof input!=='object'||Array.isArray(input))return false;
 const rule=input as Record<string,unknown>;
 return Array.isArray(rule.filters)&&rule.filters.length<=20
  &&(rule.filterLogic==='AND'||rule.filterLogic==='OR')
  &&typeof rule.filterFormula==='string'&&rule.filterFormula.length<=4000
  &&(rule.filterMode===undefined||rule.filterMode==='Field'||rule.filterMode==='Formula');
};
export function scopedFieldRule(collection:unknown,key:string):ScopedFieldFilter|undefined{
 if(!collection||typeof collection!=='object'||Array.isArray(collection))return undefined;
 if(!Object.prototype.hasOwnProperty.call(collection,key))return undefined;
 const raw=(collection as Record<string,unknown>)[key];
 return isScopedFieldFilter(raw)?raw:undefined;
}
/** Evaluate a compiled, bounded AND/OR expression without eval or scripts. */
function matchesCompiledLogic(expression:string,values:boolean[]):boolean{
 if(values.length===0)return true;
 const tokens=expression.match(/\(|\)|\bAND\b|\bOR\b|\b\d+\b/g)??[];
 if(!tokens.length||tokens.join('').length!==expression.replace(/\s/g,'').length)return false;
 let index=0;
 const atom=():boolean=>{
  const token=tokens[index++];
  if(token==='('){const result=or();if(tokens[index++]!==')')throw Error('Unclosed predicate');return result;}
  const position=Number(token);
  if(!Number.isInteger(position)||position<1||position>values.length)throw Error('Invalid predicate');
  return values[position-1];
 };
 const and=():boolean=>{let value=atom();while(tokens[index]==='AND'){index++;const rhs=atom();value=value&&rhs;}return value;};
 const or=():boolean=>{let value=and();while(tokens[index]==='OR'){index++;const rhs=and();value=value||rhs;}return value;};
 try{const result=or();return index===tokens.length&&result;}catch{return false;}
}
const names:Record<string,string>={
 eq:'Equals',ne:'Not Equals',contains:'Contains',gt:'Greater Than',
 gte:'Greater Than or Equal',lt:'Less Than',lte:'Less Than or Equal',
 isBlank:'Is Blank',isNotBlank:'Is Not Blank',includes:'Includes',excludes:'Excludes'
};
export function scopedFieldAllows(collection:unknown,key:string,record:Record<string,unknown>,
 fields:ReadonlyArray<FieldMetadata>,context:PageFilterContext={}):boolean{
 if(!collection||typeof collection!=='object'||Array.isArray(collection))return true;
 if(!Object.prototype.hasOwnProperty.call(collection,key))return true;
 const rule=scopedFieldRule(collection,key);
 if(!rule||!record||typeof record!=='object'||Array.isArray(record))return false;
 if(rule.filterMode!=='Formula'&&rule.filters.length
   &&filterPageComponentRecords([record],rule.filters,fields,context,rule.filterLogic).length===0)
  return false;
 if(rule.filterMode==='Field'||!rule.filterFormula.trim())return true;
 const compiled=compileRecordFilterFormula(rule.filterFormula,fields,context.pageState??{});
 if(compiled.blocked)return false;
 if(compiled.filters.length===0)return true;
 const matches=compiled.filters.map(f=>{
  const metadata=fields.find(field=>field.apiName===f.field);
  return Boolean(metadata&&Object.prototype.hasOwnProperty.call(record,f.field)
    &&names[f.operator]&&comparePageFilterValue(record[f.field],names[f.operator],f.value,metadata));
 });
 return matchesCompiledLogic(compiled.filterLogic??matches.map((_,i)=>String(i+1)).join(' AND '),matches);
}
