import type {AppRoute} from '../../workspace/Navigation/appRouting';

/** Only authoritative OneEngine capabilities may reveal Setup destinations.
 * Labels are presentation aliases; never infer rights from role/profile names.
 */
export const setupMenuTokens: Readonly<Record<string, readonly string[]>> = {
  'Tenant Management':['setup:TenantManagement:view'],
  'Company Settings':['setup:CompanySettings:view'],
  'Security & Recovery':['setup:SecurityRecovery:view'],
  'Connected Apps':['setup:ConnectedApps:view'],
  'Audit Trail':['setup:AuditTrail:view'],
  'Object Manager':['setup:ObjectManager:view'],
  'Records':['setup:Records:view'],
  'Universal Data Loader':['setup:DataLoader:view'],
  'Page Builder':['setup:PageBuilder:view'],
  'App Manager':['setup:AppManager:view'],
  'AppExchange':['setup:AppExchange:view'],
  'Named Credentials':['setup:NamedCredentials:view'],
  'Named Devices':['setup:NamedDevices:view'],
  'Flows':['setup:Flows:view'],
  'Paused and Waiting Interviews':['setup:PausedInterviews:view'],
  'Scheduled Actions':['setup:Records:view'],
  'Scheduled Flows':['setup:ScheduledFlows:view'],
  'Flow History':['setup:FlowHistory:view'],
  'Process Automation Settings':['setup:ProcessAutomation:view'],
  'Users':['setup:Users:view'],
  'Roles':['setup:Roles:view'],
  'Public Groups':['setup:PublicGroups:view'],
  'Profiles':['setup:Profiles:view'],
  'Permission Sets':['setup:PermissionSets:view'],
  'Permission Set Groups':['setup:PermissionSetGroups:view'],
  'Sharing Settings':['setup:SharingSettings:view'],
  'Sharing Rules':['setup:SharingRules:view']
};
export function canSeeSetupItem(label:string,permissions:readonly string[]):boolean{
  if(label==='Setup Home')return true;
  const expected=setupMenuTokens[label];
  return Boolean(expected?.some(token=>permissions.includes(token)));
}
export function canOpenSetupRoute(route:AppRoute,permissions:readonly string[]):boolean{
  if(route.kind!=='setup'||route.workspace==='home')return true;
  const simple:Partial<Record<string,string>>={
    'object-manager':'Object Manager','data-loader':'Universal Data Loader',
    'page-builder':'Page Builder','app-manager':'App Manager','app-exchange':'AppExchange',
    'flow-builder':'Flows','flow-interviews':'Paused and Waiting Interviews',
    'scheduled-actions':'Scheduled Actions',
    'scheduled-flows':'Scheduled Flows','flow-logs':'Flow History',
    'automation-settings':'Process Automation Settings','tenant-management':'Tenant Management'
  };
  if(simple[route.workspace])return canSeeSetupItem(simple[route.workspace]!,permissions);
  if(route.workspace==='named-credentials')
    return route.resourceApiName!=='Webhooks' && canSeeSetupItem(
      route.resourceApiName==='NamedDevices'?'Named Devices':'Named Credentials',permissions);
  if(route.workspace==='company-settings'){
    if(route.resourceApiName!=='security')return canSeeSetupItem('Company Settings',permissions);
    const label=route.resourceId==='connected-apps'?'Connected Apps':
      route.resourceId==='audit-trail'?'Audit Trail':'Security & Recovery';
    return canSeeSetupItem(label,permissions);
  }
  if(route.workspace==='rbac'){
    const sections:Record<string,string>={
      Users:'Users',Roles:'Roles',PublicGroups:'Public Groups',Profiles:'Profiles',
      PermissionSets:'Permission Sets',PermissionSetGroups:'Permission Set Groups',
      SharingSettings:'Sharing Settings',SharingRules:'Sharing Rules'
    };
    if(route.resourceApiName)return canSeeSetupItem(sections[route.resourceApiName]??'',permissions);
    return Object.values(sections).some(label=>canSeeSetupItem(label,permissions));
  }
  return false;
}
