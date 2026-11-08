import {Parser} from '../../../../../server/src/expression-engine/FormulaParser.js';
import type {FieldMetadata} from '../../metadata/Definitions/metadata';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {matchesFormulaCollectionCriterion} from '../../../../../server/src/expression-engine/FormulaCollection.js';

/** Pure, context-sensitive record list binding for metadata fields that supply
 * collections. An ordinary scalar/Boolean formula remains a scalar elsewhere. */
export type CollectionListBinding={object:string;field:string;criterion:string;operator:string};
/** Generic metadata for filtering the already-authorised items of a session
 * collection. This is not a SQL Object and must never trigger a data query. */
export const sessionCollectionFields:ReadonlyArray<FieldMetadata>=[
 {apiName:'Name',label:'Caption',dataType:'Text'} as FieldMetadata,
 {apiName:'Value',label:'Value',dataType:'Text'} as FieldMetadata
];
export function parseCollectionListBinding(source:string,primaryObject:string):CollectionListBinding|null{
 const input=source.trim().replace(/^=\s*/,'');
 if(!input.startsWith('@'))return null;
 try{
  const node=new Parser(tokenize(input)).parse();
  if(node.kind!=='binary'||!['=','==','<>','!=','>','>=','<','<='].includes(node.operator)
    ||node.left.kind!=='reference'||node.right.kind!=='literal'
    ||!['string','number','boolean'].includes(typeof node.right.value))return null;
  const parts=node.left.value.split('.');
  if(parts.length>2||parts.some(part=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(part)))return null;
  const object=parts.length===2?parts[0]:primaryObject;
  return {object,field:parts.at(-1)!,criterion:String(node.right.value),operator:node.operator};
 }catch{return null;}
}
/** No source access happens here. Rows must already be authorised and complete. */
export function filteredCollectionItems(
 binding:CollectionListBinding,rows:readonly Record<string,unknown>[]
):Array<{label:string;value:string;criteriaField:string;criteria:string;record:Record<string,unknown>}>{
 const out:Array<{label:string;value:string;criteriaField:string;criteria:string;record:Record<string,unknown>}>=[];
 for(const row of rows){
  if(!Object.prototype.hasOwnProperty.call(row,binding.field))continue;
  const value=row[binding.field];
  if(value===null||value===undefined||String(value).trim()==='')continue;
  const criterion=['<>','!=','>','>=','<','<='].includes(binding.operator)
   ?binding.operator+binding.criterion:binding.criterion;
  const matched=matchesFormulaCollectionCriterion(value,criterion);
  if(!matched)continue;
  out.push({label:String(value),value:String(row.Id??row.id??''),
    criteriaField:typeof row.__collectionCriteriaField==='string'&&row.__collectionCriteriaField
     ?row.__collectionCriteriaField:binding.object+'.'+binding.field,
    criteria:typeof row.__collectionCriteria==='string'&&row.__collectionCriteria
     ?row.__collectionCriteria:String(value),record:row});
 }
 return out;
}
