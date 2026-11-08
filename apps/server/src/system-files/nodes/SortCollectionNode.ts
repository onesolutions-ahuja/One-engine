export function executeSortCollectionNode(config:Record<string,unknown>,records:Record<string,unknown>[]):Record<string,unknown>[] {
 const field=String(config.sortField??'');
 if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))throw new Error('Invalid Collection Sort field');
 const direction=config.sortOrder==='Descending'?-1:1;
 return [...records].sort((left,right)=>{
  const a=left[field],b=right[field];
  if(a===b)return 0;
  if(a===null||a===undefined)return 1;
  if(b===null||b===undefined)return -1;
  if(typeof a!==typeof b||!['string','number'].includes(typeof a))
   throw new Error('Collection Sort values must be matching text or numbers');
  return a<b?-direction:direction;
 });
}
