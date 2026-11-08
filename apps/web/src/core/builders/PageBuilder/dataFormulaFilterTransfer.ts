import type {FieldMetadata} from '../../metadata/Definitions/metadata';
import {validateRecordFilterFormula} from '../../pages/PageRuntime/recordFilterFormula';

/** Help a builder user move a predicate accidentally typed into the label
 * formula to the actual record filter, without POS- or component-specific logic.
 * This does not silently reinterpret arbitrary display formulas. */
export function displayComparisonFilter(
 expression:unknown, fields:ReadonlyArray<FieldMetadata>
):{formula:string;displayField:string}|null {
 if(typeof expression!=='string')return null;
 const source=expression.trim().replace(/^=\s*/,'');
 const match=/^(@[A-Za-z][A-Za-z0-9_]*)\s*(?:==|=|<=|>=|<|>)\s*(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|TRUE|FALSE|\$state\.[A-Za-z][A-Za-z0-9_]*)$/i.exec(source);
 if(!match||validateRecordFilterFormula(source,fields))return null;
 return {formula:source,displayField:match[1]};
}

/** Explicitly requested move only. Existing record filters are never overwritten. */
export function moveDisplayComparisonToFilter(
 properties:Readonly<Record<string,unknown>>,
 fields:ReadonlyArray<FieldMetadata>
):Record<string,unknown>|null {
 const comparison=displayComparisonFilter(properties.textSource,fields);
 if(!comparison)return null;
 const existing=typeof properties.filterFormula==='string'?properties.filterFormula.trim():'';
 if(existing&&existing!==comparison.formula)return null;
 const next:Record<string,unknown>={
  ...properties,
  textSource:comparison.displayField,
  filterFormula:comparison.formula
 };
 // An explicitly selected Field-only mode would suppress the new formula.
 // The legacy combined mode preserves every existing authored record condition.
 delete next.filterMode;
 return next;
}
