import {authenticatedRequest,type MobileSession} from './mobileApi';

export type RecordFormField={
 apiName:string;label:string;dataType:string;required:boolean;
 defaultValue:string|number|boolean|null;picklistValues:string[];
 relationship:{targetObject:string}|null;controllerFieldApiName?:string|null;
 valueSettings?:Record<string,string[]>|null;canCreate:boolean;canEdit:boolean;
};
export type RecordFormObject={
 apiName:string;label:string;pluralLabel?:string;canCreate:boolean;canEdit:boolean;fields:RecordFormField[];
 recordTypes?:Array<{id:string;label:string;isDefault:boolean}>;
};
export type NativeRecord=Record<string,unknown>&{Id:string;LastModifiedDate?:string};
const objectName=/^[A-Za-z][A-Za-z0-9_]{0,199}$/;
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export const validObjectName=(api:string)=>objectName.test(api);
export const validRecordId=(id:string)=>uuid.test(id);
export {fieldType,safeField,serializeChangedFields} from './recordFormValues.mjs';
import {fieldType} from './recordFormValues.mjs';
export async function listEditableObjects(s:MobileSession):Promise<RecordFormObject[]>{
 const data=await authenticatedRequest<{objects:RecordFormObject[]}>(s,'/mobile/record-forms');
 return (data.objects??[]).filter(x=>validObjectName(x.apiName));
}
export async function loadRecordForm(s:MobileSession,objectApi:string):Promise<RecordFormObject>{
 if(!validObjectName(objectApi))throw new Error('Invalid object');
 const data=await authenticatedRequest<{object:RecordFormObject}>(s,
  '/mobile/record-forms/'+encodeURIComponent(objectApi));
 if(!data.object||data.object.apiName!==objectApi)throw new Error('Record form metadata mismatch');
 return data.object;
}
export async function loadLiveRecord(s:MobileSession,objectApi:string,id:string):Promise<NativeRecord>{
 if(!validObjectName(objectApi)||!validRecordId(id))throw new Error('Invalid record path');
 const data=await authenticatedRequest<{record:NativeRecord}>(s,
  '/records/'+encodeURIComponent(objectApi)+'/'+encodeURIComponent(id)+'?formFactor=Phone');
 if(!data.record||data.record.Id!==id)throw new Error('Record data mismatch');
 return data.record;
}
export async function findLookupRecords(s:MobileSession,objectApi:string,search:string){
 if(!validObjectName(objectApi))throw new Error('Invalid lookup object');
 const params=new URLSearchParams({limit:'30',offset:'0',search:search.trim().slice(0,100)});
 const data=await authenticatedRequest<{records:NativeRecord[]}>(s,
  '/records/'+encodeURIComponent(objectApi)+'?'+params.toString());
 return (data.records??[]).filter(row=>validRecordId(row.Id));
}
export function fieldValueForEditor(field:RecordFormField,value:unknown):unknown {
 const type=fieldType(field);
 if(type==='encryptedtext')return '';
 if(type==='boolean')return value===true||value==='true';
 if(type==='address')return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 if(type==='geolocation')return value&&typeof value==='object'&&!Array.isArray(value)?value:{latitude:null,longitude:null};
 return value??'';
}

export async function saveLiveRecord(s:MobileSession,objectApi:string,mode:'create'|'edit',
 values:Record<string,unknown>,id?:string,modified?:string){
 if(!validObjectName(objectApi)||mode==='edit'&&(!id||!validRecordId(id)))throw new Error('Invalid record path');
 const base='/records/'+encodeURIComponent(objectApi);
 const options:RequestInit={method:mode==='create'?'POST':'PATCH',
  headers:{'Content-Type':'application/json',...(mode==='edit'&&modified?{'If-Unmodified-Since':modified}:{})},
  body:JSON.stringify(values)};
 const data=await authenticatedRequest<{id?:string;record?:{Id:string}}>(s,
  mode==='create'?base:base+'/'+encodeURIComponent(id!),options);
 const resultId=data.id??data.record?.Id??id;
 if(!resultId||!validRecordId(resultId))throw new Error('Save succeeded but the record ID is unavailable');
 return resultId;
}
