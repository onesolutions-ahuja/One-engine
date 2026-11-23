import {compileRecordFilters} from '../object-engine/QueryBuilder.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordListOptions} from '../system-files/record-engine.js';
import {resetRecordReadScope} from './record-read-scope.js';
import {clearRequestRbacMemo} from './audit-context.js';

// Existing setup tables use composite primary keys. The record API needs a stable UUID.
const recordId=(key:string)=>`overlay(overlay(md5(${key}) placing '8' from 13 for 1) placing '8' from 17 for 1)::uuid`;
const customId=recordId("tenant_id::text||':permission:'||name");
const assignmentId=recordId("tenant_id::text||':assignment:'||user_id::text||permission_set_id::text");
const grantId=recordId("tenant_id::text||':grant:'||permission_set_id::text||resource");
const names=`SELECT name FROM md_custom_permission_definitions WHERE tenant_id=$1
 UNION SELECT substr(resource,18) FROM md_permission_rules WHERE tenant_id=$1 AND resource LIKE 'CustomPermission:%'`;
const sources={
 PermissionSet:`SELECT id AS "Id",api_name AS "Name",COALESCE(label,api_name) AS "Label",description AS "Description"
  FROM md_permission_sets WHERE tenant_id=$1`,
 CustomPermission:`SELECT ${customId} AS "Id",name AS "Name",regexp_replace(replace(name,'_',' '),'([a-z])([A-Z])','\\1 \\2','g') AS "Label"
  FROM (SELECT $1::uuid AS tenant_id,name FROM (${names}) n) p`,
 UserPermissionSet:`SELECT ${assignmentId} AS "Id",user_id AS "User",permission_set_id AS "PermissionSet"
  FROM md_permission_assignments WHERE tenant_id=$1`,
 PermissionSetCustomPermission:`SELECT ${grantId} AS "Id",permission_set_id AS "PermissionSet",${customId} AS "CustomPermission"
  FROM (SELECT *,substr(resource,18) AS name FROM md_permission_rules WHERE tenant_id=$1 AND resource LIKE 'CustomPermission:%'
  AND action='read' AND effect='allow') r`
};
type ObjectName=keyof typeof sources;
export const setupObject=(name:string):name is ObjectName=>Object.hasOwn(sources,name);
export async function setupRecords(db:Pick<SqlPersistence,'query'>,rbac:RbacEngine,tenant:string,user:string,name:ObjectName,limit:number,offset:number,options:RecordListOptions={},id?:string){
 await rbac.require(tenant,user,name,'read');
 const fields=name==='PermissionSet'?['Id','Name','Label','Description']:name==='CustomPermission'?['Id','Name','Label']:
  name==='UserPermissionSet'?['Id','User','PermissionSet']:['Id','PermissionSet','CustomPermission'];
 const allowed=await rbac.allowedMany(tenant,user,fields.map(f=>({resource:name+'.'+f,action:'read'})));
 const readable=fields.filter((f,i)=>f==='Id'||allowed[i]);
 const column=(key:string)=>{if(!readable.includes(key))throw Error('Invalid setup record field');return '"'+key+'"';};
 const args:unknown[]=[tenant],conditions:string[]=[];
 const param=(value:unknown)=>{args.push(value);return '$'+args.length;};
 if(id)conditions.push('"Id"='+param(id));
 if(options.relatedField)conditions.push(column(options.relatedField)+'='+param(options.relatedId));
 if(options.filterField)conditions.push(column(options.filterField)+'::text='+param(options.filterValue));
 if(options.search){const search=param('%'+options.search+'%');conditions.push('('+readable.map(f=>column(f)+'::text ILIKE '+search).join(' OR ')+')');}
 if(options.filters?.length){
  const metadata=new Map(readable.map(f=>[f,{api_name:f,data_type:['User','PermissionSet','CustomPermission'].includes(f)?'reference':'text',
   nativeValue:'r.'+column(f),nativeText:'r.'+column(f)+'::text'}]));
  const built=compileRecordFilters(options.filters,options.filterLogic,metadata,args.length+1);
  conditions.push(built.predicate.replace(/\br\.id\b/g,'r."Id"'));args.push(...built.parameters);
 }
 if(options.scope&&options.scope!=='all'||options.filterOperator&&options.filterOperator!=='Equals')
  throw Error('Unsupported setup record filter');
 const field=options.sortField??'Id',direction=options.sortDirection??'asc',sort=column(field);
 const comparison=direction==='desc'?'<':'>';
 const base='SELECT '+readable.map(column).join(',')+',count(*) over() AS total FROM ('+sources[name]+') r'+(conditions.length?' WHERE '+conditions.join(' AND '):'');
 let after='';
 if(options.cursor){
  const cursor=options.cursor;
  if((cursor.field??'Id')!==field||cursor.direction!==direction)throw Error('Invalid setup record cursor');
  const cursorId=param(cursor.id),value=param(cursor.value);
  after=' WHERE ('+sort+'::text '+comparison+' '+value+' OR ('+sort+'::text IS NOT DISTINCT FROM '+value+' AND "Id">'+cursorId+'::uuid))';
 }
 const sql='SELECT * FROM ('+base+') page'+after+' ORDER BY '+sort+' '+direction+',"Id" ASC LIMIT '+param(Math.min(100,Math.max(1,limit)))+' OFFSET '+param(options.cursor?0:Math.max(0,offset));
 const {rows}=await db.query(sql,args);
 const last=rows.at(-1);
 const nextCursor=last?Buffer.from(JSON.stringify({field:options.sortField??null,direction,value:last[field]==null?null:String(last[field]),id:last.Id})).toString('base64url'):undefined;
 return {nextCursor,records:rows.map(({total,...row})=>row),total:Number(rows[0]?.total??0)};
}
export async function changeSetupRecord(db:SqlPersistence,rbac:RbacEngine,tenant:string,user:string,name:ObjectName,values:Record<string,unknown>|null,id?:string){
 if(name!=='UserPermissionSet'&&name!=='PermissionSetCustomPermission')throw Error('Read-only setup object');
 return db.transaction(async client=>{
  resetRecordReadScope();clearRequestRbacMemo();
  await rbac.require(tenant,user,'SystemPermission:ManageUsers','read');
  let result;
  if(values){
   const key=name==='UserPermissionSet'?'User':'CustomPermission';
   if(Object.keys(values).length!==2||typeof values.PermissionSet!=='string'||typeof values[key]!=='string')throw Error('Invalid permission assignment');
   if(name==='UserPermissionSet')result=await client.query(`INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id)
    VALUES($1,$2,$3) RETURNING ${assignmentId} AS id`,[tenant,values.User,values.PermissionSet]);
   else result=await client.query(`INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
    SELECT $1,$3,'CustomPermission:'||"Name",'read','allow' FROM (${sources.CustomPermission}) c WHERE "Id"=$2
    RETURNING ${grantId} AS id`,[tenant,values.CustomPermission,values.PermissionSet]);
  }else if(name==='UserPermissionSet')result=await client.query(`DELETE FROM md_permission_assignments WHERE tenant_id=$1 AND ${assignmentId}=$2 RETURNING ${assignmentId} AS id`,[tenant,id]);
  else result=await client.query(`DELETE FROM md_permission_rules WHERE tenant_id=$1 AND resource LIKE 'CustomPermission:%'
   AND action='read' AND effect='allow' AND ${grantId}=$2 RETURNING ${grantId} AS id`,[tenant,id]);
  if(!result.rows.length)throw Error('Setup record not found');
  resetRecordReadScope();clearRequestRbacMemo();
  return String(result.rows[0].id);
 });
}
