// @ts-nocheck
// Tenant-scoped bootstrap: core metadata first, optional admin metadata afterwards.
import { useEffect, useRef } from 'react';
import { resolveSqlComponentLibrary } from '../../components/Registry/bundledRegistryClient';
import { setAuthenticatedFormulaBindingContext } from '../../components/RegisteredComponent/fieldExpressionRuntime';
import { saveVerifiedMetadata, type MetadataPublicationResponse } from '../../metadata/Cache/verifiedMetadataCache';
import { reconcileCurrentAppId, reconcileSelectedObject, reconcileSelectedPage } from './metadataSelection';
import type { ObjectMetadata, LightningPageMetadata, LightningAppMetadata, FlowDefinitionMetadata, PlatformEventMetadata, EmailAlertMetadata, ApprovalProcessMetadata, ConnectorProviderMetadata, IntegrationConnectionMetadata, LibraryComponentMetadata, DashboardFolderMetadata, DashboardTerritoryMetadata, ReportFolderMetadata, ReportMetadata, AccessControlMetadata } from '../../metadata/Definitions/metadata';

export function shouldLoadFlowDefinitions(isAdmin: boolean, workspace: string, recordPageEditor=false): boolean {
  return isAdmin && (workspace === 'flow-builder' || workspace === 'page-builder'
    || workspace === 'scheduled-flows' || (workspace === 'object-manager' && recordPageEditor));
}

export function useSetupMetadata(ctx: any) {
  const { setSetupPermissions, setSessionPermissionsLoaded, advancedMetadataLoaded, apiRequest, approvalProcesses, apps, currentAppId, dashboards, emailAlerts, entryTiming, flowSnapshots, flows, isAuthErrorMessage, object, objects, page, pages, platformEvents, reports, route, saveVerifiedMetadata, setAccessControl, setAccessControlError, setAccessControlLoaded, setAdvancedMetadataLoaded, setApprovalProcesses, setApps, setCanCreateDashboards, setCanManageApprovalProcesses, setCanManageApps, setCanReadMetadata, setCanReadSecurity, setCanManageDashboardTerritories, setCanManageDashboards, setCanManageFlows, setCanManageLibrary, setCanManagePlatformLicences, setCanManagePlatformTenants, setCanManageReportFolders, setCanManageUserIdentities, setCanRunFlows, setCanScheduleDashboards, setConnectorProviders, setCurrentAppId, setCurrentFieldAccess, setCurrentProfileId, setCurrentRecordTypeAccess, setDashboardFolders, setDashboardRunningUserIds, setDashboardTerritories, setDashboardUserId, setDashboards, setEmailAlerts, setFlow, setFlows, setFlowDefinitionsLoaded, setFlowDefinitionsError, setReportsLoaded, setReportsError, setDashboardsLoaded, setDashboardsError, setIntegrationConnections, setLibraryComponents, setMetadataLoadError, setMetadataLoaded, setObject, setObjects, setPage, setPages, setPlatformEvents, setReportFolders, setReports, setSelectedFlowId, setToast, toast, workspace } = ctx;
  // Optional business metadata is resolved only for the active screen or page dependencies.
  // Tenant installation, entitlement and OneEngine access are always checked by the APIs.
  // Load tenant permissions as soon as a screen needs them, without waiting for
  // the large editor bootstrap. No demo identities/policies are shown meanwhile.
  // The load stages below outlive the render that started them (the bootstrap effect
  // runs once). Read the live route from here, never from the mount-time closure.
  const latest = useRef({ route });
  latest.current = { route };
  const permissionRequestStarted = useRef(false);
  useEffect(() => {
    const needsPermissionSnapshot = route.kind === 'setup' &&
      ['rbac', 'object-manager', 'data-loader', 'page-builder', 'report-builder', 'dashboard-builder', 'flow-builder']
        .includes(workspace);
    if (!needsPermissionSnapshot || permissionRequestStarted.current) return;
    permissionRequestStarted.current = true;
    void apiRequest<AccessControlMetadata>('/metadata/permissions')
      .then(snapshot => {
        setAccessControl(snapshot);
        setAccessControlError('');
        setAccessControlLoaded(true);
      })
      .catch(error => {
        permissionRequestStarted.current = false;
        setAccessControlError(error instanceof Error ? error.message : String(error));
        setAccessControlLoaded(false);
      });
  }, [route.kind, workspace]);
  const analyticsLoads = useRef(new Set<string>());
  useEffect(() => {
    // Direct analytics/automation lists fetch immediately, rather than waiting
    // for the unrelated editor/component-library bootstrap to finish.
    const directDataRoute=route.kind === 'setup' &&
      ['report-builder', 'dashboard-builder', 'scheduled-flows'].includes(workspace);
    if (!advancedMetadataLoaded && !directDataRoute) return;
    const currentPage = pages.filter((page) =>
      (route.kind === 'app-page' && page.apiName === route.pageApiName)
      || (route.kind === 'app-home' && page.pageType === 'Home Page' &&
        (page.activationAssignments ?? []).some((item) => item.appId === route.appId))
      || ((route.kind === 'record-list' || route.kind === 'record-detail') &&
        page.pageType === 'Record Page' && page.targetObject === route.objectApiName));
    const components = currentPage.flatMap((page) => page.components ?? []);
    const adminDependencies = route.kind === 'setup' &&
      ['page-builder', 'object-manager'].includes(workspace);
    const dashboardNeeded = adminDependencies || (route.kind === 'setup' && workspace === 'dashboard-builder')
      || components.some((component) => component.type === 'Dashboard');
    const reportNeeded = dashboardNeeded || adminDependencies || (route.kind === 'setup' && workspace === 'report-builder')
      || components.some((component) => component.type === 'Report Chart');
    // Administration is a separate workspace, not a dependency of a Till-only tenant.
    const isAdmin = route.kind === 'setup';
    const needsFlowDefinitions = shouldLoadFlowDefinitions(isAdmin, workspace,
      route.kind === 'setup' && workspace === 'object-manager' && Boolean(route.resourceApiName));
    const needsFlowAdministration = isAdmin && workspace === 'flow-builder';
    const needsApprovalAdministration = isAdmin && (workspace === 'approval-processes' || needsFlowAdministration);
    const needsConnectorAdministration = isAdmin && (needsFlowAdministration);
    const optionalGroups = [
      {
        key: 'flow-definitions', enabled: needsFlowDefinitions,
        run: () => apiRequest<{flows: FlowDefinitionMetadata[]}>('/metadata/flows')
          .then((payload) => {
            const definitions = payload.flows ?? [];
            flowSnapshots.current = new Map(definitions.map(item => [item.apiName, JSON.stringify(item)]));
            setFlows(definitions);
            if (definitions.length) {
              setFlow(definitions[0]);
              setSelectedFlowId(definitions[0].elements[0]?.id ?? 1);
            }
            setFlowDefinitionsError('');
            setFlowDefinitionsLoaded(true);
          })
      },
      {
        key: 'flow-admin', enabled: needsFlowAdministration,
        run: () => Promise.all([apiRequest('/metadata/platform-events'), apiRequest('/metadata/email-alerts')])
          .then(([events, alerts]) => { setPlatformEvents(events.platformEvents ?? []); setEmailAlerts(alerts.emailAlerts ?? []); })
      },
      {
        key: 'approvals-admin', enabled: needsApprovalAdministration,
        run: () => apiRequest('/metadata/approval-processes')
          .then((payload) => setApprovalProcesses(payload.approvalProcesses ?? []))
      },
      {
        key: 'connectors-admin', enabled: needsConnectorAdministration,
        run: () => Promise.all([apiRequest('/connector-providers'), apiRequest('/integration-connections')])
          .then(([providers, connections]) => { setConnectorProviders(providers.providers ?? []); setIntegrationConnections(connections.connections ?? []); })
      }
    ];
    for (const group of optionalGroups) {
      if (!group.enabled || analyticsLoads.current.has(group.key)) continue;
      analyticsLoads.current.add(group.key);
      void group.run().catch((error:unknown) => {
        analyticsLoads.current.delete(group.key);
        if(group.key==='flow-definitions')setFlowDefinitionsError(error instanceof Error?error.message:String(error));
      });
    }
    if (reportNeeded && !analyticsLoads.current.has('reports')) {
      analyticsLoads.current.add('reports');
      void Promise.all([
        apiRequest('/metadata/reports'),
        apiRequest('/metadata/report-folders')
      ]).then(([reportsPayload, foldersPayload]) => {
        setReports(reportsPayload.reports ?? []);
        setReportFolders(foldersPayload.folders ?? []);
        setCanManageReportFolders(Boolean(foldersPayload.canManageAll));
        setReportsError('');setReportsLoaded(true);
      }).catch((error:unknown) => {
        analyticsLoads.current.delete('reports');
        setReportsError(error instanceof Error?error.message:String(error));
      });
    }
    if (dashboardNeeded && !analyticsLoads.current.has('dashboards')) {
      analyticsLoads.current.add('dashboards');
      void Promise.all([
        apiRequest('/metadata/dashboards'),
        apiRequest('/metadata/dashboard-folders'),
        apiRequest('/metadata/dashboard-territories')
      ]).then(([payload, foldersPayload, territoryPayload]) => {
        setDashboards(payload.dashboards ?? []);
        setDashboardUserId(payload.userId ?? '');
        setDashboardRunningUserIds(payload.runningUserIds ?? []);
        setCanCreateDashboards(Boolean(payload.canCreate));
        setCanManageDashboards(Boolean(payload.canManageAll));
        setCanScheduleDashboards(Boolean(payload.canSchedule));
        setDashboardFolders(foldersPayload.folders ?? []);
        setDashboardTerritories(territoryPayload.territories ?? []);
        setCanManageDashboardTerritories(Boolean(territoryPayload.canManage));
        setDashboardsError('');setDashboardsLoaded(true);
      }).catch((error:unknown) => {
        analyticsLoads.current.delete('dashboards');
        setDashboardsError(error instanceof Error?error.message:String(error));
      });
    }
  }, [advancedMetadataLoaded, route, workspace, pages]);

  useEffect(() => {
    const loadMetadata = async () => {
      const failures: string[] = [];
      const pending = new Map<string, Promise<unknown>>();
      // Reuse the four essential requests when optional data loads later.
      // This avoids fetching the same objects/pages/apps twice.
      const recover = <T,>(path: string, fallback: T): Promise<T> => {
        const existing = pending.get(path);
        if (existing) return existing as Promise<T>;
        const request = (async () => {
          try { return await apiRequest<T>(path); }
          catch (error) {
            // Never convert an unavailable identity endpoint into an empty set of
            // permissions. That incorrectly looks like an RBAC denial in Setup.
            if (path === '/auth/me' || isAuthErrorMessage(error instanceof Error ? error.message : String(error))) throw error;
            failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
            return fallback;
          }
        })();
        pending.set(path, request);
        return request;
      };
      // Start the component library at the same time as the bootstrap. It does not depend on
      // it, and it used to wait for it (an extra 0.6 s). recover() reuses this same request later.
      if (route.kind === 'setup' && route.workspace !== 'home')
        recover<{ components: LibraryComponentMetadata[]; registered: {apiName:string;rendererKey:string}[]; canManage: boolean }>('/component-library', { components: [], registered: [], canManage: false }).catch(() => undefined);
      // Login can carry the bootstrap directly. Session restoration deliberately
      // returns its token promptly, then obtains the same RBAC-checked snapshot
      // through one authenticated request instead of four independent reads.
      let landing = entryTiming?.landing;
      if (!landing) {
        try {
          landing = (await apiRequest<{ landing?: NonNullable<typeof landing> }>('/metadata/landing-bootstrap')).landing;
        } catch {
          // Fall back to the existing individual endpoints and their error states.
        }
      }
      if (landing) {
        pending.set('/metadata/objects', Promise.resolve({ objects: landing.objects }));
        pending.set('/metadata/pages', Promise.resolve({ pages: landing.pages }));
        pending.set('/metadata/apps', Promise.resolve({ apps: landing.apps }));
        pending.set('/auth/me', Promise.resolve({ user: landing.user }));
      }
      try {
        // Entry routes need only core tenant metadata. Their initial render must
        // not wait for the Flow Builder, report builders, connectors and dashboards.
        const fastEntryRoute = route.kind !== 'setup' || route.workspace === 'home';
        if (fastEntryRoute) {
          // The tenant-scoped RBAC bootstrap came from login or the single
          // authenticated bootstrap endpoint: avoid four separate HTTP round trips.
          const [firstObjects, firstPages, firstApps, firstSession] = landing
            ? [
                { objects: landing.objects },
                { pages: landing.pages },
                { apps: landing.apps },
                { user: landing.user }
              ] as const
            : await Promise.all([
            recover<{ objects: ObjectMetadata[] }>('/metadata/objects', { objects: [] }),
            recover<{ pages: LightningPageMetadata[] }>('/metadata/pages', { pages: [] }),
            recover<{ apps: LightningAppMetadata[] }>('/metadata/apps', { apps: [] }),
            recover<{ user: { profileId: string; permissions: string[]; fieldAccess: Record<string, {read:boolean;edit:boolean}>; recordTypeAccess: Record<string, boolean> } }>('/auth/me',
              { user: { profileId:'',permissions:[],fieldAccess:{},recordTypeAccess:{} } })
          ]);
          const displayObjects = firstObjects.objects;
          const displayPages = firstPages.pages;
          const displayApps = firstApps.apps;
          setAuthenticatedFormulaBindingContext(firstSession.user);
          setObjects(displayObjects);
          if(displayObjects.length)setObject(current=>reconcileSelectedObject(current,displayObjects));
          setPages(displayPages);
          setApps(displayApps);
          setCurrentAppId(current=>reconcileCurrentAppId(current,displayApps));
          setSetupPermissions(firstSession.user.permissions);
          setCurrentProfileId(firstSession.user.profileId);
          setCurrentFieldAccess(firstSession.user.fieldAccess);
          setCurrentRecordTypeAccess(firstSession.user.recordTypeAccess);
          setCanManageUserIdentities(firstSession.user.permissions.includes('security:manage'));
          setCanManageApprovalProcesses(firstSession.user.permissions.includes('security:manage')
            || firstSession.user.permissions.includes('metadata:write'));
          setCanManagePlatformTenants(firstSession.user.permissions.includes('platform:tenants:manage'));
          setCanRunFlows(firstSession.user.permissions.includes('flows:run'));
          setCanManageFlows(firstSession.user.permissions.includes('flows:manage')
            || firstSession.user.permissions.includes('metadata:write'));
          setCanManageApps(firstSession.user.permissions.includes('metadata:write')); setCanReadMetadata(firstSession.user.permissions.includes('metadata:read')||firstSession.user.permissions.includes('metadata:write')); setCanReadSecurity(firstSession.user.permissions.includes('security:read')||firstSession.user.permissions.includes('security:manage'));
          setSessionPermissionsLoaded(true);
          setMetadataLoaded(true);
          // Give the landing screen a chance to paint before loading editor-only
          // data in the background. On direct builder URLs the full load begins
          // immediately, preserving the previous deep-link behaviour.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 700));
        }
        // Authorise direct Setup tabs as soon as /auth/me responds rather than
        // waiting for unrelated component-library, page and app metadata.
        const sessionRequest = recover<{ user: { id?: string; tenantId?: string; profileId: string; permissions: string[]; fieldAccess: Record<string, { read: boolean; edit: boolean }>; recordTypeAccess: Record<string, boolean> } }>('/auth/me', { user: { profileId: '', permissions: [], fieldAccess: {}, recordTypeAccess: {} } });
        void sessionRequest.then(({user}) => {
          setAuthenticatedFormulaBindingContext(user);
          setSetupPermissions(user.permissions);
          setCurrentProfileId(user.profileId);
          setCanManageUserIdentities(user.permissions.includes('security:manage'));
          setCanReadSecurity(user.permissions.includes('security:read') || user.permissions.includes('security:manage'));
          setCanReadMetadata(user.permissions.includes('metadata:read') || user.permissions.includes('metadata:write'));
          setCanManageApps(user.permissions.includes('metadata:write'));
          // The same /auth/me response the later bootstrap block applies. Setup surfaces
          // decide access from these flags, so they must all be in place before the
          // "resolved" marker flips; otherwise a granted user briefly sees a denial.
          setCanManagePlatformTenants(user.permissions.includes('platform:tenants:manage'));
          setCanManagePlatformLicences(user.permissions.includes('licence:manage'));
          setCanRunFlows(user.permissions.includes('flows:run'));
          setCanManageFlows(user.permissions.includes('flows:manage') || user.permissions.includes('metadata:write'));
          setCanManageApprovalProcesses(user.permissions.includes('security:manage') || user.permissions.includes('metadata:write'));
          setCurrentFieldAccess(user.fieldAccess);
          setCurrentRecordTypeAccess(user.recordTypeAccess);
          setSessionPermissionsLoaded(true);
        }).catch(() => {}); // The awaited bootstrap handles session-expiry errors.
        const [objectPayload, flowPayload, platformEventPayload, pagePayload, appPayload, emailAlertPayload, approvalProcessPayload, providerPayload, integrationPayload, libraryPayload, dashboardPayload, folderPayload, territoryPayload, reportFolderPayload, reportPayload, sessionPayload] = await Promise.all([
          recover<{ objects: ObjectMetadata[] }>('/metadata/objects', { objects: [] }),
          Promise.resolve({ flows: [] as FlowDefinitionMetadata[] }), // Flow definitions belong to the Builder, not login.
          Promise.resolve({ platformEvents: [] as PlatformEventMetadata[] }),
          recover<{ pages: LightningPageMetadata[] }>('/metadata/pages', { pages: [] }),
          recover<{ apps: LightningAppMetadata[] }>('/metadata/apps', { apps: [] }),
          Promise.resolve({ emailAlerts: [] as EmailAlertMetadata[] }),
          Promise.resolve({ approvalProcesses: [] as ApprovalProcessMetadata[] }),
          Promise.resolve({ providers: [] as ConnectorProviderMetadata[] }),
          Promise.resolve({ connections: [] as IntegrationConnectionMetadata[] }),
          recover<{ components: LibraryComponentMetadata[]; registered: {apiName:string;rendererKey:string}[]; canManage: boolean }>('/component-library', { components: [], registered: [], canManage: false }),
          Promise.resolve({ dashboards: [], userId: '', runningUserIds: [], canCreate: false, canManageAll: false, canSchedule: false }),
          Promise.resolve({ folders: [] as DashboardFolderMetadata[] }),
          Promise.resolve({ territories: [] as DashboardTerritoryMetadata[], canManage: false }),
          Promise.resolve({ folders: [] as ReportFolderMetadata[], canManageAll: false }),
          Promise.resolve({ reports: [] as ReportMetadata[] }),
          sessionRequest
        ]);
        setObjects(objectPayload.objects);
        if(objectPayload.objects.length)setObject(current=>reconcileSelectedObject(current,objectPayload.objects));
        setPlatformEvents(platformEventPayload.platformEvents);
        setPages(pagePayload.pages);
        if (pagePayload.pages.length) {
          const liveRoute = latest.current.route;
          const requestedPage = liveRoute.kind === 'setup' && liveRoute.workspace === 'page-builder'
            ? liveRoute.resourceApiName : undefined;
          setPage(current => reconcileSelectedPage(current, pagePayload.pages, requestedPage));
        }
        setApps(appPayload.apps);
        setCurrentAppId(current => reconcileCurrentAppId(current, appPayload.apps));
        // Named Credentials are owned by the dedicated authorised Setup loader.
        // Never overwrite its live result with this bootstrap's empty placeholder.
        setEmailAlerts(emailAlertPayload.emailAlerts);
        setApprovalProcesses(approvalProcessPayload.approvalProcesses);
        setConnectorProviders(providerPayload.providers);
        setIntegrationConnections(integrationPayload.connections);
        setLibraryComponents([...libraryPayload.components, ...await resolveSqlComponentLibrary(libraryPayload.registered ?? [])]);
        setCanManageLibrary(libraryPayload.canManage);
        setDashboards(dashboardPayload.dashboards);
        setDashboardFolders(folderPayload.folders);
        setDashboardTerritories(territoryPayload.territories);
        setCanManageDashboardTerritories(territoryPayload.canManage);
        setReportFolders(reportFolderPayload.folders);
        setCanManageReportFolders(reportFolderPayload.canManageAll);
        setDashboardUserId(dashboardPayload.userId);
        setDashboardRunningUserIds(dashboardPayload.runningUserIds);
        setAuthenticatedFormulaBindingContext(sessionPayload.user);
        setSetupPermissions(sessionPayload.user.permissions);
          setCurrentProfileId(sessionPayload.user.profileId);
        setCanManageUserIdentities(sessionPayload.user.permissions.includes('security:manage'));
        setCanManageApprovalProcesses(sessionPayload.user.permissions.includes('security:manage')
          || sessionPayload.user.permissions.includes('metadata:write'));
        setCanManagePlatformLicences(sessionPayload.user.permissions.includes('licence:manage'));
        setCanManagePlatformTenants(sessionPayload.user.permissions.includes('platform:tenants:manage'));
        setCanRunFlows(sessionPayload.user.permissions.includes('flows:run'));
        setCanManageFlows(sessionPayload.user.permissions.includes('flows:manage')
          || sessionPayload.user.permissions.includes('metadata:write'));
        setCanManageApps(sessionPayload.user.permissions.includes('metadata:write'));
        // Direct Builder/Admin URLs also require live read grants. Do not rely on
        // the fast-entry bootstrap, which only runs for ordinary landing routes.
        setCanReadMetadata(sessionPayload.user.permissions.includes('metadata:read') || sessionPayload.user.permissions.includes('metadata:write'));
        setCanReadSecurity(sessionPayload.user.permissions.includes('security:read') || sessionPayload.user.permissions.includes('security:manage'));
        setCurrentFieldAccess(sessionPayload.user.fieldAccess);
        setCurrentRecordTypeAccess(sessionPayload.user.recordTypeAccess);
        setCanCreateDashboards(dashboardPayload.canCreate);
        setCanManageDashboards(dashboardPayload.canManageAll);
        setCanScheduleDashboards(dashboardPayload.canSchedule);
        setReports(reportPayload.reports);
        const tenantId=sessionPayload.user.tenantId;
        const userId=sessionPayload.user.id;
        if(window.isSecureContext&&globalThis.indexedDB&&globalThis.crypto?.subtle
          &&typeof tenantId==='string'&&typeof userId==='string'
          &&sessionPayload.user.permissions.includes('metadata:read')){
          void apiRequest<MetadataPublicationResponse>('/metadata/offline-publication')
            .then(publication=>saveVerifiedMetadata(
              {tenantId,userId},publication.content,publication.publication))
            .catch((cause:unknown)=>setToast('Offline metadata publication unavailable: '
              +(cause instanceof Error?cause.message:String(cause))));
        }
        if (failures.length) setToast(`Some metadata could not load: ${failures.join('; ')}`);
      } catch (error) {
        // 401 / session expiry just returns to Login via metadrive:session-expired —
        // don't spam a "Metadata API unavailable" toast for a normal logged-out state.
        const message = error instanceof Error ? error.message : String(error);
        if (!isAuthErrorMessage(message)) {
          setMetadataLoadError(message);
          setToast(`Metadata API unavailable: ${message}`);
        }
      } finally {
        // Resolved even on failure so a failed identity call ends in the explicit
        // access message (fail closed) instead of an endless "checking" state.
        setSessionPermissionsLoaded(true);
        setMetadataLoaded(true);
        setAdvancedMetadataLoaded(true);
      }
    };
    void loadMetadata();
  }, []);
}
