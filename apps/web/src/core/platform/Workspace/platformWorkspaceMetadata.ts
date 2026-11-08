import {workspaces,setupNavigation} from '../../metadata/Definitions/metadata';

/** Phase 4a-c: reuse canonical Setup, tenant and Object Manager workspaces.
 * These are metadata descriptors only. The existing runtime performs RBAC
 * checks for route access and each API operation.
 */
type SetupWorkspace=typeof workspaces[number];
export type PlatformWorkspaceDescriptor={
 id:string;label:string;group:string;
 permission:'metadata:read'|'metadata:write'|'security:read'|'platform:tenants:manage';
};
const restricted:Readonly<Record<string,PlatformWorkspaceDescriptor['permission']>>={
 'Tenant Management':'platform:tenants:manage',
 'Object Manager':'metadata:read',
 'Company Settings':'metadata:read',
 'Company Information':'metadata:read',
 'Currencies':'metadata:read',
 'Named Credentials':'metadata:write',
 'AppExchange':'metadata:write',
 'App Manager':'metadata:read',
 'Users':'security:read',
 'Profiles':'security:read',
 'Permission Sets':'security:read',
 'Roles':'security:read',
 'Public Groups':'security:read',
 'Permission Set Groups':'security:read',
 'Sharing Settings':'security:read',
 'Sharing Rules':'security:read'
};
export function platformWorkspaceDescriptors():PlatformWorkspaceDescriptor[]{
 const byLabel=new Map<string,SetupWorkspace>(workspaces.map(w=>[w.label,w]));
 const descriptors:PlatformWorkspaceDescriptor[]=[];
 for(const group of setupNavigation){
  for(const label of group.items){
   const matched=byLabel.get(label);
   if(!matched)continue;
   descriptors.push({id:matched.id,label,group:group.group,
    permission:restricted[label]??'metadata:read'});
  }
 }
 return descriptors;
}
export function permittedPlatformWorkspaces(
 granted:ReadonlySet<string>,descriptors=platformWorkspaceDescriptors()
):PlatformWorkspaceDescriptor[]{
 return descriptors.filter(item=>granted.has(item.permission));
}
export type PlatformEditorBinding={
 workspaceId:string;objectApiName?:string;mode:'view'|'edit';
};
export function validatePlatformEditorBinding(
 binding:PlatformEditorBinding,availableObjectApiNames:ReadonlySet<string>,
 granted:ReadonlySet<string>
):string[]{
 const workspace=platformWorkspaceDescriptors().find(item=>item.id===binding.workspaceId);
 if(!workspace)return ['Unknown platform workspace'];
 if(!granted.has(workspace.permission))return ['Workspace permission denied'];
 if(!['view','edit'].includes(binding.mode))return ['Invalid editor mode'];
 if(binding.mode==='edit'&&!granted.has(workspace.permission==='security:read'?'security:manage':workspace.permission==='platform:tenants:manage'?'platform:tenants:manage':'metadata:write'))
  return ['Workspace edit permission denied'];
 if(binding.workspaceId==='object-manager'&&
   (typeof binding.objectApiName!=='string'||!availableObjectApiNames.has(binding.objectApiName)))
  return ['Object metadata unavailable'];
 return [];
}

/** 4d–4g: resolve all existing Setup navigation entries through the same
 * central workspace implementation; aliases are not separate modules.
 */
const workspaceAliases:Readonly<Record<string,string>>={
 'Currencies':'company-settings',
 'Users':'rbac','Roles':'rbac','Public Groups':'rbac','Profiles':'rbac',
 'Reports Builder':'report-builder','Reports View':'report-builder',
 'Dashboard Builder':'dashboard-builder','Dashboard View':'dashboard-builder',
 'Records':'home',
 'Permission Sets':'rbac','Permission Set Groups':'rbac',
 'Sharing Settings':'rbac','Sharing Rules':'rbac',
 'Paused and Waiting Interviews':'flow-builder','Scheduled Flows':'flow-builder',
 'Flow History':'flow-builder'
};
export function platformNavigationEntries():PlatformWorkspaceDescriptor[]{
 const canonical=new Map(workspaces.map(item=>[item.label,item.id]));
 return setupNavigation.flatMap(group=>group.items.flatMap(label=>{
  const id=canonical.get(label)??workspaceAliases[label];
  if(!id)return [];
  return [{id,label,group:group.group,permission:restricted[label]??'metadata:read'}];
 }));
}
export function authorizePlatformNavigation(
 label:string,grants:ReadonlySet<string>,mode:'view'|'edit'='view'
):PlatformWorkspaceDescriptor|undefined{
 const descriptor=platformNavigationEntries().find(item=>item.label===label);
 if(!descriptor||!grants.has(descriptor.permission))return undefined;
 if(mode==='edit'&&!grants.has(descriptor.permission==='security:read'?'security:manage':descriptor.permission==='platform:tenants:manage'?'platform:tenants:manage':'metadata:write'))return undefined;
 return descriptor;
}
