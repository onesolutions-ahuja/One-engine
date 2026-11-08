import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
export type AuditContext={correlationId:string;actorTenant?:string;actorUser?:string};
const storage=new AsyncLocalStorage<AuditContext>();
export const auditContext=()=>storage.getStore();
export const withAuditContext=<T>(context:Partial<AuditContext>,run:()=>T)=>storage.run({correlationId:randomUUID(),...context},run);
export function setAuditActor(tenant:string,user:string){const context=auditContext();if(context){context.actorTenant=tenant;context.actorUser=user;}}
export async function setSqlAuditContext(client:{query:(sql:string,args:unknown[])=>Promise<unknown>},context:AuditContext){
 // SET LOCAL preserves callers' ability to choose isolation before their first query.
 const literal=(v:string)=>"E'"+v.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
 await client.query('SET LOCAL metadrive.actor_tenant = '+literal(context.actorTenant??'')+'; SET LOCAL metadrive.actor_user = '+literal(context.actorUser??'')+'; SET LOCAL metadrive.correlation_id = '+literal(context.correlationId),[]);
}
