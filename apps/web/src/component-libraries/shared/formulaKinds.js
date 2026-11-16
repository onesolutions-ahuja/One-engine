import {Parser} from '../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../server/src/expression-engine/FormulaTokenizer.js';
import {SQL_QUERY_FORMULAS,SQL_RECORD_AGGREGATES} from '../../../../server/src/expression-engine/FormulaCategories.js';

// Formula text classifiers (no evaluation, no requests): every page formula runs as
// the page's converted code; these only describe what a formula reads.
// Only query formulas (aggregates, SUM) need the server. A display formula made
// only of logical/scalar functions (=ROUND(@Price,2), =IF(...), =UPPER(@Name))
// is evaluated locally, so a 100-card grid costs zero formula requests.
const hasSql=node=>node.kind==='call'
 ?SQL_QUERY_FORMULAS.has(node.name)||node.args.some(hasSql)
 :node.kind==='binary'?hasSql(node.left)||hasSql(node.right)
 :node.kind==='unary'?hasSql(node.value):false;

/** Detect query functions by the shared parser; literal content is never sent as a query.
 * Called for every property on every render, so the parse result is memoised. */
const selectedCache=new Map();
export function isSelectedSqlFormula(value){
 if(typeof value!=='string'||value.length>4000)return false;
 const cached=selectedCache.get(value);
 if(cached!==undefined)return cached;
 let result=false;
 try{result=hasSql(new Parser(tokenize(value)).parse());}catch{result=false;}
 if(selectedCache.size>1000)selectedCache.clear();
 selectedCache.set(value,result);
 return result;
}

/** A formula that never reads the current row (session totals, cart sums, counts) has
 * ONE answer for every row. Asking once per row turned a 97-line cart into 97 identical
 * queries per formula. Aggregate object/field names are metadata, not row references;
 * only criterion VALUES, plain fields, Id and $event values depend on the row. */
const independentCache=new Map();
const dependsOnRow=node=>{
 if(node.kind==='reference'){
  const name=node.value;
  return !name.startsWith('$')||name.startsWith('$event.');
 }
 if(node.kind==='call'){
  if(SQL_RECORD_AGGREGATES.has(node.name)){
   const criteria=node.args.slice(node.name==='COUNTIFS'?1:2);
   return criteria.some((arg,index)=>index%2===1&&dependsOnRow(arg));
  }
  if(node.name==='SUM'&&node.args[0]?.kind==='reference')return false;
  return node.args.some(dependsOnRow);
 }
 if(node.kind==='unary')return dependsOnRow(node.value);
 if(node.kind==='binary')return dependsOnRow(node.left)||dependsOnRow(node.right);
 return false;
};
export function isRowIndependentFormula(value){
 if(typeof value!=='string'||value.length>4000)return false;
 if(independentCache.has(value))return independentCache.get(value);
 let result=false;
 try{result=!dependsOnRow(new Parser(tokenize(value)).parse());}catch{result=false;}
 if(independentCache.size>500)independentCache.clear();
 independentCache.set(value,result);
 return result;
}


/** Objects a formula aggregates over (COUNTIFS(CartLine,...), SUMIFS(Cart,...)). A write to one of
 * these changes the answer even when no row, state or session value on the page changed.
 * Row-field formulas are driven by their (reloaded) rows and need no mutation signal. */
const aggregateCache=new Map();
const collectAggregateObjects=(node,found)=>{
 if(node.kind==='call'){
  if(SQL_RECORD_AGGREGATES.has(node.name)){
   const source=node.args[0];
   if(source&&(source.kind==='reference'||source.kind==='literal')&&typeof source.value==='string')
    found.add(source.value);
  }
  node.args.forEach(arg=>collectAggregateObjects(arg,found));
 }else if(node.kind==='unary')collectAggregateObjects(node.value,found);
 else if(node.kind==='binary'){collectAggregateObjects(node.left,found);collectAggregateObjects(node.right,found);}
};
