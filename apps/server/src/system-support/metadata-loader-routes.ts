/** Universal Metadata Loader: validated, row-wise, RBAC-checked Object/Field upserts. */
import type {Express,Request,Response,NextFunction} from 'express';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import type {ObjectManagerMetadataService} from '../system-files/object-manager-metadata.js';
import type {ObjectSchemaLifecycle} from '../system-files/object-schema-lifecycle.js';
import {assertMetadataPackageEditable} from './metadata-package-service.js';
import {readLoaderWorkbook,writeLoaderWorkbook,type LoaderTable} from './metadata-loader-xlsx.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request & {actor?:Actor};
type Action='Create'|'Update'|'Upsert'|'Delete'|'HardDelete';
type Item={sheet:'Objects'|'Fields';excelRow:number;action:Action;objectApi:string;fieldApi?:string;cells:Record<string,string>;status:'Valid'|'Error'|'Skipped'|'Success';message:string;result?:string};
type MetadataObject=Awaited<ReturnType<ObjectDefinitionService['get']>>;
const objectColumns=['Action','ApiName','Label','PluralLabel','Kind','Description','HelpText','Revision',
 'AllowReports','AllowActivities','TrackFieldHistory','AllowInChatter','AllowSearch','DeploymentStatus','RecordNameType','RecordNameFormat'];
const fieldColumns=['Action','ObjectApiName','ApiName','Label','DataType','Required','Unique','ExternalId','CaseSensitive','TrackHistory',
 'Description','HelpText','DefaultValue','AutoNumberFormat','PicklistValues','PicklistRestricted','GlobalValueSetApiName',
 'ControllerFieldApiName','ValueSettings','RelationshipType','TargetObject','RelationshipName','ChildRelationshipName',
 'DeleteBehavior','AllowReparenting','FormulaExpression','FormulaReturnType','RollupChildObject','RollupRelationshipField',
 'RollupOperation','RollupSourceField','RollupFilterLogic','RollupFilters','Revision'];
const namePattern=/^[A-Za-z][A-Za-z0-9_]*$/;
const approvedActions=new Set(['Create','Update','Upsert','Delete','HardDelete']);
const typePattern=/^(?:Text\([1-9][0-9]{0,5}\)|(?:Number|Currency|Percent)\([0-9]{1,2},\s*[0-9]{1,2}\)|Formula\((?:Text|Number|Currency|Percent|Date|DateTime|Time|Checkbox)\)|(?:Lookup|Master-Detail)\([A-Za-z][A-Za-z0-9_]*\)|Text|Text Area|Long Text Area|Rich Text Area|Text \(Encrypted\)|Encrypted Text|Number|Currency|Percent|Date|Date\/Time|DateTime|Time|Checkbox|Picklist|Multi-Select Picklist|Phone|Email|URL|Auto Number|AutoNumber|Roll-Up Summary|Geolocation|Address|File|Image)$/i;
const nullable=(v:unknown)=>v===undefined||v===null?'':String(v);
const clean=(v:unknown)=>nullable(v).trim();
const json=(v:unknown)=>v===undefined||v===null?'':JSON.stringify(v);
const fieldKey=(objectApi:string,api:string)=>objectApi.toLowerCase()+'.'+api.toLowerCase();
const bool=(value:string,name:string)=>{if(!/^(true|false|1|0)$/i.test(value))throw Error(name+' must be TRUE or FALSE');return /^(true|1)$/i.test(value);};
const asJson=(value:string,name:string)=>{try{return JSON.parse(value);}catch{throw Error('Invalid JSON in '+name);}};
const value=(row:Record<string,string>,column:string)=>clean(row[column]);
const setter=(row:Record<string,string>,key:string,field:string,into:Record<string,unknown>,parse:(x:string)=>unknown=(x)=>x)=>{
 const raw=value(row,key);
 if(raw)into[field]=raw==='<CLEAR>'?null:parse(raw);
};
const cellBoolean=(row:Record<string,string>,key:string,field:string,into:Record<string,unknown>)=>
 setter(row,key,field,into,v=>bool(v,key));
function columnsOk(t:LoaderTable,allowed:string[]){
 if(!t.columns.includes('Action')||!t.columns.includes('ApiName'))throw Error(t.name+' is missing Action/ApiName headings');
 const unknown=t.columns.filter(c=>!allowed.includes(c)&&!['Status','Message','Result','ExcelRow'].includes(c));
 if(unknown.length)throw Error('Unknown column(s) on '+t.name+': '+unknown.join(', '));
}
function parseWorkbook(buffer:Buffer):{tables:LoaderTable[];items:Item[]}{
 const all=readLoaderWorkbook(buffer);
 if(!all.some(t=>t.name==='Objects'||t.name==='Fields'))throw Error('Workbook needs Objects and/or Fields sheets');
 const tables=all.filter(t=>t.name==='Objects'||t.name==='Fields');
 for(const table of tables)columnsOk(table,table.name==='Objects'?objectColumns:fieldColumns);
 const items:Item[]=[];
 for(const table of tables)for(const cells of table.rows){
  const rawAction=value(cells,'Action'),action=rawAction as Action;
  const objectApi=value(cells,table.name==='Objects'?'ApiName':'ObjectApiName');
  items.push({sheet:table.name as 'Objects'|'Fields',excelRow:Number(cells.__excelRow)||2+items.length,
   action,objectApi,fieldApi:table.name==='Fields'?value(cells,'ApiName'):undefined,cells,
   status:'Valid',message:approvedActions.has(rawAction)?'Ready':'Unknown action: '+rawAction});
 }
 if(items.length>4000)throw Error('Maximum 4,000 metadata rows per upload');
 return {tables,items};
}
function writeReport(tables:LoaderTable[],items:Item[]):Buffer{
 const result:Record<string,string>[]=items.map(i=>({...i.cells,Sheet:i.sheet,ExcelRow:String(i.excelRow),Status:i.status,Result:i.result??'',Message:i.message}));
 const cols=['Sheet','ExcelRow','Action','ObjectApiName','ApiName','Status','Result','Message'];
 const reportRows=(filtered:typeof result)=>filtered.map(r=>Object.fromEntries(cols.map(c=>[c,r[c]??(c==='ObjectApiName'?r.Sheet==='Objects'?r.ApiName:'':'')])));
 const formatted:LoaderTable[]=[...tables.map(t=>({name:t.name,columns:[...t.columns.filter(c=>!['Status','Message','Result'].includes(c)),'Status','Result','Message'],
   rows:items.filter(i=>i.sheet===t.name).map(i=>({...i.cells,Status:i.status,Result:i.result??'',Message:i.message}))})),
  {name:'All Rows',columns:cols,rows:reportRows(result)},
  {name:'Successful',columns:cols,rows:reportRows(result.filter(r=>r.Status==='Success'))},
  {name:'Errors',columns:cols,rows:reportRows(result.filter(r=>r.Status==='Error'))},
  {name:'Skipped',columns:cols,rows:reportRows(result.filter(r=>r.Status==='Skipped'))}];
 return writeLoaderWorkbook(formatted);
}
function objectExport(o:MetadataObject,config:Record<string,unknown>){
 const s=(config.settings??{}) as Record<string,unknown>;
 return {Action:'Upsert',ApiName:o.apiName,Label:o.label,PluralLabel:config.pluralLabel??o.label,
  Kind:o.kind,Description:config.description,HelpText:config.helpText,Revision:(o as {revision?:number}).revision??'',
  AllowReports:s.allowReports,AllowActivities:s.allowActivities,TrackFieldHistory:s.trackFieldHistory,
  AllowInChatter:s.allowInChatter,AllowSearch:s.allowSearch,DeploymentStatus:s.deploymentStatus,
  RecordNameType:s.recordNameType,RecordNameFormat:s.recordNameFormat};
}
function fieldExport(objectApi:string,f:MetadataObject['fields'][number],revision:number|undefined){
 const relation=f.relationship,formula=f.formula,rollup=f.rollup;
 return {Action:'Upsert',ObjectApiName:objectApi,ApiName:f.apiName,Label:f.label,DataType:f.dataType,
  Required:f.required,Unique:f.unique,ExternalId:f.externalId,CaseSensitive:f.caseSensitive,TrackHistory:f.trackHistory,
  Description:f.description,HelpText:f.helpText,DefaultValue:f.defaultValue,AutoNumberFormat:f.autoNumberFormat,
  PicklistValues:json(f.picklistValues),PicklistRestricted:f.picklistRestricted,GlobalValueSetApiName:f.globalValueSetApiName,
  ControllerFieldApiName:f.controllerFieldApiName,ValueSettings:json(f.valueSettings),RelationshipType:relation?.type,
  TargetObject:relation?.targetObject,RelationshipName:relation?.relationshipName,
  ChildRelationshipName:relation?.childRelationshipName,DeleteBehavior:relation?.deleteBehavior,
  AllowReparenting:relation?.allowReparenting,FormulaExpression:formula?.expression,FormulaReturnType:formula?.returnType,
  RollupChildObject:rollup?.childObject,RollupRelationshipField:rollup?.relationshipField,
  RollupOperation:rollup?.operation,RollupSourceField:rollup?.sourceField,
  RollupFilterLogic:rollup?.filterLogic,RollupFilters:json(rollup?.filters),Revision:revision};
}
function objectSettings(row:Record<string,string>,current?:Record<string,unknown>){
 const settings={...(current??{})};
 for(const [key,name] of [['AllowReports','allowReports'],['AllowActivities','allowActivities'],
  ['TrackFieldHistory','trackFieldHistory'],['AllowInChatter','allowInChatter'],['AllowSearch','allowSearch']])
  cellBoolean(row,key,name,settings);
 for(const [key,name] of [['DeploymentStatus','deploymentStatus'],['RecordNameType','recordNameType'],
  ['RecordNameFormat','recordNameFormat']])setter(row,key,name,settings);
 return settings;
}
function fieldInput(row:Record<string,string>,existing?:MetadataObject['fields'][number]):Record<string,unknown>{
 const draft:Record<string,unknown>={apiName:value(row,'ApiName'),label:value(row,'Label')||existing?.label};
 setter(row,'DataType','dataType',draft);
 for(const [key,name] of [['Required','required'],['Unique','unique'],['ExternalId','externalId'],
  ['CaseSensitive','caseSensitive'],['TrackHistory','trackHistory'],['PicklistRestricted','picklistRestricted']])
  cellBoolean(row,key,name,draft);
 for(const [key,name] of [['Description','description'],['HelpText','helpText'],
  ['AutoNumberFormat','autoNumberFormat'],['GlobalValueSetApiName','globalValueSetApiName'],
  ['ControllerFieldApiName','controllerFieldApiName']])setter(row,key,name,draft);
 setter(row,'PicklistValues','picklistValues',draft,v=>asJson(v,'PicklistValues'));
 setter(row,'ValueSettings','valueSettings',draft,v=>asJson(v,'ValueSettings'));
 setter(row,'DefaultValue','defaultValue',draft,v=>{
  const type=String(draft.dataType??existing?.dataType??'').toLowerCase();
  return /^(number|currency|percent)\b/.test(type)?Number(v):type==='checkbox'?bool(v,'DefaultValue'):v;
 });
 if(value(row,'RelationshipType')||value(row,'TargetObject')){
  const old=existing?.relationship;
  const rel:Record<string,unknown>={...old};
  for(const [key,name] of [['RelationshipType','type'],['TargetObject','targetObject'],
   ['RelationshipName','relationshipName'],['ChildRelationshipName','childRelationshipName'],
   ['DeleteBehavior','deleteBehavior']])setter(row,key,name,rel);
  cellBoolean(row,'AllowReparenting','allowReparenting',rel);draft.relationship=rel;
 }
 if(value(row,'FormulaExpression')||value(row,'FormulaReturnType')){
  draft.formula={...existing?.formula,
   expression:value(row,'FormulaExpression')||existing?.formula?.expression,
   returnType:value(row,'FormulaReturnType')||existing?.formula?.returnType};
 }
 if(value(row,'RollupOperation')||value(row,'RollupChildObject')){
  const roll:Record<string,unknown>={...existing?.rollup};
  for(const [key,name] of [['RollupChildObject','childObject'],['RollupRelationshipField','relationshipField'],
   ['RollupOperation','operation'],['RollupSourceField','sourceField'],['RollupFilterLogic','filterLogic']])
   setter(row,key,name,roll);
  setter(row,'RollupFilters','filters',roll,v=>asJson(v,'RollupFilters'));draft.rollup=roll;
 }
 return draft;
}
function typedValidation(item:Item){
 const r=item.cells;
 if(!approvedActions.has(item.action))throw Error('Invalid Action');
 if(!namePattern.test(item.objectApi))throw Error('Invalid Object API Name');
 if(item.sheet==='Fields'&&!namePattern.test(item.fieldApi??''))throw Error('Invalid Field API Name');
 if(item.action==='HardDelete'&&value(r,'Revision')==='')throw Error('Hard Delete requires the exported Revision');
 if(item.action==='Delete'||item.action==='HardDelete')return;
 if(item.sheet==='Objects'){
  if(value(r,'Kind')==='Standard Object'&&item.action==='Create')throw Error('Standard objects cannot be created');
  if(value(r,'Label').length>200||value(r,'Description').length>10000)throw Error('Object property is too long');
  objectSettings(r);
 }else{
  if(value(r,'DataType')&&!typePattern.test(value(r,'DataType')))throw Error('Unsupported data type');
  if(value(r,'Label').length>160||value(r,'Description').length>1000||value(r,'HelpText').length>255)
   throw Error('Field property is too long');
  const f=fieldInput(r);
  if(f.picklistValues!==undefined&&(!Array.isArray(f.picklistValues)
   ||f.picklistValues.some((v:unknown)=>typeof v!=='string')))throw Error('PicklistValues must be a JSON string array');
  if(f.valueSettings!==undefined&&(typeof f.valueSettings!=='object'||f.valueSettings===null
   ||Array.isArray(f.valueSettings)))throw Error('ValueSettings must be a JSON object');
  if(!['','Lookup','Master-Detail','Hierarchical'].includes(value(r,'RelationshipType')))
   throw Error('Invalid relationship type');
  if(value(r,'FormulaExpression')&&!value(r,'FormulaReturnType'))throw Error('Formula return type is required');
 }
}
async function permitted(rbac:RbacEngine,actor:Actor,i:Item,exists:boolean){
 const t=actor.tenant_id,u=actor.user_id;
 if(i.sheet==='Objects'){
  if(i.action==='HardDelete'){
   await rbac.require(t,u,'ObjectDefinition','hard-delete');
   await rbac.require(t,u,i.objectApi,'edit');
  }
  else if(i.action==='Create'||i.action==='Upsert'&&!exists)await rbac.require(t,u,'ObjectDefinition','create');
  else{await rbac.require(t,u,'ObjectDefinition','manage');await rbac.require(t,u,i.objectApi,'edit');}
 }else{
  const resource=i.action==='HardDelete'?'hard-delete':i.action==='Create'||i.action==='Upsert'&&!exists?'create':'manage';
  await rbac.require(t,u,'FieldDefinition',resource);
  await rbac.require(t,u,i.objectApi,'edit');
 }
}
function validRevision(item:Item,current:MetadataObject|undefined){
 const v=value(item.cells,'Revision');
 if(!v)return;
 if(!/^(0|[1-9]\d*)$/.test(v))throw Error('Invalid Revision');
 if(current&&Number(v)!==Number((current as {revision?:number}).revision??0))
  throw Error('Metadata changed since export. Download the latest workbook');
}
function sortItems(items:Item[]){
 const rank=(i:Item)=>i.sheet==='Objects'&&!['Delete','HardDelete'].includes(i.action)?0:
  i.sheet==='Fields'&&!['Delete','HardDelete'].includes(i.action)?(value(i.cells,'RollupOperation')?2:1):
  i.sheet==='Fields'?3:4;
 return [...items].sort((a,b)=>rank(a)-rank(b)||a.excelRow-b.excelRow);
}
export function registerMetadataLoaderRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine,
 definitions:ObjectDefinitionService,metadata:ObjectManagerMetadataService,lifecycle:ObjectSchemaLifecycle){
 const route=(fn:(req:Req,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>
  void Promise.resolve(fn(req as Req,res)).catch(next);
 // Existing-flow Excel editor: XLSX transport only. No flow write route here.
 // The normal Flow Builder validator and draft-save path own mutations.
 app.post('/api/metadata/loader/flow-excel/write',route(async(req,res)=>{
   const actor=req.actor!;
   await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','read');
   const flowApi=req.body?.flowApi;
   if(typeof flowApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(flowApi))
     throw Error('Existing flow API name is required');
   const existing=await db.query<{id:string}>(
     'SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 AND archived=false ORDER BY version DESC LIMIT 1',
     [actor.tenant_id,flowApi]);
   if(!existing.rows[0])throw Error('Flow does not exist. Create it in Flow Builder first.');
   const tables=req.body?.tables;
   if(!Array.isArray(tables)||tables.length!==6||tables.some((t:unknown)=>{
     if(!t||typeof t!=='object')return true;
     const v=t as Record<string,unknown>;
     return typeof v.name!=='string'||!Array.isArray(v.columns)||!Array.isArray(v.rows)||v.rows.length>10000;
   }))throw Error('Invalid flow workbook tables');
   const manifest=(tables[0] as LoaderTable);
   if(manifest?.name!=='Manifest'||manifest.rows?.[0]?.['Flow API']!==flowApi)
     throw Error('Workbook target must match selected existing flow');
   const data=JSON.stringify(tables);
   if(data.length>1_000_000)throw Error('Flow workbook exceeds 1 MB');
   const buffer=writeLoaderWorkbook(tables as LoaderTable[]);
   res.set('Cache-Control','private, no-store');
   res.json({workbook:buffer.toString('base64')});
 }));
 app.post('/api/metadata/loader/flow-excel/read',route(async(req,res)=>{
   const actor=req.actor!;
   await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','manage');
   const flowApi=req.body?.flowApi;
   if(typeof flowApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(flowApi))
     throw Error('Existing flow API name is required');
   const existing=await db.query<{id:string}>(
     'SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 AND archived=false ORDER BY version DESC LIMIT 1',
     [actor.tenant_id,flowApi]);
   if(!existing.rows[0])throw Error('Flow does not exist. Create it in Flow Builder first.');
   const buffer=parse(req);
   if(buffer.length>5_000_000)throw Error('Flow workbook exceeds 5 MB');
   const tables=readLoaderWorkbook(buffer);
   if(tables.length!==6)throw Error('Flow Excel workbook requires 6 worksheets');
   if(tables[0]?.name!=='Manifest'||tables[0].rows[0]?.['Flow API']!==flowApi)
     throw Error('Workbook belongs to another flow');
   res.set('Cache-Control','private, no-store');
   res.json({tables});
 }));
 const parse=(req:Req)=>{
  const source=req.body?.workbook;
  if(typeof source!=='string'||source.length>14_000_000||!/^([A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source))
   throw Error('Invalid XLSX workbook payload');
  return Buffer.from(source,'base64');
 };
 const prepared=async(actor:Actor,buffer:Buffer)=>{
  const data=parseWorkbook(buffer);
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
  const definitionsNow=await definitions.list(actor.tenant_id);
  const existing=new Map(definitionsNow.map(o=>[o.apiName.toLowerCase(),o]));
  const planned=new Set(data.items.filter(i=>i.sheet==='Objects'
   &&['Create','Upsert'].includes(i.action)).map(i=>i.objectApi.toLowerCase()));
  const seen=new Map<string,Item>();
  for(const i of data.items){
   try{
    typedValidation(i);
    const id=i.sheet+'|'+fieldKey(i.objectApi,i.fieldApi??'');
    const first=seen.get(id);
    if(first){first.status='Error';first.message='Duplicate upload target';throw Error('Duplicate upload target');}
    seen.set(id,i);
    const obj=existing.get(i.objectApi.toLowerCase());
    const field=obj?.fields.find(f=>f.apiName.toLowerCase()===i.fieldApi?.toLowerCase());
    const exists=i.sheet==='Objects'?Boolean(obj):Boolean(field);
    const deleted=exists?false:Boolean((await db.query<{id:string}>(i.sheet==='Objects'
     ?'SELECT id FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 AND deleted_at IS NOT NULL'
     :'SELECT id FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NOT NULL',
     i.sheet==='Objects'?[actor.tenant_id,i.objectApi]:[actor.tenant_id,i.objectApi,i.fieldApi])).rowCount);
    await permitted(rbac,actor,i,exists||deleted);
    if(i.action==='Create'&&(exists||deleted))throw Error('Already exists or is soft-deleted; use Upsert');
    if(['Update','Delete'].includes(i.action)&&!exists)throw Error('Not found');
    if(i.action==='HardDelete'&&!exists&&!deleted)throw Error('Definition not found');
    if(i.sheet==='Objects'&&!exists&&!deleted&&['Create','Upsert'].includes(i.action)
      &&!value(i.cells,'Label'))throw Error('Object Label is required');
    if(i.sheet==='Fields'&&!exists&&!deleted&&['Create','Upsert'].includes(i.action)
      &&!value(i.cells,'Label'))throw Error('Field Label is required');
    if(i.sheet==='Objects'&&obj?.kind==='Standard Object'&&['Delete','HardDelete'].includes(i.action))
     throw Error('Standard objects cannot be deleted');
    if(i.sheet==='Fields'&&!obj&&!planned.has(i.objectApi.toLowerCase()))
     throw Error('Parent object does not exist or is not in the workbook');
    if(i.sheet==='Fields'&&i.action==='Create'&&!value(i.cells,'DataType'))throw Error('DataType is required');
    if(i.sheet==='Fields'&&i.action==='Upsert'&&!field&&!deleted&&!value(i.cells,'DataType'))throw Error('DataType is required for new fields');
    if(i.sheet==='Fields'&&value(i.cells,'TargetObject')){
     const target=value(i.cells,'TargetObject').toLowerCase();
     if(!existing.has(target)&&!planned.has(target))throw Error('Related object does not exist');
    }
    validRevision(i,obj);
    if(i.sheet==='Objects'&&['Delete'].includes(i.action)){
     const impact=await lifecycle.impact(actor.tenant_id,i.objectApi);
     if(impact.blockers.length)throw Error('Object has dependencies: '+impact.blockers.map(b=>b.kind).join(', '));
    }
    if(obj&&(i.action==='Delete'||i.action==='Update'||i.action==='Upsert'||i.action==='HardDelete'))
     await assertMetadataPackageEditable(db,actor.tenant_id,'object',i.objectApi);
    i.result=i.action==='Upsert'?(exists?'Update':deleted?'Restore + Update':'Create'):i.action;
    i.message='Validated';
   }catch(e){i.status='Error';i.message=e instanceof Error?e.message:String(e);}
  }
  const invalidObjects=new Set(data.items.filter(i=>i.sheet==='Objects'&&i.status==='Error').map(i=>i.objectApi.toLowerCase()));
  for(const i of data.items)if(i.sheet==='Fields'&&i.status==='Valid'&&invalidObjects.has(i.objectApi.toLowerCase())
    &&!existing.has(i.objectApi.toLowerCase())){i.status='Skipped';i.message='Depends on an invalid object row';}
  return data;
 };
 const summary=(items:Item[])=>({total:items.length,valid:items.filter(i=>i.status==='Valid').length,
  success:items.filter(i=>i.status==='Success').length,error:items.filter(i=>i.status==='Error').length,
  skipped:items.filter(i=>i.status==='Skipped').length});
 app.post('/api/metadata/loader/export',route(async(req,res)=>{
  const actor=req.actor!;
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
  await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','read');
  const selected=Array.isArray(req.body?.objects)?req.body.objects.filter((s:unknown)=>typeof s==='string'&&namePattern.test(s)) as string[]:[];
  if(selected.length>100)throw Error('Maximum 100 selected objects');
  const all=await definitions.list(actor.tenant_id);
  const objects=[] as typeof all;
  for(const o of all){
   if(selected.length&&!selected.includes(o.apiName))continue;
   if(!await rbac.allowed(actor.tenant_id,actor.user_id,o.apiName,'read'))continue;
   objects.push(o);
  }
  if(selected.some(s=>!objects.some(o=>o.apiName===s)))throw Error('Some selected objects are missing or inaccessible');
  const objectRows:Record<string,string>[]=[],fieldRows:Record<string,string>[]=[];
  for(const o of objects){
   const config=await metadata.load(actor.tenant_id,actor.user_id,o.apiName);
   objectRows.push(Object.fromEntries(Object.entries(objectExport(o,config as unknown as Record<string,unknown>)).map(([k,v])=>[k,nullable(v)])));
   for(const f of o.fields)if(await rbac.allowed(actor.tenant_id,actor.user_id,o.apiName+'.'+f.apiName,'read'))
    fieldRows.push(Object.fromEntries(Object.entries(fieldExport(o.apiName,f,(o as {revision?:number}).revision))
     .map(([k,v])=>[k,nullable(v)])));
  }
  const workbook=writeLoaderWorkbook([{name:'Objects',columns:objectColumns,rows:objectRows},
   {name:'Fields',columns:fieldColumns,rows:fieldRows}]);
  res.set('Cache-Control','private, no-store');res.json({workbook:workbook.toString('base64')});
 }));
 app.post('/api/metadata/loader/validate',route(async(req,res)=>{
  const actor=req.actor!,buffer=parse(req),data=await prepared(actor,buffer);
  const digest=createHash('sha256').update(buffer).digest('hex');
  res.set('Cache-Control','private, no-store');
  res.json({digest,summary:summary(data.items),
   rows:data.items.map(i=>({sheet:i.sheet,excelRow:i.excelRow,objectApi:i.objectApi,fieldApi:i.fieldApi,
    action:i.action,status:i.status,result:i.result,message:i.message})),
   report:writeReport(data.tables,data.items).toString('base64')});
 }));
 const updateObject=async(actor:Actor,o:MetadataObject,cell:Record<string,string>)=>{
  const cfg=await metadata.load(actor.tenant_id,actor.user_id,o.apiName);
  const draft={...o,...cfg,label:value(cell,'Label')||o.label,
   pluralLabel:value(cell,'PluralLabel')||cfg.pluralLabel,
   description:value(cell,'Description')==='<CLEAR>'?'':value(cell,'Description')||cfg.description,
   helpText:value(cell,'HelpText')==='<CLEAR>'?'':value(cell,'HelpText')||cfg.helpText,
   settings:objectSettings(cell,cfg.settings as unknown as Record<string,unknown>)};
  await assertMetadataPackageEditable(db,actor.tenant_id,'object-config',o.apiName);
  await definitions.replaceLayouts(actor.tenant_id,o.apiName,draft,Number(o.revision??0),actor.user_id,
   async(client:PoolClient)=>{await metadata.persistWithin(client,actor.tenant_id,o.apiName,draft);});
 };
 app.post('/api/metadata/loader/execute',route(async(req,res)=>{
  const actor=req.actor!,buffer=parse(req),digest=createHash('sha256').update(buffer).digest('hex');
  if(req.body?.digest!==digest||req.body?.confirmation!=='PROCEED_EXCLUDING_ERRORS')
   throw Error('Validate the exact workbook and confirm before execution');
  const data=await prepared(actor,buffer),invalidObjects=new Set<string>();
  const ordered=sortItems(data.items);
  for(const i of ordered){
   if(i.status!=='Valid'){if(i.sheet==='Objects')invalidObjects.add(i.objectApi.toLowerCase());continue;}
   if(i.sheet==='Fields'&&invalidObjects.has(i.objectApi.toLowerCase())){
    i.status='Skipped';i.message='Parent object failed';continue;
   }
   try{
    const current=await definitions.list(actor.tenant_id);
    const o=current.find(x=>x.apiName.toLowerCase()===i.objectApi.toLowerCase());
    const existing=o?.fields.find(f=>f.apiName.toLowerCase()===i.fieldApi?.toLowerCase());
    await permitted(rbac,actor,i,i.sheet==='Objects'?Boolean(o):Boolean(existing));
    if(i.sheet==='Objects'){
     if(i.action==='Delete'){if(!o)throw Error('Object not found');await lifecycle.delete(actor.tenant_id,i.objectApi,Number((o as {revision?:number}).revision??0));}
     else if(i.action==='HardDelete'){
      const impact=await lifecycle.impact(actor.tenant_id,i.objectApi);
      if(impact.isSystem||impact.blockers.length||impact.recordCount)
       throw Error('Hard Delete blocked: object has records or dependencies');
      const deletedNow=!impact.deleted;
      if(deletedNow){
       if(!o)throw Error('Object not available for deletion');
       await lifecycle.delete(actor.tenant_id,i.objectApi,Number(o.revision??0));
      }
      try{
       await db.transaction(async client=>{
        await client.query('DELETE FROM md_object_page_layouts WHERE tenant_id=$1 AND object_api=$2',
         [actor.tenant_id,i.objectApi]);
        await client.query('DELETE FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2',
         [actor.tenant_id,i.objectApi]);
        const result=await client.query(
         'DELETE FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 AND is_system=false AND deleted_at IS NOT NULL',
         [actor.tenant_id,i.objectApi]);
        if(!result.rowCount)throw Error('Object was not soft-deleted');
       });
      }catch(error){
       if(deletedNow)await lifecycle.restore(actor.tenant_id,i.objectApi);
       throw error;
      }
     }else if(!o){
      const deleted=(await db.query('SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 AND deleted_at IS NOT NULL',
       [actor.tenant_id,i.objectApi])).rowCount;
      if(deleted){
       if(i.action==='Create')throw Error('Object is soft-deleted; use Upsert');
       await lifecycle.restore(actor.tenant_id,i.objectApi);
       try{
        await updateObject(actor,await definitions.get(actor.tenant_id,i.objectApi),i.cells);
       }catch(error){
        const refreshed=await definitions.get(actor.tenant_id,i.objectApi);
        await lifecycle.delete(actor.tenant_id,i.objectApi,Number(refreshed.revision??0));
        throw error;
       }
      }else{
       const cell=i.cells,settings=objectSettings(cell);
       await definitions.create(actor.tenant_id,i.objectApi,value(cell,'Label'),[
        {apiName:'Name',label:value(cell,'Label')+' Name',
         dataType:value(cell,'RecordNameType')==='Auto Number'?'AutoNumber':'Text(80)',
         required:true,...(value(cell,'RecordNameType')==='Auto Number'
          ?{autoNumberFormat:value(cell,'RecordNameFormat')||'REC-{0000}'}:{})}
       ],async(client:PoolClient)=>{
        await metadata.persistWithin(client,actor.tenant_id,i.objectApi,{
         pluralLabel:value(cell,'PluralLabel')||value(cell,'Label'),description:value(cell,'Description'),
         helpText:value(cell,'HelpText'),settings});
       });
      }
     }else{
      if(i.action==='Create')throw Error('Object already exists');
      await updateObject(actor,o,i.cells);
     }
    }else{
     if(i.action==='Delete'){await definitions.deleteField(actor.tenant_id,i.objectApi,i.fieldApi!);}
     else if(i.action==='HardDelete'){
      const deletedNow=Boolean(existing);
      if(deletedNow)await definitions.deleteField(actor.tenant_id,i.objectApi,i.fieldApi!);
      try{
       await db.transaction(async client=>{
        const ids=await client.query<{id:string}>(
         'SELECT id FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NOT NULL FOR UPDATE',
         [actor.tenant_id,i.objectApi,i.fieldApi]);
        if(!ids.rows[0])throw Error('Field was not soft-deleted');
        await client.query('DELETE FROM md_record_history WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
         [actor.tenant_id,i.objectApi,i.fieldApi]);
        await client.query('DELETE FROM md_record_values WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
         [actor.tenant_id,i.objectApi,i.fieldApi]);
        await client.query('DELETE FROM md_object_page_layout_fields WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
         [actor.tenant_id,i.objectApi,i.fieldApi]);
        await client.query('DELETE FROM md_object_record_type_values WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
         [actor.tenant_id,i.objectApi,i.fieldApi]);
        await client.query('DELETE FROM md_page_component_properties WHERE tenant_id=$1 AND field_id=$2',
         [actor.tenant_id,ids.rows[0].id]);
        const result=await client.query(
         'DELETE FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NOT NULL',
         [actor.tenant_id,i.objectApi,i.fieldApi]);
        if(!result.rowCount)throw Error('Field was not soft-deleted');
       });
      }catch(error){
       if(deletedNow)await definitions.restoreField(actor.tenant_id,i.objectApi,i.fieldApi!);
       throw error;
      }
     }else{
      let target=existing;
      let restoredNow=false;
      if(!target){
       const deleted=(await db.query('SELECT 1 FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NOT NULL',
        [actor.tenant_id,i.objectApi,i.fieldApi])).rowCount;
       if(deleted){
        if(i.action==='Create')throw Error('Field is soft-deleted; use Upsert');
        const restored=await definitions.restoreField(actor.tenant_id,i.objectApi,i.fieldApi!);
        target=restored.fields.find(f=>f.apiName===i.fieldApi);
        restoredNow=true;
       }
      }
      if(!target){
       const field=fieldInput(i.cells);
       if(typeof field.dataType!=='string'||typeof field.label!=='string'||!field.label)throw Error('New field needs Label and DataType');
       await definitions.addField(actor.tenant_id,i.objectApi,i.fieldApi!,field.dataType,
        (field.relationship as {targetObject?:string}|undefined)?.targetObject,field.label,field);
      }else{
       if(i.action==='Create')throw Error('Field already exists');
       const proposal=fieldInput(i.cells,target);
       if(!proposal.label)throw Error('Field label is missing');
       const changed:Record<string,unknown>={label:proposal.label,apiName:i.fieldApi};
       for(const [key,v] of Object.entries(proposal)){
        if(key==='label'||key==='apiName')continue;
        if(JSON.stringify((target as unknown as Record<string,unknown>)[key])!==JSON.stringify(v))changed[key]=v;
       }
       if(Object.keys(changed).length>2){
        try{await definitions.updateField(actor.tenant_id,i.objectApi,i.fieldApi!,changed,actor.user_id);}
        catch(error){
         if(restoredNow)await definitions.deleteField(actor.tenant_id,i.objectApi,i.fieldApi!);
         throw error;
        }
       }else i.result='Unchanged';
      }
     }
    }
    i.status='Success';i.message='Executed';if(!i.result)i.result=i.action;
   }catch(error){
    i.status='Error';i.message=error instanceof Error?error.message:String(error);
    if(i.sheet==='Objects')invalidObjects.add(i.objectApi.toLowerCase());
   }
  }
  const report=writeReport(data.tables,data.items);
  res.set('Cache-Control','private, no-store');
  res.json({summary:summary(data.items),rows:data.items.map(i=>({sheet:i.sheet,excelRow:i.excelRow,
   objectApi:i.objectApi,fieldApi:i.fieldApi,action:i.action,status:i.status,result:i.result,message:i.message})),
   report:report.toString('base64')});
 }));
}
