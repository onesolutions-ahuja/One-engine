import {SqlPersistence} from './sql-persistence.js';
import {auditContext} from '../system-support/audit-context.js';
import {readRbac} from '../system-support/rbac-description.js';
import {recordReadScope} from '../system-support/record-read-scope.js';
export type PermissionCheck={resource:string;action:string};
/** One central SQL RBAC evaluator. OneEngine is an ordinary configurable permission set. */
export class RbacEngine{
 constructor(private readonly db:SqlPersistence){}
 /** Where decisions are remembered. Inside one page action or one save (record read
  * scope) they are kept until a Flow runs or setup changes. Otherwise, within ONE request
  * outside a transaction they are kept until any database write in the request. */
 private memo():Map<string,boolean>|undefined{
  const scope=recordReadScope();
  if(scope)return scope.rbac;
  if(!(this.db instanceof SqlPersistence))return undefined;
  const context=auditContext();
  return !this.db.inTransaction()&&context?(context.rbacMemo??=new Map<string,boolean>()):undefined;
 }
 /** Ask several decisions now in ONE query and remember them for the checks that follow.
  * Does nothing where decisions are not remembered (they are then asked when needed). */
 async prime(tenantId:string,userId:string,checks:readonly PermissionCheck[]):Promise<void>{
  const memo=this.memo();
  if(!memo)return;
  const keyOf=(check:PermissionCheck)=>tenantId+'\u0000'+userId+'\u0000'+check.resource+'\u0000'+check.action;
  const seen=new Set<string>();
  const missing=checks.filter(check=>{const key=keyOf(check);if(memo.has(key)||seen.has(key))return false;seen.add(key);return true;});
  if(!missing.length)return;
  const answers=await this.decide(tenantId,userId,missing);
  missing.forEach((check,index)=>memo.set(keyOf(check),answers[index]));
 }
 async allowedMany(tenantId:string,userId:string,checks:readonly PermissionCheck[]):Promise<boolean[]>{
  if(!checks.length)return [];
  const memo=this.memo();
  const keyOf=(check:PermissionCheck)=>tenantId+'\u0000'+userId+'\u0000'+check.resource+'\u0000'+check.action;
  if(memo){
   const missing=checks.filter(check=>!memo.has(keyOf(check)));
   if(missing.length){
    const answers=await this.decide(tenantId,userId,missing);
    missing.forEach((check,index)=>memo.set(keyOf(check),answers[index]));
   }
   return checks.map(check=>memo.get(keyOf(check))===true);
  }
  return this.decide(tenantId,userId,checks);
 }
 private async decide(tenantId:string,userId:string,checks:readonly PermissionCheck[]):Promise<boolean[]>{
  const {rows}=await this.db.query<{ordinal:number;allow_granted:boolean;deny_granted:boolean}>(
   'SELECT q.ordinal::integer AS ordinal,d.allow_granted,d.deny_granted FROM unnest($3::text[],$4::text[]) WITH ORDINALITY AS q(resource,action,ordinal) CROSS JOIN LATERAL md_rbac_decision($1,$2,q.resource,q.action) d ORDER BY q.ordinal',
   [tenantId,userId,checks.map(c=>c.resource),checks.map(c=>c.action)]);
  const byIndex=new Map(rows.map(row=>[Number(row.ordinal)-1,row]));
  return checks.map((_,index)=>byIndex.get(index)?.allow_granted===true&&byIndex.get(index)?.deny_granted!==true);
 }
 async allowed(tenantId:string,userId:string,resource:string,action:string){
  return (await this.allowedMany(tenantId,userId,[{resource,action}]))[0];
 }
 async require(tenantId:string,userId:string,resource:string,action:string){
  if(!await this.allowed(tenantId,userId,resource,action))throw Error('Permission denied');
 }
 async describe(tenantId:string,userId:string){
  await this.require(tenantId,userId,'Security','read');
  return this.db.transaction(async tx=>{
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await new RbacEngine(tx as unknown as SqlPersistence).require(tenantId,userId,'Security','read');
   return readRbac(tx,tenantId);
  });
 }
 async requireRecord(tenantId:string,userId:string,objectApi:string,id:string,action:string){
  const {rows}=await this.db.query<{allowed:boolean}>(
   'SELECT md_record_access($1,$2,id,$5) AS allowed FROM md_records WHERE tenant_id=$1 AND object_api=$3 AND id=$4',
   [tenantId,userId,objectApi,id,action]);
  if(!rows[0]?.allowed)throw Error('Permission denied');
 }
}
