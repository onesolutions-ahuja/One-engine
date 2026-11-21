import {runComponentFormula} from "../shared/formulaCodeLookup.js";
import SmartTable from "./SmartTable.jsx";
import {hiddenByShowWhen} from "../shared/showWhen.js";

/** Independent lazy-loaded renderer; formulas and actions use the shared Core. */
export default function SmartComponent(p){
 if(hiddenByShowWhen(p))return <span data-smart-hidden="true" hidden/>;
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 // Page code: the converted function for this column formula (rows of this table).
 const expression=(value,row)=>typeof value==='string'?runComponentFormula(p,value,row).value:value;
 const fire=(event,value)=>{
  if(p.previewOnly||p.builderPreview)return;
  if(typeof p.onAction==='function')
   void Promise.resolve(p.onAction({event,value})).catch(()=>{});
 };
 return <SmartTable p={p} records={records} expression={expression}
  fieldAllowed={p.fieldAllowed} fire={fire}/>;
}
