/** Shared collection count operation; supports bounded collections only. */
export function executeCountCollectionNode(value:unknown):number {
 if(!Array.isArray(value)||value.length>200)
  throw new Error('Flow record collection must contain at most 200 records');
 if(value.some(item=>!item||typeof item!=='object'||Array.isArray(item)))
  throw new Error('Flow record collection items must be records');
 return value.length;
}
