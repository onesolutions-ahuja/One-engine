import {normalizeFlowCalls} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import {evaluateFieldExpressionDetailed} from '../../../component-libraries/shared/FieldExpression.js';
import {Parser,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';

/**
 * Action formula that chooses a Flow, e.g.
 *   $flow.TakePayment
 *   IF(AND($state.Total > 500, $state.Mode = "kiosk"), $flow.ApplePay, $flow.CardMachine)
 * Text, numbers, AND/OR and comparisons are allowed inside conditions. Every
 * RESULT branch must be a $flow reference or blank (blank = do nothing).
 * $flow exists only in the Action formula bar; normal formula bars reject it.
 * The chosen Flow still runs through the server Flow API, so RBAC applies.
 */
export const FLOW_FORMULA_PREFIX='$flow.';
const flowName=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
type FlowLike={apiName:string;status?:string;flowType?:string};

export function formulaFlowReferences(formula:string):string[]{
 try{
  const tree=normalizeFlowCalls(new Parser(tokenize(formula)).parse());
  return references(tree).filter(ref=>/^\$flow\./i.test(ref)).map(ref=>ref.slice(FLOW_FORMULA_PREFIX.length));
 }catch{return [];}
}
export const isFlowActionFormula=(formula:unknown):boolean=>{
 if(typeof formula!=='string'||!/(?:\$flow\.|\bFLOW\s*\()/i.test(formula))return false;
 try{
  const tree=normalizeFlowCalls(new Parser(tokenize(formula)).parse());
  return references(tree).some(ref=>/^\$flow\./i.test(ref));
 }catch{return true;}
};

/** Active Flows that a component event may run (same rule as the Flow dropdown). */
export const runnableActionFlows=<T extends FlowLike>(flows:readonly T[]):T[]=>
 flows.filter(flow=>flow.status==='Active'&&
  ['Autolaunched Flow','Screen Flow','In-Screen Flow'].includes(String(flow.flowType)));

const strip=(formula:string)=>formula.trim().replace(/^=\s*/,'');

/** The expressions whose value becomes the formula result (IF branches). */
function resultLeaves(node:Expression):Expression[]{
 if(node.kind==='call'){
  const args=node.args;
  if(node.name==='IF')return [...resultLeaves(args[1]??{kind:'literal',value:null}),
   ...resultLeaves(args[2]??{kind:'literal',value:null})];
 }
 return [node];
}
function references(node:Expression,into:string[]=[]):string[]{
 if(node.kind==='reference')into.push(node.value);
 else if(node.kind==='unary')references(node.value,into);
 else if(node.kind==='binary'){references(node.left,into);references(node.right,into);}
 else if(node.kind==='call')for(const arg of node.args)references(arg,into);
 return into;
}

/** Builder-time check. Returns a short message, or null when the formula is valid. */
export function validateFlowActionFormula(formula:string,flows:readonly FlowLike[]):string|null{
 const source=strip(formula);
 if(!source)return null;
 if(source.length>1000)return 'Action formula is too long';
 let tree:Expression;
 try{tree=normalizeFlowCalls(new Parser(tokenize(source)).parse());}
 catch(error){return error instanceof Error?error.message:'Incomplete formula';}
 const runnable=new Set(runnableActionFlows(flows).map(flow=>flow.apiName.toLowerCase()));
 for(const reference of references(tree)){
  if(!/^\$flow(?:\.|$)/i.test(reference))continue;
  const name=reference.slice(FLOW_FORMULA_PREFIX.length);
  if(!flowName.test(name))return 'Write a Flow as $flow.ApiName';
  if(!runnable.has(name.toLowerCase()))return 'Unknown or inactive Flow: '+name;
 }
 for(const leaf of resultLeaves(tree)){
  if(leaf.kind==='reference'&&/^\$flow\./i.test(leaf.value))continue;
  if(leaf.kind==='literal'&&(leaf.value===null||leaf.value===''))continue;
  return 'Each result must be a $flow (or "" to do nothing). Text is fine inside conditions.';
 }
 return null;
}

/**
 * Runtime: returns the Flow API name to run, '' to do nothing, or undefined when
 * the binding is not a $flow formula. Throws on an invalid formula or result.
 */
export function flowActionFormulaTarget(binding:Record<string,unknown>,eventValue:unknown,
 pageState:Readonly<Record<string,unknown>>,sessionId:string,flows:readonly FlowLike[]):string|undefined{
 if(binding.actionType!=='Formula'||!isFlowActionFormula(binding.formula))return undefined;
 const formula=String(binding.formula);
 const invalid=validateFlowActionFormula(formula,flows);
 if(invalid)throw Error(invalid);
 const runnable=runnableActionFlows(flows);
 const payload=eventValue&&typeof eventValue==='object'&&!Array.isArray(eventValue)
  ?eventValue as Record<string,unknown>:{value:eventValue};
 const evaluated=evaluateFieldExpressionDetailed('='+strip(formula),
  {state:pageState,event:payload,session:{id:sessionId}},
  {pageState,sessionId,flowReferences:runnable.map(flow=>flow.apiName)});
 if(evaluated.error)throw Error('Invalid action formula: '+evaluated.error);
 const result=String(evaluated.value??'').trim();
 if(!result)return '';
 if(!result.startsWith(FLOW_FORMULA_PREFIX))
  throw Error('The action formula must return a $flow.');
 const name=result.slice(FLOW_FORMULA_PREFIX.length);
 const flow=runnable.find(item=>item.apiName.toLowerCase()===name.toLowerCase());
 if(!flow)throw Error('Unknown or inactive Flow: '+name);
 return flow.apiName;
}
