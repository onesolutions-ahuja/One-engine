/**
 * Every formula on a page must convert to page code: there is no other formula engine.
 *
 * Checks one saved page the way the server converts it (compilePage + buildPageCode),
 * plus the display texts a component may hold as a mention without "=" (`@Invoice.Total`,
 * `"£" & @Product.Price`), which the browser converts with the same converter at run time.
 * Used by scripts/check-page-formulas.mjs (every page of a site) and the CI test.
 */
import {compilePage,type CompilerObject,type CompilerPage} from '../compilePage.js';
import {buildPageCode} from './pageCode.js';
import {compileDisplayFormula} from './generateCode.js';
import {modernizeFormula} from '../../expression-engine/PageReferences.js';

export type PageFormulaIssue={page:string;componentId:string;where:string;source:string;error:string};

/** Display texts converted at run time when they are not "=" formulas (labels, row values). */
const RUNTIME_TEXT=/^(?:textSource|label|imageSource|badgeText|placeholder|column\d*Source|visibleFormula|disabledFormula)$/;
const isFormulaShaped=(text:string)=>/@[A-Za-z]/.test(text)&&!/^\s*=/.test(text)
 // A bare @Object (a data source) is not a display value.
 &&!/^\s*@[A-Za-z][A-Za-z0-9_]*\s*$/.test(text)
 // Plain e-mail addresses are values.
 &&!/^\s*[^\s@=(),"&]+@[^\s@]+\.[^\s@]+\s*$/.test(text);

export function checkPageFormulas(page:CompilerPage,objects:readonly CompilerObject[]):PageFormulaIssue[]{
 const name=String((page as {apiName?:unknown}).apiName??'');
 const issues:PageFormulaIssue[]=[];
 let compiled:ReturnType<typeof compilePage>;
 try{compiled=compilePage(page,objects,{strictLegacy:true});}
 catch(error){return [{page:name,componentId:'',where:'page',source:'',error:error instanceof Error?error.message:String(error)}];}
 const code=buildPageCode(compiled);
 for(const issue of code.issues)issues.push({page:name,...issue});
 for(const component of compiled.components){
  const properties=((page as {components?:Array<{id?:string;properties?:Record<string,unknown>}>}).components??[])
   .find(item=>item.id===component.id)?.properties??{};
  for(const [key,value] of Object.entries(properties)){
   if(!RUNTIME_TEXT.test(key)||typeof value!=='string'||!isFormulaShaped(value))continue;
   try{compileDisplayFormula(modernizeFormula('='+value.trim()),component.objectApiName??'');}
   catch(error){issues.push({page:name,componentId:component.id,where:key,source:value,
    error:error instanceof Error?error.message:String(error)});}
  }
 }
 return issues;
}
