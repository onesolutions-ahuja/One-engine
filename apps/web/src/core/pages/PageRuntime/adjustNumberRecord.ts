import type {FieldMetadata} from '../../metadata/Definitions/metadata';
import {evaluateFieldExpressionDetailed} from '../../../component-libraries/shared/FieldExpression.js';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type AdjustNumberBinding={
 actionType:'AdjustNumber';objectApiName?:string;fieldApiName:string;
 deltaSource:'$event.delta';
 /** Per-button declarative formulas, e.g. @Quantity + 2 and @Quantity - 2. */
 incrementFormula?:string;decrementFormula?:string;
 minValue?:number;deleteOnZero?:boolean;
 totalFieldApiName?:string;unitPriceFieldApiName?:string;
 relatedFieldApiName?:string;relatedStateKey?:string;
 stateCollectionKey?:string;subtotalStateKey?:string;totalStateKey?:string;
};
const identifier=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const recordIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const numeric=/^(Number|Currency|Percent|Integer|Decimal|Double|Float|Long|Short|Int)(\(|$)/i;
const valueNumber=(value:unknown):number=>{
 if((typeof value!=='number'&&typeof value!=='string')||value==='')throw Error('Quantity must be a readable number');
 const n=Number(value);
 if(!Number.isFinite(n))throw Error('Quantity must be a finite number');
 return n;
};
const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
/** Use the existing bounded formula engine on authorised numeric record fields.
 * No arbitrary JS, HTTP, SQL, page state writes or cross-record references.
 */
export function evaluateNumberActionFormula(
 formula:string,field:string,row:Readonly<Record<string,unknown>>,
 fields:ReadonlyArray<FieldMetadata>
):number{
 if(typeof formula!=='string'||formula.length>300||!formula.trim())
  throw Error('Enter a quantity formula using @Field and numbers.');
 const numericFields=new Set(fields.filter(item=>numeric.test(item.dataType)).map(item=>item.apiName));
 if(!numericFields.has(field))throw Error('The formula target must be a Number field.');
 const references=[...formula.matchAll(/@([A-Za-z][A-Za-z0-9_.]*)/g)].map(match=>match[1]);
 if(!references.includes(field))throw Error('Quantity formula must reference @'+field+'.');
 if(references.some(name=>!numericFields.has(name)||!Object.prototype.hasOwnProperty.call(row,name)))
  throw Error('Quantity formula references an unavailable numeric field.');
 const values:Record<string,number>={};
 for(const name of new Set(references))values[name]=valueNumber(row[name]);
 const result=evaluateFieldExpressionDetailed(formula,values);
 if(result.error)throw Error('Invalid quantity formula: '+result.error);
 if(typeof result.value!=='string'||!result.value.trim()||
    !Number.isFinite(Number(result.value)))
  throw Error('Quantity formula must return a finite number.');
 return Number(result.value);
}

/** Generic, no-Flow numeric record adjustment through RBAC-enforced Record API.
 * No business-object names, app names, or JavaScript expressions are evaluated.
 * All field and related-record references are validated before any write.
 */
export async function adjustNumberRecord(
 request:Request, config:AdjustNumberBinding,
 event:Record<string,unknown>,state:Readonly<Record<string,unknown>>,
 objects:ReadonlyArray<{apiName:string;fields:ReadonlyArray<FieldMetadata>}>,
 fallbackObject:string,
 onOptimistic?:(changes:ReadonlyArray<{key:string;value:unknown}>)=>{commit:()=>void;rollback:()=>void}
):Promise<Array<{key:string;value:unknown}>>{
 const apiName=config.objectApiName||fallbackObject;
 const recordId=event.recordId;
 if(!identifier.test(apiName)||!recordIdPattern.test(String(recordId??'')))
  throw Error('Select an authorised record for this number action.');
 const field=config.fieldApiName;
 if(!identifier.test(field)||config.deltaSource!=='$event.delta')
  throw Error('Configure a numeric field and the clicked +/- event value.');
 const metadata=objects.find(obj=>obj.apiName===apiName);
 const byField=(name:string)=>metadata?.fields.find(f=>f.apiName===name);
 if(!numeric.test(byField(field)?.dataType??''))throw Error('The adjusted field must be a Number.');
 const delta=event.delta;
 if(delta!==1&&delta!==-1)throw Error('Only +1 or -1 are allowed for this action.');
 const min=config.minValue??0;
 if(!Number.isSafeInteger(min)||min<0||min>1000000)throw Error('Invalid minimum value');
 if(config.deleteOnZero&&min!==0)throw Error('Delete-at-zero requires a zero minimum.');
 const hasTotal=Boolean(config.totalFieldApiName||config.unitPriceFieldApiName);
 if(hasTotal&&(!identifier.test(config.totalFieldApiName??'')
    ||!identifier.test(config.unitPriceFieldApiName??'')
    ||!numeric.test(byField(config.totalFieldApiName??'')?.dataType??'')
    ||!numeric.test(byField(config.unitPriceFieldApiName??'')?.dataType??'')))
  throw Error('Both calculated total and unit price must be readable numeric fields.');
 const related=config.relatedFieldApiName,relatedState=config.relatedStateKey;
 if(Boolean(related)!==Boolean(relatedState))
  throw Error('A related-record guard needs both its field and page-state key.');
 if(related&&(!identifier.test(related)||!identifier.test(relatedState!)
   ||!byField(related)))throw Error('Invalid related-record guard');
 const scopedId=relatedState?state[relatedState]:undefined;
 if(related&&(!recordIdPattern.test(String(scopedId??''))))
  throw Error('Current related record is not selected.');

 const url='/records/'+encodeURIComponent(apiName)+'/'+encodeURIComponent(String(recordId));
 const response=await request<{record:Record<string,unknown>}>(url);
 const row=response.record;
 if(!row||row.Id!==recordId)throw Error('The selected record is not available.');
 if(related&&row[related]!==scopedId)throw Error('This row belongs to another session.');
 const original=valueNumber(row[field]);
 if(!Number.isSafeInteger(original)||original<min)
  throw Error('Current quantity is invalid.');
 const authoredFormula=delta===1?config.incrementFormula:config.decrementFormula;
 const formula=authoredFormula===undefined
  ?'@'+field+(delta===1?' + 1':' - 1'):authoredFormula;
 const calculated=evaluateNumberActionFormula(formula,field,row,metadata?.fields??[]);
 // Removing more than the remaining quantity removes the line at zero,
 // rather than producing a negative quantity or an accidental overcharge.
 const next=calculated<min&&delta===-1&&config.deleteOnZero?min:calculated;
 if(next<min||!Number.isSafeInteger(next)||next>1000000)
  throw Error('Quantity would be outside its allowed range.');
 if(delta===1&&next<=original||delta===-1&&next>=original)
  throw Error('Quantity formula must increase on + and decrease on −.');
 // The Record API requires a precondition so simultaneous operators cannot
 // overwrite each other's number changes or delete a newly edited row.
 const modifiedAt=row.LastModifiedDate;
 if(typeof modifiedAt!=='string'||!Number.isFinite(Date.parse(modifiedAt)))
  throw Error('Record version unavailable; refresh before changing quantity.');
 const headers={'Content-Type':'application/json','If-Unmodified-Since':modifiedAt};
 const unitPrice=hasTotal?valueNumber(row[config.unitPriceFieldApiName!]):0;
 if(unitPrice<0)throw Error('Unit price is invalid.');
 const total=hasTotal?cents(next*unitPrice):undefined;
 const keys=[config.stateCollectionKey,config.totalStateKey,config.subtotalStateKey]
  .filter((key):key is string=>Boolean(key));
 if(keys.some(key=>!identifier.test(key)))throw Error('Invalid state output key.');
 if((config.totalStateKey||config.subtotalStateKey)&&(!config.stateCollectionKey||!hasTotal))
  throw Error('Summary updates require a cart collection and a calculated line total.');
 let projected:Array<Record<string,unknown>>|undefined;
 if(config.stateCollectionKey){
  const collection=state[config.stateCollectionKey];
  if(!Array.isArray(collection)||collection.length>200||
    collection.some(item=>!item||typeof item!=='object'||Array.isArray(item)))
   throw Error('The page row collection is unavailable; reload the cart.');
  const match=collection.filter(item=>(item as Record<string,unknown>).Id===recordId);
  if(match.length!==1)throw Error('Current cart row is missing; reload the cart.');
  projected=collection.filter(item=>(item as Record<string,unknown>).Id!==recordId)
   .map(item=>({...item}));
  if(next>0||!config.deleteOnZero)
   projected.push({...row,[field]:next,...(hasTotal?{[config.totalFieldApiName!]:total}: {})});
  if(config.totalStateKey||config.subtotalStateKey){
   for(const item of projected)valueNumber(item[config.totalFieldApiName!]);
  }
 }
 const changes:Array<{key:string;value:unknown}>=[];
 if(projected&&config.stateCollectionKey){
  changes.push({key:config.stateCollectionKey,value:projected});
  if(config.totalStateKey||config.subtotalStateKey){
   const sum=cents(projected.reduce((a,item)=>a+valueNumber(item[config.totalFieldApiName!]),0));
   if(config.totalStateKey)changes.push({key:config.totalStateKey,value:sum});
   if(config.subtotalStateKey)changes.push({key:config.subtotalStateKey,value:sum});
  }
 }
 // Only already-authorized/validated numeric changes are provisional. The
 // guarded write remains the sole authoritative mutation and is never skipped.
 const provisional=onOptimistic&&changes.length?onOptimistic(changes):undefined;
 try{
  if(next===0&&config.deleteOnZero)
   await request(url,{method:'DELETE',headers:{'If-Unmodified-Since':modifiedAt}});
  else await request(url,{method:'PATCH',headers,body:JSON.stringify({
   [field]:next,...(hasTotal?{[config.totalFieldApiName!]:total}:{})
  })});
  provisional?.commit();
 }catch(error){
  try{provisional?.rollback();}catch{/* Preserve the original permission/validation error. */}
  throw error;
 }
 return changes;
}
