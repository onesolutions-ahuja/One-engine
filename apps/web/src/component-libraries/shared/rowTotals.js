import {Parser} from '../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../server/src/expression-engine/FormulaTokenizer.js';

/**
 * SUM over the rows a list shows (a cart summary: SUM(@CartLine.Price * @CartLine.Quantity)).
 *
 * Each SUM(...) whose value reads the row is worked out by running its converted page code
 * function on every loaded row; the formula around it then runs as page code with that
 * total in place. Nothing here interprets formulas. Only a COMPLETE, bounded set of rows
 * (all of the list, at most 200) is summed: a partial page never shows a misleading total.
 * Returns null when the formula has no such SUM.
 */
const rowRead=node=>node.kind==='reference'?!/^This(?:Page|Tenant)\./.test(node.value)&&node.value.includes('.')
 :node.kind==='unary'?rowRead(node.value):node.kind==='binary'?rowRead(node.left)||rowRead(node.right)
 :node.kind==='call'&&node.name!=='SUM'?node.args.some(rowRead):false;
const cache=new Map();
function parsed(formula){
 if(cache.has(formula))return cache.get(formula);
 let tree=null;
 try{tree=new Parser(tokenize(formula.trim().replace(/^=\s*/,''))).parse();}catch{tree=null;}
 if(cache.size>500)cache.clear();
 cache.set(formula,tree);
 return tree;
}
const hasRowSum=node=>node.kind==='call'?(node.name==='SUM'&&node.args.length===1&&rowRead(node.args[0]))||node.args.some(hasRowSum)
 :node.kind==='binary'?hasRowSum(node.left)||hasRowSum(node.right):node.kind==='unary'?hasRowSum(node.value):false;
export function hasRowTotals(formula){
 const tree=typeof formula==='string'&&/\bSUM\s*\(/i.test(formula)?parsed(formula):null;
 return Boolean(tree&&hasRowSum(tree));
}
/** `compileNode(node)` -> `(row) => value`: the page's converter. */
export function withRowTotals(formula,rows,compileNode){
 const tree=typeof formula==='string'&&/\bSUM\s*\(/i.test(formula)?parsed(formula):null;
 if(!tree||!hasRowSum(tree))return null;
 const total=arg=>{
  if(!Array.isArray(rows)||rows.length>200)throw Error('SUM requires a bounded numeric collection');
  const run=compileNode(arg);
  let sum=0;
  for(const row of rows){
   const value=run(row||{});
   if(value===''||value===null||value===undefined)continue;
   const number=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
   if(!Number.isFinite(number))throw Error('SUM requires finite numeric collection values');
   sum+=number;
  }
  if(!Number.isFinite(sum))throw Error('SUM result must be finite');
  return Math.round(sum*1e9)/1e9;
 };
 const swap=node=>{
  if(node.kind==='call'){
   if(node.name==='SUM'&&node.args.length===1&&rowRead(node.args[0]))return {kind:'literal',value:total(node.args[0])};
   return {...node,args:node.args.map(swap)};
  }
  if(node.kind==='binary')return {...node,left:swap(node.left),right:swap(node.right)};
  if(node.kind==='unary')return {...node,value:swap(node.value)};
  return node;
 };
 return compileNode(swap(tree));
}
