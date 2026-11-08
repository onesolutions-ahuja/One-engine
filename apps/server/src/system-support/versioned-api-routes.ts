import {createHash} from 'node:crypto';
import type {Express,NextFunction,Request,Response} from 'express';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {parseRecordCursor,type RecordFilter} from '../system-files/record-query.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

const version='v1.0';
const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Actor={tenant_id:string;user_id:string};
type ApiRequest=Request<Record<string,string>>&{actor?:Actor};
type QueryPlan={objectApi:string;fields:string[];filters:RecordFilter[];filterLogic?:string;
  sortField?:string;sortDirection?:'asc'|'desc';limit:number;offset:number};
type SearchPlan={search:string;objectApi:string;fields:string[];limit:number};
type QueryLocator={kind:'query';tenantId:string;userId:string;query:string;
  queryHash:string;cursor:string;offset:number;expiresAt:number};
type QueryToken={kind:'identifier';value:string}|{kind:'literal';value:string}|{kind:'symbol';value:string};

function route(handler:(req:ApiRequest,res:Response)=>Promise<void>){
 return (req:Request,res:Response,next:NextFunction)=>{
  void handler(req as ApiRequest,res).catch(next);
 };
}

function tokenizeWhere(source:string):QueryToken[]{
 const tokens:QueryToken[]=[];
 let index=0;
 while(index<source.length){
  if(/\s/.test(source[index]??'')){index++;continue;}
  const rest=source.slice(index);
  const quoted=/^'((?:[^']|'')*)'/.exec(rest);
  if(quoted){tokens.push({kind:'literal',value:quoted[1].replace(/''/g,"'")});index+=quoted[0].length;continue;}
  const word=/^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
  if(word){tokens.push({kind:'identifier',value:word[0]});index+=word[0].length;continue;}
  const number=/^-?(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
  if(number){tokens.push({kind:'literal',value:number[0]});index+=number[0].length;continue;}
  const symbol=/^(?:<=|>=|!=|=|<|>|\(|\)|,)/.exec(rest);
  if(symbol){tokens.push({kind:'symbol',value:symbol[0]});index+=symbol[0].length;continue;}
  throw new Error('Invalid SOQL WHERE clause');
 }
 return tokens;
}

export function parseSalesforceQuery(raw:string):QueryPlan{
 if(typeof raw!=='string'||raw.length>8192)throw new Error('Invalid SOQL query');
 if(raw.replace(/;\s*$/,'').includes(';'))throw new Error('Unsupported SOQL query shape');
 const match=/^\s*SELECT\s+(.+?)\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*;?\s*$/i.exec(raw);
 if(!match)throw new Error('Unsupported SOQL query shape');
 const fields=match[1].split(',').map(field=>field.trim());
 if(!fields.length||fields.length>100||fields.some(field=>!identifier.test(field))
  ||new Set(fields).size!==fields.length)throw new Error('Invalid SOQL SELECT fields');
 const plan:QueryPlan={objectApi:match[2],fields,filters:[],
  ...(match[4]?{sortField:match[4],sortDirection:(match[5]??'ASC').toLowerCase() as 'asc'|'desc'}:{}),
  limit:match[6]===undefined?200:Number(match[6]),offset:match[7]===undefined?0:Number(match[7])};
 if(plan.limit<1||plan.limit>2000||plan.offset>2000)throw new Error('SOQL LIMIT or OFFSET is outside the supported range');
 const where=match[3];
 if(!where)return plan;
 const tokens=tokenizeWhere(where);
 let position=0;
 type Node={filter:number}|{operator:'AND'|'OR';left:Node;right:Node};
 const consume=(value:string)=>tokens[position]?.value.toUpperCase()===value
  ?(position++,true):false;
 const parsePrimary=():Node=>{
  if(consume('(')){
   const node=parseOr();
   if(!consume(')'))throw new Error('Invalid SOQL WHERE clause');
   return node;
  }
  const field=tokens[position++];
  if(field?.kind!=='identifier'||!identifier.test(field.value))throw new Error('Invalid SOQL filter field');
  const operatorToken=tokens[position++];
  if(operatorToken?.kind!=='symbol'&&operatorToken?.kind!=='identifier')
   throw new Error('Invalid SOQL comparison');
  const operator=operatorToken.value.toUpperCase();
  let filter:RecordFilter;
  if(operator==='IN'){
   if(!consume('('))throw new Error('SOQL IN requires a value list');
   const values:string[]=[];
   do{
    const value=tokens[position++];
    if(value?.kind!=='literal'||values.length>=100)throw new Error('Invalid SOQL IN values');
    values.push(value.value);
   }while(consume(','));
   if(!consume(')'))throw new Error('Invalid SOQL IN values');
   filter={field:field.value,operator:'in',value:values};
  }else{
   const value=tokens[position++];
   if(value?.kind!=='literal')throw new Error('SOQL filters require literal values');
   const operators:Record<string,RecordFilter['operator']>={
    '=':'eq','!=':'ne','<':'lt','<=':'lte','>':'gt','>=':'gte'
   };
   const mapped=operators[operator];
   if(operator==='LIKE'){
    const starts=value.value.startsWith('%'),ends=value.value.endsWith('%');
    const wildcardCount=(value.value.match(/%/g)??[]).length;
    if(value.value.includes('_')||wildcardCount>(starts?1:0)+(ends?1:0)||starts&&!ends)
     throw new Error('Unsupported SOQL LIKE pattern');
    const literal=value.value.replace(/^%|%$/g,'');
    if(!literal)throw new Error('Invalid SOQL LIKE pattern');
    filter={field:field.value,operator:starts&&ends?'contains':ends?'startsWith':'eq',value:literal};
   }else{
    if(!mapped)throw new Error('Unsupported SOQL comparison operator');
    filter={field:field.value,operator:mapped,value:value.value};
   }
  }
  const index=plan.filters.push(filter)-1;
  return {filter:index};
 };
 const parseAnd=():Node=>{
  let node=parsePrimary();
  while(consume('AND'))node={operator:'AND',left:node,right:parsePrimary()};
  return node;
 };
 const parseOr=():Node=>{
  let node=parseAnd();
  while(consume('OR'))node={operator:'OR',left:node,right:parseAnd()};
  return node;
 };
 const tree=parseOr();
 if(position!==tokens.length)throw new Error('Invalid SOQL WHERE clause');
 const render=(node:Node):string=>'filter'in node?String(node.filter+1)
  :`(${render(node.left)} ${node.operator} ${render(node.right)})`;
 plan.filterLogic=render(tree);
 return plan;
}

export function parseSalesforceSearch(raw:string):SearchPlan{
 if(typeof raw!=='string'||raw.length>2048)throw new Error('Invalid SOSL search');
 const match=/^\s*FIND\s+\{([^{}]{1,256})\}\s+IN\s+ALL\s+FIELDS\s+RETURNING\s+([A-Za-z][A-Za-z0-9_]*)\s*\(([^()]*)\)(?:\s+LIMIT\s+(\d+))?\s*$/i.exec(raw);
 if(!match||!match[1].trim())throw new Error('Unsupported SOSL search shape');
 const fields=match[3].split(',').map(field=>field.trim());
 if(!fields.length||fields.length>100||fields.some(field=>!identifier.test(field))
  ||new Set(fields).size!==fields.length)throw new Error('Invalid SOSL fields');
 const limit=match[4]===undefined?200:Number(match[4]);
 if(limit<1||limit>2000)throw new Error('SOSL LIMIT is outside the supported range');
 return {search:match[1].trim(),objectApi:match[2],fields,limit};
}

function describeType(dataType:string):string{
 const normalized=dataType.toLowerCase();
 if(normalized.startsWith('text')||normalized==='textarea'||normalized==='long text area')return 'string';
 if(normalized.startsWith('formula('))return 'string';
 const types:Record<string,string>={number:'double',currency:'currency',percent:'percent',
  checkbox:'boolean',date:'date','date/time':'datetime',datetime:'datetime',email:'email',
  phone:'phone',url:'url',picklist:'picklist','multi-select picklist':'multipicklist',
  lookup:'reference','text (encrypted)':'encryptedstring',address:'address',geolocation:'location'};
 return types[normalized]??'string';
}

function salesforceRecord(objectApi:string,record:Record<string,unknown>){
 const result:Record<string,unknown>={};
 for(const [key,value] of Object.entries(record)){
  if(key==='CreatedAt')result.CreatedDate=value;
  else if(key==='LastModifiedDate')result.LastModifiedDate=value;
  else if(key!=='__isClone')result[key]=value;
 }
 const id=result.Id;
 if(typeof id==='string')result.attributes={type:objectApi,
  url:`/services/data/${version}/sobjects/${encodeURIComponent(objectApi)}/${encodeURIComponent(id)}`};
 return result;
}

function decodeLocator(raw:string):QueryLocator{
 if(raw.length>8192)throw new Error('Invalid query locator');
 let value:unknown;
 try{value=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));}catch{throw new Error('Invalid query locator');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid query locator');
 const locator=value as Record<string,unknown>;
 if(locator.kind!=='query'||typeof locator.tenantId!=='string'||typeof locator.userId!=='string'
  ||typeof locator.query!=='string'||typeof locator.queryHash!=='string'
  ||typeof locator.cursor!=='string'||typeof locator.offset!=='number'
  ||!Number.isInteger(locator.offset)||locator.offset<1||locator.offset>2000
  ||typeof locator.expiresAt!=='number'||locator.expiresAt<Date.now()
  ||createHash('sha256').update(locator.query).digest('hex')!==locator.queryHash)
  throw new Error('Invalid query locator');
 return locator as QueryLocator;
}

export function registerVersionedApiRoutes(app:Express,records:RecordEngine,
 definitions:ObjectDefinitionService,rbac:RbacEngine,db:SqlPersistence){
 app.use('/services/data',(_req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  next();
 });
 const assertVersion=(value:string)=>{
  if(value!==version)throw new Error('Unsupported REST API version');
 };
 const objectMetadata=async(tenantId:string,userId:string,objectApi:string)=>{
  await rbac.require(tenantId,userId,'ObjectDefinition','read');
  await rbac.require(tenantId,userId,objectApi,'read');
  const object=await definitions.get(tenantId,objectApi);
  const canCreate=await rbac.allowed(tenantId,userId,objectApi,'create');
  const canUpdate=await rbac.allowed(tenantId,userId,objectApi,'edit');
  const canDelete=await rbac.allowed(tenantId,userId,objectApi,'delete');
  const fields=[];
  for(const field of object.fields){
   if(!await rbac.allowed(tenantId,userId,objectApi+'.'+field.apiName,'read'))continue;
   const match=/\((\d+)(?:,\s*(\d+))?\)/.exec(field.dataType);
   const type=describeType(field.dataType);
   const canCreateField=await rbac.allowed(tenantId,userId,objectApi+'.'+field.apiName,'create');
   const canUpdateField=await rbac.allowed(tenantId,userId,objectApi+'.'+field.apiName,'edit');
   fields.push({name:field.apiName,label:field.label,type,
    ...(type==='string'&&match?{length:Number(match[1])}:{}),
    ...(['double','currency','percent'].includes(type)&&match
      ?{precision:Number(match[1]),scale:Number(match[2]??0)}:{}),nillable:!field.required,
    createable:canCreateField&&!['formula','rollup','autonumber'].includes(field.dataType.toLowerCase()),
    updateable:canUpdateField&&!['formula','rollup','autonumber'].includes(field.dataType.toLowerCase()),
    unique:field.unique===true,externalId:field.externalId===true,
    ...(field.relationship?{referenceTo:[field.relationship.targetObject],
      relationshipName:field.relationship.relationshipName}:{}),
    ...(field.description?{inlineHelpText:field.description}:{})});
  }
  return {name:object.apiName,label:object.label,custom:object.kind==='Custom Object',
   keyPrefix:null,queryable:true,searchable:true,createable:canCreate,updateable:canUpdate,deletable:canDelete,
   fields};
 };
 const objectValues=(raw:unknown,objectApi:string)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid composite record');
  const item=raw as Record<string,unknown>;
  const attributes=item.attributes;
  if(attributes!==undefined&&(!attributes||typeof attributes!=='object'||Array.isArray(attributes)
    ||(attributes as Record<string,unknown>).type!==objectApi))
   throw new Error('Composite record object type does not match the request');
  const {attributes:_attributes,...values}=item;
  return values;
 };
 const collection=async(actor:Actor,objectApi:string,raw:unknown,allOrNone:boolean)=>{
  if(!Array.isArray(raw)||raw.length<1||raw.length>200)throw new Error('Invalid composite record batch');
  const values=raw.map(item=>objectValues(item,objectApi));
  if(allOrNone){
   const result=await records.importRecords(actor.tenant_id,actor.user_id,objectApi,values);
   return result.ids.map(id=>({id,success:true,errors:[]}));
  }
  const results=[];
  for(const item of values){
   try{
    const id=typeof item.Id==='string'?item.Id:undefined;
    if(id)await records.update(actor.tenant_id,actor.user_id,objectApi,id,
      Object.fromEntries(Object.entries(item).filter(([key])=>key!=='Id')));
    else if(Object.hasOwn(item,'Id'))throw new Error('Invalid composite record ID');
    const resultId=id??await records.create(actor.tenant_id,actor.user_id,objectApi,item);
    results.push({id:resultId,success:true,errors:[]});
   }catch(error){
    results.push({id:typeof item.Id==='string'?item.Id:null,success:false,
     errors:[error instanceof Error?error.message:'Composite record failed']});
   }
  }
  return results;
 };
 const executeSubrequest=async(actor:Actor,method:string,path:string,body:unknown)=>{
  const match=/^\/services\/data\/v1\.0\/sobjects\/([A-Za-z][A-Za-z0-9_]*)(?:\/([0-9a-f-]{36}))?$/.exec(path);
  if(!match)throw new Error('Unsupported composite subrequest URL');
  const objectApi=match[1],id=match[2];
  if(method==='GET'&&id){
   const record=await records.get(actor.tenant_id,actor.user_id,objectApi,id);
   return {status:200,body:salesforceRecord(objectApi,record)};
  }
  if(method==='POST'&&!id){
   const values=objectValues(body,objectApi);
   const created=await records.create(actor.tenant_id,actor.user_id,objectApi,values);
   return {status:201,body:{id:created,success:true,errors:[]}};
  }
  if(method==='PATCH'&&id){
   if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid composite subrequest body');
   await records.update(actor.tenant_id,actor.user_id,objectApi,id,body as Record<string,unknown>);
   return {status:204,body:null};
  }
  if(method==='DELETE'&&id){
   await records.remove(actor.tenant_id,actor.user_id,objectApi,id);
   return {status:204,body:null};
  }
  throw new Error('Unsupported composite subrequest method');
 };
 const queryPage=async(req:ApiRequest,res:Response,raw:string,cursor?:string,offset=0)=>{
  const actor=req.actor!;
  const plan=parseSalesforceQuery(raw);
  const object=await objectMetadata(actor.tenant_id,actor.user_id,plan.objectApi);
  const visibleFields=new Set(object.fields.map(field=>field.name));
  const systemFields=new Set(['Id','CreatedDate','LastModifiedDate','OwnerId','RecordTypeId']);
  for(const field of plan.fields)
   if(!systemFields.has(field)&&!visibleFields.has(field))throw new Error('Invalid or unreadable SOQL field');
  if(plan.sortField&&!systemFields.has(plan.sortField)&&!visibleFields.has(plan.sortField))
   throw new Error('Invalid or unreadable SOQL sort field');
  const pageSize=Math.min(100,plan.limit);
  const page=await records.list(actor.tenant_id,actor.user_id,plan.objectApi,pageSize,
   cursor?0:plan.offset,{filters:plan.filters,filterLogic:plan.filterLogic,
    sortField:plan.sortField,sortDirection:plan.sortDirection,
    cursor:cursor?parseRecordCursor(cursor):undefined});
  const end=Math.min(page.total,plan.offset+plan.limit);
  const nextOffset=(cursor?offset:plan.offset)+page.records.length;
  const nextCursor=page.nextCursor;
  const hasMore=nextOffset<end&&nextCursor!==undefined;
  const hash=createHash('sha256').update(raw).digest('hex');
  const locator=hasMore?Buffer.from(JSON.stringify({kind:'query',tenantId:actor.tenant_id,
   userId:actor.user_id,query:raw,queryHash:hash,cursor:nextCursor!,offset:nextOffset,
   expiresAt:Date.now()+15*60*1000} satisfies QueryLocator))
    .toString('base64url'):undefined;
  res.json({totalSize:Math.min(page.total,plan.limit+plan.offset),done:!hasMore,
   records:page.records.map(row=>{
    const source=salesforceRecord(plan.objectApi,row);
    const selected:Record<string,unknown>={};
    for(const field of plan.fields)if(Object.hasOwn(source,field))selected[field]=source[field];
    selected.attributes=source.attributes;
    return selected;
   }),...(locator?{nextRecordsUrl:`/services/data/${version}/query/${locator}`}:{})});
 };

 app.get('/services/data',route(async(_req,res)=>{res.json([{version:'1.0',label:'MetaDrive REST API v1.0',
  url:'/services/data/v1.0',latest:true}]);}));
 app.get('/services/data/:version',route(async(req,res)=>{
  assertVersion(req.params.version);
  res.json({sobjects:`/services/data/${version}/sobjects`,
   query:`/services/data/${version}/query`,search:`/services/data/${version}/search`,
   limits:`/services/data/${version}/limits`});
 }));
 app.get('/services/data/:version/limits',route(async(req,res)=>{
  assertVersion(req.params.version);
  const tenantId=req.actor!.tenant_id;
  const [usage,target]=await Promise.all([
   db.query<{request_count:string}>(`SELECT COALESCE(request_count,0)::text AS request_count
    FROM md_tenant_api_usage_daily WHERE tenant_id=$1 AND usage_date=CURRENT_DATE`,[tenantId]),
   db.query<{target_value:string}>(`SELECT target_value::text AS target_value
    FROM md_tenant_usage_targets WHERE tenant_id=$1 AND metric='api_requests_daily'`,[tenantId])
  ]);
  const used=Number(usage.rows[0]?.request_count??0);
  const max=target.rows[0]?Number(target.rows[0].target_value):null;
  res.json({MetaDrive:{restApiVersion:version,maxQueryPageSize:100,maxQueryRows:2000,
   maxCompositeSubrequests:25,maxBulkRecords:200,apiRequestsUsedToday:used,
   apiRequestsTarget:max,apiRequestTargetEnforcement:'advisory_only'},
   ...(max===null?{}:{DailyApiRequests:{Max:max,Remaining:Math.max(0,max-used)}})});
 }));
 app.get('/services/data/:version/sobjects',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!;
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
  const objects=await definitions.list(actor.tenant_id);
  const visible=[];
  for(const object of objects)if(await rbac.allowed(actor.tenant_id,actor.user_id,object.apiName,'read'))
   visible.push({name:object.apiName,label:object.label,custom:object.kind==='Custom Object',
    keyPrefix:null,queryable:true,searchable:true,
    createable:await rbac.allowed(actor.tenant_id,actor.user_id,object.apiName,'create'),
    updateable:await rbac.allowed(actor.tenant_id,actor.user_id,object.apiName,'edit'),
    deletable:await rbac.allowed(actor.tenant_id,actor.user_id,object.apiName,'delete'),
    urls:{describe:`/services/data/${version}/sobjects/${object.apiName}/describe`,
     sobject:`/services/data/${version}/sobjects/${object.apiName}/{ID}`}});
  res.json({sobjects:visible});
 }));
 app.get('/services/data/:version/sobjects/:objectApi/describe',route(async(req,res)=>{
  assertVersion(req.params.version);
  res.json(await objectMetadata(req.actor!.tenant_id,req.actor!.user_id,req.params.objectApi));
 }));
 app.post('/services/data/:version/sobjects/:objectApi',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!;
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new Error('Invalid record values');
  const id=await records.create(actor.tenant_id,actor.user_id,req.params.objectApi,req.body);
  res.status(201).json({id,success:true,errors:[]});
 }));
 app.get('/services/data/:version/sobjects/:objectApi/:id',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!;
  if(!uuid.test(req.params.id))throw new Error('Invalid record ID');
  const record=await records.get(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id);
  res.json(salesforceRecord(req.params.objectApi,record));
 }));
 app.patch('/services/data/:version/sobjects/:objectApi/:id',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!;
  if(!uuid.test(req.params.id)||!req.body||typeof req.body!=='object'||Array.isArray(req.body))
   throw new Error('Invalid record values');
  await records.update(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id,req.body,
   req.get('if-unmodified-since'));
  res.status(204).end();
 }));
 app.delete('/services/data/:version/sobjects/:objectApi/:id',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!;
  if(!uuid.test(req.params.id))throw new Error('Invalid record ID');
  await records.remove(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id);
  res.status(204).end();
 }));
 app.get('/services/data/:version/query',route(async(req,res)=>{
  assertVersion(req.params.version);
  if(typeof req.query.q!=='string')throw new Error('SOQL query is required');
  await queryPage(req,res,req.query.q);
 }));
 app.get('/services/data/:version/query/:locator',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!,locator=decodeLocator(req.params.locator);
  if(locator.tenantId!==actor.tenant_id||locator.userId!==actor.user_id)
   throw new Error('Query locator is not available to this session');
  await queryPage(req,res,locator.query,locator.cursor,locator.offset);
 }));
 app.get('/services/data/:version/search',route(async(req,res)=>{
  assertVersion(req.params.version);
  if(typeof req.query.q!=='string')throw new Error('SOSL search is required');
  const actor=req.actor!,plan=parseSalesforceSearch(req.query.q);
  const object=await objectMetadata(actor.tenant_id,actor.user_id,plan.objectApi);
  const available=new Set(object.fields.map(field=>field.name));
  for(const field of plan.fields)
   if(!['Id','CreatedDate','LastModifiedDate','OwnerId','RecordTypeId'].includes(field)
    &&!available.has(field))throw new Error('Invalid or unreadable SOSL field');
  const page=await records.list(actor.tenant_id,actor.user_id,plan.objectApi,
   Math.min(100,plan.limit),0,{search:plan.search});
  res.json([{searchRecords:page.records.map(row=>{
   const source=salesforceRecord(plan.objectApi,row);
   const selected:Record<string,unknown>={};
   for(const field of plan.fields)if(Object.hasOwn(source,field))selected[field]=source[field];
   selected.attributes=source.attributes;
   return selected;
  })}]);
 }));
 app.post('/services/data/:version/composite/sobjects',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!;
  const recordsBody=req.body?.records;
  if(!Array.isArray(recordsBody)||!recordsBody.length)throw new Error('Invalid composite record batch');
  const first=recordsBody[0] as Record<string,unknown>;
  const objectApi=(first?.attributes as Record<string,unknown>|undefined)?.type;
  if(typeof objectApi!=='string'||!identifier.test(objectApi))throw new Error('Composite records require an attributes.type');
  if(recordsBody.some(item=>!item||typeof item!=='object'||Array.isArray(item)
   ||Object.hasOwn(item as object,'Id')))
   throw new Error('Composite create records must not contain an Id');
  const allOrNone=req.body?.allOrNone!==false;
  const results=await collection(actor,objectApi,recordsBody,allOrNone);
  res.status(200).json({hasErrors:results.some(item=>!item.success),results});
 }));
 app.patch('/services/data/:version/composite/sobjects/:objectApi',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!,recordsBody=req.body?.records;
  if(!Array.isArray(recordsBody)||!recordsBody.length)throw new Error('Invalid composite record batch');
  if(recordsBody.some(item=>!item||typeof item!=='object'||Array.isArray(item)
   ||typeof (item as Record<string,unknown>).Id!=='string'))
   throw new Error('Composite update records require an Id');
  const results=await collection(actor,req.params.objectApi,recordsBody,req.body?.allOrNone!==false);
  res.status(200).json({hasErrors:results.some(item=>!item.success),results});
 }));
 app.post('/services/data/:version/composite/tree/:objectApi',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!,recordsBody=req.body?.records;
  if(!Array.isArray(recordsBody)||recordsBody.length<1||recordsBody.length>200)
   throw new Error('Invalid composite tree');
  const values=recordsBody.map(item=>objectValues(item,req.params.objectApi));
  if(values.some(item=>Object.hasOwn(item,'Id')||Object.values(item).some(value=>Array.isArray(value)
   ||(value&&typeof value==='object'&&Object.hasOwn(value as object,'records')))))
   throw new Error('Nested composite tree relationships are not supported by this API version');
  const result=await records.importRecords(actor.tenant_id,actor.user_id,req.params.objectApi,values);
  res.status(201).json({hasErrors:false,results:result.ids.map((id,index)=>({
   referenceId:(recordsBody[index] as Record<string,unknown>)?.attributes
    &&((recordsBody[index] as Record<string,unknown>).attributes as Record<string,unknown>).referenceId
      ?String(((recordsBody[index] as Record<string,unknown>).attributes as Record<string,unknown>).referenceId)
      :String(index),id,success:true,errors:[]
  }))});
 }));
 app.post('/services/data/:version/composite',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!,requests=req.body?.compositeRequest;
  if(req.body?.allOrNone!==false)
   throw new Error('Composite allOrNone must be false; atomic mixed-resource rollback is not supported');
  if(!Array.isArray(requests)||requests.length<1||requests.length>25)
   throw new Error('Invalid composite request batch');
  const ids=new Set<string>(),results=[];
  for(const item of requests){
   if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid composite subrequest');
   const request=item as Record<string,unknown>;
   if(typeof request.referenceId!=='string'||!identifier.test(request.referenceId)
    ||ids.has(request.referenceId)||typeof request.method!=='string'||typeof request.url!=='string')
    throw new Error('Invalid composite subrequest');
   ids.add(request.referenceId);
   try{
    const result=await executeSubrequest(actor,request.method.toUpperCase(),request.url,request.body);
    results.push({referenceId:request.referenceId,httpStatusCode:result.status,body:result.body});
   }catch(error){
    results.push({referenceId:request.referenceId,httpStatusCode:400,
     body:{error:error instanceof Error?error.message:'Composite subrequest failed'}});
   }
  }
  res.json({compositeResponse:results});
 }));
 app.post('/services/data/:version/composite/batch',route(async(req,res)=>{
  assertVersion(req.params.version);
  const actor=req.actor!,requests=req.body?.batchRequests;
  if(!Array.isArray(requests)||requests.length<1||requests.length>25
   ||(req.body?.haltOnError!==undefined&&typeof req.body.haltOnError!=='boolean'))
   throw new Error('Invalid composite batch');
  const results=[];
  for(const item of requests){
   if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid batch subrequest');
   const request=item as Record<string,unknown>;
   if(typeof request.method!=='string'||typeof request.url!=='string')
    throw new Error('Invalid batch subrequest');
   try{
    const result=await executeSubrequest(actor,request.method.toUpperCase(),request.url,request.richInput);
    results.push({statusCode:result.status,result:result.body});
   }catch(error){
    results.push({statusCode:400,result:{error:error instanceof Error?error.message:'Batch subrequest failed'}});
    if(req.body?.haltOnError===true)break;
   }
  }
  res.json({hasErrors:results.some(item=>item.statusCode>=400),results});
 }));
 app.use('/services/data/:version',route(async(req,res)=>{
  assertVersion(req.params.version);
  res.status(404).json({error:'REST resource not found'});
 }));
}
