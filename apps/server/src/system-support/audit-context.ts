import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
export type AuditContext={correlationId:string;actorTenant?:string;actorUser?:string;
 /** Per-request measurements for the Server-Timing header (round trips to the SQL database). */
 timing?:{dbTrips:number;dbMs:number;authMs?:number;started:number};
 /** Permission decisions already made in this request (cleared by any database write). */
 rbacMemo?:Map<string,boolean>};
/** Forget this request's remembered permission decisions (after a write). */
export function clearRequestRbacMemo(){storage.getStore()?.rbacMemo?.clear();}
/** Count one SQL round trip and its time against the current request. */
export function timeSqlTrip<T>(promise:Promise<T>):Promise<T>{
 const timing=storage.getStore()?.timing;
 if(!timing)return promise;
 const started=performance.now();
 timing.dbTrips++;
 return promise.finally(()=>{timing.dbMs+=performance.now()-started;});
}
const storage=new AsyncLocalStorage<AuditContext>();
export const auditContext=()=>storage.getStore();
export const withAuditContext=<T>(context:Partial<AuditContext>,run:()=>T)=>storage.run({correlationId:randomUUID(),...context},run);
export function setAuditActor(tenant:string,user:string){const context=auditContext();if(context){context.actorTenant=tenant;context.actorUser=user;}}
export async function setSqlAuditContext(client:{query:(sql:string,args:unknown[])=>Promise<unknown>},context:AuditContext){
 // SET LOCAL preserves callers' ability to choose isolation before their first query.
 const literal=(v:string)=>"E'"+v.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
 await client.query('SET LOCAL metadrive.actor_tenant = '+literal(context.actorTenant??'')+'; SET LOCAL metadrive.actor_user = '+literal(context.actorUser??'')+'; SET LOCAL metadrive.correlation_id = '+literal(context.correlationId),[]);
}
