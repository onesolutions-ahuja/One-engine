export function executeTransformNode(config:Record<string,unknown>,records:Record<string,unknown>[]):Record<string,unknown>[] {
 const mappings=Array.isArray(config.mappings)?config.mappings:[];
 if(mappings.length<1||mappings.length>100)throw new Error('Transform requires between 1 and 100 field mappings');
 return records.map(item=>{
  const target:Record<string,unknown>={};
  for(const mapping of mappings){
   if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw new Error('Invalid Transform mapping');
   const row=mapping as Record<string,unknown>;
   if(typeof row.sourceField!=='string'||typeof row.targetField!=='string'||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(row.sourceField)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(row.targetField))
    throw new Error('Invalid Transform field mapping');
   target[row.targetField]=item[row.sourceField]??null;
  }
  return target;
 });
}
