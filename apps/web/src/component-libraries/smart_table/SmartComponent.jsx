import SmartTable from "./SmartTable.jsx";
import {evaluateFieldExpression} from "../shared/FieldExpression.js";

/** Independent lazy-loaded renderer; formulas and actions use the shared Core. */
export default function SmartComponent(p){
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 const expression=(value,row)=>typeof value==='string'
  ?evaluateFieldExpression(value,row,{
   readComponent:p.readComponent,rootObjectApiName:p.objectApiName,
   pageState:p.pageState,sessionId:p.sessionId,
   collectionSources:p.formulaCollectionSources,
   namedCollections:p.namedCollections,
   namedCollectionSelections:p.pageState?.collectionSelections
  }):value;
 const fire=(event,value)=>{
  if(p.previewOnly||p.builderPreview)return;
  if(typeof p.onAction==='function')
   void Promise.resolve(p.onAction({event,value})).catch(()=>{});
 };
 return <SmartTable p={p} records={records} expression={expression}
  fieldAllowed={p.fieldAllowed} fire={fire}/>;
}
