import {convertedFormula} from "../shared/formulaCodeLookup.js";
import SmartChart from "./SmartChart.jsx";
import {evaluateFieldExpression} from "../shared/FieldExpression.js";
import {hiddenByShowWhen} from "../shared/showWhen.js";

/** Independent lazy-loaded renderer; records, formulas and permissions use the shared Core. */
export default function SmartComponent(p){
 if(hiddenByShowWhen(p))return null;
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 // Page code first: the converted function for this column formula (rows of this table).
 const code=p.__formulaCode&&p.__formulaCode.functions instanceof Map?p.__formulaCode.functions:null;
 const converted=(value,row)=>{
  const run=code?convertedFormula(code,value):null;
  if(!run)return undefined;
  try{return {value:run(row||{})};}catch{return {value:''};}
 };
 const expression=(value,row)=>converted(value,row)?.value??(typeof value==='string'&&value
  ?evaluateFieldExpression(value,row,{
   readComponent:p.readComponent,rootObjectApiName:p.objectApiName,
   pageState:p.pageState,sessionId:p.sessionId,
   collectionSources:p.formulaCollectionSources,
   namedCollections:p.namedCollections,
   namedCollectionSelections:p.pageState?.collectionSelections
  }):undefined);
 const allowed=key=>row=>typeof p.fieldAllowed!=='function'||p.fieldAllowed(key,row);
 const labelAllowed=allowed('textSource'),valueAllowed=allowed('column2Source');
 // Label = Text Source; Value = Column 2 Source. Blank sources fall back to Name / Value fields.
 const labelOf=row=>labelAllowed(row)?(expression(p.textSource,row)??row?.Name??row?.Label):'';
 const valueOf=row=>valueAllowed(row)?(expression(p.column2Source,row)??row?.Value):0;
 return <SmartChart p={p} records={records} labelOf={labelOf} valueOf={valueOf}/>;
}
