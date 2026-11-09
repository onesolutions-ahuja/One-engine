import {evaluateFormulaBinary,evaluateFormulaUnary,formulaTruth,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {evaluateParsedExpression,type FormulaBindingContext} from '../../../component-libraries/shared/FieldExpression.js';

/** Formula part of the PageHost contract used by a generated page script.
 * Library functions run the shared Une catalogue, so a compiled formula gives
 * the same value as the interpreter. Nothing here evaluates JavaScript text. */
export type ScriptFormulaContext={record:Record<string,unknown>;state:Readonly<Record<string,unknown>>;sessionId:string;
 objectApiName?:string;
 binding?:Omit<FormulaBindingContext,'pageState'|'sessionId'>};
const bindingOf=(ctx:ScriptFormulaContext):FormulaBindingContext=>({...(ctx.binding??{}),
 rootObjectApiName:ctx.binding?.rootObjectApiName??ctx.objectApiName,
 pageState:ctx.state,sessionId:ctx.sessionId});

export const scriptFormulaOperators={
 ref:(ctx:ScriptFormulaContext,path:string):unknown=>
  evaluateParsedExpression({kind:'reference',value:path},ctx.record,bindingOf(ctx)),
 truth:(value:unknown):boolean=>formulaTruth(value),
 bin:(operator:string,left:unknown,right:unknown):unknown=>evaluateFormulaBinary(operator,left,right),
 op:(operator:string,value:unknown):unknown=>evaluateFormulaUnary(operator,value)
};
export function scriptFormulaLibrary(nodes:readonly unknown[]){
 return {call(ctx:ScriptFormulaContext,_name:string,index:number):unknown{
  const node=nodes[index] as Expression|undefined;
  if(!node||node.kind!=='call')throw Error('Unknown compiled formula call '+index);
  return evaluateParsedExpression(node,ctx.record,bindingOf(ctx));
 }};
}
