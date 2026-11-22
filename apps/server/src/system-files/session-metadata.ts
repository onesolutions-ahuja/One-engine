import type {SqlPersistence} from './sql-persistence.js';
import {RbacEngine, type PermissionCheck} from './rbac-engine.js';
import {systemPermissionBindings} from '../system-support/permission-resource-map.js';
import {loadConnectionSnapshot} from '../system-support/tenant-connections.js';
import {loadUserCustomFields} from '../system-support/tenant-formula-values.js';

/** Custom permissions named in this tenant's permission rules (CustomPermission:<Name>), each
 * TRUE/FALSE for this user. `others`: the answer for a name no rule mentions (full access = TRUE). */
async function customPermissionSnapshot(db:SqlPersistence,rbac:RbacEngine,tenantId:string,userId:string){
  const {rows}=await db.query<{name:string}>(`SELECT DISTINCT substr(resource,18) AS name FROM md_permission_rules
    WHERE tenant_id=$1 AND resource LIKE 'CustomPermission:%' ORDER BY 1 LIMIT 500`,[tenantId]);
  const names=rows.map(row=>row.name).filter(name=>/^[A-Za-z_][A-Za-z0-9_.]{0,79}$/.test(name));
  const allowed=await rbac.allowedMany(tenantId,userId,[...names,'__NoRuleNamesThis__']
    .map(name=>({resource:'CustomPermission:'+name,action:'read'})));
  return {names:Object.fromEntries(names.map((name,i)=>[name,allowed[i]===true])),others:allowed[names.length]===true};
}

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
      currency_iso_code:string|null;manager_id:string|null;manager_name:string|null}>(
      `SELECT u.id,u.email,u.display_name,u.time_zone,u.locale,u.currency_iso_code,
        m.id AS manager_id,m.display_name AS manager_name
       FROM md_users u LEFT JOIN md_users m ON m.tenant_id=u.tenant_id AND m.id=u.reports_to_user_id AND m.enabled=true
       WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true`,[tenantId,userId])
  ]);
  const sessionUser=identity.rows[0];
  // Connector/callout names for CONNECTED() in page formulas. Names only, never secrets.
  const connections=await loadConnectionSnapshot(db,tenantId);
  // @ThisTenant.User.<custom field> and @ThisTenant.Permission.<Name> in page formulas (display).
  // Page actions re-read both on the server, so a changed browser copy cannot pass a limit.
  const [customFields,customPermissions]=await Promise.all([
    loadUserCustomFields(db,tenantId,userId),customPermissionSnapshot(db,rbac,tenantId,userId)]);
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
    // @ThisTenant.User.Manager / ManagerName: the user's manager (Reports To).
    managerId:sessionUser.manager_id??'',managerName:sessionUser.manager_name??'',
    landingAppApi:landing.rows[0]?.landing_app_api??'Setup',permissions,fieldAccess,recordTypeAccess,
    connections,customFields,customPermissions
  }};
}
