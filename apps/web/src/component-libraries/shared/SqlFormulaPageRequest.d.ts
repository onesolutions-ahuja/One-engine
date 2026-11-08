import type {FormulaBindingContext} from './FieldExpression.js';
export function evaluatePageActionSql(
 request:<T>(path:string,init?:RequestInit)=>Promise<T>,
 expression:string,payload:Record<string,unknown>,pageState:Readonly<Record<string,unknown>>,
 objectApi:string,recordId:unknown,fields:readonly string[],sessionId?:string,
 formulaContext?:Pick<FormulaBindingContext,
  'collectionSources'|'collectionSourceFields'|'collectionRows'|'namedCollections'|
  'namedCollectionSelections'|'readComponent'|'rootObjectApiName'>
):Promise<unknown>;
