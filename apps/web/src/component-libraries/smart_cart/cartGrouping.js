/**
 * Data-source-independent cart row grouping.
 * Group on all item-defining values, not UI labels or the source object's name.
 * Record identifiers, system audit fields, quantity and derived totals never
 * define a purchasable item. Unknown custom fields DO define an item.
 *
 * The original records remain untouched for Flow actions, stock allocations,
 * authorisation, persistence and accounting.
 */
const nonIdentity=new Set([
  'id','quantity','qty',
  'createddate','createdat','createdby','createdbyid',
  'ownerid','recordtypeid',
  'lastmodifieddate','lastmodifiedat','lastmodifiedby','lastmodifiedbyid',
  'systemmodstamp','updatedat','updatedby','rowversion','version',
  '__typename','attributes'
]);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&
  !Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(isPlainObject(value)){
    const entries=Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,item])=>[key,canonical(item)]);
    return Object.fromEntries(entries);
  }
  return value;
}
const qtyOf=(row,quantityField)=>{
  const raw=(quantityField&&row?.[quantityField])??row?.Quantity??row?.quantity??row?.Qty??row?.qty??1;
  const count=Number(raw);
  return Number.isFinite(count)&&count>0?count:0;
};
const amountFields=new Set(['linetotal','lineamount']);
const numericAmount=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')
  &&Number.isFinite(Number(value));
const identityOf=(row,quantityField,count)=>{
  const own=Object.entries(row||{})
    .filter(([key])=>key!==quantityField&&!nonIdentity.has(key.toLowerCase())&&!key.startsWith('__'))
    .map(([key,value])=>[key,amountFields.has(key.toLowerCase())&&numericAmount(value)
      ?{unitAmount:Math.round(Number(value)/count*1e8)/1e8}:value])
    .sort(([a],[b])=>a.localeCompare(b));
  // Keep missing, false, null and the empty string distinct, and never
  // collapse different product/batch/price/custom-selection values.
  return JSON.stringify(canonical(Object.fromEntries(own)));
};
export function groupCartRows(records,{quantityField='Quantity'}={}){
  const output=[];
  const index=new Map();
  for(const source of Array.isArray(records)?records:[]){
    if(!source||typeof source!=='object'||Array.isArray(source))continue;
    const count=qtyOf(source,quantityField);
    // A zero/negative line was removed from the basket, not a visible item.
    if(count<=0)continue;
    const key=identityOf(source,quantityField,count);
    if(!index.has(key)){
      const row={...source,Quantity:count,__cartSourceRows:[source]};
      if(quantityField&&Object.hasOwn(source,quantityField))row[quantityField]=count;
      for(const field of Object.keys(source))
        if(amountFields.has(field.toLowerCase())&&numericAmount(source[field]))
          row[field]=Number(source[field]);
      index.set(key,output.length);
      output.push(row);
      continue;
    }
    const row=output[index.get(key)];
    row.Quantity+=count;
    if(quantityField&&quantityField!=='Quantity'&&Object.hasOwn(row,quantityField))
      row[quantityField]=row.Quantity;
    row.__cartSourceRows.push(source);
    for(const field of Object.keys(source))
      if(amountFields.has(field.toLowerCase())){
        if(numericAmount(row[field])&&numericAmount(source[field]))
          row[field]=Number(row[field])+Number(source[field]);
        else delete row[field];
      }
  }
  return output;
}
