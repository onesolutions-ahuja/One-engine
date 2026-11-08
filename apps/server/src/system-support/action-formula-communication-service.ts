import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {NamedCredentialService} from './named-credential-service.js';
import {TenantMediaService} from '../system-files/tenant-media-service.js';

export type CommunicationChannel='EMAIL'|'WHATSAPP'|'SMS';
const asset=/^asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
/** Shared immediate/delayed delivery. Named Credential owns transport and
 * permissions. Tenant Files owns attachment bytes and access control. */
export async function sendActionCommunication(
 db:SqlPersistence,rbac:RbacEngine,credentials:NamedCredentialService,
 tenantId:string,userId:string,channel:CommunicationChannel,credential:string,
 values:unknown[],idempotencyKey:string,
){
 const minimum=channel==='EMAIL'?3:2;
 if(!['EMAIL','WHATSAPP','SMS'].includes(channel)||!Array.isArray(values)||
  values.length<minimum||values.length>(channel==='SMS'?2:minimum+20)||
  typeof credential!=='string'||!credential)throw Error('Invalid communication formula');
 if(values.some(value=>typeof value!=='string'||!value.trim()||value.length>32768))
  throw Error('Invalid communication formula arguments');
 const selected=(await credentials.list(tenantId,userId))
  .find(item=>item.enabled&&item.name===credential);
 if(!selected)throw Error('Named Credential unavailable');
 const prefix='public_'+channel.toLowerCase();
 const path=selected.configuration[prefix+'Path'];
 const body=selected.configuration[prefix+'Body'];
 if(typeof path!=='string'||typeof body!=='string'||!body.trim().startsWith('{'))
  throw Error('Configure '+prefix+'Path and '+prefix+'Body on the Named Credential');
 const strings=values as string[];
 const variables:Record<string,string>={
  to:strings[0],recipient:strings[0],message:strings[minimum-1],body:strings[minimum-1]
 };
 if(channel==='EMAIL')variables.subject=strings[1];
 let withFile=false;
 for(const [index,attachment] of strings.slice(minimum).entries()){
  const name='attachment'+(index+1);
  if(!body.includes('{!'+name+'}'))throw Error('Provider mapping must include '+name);
  const match=asset.exec(attachment);
  if(match){
   const file=await new TenantMediaService(db,rbac).read(tenantId,userId,match[1]);
   if(file.contentType!=='application/pdf')throw Error('Unsupported action attachment type');
   variables[name]=file.contentBase64;
   variables['attachmentName'+(index+1)]=file.name;
   variables['attachmentMimeType'+(index+1)]=file.contentType;
   withFile=true;
  }else variables[name]=attachment;
 }
 const result=await credentials.callout(tenantId,userId,{
  namedCredentialId:selected.id,method:'POST',path,body
 },variables,idempotencyKey,false,withFile?8*1024*1024:32768);
 if(result.status<200||result.status>=300)throw Error('Provider rejected communication');
 return {status:result.status};
}
