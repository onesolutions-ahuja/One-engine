import type {Express,NextFunction,Request,Response} from 'express';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {StalwartJmapClient, StalwartJmapError, type StalwartJmapResponse, type StalwartJmapSession} from './stalwart-jmap-client.js';

type Actor={tenant_id:string;user_id:string};
type MailRequest=Request<Record<string,string>>&{actor?:Actor};
type MailObject=Record<string,unknown>;
const localPart=/^[a-zA-Z0-9](?:[a-zA-Z0-9._+-]{0,62}[a-zA-Z0-9])?$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wrap=(fn:(req:MailRequest,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{
 void fn(req as MailRequest,res).catch(next);
};
const actorOf=(req:MailRequest):Actor=>{
 if(!req.actor?.tenant_id||!req.actor.user_id)throw new Error('Authenticated tenant required');
 return req.actor;
};
const object=(value:unknown):MailObject=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid Stalwart response');
 return value as MailObject;
};
const responseObject=(response:StalwartJmapResponse,method:string):MailObject=>{
 const result=response.methodResponses?.find(item=>item[0]===method);
 if(!result)throw new Error('Stalwart response omitted the requested result');
 return object(result[1]);
};
/** Keep actionable failure categories in server logs without disclosing provider payloads or credentials. */
const logMailError=(operation:string,error:unknown)=>{
 const pgCode=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'
  &&/^[0-9A-Z]{5}$/.test(error.code)?error.code:undefined;
 const httpStatus=error instanceof StalwartJmapError?error.status:undefined;
 console.error('Mail administration request failed',JSON.stringify({
  operation,kind:error instanceof Error?error.name:'unknown',
  ...(pgCode?{sqlstate:pgCode}:{}),
  ...(httpStatus?{providerHttpStatus:httpStatus}:{})
 }));
};
const safeError=(error:unknown):string=>{
 if(error instanceof Error&&/not configured|unavailable|permission|invalid|already exists|not found|password|domain/i.test(error.message))
  return error.message;
 return 'Mail service request failed';
};

/**
 * Server-side adapter for Stalwart 0.16+ management JMAP.
 * The API key is process configuration only; it is never accepted from HTTP requests.
 * Tenant membership is represented by a deterministic internal Group account. This uses
 * standard Community-compatible Account/Group features rather than Enterprise-only tenant fields.
 */
export class StalwartMailService {
 private client?:StalwartJmapClient;
 private session?:StalwartJmapSession;
 constructor(private readonly baseUrl=process.env.STALWART_BASE_URL??'http://127.0.0.1:8080',
  private readonly apiKey=process.env.STALWART_API_KEY??'',
  private readonly allowedDomains=(process.env.STALWART_ALLOWED_DOMAINS??'unesolutions.co.uk').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)){}
 private async ready(){
  if(!this.apiKey.trim())throw new Error('Stalwart API key is not configured');
  if(!this.client)this.client=new StalwartJmapClient(this.baseUrl,this.apiKey);
  if(!this.session)this.session=await this.client.discoverSession();
  return this.session;
 }
 private async call(method:string,args:MailObject){
  const session=await this.ready();
  if(!this.client)throw new Error('Stalwart API client is unavailable');
  return this.client.call(session,method,args);
 }
 async listDomains(){
  const query=responseObject(await this.call('x:Domain/query',{filter:{},limit:200}),'x:Domain/query');
  const ids=Array.isArray(query.ids)?query.ids.filter((id):id is string=>typeof id==='string'):[];
  if(!ids.length)return [];
  const get=responseObject(await this.call('x:Domain/get',{ids}),'x:Domain/get');
  const list=Array.isArray(get.list)?get.list:[];
  return list.map(object).filter(item=>typeof item.id==='string'&&typeof item.name==='string'
    &&this.allowedDomains.includes((item.name as string).toLowerCase()))
   .map(item=>({id:item.id as string,name:item.name as string,isEnabled:item.isEnabled!==false}));
 }
 private async tenantGroup(tenantId:string,create:boolean,preferredDomainId?:string):Promise<string|undefined>{
  if(!uuid.test(tenantId))throw new Error('Invalid tenant identifier');
  const domains=await this.listDomains();
  if(!domains.length)throw new Error('No allowed mail domain is configured');
  const name='mdt'+tenantId.replace(/-/g,'').toLowerCase();
  for(const domain of domains){
   const query=responseObject(await this.call('x:Account/query',{
    filter:{name,domainId:domain.id},limit:10
   }),'x:Account/query');
   const ids=Array.isArray(query.ids)?query.ids.filter((id):id is string=>typeof id==='string'):[];
   if(!ids.length)continue;
   const got=responseObject(await this.call('x:Account/get',{ids,properties:['id','name','domainId','@type']}),'x:Account/get');
   const group=(Array.isArray(got.list)?got.list.map(object):[]).find(item=>
    item['@type']==='Group'&&item.name===name&&item.domainId===domain.id&&typeof item.id==='string');
   if(group)return group.id as string;
  }
  if(!create)return undefined;
  const domain=domains.find(item=>item.id===preferredDomainId&&item.isEnabled)??domains.find(item=>item.isEnabled);
  if(!domain)throw new Error('No enabled mail domain is available');
  const result=responseObject(await this.call('x:Account/set',{create:{tenantGroup:{
   '@type':'Group',name,domainId:domain.id,description:'MetaDrive tenant mailbox membership',
   roles:{'@type':'Custom',roleIds:{}},permissions:{'@type':'Inherit'},quotas:{},aliases:{}
  }}}),'x:Account/set');
  const created=result.created&&typeof result.created==='object'&&!Array.isArray(result.created)?object(result.created):{};
  // JMAP Foo/set returns created.<clientId> as an object containing its id.
  const id=created.tenantGroup&&typeof created.tenantGroup==='object'
   ?object(created.tenantGroup).id:undefined;
  if(typeof id==='string')return id;
  const failures=result.notCreated&&typeof result.notCreated==='object'&&!Array.isArray(result.notCreated)?object(result.notCreated):{};
  const failure=failures.tenantGroup;
  const detail=failure&&typeof failure==='object'&&!Array.isArray(failure)?object(failure):{};
  if(detail.type==='alreadyExists')return await this.tenantGroup(tenantId,false,domain.id);
  throw new Error('Stalwart could not establish tenant mailbox isolation');
 }
 async listMailboxes(tenantId:string){
  const groupId=await this.tenantGroup(tenantId,false);
  if(!groupId)return [];
  const ids:string[]=[];const pageSize=500;let position=0;
  for(let page=0;page<20;page++){
   const query=responseObject(await this.call('x:Account/query',{
    filter:{memberGroupIds:groupId},position,limit:pageSize
   }),'x:Account/query');
   const pageIds=Array.isArray(query.ids)?query.ids.filter((id):id is string=>typeof id==='string'):[];
   ids.push(...pageIds);
   if(pageIds.length<pageSize)break;
   position+=pageIds.length;
   if(page===19)throw new Error('Mailbox listing exceeded the safe pagination limit');
  }
  const rows:MailObject[]=[];
  for(let offset=0;offset<ids.length;offset+=100){
   const get=responseObject(await this.call('x:Account/get',{
    ids:ids.slice(offset,offset+100),
    properties:['id','@type','name','domainId','emailAddress','description','quotas','usedDiskQuota','createdAt','memberGroupIds','credentials']
   }),'x:Account/get');
   rows.push(...(Array.isArray(get.list)?get.list.map(object):[]));
  }
  return rows.filter(item=>item['@type']==='User'&&typeof item.id==='string'
    &&object(item.memberGroupIds??{} )[groupId]===true)
   .map(item=>({id:item.id as string,emailAddress:typeof item.emailAddress==='string'?item.emailAddress:'',
    name:typeof item.name==='string'?item.name:'',domainId:typeof item.domainId==='string'?item.domainId:'',
    description:typeof item.description==='string'?item.description:'',quotas:item.quotas??{},
    usedDiskQuota:item.usedDiskQuota??0,createdAt:item.createdAt??null}));
 }
 async createMailbox(tenantId:string,raw:unknown){
  if(!uuid.test(tenantId))throw new Error('Invalid tenant identifier');
  const input=object(raw);
  const name=input.name;
  const domainId=input.domainId;
  const password=input.password;
  const description=input.description??'';
  if(typeof name!=='string'||!localPart.test(name))throw new Error('Invalid mailbox name');
  if(typeof domainId!=='string'||domainId.length>128)throw new Error('Invalid mail domain');
  if(typeof password!=='string'||password.length<12||password.length>256)
   throw new Error('Mailbox password must be between 12 and 256 characters');
  if(typeof description!=='string'||description.length>500)throw new Error('Invalid mailbox description');
  const domains=await this.listDomains();
  if(!domains.some(domain=>domain.id===domainId&&domain.isEnabled))
   throw new Error('Mail domain not found or disabled');
  const groupId=await this.tenantGroup(tenantId,true,domainId);
  if(!groupId)throw new Error('Tenant mailbox isolation could not be established');
  const created=responseObject(await this.call('x:Account/set',{create:{newMailbox:{
   '@type':'User',name,domainId,...(description?{description}:{}),memberGroupIds:{[groupId]:true},
   credentials:{'0':{'@type':'Password',secret:password}},
   roles:{'@type':'User'},permissions:{'@type':'Replace',enabledPermissions:{
    authenticate:true,jmapEmailGet:true,jmapEmailQuery:true,jmapMailboxGet:true,
    jmapIdentityGet:true,jmapEmailUpdate:true,jmapEmailImport:true,
    jmapEmailSubmissionCreate:true,jmapBlobUpload:true,jmapBlobGet:true
   },disabledPermissions:{}},
   quotas:{},aliases:{},encryptionAtRest:{'@type':'Disabled'}
  }}}),'x:Account/set');
  const createdIds=created.created&&typeof created.created==='object'&&!Array.isArray(created.created)?object(created.created):{};
  const id=createdIds.newMailbox&&typeof createdIds.newMailbox==='object'
   ?object(createdIds.newMailbox).id:undefined;
  if(typeof id!=='string'){
   const failures=created.notCreated&&typeof created.notCreated==='object'&&!Array.isArray(created.notCreated)?object(created.notCreated):{};
   const failure=failures.newMailbox;
   const detail=failure&&typeof failure==='object'&&!Array.isArray(failure)?object(failure):{};
   const type=typeof detail.type==='string'?detail.type:'unknown';
   throw new Error('Stalwart could not create mailbox ('+type+')');
  }
  return {id,emailAddress:name+'@'+domains.find(domain=>domain.id===domainId)!.name};
 }
 async updateMailbox(tenantId:string,id:string,raw:unknown){
  if(!uuid.test(tenantId)||typeof id!=='string'||id.length>128)throw new Error('Invalid mailbox identifier');
  const input=object(raw);
  const current=(await this.listMailboxes(tenantId)).find(item=>item.id===id);
  if(!current)throw new Error('Mailbox not found');
  const update:MailObject={};
  if(input.description!==undefined){
   if(typeof input.description!=='string'||input.description.length>500)throw new Error('Invalid mailbox description');
   update.description=input.description;
  }
  if(input.quotas!==undefined){
   const quotas=object(input.quotas);
   if(Object.keys(quotas).some(key=>!['maxDiskQuota','maxEmails','maxMailboxes','maxEmailSubmissions'].includes(key)
    ||!Number.isSafeInteger(quotas[key])||Number(quotas[key])<0||Number(quotas[key])>Number.MAX_SAFE_INTEGER))
    throw new Error('Invalid mailbox quota');
   update.quotas=quotas;
  }
  if(!Object.keys(update).length)throw new Error('No supported mailbox changes supplied');
  const result=responseObject(await this.call('x:Account/set',{update:{[id]:update}}),'x:Account/set');
  const notUpdated=result.notUpdated&&typeof result.notUpdated==='object'&&!Array.isArray(result.notUpdated)?object(result.notUpdated):{};
  if(notUpdated[id])throw new Error('Stalwart rejected mailbox update');
  return (await this.listMailboxes(tenantId)).find(item=>item.id===id);
 }
 async resetPassword(tenantId:string,id:string,raw:unknown){
  if(!uuid.test(tenantId)||typeof id!=='string'||id.length>128)throw new Error('Invalid mailbox identifier');
  const input=object(raw),password=input.password;
  if(typeof password!=='string'||password.length<12||password.length>256)
   throw new Error('Mailbox password must be between 12 and 256 characters');
  const current=(await this.listMailboxes(tenantId)).find(item=>item.id===id);
  if(!current)throw new Error('Mailbox not found');
  const accountResult=responseObject(await this.call('x:Account/get',{ids:[id]}),'x:Account/get');
  const accounts=Array.isArray(accountResult.list)?accountResult.list.map(object):[];
  const credentials=accounts[0]?.credentials;
  // Replacing credentials can revoke app passwords/API keys. Fail closed unless the account
  // has exactly one password credential; never silently destroy other credential types.
  const credentialValues=Array.isArray(credentials)?credentials:
   credentials&&typeof credentials==='object'?Object.values(object(credentials)):[];
  if(credentialValues.length!==1||object(credentialValues[0])['@type']!=='Password')
   throw new Error('Password reset is unavailable while this mailbox has additional credentials');
  const result=responseObject(await this.call('x:Account/set',{update:{[id]:{
   credentials:{'0':{'@type':'Password',secret:password}}
  }}}),'x:Account/set');
  if(result.notUpdated&&typeof result.notUpdated==='object'&&!Array.isArray(result.notUpdated)&&object(result.notUpdated)[id])throw new Error('Stalwart rejected password reset');
 }
 async deleteMailbox(tenantId:string,id:string){
  if(!uuid.test(tenantId)||typeof id!=='string'||id.length>128)throw new Error('Invalid mailbox identifier');
  const current=(await this.listMailboxes(tenantId)).find(item=>item.id===id);
  if(!current)throw new Error('Mailbox not found');
  const result=responseObject(await this.call('x:Account/set',{destroy:[id]}),'x:Account/set');
  const failures=result.notDestroyed&&typeof result.notDestroyed==='object'&&!Array.isArray(result.notDestroyed)?object(result.notDestroyed):{};
  if(failures[id])throw new Error('Stalwart rejected mailbox deletion');
 }
}

export function registerStalwartMailRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 const service=new StalwartMailService();
 const permission=async(req:MailRequest,access:'read'|'manage')=>{
  const actor=actorOf(req);
  await rbac.require(actor.tenant_id,actor.user_id,'Mailbox',access);
  return actor;
 };
 const audit=async(actor:Actor,action:string,mailboxId?:string)=>{
  await db.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
   [actor.tenant_id,actor.user_id,action,JSON.stringify({provider:'stalwart',...(mailboxId?{mailboxId}: {})})]);
 };
 const handleError=(res:Response,error:unknown,operation:string)=>{
  logMailError(operation,error);
  const message=safeError(error);
  const status=message==='Permission denied'?403:/not found/i.test(message)?404:
   /not configured|unavailable/i.test(message)?503:
   /invalid|between|supplied|disabled|already exists/i.test(message)?400:502;
  res.status(status).json({error:message});
 };
 app.get('/api/mail/domains',wrap(async(req,res)=>{
  try{await permission(req,'read');res.setHeader('Cache-Control','private, no-store');res.json({domains:await service.listDomains()});}
  catch(error){handleError(res,error,'domains.list');}
 }));
 app.get('/api/mail/mailboxes',wrap(async(req,res)=>{
  try{const actor=await permission(req,'read');res.setHeader('Cache-Control','private, no-store');res.json({mailboxes:await service.listMailboxes(actor.tenant_id)});}
  catch(error){handleError(res,error,'mailboxes.list');}
 }));
 app.post('/api/mail/mailboxes',wrap(async(req,res)=>{
  try{const actor=await permission(req,'manage');const mailbox=await service.createMailbox(actor.tenant_id,req.body);
   await audit(actor,'mailbox_created',mailbox.id);res.status(201).json({mailbox});}
  catch(error){handleError(res,error,'mailboxes.create');}
 }));
 app.patch('/api/mail/mailboxes/:id',wrap(async(req,res)=>{
  try{const actor=await permission(req,'manage');const mailbox=await service.updateMailbox(actor.tenant_id,req.params.id,req.body);
   await audit(actor,'mailbox_updated',req.params.id);res.json({mailbox});}
  catch(error){handleError(res,error,'mailboxes.update');}
 }));
 app.post('/api/mail/mailboxes/:id/reset-password',wrap(async(req,res)=>{
  try{const actor=await permission(req,'manage');await service.resetPassword(actor.tenant_id,req.params.id,req.body);
   await audit(actor,'mailbox_password_reset',req.params.id);res.status(204).end();}
  catch(error){handleError(res,error,'mailboxes.resetPassword');}
 }));
 app.delete('/api/mail/mailboxes/:id',wrap(async(req,res)=>{
  try{const actor=await permission(req,'manage');await service.deleteMailbox(actor.tenant_id,req.params.id);
   await audit(actor,'mailbox_deleted',req.params.id);res.status(204).end();}
  catch(error){handleError(res,error,'mailboxes.delete');}
 }));
}
