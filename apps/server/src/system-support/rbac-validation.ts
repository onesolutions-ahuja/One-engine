import type {SqlExecutor} from '../system-files/sql-persistence.js';
import {grantRules,type Snapshot,type Rule} from './rbac-contract.js';
const unique=(items:{id:string;apiName?:string}[])=>{
 if(new Set(items.map(i=>i.id)).size!==items.length||
  new Set(items.map(i=>i.apiName?.toLowerCase()).filter(Boolean)).size!==items.filter(i=>i.apiName).length)throw Error('Duplicate policy identity');
};
export function noCycles(items:{id:string;parents:string[]}[]){
 const byId=new Map(items.map(i=>[i.id,i.parents]));
 const visited=new Set<string>();
 const visit=(id:string,path:Set<string>)=>{
  if(path.has(id))throw Error('Cyclic hierarchy or group');
  if(visited.has(id))return;
  for(const parent of byId.get(id)??[]){
   if(!byId.has(parent))throw Error('Unknown hierarchy or group member');
   visit(parent,new Set([...path,id]));
  }
  visited.add(id);
 };
 for(const item of items)visit(item.id,new Set());
}
export async function validateRbac(db:SqlExecutor,tenant:string,next:Snapshot){
 if(next.tenantId!==tenant)throw Error('Permission denied');
 for(const items of [next.roles,next.profiles,next.permissionSets,next.permissionSetGroups,next.publicGroups,next.queues,next.sharingRules,next.users])unique(items);
 const identities=[...next.roles,...next.profiles,...next.permissionSets,...next.permissionSetGroups,...next.publicGroups,...next.queues,...next.sharingRules];
 if(new Set(identities.map(i=>i.id)).size!==identities.length)throw Error('Duplicate policy identity');
 noCycles(next.roles.map(r=>({id:r.id,parents:r.parentRoleId?[r.parentRoleId]:[]})));
 noCycles(next.publicGroups.map(g=>({id:g.id,parents:g.groupIds})));
 const refs=(ids:string[],items:{id:string}[])=>{if(ids.some(id=>!items.some(i=>i.id===id)))throw Error('Unknown tenant policy reference');};
 const [objects,fields,types,apps,users]=await Promise.all([
  db.query<{api_name:string}>('SELECT api_name FROM md_object_definitions WHERE tenant_id=$1',[tenant]),
  db.query<{object_api:string;api_name:string}>('SELECT object_api,api_name FROM md_field_definitions WHERE tenant_id=$1',[tenant]),
  db.query<{object_api:string;record_type_id:string}>('SELECT object_api,record_type_id FROM md_object_record_types WHERE tenant_id=$1',[tenant]),
  db.query<{api_name:string}>('SELECT COALESCE(m.api_name,a.api_name) AS api_name FROM md_apps a JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1 LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id UNION SELECT api_name FROM md_tenant_app_metadata WHERE tenant_id=$1',[tenant]),
  db.query<{id:string}>('SELECT id FROM md_users WHERE tenant_id=$1',[tenant])
 ]);
 if(users.rows.length!==next.users.length||next.users.some(u=>!users.rows.some(r=>r.id===u.id)))throw Error('Stale user list');
 const objectSet=new Set(objects.rows.map(o=>o.api_name)),fieldSet=new Set(fields.rows.map(f=>f.object_api+'.'+f.api_name));
 const typeSet=new Set(types.rows.map(t=>t.object_api+'.'+t.record_type_id)),appSet=new Set(apps.rows.map(a=>a.api_name));
 const keys=(values:Record<string,unknown>,known:Set<string>)=>{
  for(const key of Object.keys(values))if(!known.has(key))throw Error('Unknown tenant metadata reference: '+key);
 };
 for(const p of [...next.profiles,...next.permissionSets]){
  keys(p.objectPermissions,objectSet);keys(p.fieldPermissions,fieldSet);keys(p.recordTypePermissions,typeSet);
  keys(p.appPermissions,appSet);keys(p.tabPermissions,objectSet);grantRules(p);
 }
 for(const p of next.permissionSets)keys(p.recordDataScopes,objectSet);
 for(const p of next.profiles)refs(p.inheritedPermissionSetIds,next.permissionSets);
 for(const g of next.permissionSetGroups){
  refs(g.permissionSetIds,next.permissionSets);
  keys(g.mutedObjectPermissions,objectSet);keys(g.mutedFieldPermissions,fieldSet);
  keys(g.mutedRecordTypePermissions,typeSet);keys(g.mutedAppPermissions,appSet);keys(g.mutedTabPermissions,objectSet);
 }
 for(const u of next.users){
  refs(u.roleId?[u.roleId]:[],next.roles);refs(u.profileId?[u.profileId]:[],next.profiles);
  refs(u.permissionSetIds,next.permissionSets);refs(u.permissionSetGroupIds,next.permissionSetGroups);
  try{new Intl.DateTimeFormat('en',{timeZone:u.timeZone});new Intl.Locale(u.locale);}catch{throw Error('Invalid locale or time zone');}
  if(u.userType==='external'){
   if(!u.externalAccountId)throw Error('External account is required');
   const account=await db.query("SELECT id FROM md_records WHERE tenant_id=$1 AND object_api='Account' AND id=$2",[tenant,u.externalAccountId]);
   if(!account.rows.length)throw Error('External account not found');
   if(u.roleId||u.permissionSetGroupIds.length)throw Error('External users cannot receive internal roles or groups');
  }
 }
 for(const g of [...next.publicGroups,...next.queues]){
  refs(g.userIds,next.users);refs(g.roleIds,next.roles);refs(g.roleAndSubordinateIds,next.roles);
  refs('groupIds' in g?g.groupIds:g.publicGroupIds,next.publicGroups);
  if('supportedObjectApiNames' in g)for(const api of g.supportedObjectApiNames){
   if(!objectSet.has(api)||!fieldSet.has(api+'.OwnerId'))throw Error('Queue object must support ownership');
  }
 }
 const field=(obj:string,f:string)=>{if(!['Id','OwnerId','RecordTypeId'].includes(f)&&!fieldSet.has(obj+'.'+f))throw Error('Unknown policy field');};
 const target=(kind:string,target:string)=>{
  refs([target],kind==='User'?next.users:kind==='PublicGroup'?next.publicGroups:next.roles);
 };
 const policyIds=new Set(next.sharingRules.map(r=>r.id));
 for(const [obj,s] of Object.entries(next.sharingSettings)){
  if(!objectSet.has(obj))throw Error('Unknown sharing object');
  if(s.portalEnabled){
   if(!s.portalAccountField)throw Error('Portal account field required');
   field(obj,s.portalAccountField);
  }
  for(const r of s.restrictionRules){
   if(policyIds.has(r.id)||r.tenantId!==tenant||r.objectApiName!==obj)throw Error('Invalid restriction identity');
   policyIds.add(r.id);
   if(['user','role'].includes(r.subjectType)){
    if(!r.subjectId)throw Error('Restriction subject required');
    refs([r.subjectId],r.subjectType==='user'?next.users:next.roles);
   }else if(r.subjectId)throw Error('Invalid restriction subject');
   for(const c of r.conditions){field(obj,c.field);
    if(['in','notIn'].includes(c.operator)&&!Array.isArray(c.value))throw Error('List restriction value required');
   }
  }
 }
 for(const r of next.sharingRules){
  if(!objectSet.has(r.objectApiName))throw Error('Unknown sharing object');
  refs(r.ownerRoleIds,next.roles);target(r.targetType,r.targetId);
  if(r.active&&(r.type==='OwnerBased'?!r.ownerRoleIds.length:!r.criteria.length))throw Error('Active sharing rule requires conditions');
  for(const c of r.criteria)field(r.objectApiName,c.fieldApiName);
 }
}
export function groupMutes(group:Snapshot['permissionSetGroups'][number]):Rule[]{
 const rules=grantRules({
  systemPermissions:group.mutedSystemPermissions,objectPermissions:group.mutedObjectPermissions,
  fieldPermissions:group.mutedFieldPermissions,recordTypePermissions:group.mutedRecordTypePermissions,
  appPermissions:group.mutedAppPermissions,tabPermissions:group.mutedTabPermissions,deniedPermissions:[],advancedRules:[]
 });
 return rules.filter(r=>r.effect==='allow');
}
