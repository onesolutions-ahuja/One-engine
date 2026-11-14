import SmartChart from "./SmartChart.jsx";
import {evaluateFieldExpression} from "../shared/FieldExpression.js";

/** Independent lazy-loaded renderer; records, formulas and permissions use the shared Core. */
export default function SmartComponent(p){
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 const expression=(value,row)=>typeof value==='string'&&value
  ?evaluateFieldExpression(value,row,{
   readComponent:p.readComponent,rootObjectApiName:p.objectApiName,
   pageState:p.pageState,sessionId:p.sessionId,
   collectionSources:p.formulaCollectionSources,
   namedCollections:p.namedCollections,
   namedCollectionSelections:p.pageState?.collectionSelections
  }):undefined;
 const allowed=key=>row=>typeof p.fieldAllowed!=='function'||p.fieldAllowed(key,row);
 const labelAllowed=allowed('textSource'),valueAllowed=allowed('column2Source');
 // Label = Text Source; Value = Column 2 Source. Blank sources fall back to Name / Value fields.
 const labelOf=row=>labelAllowed(row)?(expression(p.textSource,row)??row?.Name??row?.Label):'';
 const valueOf=row=>valueAllowed(row)?(expression(p.column2Source,row)??row?.Value):0;
 return <SmartChart p={p} records={records} labelOf={labelOf} valueOf={valueOf}/>;
}
