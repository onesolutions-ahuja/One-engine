/** Smart Line Items: pure helpers (no React), shared by the renderer and its tests.
 *
 * One row per record, every row shown (nothing scrolls, nothing is cut off), laid out like a
 * receipt line instead of table columns:
 *   Item text ............................ Amount     (Text Source / Column 2 Source)
 *     Second line (modifiers, notes)                   (Column 3 Source, hidden when blank)
 *     Extra line text ............... Extra amount     (Column 4 / 5 Source, hidden when blank)
 */

/** Builder preview rows, shown only while the template has no data. */
export const LINE_ITEMS_PREVIEW=[
 {text:"2 x Example item",amount:"£10.98",second:"No onions · Extra cheese",extraText:"Discount 10%",extraAmount:"-£1.10"},
 {text:"1 x Another item",amount:"£2.50",second:"",extraText:"",extraAmount:""}
];
export const LINE_ITEM_SEPARATORS=["dashed","solid","dotted","none"];

const blank=value=>value===undefined||value===null||String(value).trim()==="";
/** Text for a value: numbers get 2 decimals (money); everything else as written by the formula. */
export function lineText(value){
 if(blank(value))return "";
 if(typeof value==="number")return Number.isFinite(value)?value.toFixed(2):"";
 if(typeof value==="boolean")return value?"Yes":"No";
 return String(value);
}
/** Builder settings, defaulting safely. */
export function lineItemSettings(p){
 const separator=LINE_ITEM_SEPARATORS.includes(p?.lineItemsSeparator)?p.lineItemsSeparator:"dashed";
 return {separator,monospace:p?.lineItemsFont==="monospace",bold:p?.rowBold===true};
}
/** Read every row through `read(key,row)` (formula or field value); blank Item text falls back to
 * the record's Name and a blank Amount to LineTotal / Total / Amount. Rows with nothing to show are skipped. */
export function lineItemRows(records,read){
 const rows=Array.isArray(records)?records:[];
 const out=[];
 rows.forEach((row,index)=>{
  if(!row||typeof row!=="object")return;
  const value=(key,...fallbacks)=>{
   const own=read(key,row);
   if(!blank(own))return lineText(own);
   for(const field of fallbacks)if(!blank(row[field]))return lineText(row[field]);
   return "";
  };
  const item={
   id:String(row.Id??row.id??index),
   text:value("textSource","Name","ProductName"),
   amount:value("column2Source","LineTotal","Total","Amount"),
   second:value("column3Source"),
   extraText:value("column4Source"),
   extraAmount:value("column5Source")
  };
  if(item.text||item.amount||item.second||item.extraText||item.extraAmount)out.push(item);
 });
 return out;
}
