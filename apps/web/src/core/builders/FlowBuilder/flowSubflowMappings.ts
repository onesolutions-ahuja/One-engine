/** Subflow mappings are stored as the existing, bounded runtime line protocol.
 * Browser users configure them using resource dropdowns, not manual expressions.
 */
export function getSubflowMapping(value:unknown,childName:string):string {
  if(typeof value!=='string')return '';
  for(const line of value.split(/\r?\n/)){
    const separator=line.indexOf('=');
    if(separator<1)continue;
    if(line.slice(0,separator).trim()===childName)
      return line.slice(separator+1).trim();
  }
  return '';
}

export function setSubflowMapping(value:unknown,childName:string,nextValue:string):string {
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(childName))throw new Error('Invalid Subflow input');
  if(nextValue.includes('\n')||nextValue.includes('\r')||nextValue.includes('='))
    throw new Error('Invalid Subflow mapping');
  const rows: string[]=[];
  if(typeof value==='string')for(const line of value.split(/\r?\n/)){
    const separator=line.indexOf('=');
    if(separator<1)continue;
    const key=line.slice(0,separator).trim();
    if(key!==childName&&/^[A-Za-z][A-Za-z0-9_]*$/.test(key)
      &&line.slice(separator+1).trim())rows.push(key+'='+line.slice(separator+1).trim());
  }
  if(nextValue.trim())rows.push(childName+'='+nextValue.trim());
  return rows.join('\n');
}
