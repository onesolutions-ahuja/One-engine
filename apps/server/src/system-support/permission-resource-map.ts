/** UI permission names are labels for central RBAC resource/action pairs.
 * The evaluator continues to receive one canonical SQL resource/action contract. */
export const systemPermissionBindings: Readonly<Record<string, readonly [string,string]>> = {
  'platformOperations:read':['PlatformOperations','read'],
  'platformOperations:manage':['PlatformOperations','manage'],
  'metadata:read':['ObjectDefinition','read'],
  'metadata:write':['ObjectDefinition','create'],
  'security:read':['Security','read'],
  'security:manage':['Security','manage'],
  'objects:manage':['ObjectDefinition','manage'],
  'objects:hardDelete':['ObjectDefinition','hard-delete'],
  'fields:create':['FieldDefinition','create'],
  'fields:delete':['FieldDefinition','delete'],
  'fields:hardDelete':['FieldDefinition','hard-delete'],
  'flows:manage':['FlowDefinition','manage'],
  'flows:run':['Flow','execute'],
  'flows:system-context':['FlowDefinition','system-context'],
  'namedCredentials:manage':['NamedCredential','manage'],
  'email:send':['Email','send'],
  'callouts:execute':['NamedCredential','execute'],
  'httpCallouts:execute':['HTTPCallout','execute'],
  'namedCredentials:read':['NamedCredential','read'],
  'platformEvents:publish':['PlatformEvent','publish'],
  'platformEvents:subscribe':['PlatformEvent','subscribe'],
  'webhooks:manage':['WebhookSubscription','manage'],
  'webhooks:read':['WebhookSubscription','read'],
  'webhooks:execute':['WebhookSubscription','execute'],
  'notifications:send':['Notification','send'],
  'approvals:manage':['ApprovalRequest','manage'],
  'reports:manage':['SystemDefinition:reports','manage'],
  'pages:manage':['PageDefinition','manage'],
  'components:manage':['ComponentDefinition','create'],
  'dashboards:manage':['SystemDefinition:dashboards','manage'],
  'dashboards:viewTeam':['SystemDefinition:dashboards','read'],
  'data:viewAll':['Record','viewAll'],
  'data:modifyAll':['Record','modifyAll'],
  'api:enabled':['API','execute'],
  'users:read':['User','read'],
  'users:create':['User','create'],
  'users:edit':['User','edit'],
  'users:delete':['User','delete'],
  'audit:read':['SetupAudit','read'],
  'audit:export':['SetupAudit','export'],
  'monitoring:read':['SecurityMonitoring','read'],
  'monitoring:manage':['SecurityMonitoring','manage'],
  'connectedApps:manage':['ConnectedApp','manage'],
  'setup:TenantManagement:view':['SetupMenu:TenantManagement','read'],
  'setup:CompanySettings:view':['SetupMenu:CompanySettings','read'],
  'setup:SecurityRecovery:view':['SetupMenu:SecurityRecovery','read'],
  'setup:ConnectedApps:view':['SetupMenu:ConnectedApps','read'],
  'setup:AuditTrail:view':['SetupMenu:AuditTrail','read'],
  'setup:ObjectManager:view':['SetupMenu:ObjectManager','read'],
  'setup:Records:view':['SetupMenu:Records','read'],
  'setup:DataLoader:view':['SetupMenu:DataLoader','read'],
  'setup:PageBuilder:view':['SetupMenu:PageBuilder','read'],
  'setup:AppManager:view':['SetupMenu:AppManager','read'],
  'setup:AppExchange:view':['SetupMenu:AppExchange','read'],
  'setup:NamedCredentials:view':['SetupMenu:NamedCredentials','read'],
  'setup:WebhookEndpoints:view':['SetupMenu:WebhookEndpoints','read'],
  'setup:NamedDevices:view':['SetupMenu:NamedDevices','read'],
  'setup:Flows:view':['SetupMenu:Flows','read'],
  'setup:PausedInterviews:view':['SetupMenu:PausedInterviews','read'],
  'setup:ScheduledFlows:view':['SetupMenu:ScheduledFlows','read'],
  'setup:FlowHistory:view':['SetupMenu:FlowHistory','read'],
  'setup:ProcessAutomation:view':['SetupMenu:ProcessAutomation','read'],
  'setup:ReportsBuilder:view':['SetupMenu:ReportsBuilder','read'],
  'setup:DashboardBuilder:view':['SetupMenu:DashboardBuilder','read'],
  'setup:ReportsView:view':['SetupMenu:ReportsView','read'],
  'setup:DashboardsView:view':['SetupMenu:DashboardsView','read'],
  'setup:Users:view':['SetupMenu:Users','read'],
  'setup:Roles:view':['SetupMenu:Roles','read'],
  'setup:PublicGroups:view':['SetupMenu:PublicGroups','read'],
  'setup:Profiles:view':['SetupMenu:Profiles','read'],
  'setup:PermissionSets:view':['SetupMenu:PermissionSets','read'],
  'setup:PermissionSetGroups:view':['SetupMenu:PermissionSetGroups','read'],
  'setup:SharingSettings:view':['SetupMenu:SharingSettings','read'],
  'setup:SharingRules:view':['SetupMenu:SharingRules','read']
};
const reverse = new Map(Object.entries(systemPermissionBindings).map(([key,[resource,action]])=>[resource+':'+action,key]));
export function toPermissionRule(key:string):{resource:string;action:string} {
  if(key==='*:*')return {resource:'*',action:'*'};
  const known=systemPermissionBindings[key];
  if(known)return {resource:known[0],action:known[1]};
  const at=key.lastIndexOf(':');
  if(at<1||at===key.length-1)throw Error('Invalid system permission');
  const resource=key.slice(0,at),action=key.slice(at+1);
  if(!/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(resource)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(action))
    throw Error('Invalid system permission');
  return {resource,action};
}
export function toDisplayedPermission(resource:string,action:string):string {
  return reverse.get(resource+':'+action)??resource+':'+action;
}
