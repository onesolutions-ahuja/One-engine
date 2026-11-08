// Pure selection rules applied when a metadata load stage completes.
//
// The bootstrap in useSetupMetadata runs in two stages (fast entry data, then the
// full editor data ~700 ms later). Both stages must reconcile the *current*
// selection with fresh metadata. Reading `object`, `currentAppId` or `route`
// from the mount-time closure resets what the user has since opened, which shows
// up as the wrong object/app/page flashing before the right one returns.

type Named = { apiName: string };
type PageLike = Named & { targetObject?: string; pageType?: string };

/** Keep the current object if it still exists, else fall back to the first one. */
export function reconcileSelectedObject<T extends Named>(current: T | undefined, objects: readonly T[]): T | undefined {
  if (objects.length === 0) return current;
  return objects.find((item) => item.apiName === current?.apiName) ?? objects[0];
}

/** Keep the current app if it is installed, else fall back to the first app. */
export function reconcileCurrentAppId(current: string, apps: readonly Named[]): string {
  return apps.some((app) => app.apiName === current) ? current : (apps[0]?.apiName ?? '');
}

/**
 * Page to show once pages arrive: the page the route asks for, otherwise the page
 * already selected (refreshed from the new payload), otherwise the Account record
 * page, otherwise the first page.
 */
export function reconcileSelectedPage<T extends PageLike>(
  current: T | undefined,
  pages: readonly T[],
  routeResourceApiName?: string
): T | undefined {
  if (pages.length === 0) return current;
  return (routeResourceApiName ? pages.find((item) => item.apiName === routeResourceApiName) : undefined)
    ?? pages.find((item) => item.apiName === current?.apiName)
    ?? pages.find((item) => item.targetObject === 'Account' && item.pageType === 'Record Page')
    ?? pages[0];
}
