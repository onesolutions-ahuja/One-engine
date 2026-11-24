import { rememberAppLocks } from '../../authentication/TillDevice/tillDevice';
// Published app pages open without the Setup shell: they need only their app's runtime
// metadata (objects, apps, a summary of each page, the session), not the ~350 KB Setup
// landing bootstrap. Pure helpers: no network, no window access at import.
import type { ObjectMetadata, LightningPageMetadata, LightningAppMetadata } from '../../metadata/Definitions/metadata';

export type AppRuntimeUser = {
  id?: string; tenantId?: string; profileId: string; permissions: string[];
  fieldAccess: Record<string, { read: boolean; edit: boolean }>; recordTypeAccess: Record<string, boolean>;
};
/** Pages arrive as summaries: no components (SCREEN, navigation and popup sizes need only these fields). */
export type AppRuntimeMetadata = {
  appId: string;
  objects: ObjectMetadata[];
  pages: Array<LightningPageMetadata & { standalonePresentation?: boolean }>;
  apps: LightningAppMetadata[];
  user: AppRuntimeUser;
};

const appPath = /^\/une\/apps\/([A-Za-z][A-Za-z0-9_]*)(?:\/pages\/[A-Za-z][A-Za-z0-9_]*|\/home)\/?$/;
/** The app whose published page this address opens (/une/apps/<APP>/pages/<page> or /home), if any. */
export function publishedAppIdFromPath(pathname: string): string | undefined {
  return appPath.exec(pathname)?.[1];
}

/** A well-formed answer of GET /apps/<APP>/runtime-metadata (or the sign-in refresh's appRuntime). */
export function readAppRuntimeMetadata(value: unknown, appId: string): AppRuntimeMetadata | undefined {
  const data = value as Partial<AppRuntimeMetadata> | null | undefined;
  if (!data || typeof data !== 'object' || data.appId !== appId) return undefined;
  if (!Array.isArray(data.objects) || !Array.isArray(data.pages) || !Array.isArray(data.apps)) return undefined;
  const user = data.user as AppRuntimeUser | undefined;
  if (!user || typeof user.profileId !== 'string' || !Array.isArray(user.permissions)) return undefined;
  // Summaries never carry components; code that reads page.components still gets an array.
  const pages = data.pages.map(page => Array.isArray(page.components) ? page : { ...page, components: [] });
  rememberAppLocks(data.apps);
  return { appId, objects: data.objects, pages, apps: data.apps, user };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const appRuntimeCacheKey = 'une.appRuntime.v1';
/** The last answer for this user and app, kept in this browser so a repeat open draws at once
 * (metadata only, no records; the server checks every permission on every request). */
export function cachedAppRuntimeMetadata(storage: Storage | undefined, userId: string | undefined, appId: string): AppRuntimeMetadata | undefined {
  if (!storage || !userId) return undefined;
  try {
    const saved = JSON.parse(storage.getItem(appRuntimeCacheKey) ?? 'null') as { userId?: string; data?: unknown } | null;
    return saved?.userId === userId ? readAppRuntimeMetadata(saved.data, appId) : undefined;
  } catch { return undefined; }
}
export function rememberAppRuntimeMetadata(storage: Storage | undefined, userId: string | undefined, data: AppRuntimeMetadata): void {
  if (!storage || !userId) return;
  try { storage.setItem(appRuntimeCacheKey, JSON.stringify({ userId, data })); } catch { /* storage full or blocked */ }
}

/** Popup size: the canvas of the popup's page, from the page summaries. */
export function pageCanvasOf(pages: readonly Pick<LightningPageMetadata, 'apiName' | 'canvasWidth' | 'canvasHeight'>[], name: string) {
  const page = pages.find(item => item.apiName === name) ?? pages.find(item => item.apiName.toLowerCase() === name.toLowerCase());
  return page ? { canvasWidth: page.canvasWidth, canvasHeight: page.canvasHeight } : undefined;
}
