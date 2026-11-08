import type {SqlExecutor} from '../system-files/sql-persistence.js';
import {displayRules,type Rule} from './rbac-contract.js';
/** Read a faithful SQL snapshot, including denies and inherited profile links. */
export async function readRbac(db:SqlExecutor,tenant:string){
 const tables=['md_permission_sets','md_roles','md_permission_rules','md_users','md_profiles',
  'md_user_profiles','md_user_roles','md_permission_assignments','md_object_definitions','md_field_definitions',
  'md_permission_set_groups','md_permission_group_sets','md_permission_group_mutes','md_user_permission_groups',
  'md_access_groups','md_access_group_members','md_queue_objects','md_sharing_settings','md_record_policies',
  'md_policy_owner_roles','md_policy_conditions','md_policy_condition_values','md_rbac_revisions','md_profile_permission_sets',
  'md_object_record_types','md_tenant_app_metadata','md_permission_data_scopes'];
 // A normal GET uses a pool-backed executor: bound parallelism avoids a
 // 27-query network waterfall without consuming the whole connection pool.
 // In SQL transactions the shared client still serialises these queries.
 const values:Array<{rows:any[]}>=[];
 for(let offset=0;offset<tables.length;offset+=4){
  const batch=await Promise.all(tables.slice(offset,offset+4)
   .map(table=>db.query('SELECT * FROM '+table+' WHERE tenant_id=$1',[tenant])));
  values.push(...batch);
 }
 const rows=(table:string):any[]=>values[tables.indexOf(table)].rows;
 const objects=rows('md_object_definitions').map(o=>o.api_name);
 const fields=rows('md_field_definitions').map(f=>f.object_api+'.'+f.api_name);
 const types=rows('md_object_record_types').map(r=>r.object_api+'.'+r.record_type_id);
 const catalog=await db.query<{api_name:string}>('SELECT COALESCE(m.api_name,a.api_name) AS api_name FROM md_apps a JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1 LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id UNION SELECT api_name FROM md_tenant_app_metadata WHERE tenant_id=$1',[tenant]);
 const apps=catalog.rows.map(r=>r.api_name);
 const rules=(setId:string):Rule[]=>rows('md_permission_rules').filter(r=>r.permission_set_id===setId)
  .map(r=>({resource:r.resource,action:r.action,effect:r.effect}));
 const ownSets=new Set(rows('md_profiles').map(p=>p.editor_set_id).filter(Boolean));
 const grants=(setId:string)=>{
  const policy=rows('md_permission_sets').find(p=>p.id===setId),all=rules(setId);
  if(policy?.navigation_default_access==='Allow')for(const resource of [...apps.map(a=>'App:'+a),...objects.map(o=>'Tab:'+o)])
   if(!all.some(r=>r.resource===resource&&r.action==='read'))all.push({resource,action:'read',effect:'allow'});
  return displayRules(all,objects,fields,types,apps);
 };
 const sets=rows('md_permission_sets').filter(p=>!ownSets.has(p.id)).map(p=>({
  id:p.id,apiName:p.api_name,label:p.label??p.api_name,license:p.license??'',description:p.description??'',
  navigationDefaultAccess:p.navigation_default_access??'Deny',
  recordDataScopes:Object.fromEntries(rows('md_permission_data_scopes').filter(s=>s.permission_set_id===p.id).map(s=>[s.object_api,s.scope])),
  ...grants(p.id)
 }));
 const members=(groupId:string,kind:string)=>rows('md_access_group_members')
  .filter(m=>m.group_id===groupId&&m.member_kind===kind).map(m=>m.member_id);
 const groupBase=(g:any)=>({id:g.id,apiName:g.api_name,label:g.label,description:g.description,
  userIds:members(g.id,'User'),roleIds:members(g.id,'Role'),roleAndSubordinateIds:members(g.id,'RoleAndSubordinates')});
 const conditions=(policyId:string)=>rows('md_policy_conditions').filter(c=>c.policy_id===policyId)
  .sort((a,b)=>a.position-b.position).map(c=>{
   const values=rows('md_policy_condition_values').filter(v=>v.policy_id===policyId&&v.condition_position===c.position)
    .sort((a,b)=>a.position-b.position).map(v=>v.value_text);
   const value=c.value_type==='array'?values:c.value_type==='number'?Number(values[0]):
    c.value_type==='boolean'?values[0]==='true':c.value_type==='null'?null:c.value_type==='undefined'?undefined:values[0];
   return {field:c.field_api,operator:c.operator,...(value!==undefined?{value}:{})};
  });
 const settings=Object.fromEntries(rows('md_sharing_settings').map(s=>[s.object_api,{
  defaultAccess:s.default_access,grantAccessUsingHierarchies:s.use_hierarchy,portalEnabled:s.portal_enabled,
  ...(s.portal_account_field?{portalAccountField:s.portal_account_field}:{}),
  restrictionRules:rows('md_record_policies').filter(p=>p.kind==='restriction'&&p.object_api===s.object_api).map(p=>({
   id:p.id,tenantId:tenant,objectApiName:p.object_api,enabled:p.enabled,subjectType:p.subject_type,
   ...(p.subject_id?{subjectId:p.subject_id}:{}),conditionLogic:p.condition_logic,conditions:conditions(p.id)
  }))
 }]));
 return {
  tenantId:tenant,revision:rows('md_rbac_revisions')[0]?.revision??0,
  profiles:rows('md_profiles').map(p=>({
   id:p.id,apiName:p.api_name,label:p.label,license:p.license??'MetaDrive',description:p.description??'',
   isStandard:p.is_standard??false,...grants(p.editor_set_id),
   inheritedPermissionSetIds:rows('md_profile_permission_sets')
    .filter(link=>link.profile_id===p.id&&link.permission_set_id!==p.editor_set_id).map(link=>link.permission_set_id)
  })),
  permissionSets:sets,
  permissionSetGroups:rows('md_permission_set_groups').map(g=>{
   const mutes=rows('md_permission_group_mutes').filter(m=>m.group_id===g.id).map(m=>({...m,effect:'allow' as const}));
   const display=displayRules(mutes,[],[],[],[]);
   const matrix=(prefix:string)=>Object.fromEntries(mutes.filter(m=>m.resource.startsWith(prefix))
    .map(m=>[m.resource.slice(prefix.length),true]));
   return {id:g.id,apiName:g.api_name,label:g.label,description:g.description,
    permissionSetIds:rows('md_permission_group_sets').filter(m=>m.group_id===g.id).map(m=>m.permission_set_id),
    calculationStatus:'Updated' as const,lastCalculatedAt:new Date(g.calculated_at).toISOString(),
    mutedSystemPermissions:display.systemPermissions.filter(token=>!mutes.some(m=>m.resource+':'+m.action===token&&
      (objects.includes(m.resource)||fields.includes(m.resource)||/^(App:|Tab:|RecordType:)/.test(m.resource)))),
    mutedObjectPermissions:Object.fromEntries(objects.flatMap(o=>{
     const items=mutes.filter(m=>m.resource===o);return items.length?[[o,Object.fromEntries(items.map(m=>[m.action,true]))]]:[];
    })),
    mutedFieldPermissions:Object.fromEntries(fields.flatMap(f=>{
     const items=mutes.filter(m=>m.resource===f);return items.length?[[f,Object.fromEntries(items.map(m=>[m.action,true]))]]:[];
    })),
    mutedRecordTypePermissions:matrix('RecordType:'),mutedAppPermissions:matrix('App:'),mutedTabPermissions:matrix('Tab:')
   };
  }),
  roles:rows('md_roles').map(r=>({id:r.id,apiName:r.api_name,name:r.label,parentRoleId:r.parent_role_id})),
  users:rows('md_users').map(u=>({
   id:u.id,name:u.display_name||u.email,username:u.email,role:'',roleId:rows('md_user_roles').find(r=>r.user_id===u.id)?.role_id??'',
   profileId:rows('md_user_profiles').find(p=>p.user_id===u.id)?.profile_id??'',
   permissionSetIds:rows('md_permission_assignments').filter(p=>p.user_id===u.id).map(p=>p.permission_set_id),
   permissionSetGroupIds:rows('md_user_permission_groups').filter(g=>g.user_id===u.id).map(g=>g.group_id),
   timeZone:u.time_zone??'UTC',locale:u.locale??'en-GB',userType:u.user_type??'internal',
   ...(u.currency_iso_code?{currencyIsoCode:u.currency_iso_code}:{}),...(u.external_account_id?{externalAccountId:u.external_account_id}:{})
  })),
  publicGroups:rows('md_access_groups').filter(g=>g.kind==='PublicGroup').map(g=>({...groupBase(g),groupIds:members(g.id,'PublicGroup')})),
  queues:rows('md_access_groups').filter(g=>g.kind==='Queue').map(g=>({...groupBase(g),publicGroupIds:members(g.id,'PublicGroup'),
   supportedObjectApiNames:rows('md_queue_objects').filter(q=>q.queue_id===g.id).map(q=>q.object_api)})),
  sharingRules:rows('md_record_policies').filter(p=>p.kind==='share').map(p=>({
   id:p.id,label:p.label,apiName:p.api_name,objectApiName:p.object_api,active:p.enabled,type:p.rule_type,
   ownerRoleIds:rows('md_policy_owner_roles').filter(r=>r.policy_id===p.id).map(r=>r.role_id),
   criteria:conditions(p.id).map(c=>({fieldApiName:c.field,operator:c.operator,value:String(c.value??'')})),
   filterLogic:p.condition_logic==='all'?'All' as const:'Any' as const,targetType:p.target_type,targetId:p.target_id,accessLevel:p.access_level
  })),sharingSettings:settings
 };
}
