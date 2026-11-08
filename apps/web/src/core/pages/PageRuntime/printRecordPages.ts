/** Print complete bounded datasets. Abort if rows shift between authorised reads. */
export async function printRecordPages<Row extends Record<string,unknown>>(
 first:{records:Row[];total:number},next:(offset:number)=>Promise<{records:Row[];total:number}>,active:()=>boolean
){
 if(first.total>5000)throw Error('Print data exceeds 5,000 rows. Narrow the template filter.');
 const rows=[...first.records];
 const ids=new Set(rows.map(row=>row.Id));
 while(active()&&rows.length<first.total){
  const page=await next(rows.length);
  if(!page.records.length||page.total!==first.total||page.records.some(row=>ids.has(row.Id)))
   throw Error('Print data changed while loading. Reopen the preview.');
  for(const row of page.records){ids.add(row.Id);rows.push(row);}
 }
 return {records:rows,total:first.total};
}
