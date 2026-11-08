import type { WorkspaceId } from '../../metadata/Definitions/metadata';
import {shortAppEntry} from './shortAppEntry';
import {standaloneEntryForAppId} from '../Standalone/standaloneEntries';


export const objectSettings = [
  'Details',
  'Schema Builder',
  'Global Value Sets',
  'Custom Labels',
  'Custom Metadata Types',
  'Custom Settings',
  'Fields & Relationships',
  'Validation Rules',
  'Business Automations',
  'Matching Rules',
  'Lightning Record Pages',
  'Buttons, Links, and Actions',
  'Compact Layouts',
  'Custom Tab',
  'Field Sets',
  'Object Limits',
  'Record Types',
  'Related Lookup Filters',
  'Search Layouts',
  'List View Button Layout'
];

const settingRouteNames: Record<string, string> = {
  'Schema Builder': 'SchemaBuilder',
  'Global Value Sets': 'GlobalValueSets',
  'Custom Labels': 'CustomLabels',
  'Custom Metadata Types': 'CustomMetadataTypes',
  'Custom Settings': 'CustomSettings',
  'Fields & Relationships': 'FieldsAndRelationships',
  'Validation Rules': 'ValidationRules',
  'Business Automations': 'BusinessAutomations',
  'Matching Rules': 'MatchingRules',
  'Page Layouts': 'PageLayouts',
  'Lightning Record Pages': 'LightningRecordPages',
  'Buttons, Links, and Actions': 'ButtonsLinksAndActions',
  'Compact Layouts': 'CompactLayouts',
  'Custom Tab': 'CustomTab',
  'Field Sets': 'FieldSets',
  'Object Limits': 'ObjectLimits',
  'Record Types': 'RecordTypes',
  'Related Lookup Filters': 'RelatedLookupFilters',
  'Search Layouts': 'SearchLayouts',
  'List View Button Layout': 'ListViewButtonLayout'
};

export const recordPageLayoutVariants = ['Mobile', 'Desktop', 'Tablet', 'Custom'] as const;

export function settingFromRoute(value: string): string {
  // Existing bookmarked Page Layouts links now open the unified Record Pages editor.
  if (value === 'PageLayouts' || value === 'Page Layouts') return 'Lightning Record Pages';
  return Object.entries(settingRouteNames).find(([, routeName]) => routeName === value)?.[0]
    ?? (objectSettings.includes(value) ? value : 'Details');
}

export function settingToRoute(value: string): string {
  if (value === 'Page Layouts') return 'LightningRecordPages';
  return settingRouteNames[value] ?? value.replace(/[^A-Za-z0-9]/g, '');
}
export type AppRoute =
  | { kind: 'setup'; workspace: WorkspaceId; objectApiName?: string; setting?: string; resourceApiName?: string; resourceId?: string; dashboardView?: boolean }
  | { kind: 'app-home'; appId: string }
  | { kind: 'app-page'; appId: string; pageApiName: string }
  | { kind: 'route-alias'; appId: string; slug: string }
  | { kind: 'record-list'; objectApiName: string; appId?: string; relatedCreation?: {sourceObjectApi: string; sourceRecordId: string; actionId: string}; globalCreation?: {actionId: string} }
  | { kind: 'record-detail'; objectApiName: string; recordId: string; appId?: string };

export function parseAppRoute(pathname: string, search = ''): AppRoute {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (basePath && pathname.startsWith(basePath + '/')) pathname = pathname.slice(basePath.length);
  const pathSegments = pathname.split('/').filter(Boolean);
  const segments = pathSegments[0] === 'une' ? pathSegments.slice(1) : [];
  const appId = new URLSearchParams(search).get('appId') || 'Records';
  // Single-segment tenant application routes are resolved through shared metadata.
  // The authenticated app runtime still enforces tenant licence, installation and RBAC.
  const shortEntry=shortAppEntry(pathname);
  if(shortEntry)return {kind:'app-home',appId:shortEntry};
  try {
    if (segments.length === 3 && segments[0] === 'apps' && segments[2] === 'home') {
      return { kind: 'app-home', appId: decodeURIComponent(segments[1]) };
    }
    if (segments.length === 4 && segments[0] === 'apps' && segments[2] === 'routes') {
      return { kind: 'route-alias', appId: decodeURIComponent(segments[1]), slug: decodeURIComponent(segments[3]) };
    }
    if (segments.length === 4 && segments[0] === 'apps' && segments[2] === 'pages') {
      return { kind: 'app-page', appId: decodeURIComponent(segments[1]), pageApiName: decodeURIComponent(segments[3]) };
    }
    if (segments.length === 2 && segments[0] === 'dashboards') {
      return { kind: 'setup', workspace: 'dashboard-builder', resourceApiName: decodeURIComponent(segments[1]), dashboardView: true };
    }
    if (segments[0] === 'setup') {
      const workspace = decodeURIComponent(segments[1] ?? 'home') as WorkspaceId | 'connector-settings';
      const validWorkspaces: WorkspaceId[] = ['home', 'object-manager', 'data-loader', 'page-builder', 'dashboard-builder', 'report-builder', 'flow-builder', 'flow-interviews', 'scheduled-actions', 'scheduled-flows', 'flow-logs', 'automation-settings', 'app-manager', 'app-exchange', 'named-credentials', 'company-settings', 'tenant-management', 'rbac'];
      if (workspace === 'connector-settings') return { kind: 'setup', workspace: 'named-credentials' };
      if (!validWorkspaces.includes(workspace)) return { kind: 'setup', workspace: 'home' };
      if (workspace === 'object-manager') {
        return {
          kind: 'setup',
          workspace,
          ...(segments[2] ? { objectApiName: decodeURIComponent(segments[2]) } : {}),
          ...(segments[3] ? { setting: settingFromRoute(decodeURIComponent(segments[3])) } : {}),
          ...(segments[4] ? { resourceApiName: decodeURIComponent(segments[4]) } : {}),
          ...(segments[3] && settingFromRoute(decodeURIComponent(segments[3])) === 'Lightning Record Pages'
            && segments[4] && segments[5]
            && recordPageLayoutVariants.some(variant => variant === decodeURIComponent(segments[5]))
            ? { resourceId: decodeURIComponent(segments[5]) } : {})
        };
      }
      if (segments[2]) {
        return {
          kind: 'setup',
          workspace,
          resourceApiName: decodeURIComponent(segments[2]),
          ...(segments[3] ? { resourceId: decodeURIComponent(segments[3]) } : {})
        };
      }
      return { kind: 'setup', workspace };
    }
    if (segments.length === 3 && segments[0] === 'o' && segments[2] === 'list') {
      const params=new URLSearchParams(search);
      const sourceObjectApi=params.get('sourceObjectApi'),sourceRecordId=params.get('sourceRecordId'),
        actionId=params.get('quickActionId');
      const relatedCreation=sourceObjectApi&&sourceRecordId&&actionId
        &&/^[A-Za-z][A-Za-z0-9_]*$/.test(sourceObjectApi)
        &&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(sourceRecordId)
        &&/^[A-Za-z][A-Za-z0-9_-]*$/.test(actionId)
        ?{sourceObjectApi,sourceRecordId,actionId}:undefined;
      const globalActionId=params.get('globalActionId');
      const globalCreation=globalActionId&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(globalActionId)
        ?{actionId:globalActionId}:undefined;
      return { kind:'record-list',objectApiName:decodeURIComponent(segments[1]),appId,
        ...(relatedCreation?{relatedCreation}:{}),...(globalCreation?{globalCreation}:{}) };
    }
    if (segments.length === 4 && segments[0] === 'r' && segments[3] === 'view') {
      return {
        kind: 'record-detail',
        objectApiName: decodeURIComponent(segments[1]),
        recordId: decodeURIComponent(segments[2]),
        appId
      };
    }
  } catch {
    return { kind: 'setup', workspace: 'home' };
  }
  return { kind: 'setup', workspace: 'home' };
}

export function appRoutePath(route: AppRoute): string {
  const path = appRoutePathWithoutBase(route);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return basePath + path;
}

export function appRoutePathWithoutBase(route: AppRoute): string {
  if (route.kind === 'setup') {
    if (route.dashboardView && route.resourceApiName) {
      return `/une/dashboards/${encodeURIComponent(route.resourceApiName)}`;
    }
    const segments = ['/une/setup', encodeURIComponent(route.workspace)];
    if (route.workspace === 'object-manager') {
      if (route.objectApiName) segments.push(encodeURIComponent(route.objectApiName));
      if (route.setting) segments.push(encodeURIComponent(settingToRoute(route.setting)));
      if ((route.setting === 'Lightning Record Pages' || route.setting === 'Fields & Relationships') && route.resourceApiName) {
        segments.push(encodeURIComponent(route.resourceApiName));
        if (route.resourceId && recordPageLayoutVariants.some(variant => variant === route.resourceId))
          segments.push(encodeURIComponent(route.resourceId));
      }
    } else if (route.resourceApiName) {
      segments.push(encodeURIComponent(route.resourceApiName));
      if (route.resourceId) segments.push(encodeURIComponent(route.resourceId));
    }
    return segments.join('/');
  }
  if (route.kind === 'app-home') {
    const standalone=standaloneEntryForAppId(route.appId);
    return standalone?`/${standalone.slug}`:`/une/apps/${encodeURIComponent(route.appId)}/home`;
  }
  if (route.kind === 'app-page') {
    const standalone=standaloneEntryForAppId(route.appId);
    return standalone?`/${standalone.slug}?page=${encodeURIComponent(route.pageApiName)}`:
      `/une/apps/${encodeURIComponent(route.appId)}/pages/${encodeURIComponent(route.pageApiName)}`;
  }
  if (route.kind === 'route-alias') return `/une/apps/${encodeURIComponent(route.appId)}/routes/${encodeURIComponent(route.slug)}`;
  if (route.kind === 'record-list') {
    const query = new URLSearchParams({ filterName: `All${route.objectApiName}s` });
    if (route.appId) query.set('appId', route.appId);
    if (route.globalCreation) query.set('globalActionId',route.globalCreation.actionId);
    if (route.relatedCreation) {
      query.set('sourceObjectApi',route.relatedCreation.sourceObjectApi);
      query.set('sourceRecordId',route.relatedCreation.sourceRecordId);
      query.set('quickActionId',route.relatedCreation.actionId);
    }
    return `/une/o/${encodeURIComponent(route.objectApiName)}/list?${query.toString()}`;
  }
  if (route.kind === 'record-detail') {
    const path = `/une/r/${encodeURIComponent(route.objectApiName)}/${encodeURIComponent(route.recordId)}/view`;
    return route.appId ? `${path}?${new URLSearchParams({ appId: route.appId }).toString()}` : path;
  }
  return '/une/setup/home';
}
