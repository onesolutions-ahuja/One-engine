/** Load a complete, authorised collection using the existing Object Record API.
 * A single Record API request supports at most 100 rows. Never publish a
 * partial aggregate when the collection exceeds the existing 200-row bound.
 * No result cache: each page is authorised by the shared Record API.
 */
export async function loadBoundedCollectionSource<Row>(
 objectApiName:string,
 readPage:(objectApiName:string,options:{limit:number;offset:number})=>
  Promise<{records:Row[];total:number}>,
 maxRecords=200
):Promise<Row[]>{
 if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>1000000)
  throw Error('Invalid COLLECTION source limit');
 const records:Row[]=[];
 let expectedTotal:number|undefined;
 for(let offset=0;;){
  const page=await readPage(objectApiName,{limit:Math.min(100,maxRecords-offset),offset});
  if(!Number.isSafeInteger(page.total)||page.total<0||!Array.isArray(page.records))
   throw Error('COLLECTION source '+objectApiName+' returned invalid pagination');
  if(page.total>maxRecords)
   throw Error('COLLECTION source '+objectApiName+' has more records than can be safely loaded; narrow its filters');
  if(expectedTotal!==undefined&&page.total!==expectedTotal)
   throw Error('COLLECTION source '+objectApiName+' changed during pagination; refresh');
  expectedTotal=page.total;
  const remaining=expectedTotal-records.length;
  if(page.records.length>Math.min(100,remaining)||page.records.length===0&&remaining>0)
   throw Error('COLLECTION source '+objectApiName+' returned an incomplete page; refresh');
  records.push(...page.records);
  if(records.length===expectedTotal)return records;
  offset=records.length;
  if(offset>=maxRecords)
   throw Error('COLLECTION source '+objectApiName+' has more records than can be safely loaded; narrow its filters');
 }
}
