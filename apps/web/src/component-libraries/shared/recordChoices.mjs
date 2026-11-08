/** Generic no-code record choice projection. Record visibility is enforced upstream
 * by the tenant-aware Object runtime; this helper never retrieves records. */
const name=/^[A-Za-z][A-Za-z0-9_]*$/;
export function projectRecordChoices(records,labelField,valueField,priceField='',imageField='') {
  if(!Array.isArray(records)||records.length>200||!name.test(labelField)
    ||!name.test(valueField)||(priceField&&!name.test(priceField))
    ||(imageField&&!name.test(imageField)))return [];
  const seen=new Set();
  return records.flatMap(record=>{
    if(!record||typeof record!=='object'||Array.isArray(record))return [];
    const rawValue=record[valueField],rawLabel=record[labelField];
    if((typeof rawValue!=='string'&&typeof rawValue!=='number')
      ||(typeof rawLabel!=='string'&&typeof rawLabel!=='number'))return [];
    const value=String(rawValue),label=String(rawLabel);
    if(!value||!label||seen.has(value))return [];
    seen.add(value);
    const price=priceField?record[priceField]:undefined;
    const image=imageField?record[imageField]:undefined;
    return [{
      value,label,
      ...(typeof price==='number'&&Number.isFinite(price)?{price}: {}),
      ...(typeof image==='string'&&(/^https:\/\//i.test(image)||/^asset:[0-9a-f-]{36}$/i.test(image))?{image}: {})
    }];
  });
}
/** A bounded selection transition; the final transactional Flow repeats validation. */
export function toggleChoiceSelection(current,next,maxSelections) {
  const active=Array.isArray(current)?current.map(String):[];
  const value=String(next);
  if(active.includes(value))return {values:active.filter(item=>item!==value),limited:false};
  const max=Number(maxSelections);
  if(Number.isInteger(max)&&max>0&&active.length>=max)
    return {values:active,limited:true};
  return {values:[...active,value],limited:false};
}
