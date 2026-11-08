import type {FieldMetadata} from '../../metadata/Definitions/metadata';

/** Only direct Boolean fields on a single authorised record may be two-way bound.
 * Formula and related-object paths are display-only; ambiguous queries fail closed. */
export type SmartToggleFieldBinding={
 ready:boolean;fieldApiName?:string;recordId?:string;value?:boolean;error?:string;
};
const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
export function resolveSmartToggleFieldBinding(
 apiName:string,properties:Readonly<Record<string,unknown>>,objectApiName:string,
 fields:ReadonlyArray<FieldMetadata>,rows:ReadonlyArray<Record<string,unknown>>,
 total:number,currentRecordId=''
):SmartToggleFieldBinding|undefined {
 if(apiName!=='smart_toggle')return undefined;
 const source=typeof properties.textSource==='string'?properties.textSource.trim():'';
 if(!source)return undefined;
 const invalid=(error:string):SmartToggleFieldBinding=>({ready:false,error});
 const match=/^@([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/.exec(source);
 if(!match)return invalid('Toggle Text Source must be one Boolean field, for example @IsActive.');
 const sourceObject=match[2]?match[1]:'';
 const fieldApiName=match[2]||match[1];
 if(!objectApiName||(sourceObject&&sourceObject!==objectApiName))
  return invalid('Toggle field must belong to the selected Object.');
 if(!identifier.test(fieldApiName))return invalid('Invalid Boolean field.');
 const field=fields.find(item=>item.apiName===fieldApiName);
 if(!field||!['Checkbox','Boolean'].includes(field.dataType))
  return invalid('Choose a Checkbox or Boolean field on the selected Object.');
 // Never write the first of multiple records implicitly.
 const record=currentRecordId?rows.find(item=>item.Id===currentRecordId)
  :total===1&&rows.length===1?rows[0]:undefined;
 if(!record||typeof record.Id!=='string'||!record.Id)
  return invalid('Toggle requires one accessible record. Open a record page or filter to one record.');
 const raw=record[fieldApiName];
 const value=typeof raw==='boolean'?raw:
  raw==='true'||raw==='True'?true:raw==='false'||raw==='False'?false:undefined;
 if(value===undefined)return invalid('The selected Boolean field is not readable for this record.');
 return {ready:true,fieldApiName,recordId:record.Id,value};
}

/** Shared Object API enforces tenant isolation and Object/Record/Field permissions. */
export async function updateSmartToggleField(
 request:<T>(path:string,init?:RequestInit)=>Promise<T>,
 objectApiName:string,binding:SmartToggleFieldBinding,next:boolean
):Promise<void>{
 if(!binding.ready||!binding.recordId||!binding.fieldApiName||
   !identifier.test(objectApiName)||!identifier.test(binding.fieldApiName)||
   typeof next!=='boolean')throw new Error('Toggle is not bound to an editable Boolean record field.');
 await request<{record:Record<string,unknown>}>(
  '/records/'+encodeURIComponent(objectApiName)+'/'+encodeURIComponent(binding.recordId),
  {method:'PUT',body:JSON.stringify({[binding.fieldApiName]:next})}
 );
}
