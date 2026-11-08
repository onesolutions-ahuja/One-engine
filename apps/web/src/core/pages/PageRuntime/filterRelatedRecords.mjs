const api=/^[A-Za-z][A-Za-z0-9_]*$/;
/** Reuse the shared Object records already authorised by OneEngine.
 * A configured, but unselected, parent never leaks unrelated child records. */
export function filterRelatedRecords(records,parentId,fieldName){
  if(!Array.isArray(records))return [];
  if(!fieldName)return records;
  if(typeof fieldName!=="string"||!api.test(fieldName))return [];
  if(typeof parentId!=="string"||!parentId.trim())return [];
  return records.filter(item=>{
    if(!item||typeof item!=="object"||Array.isArray(item))return false;
    const raw=item[fieldName];
    const actual=raw&&typeof raw==="object"&&!Array.isArray(raw)
      ?raw.Id??raw.id??raw.value:raw;
    return typeof actual==="string"&&actual===parentId;
  });
}
