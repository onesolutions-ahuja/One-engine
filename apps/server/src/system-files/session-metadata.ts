import type {SqlPersistence} from './sql-persistence.js';
import {RbacEngine, type PermissionCheck} from './rbac-engine.js';
import {systemPermissionBindings} from '../system-support/permission-resource-map.js';

/** Session capabilities are derived exclusively from the shared OneEngine RBAC evaluator. */
const capabilities:readonly (PermissionCheck&{capability:string})[]=[
  {resource:'ObjectDefinition',action:'read',capability:'metadata:read'},
  {resource:'ObjectDefinition',action:'create',capability:'metadata:write'},
  {resource:'Security',action:'read',capability:'security:read'},
  {resource:'Security',action:'manage',capability:'security:manage'},
  {resource:'Tenant',action:'manage',capability:'platform:tenants:manage'},
  {resource:'Flow',action:'execute',capability:'flows:run'},
  {resource:'FlowDefinition',action:'manage',capability:'flows:manage'},
  {resource:'FlowDefinition',action:'system-context',capability:'flows:system-context'},
  {resource:'Licence',action:'manage',capability:'licence:manage'},
  // Setup visibility is evaluated by the same SQL OneEngine engine as API rights.
  ...Object.entries(systemPermissionBindings)
    .filter(([token])=>token.startsWith('setup:'))
    .map(([capability,[resource,action]])=>({resource,action,capability}))
];
export async function sessionMetadata(db:SqlPersistence,tenantId:string,userId:string) {
  const rbac=new RbacEngine(db);
  const [profile,fields,types,landing,tenant,identity]=await Promise.all([
    db.query<{profile_id:string;profile_name:string|null;profile_api:string|null}>(`
      SELECT up.profile_id,p.label AS profile_name,p.api_name AS profile_api
      FROM md_user_profiles up LEFT JOIN md_profiles p
        ON p.tenant_id=up.tenant_id AND p.id=up.profile_id
      WHERE up.tenant_id=$1 AND up.user_id=$2`,[tenantId,userId]),
    db.query<{object_api:string;api_name:string}>(`SELECT object_api,api_name
      FROM md_field_definitions WHERE tenant_id=$1 ORDER BY object_api,api_name`,[tenantId]),
    db.query<{object_api:string;record_type_id:string;active:boolean}>(`SELECT object_api,record_type_id,active
      FROM md_object_record_types WHERE tenant_id=$1`,[tenantId]),
    db.query<{landing_app_api:string}>('SELECT landing_app_api FROM md_users WHERE tenant_id=$1 AND id=$2',[tenantId,userId]),
    db.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[tenantId]),
    db.query<{id:string;email:string;display_name:string;time_zone:string;locale:string;
      currency_iso_code:string|null}>(
      `SELECT id,email,display_name,time_zone,locale,currency_iso_code
       FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true`,[tenantId,userId])
  ]);
  const sessionUser=identity.rows[0];
  if(!sessionUser)throw new Error('Authenticated formula context is unavailable');
  const checks:PermissionCheck[]=[
    ...capabilities,
    ...fields.rows.flatMap(f=>[
      {resource:f.object_api+'.'+f.api_name,action:'read'},
      {resource:f.object_api+'.'+f.api_name,action:'edit'}
    ]),
    ...[...new Set(types.rows.map(t=>t.object_api))].map(name=>({resource:name,action:'read'})),
    ...types.rows.map(t=>({resource:'RecordType:'+t.object_api+'.'+t.record_type_id,action:'read'}))
  ];
  const rights=await rbac.allowedMany(tenantId,userId,checks);
  const permissions=capabilities.filter((_,i)=>rights[i]).map(c=>c.capability);
  const fieldAccess:Record<string,{read:boolean;edit:boolean}>={};
  let cursor=capabilities.length;
  for(const f of fields.rows){
    fieldAccess[f.object_api+'.'+f.api_name]={read:rights[cursor++],edit:rights[cursor++]};
  }
  const objectRights=new Map<string,boolean>();
  for(const name of [...new Set(types.rows.map(t=>t.object_api))])objectRights.set(name,rights[cursor++]);
  const recordTypeAccess:Record<string,boolean>={};
  for(const type of types.rows)recordTypeAccess[type.object_api+'.'+type.record_type_id]=
    rights[cursor++]&&type.active&&objectRights.get(type.object_api)===true;
  return {user:{
    id:userId,userId,tenantId,tenantName:tenant.rows[0]?.name??'',profileId:profile.rows[0]?.profile_id??'',
    profileName:profile.rows[0]?.profile_name??null,profileApi:profile.rows[0]?.profile_api??null,
    displayName:sessionUser.display_name,email:sessionUser.email,
    timeZone:sessionUser.time_zone,locale:sessionUser.locale,
    currencyIsoCode:sessionUser.currency_iso_code,
    landingAppApi:landing.rows[0]?.landing_app_api??'Setup',permissions,fieldAccess,recordTypeAccess
  }};
}
