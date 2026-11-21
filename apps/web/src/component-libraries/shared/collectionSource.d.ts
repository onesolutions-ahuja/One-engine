import type {Expression} from '../../../../server/src/expression-engine/FormulaParser.js';
export type FormulaNamedCollection={name:string;items:unknown[]};
export function buildCollectionSource(
 formula:unknown,
 sources?:Readonly<Record<string,ReadonlyArray<Record<string,unknown>>>>,
 sourceFields?:Readonly<Record<string,ReadonlyArray<string>>>,
 value?:(node:Expression)=>unknown,
 namedCollections?:Readonly<Record<string,{name:string;items:unknown[]}>>
):{value:FormulaNamedCollection|null;error?:string};
