/** Excel record loader. Uses RecordEngine and atomic ExternalIdUpsert: never bypass RBAC, flows or validation. */
import {createHash} from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {ExternalIdUpsert} from '../system-files/external-id-upsert.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {resolveImportLookupValue} from '../relationship-engine/LookupResolver.js';
import {readLoaderWorkbook,writeLoaderWorkbook,type LoaderTable} from './metadata-loader-xlsx.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request & {actor?:Actor};
type ExcelRow=Record<string,string>;
type Item={excelRow:number;action:string;id:string;status:'Valid'|'Error'|'Skipped'|'Success';message:string;result:string;cells:ExcelRow};
const ident=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const xlsxMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const trim=(v:unknown)=>String(v??'').trim();
const isComputed=(type:string)=>/^(formula|roll-up summary|autonumber|auto number)/i.test(type);
const parse=(input:unknown)=>{
 if(typeof input!=='string'||input.length>14_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(input))
  throw Error('Invalid XLSX workbook');
 return Buffer.from(input,'base64');
};
function readRows(bytes:Buffer){
 const sheets=readLoaderWorkbook(bytes);
 const table=sheets.find(t=>t.name==='Records');
 if(!table)throw Error('Workbook needs a Records sheet');
 if(!table.columns.includes('Action')||!table.columns.includes('Id'))throw Error('Records requires Action and Id columns');
 if(table.rows.length>4000)throw Error('Maximum 4,000 record rows per upload');
 const rows:Item[]=table.rows.map((cells,i)=>({
  excelRow:Number(cells.__excelRow??i+2),cells,action:trim(cells.Action)||'Upsert',
  id:trim(cells.Id),status:'Valid',message:'Ready',result:''}));
 return {table,rows};
}
function report(table:LoaderTable,items:Item[]){
 const original=table.columns.filter(c=>!['Status','Result','Message'].includes(c));
 const rows:Record<string,string>[]=items.map(i=>({...i.cells,Status:i.status,Result:i.result,Message:i.message,ExcelRow:String(i.excelRow)}));
 const summaryCols=['ExcelRow','Action','Id','Status','Result','Message'];
 const all=(array:typeof rows)=>array.map(r=>Object.fromEntries(summaryCols.map(c=>[c,r[c]??''])));
 return writeLoaderWorkbook([
  {name:'Records',columns:[...original,'Status','Result','Message'],rows},
  {name:'All Rows',columns:summaryCols,rows:all(rows)},
  {name:'Successful',columns:summaryCols,rows:all(rows.filter(r=>r.Status==='Success'))},
  {name:'Errors',columns:summaryCols,rows:all(rows.filter(r=>r.Status==='Error'))},
  {name:'Skipped',columns:summaryCols,rows:all(rows.filter(r=>r.Status==='Skipped'))}
 ]).toString('base64');
}
const summary=(items:Item[])=>({total:items.length,valid:items.filter(i=>i.status==='Valid').length,
 success:items.filter(i=>i.status==='Success').length,error:items.filter(i=>i.status==='Error').length,
 skipped:items.filter(i=>i.status==='Skipped').length});
type Field={apiName:string;dataType:string;required:boolean;externalId?:boolean;caseSensitive?:boolean;picklistRestricted?:boolean;picklistValues?:string[];relationship?:{targetObject:string}};
type ResolveReference=(field:Field,raw:string)=>Promise<string>;
function convert(raw:string,field:Field):unknown{
 if(raw==='<CLEAR>')return null;
 const type=field.dataType.toLowerCase();
 if(type==='checkbox') {
  if(!/^(true|false|1|0)$/i.test(raw))throw Error(field.apiName+' must be TRUE or FALSE');
  return /^(true|1)$/i.test(raw);
 }
 if(/^(number|currency|percent)(?:\(|$)/.test(type)){
  const n=Number(raw);if(!raw||!Number.isFinite(n))throw Error(field.apiName+' must be a finite number');
  return n;
 }
 if(type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw Error(field.apiName+' requires YYYY-MM-DD');
 if((type==='date/time'||type==='datetime')&&!/^\d{4}-\d{2}-\d{2}T/.test(raw))
  throw Error(field.apiName+' requires ISO DateTime');
 if(type==='picklist'&&field.picklistRestricted&&field.picklistValues?.length
  &&!field.picklistValues.includes(raw))throw Error(field.apiName+' is not an allowed picklist value');
 if(type==='multi-select picklist'){
  const values=raw.startsWith('[')?JSON.parse(raw):raw.split(';').map(x=>x.trim()).filter(Boolean);
  if(!Array.isArray(values)||values.some((v:unknown)=>typeof v!=='string'))throw Error('Invalid multi-select picklist');
  if(field.picklistRestricted&&values.some((v:string)=>!field.picklistValues?.includes(v)))
   throw Error('Unsupported multi-select picklist value');
  return values;
 }
 if(type==='address'||type==='geolocation'){
  let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw Error(field.apiName+' requires a JSON object');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error(field.apiName+' requires a JSON object');
  return parsed;
 }
 return raw;
}
async function typedValues(row:ExcelRow,fields:Field[],headers:string[],create:boolean,resolveReference:ResolveReference){
 const known=new Map(fields.map(f=>[f.apiName,f]));
 const values:Record<string,unknown>={};
 for(const key of headers){
  if(['Action','Id','Status','Result','Message','ExcelRow'].includes(key))continue;
  const field=known.get(key);
  if(!field)throw Error('Unknown object field: '+key);
  const raw=trim(row[key]);
  if(!raw)continue; // blank on update means unchanged; <CLEAR> explicitly clears a field
  if(isComputed(field.dataType))throw Error(field.apiName+' is read-only');
  if(raw==='<CLEAR>'&&field.required)throw Error('Cannot clear required field '+key);
  values[key]=field.dataType.toLowerCase()==='lookup'&&raw!=='<CLEAR>'
   ?await resolveReference(field,raw):convert(raw,field);
 }
 if(create){
  for(const field of fields)if(field.required&&!isComputed(field.dataType)
    &&values[field.apiName]===undefined) {
    // Required fields with a server default are still checked by the Record Engine.
    if(!field.apiName.startsWith('__'))throw Error('Missing required field '+field.apiName);
   }
 }
 return values;
}
export function registerDataLoaderRecordRoutes(app:Express,db:SqlPersistence,records:RecordEngine,
 definitions:ObjectDefinitionService,rbac:RbacEngine,externalIds:ExternalIdUpsert){
 const route=(fn:(req:Req,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>
  void fn(req as Req,res).catch(next);
 const meta=async(actor:Actor,objectApi:string)=>{
  if(!ident.test(objectApi)||objectApi==='User')throw Error('Invalid import object');
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
  await rbac.require(actor.tenant_id,actor.user_id,objectApi,'read');
  const object=await definitions.get(actor.tenant_id,objectApi);
  return object;
 };
 app.post('/api/data-loader/records/export',route(async(req,res)=>{
  const actor=req.actor!,objectApi=trim(req.body?.objectApi);
  const obj=await meta(actor,objectApi);
  const readable=[] as typeof obj.fields,fields=[] as typeof obj.fields;
  for(const field of obj.fields){
   const resource=objectApi+'.'+field.apiName;
   if(!await rbac.allowed(actor.tenant_id,actor.user_id,resource,'read'))continue;
   readable.push(field);
   // The editable Records tab must remain round-trip safe: computed and inaccessible
   // fields belong in the guide, never in a writable upload row.
   if(!isComputed(field.dataType)
     &&(await rbac.allowed(actor.tenant_id,actor.user_id,resource,'edit')
       ||await rbac.allowed(actor.tenant_id,actor.user_id,resource,'create')))fields.push(field);
  }
  const selected=req.body?.ids;
  if(selected!==undefined&&(!Array.isArray(selected)||selected.length>4000
    ||selected.some((id:unknown)=>typeof id!=='string'||!uuid.test(id))))
   throw Error('Invalid selected record IDs');
  const selectedIds=selected?.length?new Set<string>(selected as string[]):null;
  const limit=Number(req.body?.limit??4000);
  if(!Number.isInteger(limit)||limit<1||limit>4000)throw Error('Invalid export limit');
  const rows:ExcelRow[]=[];let total=0;
  for(let pageNo=0;pageNo<40&&rows.length<limit;pageNo++){
   const page=await records.list(actor.tenant_id,actor.user_id,objectApi,100,pageNo*100);
   if(pageNo===0)total=page.total;
   for(const record of page.records){
    if(selectedIds&&!selectedIds.has(String(record.Id)))continue;
    rows.push(Object.fromEntries([['Action','Upsert'],['Id',String(record.Id??'')],
     ...fields.map(f=>[f.apiName,record[f.apiName]===undefined||record[f.apiName]===null?''
       :typeof record[f.apiName]==='object'?JSON.stringify(record[f.apiName]):String(record[f.apiName])])]));
    if(rows.length>=limit)break;
   }
   if(page.records.length<100)break;
  }
  const columns=['Action','Id',...fields.map(f=>f.apiName)];
  const guide=readable.map(f=>({FieldApiName:f.apiName,Label:f.label,DataType:f.dataType,
   Required:String(f.required),ExternalId:String(f.externalId===true),Writable:String(!isComputed(f.dataType)),
   PicklistValues:(f.picklistValues??[]).join(';'),RelationshipTarget:f.relationship?.targetObject??'',
   RelationshipImport:f.relationship?'Existing record UUID or unique exact Name':''}));
  const result=writeLoaderWorkbook([
   {name:'Records',columns,rows},
   {name:'Field Guide',columns:['FieldApiName','Label','DataType','Required','ExternalId','Writable','PicklistValues','RelationshipTarget','RelationshipImport'],
    rows:guide},
  ]);
  res.set('Cache-Control','private, no-store');res.json({workbook:result.toString('base64'),count:rows.length,total,truncated:!selectedIds&&total>rows.length,
   filename:objectApi+'_Records.xlsx',mime:xlsxMime});
 }));
 const prepare=async(actor:Actor,objectApi:string,bytes:Buffer,externalField:string)=>{
  const object=await meta(actor,objectApi);
  const cache=new Map<string,Promise<string>>();
  const resolveReference:ResolveReference=(field,raw)=>{
   const key=JSON.stringify([field.apiName,field.relationship?.targetObject,raw]);
   let value=cache.get(key);
   if(!value){
    value=resolveImportLookupValue(db,rbac,actor.tenant_id,actor.user_id,
     field.apiName,field.relationship?.targetObject,raw);
    cache.set(key,value);
   }
   return value;
  };
  const data=readRows(bytes),known=new Map(object.fields.map(f=>[f.apiName,f]));
  const allowed=new Set(['Action','Id',...object.fields.map(f=>f.apiName),'Status','Result','Message','ExcelRow']);
  const unknown=data.table.columns.filter(c=>!allowed.has(c));
  if(unknown.length)throw Error('Unknown columns: '+unknown.join(', '));
  const matchField=externalField?known.get(externalField):undefined;
  if(externalField&&(!matchField?.externalId||isComputed(matchField.dataType)))
   throw Error('Select a valid External ID field');
  const keys=new Set<string>();
  for(const i of data.rows){
   try{
    if(!['Create','Update','Upsert','Delete'].includes(i.action))throw Error('Unsupported Action: '+i.action);
    if(i.id&&!uuid.test(i.id))throw Error('Invalid record Id');
    if(i.action==='Update'||i.action==='Delete')if(!i.id)throw Error(i.action+' requires Id');
    if(i.action==='Create'&&i.id)throw Error('Create must leave Id blank');
    const key=i.id?'id:'+i.id.toLowerCase():externalField&&trim(i.cells[externalField])
     ?'external:'+(matchField?.caseSensitive?trim(i.cells[externalField]):trim(i.cells[externalField]).toLowerCase()):'';
    if(key){if(keys.has(key))throw Error('Duplicate match key in workbook');keys.add(key);}
    const create=!i.id&&(i.action==='Create'||i.action==='Upsert');
    const values=i.action==='Delete'?{}:await typedValues(i.cells,object.fields,data.table.columns,false,resolveReference);
    if(i.action!=='Delete'&&!Object.keys(values).length)throw Error('Row has no field changes');
    if(i.action==='Upsert'&&!i.id&&externalField&&!trim(i.cells[externalField]))
     throw Error('External ID value is missing (or select no matching field for create-only)');
    if(i.action!=='Delete'){
     const operation=i.action==='Create'?'create':i.action==='Update'||i.id?'edit':'create';
     // An External ID upsert may update or create: the atomic engine resolves the
     // actual match at execution time and checks the exact operation permissions.
     if(i.action==='Upsert'&&!i.id&&externalField){
      const operations=['create','edit'] as const;
      if(!(await Promise.all(operations.map(x=>rbac.allowed(actor.tenant_id,actor.user_id,objectApi,x)))).some(Boolean))
       throw Error('Permission denied');
      for(const field of Object.keys(values)){
       if(!(await Promise.all(operations.map(x=>rbac.allowed(actor.tenant_id,actor.user_id,objectApi+'.'+field,x)))).some(Boolean))
        throw Error('Permission denied on '+field);
      }
     }else{
      await rbac.require(actor.tenant_id,actor.user_id,objectApi,operation);
      for(const field of Object.keys(values))
       await rbac.require(actor.tenant_id,actor.user_id,objectApi+'.'+field,operation);
     }
    }else await rbac.require(actor.tenant_id,actor.user_id,objectApi,'delete');
    i.result=create?'Create':i.action;i.message='Validated (database rules rechecked on execution)';
   }catch(e){i.status='Error';i.message=e instanceof Error?e.message:String(e);}
  }
  return {...data,resolveReference};
 };
 app.post('/api/data-loader/records/validate',route(async(req,res)=>{
  const actor=req.actor!,bytes=parse(req.body?.workbook),objectApi=trim(req.body?.objectApi);
  const externalField=trim(req.body?.externalIdField);
  const data=await prepare(actor,objectApi,bytes,externalField);
  const digest=createHash('sha256').update(bytes).digest('hex');
  res.set('Cache-Control','private, no-store');
  res.json({digest,summary:summary(data.rows),rows:data.rows,report:report(data.table,data.rows)});
 }));
 app.post('/api/data-loader/records/execute',route(async(req,res)=>{
  const actor=req.actor!,bytes=parse(req.body?.workbook),objectApi=trim(req.body?.objectApi);
  const externalField=trim(req.body?.externalIdField);
  const digest=createHash('sha256').update(bytes).digest('hex');
  if(req.body?.digest!==digest||req.body?.confirmation!=='PROCEED_EXCLUDING_ERRORS')
   throw Error('Validate the exact workbook and confirm execution');
  const data=await prepare(actor,objectApi,bytes,externalField);
  const object=await meta(actor,objectApi);
  for(const i of data.rows){
   if(i.status!=='Valid')continue;
   try{
    const values=i.action==='Delete'?{}:await typedValues(i.cells,object.fields,data.table.columns,false,data.resolveReference);
    if(i.action==='Delete'){
     await records.remove(actor.tenant_id,actor.user_id,objectApi,i.id);
     i.result=i.id;
    }else if(i.action==='Create'){
     i.result=await records.create(actor.tenant_id,actor.user_id,objectApi,values);
    }else if(i.action==='Update'||i.id){
     await records.update(actor.tenant_id,actor.user_id,objectApi,i.id,values);
     i.result=i.id;
    }else if(externalField){
     const key=trim(i.cells[externalField]);
     if(!key)throw Error('External ID value required');
     const match=await externalIds.execute(actor.tenant_id,actor.user_id,objectApi,externalField,key,values);
     i.result=match.id+(match.created?' (created)':' (updated)');
    }else i.result=await records.create(actor.tenant_id,actor.user_id,objectApi,values);
    i.status='Success';i.message='Executed';
   }catch(e){i.status='Error';i.message=e instanceof Error?e.message:String(e);}
  }
  res.set('Cache-Control','private, no-store');
  res.json({summary:summary(data.rows),rows:data.rows,report:report(data.table,data.rows)});
 }));
}
