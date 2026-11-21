import {componentFormula} from "./formulaCodeLookup.js";

/** "Show when" (visibleFormula) for renderers that do not go through SmartRuntime.
 * Blank always shows; FALSE, 0 or blank text hides at runtime. The builder always shows it. */
export function hiddenByShowWhen(p,row={}){
 const formula=p.visibleFormula;
 if(formula===undefined||formula===null||p.builderPreview||p.designMode)return false;
 // Page code may already have run it (a total such as COUNTIFS): then it is TRUE/FALSE/0.
 if(typeof formula!=="string")return formula===false||formula===0;
 if(!formula.trim())return false;
 let shown;
 try{
  // The page code function (page file, or converted by the host with the same converter).
  const run=componentFormula(p,formula);
  shown=run?run(row||{}):formula;
 }catch(error){
  // A total still loading: keep showing until it arrives.
  return error&&error.notHeld===true?false:true;
 }
 return shown===false||shown===0||shown===null||shown===undefined||String(shown).trim()===""
  ||String(shown).toUpperCase()==="FALSE"||String(shown)==="0"||shown==="FORMULAERROR";
}
