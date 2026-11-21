import {evaluateFormulaBinary,evaluateFormulaUnary,formulaTruth,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {formulaScope,nodeFunction} from './formulaText';

/** Formula part of the PageHost contract used by a generated page script (older page files).
 * Each formula node is run as converted page code (the same converter as page code),
 * so a page file gives the same value as page code. Nothing here interprets formulas. */
export type ScriptFormulaContext={record:Record<string,unknown>;state:Readonly<Record<string,unknown>>;sessionId:string;
 objectApiName?:string;binding?:{rootObjectApiName?:string;readComponent?:(name:string,key:string)=>unknown}};
const run=(node:Expression,ctx:ScriptFormulaContext):unknown=>{
 const rowObject=ctx.binding?.rootObjectApiName??ctx.objectApiName??'';
 return nodeFunction(node,rowObject)(ctx.record??{},formulaScope({pageState:ctx.state,sessionId:ctx.sessionId,
  readComponent:ctx.binding?.readComponent,rowObject}));
};

export const scriptFormulaOperators={
 ref:(ctx:ScriptFormulaContext,path:string):unknown=>
  run({kind:'reference',value:path},ctx),
 truth:(value:unknown):boolean=>formulaTruth(value),
 bin:(operator:string,left:unknown,right:unknown):unknown=>evaluateFormulaBinary(operator,left,right),
 op:(operator:string,value:unknown):unknown=>evaluateFormulaUnary(operator,value)
};
export function scriptFormulaLibrary(nodes:readonly unknown[]){
 return {call(ctx:ScriptFormulaContext,_name:string,index:number):unknown{
  const node=nodes[index] as Expression|undefined;
  if(!node||node.kind!=='call')throw Error('Unknown compiled formula call '+index);
  return run(node,ctx);
 }};
}
