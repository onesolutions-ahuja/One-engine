import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import type {Snapshot,Rule} from './rbac-contract.js';
import {grantRules} from './rbac-contract.js';
import {groupMutes} from './rbac-validation.js';
export async function writeRules(tx:PoolClient,t:string,setId:string,rules:Rule[]){
 await tx.query('DELETE FROM md_permission_rules WHERE tenant_id=$1 AND permission_set_id=$2',[t,setId]);
 if(rules.length)await tx.query(
  'INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) SELECT $1,$2,resource,action,effect FROM unnest($3::text[],$4::text[],$5::text[]) AS r(resource,action,effect)',
  [t,setId,rules.map(r=>r.resource),rules.map(r=>r.action),rules.map(r=>r.effect)]);
}
export async function writePolicies(tx:PoolClient,t:string,next:Snapshot){
 await tx.query('DELETE FROM md_record_policies WHERE tenant_id=$1',[t]);
 await tx.query('DELETE FROM md_sharing_settings WHERE tenant_id=$1',[t]);
 const conditions=async(policyId:string,items:{field:string;operator:string;value?:unknown}[])=>{
  for(const [position,c] of items.entries()){
   const type=c.value===undefined?'undefined':c.value===null?'null':Array.isArray(c.value)?'array':typeof c.value;
   await tx.query('INSERT INTO md_policy_conditions(tenant_id,policy_id,position,field_api,operator,value_type) VALUES($1,$2,$3,$4,$5,$6)',
    [t,policyId,position,c.field,c.operator,type]);
   const values=Array.isArray(c.value)?c.value:c.value===undefined?[]:[c.value];
   for(const [vi,value] of values.entries())await tx.query(
    'INSERT INTO md_policy_condition_values(tenant_id,policy_id,condition_position,position,value_text) VALUES($1,$2,$3,$4,$5)',
    [t,policyId,position,vi,value===null?null:String(value)]);
  }
 };
 for(const [obj,s] of Object.entries(next.sharingSettings)){
  await tx.query('INSERT INTO md_sharing_settings(tenant_id,object_api,default_access,use_hierarchy,portal_enabled,portal_account_field) VALUES($1,$2,$3,$4,$5,$6)',
   [t,obj,s.defaultAccess,s.grantAccessUsingHierarchies,s.portalEnabled,s.portalAccountField??null]);
  for(const r of s.restrictionRules){
   await tx.query("INSERT INTO md_record_policies(tenant_id,id,kind,object_api,enabled,condition_logic,subject_type,subject_id) VALUES($1,$2,'restriction',$3,$4,$5,$6,$7)",
    [t,r.id,obj,r.enabled,r.conditionLogic,r.subjectType,r.subjectId??null]);
   await conditions(r.id,r.conditions);
  }
 }
 for(const r of next.sharingRules){
  await tx.query("INSERT INTO md_record_policies(tenant_id,id,kind,object_api,api_name,label,enabled,rule_type,condition_logic,target_type,target_id,access_level) VALUES($1,$2,'share',$3,$4,$5,$6,$7,$8,$9,$10,$11)",
   [t,r.id,r.objectApiName,r.apiName,r.label,r.active,r.type,r.filterLogic.toLowerCase(),r.targetType,r.targetId,r.accessLevel]);
  for(const role of r.ownerRoleIds)await tx.query('INSERT INTO md_policy_owner_roles(tenant_id,policy_id,role_id) VALUES($1,$2,$3)',[t,r.id,role]);
  await conditions(r.id,r.criteria.map(c=>({field:c.fieldApiName,operator:c.operator,value:c.value})));
 }
}
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a,(_k,v)=>
 v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([x],[y])=>x.localeCompare(y))):v)===
 JSON.stringify(b,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([x],[y])=>x.localeCompare(y))):v);
export async function writeRbac(tx:PoolClient,t:string,next:Snapshot,previous:Snapshot){
 for(const r of next.roles)await tx.query('INSERT INTO md_roles(tenant_id,id,api_name,label) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,id) DO UPDATE SET api_name=EXCLUDED.api_name,label=EXCLUDED.label',[t,r.id,r.apiName,r.name]);
 for(const r of next.roles)await tx.query('UPDATE md_roles SET parent_role_id=$3 WHERE tenant_id=$1 AND id=$2',[t,r.id,r.parentRoleId]);
 for(const p of next.permissionSets){
  if(equal(p,previous.permissionSets.find(old=>old.id===p.id)))continue;
  await tx.query('INSERT INTO md_permission_sets(tenant_id,id,api_name,label,description,license,navigation_default_access) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,id) DO UPDATE SET api_name=EXCLUDED.api_name,label=EXCLUDED.label,description=EXCLUDED.description,license=EXCLUDED.license,navigation_default_access=EXCLUDED.navigation_default_access',
   [t,p.id,p.apiName,p.label,p.description,p.license,p.navigationDefaultAccess]);
  await writeRules(tx,t,p.id,grantRules(p));
  await tx.query('DELETE FROM md_permission_data_scopes WHERE tenant_id=$1 AND permission_set_id=$2',[t,p.id]);
  for(const [objectApi,scope] of Object.entries(p.recordDataScopes??{}))
   await tx.query('INSERT INTO md_permission_data_scopes(tenant_id,permission_set_id,object_api,scope) VALUES($1,$2,$3,$4)',
    [t,p.id,objectApi,scope]);
 }
 for(const p of next.profiles){
  if(equal(p,previous.profiles.find(old=>old.id===p.id)))continue;
  const old=await tx.query<{editor_set_id:string|null}>('SELECT editor_set_id FROM md_profiles WHERE tenant_id=$1 AND id=$2',[t,p.id]);
  const setId=old.rows[0]?.editor_set_id??randomUUID();
  if(!old.rows[0]?.editor_set_id)await tx.query(
   "INSERT INTO md_permission_sets(tenant_id,id,api_name,label) VALUES($1,$2,$3,$4)",
   [t,setId,'Profile_'+p.id.replace(/-/g,''),p.label]);
  await tx.query('INSERT INTO md_profiles(tenant_id,id,api_name,label,description,license,is_standard,editor_set_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,id) DO UPDATE SET api_name=EXCLUDED.api_name,label=EXCLUDED.label,description=EXCLUDED.description,license=EXCLUDED.license,editor_set_id=EXCLUDED.editor_set_id',
   [t,p.id,p.apiName,p.label,p.description,p.license,p.isStandard,setId]);
  await tx.query('DELETE FROM md_profile_permission_sets WHERE tenant_id=$1 AND profile_id=$2',[t,p.id]);
  for(const id of [setId,...p.inheritedPermissionSetIds])await tx.query(
   'INSERT INTO md_profile_permission_sets(tenant_id,profile_id,permission_set_id) VALUES($1,$2,$3)',[t,p.id,id]);
  await writeRules(tx,t,setId,grantRules(p));
 }
 for(const g of next.permissionSetGroups){
  if(equal(g,previous.permissionSetGroups.find(old=>old.id===g.id)))continue;
  await tx.query('INSERT INTO md_permission_set_groups(tenant_id,id,api_name,label,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,id) DO UPDATE SET api_name=EXCLUDED.api_name,label=EXCLUDED.label,description=EXCLUDED.description,calculated_at=now()',
   [t,g.id,g.apiName,g.label,g.description]);
  await tx.query('DELETE FROM md_permission_group_sets WHERE tenant_id=$1 AND group_id=$2',[t,g.id]);
  await tx.query('DELETE FROM md_permission_group_mutes WHERE tenant_id=$1 AND group_id=$2',[t,g.id]);
  for(const id of g.permissionSetIds)await tx.query(
   'INSERT INTO md_permission_group_sets(tenant_id,group_id,permission_set_id) VALUES($1,$2,$3)',[t,g.id,id]);
  for(const r of groupMutes(g))await tx.query(
   'INSERT INTO md_permission_group_mutes(tenant_id,group_id,resource,action) VALUES($1,$2,$3,$4)',[t,g.id,r.resource,r.action]);
 }
 for(const g of [...next.publicGroups,...next.queues]){
  if(equal(g,[...previous.publicGroups,...previous.queues].find(old=>old.id===g.id)))continue;
  await tx.query('INSERT INTO md_access_groups(tenant_id,id,kind,api_name,label,description) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,id) DO UPDATE SET api_name=EXCLUDED.api_name,label=EXCLUDED.label,description=EXCLUDED.description',
   [t,g.id,'groupIds' in g?'PublicGroup':'Queue',g.apiName,g.label,g.description]);
  await tx.query('DELETE FROM md_access_group_members WHERE tenant_id=$1 AND group_id=$2',[t,g.id]);
  const lists:[string,string[]][]=[['User',g.userIds],['Role',g.roleIds],['RoleAndSubordinates',g.roleAndSubordinateIds],
   ['PublicGroup','groupIds' in g?g.groupIds:g.publicGroupIds]];
  for(const [kind,members] of lists)for(const member of members)await tx.query(
   'INSERT INTO md_access_group_members(tenant_id,group_id,member_kind,member_id) VALUES($1,$2,$3,$4)',[t,g.id,kind,member]);
  if('supportedObjectApiNames' in g){
   await tx.query('DELETE FROM md_queue_objects WHERE tenant_id=$1 AND queue_id=$2',[t,g.id]);
   for(const api of g.supportedObjectApiNames)await tx.query(
    'INSERT INTO md_queue_objects(tenant_id,queue_id,object_api) VALUES($1,$2,$3)',[t,g.id,api]);
  }
 }
 for(const u of next.users){
  if(equal(u,previous.users.find(old=>old.id===u.id)))continue;
  if(previous.users.find(old=>old.id===u.id)?.roleId!==u.roleId){
   await tx.query('DELETE FROM md_user_roles WHERE tenant_id=$1 AND user_id=$2',[t,u.id]);
   if(u.roleId)await tx.query('INSERT INTO md_user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)',[t,u.id,u.roleId]);
  }
  await tx.query('DELETE FROM md_user_profiles WHERE tenant_id=$1 AND user_id=$2',[t,u.id]);
  if(u.profileId)await tx.query('INSERT INTO md_user_profiles(tenant_id,user_id,profile_id) VALUES($1,$2,$3)',[t,u.id,u.profileId]);
  await tx.query('DELETE FROM md_permission_assignments WHERE tenant_id=$1 AND user_id=$2',[t,u.id]);
  for(const id of u.permissionSetIds)await tx.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[t,u.id,id]);
  await tx.query('DELETE FROM md_user_permission_groups WHERE tenant_id=$1 AND user_id=$2',[t,u.id]);
  for(const id of u.permissionSetGroupIds)await tx.query('INSERT INTO md_user_permission_groups(tenant_id,user_id,group_id) VALUES($1,$2,$3)',[t,u.id,id]);
  await tx.query('UPDATE md_users SET time_zone=$3,locale=$4,currency_iso_code=$5,user_type=$6,external_account_id=$7 WHERE tenant_id=$1 AND id=$2',
   [t,u.id,u.timeZone,u.locale,u.currencyIsoCode??null,u.userType,u.externalAccountId??null]);
 }
 if(!equal(next.sharingSettings,previous.sharingSettings)||!equal(next.sharingRules,previous.sharingRules))await writePolicies(tx,t,next);
 for(const [table,ids] of [
  ['md_permission_set_groups',next.permissionSetGroups.map(g=>g.id)],
  ['md_access_groups',[...next.publicGroups,...next.queues].map(g=>g.id)]
 ] as const)await tx.query('DELETE FROM '+table+' WHERE tenant_id=$1 AND NOT(id=ANY($2::uuid[]))',[t,ids]);
 const deletedProfiles=await tx.query<{editor_set_id:string}>(
  'DELETE FROM md_profiles WHERE tenant_id=$1 AND NOT(id=ANY($2::uuid[])) RETURNING editor_set_id',[t,next.profiles.map(p=>p.id)]);
 for(const p of deletedProfiles.rows)if(p.editor_set_id){
  await tx.query('DELETE FROM md_permission_rules WHERE tenant_id=$1 AND permission_set_id=$2',[t,p.editor_set_id]);
  await tx.query('DELETE FROM md_permission_sets WHERE tenant_id=$1 AND id=$2',[t,p.editor_set_id]);
 }
 await tx.query('DELETE FROM md_permission_rules r WHERE r.tenant_id=$1 AND NOT(r.permission_set_id=ANY($2::uuid[])) AND NOT EXISTS(SELECT 1 FROM md_profiles p WHERE p.tenant_id=$1 AND p.editor_set_id=r.permission_set_id)',
  [t,next.permissionSets.map(p=>p.id)]);
 await tx.query('DELETE FROM md_permission_sets s WHERE s.tenant_id=$1 AND NOT(s.id=ANY($2::uuid[])) AND NOT EXISTS(SELECT 1 FROM md_profiles p WHERE p.tenant_id=$1 AND p.editor_set_id=s.id)',
  [t,next.permissionSets.map(p=>p.id)]);
 await tx.query('DELETE FROM md_roles WHERE tenant_id=$1 AND NOT(id=ANY($2::uuid[]))',[t,next.roles.map(r=>r.id)]);
}
