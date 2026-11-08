/** Metadata-only navigation targets for configurable page component events.
 * Runtime handlers must still enforce page and record permissions via the server.
 */
export type PageActionRoute =
  | { kind: 'record-list'; objectApiName: string; appId: string }
  | { kind: 'app-home'; appId: string }
  | { kind: 'app-page'; appId: string; pageApiName: string };

export type PageActionRoutingContext = {
  objects: ReadonlyArray<{ apiName: string }>;
  apps: ReadonlyArray<{ apiName: string; navigationPageApiNames?: string[] }>;
  pages: ReadonlyArray<{
    apiName: string;
    pageType: string;
    status: string;
    activationAssignments?: ReadonlyArray<{ appId: string | null }>;
  }>;
  currentAppId: string;
  defaultObjectApiName: string;
};

export function pageIsAvailableInApp(
  page: PageActionRoutingContext['pages'][number],
  app: PageActionRoutingContext['apps'][number]
): boolean {
  return page.pageType === 'App Page' && page.status === 'Active' && (
    (app.navigationPageApiNames ?? []).includes(page.apiName)
    || (page.activationAssignments ?? []).some((item) => item.appId === app.apiName)
  );
}

/** Resolves configured references, not user-controlled URLs or executable code. */
export function resolvePageActionRoute(
  binding: Record<string, unknown>,
  context: PageActionRoutingContext
): PageActionRoute {
  const kind = binding.navigationTargetType ?? 'Record List';
  if (kind === 'Record List') {
    const name = String(binding.navigationObjectApiName || context.defaultObjectApiName);
    if (!context.objects.some((item) => item.apiName === name)) {
      throw new Error('Select an existing destination object in Page Builder.');
    }
    // Preserve the previously published Records-app destination for legacy bindings.
    const appId = String(binding.navigationAppId || 'Records');
    if (binding.navigationAppId && !context.apps.some((app) => app.apiName === appId)) {
      throw new Error('Select an existing destination application in Page Builder.');
    }
    return { kind: 'record-list', objectApiName: name, appId };
  }
  if (kind !== 'App Home' && kind !== 'App Page') {
    throw new Error('Unsupported navigation destination. Select a destination in Page Builder.');
  }
  const appId = String(binding.navigationAppId || context.currentAppId);
  const app = context.apps.find((item) => item.apiName === appId);
  if (!app) throw new Error('Select an existing destination application in Page Builder.');
  if (kind === 'App Home') return { kind: 'app-home', appId };
  const pageApiName = String(binding.navigationPageApiName ?? '');
  const page = context.pages.find((item) => item.apiName === pageApiName);
  if (!page || !pageIsAvailableInApp(page, app)) {
    throw new Error('Select an active App Page assigned to the destination application.');
  }
  return { kind: 'app-page', appId, pageApiName };
}
