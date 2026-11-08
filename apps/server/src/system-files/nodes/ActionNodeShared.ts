import type {PoolClient} from 'pg';
import type {RbacEngine} from '../rbac-engine.js';
import type {RecordEngine} from '../record-engine.js';
type FaultConnector={to:number;kind?:string};
export type ActionContext={
 client:PoolClient;rbac:RbacEngine;tenantId:string;userId:string;flowApi:string;
 records?:RecordEngine;
 runId:string;
 httpCallout?:(tenantId:string,userId:string,config:Record<string,unknown>,
  variables:Record<string,string|number|boolean|null>,idempotencyKey:string,
  execution?:{client:PoolClient;runId:string;nodeId:number})=>Promise<{status:number;body:string}>;
 enqueueEmail?:(message:{credentialId:string;from:string;recipients:string[];
  subject:string;body:string})=>Promise<void>;
 config:Record<string,unknown>;resolve:(value:unknown)=>unknown;
 variables:Record<string,unknown>;connectors:FaultConnector[];elementId:number;
};
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const scalar=(value:unknown):value is string|number|boolean|null=>
 value===null||typeof value==='string'||typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean';

export function template(value:unknown,resolve:(value:unknown)=>unknown):string {
 if(typeof value!=='string')throw new Error('Notification values must be text');
 return value.replace(/\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/g,(_match,reference:string)=>{
  const resolved=resolve('{!'+reference+'}');
  if(resolved!==null&&resolved!==undefined&&!scalar(resolved))
   throw new Error('Notification template references a non-scalar resource');
  return resolved===null||resolved===undefined?'':String(resolved);
 });
}

