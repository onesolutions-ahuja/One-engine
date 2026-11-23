import {runComponentFormula} from "../shared/formulaCodeLookup.js";
import {disabledWhen,hiddenByShowWhen} from "../shared/showWhen.js";
import {LINE_ITEMS_PREVIEW,lineItemRows,lineItemSettings} from "./lineItems.mjs";

/** Smart Line Items: the item lines of a receipt, invoice or order slip.
 * Made for Print Templates: every record is shown at its natural height (no scrolling, no
 * selection, text wraps). In a Print Template the box grows or shrinks to fit its rows and
 * everything placed below it (totals, messages) moves down with it (see printTemplateFlow).
 * Data and formulas use the shared Core, like Smart Table and Smart Chart. */
const colour=(value,fallback)=>typeof value==="string"&&value?value:fallback;
const size=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Math.min(96,Number(value)):fallback;

export default function SmartComponent(p){
 if(hiddenByShowWhen(p))return <span data-smart-hidden="true" hidden/>;
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 const read=(key,row)=>{
  const source=p[key];
  if(typeof source!=="string"||!source.trim())return undefined;
  if(typeof p.fieldAllowed==="function"&&!p.fieldAllowed(key,row))return "";
  return runComponentFormula(p,source,row).value;
 };
 const designing=p.builderPreview===true||p.editing===true||p.designMode===true;
 const real=lineItemRows(records,read);
 const items=real.length||!designing?real:LINE_ITEMS_PREVIEW.map((item,index)=>({...item,id:"preview-"+index}));
 const sourceRows=new Map(records.map((row,index)=>[String(row?.Id??row?.id??index),row]));
 const settings=lineItemSettings(p);
 const textColour=colour(p.rowLabelColor,"#1d1d1f");
 const textSize=size(p.rowTextSize,13);
 const separator=settings.separator==="none"?undefined
  :"1px "+settings.separator+" "+colour(p.rowBorderColor,"#8e8e93");
 const heading=typeof p.label==="string"&&p.label.trim()&&!p.label.trim().startsWith("@")?p.label.trim():"";
 return <section className="smart-line-items" aria-label={heading||"Line items"} data-print-flow="true"
  data-builder-preview={designing?"true":undefined}
  style={{background:colour(p.backgroundColor,"transparent"),
   border:p.borderColor?"1px solid "+p.borderColor:undefined,
   borderRadius:size(p.radius,0),color:textColour,fontSize:textSize,
   boxShadow:p.shadow==='large'?'0 8px 20px #0003':p.shadow==='medium'?'0 3px 9px #0003':p.shadow==='small'?'0 1px 4px #0002':undefined,
   fontFamily:settings.monospace?"ui-monospace,SFMono-Regular,Menlo,Consolas,monospace":undefined}}>
  {heading&&<div className="smart-line-items-heading" data-design-area={designing?"Header":undefined}
   style={{color:colour(p.headerTextColor,textColour),fontSize:size(p.headerTextSize,textSize),
    fontWeight:p.headerBold===false?400:700}}>{heading}</div>}
  {items.map((item,index)=><div aria-disabled={disabledWhen(p,sourceRows.get(item.id),"itemDisabledWhen")||undefined} key={item.id} className="smart-line-items-row"
    data-design-area={designing&&index===0?"Row":undefined}
    style={{borderBottom:index<items.length-1?separator:undefined,fontWeight:settings.bold?700:undefined}}>
   <div className="smart-line-items-line">
    <span className="smart-line-items-text">{item.text}</span>
    {item.amount&&<span className="smart-line-items-amount">{item.amount}</span>}
   </div>
   {item.second&&<div className="smart-line-items-second">{item.second}</div>}
   {(item.extraText||item.extraAmount)&&<div className="smart-line-items-line smart-line-items-extra">
    <span className="smart-line-items-text">{item.extraText}</span>
    {item.extraAmount&&<span className="smart-line-items-amount">{item.extraAmount}</span>}
   </div>}
  </div>)}
  {!items.length&&designing&&<p className="smart-line-items-empty">Line items: choose an Items source</p>}
 </section>;
}
