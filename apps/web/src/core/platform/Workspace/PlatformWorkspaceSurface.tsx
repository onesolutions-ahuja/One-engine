import {PageFormulaScope} from '../../components/RegisteredComponent/PageFormulaScope';
import React,{type ReactNode} from 'react';
import {platformNavigationEntries} from './platformWorkspaceMetadata';
import type {LightningPageMetadata,LibraryComponentMetadata} from '../../metadata/Definitions/metadata';
import {findRegisteredComponent} from '../../components/Registry/componentRegistryLookup';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import MetadataBoundPageComponent from '../../pages/MetadataBoundPageComponent/MetadataBoundPageComponent';
import {needsMetadataComponentRuntime} from '../../pages/PageRuntime/pageComponentBindings';
import {PlatformPageSlotsProvider} from './PlatformPageSlot';
import {resolvePageComponentStyle} from '../../pages/TemplatePageRuntime/pageComponentLayout';

/** Shared, registry-resolved platform presentation wrapper.
 * The enclosing Setup route and every OneEngine API retain their RBAC gates.
 * A client-side descriptor does not grant permissions or execute actions.
 */
export type SystemWorkspaceId='app-manager'|'app-exchange'|'tenant-management'|'rbac'|'company-settings'|'object-manager'|'named-credentials'|'approval-processes'|'automation-settings';
const supported:ReadonlySet<string>=new Set(['app-manager','app-exchange','tenant-management','rbac','company-settings','object-manager','named-credentials','approval-processes','automation-settings']);
const descriptions:Readonly<Record<SystemWorkspaceId,string>>={
 'app-manager':'Configure applications and navigation',
 'app-exchange':'Manage installed applications',
 'tenant-management':'Manage authorised tenant administration',
 'rbac':'Manage users, profiles and sharing',
 'company-settings':'Manage company settings',
 'object-manager':'Configure object metadata',
 'named-credentials':'Manage named credentials and secrets',
 'approval-processes':'Manage approval definitions',
 'automation-settings':'Configure process execution policies'
};
export function resolveSystemWorkspace(id:string){
 if(!supported.has(id))return undefined;
 const matches=platformNavigationEntries().filter(entry=>entry.id===id);
 const primary=matches[0];
 if(!primary)return undefined;
 return {id:id as SystemWorkspaceId,label:primary.label,description:descriptions[id as SystemWorkspaceId],
  requiredPermission:primary.permission,aliases:matches.map(entry=>entry.label)};
}
export default function PlatformWorkspaceSurface({
 workspace,children,permitted=false,resolving=false,pages=[],libraryComponents=[],canEditSystemPage=false,onEditSystemPage,device='Desktop',componentRuntime
}:{
 workspace:SystemWorkspaceId;children:ReactNode;permitted:boolean;
 /** True while the signed-in user's permission snapshot is still loading. A denial is only
  * shown once permissions are known, so a slow /auth/me never flashes a false "access" error.
  * It never grants access: an unresolved check renders no workspace content. */
 resolving?:boolean;
 pages?:readonly LightningPageMetadata[];libraryComponents?:readonly LibraryComponentMetadata[];
 canEditSystemPage?:boolean;onEditSystemPage?:(apiName:string)=>void;device?:'Desktop'|'Tablet'|'Phone';
 componentRuntime?:Pick<React.ComponentProps<typeof MetadataBoundPageComponent>,
  'apiRequest'|'objects'|'apps'|'pages'|'currentAppId'|'reports'|'availableFlows'|'formFactor'|'onNavigate'|'onLaunchFlow'>;
}){
 const definition=resolveSystemWorkspace(workspace);
 if(!definition)return <div role="alert">Setup workspace configuration unavailable. The route is not registered.</div>;
 if(!permitted&&resolving)return <div className="setup-card" role="status">Checking access…</div>;
 if(!permitted)return <div role="alert">Access to this Setup workspace has not been verified. Check your OneEngine permission policy or refresh the session. No permission checks have been bypassed.</div>;
 const pageName='MetaDrive_Admin_'+workspace.replace(/-/g,'_');
 const page=pages.find(item=>item.apiName===pageName&&item.scope==='platform-system'&&item.ownerNamespace==='MetaDrive'&&item.status==='Active'&&Array.isArray(item.requiredPermissions)&&item.requiredPermissions.length===1&&item.requiredPermissions[0]===definition.requiredPermission);
 const registered=page?.components.filter(instance=>instance.visible&&!instance.properties.platformSlotKey&&instance.type.startsWith('Custom:'))
  .map(instance=>({
    instance,component:findRegisteredComponent(libraryComponents,instance.type.slice('Custom:'.length),'page')
  })).filter(item=>item.component)??[];
 return <PageFormulaScope key={pageName} components={page?.components} catalog={libraryComponents}><section className="platform-workspace-surface" data-workspace={definition.id}
   aria-label={definition.label} data-metadata-source="platform-workspace-registry">
   {page&&<div className="platform-system-page" aria-label={page.label}>
     {canEditSystemPage&&onEditSystemPage&&<button type="button" className="btn btn-small"
       onClick={()=>onEditSystemPage(page.apiName)}>Edit page layout</button>}
     <div className="platform-system-page-components" style={{display:'flex',flexWrap:'wrap',gap:12}}>
       {registered.map(({instance,component})=><div key={instance.id}
         style={{...resolvePageComponentStyle(instance.properties,instance.type,device),
           maxWidth:'100%',width:instance.position?.width??'100%'}}>
         {needsMetadataComponentRuntime(instance.properties)
           ?componentRuntime
             ?<MetadataBoundPageComponent {...componentRuntime} definition={component!}
               component={instance} pageSessionKey={'platform:'+pageName} pageComponents={page.components}/>
             :<div role="alert">Page action runtime unavailable</div>
           :<RegisteredComponent formulaInstanceId={instance.id} definition={component!} props={instance.properties}/>}
       </div>)}
     </div>
   </div>}
   {page?<PlatformPageSlotsProvider page={page} libraryComponents={libraryComponents}>{children}</PlatformPageSlotsProvider>:children}
 </section></PageFormulaScope>;
}
