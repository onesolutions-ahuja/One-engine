// @ts-nocheck
import WorkspaceFormulaScreen from '../../pages/PageRuntime/WorkspaceFormulaScreen';
import SetupLoadingState from './SetupLoadingState';
import { UneBrandLogo } from '../../branding/UneBrandLogo';
import CompanySettingsWorkspace from '../../settings/CompanySettingsWorkspace/CompanySettingsWorkspace';
import SettingsNavigationIcon from '../../settings/SettingsNavigationIcon';
import NotificationBell from '../../automation/Notifications/NotificationBell';
// Shared shell presentation, composed from registered metadata-driven runtime and tools.
import * as React from 'react';
import './InstalledAppMenu.css';
const WorkspaceShortcutHelp = React.lazy(() => import('../Navigation/WorkspaceShortcutHelp'));
const GlobalQuickActionLauncher=React.lazy(()=>import('./GlobalQuickActionLauncher'));
import { MobileAppNavigation, MobileAppLauncher } from './MobileAppNavigation';
import { resolvePageToolbarActions } from '../../pages/PageRuntime/pageToolbarActions';
import { type ObjectMetadata, type LightningPageMetadata, type LightningAppMetadata } from '../../metadata/Definitions/metadata';
import type { RecordData } from '../../records/RecordWorkspace/recordMetadataUtils';
const UniversalDataLoaderWorkspace=React.lazy(()=>import('./UniversalDataLoaderWorkspace'));
const ReportReadOnlyView=React.lazy(()=>import('../../builders/ReportBuilder/ReportReadOnlyView'));

export function renderSetupShell(ctx: any) {
  const { setupRouteAllowed, setupPermissions, setupAccessNotice, AppExchange, AppManager, ComponentLibrary, FieldWizardModal, FlowInterviews, FlowLogs, NamedCredentials, ScheduledFlows, ScheduledActionRecords, SetupFlowDialogs, SetupObjectDialogs, AccountSessionSecurity, ApprovalProcessManager, AutomationSettingsWorkspace, Bell, Check, ChevronLeft, ChevronRight, CircleHelp, CompanySettings, ConnectionHealthIndicator, DashboardBuilder, Database, DeveloperAccountSettings, FlowBuilderWorkspace, GlobalRecordSearch, History, LightningAppRuntime, Monitor, NavigationLoadTime, ObjectManager, PageBuilder, Permissions, PlatformPageSlot, PlatformWorkspaceSurface, ProfilePasswordMenu, RecordObjectPicker, RecordWorkspace, ReportBuilder, Search, SetupHome, TenantDomains, TenantEmailRecoverySettings, TenantManagement, TenantMfaSettings, TenantRecoveryPanel, TenantSecurityAudit, TenantUsagePanel, TenantUserLockSettings, X, accessControl, accessControlError, accessControlLoaded, activationAppIds, activeUtility, addField, addFlowElement, advancedMetadataLoaded, apiRequest, appUtilityRef, approvalBusyId, approvalProcesses, approvalRequests, apps, setApps, setPages, authorizeNamedCredential, canCreateDashboards, canManageApprovalProcesses, canManageApps, canReadMetadata, canReadSecurity, canManageDashboardTerritories, canManageDashboards, canManageFlows, canManageLibrary, canManageNamedCredentials, canManagePlatformTenants, canManageReportFolders, canManageUserIdentities, canRunFlows, canScheduleDashboards, cancelFlowInterview, changePage, cloneFlow, commitFlow, connectorProviders, connectorRights, connectorRightsLoaded, connectorRightsError, createDashboardSnapshot, createFlow, createObject, currentApp, currentAppNavigation, currentFieldAccess, currentProfileId, currentRecordTypeAccess, customTabObject, customTabStyle, customTabStyles, customTabAppIds, setCustomTabAppIds, dashboardFolders, dashboardRunningUserIds, dashboardTerritories, dashboardUserId, dashboards, deactivateFlow, decideApproval, defaultLightningPage, deleteApp, deleteApprovalProcess, deleteDashboard, deleteDashboardFolder, deleteDashboardSnapshot, deleteDashboardSubscription, deleteEmailAlert, deletePage, deleteField, deleteFlow, deleteLibraryComponent, deleteNamedCredential, deleteObject, restoreObject, deletePlatformEvent, deleteReport, emailAlerts, executeConnectorAppLifecycleFlow, exitDashboardViewer, exportFlow, fetchFlowListPage, filteredSetupGroups, flow, flowDefinitionsLoaded, flowDefinitionsError, reportsLoaded, reportsError, dashboardsLoaded, dashboardsError, flowDebug, flowHasUnsavedChanges, flowHistory, flowInterviews, flowInterviewsLoading, flowLogs, flowLogsLoading, flowRun, flowRunnerError, flowRunnerSubmitting, flowToolTab, flowValidation, flows, formulaEditorRef, goBackFlowScreen, grantConnectorLicence, importFlow, insertFormulaText, integrationConnections, isStandaloneMetadataPage, launchCustomTabWizard, libraryComponents, loadAppCommunicationHistory, loadConnectorMarketplaceApps, loadDashboardRecords, loadDashboardSnapshots, loadDashboardSubscriptions, loadFlowScreenRecords, loadNotifications, logout, markNotificationRead, metadataLoadError, metadataLoaded, namedCredentials, namedCredentialsLoaded, namedCredentialsError, namedCredentialsReadinessError, namedCredentialsEncryptionReady, navigateRoute, navigateSetupItem, newFieldAllowReparenting, newFieldApiName, newFieldCaseSensitive, newFieldChildRelationshipName, newFieldConfigurationError, newFieldController, newFieldControllerApiName, newFieldControllerValues, newFieldDefaultValue, newFieldDeleteBehavior, newFieldDescription, newFieldExternalId, newFieldFormula, newFieldFormulaValidation, newFieldHasDefault, newFieldHelpText, newFieldLabel, newFieldLayoutIds, newFieldLookupFilterLogic, newFieldLookupFilters, newFieldPicklistOptions, newFieldPicklistRestricted, newFieldPicklistValues, newFieldPrecision, newFieldRelationshipName, newFieldRelationshipTarget, newFieldRequired, newFieldReturnType, newFieldScale, newFieldStage, newFieldTextLength, newFieldType, newFieldUnique, newFieldValueSettings, newObjectDescription, newObjectLabel, newObjectPluralLabel, newObjectRecordNameLabel, newObjectSettings, notificationRef, notifications, notificationsLoading, notificationsOpen, notificationsUnreadCount, notify, object, objectSearch, objectSetting, objects, onLogout, openDashboardViewer, openFlowDebug, openPageForObject, openSetupWorkspace, page, pageCreationAppContext, pageRouteApiName, pages, pageDefinitionCache, platformEvents, previewReport, protectedPageRuntime, publishLibraryComponent, quickFind, readableRecordObjects, recentRoutes, recordSearch, redoFlow, refreshFlowInterviews, refreshObject, relatedLookupFilterOperators, removeFlowElement, reportFolders, reports, resetNewFieldDraft, restoreFlowVersion, rollbackLibraryComponent, rotateNamedCredential, route, routeAliasError, routeTiming, runDashboardSubscription, runFlow, runFlowDebug, runReport, runSavedFlowTests, runtimeFormFactor, saveAccessControl, saveApp, saveApprovalProcess, saveConnectorProvider, saveCustomTab, saveDashboard, saveDashboardFolder, saveDashboardSubscription, saveDashboardTerritories, saveEmailAlert, saveField, saveFlow, saveIntegrationConnection, saveLibraryComponent, saveNamedCredential, saveObject, savePage, savePageFromBuilder, updatePageDetailsFromBuilder, publishPageFromBuilder, deactivatePageFromBuilder, savePlatformEvent, saveReport, saveReportFolder, selectDashboard, selectFlow, selectedFlowId, setActiveUtility, setCustomTabObject, setCustomTabStyle, setFlowDebug, setFlowRun, setFlowRunnerError, setFlowToolTab, setLaunchCustomTabWizard, setNewFieldAllowReparenting, setNewFieldCaseSensitive, setNewFieldChildRelationshipName, setNewFieldControllerApiName, setNewFieldDefaultValue, setNewFieldDeleteBehavior, setNewFieldDescription, setNewFieldExternalId, setNewFieldFormula, setNewFieldFormulaValidation, setNewFieldHasDefault, setNewFieldHelpText, setNewFieldLabel, setNewFieldLayoutIds, setNewFieldLookupFilterLogic, setNewFieldLookupFilters, setNewFieldPicklistRestricted, setNewFieldPicklistValues, setNewFieldPrecision, setNewFieldRelationshipName, setNewFieldRelationshipTarget, setNewFieldRequired, setNewFieldReturnType, setNewFieldScale, setNewFieldStage, setNewFieldTextLength, setNewFieldType, setNewFieldUnique, setNewFieldValueSettings, setNewObjectDescription, setNewObjectLabel, setNewObjectPluralLabel, setNewObjectRecordNameLabel, setNewObjectSettings, setObject, setObjectSearch, setPage, setPageCreationAppContext, setQuickFind, setRecordSearch, setSelectedFlowId, setSetupSidebarCollapsed, setShowNewField, setShowNewObject, setShowCustomTabWizard, setStandalonePageMode, setupSidebarCollapsed, showCustomTabWizard, showNewField, showNewObject, standalonePageMode, submitFlowScreen, testIntegrationConnection, testNamedCredential, toast, setToast, toggleNamedCredentialEnabled, toggleNotifications, undoFlow, uneSolutionsLogoUrl, updateFlowConfig, updateFlowLabel, validateFlow, validateNewFieldFormula, workspace } = ctx;
  const {shortcutHelpOpen,setShortcutHelpOpen,sessionPermissionsLoaded} = ctx;
  const activeAppPage = route.kind === 'app-page'
    ? pages.find((candidate: LightningPageMetadata) => candidate.apiName === route.pageApiName && candidate.status === 'Active')
    : null;
  const pageToolbarActions = resolvePageToolbarActions(activeAppPage, libraryComponents);
  const isRecordsRoute = route.kind === 'record-list' || route.kind === 'record-detail';
  const activeAppPages = route.kind === 'app-page' || route.kind === 'app-home'
    ? currentAppNavigation.filter((entry: any) => entry.type === 'App Page')
        .map((entry: any) => pages.find((page: LightningPageMetadata) =>
          page.apiName === entry.apiName && page.pageType === 'App Page' && page.status === 'Active'))
        .filter(Boolean)
    : [];
  const installedAppValue=route.kind==='record-list'||route.kind==='record-detail'?'__records__'
    : route.kind==='app-page'||route.kind==='app-home'?(route.appId==='Records'?'__records__':route.appId)
    : route.kind==='setup'?'__setup__':'';
  const installedAppLabel=installedAppValue==='__records__'?'Records'
    :installedAppValue==='__setup__'?'Setup'
    :apps.find((item:LightningAppMetadata)=>item.apiName===installedAppValue)?.label??'Apps';
  const openInstalledApp = (value: string) => {
    if(value==='__setup__')return;
    if(value === '__mail__'){window.location.assign('/mail');return;}
    if(value === '__mail_admin__'){window.location.assign('/mail-admin');return;}
    if (value === '__home__') { openSetupWorkspace('home'); return; }
    if (value === '__records__') {
      const targetObject = route.kind === 'record-list' || route.kind === 'record-detail'
        ? route.objectApiName : readableRecordObjects[0]?.apiName;
      if (targetObject) navigateRoute({ kind: 'record-list', objectApiName: targetObject, appId: 'Records' });
      return;
    }
    const selectedApp = apps.find((item: LightningAppMetadata) => item.apiName === value);
    if (!selectedApp) return;
    const firstPage = selectedApp.navigationOrder.find((item: any) => item.type === 'App Page' &&
      selectedApp.navigationPageApiNames.includes(item.apiName) &&
      pages.some((page: LightningPageMetadata) => page.apiName === item.apiName && page.pageType === 'App Page' && page.status === 'Active'));
    navigateRoute(firstPage ? { kind: 'app-page', appId: selectedApp.apiName, pageApiName: firstPage.apiName }
      : { kind: 'app-home', appId: selectedApp.apiName });
  };
  const invokePageAction = (action: { componentId: string; event: string }) => {
    window.dispatchEvent(new CustomEvent('metadrive:page-toolbar-action', {
      detail: { pageSessionKey: route.kind === 'app-page' ? route.appId + ':' + route.pageApiName : '', componentId: action.componentId, action: action.event }
    }));
  };
  return (
    <div className={(standalonePageMode || isStandaloneMetadataPage ? 'lightning standalone-page-mode' : route.kind === 'setup' && route.workspace === 'page-builder' && Boolean(route.resourceApiName) ? 'lightning page-builder-editing' : 'lightning') + (route.kind === 'setup' && !standalonePageMode && !isStandaloneMetadataPage ? ' md-setup-light' : '')}>
      <header className="salesforce-header">
        {(route.kind === 'setup' || (isRecordsRoute && readableRecordObjects.length > 1) || ((route.kind === 'app-page' || route.kind === 'app-home') && activeAppPages.length > 1)) && <button type="button" className="md-sidebar-trigger"
          aria-label={setupSidebarCollapsed ? 'Open navigation' : 'Close navigation'}
          aria-expanded={!setupSidebarCollapsed} aria-controls={route.kind === 'setup' ? 'md-setup-sidebar' : isRecordsRoute ? 'md-records-sidebar' : 'md-app-sidebar'}
          onClick={() => setSetupSidebarCollapsed((collapsed: boolean) => !collapsed)}>
          {setupSidebarCollapsed ? <ChevronRight size={20} aria-hidden="true" /> : <ChevronLeft size={20} aria-hidden="true" />}
        </button>}

        <button type="button" className="brand brand-home-button" aria-label="Go to home" title="Home" onClick={() => openSetupWorkspace('home')}><UneBrandLogo className="brand-logo" src={uneSolutionsLogoUrl} decorative /><span className="brand-home-label">Home</span></button>
        <label className="header-installed-apps">
          <span>Apps</span>
          <select aria-label="Open installed app" value={installedAppValue} onChange={(event) => openInstalledApp(event.target.value)}>
            <option value="" disabled>Select app…</option>
            <option value="__setup__">Setup</option>
            <option value="__home__">Home</option>
            <option value="__mail__">Mail</option>
            <option value="__mail_admin__">Mail Administration</option>
            {readableRecordObjects.length > 0 && <option value="__records__">Records</option>}
            {apps.filter((app) => app.apiName !== 'Records').map(app=><option key={app.apiName} value={app.apiName}>{app.label}</option>)}
          </select>
        </label>
        <span className="header-mobile-app-name" aria-label="Current application">{installedAppLabel}</span>
        <MobileAppLauncher apps={[...apps, {apiName:'__mail__',label:'Mail'}, {apiName:'__mail_admin__',label:'Mail Administration'}]}
          showRecords={readableRecordObjects.length > 0} onOpenApp={openInstalledApp} />
        <div className="header-searches">
          <GlobalRecordSearch objects={readableRecordObjects}
            searchObject={(apiName, term) => apiRequest<{ records: RecordData[] }>(
              `/records/${encodeURIComponent(apiName)}?${new URLSearchParams({ search: term, limit: '5', offset: '0' })}`)}
            onSelect={(objectApiName, recordId) => navigateRoute({
              kind: 'record-detail', objectApiName, recordId, appId: currentApp?.apiName ?? 'Records'
            })}
            navigationItems={[
              {id:'home',label:'Home',group:'Workspace'},
              ...filteredSetupGroups.flatMap((group:{group:string;items:string[]}) =>
                group.items.map(item=>({id:'setup:'+item,label:item,group:group.group}))),
              ...activeAppPages.map((page:LightningPageMetadata)=>({id:'page:'+page.apiName,label:page.label,group:'App pages'}))
            ]}
            onNavigateItem={(id:string)=>{
              if(id==='home')openSetupWorkspace('home');
              else if(id.startsWith('setup:'))navigateSetupItem(id.slice(6));
              else if(id.startsWith('page:') && currentApp)navigateRoute({
                kind:'app-page',appId:currentApp.apiName,pageApiName:id.slice(5)
              });
            }}
            onOpenObject={(objectApiName:string)=>navigateRoute({kind:'record-list',objectApiName,appId:'Records'})} />

        </div>
        {(activeAppPages.length > 0 || activeAppPage) && <div className="header-page-context" aria-label="Current app pages"
          data-page-session-key={activeAppPage ? route.appId + ':' + route.pageApiName : undefined}>
          <nav className="header-page-tabs" aria-label="Workspace navigation">
            {activeAppPages.map((appPage: LightningPageMetadata) =>
              <button type="button" key={appPage.apiName}
                className={route.kind === 'app-page' && route.pageApiName === appPage.apiName ? 'header-page-tab active' : 'header-page-tab'}
                aria-current={route.kind === 'app-page' && route.pageApiName === appPage.apiName ? 'page' : undefined}
                onClick={() => navigateRoute({kind:'app-page',appId:currentApp?.apiName ?? '',pageApiName:appPage.apiName})}>{appPage.label}</button>)}
            {!activeAppPages.length && activeAppPage && <span className="header-page-title">{activeAppPage.label}</span>}
          </nav>
          {pageToolbarActions.map(action =>
            <button key={action.componentId} type="button" className="btn header-page-action"
              onClick={() => invokePageAction(action)}>{action.label}</button>)}
        </div>}
        {runtimeFormFactor==='Phone' && <div className="md-mobile-notification"><NotificationBell /></div>}
        <div className="header-tools" ref={appUtilityRef}>
          <button type="button" className="icon-button header-history-button" title="History" aria-label="History" aria-expanded={activeUtility === 'History'}
            onClick={() => setActiveUtility((current) => current === 'History' ? null : 'History')}><History size={17} /></button>
          {activeUtility === 'History' && <section className="app-utility-popover" aria-label="History utility">
            <div className="app-utility-heading"><strong>History</strong><button className="icon-button" aria-label="Close History" onClick={() => setActiveUtility(null)}><X size={14} /></button></div>
            <div className="app-utility-history">{recentRoutes.length
              ? recentRoutes.map((item) => <button key={item.key} onClick={() => { navigateRoute(item.route); setActiveUtility(null); }}>{item.label}</button>)
              : <p>No recent items.</p>}</div>
          </section>}
          {(isRecordsRoute||route.kind==='app-page'||route.kind==='app-home')&&
           <React.Suspense fallback={null}><GlobalQuickActionLauncher request={apiRequest}
             onNavigate={navigateRoute}
             onLaunchFlow={(apiName:string,inputs?:Record<string,unknown>)=>void runFlow(apiName,inputs)}
             libraryComponents={libraryComponents} appId={currentApp?.apiName??'Records'}/>
           </React.Suspense>}
          <NavigationLoadTime routeKey={routeTiming.routeKey} startedAt={routeTiming.startedAt}
            ready={metadataLoaded && (route.kind !== 'setup' || route.workspace === 'home' || advancedMetadataLoaded) && (route.kind !== 'setup' || route.workspace !== 'rbac' || accessControlLoaded || Boolean(accessControlError))}
            kind={routeTiming.kind} authMs={routeTiming.authMs} request={apiRequest} />
          <button type="button" className="icon-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={()=>setShortcutHelpOpen(true)}><CircleHelp size={17} /></button>
          
          <ConnectionHealthIndicator />
          <ProfilePasswordMenu onLogout={logout} onPasswordChanged={onLogout} />
        </div>
      </header>
      {shortcutHelpOpen && <React.Suspense fallback={null}><WorkspaceShortcutHelp onClose={()=>setShortcutHelpOpen(false)}/></React.Suspense>}
      {(route.kind === 'app-page' || route.kind === 'app-home') && (
        <MobileAppNavigation
          pages={activeAppPages} appId={currentApp?.label ?? route.appId}
          activePageApiName={route.kind === 'app-page' ? route.pageApiName : undefined}
          actions={pageToolbarActions}
          onNavigate={(pageApiName) => navigateRoute({ kind: 'app-page', appId: route.appId, pageApiName })}
          onAction={invokePageAction}
        />
      )}

      {(route.kind === 'setup' || (isRecordsRoute && readableRecordObjects.length > 1) || ((route.kind === 'app-page' || route.kind === 'app-home') && activeAppPages.length > 1))
        && !setupSidebarCollapsed && <button type="button"
        className="md-sidebar-scrim" aria-label="Close navigation"
        onClick={() => setSetupSidebarCollapsed(true)} />}
      <div className={route.kind === 'setup' ? 'setup-layout setup-no-tabs' : 'setup-layout'}>
        {isRecordsRoute && readableRecordObjects.length > 1 && runtimeFormFactor !== 'Phone' && (
          <aside id="md-records-sidebar" className={setupSidebarCollapsed ? 'md-app-sidebar md-app-sidebar-collapsed' : 'md-app-sidebar'}
            aria-label="Records navigation">
            <div className="md-app-sidebar-heading">
              <strong>Records</strong>
              <button type="button" aria-label={setupSidebarCollapsed ? 'Expand records navigation' : 'Collapse records navigation'}
                aria-expanded={!setupSidebarCollapsed} onClick={() => setSetupSidebarCollapsed((collapsed: boolean) => !collapsed)}>
                {setupSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>
            <nav aria-label="Record objects">
              {readableRecordObjects.map((recordObject: ObjectMetadata) => (
                <button type="button" key={recordObject.apiName}
                  data-short-label={recordObject.label.trim().slice(0, 2).toUpperCase()}
                  aria-current={route.objectApiName === recordObject.apiName ? 'page' : undefined}
                  title={recordObject.pluralLabel}
                  onClick={() => {
                    navigateRoute({kind:'record-list',objectApiName:recordObject.apiName,appId:'Records'});
                    if (window.matchMedia('(min-width: 600px) and (max-width: 1023px)').matches) setSetupSidebarCollapsed(true);
                  }}>{recordObject.customTab && React.createElement(
                    customTabStyles.find((style: any) => style.name === recordObject.customTab.style)?.icon ?? Database,
                    {size:16,'aria-hidden':true,style:{color:customTabStyles.find((style: any) => style.name === recordObject.customTab.style)?.color}}
                  )}<span>{recordObject.pluralLabel}</span></button>
              ))}
            </nav>
          </aside>
        )}
        {(route.kind === 'app-page' || route.kind === 'app-home') && activeAppPages.length > 1 && runtimeFormFactor !== 'Phone' && (
          <aside id="md-app-sidebar" className={setupSidebarCollapsed ? 'md-app-sidebar md-app-sidebar-collapsed' : 'md-app-sidebar'}
            aria-label="App navigation">
            <div className="md-app-sidebar-heading">
              <strong title={currentApp?.label ?? route.appId}>{currentApp?.label ?? route.appId}</strong>
              <button type="button" aria-label={setupSidebarCollapsed ? 'Expand app navigation' : 'Collapse app navigation'}
                aria-expanded={!setupSidebarCollapsed} onClick={() => setSetupSidebarCollapsed((collapsed: boolean) => !collapsed)}>
                {setupSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>
            <nav aria-label="App pages">
              {activeAppPages.map((appPage: LightningPageMetadata) => (
                <button type="button" key={appPage.apiName}
                  data-short-label={appPage.label.trim().slice(0, 2).toUpperCase()}
                  aria-current={route.kind === 'app-page' && route.pageApiName === appPage.apiName ? 'page' : undefined}
                  title={appPage.label}
                  onClick={() => {
                    navigateRoute({kind:'app-page',appId:route.appId,pageApiName:appPage.apiName});
                    if (window.matchMedia('(min-width: 600px) and (max-width: 1023px)').matches) setSetupSidebarCollapsed(true);
                  }}><span>{appPage.label}</span></button>
              ))}
            </nav>
          </aside>
        )}
        {route.kind === 'setup' && !route.dashboardView && (workspace !== 'flow-builder' || !route.resourceApiName) && !(workspace === 'page-builder' && Boolean(route.resourceApiName)) && (
          <aside id="md-setup-sidebar" className={setupSidebarCollapsed ? 'setup-sidebar setup-sidebar-collapsed' : 'setup-sidebar'}
            onClick={(event: React.MouseEvent<HTMLElement>) => {
              if (window.matchMedia('(max-width: 1023px)').matches
                && (event.target as HTMLElement).closest('.tree-item')) setSetupSidebarCollapsed(true);
            }}>
            <div className="setup-sidebar-toolbar">
              <strong>Setup</strong>
              <button type="button" className="setup-sidebar-toggle" aria-label={setupSidebarCollapsed ? 'Expand Setup menu' : 'Collapse Setup menu'} aria-expanded={!setupSidebarCollapsed} onClick={() => setSetupSidebarCollapsed((collapsed) => !collapsed)}>
                {setupSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>
            <div className="quick-find">
              <label className="quick-find-title" htmlFor="md-setup-quickfind">Quick Find</label>
              <div className="quick-find-input">
                <Search size={14} />
                <input id="md-setup-quickfind" type="search" value={quickFind} onChange={(event) => setQuickFind(event.target.value)} placeholder="Search setup and settings" aria-label="Search setup and settings" aria-controls="md-setup-navigation" />
                {quickFind && <button onClick={() => setQuickFind('')} aria-label="Clear search"><X size={13} /></button>}
              </div>
              {quickFind.trim() && <div className="quick-find-result-count" role="status">{filteredSetupGroups.reduce((count,group)=>count+group.items.length,0)} matching settings</div>}
            </div>
            <nav id="md-setup-navigation" className="setup-tree" aria-label="Setup sections">
              {filteredSetupGroups.map((group) => (
                <div className="setup-tree-group" key={group.group} role="group" aria-label={group.group}
                  data-group-short={group.group.split(/\s+/).map((word:string)=>word[0]).join('').slice(0,3).toUpperCase()} title={group.group}>
                  <div className="tree-group-label">{group.group}</div>
                  {group.items.map((item) => {
                    const isSelected = (workspace === 'object-manager' && item === 'Object Manager')
                      || (workspace === 'data-loader' && item === 'Universal Data Loader')
                      || (workspace === 'page-builder' && item === 'Page Builder')
                      || (workspace === 'app-manager' && item === 'App Manager')
                      || (workspace === 'app-exchange' && item === 'AppExchange')
                      || (workspace === 'tenant-management' && item === 'Tenant Management')
                      || (workspace === 'named-credentials' && item === (route.kind === 'setup' && route.resourceApiName === 'NamedDevices' ? 'Named Devices' : route.kind === 'setup' && route.resourceApiName === 'Webhooks' ? 'Webhook Endpoints' : 'Named Credentials'))
                      || (workspace === 'flow-interviews' && item === 'Paused and Waiting Interviews')
                      || (workspace === 'scheduled-actions' && item === 'Scheduled Actions')
                      || (workspace === 'scheduled-flows' && item === 'Scheduled Flows')
                      || (workspace === 'flow-logs' && item === 'Flow History')
                      || (workspace === 'report-builder' && item === (route.kind==='setup' && route.resourceApiName==='viewer'?'Reports View':'Reports Builder'))
                      || (workspace === 'dashboard-builder' && item === (route.kind==='setup' && (route.dashboardView || route.resourceApiName==='viewer')?'Dashboard View':'Dashboard Builder'));
                    return <button key={item}
                      className={isSelected ? 'tree-item selected' : 'tree-item'}
                      aria-current={isSelected ? 'page' : undefined}
                      aria-label={item === 'Tenant Management' && !canManagePlatformTenants ? 'Open My Tenant Management' : `Open ${item}`}
                      title={item}
                      data-short-label={item.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('')}
                      onClick={() => navigateSetupItem(item)}
                    >
                      <SettingsNavigationIcon group={group.group} label={item} />
                      <span>{item === 'Tenant Management' && !canManagePlatformTenants ? 'My Tenant Management' : item}</span>
                      <ChevronRight size={13} />
                    </button>;
                  })}
                </div>
              ))}
              {filteredSetupGroups.length === 0 && <div className="empty-tree" role="status">No matching setup items. <button type="button" className="text-action" onClick={()=>setQuickFind('')}>Clear search</button></div>}
            </nav>
            <div className="sidebar-footer"><span className="online-dot" /> Setup menu</div>
          </aside>
        )}

        <main className={`workspace ${route.kind !== 'setup' ? 'workspace-records' : ''} ${workspace === 'flow-builder' ? 'workspace-flow' : ''}`}>
          {setupAccessNotice && <div className="info-callout" role="alert">{setupAccessNotice}</div>}
          {route.kind==='setup' && !sessionPermissionsLoaded &&
            <section className="setup-card" role="status">Checking Setup permissions…</section>}
          {route.kind==='setup' && sessionPermissionsLoaded && !setupRouteAllowed &&
            <section className="setup-card" role="alert">
              Access denied. Your OneEngine permission sets do not grant access to this Setup page.
            </section>}
          {(route.kind!=='setup'||(sessionPermissionsLoaded&&setupRouteAllowed)) && <React.Fragment>
          {route.kind === 'setup' && runtimeFormFactor === 'Phone' && workspace !== 'home' && !route.dashboardView &&
            <nav className="mobile-settings-back-bar" aria-label="Settings navigation">
              <button type="button" onClick={() => openSetupWorkspace('home')}><ChevronLeft size={20} aria-hidden="true" />Setup Home</button>
            </nav>}
          {(route.kind === 'record-list' || route.kind === 'record-detail') && (metadataLoadError && !objects.length ? <section className="setup-card" role="alert"><h1>Unable to load record metadata</h1><p>{metadataLoadError}</p><button className="btn" onClick={() => window.location.reload()}>Retry</button><button className="btn" onClick={() => navigateRoute({kind:'setup',workspace:'rbac',resourceApiName:'Users'})}>Back to Users</button></section> : <RecordWorkspace route={route} objects={objects} apps={apps} pages={pages}
            availableFlows={flows.filter(item => ['Screen Flow', 'In-Screen Flow', 'Autolaunched Flow'].includes(item.flowType))
              .map(({ id, apiName, label, flowType, status }) => ({ id, apiName, label, flowType, status }))}
            onLaunchFlow={(apiName: string, inputs?: Record<string, unknown>,context?:{requestId?:string}) => void runFlow(apiName, inputs,context)}
            reports={reports} metadataLoaded={metadataLoaded} profileId={currentProfileId} canManageUserIdentities={canManageUserIdentities} userRoles={accessControl.roles}
            fieldAccess={currentFieldAccess} recordTypeAccess={currentRecordTypeAccess} libraryComponents={libraryComponents} headerSearch={recordSearch} onSearchChange={setRecordSearch}
            navigableObjects={readableRecordObjects} onNavigate={navigateRoute} />)}
          {route.kind === 'route-alias' && <section className="setup-card" role="status">
            {routeAliasError ? <p role="alert">{routeAliasError}</p> : <p>Resolving route alias…</p>}
          </section>}
          {route.kind === 'app-home' && <LightningAppRuntime appId={route.appId} objects={objects} apps={apps} pages={pages} reports={reports}
            libraryComponents={libraryComponents} availableFlows={flows.filter((item) => ['Screen Flow', 'In-Screen Flow', 'Autolaunched Flow'].includes(item.flowType))
              .map(({ id, apiName, label, flowType, status, startConfig, resources }) => ({ id, apiName, label, flowType, status, startConfig, resources }))}
            formFactor={runtimeFormFactor} profileId={currentProfileId} pageDefinitionCache={pageDefinitionCache.current} onNavigate={navigateRoute}
            onLaunchFlow={(apiName: string, inputs: Record<string, unknown>,context?:{requestId?:string}) => void runFlow(apiName, inputs,context)} onStandaloneModeChange={setStandalonePageMode} />}
          {route.kind === 'app-page' && <LightningAppRuntime appId={route.appId} pageApiName={route.pageApiName} objects={objects} apps={apps} pages={pages} reports={reports}
            libraryComponents={libraryComponents} availableFlows={flows.filter((item) => ['Screen Flow', 'In-Screen Flow', 'Autolaunched Flow'].includes(item.flowType))
              .map(({ id, apiName, label, flowType, status, startConfig, resources }) => ({ id, apiName, label, flowType, status, startConfig, resources }))}
            formFactor={runtimeFormFactor} profileId={currentProfileId} pageDefinitionCache={pageDefinitionCache.current} onNavigate={navigateRoute}
            onLaunchFlow={(apiName: string, inputs: Record<string, unknown>,context?:{requestId?:string}) => void runFlow(apiName, inputs,context)} onStandaloneModeChange={setStandalonePageMode} />}
          {route.kind === 'setup' && workspace === 'home' &&
            <SetupHome onNavigate={openSetupWorkspace} request={apiRequest} onShowShortcuts={()=>setShortcutHelpOpen(true)} onOpenAuditTrail={()=>navigateSetupItem("Audit Trail")} />
          }
          {route.kind === 'setup' && workspace === 'data-loader' &&
           <React.Suspense fallback={<section className="setup-card">Loading Universal Data Loader…</section>}>
            <UniversalDataLoaderWorkspace apiRequest={apiRequest}
             objects={objects.filter((item:ObjectMetadata)=>item.apiName!=='User')}
             onMetadataChanged={()=>{}}/>
           </React.Suspense>}
          {route.kind === 'setup' && workspace === 'object-manager' && (
            !advancedMetadataLoaded ? <section className="setup-card" role="status">Loading live object definitions…</section> :
            metadataLoadError && objects.length === 0 ? <section className="setup-card" role="alert">Unable to load object definitions: {metadataLoadError}</section> :
            objects.length === 0 || !objects.some((item: ObjectMetadata) => item.apiName === object.apiName) ?
              <section className="setup-card" aria-label="Object Manager" style={{padding:24}}>
                <h2>{objects.length === 0 ? 'No objects yet' : 'Object not found'}</h2>
                <p>{objects.length === 0
                  ? 'This installation has no Object definitions. Create your first Object in Object Manager.'
                  : 'The requested Object is not installed in this workspace.'}</p>
                <div className="toolbar-actions">
                  {objects.length > 0 && <button className="btn" type="button" onClick={() => navigateRoute({
                    kind:'setup',workspace:'object-manager',objectApiName:objects[0].apiName,setting:'Fields & Relationships'
                  })}>Open available Object</button>}
                  {canManageApps && <button type="button" className="btn btn-brand" onClick={() => setShowNewObject(true)}>Create Object</button>}
                </div>
              </section> :
              (
            <PlatformWorkspaceSurface workspace="object-manager" componentRuntime={protectedPageRuntime} permitted={canReadMetadata} resolving={!sessionPermissionsLoaded} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}} >
            {route.resourceApiName && objectSetting === 'Lightning Record Pages' ? (() => {
              const recordPage=pages.find((candidate:LightningPageMetadata) => candidate.apiName===route.resourceApiName
                && candidate.pageType==='Record Page' && candidate.targetObject===object.apiName);
              if(!recordPage)return <section className="setup-card" role="alert"><h2>Record Page not found</h2>
                <p>The selected Record Page does not belong to this Object or is unavailable.</p>
                <button className="btn" onClick={()=>navigateRoute({kind:'setup',workspace:'object-manager',
                  objectApiName:object.apiName,setting:'Lightning Record Pages'})}>Back to Record Pages</button></section>;
              const requestedVariant=(['Mobile','Desktop','Tablet','Custom'] as const)
                .find(variant=>variant===route.resourceId)??'Desktop';
              return <PageBuilder key={recordPage.apiName}
                recordPageContext={object.apiName} initialLayoutVariant={requestedVariant}
                onLayoutVariantChange={variant=>navigateRoute({kind:'setup',workspace:'object-manager',
                  objectApiName:object.apiName,setting:'Lightning Record Pages',
                  resourceApiName:recordPage.apiName,resourceId:variant})} editorMode
                page={page.apiName===recordPage.apiName?page:recordPage} pages={pages} objects={objects} apps={apps}
                profiles={accessControl.profiles} reports={reports} dashboards={dashboards}
                libraryComponents={libraryComponents} flows={flows} request={apiRequest}
                preparedAppId="" canManageRoutes={canManageApps}
                onChange={changePage}
                onSelectPage={(apiName:string)=>{
                  const selected=pages.find((candidate:LightningPageMetadata)=>candidate.apiName===apiName
                    && candidate.pageType==='Record Page' && candidate.targetObject===object.apiName);
                  if(!selected)return;
                  setPage(selected);
                  navigateRoute({kind:'setup',workspace:'object-manager',objectApiName:object.apiName,
                    setting:'Lightning Record Pages',resourceApiName:selected.apiName});
                }}
                onTargetObjectChange={() => notify('Record Page object is fixed. Return to Object Manager to choose another Object.')}
                onSave={savePageFromBuilder} onUpdatePageDetails={updatePageDetailsFromBuilder} onPublish={publishPageFromBuilder} onDeactivate={deactivatePageFromBuilder}
                onSaveApp={saveApp} onDeleteApp={deleteApp} onDeletePage={deletePage}
                onPrepareApp={()=>{}} onAppLinked={()=>{}}
                onLaunchFlow={(apiName:string,inputs:Record<string,unknown>,context?:{requestId?:string})=>void runFlow(apiName,inputs,context)}
                onBackToPages={()=>navigateRoute({kind:'setup',workspace:'object-manager',
                  objectApiName:object.apiName,setting:'Lightning Record Pages'})}
                onExit={()=>navigateRoute({kind:'setup',workspace:'object-manager',
                  objectApiName:object.apiName,setting:'Lightning Record Pages'})}
                onNotify={notify}/>;
            })() : <ObjectManager
              object={object}
              objects={objects}
              flows={flows}
              pages={pages}
              reports={reports}
              dashboards={dashboards}
              profiles={accessControlError ? [] : accessControl.profiles}
              activationAppIds={activationAppIds}
              selectedSetting={route.kind === 'setup' && route.workspace === 'object-manager'
                ? (route.objectApiName ? route.setting ?? 'Details' : 'Objects') : objectSetting}
              search={objectSearch}
              onSearch={setObjectSearch}
              onObjectSelect={(nextObject: ObjectMetadata) => {
                setObject(nextObject);
                navigateRoute({ kind: 'setup', workspace: 'object-manager', objectApiName: nextObject.apiName, setting: 'Details' });
              }}
              selectedFieldApiName={route.kind === 'setup' ? route.resourceApiName : undefined}
              onSettingSelect={(setting: string) => navigateRoute(setting === 'Objects'
                ? { kind: 'setup', workspace: 'object-manager' }
                : { kind: 'setup', workspace: 'object-manager', objectApiName: object.apiName, setting })}
              onOpenDependency={(target: { setting?: string; objectApiName?: string; workspace?: 'flow-builder' | 'page-builder' | 'report-builder' | 'dashboard-builder'; resourceApiName?: string }) => {
                if (target.workspace === 'page-builder' && target.resourceApiName) {
                  const selectedPage = pages.find((candidate) => candidate.apiName === target.resourceApiName);
                  if (selectedPage?.pageType === 'Record Page') {
                    setPage(selectedPage);
                    navigateRoute({kind:'setup',workspace:'object-manager',objectApiName:selectedPage.targetObject,
                      setting:'Lightning Record Pages',resourceApiName:selectedPage.apiName});
                    return;
                  }
                  if (selectedPage) setPage(selectedPage);
                }
                navigateRoute(target.workspace
                  ? { kind: 'setup', workspace: target.workspace, resourceApiName: target.resourceApiName }
                  : { kind: 'setup', workspace: 'object-manager', objectApiName: target.objectApiName ?? object.apiName, setting: target.setting ?? 'Fields & Relationships', ...(target.resourceApiName ? {resourceApiName:target.resourceApiName} : {}) });
              }}
              onNewField={(targetObject?: ObjectMetadata, relatedObjectApi?: string, relationshipType?: 'Lookup Relationship' | 'Master-Detail Relationship') => {
                const fieldObject = targetObject ?? object;
                resetNewFieldDraft();
                if (targetObject && targetObject.apiName !== object.apiName) setObject(targetObject);
                setNewFieldLayoutIds(fieldObject.pageLayouts?.map((layout) => layout.id) ?? []);
                if (relatedObjectApi) {
                  setNewFieldType(relationshipType ?? 'Lookup Relationship');
                  setNewFieldRelationshipTarget(relatedObjectApi);
                }
                setShowNewField(true);
              }}
              onCreateObject={() => setShowNewObject(true)}
              onSaveObject={saveObject}
              onRefreshObject={refreshObject}
              onDeleteObject={deleteObject}
               onRestoreObject={restoreObject}
              onSaveField={saveField}
              onDeleteField={deleteField}
              onSavePage={async (draft:LightningPageMetadata)=>{
                // Record Pages are born as immutable SQL layout drafts, not just
                // legacy live metadata. Reuse the same Save Draft API as the editor.
                if(draft.pageType==='Record Page'&&!pages.some((candidate:LightningPageMetadata)=>
                  candidate.apiName===draft.apiName)){
                  const created=await savePageFromBuilder(draft,draft.apiName);
                  if(!created)throw new Error('Unable to save Record Page draft');
                }else await savePage(draft);
              }}
              onDeleteRecordPage={deletePage}
              onOpenRecordPage={(pageApiName:string,variant:'Mobile'|'Desktop'|'Tablet'|'Custom')=>{
                const target=pages.find((candidate:LightningPageMetadata)=>
                  candidate.apiName===pageApiName && candidate.pageType==='Record Page'
                  && candidate.targetObject===object.apiName);
                if(!target){notify('Record Page not found for this Object');return;}
                setPage(target);
                navigateRoute({kind:'setup',workspace:'object-manager',objectApiName:object.apiName,
                  setting:'Lightning Record Pages',resourceApiName:target.apiName,resourceId:variant});
              }}
              onOpenPageBuilder={() => {
                const selected=pages.find((candidate:LightningPageMetadata)=>candidate.targetObject===object.apiName
                  && candidate.pageType==='Record Page' && (candidate.recordMode??'View')==='View')
                  ?? pages.find((candidate:LightningPageMetadata)=>candidate.targetObject===object.apiName && candidate.pageType==='Record Page');
                if(!selected){notify('Default Record Pages are missing. Apply the Object Record Pages SQL migration.');return;}
                setPage(selected);
                navigateRoute({kind:'setup',workspace:'object-manager',objectApiName:object.apiName,
                  setting:'Lightning Record Pages',resourceApiName:selected.apiName});
              }}
              onOpenRecords={() => navigateRoute({ kind: 'record-list', objectApiName: object.apiName })}
              page={pages.find((item) => item.targetObject === object.apiName && item.pageType === 'Record Page') ?? null}
              onNotify={notify}
            />}
            </PlatformWorkspaceSurface>
              )
          )}
          {route.kind === 'setup' && workspace === 'page-builder' && !advancedMetadataLoaded && <SetupLoadingState label="Page Builder definitions" />}
          {route.kind === 'setup' && workspace === 'page-builder' && advancedMetadataLoaded && route.resourceApiName && !pages.some((item) => item.apiName === route.resourceApiName) && (
            <section className="setup-card" role="alert" style={{ padding: 24 }}>
              <h2>{metadataLoadError ? "Unable to load Lightning pages" : "Lightning page not found"}</h2>
              <p>{metadataLoadError ? `Metadata API error: ${metadataLoadError}` : `The page "${route.resourceApiName}" was not returned by the metadata API. No other page has been substituted.`}</p>
              <p>Check that the page exists in this tenant and that your account can access it.</p>
              <button className="btn" onClick={() => navigateRoute({ kind: 'setup', workspace: 'page-builder' })}>Open saved pages</button>
            </section>
          )}
          {route.kind === 'setup' && workspace === 'page-builder' && route.resourceApiName &&
            pages.some((item:LightningPageMetadata)=>item.apiName===route.resourceApiName && item.pageType==='Record Page') && (() => {
              const selected=pages.find((item:LightningPageMetadata)=>item.apiName===route.resourceApiName)!;
              return <section className="setup-card" role="status"><h2>Record Pages belong to Object Manager</h2>
                <p>Record View and Edit Pages are configured from their own Object.</p>
                <button className="btn btn-brand" onClick={()=>{
                  setPage(selected);navigateRoute({kind:'setup',workspace:'object-manager',
                    objectApiName:selected.targetObject,setting:'Lightning Record Pages',
                    resourceApiName:selected.apiName});
                }}>Open Record Page in Object Manager</button></section>;
            })()}
          {route.kind === 'setup' && workspace === 'page-builder' && advancedMetadataLoaded &&
            (!route.resourceApiName || pages.some((item) => item.apiName === route.resourceApiName && item.pageType !== 'Record Page')) && <PageBuilder key={route.resourceApiName ?? 'page-list'} editorMode={Boolean(route.resourceApiName)}
              // The layout being designed is part of the route (/page-builder/<page>/<layout>), so opening a
              // Custom layout survives the route's page selection and a browser refresh.
              initialLayoutVariant={(['Desktop','Tablet','Mobile','Custom'] as const).find(variant=>variant===route.resourceId)}
              onLayoutVariantChange={(variant:'Desktop'|'Tablet'|'Mobile'|'Custom',apiName?:string)=>{ const target=apiName??route.resourceApiName; if(target) navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:target,resourceId:variant}); }} onBackToPages={() => { setPage(pages.find(item => item.apiName === page.apiName) ?? page); navigateRoute({ kind: 'setup', workspace: 'page-builder' }); }} page={page} pages={pages}
            preparedAppId={pageCreationAppContext[page.apiName] ?? ''}
            dashboards={dashboards}
            onPrepareApp={(pageApiName: string, appId: string) => setPageCreationAppContext(current => ({
              ...current, [pageApiName]: appId
            }))}
            onAppLinked={(pageApiName: string) => setPageCreationAppContext(current => {
              const next = { ...current };
              delete next[pageApiName];
              return next;
            })} objects={objects} apps={apps} profiles={accessControl.profiles} reports={reports} libraryComponents={libraryComponents} flows={flows} onChange={changePage} onSelectPage={(apiName: string) => { const selected = pages.find((item) => item.apiName === apiName); if (selected) { setPage(selected); navigateRoute({ kind: 'setup', workspace: 'page-builder', resourceApiName: selected.apiName }); } }} onTargetObjectChange={openPageForObject} onLaunchFlow={(apiName: string, inputs: Record<string, unknown>,context?:{requestId?:string}) => void runFlow(apiName, inputs,context)} onSave={savePageFromBuilder} onUpdatePageDetails={updatePageDetailsFromBuilder} onPublish={publishPageFromBuilder} onDeactivate={deactivatePageFromBuilder} onSaveApp={saveApp} onDeleteApp={deleteApp} onDeletePage={deletePage} request={apiRequest} canManageRoutes={canManageApps} onExit={() => { setPage(pages.find((item) => item.apiName === route.resourceApiName) ?? pages[0] ?? defaultLightningPage); pageRouteApiName.current = ''; navigateRoute({ kind: 'setup', workspace: 'home' }); }} onNotify={notify} />}
          {route.kind === 'setup' && workspace === 'app-manager' && !advancedMetadataLoaded && <section className="setup-card" role="status">Loading live applications…</section>}
          {route.kind === 'setup' && workspace === 'app-manager' && advancedMetadataLoaded && <PlatformWorkspaceSurface workspace="app-manager" componentRuntime={protectedPageRuntime} permitted={canReadMetadata} resolving={!sessionPermissionsLoaded} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}}><AppManager apps={apps} objects={objects} pages={pages} flows={flows} libraryComponents={libraryComponents} reports={reports} dashboards={dashboards}
            onSave={saveApp} onDelete={deleteApp} request={apiRequest}
            onOpenWorkspace={(destination) => navigateRoute({kind:'setup', workspace:destination})} /></PlatformWorkspaceSurface>}
          {route.kind === 'setup' && workspace === 'dashboard-builder' && (
            dashboardsError ? <section className="setup-card" role="alert">Unable to load dashboards: {dashboardsError}</section> :
            !dashboardsLoaded || !advancedMetadataLoaded ? <SetupLoadingState label="Dashboards" /> :
            <DashboardBuilder
            dashboards={dashboards}
            dashboardFolders={dashboardFolders}
            objects={objects}
            libraryComponents={libraryComponents}
            reports={reports}
            smtpCredentials={namedCredentials.filter((credential) => credential.protocol === 'SMTP')}
            canSchedule={canScheduleDashboards}
            shareUsers={accessControlError ? [] : accessControl.users.filter((user) => user.id !== dashboardUserId)}
            shareGroups={accessControlError ? [] : accessControl.permissionSetGroups}
            folderPublicGroups={accessControlError ? [] : accessControl.publicGroups}
            folderRoles={accessControlError ? [] : accessControl.roles}
            folderPermissionSetGroups={accessControlError ? [] : accessControl.permissionSetGroups}
            dashboardTerritories={dashboardTerritories}
            canManageTerritories={canManageDashboardTerritories}
            subscriptionUsers={accessControlError ? [] : accessControl.users}
            runningUserIds={dashboardRunningUserIds}
            userId={dashboardUserId}
            canCreate={canCreateDashboards}
            canManageAll={canManageDashboards}
            viewerMode={route.kind === 'setup' && (route.dashboardView === true || route.resourceApiName==='viewer')}
            selectedApiName={route.kind === 'setup' ? (route.resourceApiName==='viewer'?dashboards[0]?.apiName:route.resourceApiName) : undefined}
            onSelect={(apiName:string)=>setupPermissions.includes('setup:DashboardBuilder:view')
              ?selectDashboard(apiName)
              :navigateRoute({kind:'setup',workspace:'dashboard-builder',resourceApiName:apiName,dashboardView:true})}
            onOpenViewer={openDashboardViewer}
            onExitViewer={(apiName:string)=>setupPermissions.includes('setup:DashboardBuilder:view')
              ?exitDashboardViewer(apiName)
              :navigateRoute({kind:'setup',workspace:'dashboard-builder',resourceApiName:'viewer'})}
            onLoadRecords={loadDashboardRecords}
            onRunReport={runReport}
            onLoadSnapshots={loadDashboardSnapshots}
            onCreateSnapshot={createDashboardSnapshot}
            onDeleteSnapshot={deleteDashboardSnapshot}
            onLoadSubscriptions={loadDashboardSubscriptions}
            onSaveSubscription={saveDashboardSubscription}
            onDeleteSubscription={deleteDashboardSubscription}
            onRunSubscription={runDashboardSubscription}
            onSave={saveDashboard}
            onDelete={deleteDashboard}
            onSaveFolder={saveDashboardFolder}
            onDeleteFolder={deleteDashboardFolder}
            onSaveTerritories={saveDashboardTerritories}
            onNotify={notify}
          />)}
          {route.kind === 'setup' && workspace === 'named-credentials' && (
            route.resourceApiName==='NamedDevices'
              ? <section className="setup-card md-access-locked" role="alert" aria-label="Named Devices access required">
                  <h1>Named Devices</h1>
                  <p>This workspace requires Read access to the Named Device object through your Profile or Permission Set.</p>
                  <p>Contact your administrator to request access, then open Named Devices again.</p>
                  <button type="button" className="btn" onClick={()=>navigateRoute({kind:'setup',workspace:'home'})}>Back to Setup</button>
                </section> :
            !namedCredentialsLoaded ? <section className="setup-card" role="status">Loading live named credentials…</section> :
            namedCredentialsError && namedCredentials.length===0
              ? <section className="setup-card" role="alert">Named Credentials could not be verified: {namedCredentialsError}</section> :
            <PlatformWorkspaceSurface workspace="named-credentials" componentRuntime={protectedPageRuntime} permitted={canReadMetadata} resolving={!sessionPermissionsLoaded} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}}><PlatformPageSlot slotKey="credentials"><NamedCredentials
            credentials={namedCredentials}
            webhookOnly={route.resourceApiName === 'Webhooks'}
            canManage={canManageNamedCredentials}
            encryptionReady={namedCredentialsEncryptionReady}
            onSave={saveNamedCredential}
            onDelete={deleteNamedCredential}
            onRotate={rotateNamedCredential}
            onTest={testNamedCredential}
            canTest={canManageNamedCredentials}
            onOAuthAuthorize={authorizeNamedCredential}
            onToggleEnabled={toggleNamedCredentialEnabled}
          />{namedCredentialsError && <p role="alert" className="setup-card">{namedCredentialsError}</p>}{namedCredentialsReadinessError && <p role="alert" className="setup-card">{namedCredentialsReadinessError}</p>}</PlatformPageSlot></PlatformWorkspaceSurface>)}
          {route.kind === 'setup' && workspace === 'app-exchange' && (
            connectorRightsError ? <section className="setup-card" role="alert">Unable to verify AppExchange access: {connectorRightsError}</section> :
            !namedCredentialsLoaded || !connectorRightsLoaded || !advancedMetadataLoaded ? <section className="setup-card" role="status">Loading live AppExchange configuration…</section> :
            <PlatformWorkspaceSurface workspace="app-exchange" componentRuntime={protectedPageRuntime} permitted={connectorRights.view} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}}><AppExchange
            credentials={namedCredentials}
            flows={flows.map(({apiName,label,status,elements}) => ({
              apiName, label, status,
              elements: elements.map((element) => ({type:element.type,config:element.config as Record<string,unknown>}))
            }))}
            canManageFlows={canManageFlows}
            canManageCredentials={connectorRights.edit}
            canView={connectorRights.view}
            canManageSecrets={connectorRights.secrets}
            canInstall={connectorRights.install}
            encryptionReady={namedCredentialsEncryptionReady}
            loadApps={loadConnectorMarketplaceApps}
            canManageLicences={Boolean(connectorRights.licence)}
            grantLicence={async(appKey:string)=>{
              await apiRequest('/connector-apps/'+encodeURIComponent(appKey)+'/licence',{method:'POST',body:'{}'});
            }}
            installApp={async(appKey:string)=>{
              await apiRequest('/apps/'+encodeURIComponent(appKey)+'/install',{method:'POST',body:'{}'});
              const [installed,published]=await Promise.all([
                apiRequest<{apps:LightningAppMetadata[]}>('/metadata/apps'),
                apiRequest<{pages:LightningPageMetadata[]}>('/metadata/pages')]);
              setApps(installed.apps);setPages(published.pages);
            }}
            uninstallApp={async(appKey:string)=>{
              await apiRequest('/metadata/apps/'+encodeURIComponent(appKey),{method:'DELETE'});
              const [installed,published]=await Promise.all([
                apiRequest<{apps:LightningAppMetadata[]}>('/metadata/apps'),
                apiRequest<{pages:LightningPageMetadata[]}>('/metadata/pages')]);
              setApps(installed.apps);setPages(published.pages);
            }}
            executeLifecycleFlow={async(flowName:string,appKey:string)=>{
              await executeConnectorAppLifecycleFlow(flowName,appKey);
              // Load authoritative tenant-scoped app and page metadata after lifecycle changes.
              const [appResult,pageResult]=await Promise.all([
                apiRequest<{apps:LightningAppMetadata[]}>('/metadata/apps'),
                apiRequest<{pages:LightningPageMetadata[]}>('/metadata/pages')
              ]);
              setApps(appResult.apps);
              setPages(pageResult.pages);
            }}
            onSave={saveNamedCredential}
            onDelete={deleteNamedCredential}
            loadHistory={loadAppCommunicationHistory}
            onOpenFlow={selectFlow}
            onOpenRecord={(objectName,id) => navigateRoute({kind:'record-detail', objectApiName:objectName, recordId:id})}
          /></PlatformWorkspaceSurface>)}
          {route.kind === 'setup' && workspace === 'report-builder' && (
            reportsError ? <section className="setup-card" role="alert">Unable to load reports: {reportsError}</section> :
            !reportsLoaded || !advancedMetadataLoaded ? <section className="setup-card" role="status">Loading live reports…</section> :
            route.resourceApiName==='viewer'
              ? <React.Suspense fallback={<section className="setup-card" role="status">Loading reports view…</section>}><ReportReadOnlyView reports={reports} folders={reportFolders} onRun={runReport}/></React.Suspense>
              : <ReportBuilder reports={reports} reportFolders={reportFolders} canManageReportFolders={canManageReportFolders} accessControl={accessControl} objects={objects} onSave={saveReport} onSaveFolder={saveReportFolder} onDelete={deleteReport} onRun={runReport} onPreview={previewReport} onNotify={notify} />)}
          {route.kind === 'setup' && workspace === 'scheduled-flows' && (
            flowDefinitionsError ? <section className="setup-card" role="alert">Unable to load saved flows: {flowDefinitionsError}</section> :
            <ScheduledFlows flows={flows} objects={objects} loading={!flowDefinitionsLoaded || !advancedMetadataLoaded} onEdit={selectFlow}
               initialView={route.resourceApiName==='triggers'?'triggers':'scheduled'}
               onViewChange={view=>navigateRoute({kind:'setup',workspace:'scheduled-flows',...(view==='triggers'?{resourceApiName:'triggers'}:{})})}/>
          )}
          {route.kind === 'setup' && workspace === 'scheduled-actions' &&
            <ScheduledActionRecords request={apiRequest}/>}
          {route.kind === 'setup' && workspace === 'flow-interviews' && (
            <FlowInterviews
              request={apiRequest}
              interviews={flowInterviews}
              loading={flowInterviewsLoading}
              canManage={canManageFlows}
              onRefresh={() => void refreshFlowInterviews()}
              onCancel={(interview) => void cancelFlowInterview(interview)}
              onOpenFlow={selectFlow}
            />
          )}
          {route.kind === 'setup' && workspace === 'flow-logs' && (
            <FlowLogs logs={flowLogs} loading={flowLogsLoading} onOpenFlow={selectFlow}
              hasMore={Boolean(ctx.flowLogCursor)} loadingMore={Boolean(ctx.flowLogsLoadingMore)}
              onLoadMore={ctx.loadMoreFlowHistory} />
          )}
          {route.kind === 'setup' && workspace === 'automation-settings' && <PlatformWorkspaceSurface workspace="automation-settings" componentRuntime={protectedPageRuntime} permitted={canReadMetadata} resolving={!sessionPermissionsLoaded} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}}><PlatformPageSlot slotKey="automation-policy"><AutomationSettingsWorkspace canManage={canManageFlows} /></PlatformPageSlot></PlatformWorkspaceSurface>}
          {route.kind === 'setup' && workspace === 'flow-builder' && !route.resourceApiName &&
            <nav className="flow-builder-related-actions" aria-label="Flow management tools">
              <button type="button" className="btn" onClick={()=>navigateRoute({kind:'setup',workspace:'scheduled-flows',resourceApiName:'triggers'})}>Flow Trigger Explorer</button>
              <button type="button" className="btn" onClick={()=>navigateRoute({kind:'setup',workspace:'flow-logs'})}>Execution History</button>
            </nav>}
          {route.kind === 'setup' && workspace === 'flow-builder' && (
            flowDefinitionsError ? <section className="setup-card" role="alert">Unable to load flows: {flowDefinitionsError}</section> :
            !flowDefinitionsLoaded || !advancedMetadataLoaded ? <SetupLoadingState label="Flows" /> :
            <FlowBuilderWorkspace
              landing={!route.resourceApiName}
              flow={flow}
              flows={flows}
              pages={pages} apps={apps}
              onListFlows={fetchFlowListPage}
              onLoadCapabilities={() => apiRequest('/metadata/flow-capabilities')}
              onLoadExternalServices={() => apiRequest('/metadata/external-services')}
              onImportExternalService={(apiName, label, spec) => apiRequest('/metadata/external-services/import', {
                method: 'POST', body: JSON.stringify({ apiName, label, spec })
              })}
              libraryComponents={libraryComponents}
              platformEvents={platformEvents}
              objects={objects}
              users={accessControl.users}
              approvalProcesses={approvalProcesses}
              namedCredentials={namedCredentials}
              emailAlerts={emailAlerts}
              connectorProviders={connectorProviders}
              integrationConnections={integrationConnections}
              validation={flowValidation}
              isDirty={flowHasUnsavedChanges()}
              canRunFlows={canRunFlows}
              selectedId={selectedFlowId}
              toolTab={flowToolTab}
              canUndo={flowHistory.current.undo.length > 0}
              canRedo={flowHistory.current.redo.length > 0}
              onExit={() => openSetupWorkspace('home')}
              onOpenFlowList={() => navigateRoute({kind:'setup',workspace:'flow-builder'})}
              onFlowChange={commitFlow}
              onSelectFlow={selectFlow}
              onRestoreFlowVersion={restoreFlowVersion}
              onExportFlow={exportFlow}
              onImportFlow={(file) => void importFlow(file)}
              onCloneFlow={(candidate) => void cloneFlow(candidate)}
              onDeactivateFlow={(apiName) => void deactivateFlow(apiName)}
              onDeleteFlow={(apiName) => void deleteFlow(apiName)}
              onCreateFlow={createFlow}
              onUndo={undoFlow}
              onRedo={redoFlow}
              onSelect={setSelectedFlowId}
              onToolTab={setFlowToolTab}
              onAdd={addFlowElement}
              onUpdateLabel={updateFlowLabel}
              onUpdateConfig={updateFlowConfig}
              onRemove={removeFlowElement}
              onValidate={() => void validateFlow(flow)}
              onSave={() => void saveFlow({ ...flow, status: 'Draft' })}
              onActivate={() => void saveFlow({ ...flow, status: 'Active' })}
              onRun={() => void runFlow()}
              onDebug={openFlowDebug}
              onRunTests={runSavedFlowTests}
              onSaveNamedCredential={saveNamedCredential}
              onDeleteNamedCredential={deleteNamedCredential}
              onSaveEmailAlert={saveEmailAlert}
              onDeleteEmailAlert={deleteEmailAlert}
              onSavePlatformEvent={savePlatformEvent}
              onDeletePlatformEvent={deletePlatformEvent}
              onNotify={notify}
            />
          )}
          {route.kind === 'setup' && workspace === 'company-settings' && <PlatformWorkspaceSurface workspace="company-settings" componentRuntime={protectedPageRuntime} permitted={canReadMetadata} resolving={!sessionPermissionsLoaded} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}} ><CompanySettingsWorkspace objects={readableRecordObjects} mobile={runtimeFormFactor === 'Phone'} initialSection={route.resourceApiName}
securitySubsection={route.resourceId}
onSelectSection={(section)=>navigateRoute({kind:'setup',workspace:'company-settings',...(section?{resourceApiName:section}:{})})}
onSelectSecurityArea={area=>navigateRoute({kind:'setup',workspace:'company-settings',resourceApiName:'security',resourceId:area})}
onNavigateDeveloper={(target: string) => navigateRoute({kind:'setup',workspace:target})} developerAccess={{metadata:canReadMetadata,apps:canManageApps,flows:canManageFlows,dashboards:canManageDashboards,reports:canReadMetadata,approvals:canManageApprovalProcesses,security:canReadSecurity}} company={<CompanySettings canManage={canManageUserIdentities} />} domains={<PlatformPageSlot slotKey="domains"><TenantDomains request={apiRequest} permitted={canManageUserIdentities} /></PlatformPageSlot>} developer={<PlatformPageSlot slotKey="developer-accounts"><DeveloperAccountSettings request={apiRequest} permitted={canManageUserIdentities} /></PlatformPageSlot>} usage={<PlatformPageSlot slotKey="usage"><TenantUsagePanel request={apiRequest} permitted={canManageUserIdentities} /></PlatformPageSlot>} recovery={<PlatformPageSlot slotKey="recovery"><TenantRecoveryPanel request={apiRequest} operator={false} permitted={canManageUserIdentities} /></PlatformPageSlot>} mfa={<PlatformPageSlot slotKey="mfa"><TenantMfaSettings onReauthenticate={onLogout} canManage={canManageUserIdentities} governanceTab={route.resourceId === 'connected-apps' ? 'connected apps' : 'audit'} governanceFocus={route.resourceId === 'connected-apps' || route.resourceId === 'audit-trail'} /></PlatformPageSlot>} emailRecovery={<PlatformPageSlot slotKey="email-recovery"><TenantEmailRecoverySettings canManage={canManageUserIdentities} /></PlatformPageSlot>} locks={<PlatformPageSlot slotKey="locks"><TenantUserLockSettings /></PlatformPageSlot>} sessions={<PlatformPageSlot slotKey="sessions"><AccountSessionSecurity onReauthenticate={onLogout} /></PlatformPageSlot>} audit={<PlatformPageSlot slotKey="audit"><TenantSecurityAudit /></PlatformPageSlot>} /></PlatformWorkspaceSurface>}
          {route.kind === 'setup' && workspace === 'tenant-management' && !sessionPermissionsLoaded && <section className="setup-card" role="status">Checking access…</section>}
          {route.kind === 'setup' && workspace === 'tenant-management' && sessionPermissionsLoaded && !canManagePlatformTenants && <PlatformWorkspaceSurface
            workspace="company-settings" componentRuntime={protectedPageRuntime}
            permitted={canReadMetadata} resolving={!sessionPermissionsLoaded} pages={pages} libraryComponents={libraryComponents}
            device={runtimeFormFactor} canEditSystemPage={false}>
            <section aria-label="My tenant management" className="company-workspace">
              <header className="company-workspace-heading">
                <div><p className="company-workspace-eyebrow">OneEngine / Tenant administration</p>
                  <h1>My Tenant Management</h1>
                  <p>Manage your own organisation through OneEngine permissions. Platform-wide tenant creation and management remain restricted to the Platform Developer policy.</p>
                </div>
              </header>
              <CompanySettingsWorkspace objects={readableRecordObjects} mobile={runtimeFormFactor === 'Phone'} onNavigateDeveloper={(target: string) => navigateRoute({kind:'setup',workspace:target})} developerAccess={{metadata:canReadMetadata,apps:canManageApps,flows:canManageFlows,dashboards:canManageDashboards,reports:canReadMetadata,approvals:canManageApprovalProcesses,security:canReadSecurity}}
                company={<CompanySettings canManage={canManageUserIdentities} />}
                domains={<PlatformPageSlot slotKey="domains"><TenantDomains request={apiRequest} permitted={canManageUserIdentities} /></PlatformPageSlot>}
                developer={<PlatformPageSlot slotKey="developer-accounts"><DeveloperAccountSettings request={apiRequest} permitted={canManageUserIdentities} /></PlatformPageSlot>}
                usage={<PlatformPageSlot slotKey="usage"><TenantUsagePanel request={apiRequest} permitted={canManageUserIdentities} /></PlatformPageSlot>}
                recovery={<PlatformPageSlot slotKey="recovery"><TenantRecoveryPanel request={apiRequest} operator={false} permitted={canManageUserIdentities} /></PlatformPageSlot>}
                mfa={<PlatformPageSlot slotKey="mfa"><TenantMfaSettings onReauthenticate={onLogout} canManage={canManageUserIdentities} /></PlatformPageSlot>}
                emailRecovery={<PlatformPageSlot slotKey="email-recovery"><TenantEmailRecoverySettings canManage={canManageUserIdentities} /></PlatformPageSlot>}
                locks={<PlatformPageSlot slotKey="locks"><TenantUserLockSettings /></PlatformPageSlot>}
                sessions={<PlatformPageSlot slotKey="sessions"><AccountSessionSecurity onReauthenticate={onLogout} /></PlatformPageSlot>}
                audit={<PlatformPageSlot slotKey="audit"><TenantSecurityAudit /></PlatformPageSlot>}
              />
            </section>
          </PlatformWorkspaceSurface>}
          {route.kind === 'setup' && workspace === 'tenant-management' && canManagePlatformTenants && <PlatformWorkspaceSurface workspace="tenant-management" componentRuntime={protectedPageRuntime} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}} permitted={canManagePlatformTenants}><TenantManagement request={apiRequest} permitted={canManagePlatformTenants} /></PlatformWorkspaceSurface>}
          {route.kind === 'setup' && workspace === 'rbac' && (
            accessControlError ? <section className="setup-card" role="alert">Unable to load tenant users and permissions: {accessControlError}. Refresh to retry.</section> :
            !accessControlLoaded ? <section className="setup-card" role="status">Loading live tenant users and permissions…</section> :
            <PlatformWorkspaceSurface workspace="rbac" componentRuntime={protectedPageRuntime} permitted={canReadSecurity} resolving={!sessionPermissionsLoaded} pages={pages} libraryComponents={libraryComponents} device={runtimeFormFactor} canEditSystemPage={canManagePlatformTenants} onEditSystemPage={(apiName: string)=>{const selected=pages.find(p=>p.apiName===apiName);if(selected)setPage(selected);navigateRoute({kind:'setup',workspace:'page-builder',resourceApiName:apiName});}}><Permissions
            accessControl={accessControl}
            accessControlError={accessControlError}
            objects={objects}
            routeResourceApiName={route.resourceApiName}
            routeResourceId={route.resourceId}
            onRouteResourceChange={(resourceApiName: string, resourceId: string) => navigateRoute({
              kind: 'setup', workspace: 'rbac', resourceApiName, ...(resourceId ? { resourceId } : {})
            })}
            onSave={saveAccessControl}
            onNotify={notify}
            onOpenUserRecords={() => navigateRoute({kind:'record-list',objectApiName:'User'})}
          /></PlatformWorkspaceSurface>)}
          </React.Fragment>}
        </main>
      </div>
      <WorkspaceFormulaScreen key={JSON.stringify(route)} render={({appId,screen})=><LightningAppRuntime
        appId={appId} pageApiName={screen.page} instanceKey={screen.instance} inScreenPage={screen.inScreen}
        printPreview={screen.print?screen:undefined} inScreenContext={{sessionId:screen.sessionId,values:{recordId:screen.recordId}}}
        objects={objects} apps={apps} pages={pages} reports={reports} libraryComponents={libraryComponents}
        availableFlows={flows} formFactor={runtimeFormFactor} profileId={currentProfileId} pageDefinitionCache={pageDefinitionCache.current}
        onNavigate={navigateRoute} onLaunchFlow={runFlow} onStandaloneModeChange={()=>{}}/>}/>
      {showNewField && <React.Suspense fallback={null}><FieldWizardModal context={{ X, addField, formulaEditorRef, insertFormulaText, newFieldAllowReparenting, newFieldApiName, newFieldCaseSensitive, newFieldChildRelationshipName, newFieldConfigurationError, newFieldController, newFieldControllerApiName, newFieldControllerValues, newFieldDefaultValue, newFieldDeleteBehavior, newFieldDescription, newFieldExternalId, newFieldFormula, newFieldFormulaValidation, newFieldHasDefault, newFieldHelpText, newFieldLabel, newFieldLayoutIds, newFieldLookupFilterLogic, newFieldLookupFilters, newFieldPicklistOptions, newFieldPicklistRestricted, newFieldPicklistValues, newFieldPrecision, newFieldRelationshipName, newFieldRelationshipTarget, newFieldRequired, newFieldReturnType, newFieldScale, newFieldStage, newFieldTextLength, newFieldType, newFieldUnique, newFieldValueSettings, object, objects, relatedLookupFilterOperators, resetNewFieldDraft, setNewFieldAllowReparenting, setNewFieldCaseSensitive, setNewFieldChildRelationshipName, setNewFieldControllerApiName, setNewFieldDefaultValue, setNewFieldDeleteBehavior, setNewFieldDescription, setNewFieldExternalId, setNewFieldFormula, setNewFieldFormulaValidation, setNewFieldHasDefault, setNewFieldHelpText, setNewFieldLabel, setNewFieldLayoutIds, setNewFieldLookupFilterLogic, setNewFieldLookupFilters, setNewFieldPicklistRestricted, setNewFieldPicklistValues, setNewFieldPrecision, setNewFieldRelationshipName, setNewFieldRelationshipTarget, setNewFieldRequired, setNewFieldReturnType, setNewFieldScale, setNewFieldStage, setNewFieldTextLength, setNewFieldType, setNewFieldUnique, setNewFieldValueSettings, setShowNewField, showNewField, validateNewFieldFormula }} /></React.Suspense>}
      {(showNewObject || showCustomTabWizard) && <React.Suspense fallback={null}><SetupObjectDialogs context={{ showNewObject, setShowNewObject, setShowCustomTabWizard, newObjectLabel, setNewObjectLabel, newObjectPluralLabel, setNewObjectPluralLabel, newObjectRecordNameLabel, setNewObjectRecordNameLabel, newObjectSettings, setNewObjectSettings, newObjectDescription, setNewObjectDescription, launchCustomTabWizard, setLaunchCustomTabWizard, createObject, showCustomTabWizard, customTabObject, setCustomTabObject, customTabStyle, setCustomTabStyle, customTabStyles, customTabAppIds, setCustomTabAppIds, apps, saveCustomTab }} /></React.Suspense>}
      {(flowRun || flowDebug) && <React.Suspense fallback={null}><SetupFlowDialogs context={{ flowRun, setFlowRun, flowRunnerError, setFlowRunnerError, submitFlowScreen, goBackFlowScreen, flowRunnerSubmitting, flowDebug, setFlowDebug, runFlowDebug, libraryComponents, loadFlowScreenRecords,
        flows,pages,apps,objects,reports,LightningAppRuntime,formFactor:runtimeFormFactor,
        pageDefinitionCache:pageDefinitionCache.current,activeAppId:(route.kind==='app-page'||route.kind==='app-home')?route.appId:'',
        onNavigate:navigateRoute,onLaunchFlow:(apiName:string,inputs?:Record<string,unknown>)=>void runFlow(apiName,inputs) }} /></React.Suspense>}
      {toast && <div className="toast" role="status"><Check size={16} aria-hidden="true" /><span className="toast-message">{toast}</span><button type="button" className="toast-dismiss" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => setToast('')}><X size={16} aria-hidden="true" /></button></div>}
    </div>
  );
}

