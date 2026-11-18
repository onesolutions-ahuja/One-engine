import {convertedFormula} from "./formulaCodeLookup.js";
import {evaluateFieldExpression} from "./FieldExpression.js";

/** "Show when" (visibleFormula) for renderers that do not go through SmartRuntime.
 * Blank always shows; FALSE, 0 or blank text hides at runtime. The builder always shows it. */
export function hiddenByShowWhen(p,row={}){
 const formula=p.visibleFormula;
 if(typeof formula!=="string"||!formula.trim()||p.builderPreview||p.designMode)return false;
 const code=p.__formulaCode&&p.__formulaCode.functions instanceof Map?p.__formulaCode.functions:null;
 const run=code?convertedFormula(code,formula):null;
 let shown;
 try{
  shown=run?run(row||{}):evaluateFieldExpression(formula,row||{},{
   readComponent:p.readComponent,rootObjectApiName:p.objectApiName,
   pageState:p.pageState,sessionId:p.sessionId,
   collectionSources:p.formulaCollectionSources,namedCollections:p.namedCollections,
   namedCollectionSelections:p.pageState?.collectionSelections});
 }catch{return true;}
 return shown===false||shown===0||shown===null||shown===undefined||String(shown).trim()===""
  ||String(shown).toUpperCase()==="FALSE"||String(shown)==="0"||shown==="FORMULAERROR";
}
