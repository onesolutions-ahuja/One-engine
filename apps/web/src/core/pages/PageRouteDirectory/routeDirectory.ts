import type { LightningAppMetadata, LightningPageMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';

export type RouteDirectoryEntry = {
  key: string;
  appId: string;
  appLabel: string;
  kind: 'App Home' | 'App Page' | 'Record List';
  targetApiName: string;
  targetLabel: string;
  path: string;
  available: boolean;
  reason: string;
};

type RouteApp = Pick<LightningAppMetadata, 'apiName' | 'label' | 'navigationItems' | 'navigationPageApiNames'>;
type RouteObject = Pick<ObjectMetadata, 'apiName' | 'label'>;
type RoutePage = Pick<LightningPageMetadata, 'apiName' | 'label' | 'pageType' | 'status' | 'activationAssignments'>;

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value);
}

/**
 * Enumerate canonical routes from existing persisted App Manager/Page Builder metadata.
 * No new URL grammar or metadata records. The runtime and server still enforce RBAC.
 */
export function listPageRoutes(
  apps: readonly RouteApp[],
  objects: readonly RouteObject[],
  pages: readonly RoutePage[],
  selectedAppId = ''
): RouteDirectoryEntry[] {
  const knownObjects = new Map(objects.map(object => [object.apiName, object]));
  const knownPages = new Map(pages.map(page => [page.apiName, page]));
  const result: RouteDirectoryEntry[] = [];
  const acceptedApps = apps.filter(app => validIdentifier(app.apiName)
    && (!selectedAppId || app.apiName === selectedAppId));
  for (const app of acceptedApps) {
    const appPath = encodeURIComponent(app.apiName);
    result.push({
      key: app.apiName + ':home', appId: app.apiName, appLabel: app.label,
      kind: 'App Home', targetApiName: app.apiName, targetLabel: app.label + ' home',
      path: '/une/apps/' + appPath + '/home', available: true, reason: ''
    });
    for (const objectApiName of new Set(app.navigationItems ?? [])) {
      if (!validIdentifier(objectApiName)) continue;
      const object = knownObjects.get(objectApiName);
      const query = new URLSearchParams({ filterName: 'All' + objectApiName + 's', appId: app.apiName });
      result.push({
        key: app.apiName + ':object:' + objectApiName,
        appId: app.apiName, appLabel: app.label,
        kind: 'Record List', targetApiName: objectApiName,
        targetLabel: object?.label ?? objectApiName,
        path: '/une/o/' + encodeURIComponent(objectApiName) + '/list?' + query.toString(),
        available: Boolean(object), reason: object ? '' : 'Object not found in Object Manager'
      });
    }
    const assignedPages = pages.filter(page => page.pageType === 'App Page'
      && (page.activationAssignments ?? []).some(item => item.appId === app.apiName));
    const attached = new Set([...(app.navigationPageApiNames ?? []), ...assignedPages.map(page => page.apiName)]);
    for (const pageApiName of attached) {
      if (!validIdentifier(pageApiName)) continue;
      const page = knownPages.get(pageApiName);
      const ready = page?.pageType === 'App Page' && page.status === 'Active';
      result.push({
        key: app.apiName + ':page:' + pageApiName,
        appId: app.apiName, appLabel: app.label,
        kind: 'App Page', targetApiName: pageApiName,
        targetLabel: page?.label ?? pageApiName,
        path: '/une/apps/' + appPath + '/pages/' + encodeURIComponent(pageApiName),
        available: ready,
        reason: !page ? 'Page no longer exists'
          : page.pageType !== 'App Page' ? 'Target is not an App Page'
          : page.status !== 'Active' ? 'Page is a draft; activate it first' : ''
      });
    }
  }
  const kindRank: Record<RouteDirectoryEntry['kind'], number> = {
    'App Home': 0, 'App Page': 1, 'Record List': 2
  };
  return result.sort((a, b) => a.appLabel.localeCompare(b.appLabel)
    || kindRank[a.kind] - kindRank[b.kind]
    || a.targetLabel.localeCompare(b.targetLabel)
    || a.key.localeCompare(b.key));
}

/** Strip potentially hostile or duplicate prefixes from BASE_URL; never emit an external URL. */
export function browserRoutePath(baseUrl: string, path: string): string {
  if (!path.startsWith('/une/') || !/^\/(?:une\/[a-zA-Z0-9_/%?=&+.-]+)$/.test(path)
    || !baseUrl.startsWith('/') || baseUrl.startsWith('//')) {
    throw new Error('Invalid internal application route');
  }
  const base = baseUrl.replace(/\/+$/, '');
  return (base === '/' ? '' : base) + path;
}
