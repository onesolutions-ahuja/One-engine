import {isActionPlan,splitServerDataActionPlan,PartialActionError,type ActionPlanTiming} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import type {FieldMetadata} from '../../metadata/Definitions/metadata';
import {executeActionFormula,evaluateFieldExpressionDetailed,type FormulaBindingContext} from '../../../component-libraries/shared/FieldExpression.js';
import {adjustNumberRecord,type AdjustNumberBinding} from './adjustNumberRecord';
import {evaluatePageActionSql} from '../../../component-libraries/shared/SqlFormulaPageRequest.js';
import {predictActionPlan,type Prediction} from './predictActionPlan';
export {evaluatePageActionSql};
export type {Prediction};

// Server saves from one browser run one at a time, in tap order: with instant
// feedback a cashier taps faster than a save returns, and two concurrent
// "quantity + 1" plans must not both read the same old quantity.
let saveQueue:Promise<unknown>=Promise.resolve();
function queuedSave<T>(run:()=>Promise<T>):Promise<T>{
 const next=saveQueue.then(run,run);
 saveQueue=next.catch(()=>undefined);
 return next;
}

// An action formula is parsed and split into its server part once, not on every tap.
// The result is a plain read-only {dataSteps,totalSteps}; the formula text is the key.
const splitCache=new Map<string,ReturnType<typeof splitServerDataActionPlan>>();
const planCache=new Map<string,boolean>();
function cachedSplit(formula:string):ReturnType<typeof splitServerDataActionPlan>{
 if(splitCache.has(formula))return splitCache.get(formula)!;
 const split=splitServerDataActionPlan(formula);
 if(splitCache.size>=200)splitCache.clear();
 splitCache.set(formula,split);
 return split;
}
function cachedIsActionPlan(formula:string):boolean{
 const known=planCache.get(formula);
 if(known!==undefined)return known;
 const result=isActionPlan(formula);
 if(planCache.size>=200)planCache.clear();
 planCache.set(formula,result);
 return result;
}

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Change={key:string;value:unknown};
/** Simple assignment target; RHS uses the existing shared expression engine.
 * The page runtime still owns navigation, filters, and the guarded Record API. */
export type {ActionFormulaAssignment} from '../../../../../server/src/page-compiler/pageCompilerSupport.js';
const fieldIdentifier=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Shared with the server-side page compiler. */
import {parseActionFormulaAssignment} from '../../../../../server/src/page-compiler/pageCompilerSupport.js';
export {parseActionFormulaAssignment};
export function resolveActionFormulaValue(expression:string,payload:Record<string,unknown>,
 pageState:Readonly<Record<string,unknown>>,sessionId=''):unknown{
 if(expression.length>300)throw Error('Action formula expression is too long.');
 const evaluated=evaluateFieldExpressionDetailed(expression,{
  state:pageState,event:payload,session:{id:sessionId}
 },{pageState,sessionId});
 if(evaluated.error)throw Error('Invalid action formula: '+evaluated.error);
 return evaluated.value;
}

/**
 * Universal no-code numeric Formula action: updates an authorised row via the
 * existing guarded Record API, or an explicit numeric Page State key. Never
 * evaluates JavaScript or bypasses OneEngine/tenant/record/field permissions.
 */
export async function executePageFormulaAction(
 request:Request,binding:Record<string,unknown>,payload:Record<string,unknown>,
 pageState:Readonly<Record<string,unknown>>,
 objects:ReadonlyArray<{apiName:string;fields:ReadonlyArray<FieldMetadata>}>,
 objectApiName:string,sessionId='',print?:(template:string,id:string)=>Promise<void>,
 runPageAction?:(name:string,target:string,mode?:string,recordId?:string)=>Promise<unknown>,
 createPdf?:(template:string,id:string)=>Promise<{FileId:string;AssetRef:string}>,
 /** Page data the action may read: TABLE()/COLLECTION() sources and $component values. */
 formulaContext:Pick<FormulaBindingContext,'namedCollections'|'collectionSources'|'readComponent'> & {timingName?:string}={},
 /** Show-first: receives the predicted saved records before the server answers. */
 onPredicted?:(prediction:Prediction)=>void,
 /** A compiled page action: the server runs ITS compiled copy (by component:event of
  * that saved revision) instead of formula text sent from the browser. */
 compiledAction?:{pageApiName:string;variant:string;revision:number;key:string;previewId?:string}
):Promise<{changes:Change[];recordChanged:boolean;mutatedObjectApiNames?:string[];
 recordChanges?:Array<{objectApiName:string;operation:'create'|'update'|'delete';record:Record<string,unknown>}>;
 predictionBatch?:string}>{
 const formula=String(binding.formula??'');
 if(cachedIsActionPlan(formula)){
  // Production diagnostics are disabled by default and scoped to this browser session.
  // Enable in DevTools: sessionStorage.setItem('metadrive:formula-timings','1')
  let timingEnabled=false;
  if(typeof window!=='undefined'){
   try{
    timingEnabled=window.sessionStorage.getItem('metadrive:formula-timings')==='1';
   }catch{/* Session storage may be disabled by the browser. */}
  }
  const timing=timingEnabled?{
   formulaName:formulaContext.timingName,
   onTiming:(sample:ActionPlanTiming)=>console.info('[FormulaTiming]',sample)
  }:{};
  const scope={...payload,state:pageState,event:payload,sessionId};
  const context={...formulaContext,pageState,sessionId,timeZone:'UTC',now:new Date()};
  const keepForeach=/\bFOREACH\s*\(/i.test(formula);
  const services={request,print,runPageAction,createPdf,...timing,useSqlAggregates:!keepForeach,
   sqlContext:keepForeach?undefined:{objectApi:objectApiName||undefined,
    recordId:typeof payload.recordId==='string'?payload.recordId:undefined,
    recordFields:objects.find(object=>object.apiName===objectApiName)?.fields.map(field=>field.apiName),
    state:pageState}};
  // Always attempt safe server-side CRUD. FOREACH remains in its existing runtime.
  const split=keepForeach?null:cachedSplit(formula);
  if(split){
   // Predict from held rows while the real save runs; never delay the save.
   let answered=false;
   // Browser-only suffix steps (STATE) run harmlessly in the prediction;
   // PRINT, SCREEN or Flows cannot be predicted and simply give no prediction.
   const prediction=onPredicted
    ?predictActionPlan(formula,scope,context).then(predicted=>{
      if(predicted&&!answered){onPredicted(predicted);return predicted;}
      return null;
     },()=>null)
    :Promise.resolve(null);
   type DataAnswer={
    supported:boolean;error?:string;changes?:Change[];recordChanged?:boolean;
    mutatedObjectApiNames?:string[];variables?:Record<string,unknown>;completedActionCount?:number;
    recordChanges?:Array<{objectApiName:string;operation:'create'|'update'|'delete';record:Record<string,unknown>}>
   };
   const first=await queuedSave(async()=>{
    if(compiledAction){
     // The server's compiled copy of this saved action; only "which action" + values are sent.
     const compiled=await request<DataAnswer>('/pages/'+encodeURIComponent(compiledAction.pageApiName)
      +'/compiled-actions/execute',{method:'POST',body:JSON.stringify({variant:compiledAction.variant,
       revision:compiledAction.revision,key:compiledAction.key,
       ...(compiledAction.previewId?{previewId:compiledAction.previewId}:{}),scope,dataSteps:split.dataSteps})});
     // Not this revision on the server (or server formulas off): the existing route answers.
     if(compiled.supported===true)return compiled;
    }
    return request<DataAnswer>('/action-formulas/execute-data',{
     method:'POST',body:JSON.stringify({formula,scope,dataSteps:split.dataSteps})});
   }).finally(()=>{answered=true;});
   const shown=await prediction;
   if(first.supported===true){
    if(first.error){
     // Earlier committed server writes must be reconciled, never replayed.
     if(first.recordChanged&&first.mutatedObjectApiNames?.length)
      throw new PartialActionError(first.error,first.mutatedObjectApiNames,first.completedActionCount??0);
     throw Error(first.error);
    }
    const data={changes:first.changes??[],recordChanged:first.recordChanged===true,
     mutatedObjectApiNames:first.mutatedObjectApiNames??[],recordChanges:first.recordChanges??[],
     predictionBatch:shown?.batch};
    if(split.dataSteps===split.totalSteps)return data;
    // Browser-only steps run after server transaction, in their authored order.
    let rest:Awaited<ReturnType<typeof executeActionFormula>>;
    try{
     rest=await executeActionFormula(formula,scope,context,{
      ...services,planWindow:{start:split.dataSteps,end:split.totalSteps,
       variables:first.variables??{},completedBefore:first.completedActionCount??0}
     });
    }catch(error){
     if(!data.recordChanged)throw error;
     // The server prefix has already committed; even a failed UI suffix must
     // reconcile those writes before the user retries the plan.
     const later=error instanceof PartialActionError?error.mutatedObjectApiNames:[];
     throw new PartialActionError(error instanceof Error?error.message:String(error),
      [...data.mutatedObjectApiNames,...later],first.completedActionCount??0);
    }
    return {changes:[...data.changes,...rest.changes],
     recordChanged:data.recordChanged||rest.recordChanged,
     mutatedObjectApiNames:[...new Set([...data.mutatedObjectApiNames,...rest.mutatedObjectApiNames])],
     recordChanges:data.recordChanges,predictionBatch:data.predictionBatch};
   }
  }
  // Unsupported SQL paths retain their existing authorised Record API execution.
  return executeActionFormula(formula,{...payload,state:pageState,event:payload},context,services);
 }
 if(!formula.trim()||formula.length>300)
  throw Error('Enter a valid action formula in the Actions ribbon.');
 const assignment=parseActionFormulaAssignment(formula);
 if(assignment){
  if(assignment.kind!=='state')throw Error('This assignment is handled by the page action runtime.');
  const value=await evaluatePageActionSql(request,assignment.value,payload,pageState,
   objectApiName,payload.recordId,
   objects.find(object=>object.apiName===objectApiName)?.fields.map(field=>field.apiName)??[],sessionId,{
    ...formulaContext,
    collectionSourceFields:Object.fromEntries(objects.map(object=>[
     object.apiName,object.fields.map(field=>field.apiName)])),
    namedCollectionSelections:(pageState as {collectionSelections?:Record<string,Record<string,unknown>>})
     .collectionSelections
   });
  return {changes:[{key:assignment.key,value}],recordChanged:false};
 }
 const refs=[...formula.matchAll(/@([A-Za-z][A-Za-z0-9_.]*)/g)].map(match=>match[1]);
 const metadata=objects.find(item=>item.apiName===objectApiName);
 const numeric=/^(Number|Currency|Percent|Integer|Decimal|Double|Float|Long|Short|Int)(\(|$)/i;
 const inferredField=refs.find(ref=>fieldIdentifier.test(ref)&&
   metadata?.fields.some(field=>field.apiName===ref&&numeric.test(field.dataType)));
 const recordTarget=String(binding.fieldApiName??inferredField??'');
 if(payload.recordId&&recordTarget){
  const delta=payload.delta===-1?-1:1;
  const config={...binding,fieldApiName:recordTarget,actionType:'AdjustNumber' as const,
    deltaSource:'$event.delta' as const,
    incrementFormula:formula,decrementFormula:formula};
  const changes=await adjustNumberRecord(request,config as AdjustNumberBinding,
    {...payload,delta},pageState,objects,objectApiName);
  return {changes,recordChanged:true,mutatedObjectApiNames:objectApiName?[objectApiName]:[]};
 }
 const key=String(binding.stateKey??refs.find(name=>
  fieldIdentifier.test(name)&&Object.prototype.hasOwnProperty.call(pageState,name))??'');
 if(!fieldIdentifier.test(key))
  throw Error('Formula requires an authorised record or a Page State key.');
 if(!refs.includes(key)||refs.some(name=>
  !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||
  !Object.prototype.hasOwnProperty.call(pageState,name)||
  typeof pageState[name]!=='number'||!Number.isFinite(pageState[name])))
  throw Error('Formula may only reference numeric Page State values.');
 const values=Object.fromEntries(refs.map(name=>[name,pageState[name]]));
 const result=evaluateFieldExpressionDetailed(formula,values);
 if(result.error||typeof result.value!=='string'||!result.value.trim()||
   !Number.isFinite(Number(result.value)))
  throw Error('Formula must return a finite number.');
 return {changes:[{key,value:Number(result.value)}],recordChanged:false};
}
